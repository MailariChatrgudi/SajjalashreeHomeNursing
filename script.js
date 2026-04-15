

document.addEventListener('DOMContentLoaded', function () {


      const loader = document.getElementById("loader");
      const popContent = document.getElementById("popupContent");


      window.onload = function () {
            setTimeout(function () {
                  document.getElementById("enquiryPopup").style.display = "flex";
            }, 3000);

      };

      // Close popup
      window.closePopup = function () {
            document.getElementById("enquiryPopup").style.display = "none";
      }


      // MY form 


      const textValidator = {
            name: (value) => value.length < 3 ? '*Name must be at least 3 characters' : '',
            email: (value) => (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) ? '*Invalid email' : '',
            phone: (value) => (!value || !/^\+?[\d\s\-().]{7,15}$/.test(value.trim())) ? '*Phone must be 10 digits' : '',
            experience: (value) => {
                  const exp = parseFloat(value);
                  return (isNaN(exp) || exp < 0 || exp > 50) ? '*Please enter valid experience (0–50 years)' : '';
            },
            message: (value) => !value.trim() ? '*Message cannot be empty' : '',
      }

      const showError = (erorrId, message) => {
            const el = document.getElementById(erorrId);
            if (!el) return
            el.textContent = message
            el.style.display = message ? 'flex' : 'none'
      }

      const fileValidator = {
            photo: { types: ["image/jpeg", "image/png"] },
            aadhar: { types: ["image/jpeg", "image/png", 'application/pdf'] },
            certificate: { types: ['application/pdf'] }
      }

      const errorId = {
            name: 'nameErorrMsg',
            phone: 'phoneErorrMsg',
            email: 'emailErorrMsg',
            experience: 'expErorrMsg',
            message: 'msgErorrMsg',
            photo: 'PhotoErorrMsg',
            aadhar: 'aadharErorrMsg',
            certificate: 'cetificateErorrMsg',
      }
      const formInputValidation = (input) => {
            const inputType = input.name

            if (textValidator[inputType]) {
                  const errorMsg = textValidator[inputType](input.value)
                  showError(errorId[inputType], errorMsg)
                  return !errorMsg
            }

            if (fileValidator[inputType]) {
                  const file = input.files[0]
                  if (!file) return true

                  const { types } = fileValidator[inputType]

                  if (!types.includes(file.type)) {
                        showError(errorId[inputType], '*Invalid file type')
                        input.value = ''
                        return false
                  }
                  if (file.size > 5 * 1024 * 1024) {
                        showError(errorId[inputType], '*File size must be less than 5MB')
                        input.value = ''
                        return false
                  }

                  showError(errorId[inputType], '');
                  return true;
            }

      }
      const fieldEvents = {
            name: 'input', phone: 'input', email: 'blur',
            experience: 'blur', message: 'blur',
            photo: 'change', aadhar: 'change', certificate: 'change',
      };

      const setupCharCounter = (inputId, counterId, max = 500) => {
            const input = document.getElementById(inputId);
            const counter = document.getElementById(counterId);
            if (!input || !counter) return;

            input.addEventListener('input', () => {
                  const remaining = max - input.value.length;
                  counter.textContent = `${input.value.length}/${max}`;
                  counter.style.color = remaining < 50 ? 'red' : 'gray';
            });
      };

      setupCharCounter('message', 'messageCounter', 500);



      // Toast notification system
      const showToast = (message, type = 'success') => {
            const toastContainer = document.getElementById('toastContainer');

            const toast = document.createElement('div');
            toast.className = `toast-notification toast-${type}`;
            toast.innerHTML = `
            <div class="toast-message">
                  <span class="toast-icon">${type === 'success' ? '✓' : '✕'}</span>
                  <span class="toast-text">${message}</span>
            </div>
      `;

            toastContainer.appendChild(toast);

            // Animate in
            setTimeout(() => toast.classList.add('show'), 10);

            // Auto remove after 5 seconds
            setTimeout(() => {
                  toast.classList.remove('show');
                  setTimeout(() => toast.remove(), 300);
            }, 5000);
      };

      const careerForm = document.getElementById('career-form');

      careerForm.addEventListener('submit', async (e) => {

            const btn = document.getElementById('submitBtn');
            btn.disabled = true;
            // Add spinner animation
            const originalBtnHTML = btn.innerHTML;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Submitting...`;

            e.preventDefault();

            const fields = ['name', 'phone', 'email', 'experience', 'message', 'photo', 'aadhar', 'certificate'];
            let isFormValid = true;

            fields.forEach(id => {
                  const el = document.getElementById(id)
                  if (el && !formInputValidation(el)) {
                        isFormValid = false
                        btn.disabled = false;
                        btn.textContent = 'Submit Application';
                  }
            })

            if (isFormValid) {
                  try {
                        const formData = new FormData(careerForm)

                        // Retry logic for network issues (Render cold starts, flaky mobile)
                        let response;
                        let lastError;
                        const MAX_RETRIES = 2;

                        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                              try {
                                    if (attempt > 0) {
                                          btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span>Retrying (${attempt}/${MAX_RETRIES})...`;
                                    }

                                    const controller = new AbortController();
                                    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

                                    response = await fetch('/apply', {
                                          method: 'POST',
                                          body: formData,
                                          signal: controller.signal
                                    });
                                    clearTimeout(timeout);
                                    break; // Success — exit retry loop

                              } catch (err) {
                                    lastError = err;
                                    if (attempt < MAX_RETRIES) {
                                          // Wait before retry (1s, then 2s)
                                          await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
                                    }
                              }
                        }

                        if (!response) {
                              throw lastError || new Error('Network request failed');
                        }

                        const data = await response.json()
                        if (data.success) {
                              showToast("✅ Application submitted successfully! Check your email for confirmation.", 'success');
                              careerForm.reset()
                              // Clear all field error messages
                              fields.forEach(id => {
                                    const errorId = {
                                          name: 'nameErorrMsg',
                                          phone: 'phoneErorrMsg',
                                          email: 'emailErorrMsg',
                                          experience: 'expErorrMsg',
                                          message: 'msgErorrMsg',
                                          photo: 'PhotoErorrMsg',
                                          aadhar: 'aadharErorrMsg',
                                          certificate: 'cetificateErorrMsg',
                                    }[id];
                                    if (errorId) showError(errorId, '');
                              })
                        } else if (data.errors) {

                              let errorList = [];
                              Object.entries(data.errors).forEach(([field, msg]) => {

                                    const eid = errorId[field];
                                    if (eid) showError(eid, msg);
                                    errorList.push(msg);
                              });

                              showToast('✕ ' + errorList.join(' | '), 'error');
                        } else {

                              const errorMsg = data.message || 'Submission failed. Please try again.';
                              showToast("✕ " + errorMsg, 'error');
                        }
                  } catch (err) {
                        if (err.name === 'AbortError') {
                              showToast("⏱️ Upload timed out. Please check your internet connection and try again.", 'error');
                        } else {
                              showToast("❌ Network error. Please check your connection and try again.", 'error');
                        }
                        console.error(err.message)

                  } finally {
                        btn.disabled = false;
                        btn.innerHTML = originalBtnHTML;
                  }
            }
      })
      // --- General Enquiry Form Handler ---
      const generalEnquiryForm = document.getElementById('enquiry-form');
      if (generalEnquiryForm) {
            generalEnquiryForm.addEventListener('submit', async (e) => {
                  e.preventDefault();
                  const btn = generalEnquiryForm.querySelector('button[type="submit"]');
                  if (btn) {
                        btn.disabled = true;
                        const originalBtnHTML = btn.innerHTML;
                        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Submitting...`;
                  }
                  const from_name = generalEnquiryForm.from_name.value.trim();
                  const from_email = generalEnquiryForm.from_email.value.trim();
                  const phone = generalEnquiryForm.phone.value.trim();
                  try {
                        const response = await fetch('/enquiry', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ from_name, from_email, phone })
                        });
                        const data = await response.json();
                        if (data.success) {
                              showToast('✅ Enquiry submitted successfully!', 'success');
                              generalEnquiryForm.reset();
                        } else if (data.errors) {
                              showToast('✕ ' + Object.values(data.errors).join(' | '), 'error');
                        } else {
                              showToast('✕ ' + (data.message || 'Submission failed.'), 'error');
                        }
                  } catch (err) {
                        showToast('❌ Network error. Please try again.', 'error');
                  } finally {
                        if (btn) {
                              btn.disabled = false;
                              btn.innerHTML = 'Submit';
                        }
                  }
            });
      }

      // --- Product Enquiry Forms Handler ---
      const productEnquiryForms = document.querySelectorAll("form[id$='-enquiry'][data-product]");
      productEnquiryForms.forEach(form => {
            form.addEventListener('submit', async (e) => {
                  e.preventDefault();
                  const btn = form.querySelector('button[type="submit"]');
                  if (btn) {
                        btn.disabled = true;
                        const originalBtnHTML = btn.innerHTML;
                        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Submitting...`;
                  }
                  const product_name = form.getAttribute('data-product') || '';
                  const from_name = form.from_name.value.trim();
                  const phone = form.phone.value.trim();
                  try {
                        const response = await fetch('/product-enquiry', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ product_name, from_name, phone })
                        });
                        const data = await response.json();
                        if (data.success) {
                              showToast('✅ Product enquiry submitted successfully!', 'success');
                              form.reset();
                        } else if (data.errors) {
                              showToast('✕ ' + Object.values(data.errors).join(' | '), 'error');
                        } else {
                              showToast('✕ ' + (data.message || 'Submission failed.'), 'error');
                        }
                  } catch (err) {
                        showToast('❌ Network error. Please try again.', 'error');
                  } finally {
                        if (btn) {
                              btn.disabled = false;
                              btn.innerHTML = 'Submit';
                        }
                  }
            });
      });

      // --- Call Back Form Handler (Popup) ---
      const callBackForm = document.querySelector('#enquiryPopup form');
      if (callBackForm) {
            callBackForm.addEventListener('submit', async (e) => {
                  e.preventDefault();
                  const btn = document.getElementById('callBtn');
                  const phoneInput = document.getElementById('mobileNo');
                  const phone = phoneInput.value.trim();

                  if (!phone || !/^\+?[\d\s\-().]{7,15}$/.test(phone)) {
                        showToast('✕ Please enter a valid phone number', 'error');
                        return;
                  }

                  if (btn) {
                        btn.disabled = true;
                        btn.textContent = 'Sending...';
                  }

                  try {
                        const response = await fetch('/call-back', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ phone })
                        });
                        const data = await response.json();

                        if (data.success) {
                              showToast('✅ Call back request sent!', 'success');
                              callBackForm.reset();
                              setTimeout(() => closePopup(), 1500);
                        } else {
                              showToast('✕ ' + (data.message || 'Request failed.'), 'error');
                        }
                  } catch (err) {
                        showToast('❌ Network error. Please try again.', 'error');
                  } finally {
                        if (btn) {
                              btn.disabled = false;
                              btn.textContent = 'Call me back';
                        }
                  }
            });
      }
});
