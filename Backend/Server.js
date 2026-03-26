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

app.get('/admin/file/:folder/:filename', verifyAdmin, async (req, res, next) => {
    try {
        const { folder, filename } = req.params;

        if (!ALLOWED_UPLOAD_FOLDERS.has(folder)) {
            return res.status(400).json({ success: false, message: 'Invalid folder' })
        }

        // Block traversal attempts like ../../secret or nested paths
        if (!filename || filename !== path.basename(filename) || filename.includes('..')) {
            return res.status(400).json({ success: false, message: 'Invalid filename' })
        }

        const allowedDir = path.resolve(UPLOADS_ROOT, folder);
        const filePath = path.resolve(allowedDir, filename);

        // Ensure resolved path is inside the allowed folder (prevents traversal)
        if (!filePath.startsWith(allowedDir + path.sep)) {
            return res.status(400).json({ success: false, message: 'Invalid path' })
        }

        await fs.promises.access(filePath, fs.constants.R_OK);
        return res.sendFile(filePath);
    } catch (e) {
        if (e && (e.code === 'ENOENT' || e.code === 'EACCES')) {
            return res.status(404).json({ success: false, message: 'File not found' })
        }
        next(e)
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
            certificatePath = certificate.filename;
        }

        // If any errors, return 400
        if (Object.keys(errors).length > 0) {
            return res.status(400).json({ success: false, errors });
        }

        const photoPath = files.photo[0].filename;
        const aadharPath = files.aadhar[0].filename;

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

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`)
})
