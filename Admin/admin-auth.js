/* ================================================================
   ADMIN AUTH JS — Form Validation & Handling
   Login & Register form logic with validation
   ================================================================ */

// Auto-detect backend URL
const AUTH_API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://sajjalashreehomenursing.onrender.com';


/**
 * Check if user is authenticated and token is still valid
 */
function isUserAuthenticated() {
    const token = localStorage.getItem('adminToken');
    const expiry = localStorage.getItem('adminTokenExpiry');

    if (!token || !expiry) {
        return false;
    }

    const currentTime = new Date().getTime();

    // Check if token has expired (24 hours)
    if (currentTime > parseInt(expiry)) {
        // Token expired - clear localStorage
        clearUserSession();
        return false;
    }

    return true;
}

/**
 * Clear user session
 */
function clearUserSession() {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminTokenExpiry');
    localStorage.removeItem('adminUsername');
    localStorage.removeItem('adminName');
    localStorage.removeItem('adminRole');
}

/**
 * Redirect to login if not authenticated
 */
function redirectIfNotAuthenticated() {
    if (!isUserAuthenticated()) {
        localStorage.clear();
        window.location.href = 'admin-login.html';
    }
}

/**
 * Toggle password visibility
 */
function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const icon = event.target.closest('.toggle-password').querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

/**
 * Check password strength
 */
function checkPasswordStrength(event) {
    const password = event.target.value;
    const strengthBar = document.getElementById('strengthBar');
    const strengthText = document.getElementById('strengthText');

    let strength = 0;

    // Length check
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;

    // Lowercase check
    if (/[a-z]/.test(password)) strength++;

    // Uppercase check
    if (/[A-Z]/.test(password)) strength++;

    // Number check
    if (/[0-9]/.test(password)) strength++;

    // Special character check
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) strength++;

    // Update strength bar
    strengthBar.classList.remove('weak', 'medium', 'strong');
    strengthText.classList.remove('weak', 'medium', 'strong');

    if (password.length === 0) {
        strengthBar.classList.remove('weak', 'medium', 'strong');
        strengthText.textContent = '';
    } else if (strength < 3) {
        strengthBar.classList.add('weak');
        strengthText.classList.add('weak');
        strengthText.textContent = 'Weak password';
    } else if (strength < 5) {
        strengthBar.classList.add('medium');
        strengthText.classList.add('medium');
        strengthText.textContent = 'Medium password';
    } else {
        strengthBar.classList.add('strong');
        strengthText.classList.add('strong');
        strengthText.textContent = 'Strong password';
    }
}

/**
 * Validate Login Form
 */
function validateLoginForm() {
    const username = document.getElementById('username');
    const password = document.getElementById('password');

    let isValid = true;

    // Reset errors
    hideError('usernameError');
    hideError('passwordError');

    // Username validation
    if (username.value.trim() === '') {
        showError('usernameError', 'Username is required');
        isValid = false;
    } else if (username.value.trim().length < 3) {
        showError('usernameError', 'Username must be at least 3 characters');
        isValid = false;
    }

    // Password validation
    if (password.value === '') {
        showError('passwordError', 'Password is required');
        isValid = false;
    } else if (password.value.length < 6) {
        showError('passwordError', 'Password must be at least 6 characters');
        isValid = false;
    }

    return isValid;
}

/**
 * Show error message
 */
function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.classList.add('show');

        // Add error styling to input
        const inputId = elementId.replace('Error', '');
        const input = document.getElementById(inputId);
        if (input) {
            const wrapper = input.closest('.input-wrapper');
            if (wrapper) {
                wrapper.classList.add('error');
            }
        }
    }
}

/**
 * Hide error message
 */
function hideError(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = '';
        element.classList.remove('show');

        // Remove error styling from input
        const inputId = elementId.replace('Error', '');
        const input = document.getElementById(inputId);
        if (input) {
            const wrapper = input.closest('.input-wrapper');
            if (wrapper) {
                wrapper.classList.remove('error');
            }
        }
    }
}

/**
 * Handle Login Form Submit
 */
async function handleLoginSubmit(event) {
    event.preventDefault();

    // Validate form
    if (!validateLoginForm()) {
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const remember = document.querySelector('input[name="remember"]').checked;

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner"></i><span>Signing in...</span>';

    try {
        // Make API call to login
        const response = await fetch(`${AUTH_API_BASE}/admin/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: username,
                password: password,
                remember: remember
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Login successful - Store token with respective expiry
            const loginTime = new Date().getTime();
            const expiryTime = loginTime + (data.expiresIn * 1000);

            localStorage.setItem('adminToken', data.token);
            localStorage.setItem('adminTokenExpiry', expiryTime);
            localStorage.setItem('adminUsername', data.username);
            localStorage.setItem('adminName', data.name);
            localStorage.setItem('adminRole', data.role);

            showSuccessMessage('Login successful! Redirecting...');
            setTimeout(() => {
                window.location.href = 'dashboard.html';

            }, 1500);
        } else {
            // Login failed
            showError('passwordError', data.message || 'Invalid credentials');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('passwordError', 'An error occurred. Please try again.');
    } finally {
        // Reset button state
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        submitBtn.innerHTML = originalText;
    }
}

/**
 * Handle Register Form Submit
 */
async function handleRegisterSubmit(event) {
    event.preventDefault();

    // Validate form
    if (!validateRegisterForm()) {
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const fullname = document.getElementById('fullname').value.trim();
    const email = document.getElementById('email').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner"></i><span>Creating account...</span>';

    try {
        // Make API call to register
        const response = await fetch('/api/admin/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fullname: fullname,
                email: email,
                username: username,
                password: password
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Registration successful
            showSuccessMessage('Account created successfully! Redirecting to login...');
            setTimeout(() => {
                window.location.href = 'admin-login.html';
            }, 1500);
        } else {
            // Registration failed
            if (data.field === 'email') {
                showError('emailError', data.message || 'Email already exists');
            } else if (data.field === 'username') {
                showError('usernameError', data.message || 'Username already exists');
            } else {
                showError('passwordError', data.message || 'Registration failed');
            }
        }
    } catch (error) {
        console.error('Registration error:', error);
        showError('passwordError', 'An error occurred. Please try again.');
    } finally {
        // Reset button state
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        submitBtn.innerHTML = originalText;
    }
}

/**
 * Show success message
 */
function showSuccessMessage(message) {
    // Create a simple success notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #10b981;
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        font-weight: 500;
        animation: slideUp 0.3s ease-out;
        z-index: 1000;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

/**
 * Real-time validation for input fields
 */
document.addEventListener('DOMContentLoaded', function () {
    // Add real-time validation listeners
    const usernameInput = document.getElementById('username');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');

    if (usernameInput) {
        usernameInput.addEventListener('blur', function () {
            if (this.value.trim() === '') {
                showError('usernameError', 'Username is required');
            } else if (this.value.trim().length < 3) {
                showError('usernameError', 'Username must be at least 3 characters');
            } else {
                hideError('usernameError');
            }
        });

        usernameInput.addEventListener('input', function () {
            if (this.value.trim().length >= 3) {
                hideError('usernameError');
            }
        });
    }

    if (emailInput) {
        emailInput.addEventListener('blur', function () {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (this.value.trim() === '') {
                showError('emailError', 'Email is required');
            } else if (!emailRegex.test(this.value)) {
                showError('emailError', 'Please enter a valid email address');
            } else {
                hideError('emailError');
            }
        });

        emailInput.addEventListener('input', function () {
            hideError('emailError');
        });
    }

    if (passwordInput && !confirmPasswordInput) {
        // Login form - password validation
        passwordInput.addEventListener('blur', function () {
            if (this.value === '') {
                showError('passwordError', 'Password is required');
            } else if (this.value.length < 6) {
                showError('passwordError', 'Password must be at least 6 characters');
            } else {
                hideError('passwordError');
            }
        });
    }

    if (confirmPasswordInput) {
        // Register form - confirm password validation
        confirmPasswordInput.addEventListener('blur', function () {
            if (this.value === '') {
                showError('confirmPasswordError', 'Please confirm your password');
            } else if (passwordInput.value !== this.value) {
                showError('confirmPasswordError', 'Passwords do not match');
            } else {
                hideError('confirmPasswordError');
            }
        });

        confirmPasswordInput.addEventListener('input', function () {
            if (passwordInput.value === this.value) {
                hideError('confirmPasswordError');
            }
        });
    }
});

/**
 * Validate Add User Form (Admin Only)
 */
function validateAddUserForm() {
    const fullname = document.getElementById('fullname');
    const email = document.getElementById('email');
    const username = document.getElementById('username');
    const password = document.getElementById('password');
    const confirmPassword = document.getElementById('confirmPassword');
    const role = document.getElementById('role');

    let isValid = true;

    // Reset all errors
    hideError('fullnameError');
    hideError('emailError');
    hideError('usernameError');
    hideError('passwordError');
    hideError('confirmPasswordError');
    hideError('roleError');

    // Full Name validation
    if (fullname && fullname.value.trim() === '') {
        showError('fullnameError', 'Full name is required');
        isValid = false;
    } else if (fullname && fullname.value.trim().length < 3) {
        showError('fullnameError', 'Full name must be at least 3 characters');
        isValid = false;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && email.value.trim() === '') {
        showError('emailError', 'Email is required');
        isValid = false;
    } else if (email && !emailRegex.test(email.value)) {
        showError('emailError', 'Please enter a valid email address');
        isValid = false;
    }

    // Username validation
    if (username && username.value.trim() === '') {
        showError('usernameError', 'Username is required');
        isValid = false;
    } else if (username && username.value.trim().length < 3) {
        showError('usernameError', 'Username must be at least 3 characters');
        isValid = false;
    } else if (username && !/^[a-zA-Z0-9_-]+$/.test(username.value)) {
        showError('usernameError', 'Username can only contain letters, numbers, _ and -');
        isValid = false;
    }

    // Password validation
    if (password && password.value === '') {
        showError('passwordError', 'Password is required');
        isValid = false;
    } else if (password && password.value.length < 8) {
        showError('passwordError', 'Password must be at least 8 characters');
        isValid = false;
    }

    // Confirm Password validation
    if (confirmPassword && confirmPassword.value === '') {
        showError('confirmPasswordError', 'Please confirm your password');
        isValid = false;
    } else if (confirmPassword && password && password.value !== confirmPassword.value) {
        showError('confirmPasswordError', 'Passwords do not match');
        isValid = false;
    }

    // Role validation
    if (role && role.value === '') {
        showError('roleError', 'Please select a role');
        isValid = false;
    }

    return isValid;
}

/**
 * Handle Add User Form Submit (Admin Only)
 */
async function handleAddUserSubmit(event) {
    event.preventDefault();

    // Validate form
    if (!validateAddUserForm()) {
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const fullname = document.getElementById('fullname').value.trim();
    const email = document.getElementById('email').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;
    const adminToken = localStorage.getItem('adminToken');

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner"></i><span>Creating admin...</span>';

    try {
        // Make API call to add new admin (requires authentication)
        const response = await fetch(`${AUTH_API_BASE}/admin/newAdmin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + adminToken
            },
            body: JSON.stringify({
                name: fullname,
                username: username,
                email: email,
                password: password,
                role: role
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Success
            showSuccessMessage('Admin account created successfully!');
            setTimeout(() => {
                document.getElementById('addUserForm').reset();
                window.location.href = 'dashboard.html';
            }, 1500);
        } else {
            // Error
            if (data.field === 'email') {
                showError('emailError', data.message || 'Email already exists');
            } else if (data.field === 'username') {
                showError('usernameError', data.message || 'Username already exists');
            } else {
                showError('passwordError', data.message || 'Failed to create admin account');
            }
        }
    } catch (error) {
        console.error('Add user error:', error);
        showError('passwordError', 'An error occurred. Please try again.');
    } finally {
        // Reset button state
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        submitBtn.innerHTML = originalText;
    }
}

/* ================================================================
   Forgot Password Logic
   ================================================================ */

let resetFlowState = {
    username: '',
    otp: ''
};

function switchView(viewId) {
    // Hide all views
    document.querySelectorAll('.view-section').forEach(view => {
        view.classList.add('hidden');
        view.style.display = 'none';
    });

    // Reset forms
    if (viewId === 'loginView') {
        resetFlowState = { username: '', otp: '' };
        document.getElementById('forgotPasswordForm')?.reset();
        document.getElementById('otpForm')?.reset();
        document.getElementById('resetPasswordForm')?.reset();
    }

    // Show target view
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.remove('hidden');
        target.style.display = 'block';
    }
}

async function handleForgotPasswordSubmit(event) {
    event.preventDefault();

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const username = document.getElementById('resetUsername').value.trim();

    if (!username) {
        showError('resetUsernameError', 'Username or email is required');
        return;
    }

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner"></i><span>Sending code...</span>';

    try {
        const response = await fetch(`${AUTH_API_BASE}/admin/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });

        const data = await response.json();

        if (response.ok) {
            resetFlowState.username = username;
            // Switch immediately — server already responded (email is sending in bg)
            switchView('otpView');
            // Show helpful notice so user knows email may take a moment
            _showOtpNotice();
            _startResendCountdown(username);
        } else {
            showError('resetUsernameError', data.message || 'Failed to send reset code');
        }
    } catch (error) {
        showError('resetUsernameError', 'An error occurred. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        submitBtn.innerHTML = originalText;
    }
}

/** Show info notice on OTP view */
function _showOtpNotice() {
    const container = document.getElementById('otpView');
    if (!container) return;
    let notice = document.getElementById('_otpDelayNotice');
    if (!notice) {
        notice = document.createElement('p');
        notice.id = '_otpDelayNotice';
        notice.style.cssText = 'font-size:13px;color:#6b7280;text-align:center;margin:8px 0 4px;line-height:1.5;';
        // Insert before the first form element
        const form = container.querySelector('form') || container;
        form.insertAdjacentElement('beforebegin', notice);
    }
    notice.innerHTML = '📧 A 6-digit code has been sent to your email.<br><span style="color:#9ca3af;font-size:12px;">It may take up to 1–2 minutes to arrive. Check your spam folder too.</span>';
}

/** 60-second resend countdown */
let _resendTimer = null;
function _startResendCountdown(username) {
    // Clear any existing timer
    if (_resendTimer) { clearInterval(_resendTimer); _resendTimer = null; }

    let container = document.getElementById('otpView');
    if (!container) return;

    // Create or reuse resend button row
    let resendRow = document.getElementById('_resendRow');
    if (!resendRow) {
        resendRow = document.createElement('div');
        resendRow.id = '_resendRow';
        resendRow.style.cssText = 'text-align:center;margin:12px 0 4px;';
        const form = container.querySelector('form');
        if (form) form.insertAdjacentElement('afterend', resendRow);
        else container.appendChild(resendRow);
    }

    let seconds = 60;
    resendRow.innerHTML = `<span id="_resendCountdown" style="font-size:13px;color:#9ca3af;">Resend code in <b>${seconds}s</b></span>`;

    _resendTimer = setInterval(() => {
        seconds--;
        const el = document.getElementById('_resendCountdown');
        if (seconds > 0) {
            if (el) el.innerHTML = `Resend code in <b>${seconds}s</b>`;
        } else {
            clearInterval(_resendTimer);
            _resendTimer = null;
            if (resendRow) {
                resendRow.innerHTML = '<button type="button" id="_resendBtn" style="background:none;border:none;color:#4f46e5;font-size:13px;cursor:pointer;text-decoration:underline;padding:0;">↺ Resend code</button>';
                const btn = document.getElementById('_resendBtn');
                if (btn) btn.addEventListener('click', async () => {
                    btn.textContent = 'Sending…';
                    btn.disabled = true;
                    try {
                        await fetch(`${AUTH_API_BASE}/admin/forgot-password`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username })
                        });
                    } catch (_) {}
                    _startResendCountdown(username);
                });
            }
        }
    }, 1000);
}



async function handleOtpSubmit(event) {
    event.preventDefault();

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const otp = document.getElementById('resetOtp').value.trim();

    if (!otp || otp.length !== 6) {
        showError('resetOtpError', 'Please enter a valid 6-digit code');
        return;
    }

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner"></i><span>Verifying...</span>';

    try {
        const response = await fetch(`${AUTH_API_BASE}/admin/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: resetFlowState.username, otp })
        });

        const data = await response.json();

        if (response.ok) {
            showSuccessMessage('Code verified!');
            resetFlowState.otp = otp;
            setTimeout(() => switchView('resetPasswordView'), 1000);
        } else {
            showError('resetOtpError', data.message || 'Invalid code');
        }
    } catch (error) {
        showError('resetOtpError', 'An error occurred. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        submitBtn.innerHTML = originalText;
    }
}

async function handleResetPasswordSubmit(event) {
    event.preventDefault();

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;

    hideError('newPasswordError');
    hideError('confirmNewPasswordError');

    if (!newPassword || newPassword.length < 8) {
        showError('newPasswordError', 'Password must be at least 8 characters');
        return;
    }

    if (newPassword !== confirmPassword) {
        showError('confirmNewPasswordError', 'Passwords do not match');
        return;
    }

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner"></i><span>Updating...</span>';

    try {
        const response = await fetch(`${AUTH_API_BASE}/admin/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: resetFlowState.username,
                otp: resetFlowState.otp,
                newPassword: newPassword
            })
        });

        const data = await response.json();

        if (response.ok) {
            showSuccessMessage('Password reset successfully! Redirecting...');
            setTimeout(() => {
                switchView('loginView');
            }, 1500);
        } else {
            showError('newPasswordError', data.message || 'Failed to update password');
        }
    } catch (error) {
        showError('newPasswordError', 'An error occurred. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        submitBtn.innerHTML = originalText;
    }
}

