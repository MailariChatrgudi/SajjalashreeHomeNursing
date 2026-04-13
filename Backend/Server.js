const express = require('express')
const db = require('./config/database');
const upload = require('./config/middleware')
const path = require('path')
const fs = require('fs')
const cors = require('cors');
const bcrypt = require('bcrypt');
const { generateToken, authenticateToken, verifyToken } = require('./config/jwt');
const { sendApplicantEmail, sendAdminEmail, sendGeneralEnquiryAlert, sendProductEnquiryAlert } = require('./config/email');

const rateLimit = require('express-rate-limit');

require('dotenv').config();
const app = express();

// Apply rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

// Ensure upload directories exist (Render starts with empty filesystem)
const uploadDirs = ['photos', 'aadhar', 'certificate'];
uploadDirs.forEach(dir => {
    const dirPath = path.join(__dirname, 'public', 'uploads', dir);
    fs.mkdirSync(dirPath, { recursive: true });
});

app.use(express.json())
app.use(express.static(path.join(__dirname, "../Frontend")))
app.use(express.static(path.join(__dirname, "../Admin")))
app.use(cors())

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

            // Try as 'raw' resource type (covers files uploaded with resource_type: raw)
            const urlAsRaw = cloudinary.utils.private_download_url(public_id, format, {
                resource_type: 'raw',
                type: 'authenticated',
                expires_at: expiresAt
            });

            streamFromUrl(urlAsRaw, (rawStream) => {
                if (rawStream) {
                    if (isPdf) {
                        res.setHeader('Content-Type', 'application/pdf');
                        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
                    } else if (rawStream.headers['content-type']) {
                        res.setHeader('Content-Type', rawStream.headers['content-type']);
                    }
                    return rawStream.pipe(res);
                }

                // Nothing found
                res.status(404).json({ success: false, message: 'File not found' });
            });
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
        // Send admin alert asynchronously
        sendGeneralEnquiryAlert({ name: from_name, email: from_email, phone })
            .catch(err => console.error('Error sending general enquiry alert:', err));
    } catch (e) {
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
        // Send admin alert asynchronously
        sendProductEnquiryAlert({ product_name, name: from_name, phone })
            .catch(err => console.error('Error sending product enquiry alert:', err));
    } catch (e) {
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

app.post('/apply', upload.fields([{ name: 'aadhar', maxCount: 1 }, { name: 'photo', maxCount: 1 }, { name: 'certificate', maxCount: 1 }]), async (req, res, next) => {
    try {
        const { name, phone, email, experience, message } = req.body;
        const files = req.files || {};
        const errors = {};

        // Name validation
        if (!name || typeof name !== 'string' || name.trim().length < 3 || !/^[a-zA-Z\s]+$/.test(name.trim())) {
            errors.name = 'Name must be at least 3 letters and contain only letters and spaces.';
        }
        // Email validation
        if (!email || !/^([\w-.]+)@([\w-]+)\.([a-zA-Z]{2,})$/.test(email.trim())) {
            errors.email = 'Invalid email address.';
        }
        // Phone validation
        if (!phone || !/^\+?[\d\s\-().]{10,15}$/.test(phone.trim())) {
            errors.phone = 'Phone must be 10-15 digits.';
        }
        // Experience validation
        const exp = parseFloat(experience);
        if (isNaN(exp) || exp < 0 || exp > 50) {
            errors.experience = 'Experience must be a number between 0 and 50.';
        }
        // Message validation
        if (!message || typeof message !== 'string' || message.trim().length < 5) {
            errors.message = 'Message must be at least 5 characters.';
        }
        // File validations
        // Photo
        if (!files.photo || !files.photo[0]) {
            errors.photo = 'Photo is required.';
        } else {
            const photo = files.photo[0];
            if (!['image/jpeg', 'image/png'].includes(photo.mimetype)) {
                errors.photo = 'Photo must be a JPG or PNG image.';
            }
            if (photo.size > 5 * 1024 * 1024) {
                errors.photo = 'Photo must be less than 5MB.';
            }
        }
        // Aadhar
        if (!files.aadhar || !files.aadhar[0]) {
            errors.aadhar = 'Aadhar is required.';
        } else {
            const aadhar = files.aadhar[0];
            if (!['image/jpeg', 'image/png', 'application/pdf'].includes(aadhar.mimetype)) {
                errors.aadhar = 'Aadhar must be JPG, PNG, or PDF.';
            }
            if (aadhar.size > 5 * 1024 * 1024) {
                errors.aadhar = 'Aadhar file must be less than 5MB.';
            }
        }
        // Helper to strip Cloudinary folder prefix and preserve extension
        const getBaseNameWithExt = (fileObj) => {
            if (!fileObj) return '';
            const base = fileObj.filename.split('/').pop();
            const ext = path.extname(fileObj.originalname);
            return base.includes('.') ? base : base + ext;
        };

        // Certificate (optional)
        let certificatePath = '';
        if (files.certificate && files.certificate[0]) {
            const certificate = files.certificate[0];
            if (certificate.mimetype !== 'application/pdf') {
                errors.certificate = 'Certificate must be a PDF.';
            }
            if (certificate.size > 5 * 1024 * 1024) {
                errors.certificate = 'Certificate file must be less than 5MB.';
            }
            certificatePath = getBaseNameWithExt(certificate);
        }

        // If any errors, return 400
        if (Object.keys(errors).length > 0) {
            return res.status(400).json({ success: false, errors });
        }

        const photoPath = getBaseNameWithExt(files.photo[0]);
        const aadharPath = getBaseNameWithExt(files.aadhar[0]);

        const sqlPostQuery = 'INSERT INTO career_applications (full_name,email,phone,aadhar_card,photo,message,experience_years,certificate) VALUE (?,?,?,?,?,?,?,?)';
        const result = await db.query(sqlPostQuery, [name.trim(), email.trim(), phone.trim(), aadharPath, photoPath, message.trim(), exp, certificatePath]);

        // Get the inserted ID
        const applicationId = result[0].insertId || 'APP-' + Date.now();

        // Respond to client immediately
        res.status(200).json({ success: true, message: 'Application submitted successfully! Check your email for confirmation.' });

        // Send emails asynchronously (do not await)
        sendApplicantEmail(name, email, applicationId)
            .catch(err => console.error('Error sending applicant email:', err));
        sendAdminEmail({ name, email, phone, experience: exp, message })
            .catch(err => console.error('Error sending admin email:', err));

        // Trigger background upload to Cloudinary
        const uploadToCloudinaryBackground = async (uploadFiles) => {
            const uploadFile = async (fileArray) => {
                if (!fileArray || !fileArray[0]) return;
                const file = fileArray[0];
                try {
                    let fieldname = file.fieldname;
                    if (fieldname === 'photos') fieldname = 'photo';
                    const baseFilename = file.filename.split('.')[0];
                    const folder = `sajjalashree/${fieldname}`;

                    let resType = 'auto';
                    if (file.mimetype === 'application/pdf') {
                        resType = 'raw';
                    } else if (file.mimetype && file.mimetype.startsWith('image/')) {
                        resType = 'image';
                    }

                    await cloudinary.uploader.upload(file.path, {
                        folder: folder,
                        public_id: baseFilename,
                        type: 'authenticated',
                        resource_type: resType
                    });

                    // Cleanup local file after successful upload to save space
                    await fs.promises.unlink(file.path).catch(e => console.error('Failed to unlink local file:', e));
                } catch (err) {
                    console.error('Cloudinary background upload error:', err);
                }
            };

            await Promise.all([
                uploadFile(uploadFiles.photo),
                uploadFile(uploadFiles.aadhar),
                uploadFile(uploadFiles.certificate)
            ]);
        };
        uploadToCloudinaryBackground(files);

    } catch (e) {
        next(e);
    }
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
        const emailSent = sendCallBackEmail(phone.trim());

        if (emailSent) {
            res.status(200).json({ success: true, message: 'Call back request sent successfully!' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to send call back request. Please try again later.' });
        }
    } catch (error) {
        next(error);
    }
});

app.post('/admin/forgot-password', async (req, res, next) => {
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

app.post('/admin/verify-otp', async (req, res, next) => {
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

app.post('/admin/reset-password', async (req, res, next) => {
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

// Global error-handling middleware — must be LAST
app.use((err, req, res, next) => {
    console.error('Server error:', err.message)
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error'
    })
})

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

    // Keep Render alive — ping every 14 min (free tier sleeps after 15 min)
    if (process.env.RENDER) {
        const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `https://sajjalashreehomenursing.onrender.com`;
        setInterval(() => {
            require('https').get(RENDER_URL, (res) => {
                console.log(`[Keep-Alive] Pinged ${RENDER_URL} — Status: ${res.statusCode}`);
            }).on('error', (err) => {
                console.error('[Keep-Alive] Ping failed:', err.message);
            });
        }, 14 * 60 * 1000); // 14 minutes
        console.log('[Keep-Alive] Auto-ping started — every 14 minutes');
    }
})
