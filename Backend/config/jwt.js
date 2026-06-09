const jwt = require('jsonwebtoken');
const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.development';
require('dotenv').config({ path: require('path').resolve(__dirname, '../', envFile) });

// Secret key for JWT - Store in .env in production
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Generate JWT Token
 * @param {Object} payload - Data to encode in token
 * @param {number} expiresIn - Token expiry time in seconds (default: 24 hours)
 * @returns {string} JWT token
 */
function generateToken(payload, expiresIn = 86400) {
  try {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
  } catch (error) {
    console.error('Token generation error:', error.message);
    throw new Error('Failed to generate token');
  }
}

/**
 * Verify JWT Token
 * @param {string} token - JWT token to verify
 * @returns {Object} Decoded token payload
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    throw error;
  }
}

/**
 * Middleware to verify JWT token
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  try {
    const decoded = verifyToken(token);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: error.message || 'Invalid or expired token'
    });
  }
}

module.exports = {
  generateToken,
  verifyToken,
  authenticateToken,
  JWT_SECRET
};
