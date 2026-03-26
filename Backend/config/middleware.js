const multer = require('multer')
const path = require('path')
const crypto = require('crypto')

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.fieldname === 'photo') {
      cb(null, path.join(__dirname, "../public/uploads/photos"))
    }
    else if (file.fieldname === 'aadhar') {
      cb(null, path.join(__dirname, "../public/uploads/aadhar"))
    }
    else if (file.fieldname === 'certificate') {
      cb(null, path.join(__dirname, "../public/uploads/certificate"))
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = `${Date.now()}${crypto.randomBytes(6).toString('hex')}`
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    let allowedExt;
    if (file.fieldname === 'certificate') {
      allowedExt = /pdf/
    }
    else if (file.fieldname === 'photo') {
      allowedExt = /jpeg|jpg|png/;
    }
    else {
      allowedExt = /jpeg|jpg|pdf|png/;
    }
    const ext = allowedExt.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedExt.test(file.mimetype)

    if (ext && mime) {
      cb(null, true)
    }
    else {
      cb(new Error("Only images or PDF allowed and size below 5MB"))
    }
  }
})

module.exports = upload