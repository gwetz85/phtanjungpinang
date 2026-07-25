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
function confirmDialog(message, onConfirm, { title = 'Konfirmasi', danger = true, icon = null } = {}) {
  const defaultIcon = danger ? '🚪' : 'ℹ️'; // Using door icon for logout typically
  const displayIcon = icon || defaultIcon;
  
  const modal = createModal({
    id: 'confirm-modal',
    title: '', // Hide standard header title to make body pop
    body: `
      <div style="text-align:center; padding: 1rem 0.5rem 0.5rem;">
        <div style="font-size:3.5rem; margin-bottom:1rem; line-height:1; animation: popIn 0.3s ease;">${displayIcon}</div>
        <h3 style="margin-bottom:0.5rem; color:var(--text-primary); font-size:1.2rem; font-weight:600;">${title}</h3>
        <p style="color:var(--text-secondary); font-size:0.95rem; line-height:1.5;">${message}</p>
      </div>
      <style>
        @keyframes popIn { 0% { transform: scale(0.5); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        #confirm-modal .modal-header { border-bottom: none; padding-bottom: 0; position: absolute; right: 0; top: 0; z-index: 10; }
        #confirm-modal .modal-title { display: none; }
        #confirm-modal .modal { max-width: 400px; }
      </style>
    `,
    footer: `
      <div style="display:flex; justify-content:center; gap:1rem; width:100%; padding: 0 0.5rem;">
        <button class="btn btn-secondary" style="flex:1; padding: 0.6rem;" onclick="document.getElementById('confirm-modal').remove()">Batal</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" style="flex:1; padding: 0.6rem;" id="confirm-ok-btn">Ya, Lanjutkan</button>
      </div>
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
  const j = String(jenis || '').toUpperCase().trim();
  if (j === 'NIK') return `<span class="badge badge-nik">Nomor NIK</span>`;
  if (j === 'PASSPORT' || j === 'PSP NO' || j === 'PSP') return `<span class="badge badge-passport">Nomor Passport</span>`;
  if (j === 'SIM') return `<span class="badge badge-sim">SIM</span>`;
  return `<span class="badge badge-lainnya">${jenis || 'ID'}</span>`;
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
  if (!birthDateStr) return '';
  const cleanStr = String(birthDateStr).trim();
  if (!cleanStr || cleanStr === '-' || cleanStr.toLowerCase() === 'n/a' || cleanStr.toLowerCase() === 'null') {
    return '';
  }
  const yyyymmdd = /^\d{4}-\d{2}-\d{2}$/;
  let birthDate = null;
  const today = new Date();

  if (yyyymmdd.test(cleanStr)) {
    birthDate = new Date(cleanStr);
  } else {
    const parts = cleanStr.split(/[-/]/);
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      let year = parseInt(parts[2]);

      if (parts[0].length === 4) {
        birthDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      } else if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        if (year < 100) {
          const curYY = today.getFullYear() % 100;
          year = year > curYY ? 1900 + year : 2000 + year;
        }
        birthDate = new Date(year, month - 1, day);
      }
    }
  }

  if (!birthDate || isNaN(birthDate.getTime())) {
    return cleanStr;
  }

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  if (age < 0) return '0 tahun';
  return `${age} tahun`;
}
