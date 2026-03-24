# Email Configuration Guide

This guide explains how to set up Gmail for sending automatic emails when applications are submitted.

## Features

- ✅ Confirmation email sent to applicant
- ✅ Notification email sent to admin
- ✅ Beautiful HTML email templates
- ✅ Application details included in emails

## Setup Instructions

### 1. Get Gmail App Password

Gmail blocked direct password usage for security. You need to create an **App Password**:

1. Go to [myaccount.google.com](https://myaccount.google.com)
2. Click **Security** (left sidebar)
3. Enable **2-Step Verification** (if not already enabled)
4. Scroll down and find **App passwords**
5. Select **Mail** and **Windows Computer** (or your device)
6. Google will generate a 16-character password
7. Copy this password


### 2. Update .env File

Open `Backend/.env` and update:

```env
# Email Configuration (Gmail)
GMAIL_USER='your-email@gmail.com'
GMAIL_PASS='your-16-character-app-password'
ADMIN_EMAIL='admin@example.com'
```

**Example:**
```env
GMAIL_USER='nursing.design.app@gmail.com'
GMAIL_PASS='abcd efgh ijkl mnop'
ADMIN_EMAIL='admin@nursingdesign.com'
```

### 3. Restart Backend Server

```bash
cd Backend
npm start
```

## Testing

Submit an application through the frontend form:
1. Fill in all fields
2. Upload files (Aadhaar, Photo, Certificate)
3. Click "Submit"

**Expected Outcome:**
- ✅ Applicant receives confirmation email
- ✅ Admin receives notification email
- ✅ Application appears in admin dashboard

## Email Templates

### Applicant Email
- Contains: Application ID, submission date, status
- Confirmation message and next steps
- Professional formatted HTML

### Admin Email
- Contains: Applicant details (name, email, phone, experience, message)
- Quick overview table
- Alert notification for new application review

## Troubleshooting

### Emails not sending?

**Check 1:** Gmail credentials in .env
```bash
# Verify GMAIL_USER and GMAIL_PASS are correct
```

**Check 2:** 2-Step Verification enabled
- Go to myaccount.google.com/security
- Verify 2-Step Verification is ON

**Check 3:** App password created correctly
- App password must be exactly 16 characters (with spaces removed)
- Don't use your regular Gmail password

**Check 4:** Check server logs
```bash
# Look for error messages when submitting
npm start
```

**Check 5:** Verify ADMIN_EMAIL is correct
- Should be a valid email address
- Can be different from GMAIL_USER

### "Invalid email address" error
- Ensure GMAIL_USER is a valid Gmail address
- Ensure ADMIN_EMAIL is a valid email

### "Authentication failed" error
- Check GMAIL_PASS is exactly correct (16 chars)
- Regenerate App Password from Google account
- Verify 2-Step Verification is enabled

## Alternative: Use Different Email Service

If you prefer Outlook, Yahoo, or another service, update `config/email.js`:

```javascript
const transporter = nodemailer.createTransport({
  service: 'outlook', // or 'yahoo', 'aol', etc.
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
```

## Security Notes

⚠️ **Never commit .env file to git** - it contains sensitive information

Store credentials securely:
- Don't share GMAIL_PASS
- Use environment variables in production (Heroku, Vercel, etc.)
- Regenerate App Password if compromised

## Production Deployment

For production:
1. Set environment variables on your hosting platform
2. Use a dedicated email service (SendGrid, AWS SES, Mailgun)
3. Consider email rate limits and quotas
4. Use email templates stored in database (optional)

## Support

If emails still don't work:
1. Check Gmail account has 2-Step Verification enabled
2. Generate new App Password
3. Check .env syntax (no extra quotes around values)
4. Restart backend server
5. Check browser console for errors
6. Check server logs for detailed error messages
