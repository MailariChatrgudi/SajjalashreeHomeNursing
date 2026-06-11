require('dns').setDefaultResultOrder('ipv4first'); // Force IPv4 globally to fix Render SMTP ENETUNREACH

// Load .env.development locally, .env in production
// Default to development if NODE_ENV is not explicitly set to production
const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.development';
require('dotenv').config({ path: require('path').resolve(__dirname, envFile), override: true });
console.log(`[env] Loaded: ${envFile} | NODE_ENV=${process.env.NODE_ENV || 'development (fallback)'}`);


const express = require('express')
const helmet = require('helmet');
const db = require('./config/database');
const upload = require('./config/middleware')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const cors = require('cors');
const bcrypt = require('bcrypt');
const { generateToken, authenticateToken, verifyToken } = require('./config/jwt');
const { sendApplicantEmail, sendAdminEmail, sendGeneralEnquiryAlert, sendProductEnquiryAlert } = require('./config/email');

const rateLimit = require('express-rate-limit');

const app = express();

// FIX: Trust proxy is REQUIRED on Render, otherwise the load balancer's IP is rate-limited and blocks everyone!
app.set('trust proxy', 1);

// FIX 2 — Helmet: secure HTTP headers (CSP disabled — site uses CDN resources & inline styles)
app.use(helmet({
  contentSecurityPolicy: false,        // CDNs: Bootstrap, FontAwesome, Google Fonts, emailjs
  crossOriginEmbedderPolicy: false,    // allows loading cross-origin images/media
  hsts: process.env.NODE_ENV === 'production' // disable HSTS on localhost to prevent ERR_SSL_PROTOCOL_ERROR
}));

// FIX 3 — HTTPS redirect in production
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === 'production' &&
    req.headers['x-forwarded-proto'] !== 'https'
  ) {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

const idempotencyStore = new Map();
// Auto-clean entries older than 24 hours every hour
setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, val] of idempotencyStore.entries()) {
        if (val.timestamp < cutoff) idempotencyStore.delete(key);
    }
}, 60 * 60 * 1000);

// WARN 1 — DB pool error handler
db.pool ? db.pool.on('error', (err) => {
    console.error('Database pool error:', err);
}) : null;

// Apply rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

// Fix 10: Stricter rate limiter for OTP/password-reset routes (5 req / 60 min)
const otpLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 60 minutes
    max: 5,
    message: { success: false, message: 'Too many attempts. Please wait 60 minutes before trying again.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Ensure upload directories exist (Render starts with empty filesystem)
const uploadDirs = ['photos', 'aadhar', 'aadhar_front', 'aadhar_back', 'certificate'];
uploadDirs.forEach(dir => {
    const dirPath = path.join(__dirname, 'public', 'uploads', dir);
    fs.mkdirSync(dirPath, { recursive: true });
});

app.use(express.json())
app.use((req, res, next) => {
    // Prevent access to backend sensitive directories and git
    if (req.path.startsWith('/Backend') || req.path.includes('.env') || req.path.includes('.git')) {
        return res.status(403).send('Forbidden');
    }
    next();
});
app.use(express.static(path.join(__dirname, "..")))
app.use(express.static(path.join(__dirname, "../Admin")))
// FIX 1 — CORS: restrict to production domain only
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [
        process.env.FRONTEND_URL, 
        'https://sajjalashreehomenursingservices.com', 
        'https://www.sajjalashreehomenursingservices.com',
        'https://sajjalashreehomenursing.onrender.com',
        'https://sajjalashreehomenursing-1.onrender.com'
      ].filter(Boolean)
    : true,                       // development: allow all (localhost)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}))

app.use(limiter);

// Admin authentication middleware example (Bearer token)
// Required behavior: if not authenticated -> 401 {success:false,message:"Unauthorized"}
function verifyAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ success: false, message: "Unauthorized" })
    }

    try {
        const decoded = verifyToken(token);
        req.admin = decoded;
        return next();
    } catch (e) {
        return res.status(401).json({ success: false, message: "Unauthorized" })
    }
}

// Protected file access (no public uploads exposure)
const UPLOADS_ROOT = path.resolve(__dirname, 'public', 'uploads');
const ALLOWED_UPLOAD_FOLDERS = new Set(['photos', 'aadhar', 'aadhar_front', 'aadhar_back', 'certificate']);
const cloudinary = require('cloudinary').v2;

app.get('/admin/file/:folder/:filename', verifyAdmin, async (req, res, next) => {
    try {
        const { folder, filename } = req.params;

        if (!ALLOWED_UPLOAD_FOLDERS.has(folder)) {
            return res.status(400).json({ success: false, message: 'Invalid folder' })
        }

        if (!filename || filename.includes('..')) {
            return res.status(400).json({ success: false, message: 'Invalid filename' });
        }

        // Reconstruct the Cloudinary public_id using env-aware folder prefix
        let fieldname = folder;
        if (folder === 'photos') fieldname = 'photo';

        // Must match the prefix used in uploadToCloudinarySync
        const folderPrefix = {
            production:  'sajjalashree',
            staging:     'sajjalashree_staging',
            development: 'sajjalashree_dev'
        }[process.env.NODE_ENV] || 'sajjalashree_dev';

        // Determine if this folder contains private files
        const privateFolders = new Set([
          'aadhar',
          'aadhar_front',
          'aadhar_back'
        ]);
        const isPrivate = privateFolders.has(folder);

        // Extract base filename without extension
        const baseFilename = filename.includes('.')
          ? filename.substring(0, filename.lastIndexOf('.'))
          : filename;

        const publicId = `${folderPrefix}/${fieldname}/${baseFilename}`;

        console.log(`Admin file request: ${publicId} private: ${isPrivate}`);

        // Generate appropriate URL
        let fileUrl;

        if (isPrivate) {
          // Signed URL — expires in 5 minutes
          fileUrl = cloudinary.url(publicId, {
            resource_type: 'image',
            type:          'authenticated',
            sign_url:      true,
            expires_at:    Math.floor(Date.now() / 1000) + 300,
            secure:        true
          });
        } else {
          // Public URL — no signing needed
          fileUrl = cloudinary.url(publicId, {
            resource_type: 'image',
            type:          'upload',
            secure:        true
          });
        }

        console.log(`Generated URL for ${folder}/${filename}: ${isPrivate ? 'signed' : 'public'}`);

        // Redirect directly to the Cloudinary URL.
        // fetch() in admin.js will transparently follow this redirect
        // and receive the image/pdf blob, maintaining exactly the same behavior 
        // without breaking the frontend blob loading logic.
        return res.redirect(fileUrl);

    } catch (e) {
        next(e);
    }
})


// --- General Enquiry Endpoint ---
app.post('/enquiry', async (req, res, next) => {
    try {
        const { from_name, from_email, phone } = req.body;
        const errors = {};
        if (!from_name || typeof from_name !== 'string' || from_name.trim().length < 3) {
            errors.name = 'Name must be at least 3 characters.';
        }
        if (!from_email || !/^([\w-.]+)@([\w-]+)\.([a-zA-Z]{2,})$/.test(from_email.trim())) {
            errors.email = 'Invalid email address.';
        }

        if (!phone || !/^\+?[\d\s\-().]{10,15}$/.test(phone.trim())) {
            errors.phone = 'Phone must be 10-15 digits.';
        }
        if (Object.keys(errors).length > 0) {
            return res.status(400).json({ success: false, errors });
        }
        const sql = 'INSERT INTO general_enquiries (name, email, phone) VALUES (?, ?, ?)';
        await db.query(sql, [from_name.trim(), from_email.trim(), phone.trim()]);
        res.status(200).json({ success: true, message: 'Enquiry submitted successfully!' });
        // Send admin alert asynchronously (Fix 12: SMTP failure is already caught in email.js)
        sendGeneralEnquiryAlert({ name: from_name, email: from_email, phone })
            .catch(err => console.error('Error sending general enquiry alert:', err));
    } catch (e) {
        // Fix 12: Handle MySQL pool exhaustion
        if (e.code === 'ER_CON_COUNT_ERROR' || e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.message.includes('pool')) {
            return res.status(503).json({ success: false, error: 'Database temporarily unavailable. Please try again shortly.' });
        }
        next(e);
    }
});

// --- Product Enquiry Endpoint ---
app.post('/product-enquiry', async (req, res, next) => {
    try {
        const { product_name, from_name, phone } = req.body;
        const errors = {};
        if (!product_name || typeof product_name !== 'string' || product_name.trim().length < 2) {
            errors.product = 'Product name required.';
        }
        if (!from_name || typeof from_name !== 'string' || from_name.trim().length < 3) {
            errors.name = 'Name must be at least 3 characters.';
        }
        if (!phone || !/^\+?[\d\s\-().]{10,15}$/.test(phone.trim())) {
            errors.phone = 'Phone must be 10-15 digits.';
        }
        if (Object.keys(errors).length > 0) {
            return res.status(400).json({ success: false, errors });
        }
        const sql = 'INSERT INTO product_enquiries (product_name, name, phone) VALUES (?, ?, ?)';
        await db.query(sql, [product_name.trim(), from_name.trim(), phone.trim()]);
        
        res.status(200).json({ success: true, message: 'Product enquiry submitted successfully!' });
        
        // Send admin alert asynchronously (Fix 12: SMTP failure is already caught in email.js)
        sendProductEnquiryAlert({ product_name, name: from_name, phone })
            .catch(err => console.error('Error sending product enquiry alert:', err));
    } catch (e) {
        // Fix 12: Handle MySQL pool exhaustion
        if (e.code === 'ER_CON_COUNT_ERROR' || e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.message.includes('pool')) {
            return res.status(503).json({ success: false, error: 'Database temporarily unavailable. Please try again shortly.' });
        }
        next(e);
    }
});

// --- Admin: Get all general enquiries ---
app.get('/admin/enquiries', authenticateToken, async (req, res, next) => {
    try {
        const { status } = req.query;
        const allowed = new Set(['Pending', 'Contacted']);

        let sql = 'SELECT * FROM general_enquiries';
        const params = [];

        if (status && allowed.has(String(status))) {
            sql += ' WHERE status=?';
            params.push(String(status));
        }

        sql += ' ORDER BY created_at DESC';
        const [rows] = await db.query(sql, params);
        res.json(rows);
    } catch (e) {
        next(e);
    }
});

// --- Admin: Get all product enquiries ---
app.get('/admin/product-enquiries', authenticateToken, async (req, res, next) => {
    try {
        const { status } = req.query;
        const allowed = new Set(['Pending', 'Contacted']);

        let sql = 'SELECT * FROM product_enquiries';
        const params = [];

        if (status && allowed.has(String(status))) {
            sql += ' WHERE status=?';
            params.push(String(status));
        }

        sql += ' ORDER BY created_at DESC';
        const [rows] = await db.query(sql, params);
        res.json(rows);
    } catch (e) {
        next(e);
    }
});

// --- Admin: Update enquiry status (Pending/Contacted) ---
app.put('/admin/enquiries/:id/status', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const allowed = new Set(['Pending', 'Contacted']);

        if (!allowed.has(String(status))) {
            return res.status(400).json({ success: false, message: 'Invalid status' })
        }

        const [result] = await db.query('UPDATE general_enquiries SET status=? WHERE id=?', [String(status), id]);
        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Not found' })
        }
        res.json({ success: true, message: 'Status updated' })
    } catch (e) {
        next(e)
    }
})

app.put('/admin/product-enquiries/:id/status', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const allowed = new Set(['Pending', 'Contacted']);

        if (!allowed.has(String(status))) {
            return res.status(400).json({ success: false, message: 'Invalid status' })
        }

        const [result] = await db.query('UPDATE product_enquiries SET status=? WHERE id=?', [String(status), id]);
        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Not found' })
        }
        res.json({ success: true, message: 'Status updated' })
    } catch (e) {
        next(e)
    }
})

// --- Admin: Delete enquiries ---
app.delete('/admin/enquiries/:id', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const [result] = await db.query('DELETE FROM general_enquiries WHERE id=?', [id]);
        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Not found' })
        }
        res.json({ success: true, message: 'Deleted' })
    } catch (e) {
        next(e)
    }
})

app.delete('/admin/product-enquiries/:id', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const [result] = await db.query('DELETE FROM product_enquiries WHERE id=?', [id]);
        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Not found' })
        }
        res.json({ success: true, message: 'Deleted' })
    } catch (e) {
        next(e)
    }
})

app.get('/admin/applications', authenticateToken, async (req, res, next) => {
    try {
        const [rows] = await db.query('SELECT * FROM career_applications; ');
        res.json(rows)
    }
    catch (e) {
        next(e)
    }

})

// --- Admin: Generate short-lived signed Cloudinary URL for authenticated assets ---
app.get('/admin/signed-url', authenticateToken, (req, res) => {
    const { public_id } = req.query;

    if (!public_id) {
        return res.status(400).json({ success: false, error: 'public_id is required' });
    }

    try {
        const signedUrl = cloudinary.url(public_id, {
            type: 'authenticated',
            sign_url: true,
            expires_at: Math.floor(Date.now() / 1000) + 300, // 5-minute expiry
            resource_type: 'image'
        });

        return res.json({ success: true, url: signedUrl });
    } catch (e) {
        console.error('Failed to generate signed Cloudinary URL:', e.message);
        return res.status(500).json({ success: false, error: 'Failed to generate URL' });
    }
});

// Multer wrapper — catches file upload errors (wrong type, too large) and forwards to global error handler
const CAREER_FILE_FIELDS = [{ name: 'aadhar', maxCount: 1 }, { name: 'photo', maxCount: 1 }, { name: 'certificate', maxCount: 1 }];

const getBaseNameWithExt = (fileObj) => {
    if (!fileObj) return '';
    const base = fileObj.filename.split('/').pop();
    const ext = path.extname(fileObj.originalname);
    return base.includes('.') ? base : base + ext;
};

const getFilenameFromPublicId = (publicId, originalName = '') => {
    if (!publicId) return '';
    const base = String(publicId).split('/').pop();
    const ext = path.extname(originalName);
    return base.includes('.') || !ext ? base : base + ext;
};

const sanitizeUploadedFilename = (filename) => {
    if (!filename) return '';
    return path.basename(String(filename));
};

const getUploadedFiles = (files) => Object.values(files || {}).flat().filter(Boolean);

const uploadToCloudinarySync = async (file) => {
  if (!file) return null;

  let fieldname = file.fieldname;
  if (fieldname === 'photos') fieldname = 'photo';

  const folderPrefix = {
    production:  'sajjalashree',
    staging:     'sajjalashree_staging',
    development: 'sajjalashree_dev'
  }[process.env.NODE_ENV] || 'sajjalashree_dev';

  const folder = `${folderPrefix}/${fieldname}`;
  const baseFilename = `${fieldname}-${Date.now()}${crypto.randomBytes(6).toString('hex')}`;

  let resType = 'auto';
  if (file.mimetype === 'application/pdf') resType = 'raw';
  else if (file.mimetype && file.mimetype.startsWith('image/')) resType = 'image';

  // PRIVATE fields — Aadhaar only
  // Photo and certificate are public
  const privateFields = ['aadhar', 'aadhar_front', 'aadhar_back'];
  const isPrivate = privateFields.includes(fieldname);
  const uploadType = isPrivate ? 'authenticated' : 'upload';

  console.log(`Uploading ${fieldname} as type: ${uploadType}`);

  const result = await new Promise((resolve, reject) => {
    const uploadOptions = {
      folder,
      public_id:     baseFilename,
      resource_type: resType,
      type:          uploadType
    };

    // For authenticated image uploads — set expired access control
    if (isPrivate && resType === 'image') {
      uploadOptions.access_control = [{
        access_type: 'anonymous',
        end:         '1970-01-01'
      }];
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error(`Cloudinary upload error for ${fieldname}:`, error);
          reject(error);
        } else {
          console.log(`Cloudinary upload success: ${result.public_id} type: ${result.type}`);
          resolve(result);
        }
      }
    );

    if (!file.buffer || file.buffer.length === 0) {
      reject(new Error('File buffer is empty'));
      return;
    }

    uploadStream.end(file.buffer);
  });

  return result;
};

function handleUpload(req, res, next) {
    upload.fields(CAREER_FILE_FIELDS)(req, res, (err) => {
        if (err) return next(err);
        next();
    });
}

app.post('/upload-file', upload.any(), async (req, res, next) => {
    try {
        console.log('=== /upload-file called ===');

        // upload.any() puts files in req.files array
        const file = req.files && req.files.length > 0 ? req.files[0] : null;

        console.log('File received:', file ? {
            fieldname:  file.fieldname,
            mimetype:   file.mimetype,
            originalname: file.originalname,
            bufferSize: file.buffer?.length
        } : 'NO FILE');
        console.log('NODE_ENV:', process.env.NODE_ENV);

        if (!file) {
            console.error('No file in request');
            return res.status(400).json({
                success: false,
                error: 'No file provided'
            });
        }

        // Accept all valid fieldnames including new ones
        const validFieldnames = [
            'photo',
            'aadhar_front',
            'aadhar_back',
            'certificate'
        ];

        console.log('Received fieldname:', file.fieldname);

        if (!validFieldnames.includes(file.fieldname)) {
            console.error('Invalid fieldname:', file.fieldname);
            return res.status(400).json({
                success: false,
                error: `Invalid file field: ${file.fieldname}`
            });
        }

        console.log('Starting Cloudinary upload for:', file.fieldname);
        const result = await uploadToCloudinarySync(file);
        console.log('Cloudinary upload result:', {
            public_id:     result.public_id,
            resource_type: result.resource_type,
            type:          result.type,
            secure_url:    result.secure_url
        });

        return res.status(200).json({
            success: true,
            cloudinaryPublicId: result.public_id,
            url:          result.secure_url,
            resourceType: result.resource_type,
            fieldname:    file.fieldname,
            originalExt:  path.extname(file.originalname || '').toLowerCase()
        });
    } catch (err) {
        console.error('=== /upload-file ERROR ===');
        console.error('Error message:', err.message);
        console.error('Error stack:', err.stack);
        next(err);
    }
});

app.delete('/upload-file/:publicId', async (req, res) => {
    let publicId = req.params.publicId;
    try {
        publicId = decodeURIComponent(publicId);
    } catch (decodeErr) {
        console.error('Failed to decode Cloudinary public_id:', decodeErr.message);
    }

    try {
        await Promise.all(['image', 'raw'].map(resourceType =>
            cloudinary.uploader.destroy(publicId, {
                resource_type: resourceType,
                type: 'authenticated'
            })
        ));
    } catch (destroyErr) {
        console.error('Cloudinary delete failed in /upload-file:', destroyErr.message);
    }

    return res.json({ success: true });
});

async function handleCareerApplicationApply(req, res, next) {
    try {
        const idempotencyKey = req.headers['idempotency-key'];
        if (!idempotencyKey) {
            return res.status(400).json({ success: false, error: 'Missing idempotency key' });
        }
        if (idempotencyStore.has(idempotencyKey)) {
            const cached = idempotencyStore.get(idempotencyKey);
            if (cached.status === 'processing') {
                return res.status(409).json({ success: false, error: 'Application is currently processing', phase: 'database' });
            }
            return res.status(cached.status).json(cached.response);
        }

        // Lock idempotency key immediately to prevent concurrent duplicates
        idempotencyStore.set(idempotencyKey, {
            status: 'processing',
            timestamp: Date.now()
        });

        const {
            name,
            email,
            phone,
            experience,
            message,
            photo_public_id,
            aadhar_front_public_id,    // new — replaces aadhar_public_id
            aadhar_back_public_id,     // new
            certificate_public_id,
            photo_filename,
            aadhar_front_filename,     // new
            aadhar_back_filename,      // new
            certificate_filename,
            emergency_contact_name,    // new
            emergency_contact_phone,   // new
            emergency_contact_relation // new
        } = req.body || {};

        const trimmedName = typeof name === 'string' ? name.trim() : '';
        const trimmedEmail = typeof email === 'string' ? email.trim() : '';
        const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
        const trimmedExperience = String(experience || '').trim();
        const trimmedMessage = typeof message === 'string' ? message.trim() : '';
        const emailValid = /^([\w-.]+)@([\w-]+)\.([a-zA-Z]{2,})$/.test(trimmedEmail);
        const phoneValid = /^\d{10}$/.test(trimmedPhone);

        if (
            !trimmedName ||
            !emailValid ||
            !phoneValid ||
            !trimmedExperience ||
            !trimmedMessage ||
            !photo_public_id ||
            !aadhar_front_public_id ||  // new
            !aadhar_back_public_id      // new
            // certificate optional
            // emergency contact optional
        ) {
            idempotencyStore.delete(idempotencyKey);
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                phase: 'validation'
            });
        }

        const verifyCloudinaryFile = async (publicId, resourceType, uploadType) => {
          if (!publicId) return false;
          try {
            await cloudinary.api.resource(publicId, {
              resource_type: resourceType || 'image',
              type:          uploadType   || 'upload'
            });
            console.log(`Verified: ${publicId}`);
            return true;
          } catch (e) {
            console.log(`Verify failed: ${publicId} — ${e.message}`);
            return false;
          }
        };

        const verifyAnyType = async (publicId) => {
          if (!publicId) return false;

          // Try authenticated (Aadhaar)
          if (await verifyCloudinaryFile(publicId, 'image', 'authenticated')) return true;

          // Try public upload (photo, certificate)
          if (await verifyCloudinaryFile(publicId, 'image', 'upload')) return true;

          // Try raw authenticated (old PDF certificates)
          if (await verifyCloudinaryFile(publicId, 'raw', 'authenticated')) return true;

          // Try raw upload
          if (await verifyCloudinaryFile(publicId, 'raw', 'upload')) return true;

          return false;
        };

        const [photoExists, aadharFrontExists, aadharBackExists, certExists] =
            await Promise.all([
                verifyAnyType(photo_public_id),
                verifyAnyType(aadhar_front_public_id),
                verifyAnyType(aadhar_back_public_id),
                certificate_public_id
                    ? verifyAnyType(certificate_public_id)
                    : Promise.resolve(true)
            ]);

        if (!photoExists || !aadharFrontExists || !aadharBackExists) {
            idempotencyStore.delete(idempotencyKey);
            return res.status(422).json({
                success: false,
                error: 'One or more files are missing. Please re-upload.',
                phase: 'verify',
                missing: {
                    photo:        !photoExists,
                    aadhar_front: !aadharFrontExists,
                    aadhar_back:  !aadharBackExists,
                    certificate:  !certExists
                }
            });
        }

        const rollbackCloudinaryUploads = async (publicIds) => {
            await Promise.all(
                publicIds.filter(Boolean).map(({ id, type }) =>
                    // Try both image and raw for robustness (aadhar can be either)
                    Promise.all(['image', 'raw']
                        .filter(rt => !type || rt === type)
                        .map(rt =>
                            cloudinary.uploader.destroy(id, { resource_type: rt, type: 'authenticated' })
                                .catch(e => console.error('Cloudinary rollback failed for', id, rt, e))
                        )
                    )
                )
            );
        };

        let connection;
        try {
            connection = await db.getConnection();
        } catch (dbConnErr) {
            console.error('DB connection failed in /apply:', dbConnErr.message);
            idempotencyStore.delete(idempotencyKey);
            // ER_ACCESS_DENIED_ERROR — likely IP not whitelisted in Hostinger
            if (dbConnErr.code === 'ER_ACCESS_DENIED_ERROR') {
                return res.status(503).json({
                    success: false,
                    error: 'Database temporarily unavailable. Please try again in a moment.',
                    phase: 'db_connect'
                });
            }
            return next(dbConnErr);
        }

        let applicationId = 'APP-' + Date.now();

        try {
            await connection.beginTransaction();

            const safeAadharFrontFilename = sanitizeUploadedFilename(
                aadhar_front_filename || getFilenameFromPublicId(aadhar_front_public_id)
            );
            const safeAadharBackFilename = sanitizeUploadedFilename(
                aadhar_back_filename || getFilenameFromPublicId(aadhar_back_public_id)
            );
            const safeCertificateFilename = sanitizeUploadedFilename(
                certificate_filename || getFilenameFromPublicId(certificate_public_id)
            );
            const safePhotoFilename = sanitizeUploadedFilename(
                photo_filename || getFilenameFromPublicId(photo_public_id)
            );

            // Trim emergency contact fields safely
            const trimmedEmergencyName     = typeof emergency_contact_name === 'string'
                ? emergency_contact_name.trim() : null;
            const trimmedEmergencyPhone    = typeof emergency_contact_phone === 'string'
                ? emergency_contact_phone.trim() : null;
            const trimmedEmergencyRelation = typeof emergency_contact_relation === 'string'
                ? emergency_contact_relation.trim() : null;

            const [result] = await connection.execute(
                `INSERT INTO career_applications
                    (full_name, email, phone,
                     aadhar_front, aadhar_back,
                     photo, message, experience_years, certificate,
                     emergency_contact_name,
                     emergency_contact_phone,
                     emergency_contact_relation)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    trimmedName,
                    trimmedEmail,
                    trimmedPhone,
                    safeAadharFrontFilename,
                    safeAadharBackFilename,
                    safePhotoFilename,
                    trimmedMessage,
                    trimmedExperience,
                    safeCertificateFilename || null,
                    trimmedEmergencyName    || null,
                    trimmedEmergencyPhone   || null,
                    trimmedEmergencyRelation || null
                ]
            );

            applicationId = result.insertId || applicationId;
            await connection.commit();
        } catch (dbErr) {
            await connection.rollback().catch(rollbackErr => console.error('MySQL rollback failed:', rollbackErr));

            await rollbackCloudinaryUploads([
                { id: photo_public_id },
                { id: aadhar_front_public_id },
                { id: aadhar_back_public_id },
                { id: certificate_public_id }
            ]);

            console.error('FAILED_APPLICATION_BACKUP:', JSON.stringify({
                timestamp: new Date().toISOString(),
                name: trimmedName,
                email: trimmedEmail,
                phone: trimmedPhone,
                experience: trimmedExperience,
                message: trimmedMessage,
                photo_public_id,
                aadhar_front_public_id,
                aadhar_back_public_id,
                certificate_public_id
            }));

            // Don't cache 503s so client retries will actually hit the DB again
            idempotencyStore.delete(idempotencyKey);

            return res.status(503).json({
                success: false,
                error: 'Database error. Please retry.',
                phase: 'database'
            });
        } finally {
            connection.release();
        }

        const successResponse = { success: true, message: 'Application submitted successfully' };
        idempotencyStore.set(idempotencyKey, {
            status: 200,
            response: successResponse,
            timestamp: Date.now()
        });
        res.status(200).json(successResponse);

        // Process emails asynchronously in the background so they don't block the frontend
        Promise.all([
            sendApplicantEmail(trimmedName, trimmedEmail, applicationId),
            sendAdminEmail({
                name: trimmedName,
                email: trimmedEmail,
                phone: trimmedPhone,
                experience: trimmedExperience,
                message: trimmedMessage
            })
        ]).catch(emailErr => {
            console.error('Application email phase failed:', emailErr);
        });


    } catch (e) {
        if (req.headers['idempotency-key']) {
            idempotencyStore.delete(req.headers['idempotency-key']);
        }
        next(e);
    }
}

app.post('/apply', async (req, res, next) => {
    return handleCareerApplicationApply(req, res, next);
})

app.put('/admin/update-status/:id', authenticateToken, async (req, res, next) => {
    try {
        const { status } = req.body
        const { id } = req.params
        const sqlUpdateQuery = 'UPDATE career_applications SET status=? WHERE id=?'
        await db.query(sqlUpdateQuery, [status, id])
        res.status(200).json({ success: true, message: 'Status updated successfully' })
    }
    catch (e) {
        next(e)
    }

})

app.delete('/admin/applications/:id', authenticateToken, async (req, res, next) => {

    try {
        const { id } = req.params
        const sqlDeleteQuery = 'DELETE FROM career_applications WHERE id=?'
        await db.query(sqlDeleteQuery, [id])
        res.json({ success: true, message: 'Delete successful' })
    }
    catch (e) {
        next(e)
    }
})

app.post('/call-back', async (req, res, next) => {
    try {
        const { phone } = req.body;

        if (!phone || !/^\+?[\d\s\-().]{7,15}$/.test(phone.trim())) {
            return res.status(400).json({ success: false, message: 'Invalid phone number format.' });
        }

        const { sendCallBackEmail } = require('./config/email');
        // Fix 12: Wrap sendCallBackEmail in try/catch; SMTP failure must not crash or fail the route
        let emailSent = false;
        try {
            emailSent = await sendCallBackEmail(phone.trim());
        } catch (smtpErr) {
            console.error('SMTP error in /call-back:', smtpErr);
        }

        res.status(200).json({ success: true, message: 'Call back request sent successfully!' });
    } catch (error) {
        next(error);
    }
});

app.post('/admin/forgot-password', otpLimiter, async (req, res, next) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ success: false, message: 'Username or Email required' });

        // Find admin by username or email
        const [admin] = await db.query('SELECT id, email, name FROM admins WHERE username = ? OR email = ?', [username, username]);
        if (!admin || admin.length === 0) {
            // Generic message to prevent username enumeration
            return res.json({ success: true, message: 'If an account exists, a reset code has been sent.' });
        }

        const adminEmail = admin[0].email;
        if (!adminEmail) {
            return res.status(400).json({ success: false, message: 'No email associated with this account.' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        // 15-minute expiry
        const expiry = new Date(Date.now() + 15 * 60 * 1000);

        // Save OTP to DB
        await db.query('UPDATE admins SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?', [otp, expiry, admin[0].id]);

        // ✅ Respond IMMEDIATELY — don't make user wait for Resend
        res.json({ success: true, message: 'If an account exists, a reset code has been sent.' });

        // Send OTP email in background (non-blocking)
        const { sendPasswordResetOtpEmail } = require('./config/email');
        sendPasswordResetOtpEmail(adminEmail, admin[0].name, otp)
            .then(() => console.log(`[OTP] Email sent to ${adminEmail}`))
            .catch(err => console.error('[OTP] Email send failed:', err.message, err?.response?.body || ''));

    } catch (e) {
        next(e);
    }
});

app.post('/admin/verify-otp', otpLimiter, async (req, res, next) => {
    try {
        const { username, otp } = req.body;
        if (!username || !otp) return res.status(400).json({ success: false, message: 'Username and OTP required' });

        const [admin] = await db.query('SELECT id, reset_otp, reset_otp_expiry FROM admins WHERE username = ? OR email = ?', [username, username]);
        if (!admin || admin.length === 0) return res.status(400).json({ success: false, message: 'Invalid OTP' });

        const record = admin[0];
        if (!record.reset_otp || record.reset_otp !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }

        if (new Date(record.reset_otp_expiry) < new Date()) {
            return res.status(400).json({ success: false, message: 'OTP has expired' });
        }

        res.json({ success: true, message: 'OTP verified successfully' });
    } catch (e) {
        next(e);
    }
});

app.post('/admin/reset-password', otpLimiter, async (req, res, next) => {
    try {
        const { username, otp, newPassword } = req.body;
        if (!username || !otp || !newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: 'Invalid request parameters' });

        const [admin] = await db.query('SELECT id, reset_otp, reset_otp_expiry FROM admins WHERE username = ? OR email = ?', [username, username]);
        if (!admin || admin.length === 0) return res.status(400).json({ success: false, message: 'Invalid OTP' });

        const record = admin[0];
        if (!record.reset_otp || record.reset_otp !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }

        if (new Date(record.reset_otp_expiry) < new Date()) {
            return res.status(400).json({ success: false, message: 'OTP has expired' });
        }

        const encryptedPassword = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE admins SET password = ?, reset_otp = NULL, reset_otp_expiry = NULL WHERE id = ?', [encryptedPassword, record.id]);

        res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
    } catch (e) {
        next(e);
    }
});

// NOTE: Global error handler moved to end of file (after ALL routes)

app.post('/admin/newAdmin', authenticateToken, async (req, res) => {
    try {
        const { name, username, email, password, role } = req.body
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" })
        }
        const encrptedPassword = await bcrypt.hash(password, 10)
        const newAdminQuery = 'INSERT INTO admins (name,username,email,password,role) VALUES (?,?,?,?,?)'
        await db.query(newAdminQuery, [name, username, email, encrptedPassword, role])
        res.status(200).json({ success: true, message: "New Admin added successfully" })
    }
    catch (e) {
        res.status(500).json({ success: false, message: e.message })
    }
})

app.post('/admin/login', async (req, res) => {
    try {
        const { username, password, remember } = req.body

        const [user] = await db.query('SELECT * FROM admins WHERE username=?', [username])

        if (user && user.length > 0) {
            const validPassword = await bcrypt.compare(password, user[0].password)
            if (validPassword) {
                // Determine expiry based on "remember"
                const expiresInSeconds = remember ? 30 * 24 * 3600 : 86400; // 30 days or 1 day

                // Generate JWT token
                const token = generateToken({
                    id: user[0].id,
                    username: user[0].username,
                    name: user[0].name,
                    role: user[0].role
                }, expiresInSeconds);

                res.status(200).json({
                    success: true,
                    message: 'Login Success',
                    token: token,
                    username: user[0].username,
                    email: user[0].email,
                    name: user[0].name,
                    role: user[0].role,
                    expiresIn: expiresInSeconds
                })

            }
            else {
                res.status(400).json({ success: false, message: 'Wrong password' })
            }
        }
        else {
            res.status(400).json({ success: false, message: 'User not Found' })
        }
    }
    catch (e) {
        res.status(400).json({ success: false, message: 'Failed to login try again' })
        console.log(e.message)
    }
})

const { startBackupScheduler } = require('./config/backup');

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`)
    startBackupScheduler();
})

// Global error-handling middleware — MUST be after ALL routes
// FIX 5 — Safe error messages: never expose stack/internals in production
app.use((err, req, res, next) => {
    console.error('Global error:', err);
    const status = err.status || 500;
    res.status(status).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
            ? 'Something went wrong. Please try again.'
            : err.message
    });
});

// FIX 4 — Unhandled rejection & uncaught exception handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
