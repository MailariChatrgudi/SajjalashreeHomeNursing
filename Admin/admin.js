/**
 * ================================================================
 * CAREERADMIN — admin.js
 * Career Application Management System
 * ================================================================
 *
 * Sections:
 *  1. Configuration & State
 *  2. Initialization
 *  3. SPA Navigation
 *  4. Applications Table
 *  5. Search & Filter
 *  6. Status Update
 *  7. Delete Application
 *  8. View / Detail Modal
 *  9. PDF Viewer Modal
 * 10. Image Preview Modal
 * 11. Sidebar (mobile)
 * 12. Toast Notifications
 * 13. Utility Helpers
 * 14. Demo / Fallback Data
 */

'use strict';

/* ================================================================
   1. CONFIGURATION & STATE
   ================================================================ */

const API = {
  applications: 'http://localhost:3000/admin/applications',
  generalEnquiries: 'http://localhost:3000/admin/enquiries',
  productEnquiries: 'http://localhost:3000/admin/product-enquiries',
  updateStatus: (id) => `http://localhost:3000/admin/update-status/${id}`,
  delete: (id) => `http://localhost:3000/admin/applications/${id}`,
};

const FILES = {
  base: '/admin/file',
  photos: 'photos',
  aadhar: 'aadhar',
  certificate: 'certificate',
};

// Cache blob URLs to avoid re-fetching the same file repeatedly
const _fileUrlCache = new Map(); // key -> objectURL

function buildProtectedFilePath(folder, filename) {
  return `${FILES.base}/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
}

async function getProtectedBlobUrl(folder, filename) {
  const key = `${folder}/${filename}`;
  if (_fileUrlCache.has(key)) return _fileUrlCache.get(key);

  const token = localStorage.getItem('adminToken');
  const res = await fetch(buildProtectedFilePath(folder, filename), {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (res.status === 401) {
    clearUserSession();
    window.location.href = 'admin-login.html';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`File fetch failed (${res.status})`);

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  _fileUrlCache.set(key, objectUrl);
  return objectUrl;
}

async function hydrateProtectedThumbs(rootEl) {
  const scope = rootEl || document;
  const imgs = scope.querySelectorAll('img[data-file-folder][data-file-name]');
  await Promise.all(Array.from(imgs).map(async (img) => {
    const folder = img.getAttribute('data-file-folder');
    const filename = img.getAttribute('data-file-name');
    if (!folder || !filename) return;
    try {
      img.src = await getProtectedBlobUrl(folder, filename);
    } catch {
      img.outerHTML = `<span class='no-file'><i class='fa-solid fa-file-slash'></i> N/A</span>`;
    }
  }));
}

async function downloadProtectedFile(folder, filename, downloadName) {
  const url = await getProtectedBlobUrl(folder, filename);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName || filename || 'download';
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Application-level state */
const state = {
  allApps: [],   // full dataset from server
  filtered: [],   // currently displayed subset
  activeSection: 'applications',
  pendingDelId: null,
};

/* ================================================================
   2. INITIALIZATION
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  renderDate();
  switchSection('applications', document.getElementById('navApplications'));
  // Add listeners for new nav links
  document.getElementById('navGeneralEnquiries')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchSection('generalEnquiries', e.currentTarget);
  });
  document.getElementById('navProductEnquiries')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchSection('productEnquiries', e.currentTarget);
  });
});

/** Display today's date in the topbar */
function renderDate() {
  const el = document.getElementById('currentDate');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });
}

/* ================================================================
   3. SPA NAVIGATION
   ================================================================ */

/**
 * Switch between Dashboard and Applications sections
 * without a page reload.
 *
 * @param {string} sectionId  - 'dashboard' | 'applications'
 * @param {HTMLElement} navEl - The clicked nav link element
 */
function switchSection(sectionId, navEl) {
  // Update active sidebar nav link
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  if (navEl) { navEl.classList.add('active'); navEl.setAttribute('aria-current', 'page'); }

  // Sync mobile bottom nav active state
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
  const bnEl = document.getElementById('bnApplications');
  if (bnEl) bnEl.classList.add('active');

  // Show / hide sections
  document.querySelectorAll('.page-section').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(`section${capitalize(sectionId)}`);
  if (target) target.classList.remove('hidden');

  // Update topbar breadcrumb
  const bc = document.getElementById('breadcrumbSection');
  if (bc) {
    if (sectionId === 'applications') bc.textContent = 'Applications';
    else if (sectionId === 'generalEnquiries') bc.textContent = 'General Enquiries';
    else if (sectionId === 'productEnquiries') bc.textContent = 'Product Enquiries';
    else bc.textContent = 'Dashboard';
  }

  state.activeSection = sectionId;
  closeSidebar();

  // Load data for the selected section
  if (sectionId === 'applications') {
    loadApplications();
  } else if (sectionId === 'generalEnquiries') {
    loadGeneralEnquiries();
  } else if (sectionId === 'productEnquiries') {
    loadProductEnquiries();
  }
}
// ================= GENERAL ENQUIRIES =================
async function loadGeneralEnquiries() {
  const rc = document.getElementById('generalResultCount');
  if (rc) rc.textContent = 'Loading…';
  showGeneralEnquiriesState('loading');
  try {
    const token = localStorage.getItem('adminToken');
    const status = document.getElementById('generalStatusFilter')?.value || '';
    const url = status ? `${API.generalEnquiries}?status=${encodeURIComponent(status)}` : API.generalEnquiries;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    const dateRange = document.getElementById('generalDateFilter')?.value || '';
    let filteredData = Array.isArray(data) ? data : [];
    if (dateRange) {
      filteredData = filteredData.filter(enq => filterByDateRange(enq.created_at, dateRange));
    }
    renderGeneralEnquiriesTable(filteredData);
  } catch (e) {
    if (rc) rc.textContent = '—';
    showGeneralEnquiriesState('error');
    showToast('Could not load general enquiries', 'error');
  }
}

function renderGeneralEnquiriesTable(enquiries) {
  const tbody = document.getElementById('generalEnquiriesBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!enquiries.length) {
    const rc = document.getElementById('generalResultCount');
    if (rc) rc.textContent = '0 results';
    showGeneralEnquiriesState('empty');
    return;
  }
  const rc = document.getElementById('generalResultCount');
  if (rc) rc.textContent = `${enquiries.length} ${enquiries.length === 1 ? 'result' : 'results'}`;

  enquiries.forEach((enq, idx) => {
    const id = enq.id || idx + 1;
    const name = enq.name || '—';
    const initials = getInitials(name);
    const status = normalizeEnquiryStatus(enq.status);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="#">${escHtml(String(id))}</td>
      <td class="td-applicant">
        <div class="applicant-cell">
          <div class="app-initials">${escHtml(initials)}</div>
          <div>
            <p class="app-name">${escHtml(name)}</p>
            <p class="app-id">Enquiry #${escHtml(String(id))}</p>
          </div>
        </div>
      </td>
      <td data-label="Email">
        ${enq.email ? `<a href="mailto:${escHtml(enq.email)}" style="color:var(--accent);">${escHtml(enq.email)}</a>` : '—'}
      </td>
      <td data-label="Phone">
        ${enq.phone ? `<a href="tel:${escHtml(enq.phone)}" style="color:inherit;">${escHtml(enq.phone)}</a>` : '—'}
      </td>
      <td data-label="Status">
        <span class="status-badge ${status.toLowerCase()}">${statusDotForEnquiry(status)} ${status}</span>
      </td>
      <td data-label="Date">${enq.created_at ? new Date(enq.created_at).toLocaleString('en-IN') : '—'}</td>
      <td class="td-actions">
        <div class="actions-cell">
          <select class="status-select" onchange="updateGeneralEnquiryStatus('${id}', this.value)" title="Update status">
            <option value="" disabled selected>Update…</option>
            <option value="Pending">Pending</option>
            <option value="Contacted">Contacted</option>
          </select>
          <button class="btn-row del" title="Delete enquiry" onclick="deleteGeneralEnquiry('${id}')">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  showGeneralEnquiriesState('table');
}

function showGeneralEnquiriesState(state) {
  const map = {
    loading: 'generalEnquiriesLoading',
    empty: 'generalEnquiriesEmpty',
    error: 'generalEnquiriesError',
    table: 'generalEnquiriesTableWrap',
  };
  Object.values(map).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(map[state]);
  if (target) target.classList.remove('hidden');
}

// ================= PRODUCT ENQUIRIES =================
async function loadProductEnquiries() {
  const rc = document.getElementById('productResultCount');
  if (rc) rc.textContent = 'Loading…';
  showProductEnquiriesState('loading');
  try {
    const token = localStorage.getItem('adminToken');
    const status = document.getElementById('productStatusFilter')?.value || '';
    const url = status ? `${API.productEnquiries}?status=${encodeURIComponent(status)}` : API.productEnquiries;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    const dateRange = document.getElementById('productDateFilter')?.value || '';
    let filteredData = Array.isArray(data) ? data : [];
    if (dateRange) {
      filteredData = filteredData.filter(enq => filterByDateRange(enq.created_at, dateRange));
    }
    renderProductEnquiriesTable(filteredData);
  } catch (e) {
    if (rc) rc.textContent = '—';
    showProductEnquiriesState('error');
    showToast('Could not load product enquiries', 'error');
  }
}

function renderProductEnquiriesTable(enquiries) {
  const tbody = document.getElementById('productEnquiriesBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!enquiries.length) {
    const rc = document.getElementById('productResultCount');
    if (rc) rc.textContent = '0 results';
    showProductEnquiriesState('empty');
    return;
  }
  const rc = document.getElementById('productResultCount');
  if (rc) rc.textContent = `${enquiries.length} ${enquiries.length === 1 ? 'result' : 'results'}`;

  enquiries.forEach((enq, idx) => {
    const id = enq.id || idx + 1;
    const name = enq.name || '—';
    const initials = getInitials(name);
    const status = normalizeEnquiryStatus(enq.status);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="#">${escHtml(String(id))}</td>
      <td class="td-applicant">
        <div class="applicant-cell">
          <div class="app-initials">${escHtml(initials)}</div>
          <div>
            <p class="app-name">${escHtml(name)}</p>
            <p class="app-id">Product: ${escHtml(enq.product_name || '—')}</p>
          </div>
        </div>
      </td>
      <td data-label="Product">${escHtml(enq.product_name || '—')}</td>
      <td data-label="Phone">
        ${enq.phone ? `<a href="tel:${escHtml(enq.phone)}" style="color:inherit;">${escHtml(enq.phone)}</a>` : '—'}
      </td>
      <td data-label="Status">
        <span class="status-badge ${status.toLowerCase()}">${statusDotForEnquiry(status)} ${status}</span>
      </td>
      <td data-label="Date">${enq.created_at ? new Date(enq.created_at).toLocaleString('en-IN') : '—'}</td>
      <td class="td-actions">
        <div class="actions-cell">
          <select class="status-select" onchange="updateProductEnquiryStatus('${id}', this.value)" title="Update status">
            <option value="" disabled selected>Update…</option>
            <option value="Pending">Pending</option>
            <option value="Contacted">Contacted</option>
          </select>
          <button class="btn-row del" title="Delete enquiry" onclick="deleteProductEnquiry('${id}')">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  showProductEnquiriesState('table');
}

function normalizeEnquiryStatus(val) {
  const v = String(val || '').trim().toLowerCase();
  if (v === 'contacted') return 'Contacted';
  return 'Pending';
}

function statusDotForEnquiry(status) {
  const colors = { Pending: '#a16207', Contacted: '#0369a1' };
  const c = colors[status] || colors.Pending;
  return `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0;"></span>`;
}

async function updateGeneralEnquiryStatus(id, status) {
  if (!id || !status) return;
  try {
    const token = localStorage.getItem('adminToken');
    const res = await fetch(`http://localhost:3000/admin/enquiries/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Update failed');
    showToast(`Marked as "${status}"`, 'success');
    loadGeneralEnquiries();
  } catch {
    showToast('Could not update enquiry status', 'error');
  }
}

async function updateProductEnquiryStatus(id, status) {
  if (!id || !status) return;
  try {
    const token = localStorage.getItem('adminToken');
    const res = await fetch(`http://localhost:3000/admin/product-enquiries/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Update failed');
    showToast(`Marked as "${status}"`, 'success');
    loadProductEnquiries();
  } catch {
    showToast('Could not update enquiry status', 'error');
  }
}

async function deleteGeneralEnquiry(id) {
  if (!id) return;
  if (!confirm('Delete this general enquiry?')) return;
  try {
    const token = localStorage.getItem('adminToken');
    const res = await fetch(`http://localhost:3000/admin/enquiries/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Enquiry deleted', 'success');
    loadGeneralEnquiries();
  } catch {
    showToast('Could not delete enquiry', 'error');
  }
}

async function deleteProductEnquiry(id) {
  if (!id) return;
  if (!confirm('Delete this product enquiry?')) return;
  try {
    const token = localStorage.getItem('adminToken');
    const res = await fetch(`http://localhost:3000/admin/product-enquiries/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Enquiry deleted', 'success');
    loadProductEnquiries();
  } catch {
    showToast('Could not delete enquiry', 'error');
  }
}

function showProductEnquiriesState(state) {
  const map = {
    loading: 'productEnquiriesLoading',
    empty: 'productEnquiriesEmpty',
    error: 'productEnquiriesError',
    table: 'productEnquiriesTableWrap',
  };
  Object.values(map).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(map[state]);
  if (target) target.classList.remove('hidden');
}

/** Called by the refresh button — reloads data for the active section */
function refreshCurrentSection() {
  animateRefreshBtn(true);
  loadApplications();
  setTimeout(() => animateRefreshBtn(false), 900);
}

function animateRefreshBtn(on) {
  document.getElementById('refreshBtn')?.classList.toggle('spinning', on);
}

/* ================================================================
   4. APPLICATIONS TABLE
   ================================================================ */

/** Fetch all applications from the server */
async function loadApplications() {
  showTableState('loading');

  try {
    const token = localStorage.getItem('adminToken');
    const res = await fetch(API.applications, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();

    state.allApps = Array.isArray(data) ? data : (data.applications || []);
    state.filtered = [...state.allApps];
    updateNavBadge(state.allApps.length);
    updateStatCards(state.allApps);
    renderTable(state.filtered);
  } catch (e) {
    console.log(e.message)
    showTableState('error');
    showToast('Could not reach server — check your backend', 'error');
  }
}

/** Render the <tbody> with the provided apps array */
function renderTable(apps) {
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (apps.length === 0) { showTableState('empty'); return; }

  apps.forEach((app, idx) => {
    const id = app.id || idx;
    const status = normalizeStatus(app.status);
    const photoFile = app.photo || null;
    const aadharFile = app.aadhar_card || null;
    const certFile = app.certificate || null;
    const initials = getInitials(app.full_name);
    const aadharType = aadharFile ? aadharFile.split('.').pop().toLowerCase() : '';

    const tr = document.createElement('tr');
    tr.dataset.id = id;

    tr.innerHTML = `
      <td data-label="#" style="color:var(--txt-3);font-size:.75rem;">${id}</td>

      <td class="td-applicant">
        <div class="applicant-cell">
          <div class="app-initials">${escHtml(initials)}</div>
          <div>
            <p class="app-name">${escHtml(app.full_name || '—')}</p>
            <p class="app-id">#${escHtml(String(id))}</p>
          </div>
        </div>
      </td>

      <td data-label="Phone" style="color:var(--txt-2);font-size:.82rem;">
        <a href="tel:${escHtml(app.phone || '')}" style="color:inherit;">${escHtml(app.phone || '—')}</a>
      </td>

      <td data-label="Email" style="font-size:.82rem;">
        <a href="mailto:${escHtml(app.email || '')}" style="color:var(--accent);">${escHtml(app.email || '—')}</a>
      </td>

      <td data-label="Experience">
        <span class="exp-pill">
          <i class="fa-solid fa-briefcase" style="font-size:.68rem;"></i>
          ${escHtml(String(app.experience_years ?? '—'))} yr${app.experience_years !== 1 ? 's' : ''}
        </span>
      </td>

      <td data-label="Photo">${thumbCellProtected(FILES.photos, photoFile, 'Photo', `previewProtectedImg('${FILES.photos}','${escHtml(photoFile || '')}','Photo — ${escHtml(app.full_name || '')}')`, 'fa-image')}</td>

      ${(aadharType === "jpg" || aadharType === "jpeg" || aadharType === "png") ?
        `<td data-label="Aadhaar">${thumbCellProtected(FILES.aadhar, aadharFile, 'Aadhaar', `previewProtectedImg('${FILES.aadhar}','${escHtml(aadharFile || '')}','Aadhaar — ${escHtml(app.full_name || '')}')`, 'fa-id-card')}</td>`
        : (aadharType === 'pdf') ?
          `<td data-label="Aadhaar">${fileActionsProtected(FILES.aadhar, aadharFile, 'Aadhaar')}</td>` :
          `<td data-label="Aadhaar"><span class="no-file"><i class="fa-solid fa-file-slash"></i> N/A</span></td>`
      }

      <td data-label="Certificate">${fileActionsProtected(FILES.certificate, certFile, 'Certificate')}</td>

      <td data-label="Status">
        <span class="status-badge ${status.toLowerCase()}" id="badge-${id}">
          ${statusDot(status)} ${status}
        </span>
      </td>

      <td data-label="Date">${app.created_at ? new Date(app.created_at).toLocaleString('en-IN') : '—'}</td>

      <td class="td-actions">
        <div class="actions-cell">
          <button class="btn-row view" title="View details" aria-label="View applicant details" onclick="openViewModal('${id}')">
            <i class="fa-solid fa-eye"></i>
          </button>

          <select class="status-select" data-id="${id}" onchange="updateStatus(this)" title="Update status">
            <option value="" disabled selected>Update…</option>
            <option value="Pending">Pending</option>
            <option value="Shortlisted">Shortlisted</option>
            <option value="Rejected">Rejected</option>
          </select>

          <button class="btn-row del" title="Delete application" onclick="confirmDelete('${id}')">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  showTableState('table');
  updateResultCount(apps.length);
  hydrateProtectedThumbs(tbody);
}

/** Build a thumbnail cell */
function thumbCell(src, label, onclickCode, fallbackIcon) {
  if (!src) return `<span class="no-file"><i class="fa-solid ${fallbackIcon}"></i> N/A</span>`;
  return `
    <img
      class="thumb"
      src="${src}"
      alt="${label}"
      title="Click to enlarge"
      onclick="${onclickCode}"
      onerror="this.outerHTML='<span class=\\'no-file\\'><i class=\\'fa-solid ${fallbackIcon}\\'></i> N/A</span>'"
    />
  `;
}

function thumbCellProtected(folder, filename, label, onclickCode, fallbackIcon) {
  if (!filename) return `<span class="no-file"><i class="fa-solid ${fallbackIcon}"></i> N/A</span>`;
  // Use a harmless placeholder to avoid immediate `src=""` load/error before hydration.
  const placeholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  return `
    <img
      class="thumb"
      src="${placeholder}"
      data-file-folder="${escHtml(folder)}"
      data-file-name="${escHtml(filename)}"
      alt="${label}"
      title="Click to enlarge"
      onclick="${onclickCode}"
    />
  `;
}

function fileActionsProtected(folder, filename, label) {
  if (!filename) return `<span class="no-file"><i class="fa-solid fa-file-slash"></i> N/A</span>`;
  const safeLabel = escHtml(label || 'Document');
  return `
    <div class="file-actions">
      <button class="btn-view-file pdf" onclick="openProtectedPdfViewer('${folder}','${escHtml(filename)}','${safeLabel}')" title="View ${safeLabel}">
        <i class="fa-solid fa-eye"></i> View
      </button>
      <button class="btn-view-file dl" onclick="downloadProtectedFile('${folder}','${escHtml(filename)}','${safeLabel}')" title="Download ${safeLabel}">
        <i class="fa-solid fa-download"></i>
      </button>
    </div>
  `;
}

/* ================================================================
   6. SEARCH & FILTER
   ================================================================ */

function filterApplications() {
  const query = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
  const status = document.getElementById('statusFilter')?.value || '';
  const experienceRange = document.getElementById('experienceFilter')?.value || '';
  const dateRange = document.getElementById('dateFilter')?.value || '';

  // Toggle clear button visibility
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.classList.toggle('show', query.length > 0);

  state.filtered = state.allApps.filter(app => {
    const matchSearch = !query ||
      (app.full_name && app.full_name.toLowerCase().includes(query)) ||
      (app.phone && String(app.phone).toLowerCase().includes(query)) ||
      (app.email && app.email.toLowerCase().includes(query));

    const matchStatus = !status || normalizeStatus(app.status) === status;

    // Experience filtering
    let matchExperience = true;
    if (experienceRange) {
      const exp = parseFloat(app.experience_years) || 0;
      if (experienceRange === '0-2') {
        matchExperience = exp >= 0 && exp <= 2;
      } else if (experienceRange === '2-5') {
        matchExperience = exp > 2 && exp <= 5;
      } else if (experienceRange === '5-10') {
        matchExperience = exp > 5 && exp <= 10;
      } else if (experienceRange === '10+') {
        matchExperience = exp > 10;
      }
    }

    const matchDate = filterByDateRange(app.created_at, dateRange);

    return matchSearch && matchStatus && matchExperience && matchDate;
  });

  renderTable(state.filtered);
  showTableState(state.filtered.length ? 'table' : 'empty');
}

function clearSearch() {
  const inp = document.getElementById('searchInput');
  if (inp) { inp.value = ''; inp.focus(); }
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.classList.remove('show');
  filterApplications();
}

function updateResultCount(n) {
  const el = document.getElementById('resultCount');
  if (el) el.textContent = `${n} ${n === 1 ? 'result' : 'results'}`;
}

/* ================================================================
   7. STATUS UPDATE
   ================================================================ */

/**
 * Send a PUT request to update the application status.
 * Uses optimistic UI — updates badge immediately, then confirms with server.
 */
async function updateStatus(selectEl) {
  const id = selectEl.dataset.id;
  const newStatus = selectEl.value;
  if (!id || !newStatus) return;

  // Optimistic update — change badge immediately
  updateBadgeInDom(id, newStatus);
  const app = state.allApps.find(a => String(a._id || a.id) === String(id));
  if (app) app.status = newStatus;

  try {
    const token = localStorage.getItem('adminToken');
    const res = await fetch(API.updateStatus(id), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) throw new Error('Update failed');
    showToast(`Status updated to "${newStatus}"`, 'success');
  } catch {
    showToast('Could not sync status with server', 'error');
  } finally {
    selectEl.value = '';
  }
}

/** Update the status badge in the DOM after a status change */
function updateBadgeInDom(id, newStatus) {
  const badge = document.getElementById(`badge-${id}`);
  if (!badge) return;
  badge.className = `status-badge ${newStatus.toLowerCase()}`;
  badge.innerHTML = `${statusDot(newStatus)} ${newStatus}`;
}

/* ================================================================
   8. DELETE APPLICATION
   ================================================================ */

/** Shows the delete confirmation modal */
function confirmDelete(id) {
  state.pendingDelId = id;
  const btn = document.getElementById('confirmDeleteBtn');
  if (btn) btn.onclick = () => deleteApplication(id);
  openModal('deleteModal');
}

/** Sends DELETE request and removes the row from the table */
async function deleteApplication(id) {
  closeModal('deleteModal');

  try {
    const token = localStorage.getItem('adminToken');
    await fetch(API.delete(id), {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
  } catch {
    // proceed anyway — local operation still removes the row
  }

  // Remove from state
  state.allApps = state.allApps.filter(a => String(a._id || a.id) !== String(id));
  state.filtered = state.filtered.filter(a => String(a._id || a.id) !== String(id));

  // Animate row removal
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) {
    row.style.transition = 'opacity .25s, transform .25s';
    row.style.opacity = '0';
    row.style.transform = 'translateX(24px)';
    setTimeout(() => {
      row.remove();
      if (state.filtered.length === 0) showTableState('empty');
    }, 260);
  }

  updateResultCount(state.filtered.length);
  updateNavBadge(state.allApps.length);
  showToast('Application deleted', 'success');
  state.pendingDelId = null;
}

/* ================================================================
   9. VIEW / DETAIL MODAL
   ================================================================ */

/** Open the full detail modal for an applicant */
function openViewModal(id) {
  const app = state.allApps.find(a => String(a._id || a.id) === String(id));
  if (!app) return;

  const status = normalizeStatus(app.status);
  const photoFile = app.photo || null;
  const aadharFile = app.aadhar_card || null;
  const certFile = app.certificate || null;
  const aadharType = aadharFile ? aadharFile.split('.').pop().toLowerCase() : '';

  const body = document.getElementById('viewModalBody');
  if (!body) return;

  body.innerHTML = `
    <div class="detail-grid">

      <!-- ── Personal Info ── -->
      <div class="detail-section-title">Personal Information</div>

      <div class="detail-field">
        <span class="detail-label">Full Name</span>
        <span class="detail-value">${escHtml(app.full_name || '—')}</span>
      </div>

      <div class="detail-field">
        <span class="detail-label">Status</span>
        <span class="detail-value">
          <span class="status-badge ${status.toLowerCase()}">${statusDot(status)} ${status}</span>
        </span>
      </div>

      <div class="detail-field">
        <span class="detail-label">Phone</span>
        <span class="detail-value">
          <a href="tel:${escHtml(app.phone || '')}" style="color:var(--accent)">${escHtml(app.phone || '—')}</a>
        </span>
      </div>

      <div class="detail-field">
        <span class="detail-label">Email</span>
        <span class="detail-value">
          <a href="mailto:${escHtml(app.email || '')}" style="color:var(--accent)">${escHtml(app.email || '—')}</a>
        </span>
      </div>

      <div class="detail-field">
        <span class="detail-label">Experience</span>
        <span class="detail-value">${escHtml(String(app.experience_years ?? '—'))} year(s)</span>
      </div>

      <div class="detail-field">
        <span class="detail-label">Application ID</span>
        <span class="detail-value">#${escHtml(String(app._id || app.id || '—'))}</span>
      </div>

      ${app.message ? `
      <div class="detail-field full">
        <span class="detail-label">Message / Cover Note</span>
        <span class="detail-value" style="white-space:pre-wrap;font-size:.82rem;line-height:1.6;">
          ${escHtml(app.message)}
        </span>
      </div>` : ''}

      <!-- ── Documents ── -->
      <div class="detail-section-title">Documents</div>

      ${photoFile ? `
      <div class="detail-field">
        <span class="detail-label">Photo</span>
        <img
          class="detail-img"
          src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
          data-file-folder="${escHtml(FILES.photos)}"
          data-file-name="${escHtml(photoFile)}"
          alt="Photo"
          onclick="previewProtectedImg('${FILES.photos}','${escHtml(photoFile)}','Photo — ${escHtml(app.full_name || '')}')"
          onerror="this.outerHTML='<p style=color:var(--txt-3)>Not available</p>'"
        />
      </div>` : ''}

      ${(aadharFile && (aadharType === "jpg" || aadharType === "jpeg" || aadharType === "png")) ? `
      <div class="detail-field">
        <span class="detail-label">Aadhaar</span>
        <img
          class="detail-img"
          src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
          data-file-folder="${escHtml(FILES.aadhar)}"
          data-file-name="${escHtml(aadharFile)}"
          alt="Aadhaar"
          onclick="previewProtectedImg('${FILES.aadhar}','${escHtml(aadharFile)}','Aadhaar — ${escHtml(app.full_name || '')}')"
          onerror="this.outerHTML='<p style=color:var(--txt-3)>Not available</p>'"
        />
      </div>` : (aadharFile && aadharType === 'pdf') ? `
      <div class="detail-field">
        <span class="detail-label">Aadhaar</span>
        <div class="file-actions" style="margin-top:4px;">
          <button class="btn btn-sm btn-outline" onclick="openProtectedPdfViewer('${FILES.aadhar}','${escHtml(aadharFile)}','Aadhaar')">
            <i class="fa-solid fa-file-pdf"></i> View PDF
          </button>
          <button class="btn btn-sm btn-primary" onclick="downloadProtectedFile('${FILES.aadhar}','${escHtml(aadharFile)}','Aadhaar')">
            <i class="fa-solid fa-download"></i> Download
          </button>
        </div>
      </div>` : ''}

      ${certFile ? `
      <div class="detail-field">
        <span class="detail-label">Certificate</span>
        <div class="file-actions" style="margin-top:4px;">
          <button class="btn btn-sm btn-outline" onclick="openProtectedPdfViewer('${FILES.certificate}','${escHtml(certFile)}','Certificate')">
            <i class="fa-solid fa-file-pdf"></i> View PDF
          </button>
          <button class="btn btn-sm btn-primary" onclick="downloadProtectedFile('${FILES.certificate}','${escHtml(certFile)}','Certificate')">
            <i class="fa-solid fa-download"></i> Download
          </button>
        </div>
      </div>` : ''}


    </div>
  `;

  openModal('viewModal');
  hydrateProtectedThumbs(body);
}

/* ================================================================
   10. PDF VIEWER MODAL
   ================================================================ */

/**
 * Open the built-in PDF viewer modal.
 * @param {string} src   - Full URL/path to the PDF file
 * @param {string} label - Human-readable label ('Certificate', 'Resume', etc.)
 */
function openPdfViewer(src, label) {
  const frame = document.getElementById('pdfFrame');
  const labelEl = document.getElementById('pdfModalLabel');
  const downloadEl = document.getElementById('pdfDownloadBtn');

  if (!src) { showToast('File path not available', 'error'); return; }

  if (frame) frame.src = src;
  if (labelEl) labelEl.textContent = label || 'Document';
  if (downloadEl) { downloadEl.href = src; downloadEl.setAttribute('download', label || 'document'); }

  openModal('pdfModal');
}

async function openProtectedPdfViewer(folder, filename, label) {
  const frame = document.getElementById('pdfFrame');
  const labelEl = document.getElementById('pdfModalLabel');
  const downloadEl = document.getElementById('pdfDownloadBtn');
  if (!folder || !filename) { showToast('File path not available', 'error'); return; }

  try {
    const token = localStorage.getItem('adminToken');
    const res = await fetch(buildProtectedFilePath(folder, filename), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401) {
      clearUserSession();
      window.location.href = 'admin-login.html';
      return;
    }
    if (!res.ok) throw new Error(`File fetch failed (${res.status})`);

    const arrayBuffer = await res.arrayBuffer();
    const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(pdfBlob);

    if (frame) frame.src = pdfUrl;
    if (labelEl) labelEl.textContent = label || 'Document';
    if (downloadEl) {
      downloadEl.href = pdfUrl;
      downloadEl.setAttribute('download', filename);
    }
    openModal('pdfModal');
  } catch (e) {
    console.log(e.message)
    showToast('Could not load document', 'error');
  }
}

/* ================================================================
   11. IMAGE PREVIEW MODAL
   ================================================================ */

function previewImg(src, caption) {
  if (!src || src.includes('null')) return;
  const img = document.getElementById('imgPreviewSrc');
  const capEl = document.getElementById('imgPreviewCaption');
  if (img) img.src = src;
  if (capEl) capEl.textContent = caption || '';
  openModal('imgModal');
}

async function previewProtectedImg(folder, filename, caption) {
  if (!folder || !filename) return;
  try {
    const url = await getProtectedBlobUrl(folder, filename);
    previewImg(url, caption);
  } catch {
    showToast('Could not load image', 'error');
  }
}

/* ================================================================
   12. SIDEBAR (MOBILE)
   ================================================================ */

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar?.classList.toggle('open');
  overlay?.classList.toggle('show');
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('show');
}

/* ================================================================
   13. MODAL HELPERS
   ================================================================ */

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  // Re-enable scroll only if no other modals are open
  if (!document.querySelector('.modal-overlay.open')) {
    document.body.style.overflow = '';
  }
  // Clear PDF iframe src to stop loading
  if (id === 'pdfModal') {
    const f = document.getElementById('pdfFrame');
    if (f) f.src = '';
  }
}

/* ================================================================
   14. TOAST NOTIFICATIONS
   ================================================================ */

/**
 * Show a temporary toast notification
 * @param {string} msg  - Message text
 * @param {'success'|'error'|'info'} type
 */
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toastMsg');
  const iconEl = document.getElementById('toastIcon');
  if (!toast) return;

  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };

  msgEl.textContent = msg;
  iconEl.innerHTML = `<i class="fa-solid ${icons[type] || icons.success}"></i>`;
  toast.className = `toast-wrap show ${type}`;

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3400);
}

/* ================================================================
   15. UTILITY HELPERS
   ================================================================ */

/** Logout handler */
function handleLogout() {
  if (confirm('Are you sure you want to logout?')) {
    showToast('Logging out…', 'info');
    // Clear all authentication data
    clearUserSession();
    setTimeout(() => window.location.href = 'admin-login.html', 1200);
  }
}

/** Normalize status string to canonical form */
function normalizeStatus(val) {
  const v = String(val || '').trim().toLowerCase();
  if (v === 'shortlisted') return 'Shortlisted';
  if (v === 'rejected') return 'Rejected';
  return 'Pending';
}

/** Return an SVG dot for status badges */
function statusDot(status) {
  const colors = { Pending: '#a16207', Shortlisted: '#15803d', Rejected: '#b91c1c' };
  const c = colors[status] || colors.Pending;
  return `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0;"></span>`;
}

/** Get two-letter initials from a full name */
function getInitials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('');
}

/** Escape HTML to prevent XSS */
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

/** Capitalize first character */
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Helper to filter by exact month and year */
function filterByDateRange(dateString, monthYearStr) {
  if (!monthYearStr || !dateString) return true;
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return false;

  // monthYearStr format from <input type="month"> is "YYYY-MM"
  // or from <input type="date"> is "YYYY-MM-DD"
  const parts = monthYearStr.split('-');
  const targetYear = parseInt(parts[0], 10);
  const targetMonth = parseInt(parts[1], 10);

  if (parts.length === 3) {
    const targetDay = parseInt(parts[2], 10);
    return d.getFullYear() === targetYear &&
      (d.getMonth() + 1) === targetMonth &&
      d.getDate() === targetDay;
  }

  return d.getFullYear() === targetYear &&
    (d.getMonth() + 1) === targetMonth;
}

/** Show/hide table states */
function showTableState(state) {
  const map = {
    loading: 'tableLoading',
    empty: 'tableEmpty',
    error: 'tableError',
    table: 'tableWrap',
  };
  Object.values(map).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(map[state]);
  if (target) target.classList.remove('hidden');
}

/** Update the Applications nav badge */
function updateNavBadge(count) {
  const el = document.getElementById('navBadge');
  if (el) el.textContent = count;
}

/** Update the four summary stat cards */
function updateStatCards(apps) {
  const total = apps.length;
  const pending = apps.filter(a => normalizeStatus(a.status) === 'Pending').length;
  const shortlisted = apps.filter(a => normalizeStatus(a.status) === 'Shortlisted').length;
  const rejected = apps.filter(a => normalizeStatus(a.status) === 'Rejected').length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('statTotal', total);
  set('statPending', pending);
  set('statShortlisted', shortlisted);
  set('statRejected', rejected);
}

const adminName = localStorage.getItem('adminName')
const adminRole = localStorage.getItem('adminRole')
if (adminName && adminRole) {
  document.getElementById('adminName').textContent = adminName
  document.getElementById('adminRole').textContent = adminRole
}


