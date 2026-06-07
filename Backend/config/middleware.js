const multer = require('multer')
const path = require('path')
const crypto = require('crypto')

const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = multer.memoryStorage();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    let allowedExt;

    if (file.fieldname === 'certificate') {
      // Certificate now image only — PDF removed
      allowedExt = /jpeg|jpg|png/;
    } else if (file.fieldname === 'photo') {
      allowedExt = /jpeg|jpg|png/;
    } else if (
      file.fieldname === 'aadhar_front' ||
      file.fieldname === 'aadhar_back'
    ) {
      // Aadhar front and back — images only, no PDF
      allowedExt = /jpeg|jpg|png/;
    } else {
      allowedExt = /jpeg|jpg|png/;
    }

    const ext = allowedExt.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mime = allowedExt.test(file.mimetype);

    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG/PNG images allowed and size below 5MB'));
    }
  }
})

module.exports = upload