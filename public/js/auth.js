/**
 * Auth helpers + Toast notification system
 */

// ─── Auth ───
const auth = {
  getUser() {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  },
  getToken() { return localStorage.getItem('token'); },
  isLoggedIn() { return !!this.getToken(); },
  hasRole(...roles) { const u = this.getUser(); return u && roles.includes(u.role); },
  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/index.html';
  },
  requireAuth() {
    if (!this.isLoggedIn()) { window.location.href = '/index.html'; return false; }
    return true;
  }
};

// ─── Toast ───
function toast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-msg">${message}</span>
  `;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(100px)'; el.style.transition = '0.3s ease'; setTimeout(() => el.remove(), 300); }, duration);
}

// ─── Modal helpers ───
function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

function createModal({ id, title, body, footer = '', size = '' }) {
  let existing = document.getElementById(id);
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = id;
  overlay.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <div class="modal-header">
        <div class="modal-title" id="${id}-title">${title}</div>
        <button class="btn-close" onclick="document.getElementById('${id}').remove()">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>
  `;
  // Close on backdrop click
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

// ─── Confirm dialog ───
function confirmDialog(message, onConfirm, { title = 'Konfirmasi', danger = true } = {}) {
  const modal = createModal({
    id: 'confirm-modal',
    title: `${danger ? '⚠️' : 'ℹ️'} ${title}`,
    body: `<p style="color:var(--text-secondary);">${message}</p>`,
    footer: `
      <button class="btn btn-secondary" onclick="document.getElementById('confirm-modal').remove()">Batal</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok-btn">Ya, Lanjutkan</button>
    `
  });
  document.getElementById('confirm-ok-btn').addEventListener('click', () => {
    modal.remove();
    onConfirm();
  });
}

// ─── Format date ───
function formatDate(str) {
  if (!str) return '-';
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatDateTime(str) {
  if (!str) return '-';
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Role badge ───
function roleBadge(role) {
  const labels = { superadmin: 'Super Admin', admin: 'Admin', receptionist: 'Resepsionis' };
  return `<span class="badge badge-${role}">${labels[role] || role}</span>`;
}

function identityBadge(jenis) {
  return `<span class="badge badge-${(jenis||'').toLowerCase()}">${jenis || 'ID'}</span>`;
}

// ─── Nationality flag ───
function nationalityBadge(nat) {
  if (!nat) return '-';
  const isWNI = nat.toUpperCase().includes('IND') || nat.toUpperCase() === 'WNI' || nat.toUpperCase() === 'INDONESIA';
  return `<span class="badge ${isWNI ? 'badge-wni' : 'badge-wna'}">${nat}</span>`;
}

// ─── Initials for avatar ───
function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getRealtimeAge(birthDateStr) {
  if (!birthDateStr) return '-';
  const cleanStr = String(birthDateStr).trim();
  const yyyymmdd = /^\d{4}-\d{2}-\d{2}$/;
  let birthDate = null;
  
  if (yyyymmdd.test(cleanStr)) {
    birthDate = new Date(cleanStr);
  } else {
    const parts = cleanStr.split(/[-/]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        birthDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      } else if (parts[2].length === 4) {
        birthDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      }
    }
  }

  if (!birthDate || isNaN(birthDate.getTime())) {
    return cleanStr;
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  if (age < 0) return '0 tahun';
  return `${age} tahun`;
}
