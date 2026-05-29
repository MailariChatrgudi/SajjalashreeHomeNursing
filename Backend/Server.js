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

require('dotenv').config();
const app = express();

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
const uploadDirs = ['photos', 'aadhar', 'certificate'];
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
    ? process.env.FRONTEND_URL   // production: restrict to domain only
    : true,                       // development: allow all (localhost)
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
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
const ALLOWED_UPLOAD_FOLDERS = new Set(['photos', 'aadhar', 'certificate']);
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

        // Reconstruct the Cloudinary public_id
        let fieldname = folder;
        if (folder === 'photos') fieldname = 'photo';

        const ext = path.extname(filename).toLowerCase();
        const format = ext ? ext.replace('.', '') : '';
        const baseFilename = filename.split('.')[0];
        const public_id = `sajjalashree/${fieldname}/${baseFilename}`;
        const isPdf = format === 'pdf';

        // 1) Try local file first
        const allowedDir = path.resolve(UPLOADS_ROOT, folder);
        const filePath = path.resolve(allowedDir, filename);
        try {
            await fs.promises.access(filePath, fs.constants.R_OK);
            if (isPdf) {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
            }
            return res.sendFile(filePath);
        } catch {
            // Local file not found, try Cloudinary
        }

        // 2) Try Cloudinary using private_download_url (properly signed)
        const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 min expiry

        const getClient = (url) => url.startsWith('http://') ? require('http') : require('https');

        const streamFromUrl = (url, cb) => {
            getClient(url).get(url, (cloudinaryRes) => {
                // Follow one redirect
                if (cloudinaryRes.statusCode >= 300 && cloudinaryRes.statusCode < 400 && cloudinaryRes.headers.location) {
                    getClient(cloudinaryRes.headers.location).get(cloudinaryRes.headers.location, (rr) => {
                        cb(rr.statusCode === 200 ? rr : null);
                    }).on('error', () => cb(null));
                    return;
                }
                cb(cloudinaryRes.statusCode === 200 ? cloudinaryRes : null);
            }).on('error', () => cb(null));
        };

        // Try as 'image' resource type first (covers files uploaded with resource_type: auto)
        const urlAsImage = cloudinary.utils.private_download_url(public_id, format, {
            resource_type: 'image',
            type: 'authenticated',
            expires_at: expiresAt
        });

        streamFromUrl(urlAsImage, (imageStream) => {
            if (imageStream) {
                if (isPdf) {
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
                } else if (imageStream.headers['content-type']) {
                    res.setHeader('Content-Type', imageStream.headers['content-type']);
                }
                return imageStream.pipe(res);
            }

            // Try as 'raw' resource type. Cloudinary raw/PDF assets may store the
            // extension as part of the public_id, so check both public_id forms.
            const rawUrls = [
                cloudinary.utils.private_download_url(public_id, format, {
                    resource_type: 'raw',
                    type: 'authenticated',
                    expires_at: expiresAt
                })
            ];

            if (isPdf) {
                rawUrls.push(cloudinary.utils.private_download_url(`${public_id}.${format}`, null, {
                    resource_type: 'raw',
                    type: 'authenticated',
                    expires_at: expiresAt
                }));
            }

            const tryRawUrl = (index = 0) => {
                if (index >= rawUrls.length) {
                    return res.status(404).json({ success: false, message: 'File not found' });
                }

                streamFromUrl(rawUrls[index], (rawStream) => {
                    if (rawStream) {
                        const typeMap = { 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png' };
                        if (isPdf) {
                            res.setHeader('Content-Type', 'application/pdf');
                            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
                        } else if (typeMap[format]) {
                            res.setHeader('Content-Type', typeMap[format]);
                        } else if (rawStream.headers['content-type']) {
                            res.setHeader('Content-Type', rawStream.headers['content-type']);
                        }
                        return rawStream.pipe(res);
                    }

                    tryRawUrl(index + 1);
                });
            };

            tryRawUrl();
        });

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
        
        // Wait for the admin email alert to finish and check if it succeeded
        const mailSent = await sendProductEnquiryAlert({ product_name, name: from_name, phone });
        
        if (mailSent) {
            res.status(200).json({ success: true, message: '✅ Product enquiry submitted successfully! (Alert email sent)' });
        } else {
            // Still success because it was saved to the database, but email failed
            res.status(200).json({ success: true, message: '✅ Product enquiry submitted! (But admin email failed)' });
        }
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

    const folder = `sajjalashree/${fieldname}`;

    // Determine extension from original filename to pass back to frontend
    const originalExt = path.extname(file.originalname || '').toLowerCase(); // e.g. '.jpg', '.pdf'
    
    // Cloudinary public_id should NOT include the extension
    const baseFilename = `${fieldname}-${Date.now()}${crypto.randomBytes(6).toString('hex')}`;

    // Always upload as 'raw' regardless of mime type or field.
    // Cloudinary only enforces 'authenticated' access control for raw resources on free tiers.
    // Images uploaded as resource_type:'image' with type:'authenticated' may still be publicly accessible.
    const resType = 'raw';

    // All files are authenticated (private, admin-only)
    const uploadType = 'authenticated';

    // Upload from buffer directly — no disk involved
    const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder,
                public_id: baseFilename,
                resource_type: resType,
                type: uploadType,
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        uploadStream.end(file.buffer); // push buffer directly to Cloudinary
    });

    // No fs.unlink needed — nothing was written to disk
    return result;
};

function handleUpload(req, res, next) {
    upload.fields(CAREER_FILE_FIELDS)(req, res, (err) => {
        if (err) return next(err);
        next();
    });
}

function handleSingleUpload(req, res, next) {
    upload.fields(CAREER_FILE_FIELDS)(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, error: 'Upload failed. Please try again.' });
        next();
    });
}

app.post('/upload-file', handleSingleUpload, async (req, res) => {
    const uploadedFiles = getUploadedFiles(req.files);

    if (uploadedFiles.length !== 1) {
        return res.status(400).json({ success: false, error: 'Upload failed. Please try again.' });
    }

    const file = uploadedFiles[0];

    try {
        const result = await uploadToCloudinarySync(file);
        // Determine actual resource type that was used for this file
        let resourceType = 'image';
        if (file.mimetype === 'application/pdf') resourceType = 'raw';
        else if (file.mimetype && file.mimetype.startsWith('image/')) resourceType = 'image';

        return res.json({
            success: true,
            cloudinaryPublicId: result.public_id,
            url: result.secure_url,
            fieldname: file.fieldname,
            resourceType: resourceType,
            originalExt: path.extname(file.originalname || '').toLowerCase()
        });
    } catch (uploadErr) {
        console.error('Cloudinary upload failed in /upload-file:', uploadErr);
        return res.status(500).json({ success: false, error: 'Upload failed. Please try again.' });
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
            aadhar_public_id,
            certificate_public_id,
            photo_filename,
            aadhar_filename,
            certificate_filename
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
            !aadhar_public_id
        ) {
            idempotencyStore.delete(idempotencyKey);
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                phase: 'validation'
            });
        }

        const verifyCloudinary = async (public_id, resource_type = 'auto') => {
            try {
                await cloudinary.api.resource(public_id, { resource_type, type: 'authenticated' });
                return true;
            } catch (e) {
                return false;
            }
        };

        // Check both types (raw and image) because old files were uploaded as 'image'
        // and new files are always uploaded as 'raw' to enforce authentication.
        const verifyAnyType = async (public_id) => {
            const asRaw = await verifyCloudinary(public_id, 'raw');
            if (asRaw) return true;
            return verifyCloudinary(public_id, 'image');
        };

        const [photoExists, aadharExists, certExists] = await Promise.all([
            verifyAnyType(photo_public_id),
            verifyAnyType(aadhar_public_id),
            certificate_public_id ? verifyAnyType(certificate_public_id) : Promise.resolve(true)
        ]);

        if (!photoExists || !aadharExists || !certExists) {
            idempotencyStore.delete(idempotencyKey);
            return res.status(422).json({
                success: false,
                error: 'One or more files are missing. Please re-upload.',
                phase: 'verify',
                missing: {
                    photo: !photoExists,
                    aadhar: !aadharExists,
                    certificate: !certExists
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

        const connection = await db.getConnection();
        let applicationId = 'APP-' + Date.now();
        try {
            await connection.beginTransaction();

            const safePhotoFilename = sanitizeUploadedFilename(photo_filename || getFilenameFromPublicId(photo_public_id));
            const safeAadharFilename = sanitizeUploadedFilename(aadhar_filename || getFilenameFromPublicId(aadhar_public_id));
            const safeCertificateFilename = sanitizeUploadedFilename(certificate_filename || getFilenameFromPublicId(certificate_public_id));

            const [result] = await connection.execute(
                `INSERT INTO career_applications
                  (full_name, email, phone, aadhar_card, photo, message, experience_years, certificate)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    trimmedName,
                    trimmedEmail,
                    trimmedPhone,
                    safeAadharFilename,
                    safePhotoFilename,
                    trimmedMessage,
                    trimmedExperience,
                    safeCertificateFilename
                ]
            );

            applicationId = result.insertId || applicationId;
            await connection.commit();
        } catch (dbErr) {
            await connection.rollback().catch(rollbackErr => console.error('MySQL rollback failed:', rollbackErr));

            await rollbackCloudinaryUploads([
                { id: photo_public_id },
                { id: aadhar_public_id },
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
                aadhar_public_id,
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

        try {
            await sendApplicantEmail(trimmedName, trimmedEmail, applicationId);
            await sendAdminEmail({
                name: trimmedName,
                email: trimmedEmail,
                phone: trimmedPhone,
                experience: trimmedExperience,
                message: trimmedMessage
            });
        } catch (emailErr) {
            console.error('Application email phase failed:', emailErr);
        }

        const successResponse = { success: true, message: 'Application submitted successfully' };
        idempotencyStore.set(idempotencyKey, {
            status: 200,
            response: successResponse,
            timestamp: Date.now()
        });
        return res.status(200).json(successResponse);
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

        // Send email (we will add this function to email.js next)
        const { sendPasswordResetOtpEmail } = require('./config/email');
        sendPasswordResetOtpEmail(adminEmail, admin[0].name, otp).catch(err => console.error('Failed to send OTP email', err));

        res.json({ success: true, message: 'If an account exists, a reset code has been sent.' });
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
