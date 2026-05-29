
// Auto-detect backend URL: localhost in dev, Render in production
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? 'http://localhost:3000'
      : 'https://sajjalashreehomenursing.onrender.com';

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

      // === Career Modal State ===
      let careerFormIdempotencyKey = crypto.randomUUID();
      const careerUploadedIds = { photo: null, aadhar: null, certificate: null };
      const careerUploadedTypes = { photo: null, aadhar: null, certificate: null };
      const careerUploadedFilenames = { photo: null, aadhar: null, certificate: null };
      let careerSubmissionConfirmed = false;

      // === Career Modal Helpers ===
      function _careerEsc(s) {
            const d = document.createElement('div');
            d.textContent = s || '';
            return d.innerHTML;
      }

      function openCareerModal(name, email) {
            const ov = document.getElementById('careerSuccessOverlay');
            const card = document.getElementById('careerSuccessCard');
            const body = document.getElementById('careerModalBody');

            // Reset to success view
            body.innerHTML =
                  '<div style="font-size:64px;line-height:1;margin-bottom:16px;animation:careerIconPop 500ms ease forwards;">✅</div>' +
                  '<h2 style="font-family:inherit;font-size:1.45rem;font-weight:700;color:#1a1a2e;margin:0 0 12px;">Application Submitted!</h2>' +
                  '<p id="careerModalText" style="color:#555;font-size:0.93rem;line-height:1.65;margin:0 0 10px;"></p>' +
                  '<p style="color:#777;font-size:0.85rem;margin:0 0 24px;">📧 A confirmation has been sent to your email.</p>' +
                  '<button id="careerModalDoneBtn" type="button" style="background:#28a745;color:#fff;border:none;border-radius:8px;padding:10px 36px;font-size:0.95rem;cursor:pointer;transition:background 150ms;" onmouseover="this.style.background=\'#218838\'" onmouseout="this.style.background=\'#28a745\'">Close</button>';

            document.getElementById('careerModalText').textContent =
                  'Thank you, ' + name + '! We\u2019ve received your application and will be in touch at ' + email + ' within 2\u20133 business days.';

            // Re-attach done button listener (innerHTML destroyed previous one)
            document.getElementById('careerModalDoneBtn').addEventListener('click', handleCareerModalClose);

            // Reset saving status
            const saving = document.getElementById('careerSavingStatus');
            if (saving) { saving.style.display = 'none'; saving.textContent = ''; }

            // Show overlay with animation
            ov.style.display = 'flex';
            requestAnimationFrame(function () {
                  requestAnimationFrame(function () {
                        ov.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                        card.style.opacity = '1';
                  });
            });
      }

      function closeCareerModal() {
            const ov = document.getElementById('careerSuccessOverlay');
            const card = document.getElementById('careerSuccessCard');
            // Reverse animation
            card.style.transform = 'translateY(30px)';
            card.style.opacity = '0';
            ov.style.opacity = '0';
            setTimeout(function () {
                  ov.style.display = 'none';
                  // Show career form again
                  careerForm.style.display = '';
                  // Scroll back to career section
                  var sec = careerForm.closest('section') || careerForm;
                  sec.scrollIntoView({ behavior: 'smooth' });
            }, 300);
      }

      function showCareerSaving(attempt, max) {
            var s = document.getElementById('careerSavingStatus');
            if (!s) return;
            s.textContent = '\u25CF Saving your application\u2026 (attempt ' + attempt + ' of ' + max + ')';
            s.style.display = 'block';
            s.style.animation = 'careerPulse 1.5s ease-in-out infinite';
      }

      function hideCareerSaving() {
            var s = document.getElementById('careerSavingStatus');
            if (s) { s.style.display = 'none'; s.textContent = ''; s.style.animation = ''; }
      }

      function showCareerRecovery(v) {
            var body = document.getElementById('careerModalBody');
            var ts = new Date().toLocaleString('en-IN');
            var subj = encodeURIComponent('Application Recovery \u2014 ' + v.name);
            var mailBody = encodeURIComponent(
                  'Name: ' + v.name + '\nPhone: ' + v.phone + '\nEmail: ' + v.email +
                  '\nExperience: ' + v.experience + '\nMessage: ' + v.message + '\nSubmitted at: ' + ts
            );
            var mailto = 'mailto:sajjalashreehomenursingservices@gmail.com?subject=' + subj + '&body=' + mailBody;

            body.innerHTML =
                  '<div style="font-size:48px;margin-bottom:12px;">⚠️</div>' +
                  '<h2 style="font-family:inherit;font-size:1.15rem;font-weight:700;color:#92400e;margin:0 0 16px;">We received your application but hit a technical issue.</h2>' +
                  '<div style="text-align:left;background:#fef3c7;border-radius:8px;padding:16px 20px;margin:0 0 20px;font-size:0.82rem;color:#78350f;line-height:1.9;font-family:monospace;">' +
                  '<div style="font-weight:700;margin-bottom:6px;">Your submitted details:</div>' +
                  '<div style="border-top:2px solid #d97706;margin:4px 0 8px;"></div>' +
                  'Name&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ' + _careerEsc(v.name) + '<br>' +
                  'Email&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ' + _careerEsc(v.email) + '<br>' +
                  'Phone&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ' + _careerEsc(v.phone) + '<br>' +
                  'Experience&nbsp;: ' + _careerEsc(v.experience) +
                  '<div style="border-top:2px solid #d97706;margin:8px 0 4px;"></div></div>' +
                  '<p style="color:#555;font-size:0.85rem;margin:0 0 16px;">Please screenshot this and email us at:<br><strong>sajjalashreehomenursingservices@gmail.com</strong></p>' +
                  '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
                  '<a href="' + mailto + '" target="_blank" style="display:inline-flex;align-items:center;gap:6px;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:0.9rem;text-decoration:none;cursor:pointer;transition:background 150ms;" onmouseover="this.style.background=\'#1d4ed8\'" onmouseout="this.style.background=\'#2563eb\'">📧 Email Us Now</a>' +
                  '<button id="careerRetryBtn" type="button" style="display:inline-flex;align-items:center;gap:6px;background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:0.9rem;cursor:pointer;transition:background 150ms;" onmouseover="this.style.background=\'#d97706\'" onmouseout="this.style.background=\'#f59e0b\'">🔄 Retry</button></div>';

            hideCareerSaving();

            // Attach retry handler
            document.getElementById('careerRetryBtn').addEventListener('click', function () {
                  openCareerModal(v.name, v.email);
                  submitCareerBackground(v, v._formData);
            });
      }

      function handleCareerModalClose() {
            // Animate modal out
            const overlay = document.getElementById('careerSuccessOverlay');
            if (overlay) {
                  overlay.style.opacity = '0';
                  overlay.style.transition = 'opacity 0.25s ease';
                  setTimeout(() => {
                        overlay.style.display = 'none';
                  }, 250);
            }

            if (careerSubmissionConfirmed) {
                  // ── Reset every input field individually ──
                  // Do NOT rely on careerForm.reset() alone
                  // Explicitly clear each field by ID to guarantee it works
                  document.getElementById('name').value = '';
                  document.getElementById('email').value = '';
                  document.getElementById('phone').value = '';
                  document.getElementById('experience').value = '';
                  document.getElementById('message').value = '';

                  // ── Reset all 3 file inputs ──
                  document.getElementById('resume').value = '';
                  document.getElementById('adhar').value = '';
                  document.getElementById('certificate').value = '';

                  // ── Reset uploaded IDs and types ──
                  careerUploadedIds.photo = null;
                  careerUploadedIds.aadhar = null;
                  careerUploadedIds.certificate = null;
                  careerUploadedTypes.photo = null;
                  careerUploadedTypes.aadhar = null;
                  careerUploadedTypes.certificate = null;
                  careerUploadedFilenames.photo = null;
                  careerUploadedFilenames.aadhar = null;
                  careerUploadedFilenames.certificate = null;

                  // ── Reset all file status indicators to idle ──
                  setFileStatus('photo', 'idle');
                  setFileStatus('aadhar', 'idle');
                  setFileStatus('certificate', 'idle');

                  // ── Uncheck consent checkbox ──
                  const consentCheckbox = document.getElementById('consentSingle');
                  if (consentCheckbox) consentCheckbox.checked = false;

                  // ── Disable submit button again ──
                  const sBtn = document.getElementById('submitBtn');
                  if (sBtn) {
                        sBtn.disabled = true;
                        sBtn.style.opacity = '0.5';
                        sBtn.style.cursor = 'not-allowed';
                  }

                  // ── Clear all inline validation errors ──
                  ['nameErorrMsg', 'phoneErorrMsg', 'emailErorrMsg', 'expErorrMsg', 'msgErorrMsg', 'PhotoErorrMsg', 'aadharErorrMsg', 'cetificateErorrMsg'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                              el.textContent = '';
                              el.style.display = 'none';
                        }
                  });

                  // ── Generate new idempotency key LAST ──
                  // Must be after everything else is reset
                  careerFormIdempotencyKey = crypto.randomUUID();

                  // ── Reset confirmation flag ──
                  careerSubmissionConfirmed = false;

                  // ── Show form again ──
                  const careerFormEl = document.getElementById('career-form');
                  if (careerFormEl) careerFormEl.style.display = '';

                  // ── Scroll back to career section smoothly ──
                  const careerSection = document.getElementById('career');
                  if (careerSection) {
                        setTimeout(() => {
                              careerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 300);
                  }
            }
      }

      // Modal close event listeners
      document.getElementById('careerModalCloseBtn').addEventListener('click', handleCareerModalClose);
      document.getElementById('careerModalDoneBtn').addEventListener('click', handleCareerModalClose);
      document.getElementById('careerSuccessOverlay').addEventListener('click', function (e) {
            if (e.target === e.currentTarget) handleCareerModalClose();
      });
      document.addEventListener('keydown', function (e) {
            var ov = document.getElementById('careerSuccessOverlay');
            if (e.key === 'Escape' && ov && ov.style.display === 'flex') handleCareerModalClose();
      });

      // === Eager File Upload Helpers ===

      // Map: fieldname -> status indicator element ID
      var fileStatusIds = {
            photo: 'uploadStatus_photo',
            aadhar: 'uploadStatus_aadhar',
            certificate: 'uploadStatus_certificate',
      };
      // Map: input element ID -> fieldname
      var inputFieldMap = {
            resume: 'photo',
            adhar: 'aadhar',
            certificate: 'certificate',
      };

      // Create or get the status <p> element below each file input
      function getOrCreateStatusEl(fieldname) {
            var id = fileStatusIds[fieldname];
            var el = document.getElementById(id);
            if (!el) {
                  el = document.createElement('p');
                  el.id = id;
                  el.style.cssText = 'font-size:12px; margin-top:4px; margin-bottom:0;';
                  // Insert after the error message paragraph for this field
                  var errorElId = {
                        photo: 'PhotoErorrMsg',
                        aadhar: 'aadharErorrMsg',
                        certificate: 'cetificateErorrMsg'
                  }[fieldname];
                  var errEl = document.getElementById(errorElId);
                  if (errEl && errEl.parentNode) errEl.parentNode.insertBefore(el, errEl.nextSibling);
            }
            return el;
      }

      function setFileStatus(fieldname, state, filename) {
            var el = getOrCreateStatusEl(fieldname);
            if (!el) return;
            if (state === 'uploading') {
                  el.innerHTML = '<span style="color:#0d6efd;">🔄 Uploading...</span>';
            } else if (state === 'success') {
                  el.innerHTML =
                        '<span style="color:#198754;">✅ ' + (filename || 'File') + ' — Ready</span>' +
                        ' <button type="button" data-field="' + fieldname + '" class="career-change-file-btn" ' +
                        'style="margin-left:8px;font-size:11px;color:#6c757d;background:none;border:1px solid #ccc;' +
                        'border-radius:4px;padding:1px 7px;cursor:pointer;">Change</button>';
                  // Attach Change listener
                  var btn = el.querySelector('.career-change-file-btn');
                  if (btn) btn.addEventListener('click', function () { handleChangeFile(fieldname); });
            } else if (state === 'failed') {
                  el.innerHTML = '<span style="color:#dc3545;">❌ Upload failed. Please re-select.</span>';
            } else {
                  el.innerHTML = '';
            }
      }

      function resetFileStatus(fieldname) {
            setFileStatus(fieldname, 'idle');
            careerUploadedIds[fieldname] = null;
      }

      function updateCareerSubmitButton() {
            var btn = document.getElementById('submitBtn');
            var cb = document.getElementById('consentSingle');
            if (!btn) return;

            var allFilesUploaded = !!(careerUploadedIds.photo && careerUploadedIds.aadhar);
            var isConsentChecked = cb ? cb.checked : false;

            if (allFilesUploaded && isConsentChecked) {
                  btn.disabled = false;
                  btn.style.opacity = '1';
                  btn.style.cursor = 'pointer';
            } else {
                  btn.disabled = true;
                  btn.style.opacity = '0.5';
                  btn.style.cursor = 'not-allowed';
            }
      }

      async function eagerUploadFile(inputEl, fieldname) {
            var file = inputEl.files[0];
            if (!file) return;
            setFileStatus(fieldname, 'uploading');
            careerUploadedIds[fieldname] = null;
            careerUploadedTypes[fieldname] = null;
            careerUploadedFilenames[fieldname] = null;
            updateCareerSubmitButton();
            try {
                  var fd = new FormData();
                  fd.append(fieldname, file, file.name);
                  var res = await fetch(`${API_BASE}/upload-file`, { method: 'POST', body: fd });
                  var data = await res.json();
                  if (data.success && data.cloudinaryPublicId) {
                        careerUploadedIds[fieldname] = data.cloudinaryPublicId;
                        careerUploadedTypes[fieldname] = data.resourceType || 'raw';
                        careerUploadedFilenames[fieldname] = data.cloudinaryPublicId.split('/').pop() + (data.originalExt || '');
                        setFileStatus(fieldname, 'success', file.name);
                  } else {
                        careerUploadedIds[fieldname] = null;
                        careerUploadedTypes[fieldname] = null;
                        careerUploadedFilenames[fieldname] = null;
                        setFileStatus(fieldname, 'failed');
                  }
            } catch (e) {
                  careerUploadedIds[fieldname] = null;
                  careerUploadedTypes[fieldname] = null;
                  careerUploadedFilenames[fieldname] = null;
                  setFileStatus(fieldname, 'failed');
            } finally {
                  updateCareerSubmitButton();
            }
      }

      function handleChangeFile(fieldname) {
            // Save previous public ID in case user cancels
            var prevId = careerUploadedIds[fieldname];
            // Delete old file from Cloudinary (fire-and-forget)
            if (prevId) {
                  fetch(`${API_BASE}/upload-file/` + encodeURIComponent(prevId), { method: 'DELETE' })
                        .catch(function (e) { console.error('Delete old upload failed:', e); });
            }
            // Clear state
            careerUploadedIds[fieldname] = null;
            updateCareerSubmitButton();
            // Find and reset the input
            var inputId = fieldname === 'photo' ? 'resume' : (fieldname === 'aadhar' ? 'adhar' : 'certificate');
            var inputEl = document.getElementById(inputId);
            if (!inputEl) return;
            // Reset status to idle
            setFileStatus(fieldname, 'idle');
            // Reset input value
            inputEl.value = '';
            // Trigger file picker
            inputEl.click();
            // If user cancels (no change event fires within a moment), restore previous state
            var cancelGuard = function () {
                  if (!careerUploadedIds[fieldname] && prevId) {
                        careerUploadedIds[fieldname] = prevId;
                        setFileStatus(fieldname, 'success', inputEl.dataset.lastFileName || 'File');
                        updateCareerSubmitButton();
                  }
                  window.removeEventListener('focus', cancelGuard);
            };
            window.addEventListener('focus', cancelGuard);
      }

      // === Attach eager upload listeners to file inputs ===
      Object.keys(inputFieldMap).forEach(function (inputId) {
            var fieldname = inputFieldMap[inputId];
            var inputEl = document.getElementById(inputId);
            if (!inputEl) return;
            inputEl.addEventListener('change', function () {
                  if (this.files && this.files[0]) {
                        this.dataset.lastFileName = this.files[0].name; // for cancel restore
                        eagerUploadFile(this, fieldname);
                  }
            });
      });

      // === Background submission (Phase 2 only — files already uploaded eagerly) ===
      async function submitCareerBackground(formVals) {
            var MAX = 3;
            careerSubmissionConfirmed = false;

            // Use eagerly-uploaded IDs directly — no Phase 1 needed
            if (!careerUploadedIds.photo || !careerUploadedIds.aadhar || !careerUploadedIds.certificate) {
                  showCareerRecovery(formVals);
                  return;
            }

            // --- Submit application as JSON with Cloudinary public IDs, types, and filenames ---
            var payload = {
                  name: formVals.name,
                  email: formVals.email,
                  phone: formVals.phone,
                  experience: formVals.experience,
                  message: formVals.message,
                  photo_public_id: careerUploadedIds.photo,
                  aadhar_public_id: careerUploadedIds.aadhar,
                  certificate_public_id: careerUploadedIds.certificate,
                  photo_resource_type: careerUploadedTypes.photo || 'raw',
                  aadhar_resource_type: careerUploadedTypes.aadhar || 'raw',
                  certificate_resource_type: careerUploadedTypes.certificate || 'raw',
                  photo_filename: careerUploadedFilenames.photo,
                  aadhar_filename: careerUploadedFilenames.aadhar,
                  certificate_filename: careerUploadedFilenames.certificate
            };

            for (var attempt = 1; attempt <= MAX; attempt++) {
                  showCareerSaving(attempt, MAX);
                  try {
                        var ctrl = new AbortController();
                        var timer = setTimeout(function () { ctrl.abort(); }, 60000);

                        var res = await fetch(`${API_BASE}/apply`, {
                              method: 'POST',
                              headers: {
                                    'Content-Type': 'application/json',
                                    'Idempotency-Key': careerFormIdempotencyKey
                              },
                              body: JSON.stringify(payload),
                              signal: ctrl.signal
                        });
                        clearTimeout(timer);

                        var data = await res.json();

                        if (data.success) {
                              careerSubmissionConfirmed = true;
                              hideCareerSaving();
                              return;
                        }

                        // File verification failure — show form again with highlights
                        if (data.phase === 'verify' && data.missing) {
                              hideCareerSaving();
                              closeCareerModal();
                              careerForm.style.display = '';
                              showToast('Some files could not be verified. Please re-upload the highlighted files.', 'error');
                              if (data.missing.photo) { showError(errorId.photo, 'Please re-upload your photo'); careerUploadedIds.photo = null; setFileStatus('photo', 'idle'); }
                              if (data.missing.aadhar) { showError(errorId.aadhar, 'Please re-upload your Aadhaar'); careerUploadedIds.aadhar = null; setFileStatus('aadhar', 'idle'); }
                              if (data.missing.certificate) { showError(errorId.certificate, 'Please re-upload your certificate'); careerUploadedIds.certificate = null; setFileStatus('certificate', 'idle'); }
                              updateCareerSubmitButton();
                              return;
                        }

                        // Other server error — retry or show recovery
                        if (attempt === MAX) { showCareerRecovery(formVals); return; }

                  } catch (err) {
                        // Network error or timeout — retry or show recovery
                        if (attempt === MAX) { showCareerRecovery(formVals); return; }
                  }

                  // Wait 4 seconds before next retry
                  await new Promise(function (r) { setTimeout(r, 4000); });
            }
      }

      // === Consent Checkbox Event Listener ===
      var submitBtn = document.getElementById('submitBtn');
      var consentSingleCb = document.getElementById('consentSingle');

      if (submitBtn && consentSingleCb) {
            updateCareerSubmitButton();

            consentSingleCb.addEventListener('change', function () {
                  updateCareerSubmitButton();
            });
      }

      // === Career Form Submit Handler ===
      careerForm.addEventListener('submit', async function (e) {
            // Prevent resubmission if already confirmed successful
            if (careerSubmissionConfirmed) {
                  e.preventDefault();
                  return; // modal is still open, ignore this click
            }
            e.preventDefault();

            var btn = document.getElementById('submitBtn');
            btn.disabled = true;
            var originalBtnHTML = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Submitting...';

            var fields = ['name', 'phone', 'email', 'experience', 'message'];
            var isFormValid = true;

            fields.forEach(function (id) {
                  var el = document.getElementById(id);
                  if (el && !formInputValidation(el)) {
                        isFormValid = false;
                  }
            });

            if (!isFormValid) {
                  btn.disabled = false;
                  btn.innerHTML = originalBtnHTML;
                  return;
            }

            // Collect form values for modal display
            var formVals = {
                  name: document.getElementById('name').value.trim(),
                  email: document.getElementById('email').value.trim(),
                  phone: document.getElementById('phone').value.trim(),
                  experience: document.getElementById('experience').value.trim(),
                  message: document.getElementById('message').value.trim(),
            };

            // Validate that all required files were eagerly uploaded
            if (!careerUploadedIds.photo || !careerUploadedIds.aadhar) {
                  btn.disabled = false;
                  btn.innerHTML = originalBtnHTML;
                  // Show error for any required file that wasn't uploaded
                  if (!careerUploadedIds.photo) showError(errorId.photo, '*Please upload your photo and wait for it to finish uploading');
                  if (!careerUploadedIds.aadhar) showError(errorId.aadhar, '*Please upload your Aadhaar and wait for it to finish uploading');
                  return;
            }

            // Re-enable button (form will be hidden)
            btn.disabled = false;
            btn.innerHTML = originalBtnHTML;

            // === Optimistic UI ===
            careerForm.style.display = 'none';
            openCareerModal(formVals.name, formVals.email);

            // Background submission with retries
            await submitCareerBackground(formVals);
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
                        const response = await fetch(`${API_BASE}/enquiry`, {
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
      function setEnquiryBtnState(btn, state) {
            if (!btn) return;
            if (state === 'loading') {
                  btn.disabled = true;
                  btn.style.opacity = '0.8';
                  btn.innerHTML = '<span class="btn-spinner"></span> Sending...';
            } else if (state === 'success') {
                  btn.disabled = true;
                  btn.style.opacity = '1';
                  btn.style.backgroundColor = '#28a745';
                  btn.innerHTML = '✔ Enquiry Sent!';
            } else if (state === 'reset') {
                  btn.disabled = false;
                  btn.style.opacity = '1';
                  btn.style.backgroundColor = '';
                  btn.innerHTML = 'Send Enquiry';
            }
      }

      const productEnquiryForms = document.querySelectorAll("form[id$='-enquiry'][data-product]");
      productEnquiryForms.forEach(form => {
            form.addEventListener('submit', async (e) => {
                  e.preventDefault();
                  const btn = form.querySelector('button[type="submit"]');
                  setEnquiryBtnState(btn, 'loading');

                  const product_name = form.getAttribute('data-product') || '';
                  const from_name = form.from_name.value.trim();
                  const phone = form.phone.value.trim();
                  try {
                        const response = await fetch(`${API_BASE}/product-enquiry`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ product_name, from_name, phone })
                        });
                        const data = await response.json();
                        if (data.success) {
                              setEnquiryBtnState(btn, 'success');
                              showToast(data.message || '✅ Product enquiry submitted successfully!', 'success');
                              setTimeout(() => {
                                    setEnquiryBtnState(btn, 'reset');
                                    form.reset();
                                    // Close the modal if it's inside one
                                    const modalEl = form.closest('.modal');
                                    if (modalEl && window.bootstrap) {
                                          const modalInstance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
                                          modalInstance.hide();
                                    }
                              }, 2000);
                        } else if (data.errors) {
                              setEnquiryBtnState(btn, 'reset');
                              showToast(Object.values(data.errors).join(' | '), 'error');
                        } else {
                              setEnquiryBtnState(btn, 'reset');
                              showToast((data.message || 'Submission failed.'), 'error');
                        }
                  } catch (err) {
                        setEnquiryBtnState(btn, 'reset');
                        showToast('Network error. Please try again.', 'error');
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
                        showToast('Please enter a valid phone number', 'error');
                        return;
                  }

                  if (btn) {
                        btn.disabled = true;
                        btn.textContent = 'Sending...';
                  }

                  try {
                        const response = await fetch(`${API_BASE}/call-back`, {
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

      // --- Close mobile navbar on link click ---
      var navLinks = document.querySelectorAll('.navbar-collapse .nav-link');
      var navbarCollapse = document.getElementById('navbarNavAltMarkup');
      var navbarToggler = document.querySelector('.navbar-toggler');

      if (navbarCollapse && navbarToggler) {
            navLinks.forEach(function (link) {
                  link.addEventListener('click', function () {
                        if (navbarCollapse.classList.contains('show')) {
                              navbarToggler.click();
                        }
                  });
            });
      }
});
