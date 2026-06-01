const nodemailer = require('nodemailer');
require('dotenv').config();

// Gmail configuration - Use environment variables
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  family: 4
});

/**
 * Send confirmation email to applicant
 */
async function sendApplicantEmail(applicantName, applicantEmail, applicationId) {
  try {
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: applicantEmail,
      subject: 'Application Received - Nursing Service',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; border-bottom: 3px solid #4f46e5; padding-bottom: 10px;">Application Confirmation</h2>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6;">Dear <strong>${applicantName}</strong>,</p>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6;">
              Thank you for submitting your application to Nursing Service. We have successfully received your application.
            </p>
            
            <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #4f46e5; margin: 20px 0;">
              <p style="margin: 5px 0; color: #666;"><strong>Application ID:</strong> ${applicationId}</p>
              <p style="margin: 5px 0; color: #666;"><strong>Submitted Date:</strong> ${new Date().toLocaleDateString('en-IN')}</p>
              <p style="margin: 5px 0; color: #666;"><strong>Status:</strong> <span style="color: #f59e0b; font-weight: bold;">Pending Review</span></p>
            </div>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6;">
              Our team will review your application and get back to you shortly. We appreciate your interest in Nursing service.
            </p>
            
            <p style="color: #999; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              Best regards,<br>
              <strong>Nursing service Team</strong><br>
              <small>This is an automated email. Please do not reply to this message.</small>
            </p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Applicant email sent to ${applicantEmail}`);
    return true;
  } catch (error) {
    console.error('Error sending applicant email:', error.message);
    return false;
  }
}

/**
 * Send notification email to admin
 */
async function sendAdminEmail(applicantData) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: adminEmail,
      subject: `New Application Received: ${applicantData.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; border-bottom: 3px solid #10b981; padding-bottom: 10px;">New Application Alert</h2>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6;">A new application has been submitted.</p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr style="background-color: #f9f9f9;">
                <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Name</td>
                <td style="padding: 10px; border: 1px solid #ddd; color: #555;">${applicantData.name}</td>
              </tr>
              <tr>
                <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Email</td>
                <td style="padding: 10px; border: 1px solid #ddd; color: #555;">${applicantData.email}</td>
              </tr>
              <tr style="background-color: #f9f9f9;">
                <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Phone</td>
                <td style="padding: 10px; border: 1px solid #ddd; color: #555;">${applicantData.phone}</td>
              </tr>
              <tr>
                <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Experience</td>
                <td style="padding: 10px; border: 1px solid #ddd; color: #555;">${applicantData.experience} years</td>
              </tr>
              <tr style="background-color: #f9f9f9;">
                <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Submission Date</td>
                <td style="padding: 10px; border: 1px solid #ddd; color: #555;">${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN')}</td>
              </tr>
            </table>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6;">
              <strong>Message from Applicant:</strong><br>
              ${applicantData.message || 'No message provided'}
            </p>
            
            <div style="background-color: #e8f5e9; padding: 15px; border-left: 4px solid #10b981; margin: 20px 0;">
              <p style="margin: 0; color: #2e7d32; font-weight: bold;">
                ✓ Application Details Attached
              </p>
            </div>
            
            <p style="color: #999; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              Log in to your admin panel to review the application.<br>
              <small>This is an automated email from Nursing Service System.</small>
            </p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Admin email sent to ${adminEmail}`);
    return true;
  } catch (error) {
    console.error('Error sending admin email:', error.message);
    return false;
  }
}

/**
 * Send admin alert for general enquiry
 */
async function sendGeneralEnquiryAlert(enquiry) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: adminEmail,
      subject: `New General Enquiry from ${enquiry.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; border-bottom: 3px solid #10b981; padding-bottom: 10px;">New General Enquiry</h2>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Name</td><td style="padding: 10px; border: 1px solid #ddd; color: #555;">${enquiry.name}</td></tr>
              <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Email</td><td style="padding: 10px; border: 1px solid #ddd; color: #555;">${enquiry.email}</td></tr>
              <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Phone</td><td style="padding: 10px; border: 1px solid #ddd; color: #555;">${enquiry.phone}</td></tr>
              <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Date</td><td style="padding: 10px; border: 1px solid #ddd; color: #555;">${new Date().toLocaleString('en-IN')}</td></tr>
            </table>
            <p style="color: #999; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              Log in to your admin panel to review the enquiry.<br>
              <small>This is an automated email from Nursing Service System.</small>
            </p>
          </div>
        </div>
      `
    };
    await transporter.sendMail(mailOptions);
    console.log(`General enquiry alert sent to ${adminEmail}`);
    return true;
  } catch (error) {
    console.error('Error sending general enquiry alert:', error.message);
    return false;
  }
}

/**
 * Send admin alert for product enquiry
 */
async function sendProductEnquiryAlert(enquiry) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: adminEmail,
      subject: `Product Enquiry: ${enquiry.product_name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; border-bottom: 3px solid #10b981; padding-bottom: 10px;">Product Enquiry Alert</h2>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Product</td><td style="padding: 10px; border: 1px solid #ddd; color: #555;">${enquiry.product_name}</td></tr>
              <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Name</td><td style="padding: 10px; border: 1px solid #ddd; color: #555;">${enquiry.name}</td></tr>
              <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Phone</td><td style="padding: 10px; border: 1px solid #ddd; color: #555;">${enquiry.phone}</td></tr>
              <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">Date</td><td style="padding: 10px; border: 1px solid #ddd; color: #555;">${new Date().toLocaleString('en-IN')}</td></tr>
            </table>
            <p style="color: #999; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              Log in to your admin panel to review the product enquiry.<br>
              <small>This is an automated email from Nursing Service System.</small>
            </p>
          </div>
        </div>
      `
    };
    await transporter.sendMail(mailOptions);
    console.log(`Product enquiry alert sent to ${adminEmail}`);
    return true;
  } catch (error) {
    console.error('Error sending product enquiry alert:', error.message);
    return false;
  }
}

/**
 * Send Password Reset OTP Email to Admin
 */
async function sendPasswordResetOtpEmail(adminEmail, adminName, otp) {
  try {
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: adminEmail,
      subject: 'Password Reset Verification Code - Nursing Service',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; border-bottom: 3px solid #f59e0b; padding-bottom: 10px;">Password Reset Request</h2>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6;">Hello <strong>${adminName || 'Admin'}</strong>,</p>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6;">
              We received a request to reset your admin portal password. Please use the following One-Time Password (OTP) to proceed.
            </p>
            
            <div style="background-color: #f9f9f9; padding: 20px; text-align: center; border-radius: 6px; margin: 30px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #4f46e5;">${otp}</span>
            </div>
            
            <p style="color: #555; font-size: 14px; line-height: 1.6;">
              <i style="color: #ef4444;">This code will expire in 15 minutes.</i> If you did not request a password reset, please ignore this email or contact your system administrator.
            </p>
            
            <p style="color: #999; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              Secure System Administrator<br>
              <strong>Nursing Service Team</strong>
            </p>
          </div>
        </div>
      `
    };
    await transporter.sendMail(mailOptions);
    console.log(`Password reset OTP sent to ${adminEmail}`);
    return true;
  } catch (error) {
    console.error('Error sending password reset OTP email:', error.message);
    return false;
  }
}

/**
 * Send Call Back Request to Admin
 */
async function sendCallBackEmail(phone) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.warn("No ADMIN_EMAIL configured in environment. Skipping Call Back email.");
      return false;
    }

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: adminEmail,
      subject: 'New Call Back Request - Sajjalashree',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; border-bottom: 3px solid #10b981; padding-bottom: 10px;">URGENT: Call Back Requested</h2>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6;">A user on your website has requested a call back.</p>
            
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #10b981;">
              <p style="margin: 0; font-size: 16px;">
                <strong style="color: #333; display: inline-block; width: 150px;">Phone Number:</strong>
                <a href="tel:${phone}" style="color: #4f46e5; text-decoration: none; font-weight: bold; font-size: 18px;">${phone}</a>
              </p>
            </div>
            
            <p style="text-align: center; margin-top: 30px;">
              <a href="tel:${phone}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Call Now</a>
            </p>
          </div>
        </div>
      `
    };
    await transporter.sendMail(mailOptions);
    console.log(`Call back request email sent to admin for phone: ${phone}`);
    return true;
  } catch (error) {
    console.error('Error sending call back email:', error.message);
    return false;
  }
}

module.exports = {
  sendApplicantEmail,
  sendAdminEmail,
  sendGeneralEnquiryAlert,
  sendPasswordResetOtpEmail,
  sendProductEnquiryAlert,
  sendCallBackEmail,
  transporter
};

