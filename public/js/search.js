/**
 * Search Panel — cari tamu by NIK/Passport/Nama
 */

const searchPanel = (() => {
  let searchTimeout = null;

  function init() {
    const input = document.getElementById('search-input');
    if (!input) return;
    input.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const q = input.value.trim();
      if (q.length < 2) {
        document.getElementById('search-results').innerHTML = '';
        return;
      }
      document.getElementById('search-spinner')?.style && (document.getElementById('search-spinner').style.display = 'block');
      searchTimeout = setTimeout(() => doSearch(q), 400);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(searchTimeout);
        doSearch(input.value.trim());
      }
    });

    document.getElementById('search-btn')?.addEventListener('click', () => {
      clearTimeout(searchTimeout);
      doSearch(document.getElementById('search-input').value.trim());
    });
  }

  async function doSearch(q) {
    const resultsDiv = document.getElementById('search-results');
    const spinner = document.getElementById('search-spinner');
    if (!q) { resultsDiv.innerHTML = ''; return; }
    if (spinner) spinner.style.display = 'block';
    try {
      const res = await api.get('/guests/search', { q });
      if (spinner) spinner.style.display = 'none';
      renderResults(res.data || []);
    } catch (err) {
      if (spinner) spinner.style.display = 'none';
      resultsDiv.innerHTML = `<div class="alert alert-error"><span>❌</span><span>${err.message}</span></div>`;
    }
  }

  function renderResults(guests) {
    const div = document.getElementById('search-results');
    if (!guests.length) {
      div.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>Tamu tidak ditemukan. Coba dengan kata kunci lain.</p>
        </div>`;
      return;
    }

    div.innerHTML = `
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.75rem;">
        Ditemukan <strong style="color:var(--primary)">${guests.length}</strong> tamu
      </p>
      ${guests.map(g => guestResultCard(g)).join('')}
    `;

    // Attach click handlers
    div.querySelectorAll('[data-guest-id]').forEach(el => {
      el.addEventListener('click', () => showGuestDetail(el.dataset.guestId));
    });
    div.querySelectorAll('[data-checkin-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        dashboard.openCheckinModal(el.dataset.checkinId, el.dataset.checkinName);
      });
    });
  }

  function guestResultCard(g) {
    return `
      <div class="guest-card" style="margin-bottom:1rem; cursor:pointer;" data-guest-id="${g.id}">
        <div class="guest-card-header">
          <div class="guest-avatar-lg">${getInitials(g.nama_tamu)}</div>
          <div class="guest-header-info">
            <h3>${escHtml(g.nama_tamu)}</h3>
            <div class="guest-meta">
              ${identityBadge(g.jenis_identitas)}
              <code style="font-size:0.82rem;color:var(--text-secondary);">${escHtml(g.no_identitas)}</code>
              ${nationalityBadge(g.kewarganegaraan)}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.5rem;flex-shrink:0;">
            <span style="font-size:0.78rem;color:var(--text-muted);">
              ${g.total_checkins || 0}x menginap
            </span>
            <button class="btn btn-primary btn-sm" data-checkin-id="${g.id}" data-checkin-name="${escHtml(g.nama_tamu)}">
              ➕ Check-in
            </button>
          </div>
        </div>
        <div class="guest-detail-grid" style="padding:1rem 1.5rem;">
          <div class="detail-item"><label>Tanggal Lahir</label><span>${escHtml(g.umur || '-')}</span></div>
          <div class="detail-item"><label>Umur</label><span style="font-weight:600;color:var(--primary);">${getRealtimeAge(g.umur)}</span></div>
          <div class="detail-item"><label>Kewarganegaraan</label><span>${escHtml(g.kewarganegaraan || '-')}</span></div>
          <div class="detail-item"><label>Datang Dari</label><span>${escHtml(g.datang_dari || '-')}</span></div>
          <div class="detail-item"><label>Expiry ID</label><span>${escHtml(g.expiry_identitas || '-')}</span></div>
          ${g.last_checkin ? `<div class="detail-item"><label>Terakhir Menginap</label><span>${formatDate(g.last_checkin)} ${g.last_room ? '— Kamar ' + escHtml(g.last_room) : ''}</span></div>` : ''}
        </div>
      </div>
    `;
  }

  async function showGuestDetail(guestId) {
    try {
      const res = await api.get(`/guests/${guestId}`);
      const g = res.data;
      createModal({
        id: 'guest-detail-modal',
        title: `🧍 Detail Tamu`,
        size: 'modal-lg',
        body: `
          <div class="guest-card-header" style="margin:-1.5rem -1.5rem 1.5rem; border-radius:0; background: linear-gradient(135deg, rgba(79,142,247,0.15), rgba(124,58,237,0.1));">
            <div class="guest-avatar-lg">${getInitials(g.nama_tamu)}</div>
            <div class="guest-header-info">
              <h3 style="font-size:1.3rem;">${escHtml(g.nama_tamu)}</h3>
              <div class="guest-meta">
                ${identityBadge(g.jenis_identitas)}
                <code style="font-size:0.85rem;color:var(--text-secondary);">${escHtml(g.no_identitas)}</code>
                ${nationalityBadge(g.kewarganegaraan)}
              </div>
            </div>
          </div>
          <div class="guest-detail-grid" style="padding:0; margin-bottom:1.5rem;">
            <div class="detail-item"><label>Tanggal Lahir</label><span>${escHtml(g.umur || '-')}</span></div>
            <div class="detail-item"><label>Umur (Real-time)</label><span style="font-weight:600;color:var(--primary);">${getRealtimeAge(g.umur)}</span></div>
            <div class="detail-item"><label>Expiry Identitas</label><span>${escHtml(g.expiry_identitas || '-')}</span></div>
            <div class="detail-item"><label>Datang Dari</label><span>${escHtml(g.datang_dari || '-')}</span></div>
            <div class="detail-item"><label>Total Menginap</label><span>${g.checkins?.length || 0}x</span></div>
          </div>
          <hr class="divider" style="margin:0 0 1.5rem;">
          <div class="timeline">
            <div class="timeline-title">📋 Riwayat Check-in</div>
            ${renderTimeline(g.checkins || [])}
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="document.getElementById('guest-detail-modal').remove()">Tutup</button>
          <button class="btn btn-primary" onclick="document.getElementById('guest-detail-modal').remove(); dashboard.openCheckinModal('${g.id}', '${escHtml(g.nama_tamu)}')">➕ Check-in Ulang</button>
        `
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderTimeline(checkins) {
    if (!checkins.length) return `<div class="empty-state" style="padding:1.5rem;"><div class="empty-icon">📭</div><p>Belum ada riwayat check-in.</p></div>`;
    return checkins.map((c, i) => `
      <div class="timeline-item">
        <div class="timeline-dot">${i === 0 ? '🏠' : '🕐'}</div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-room">Kamar ${escHtml(c.nomor_kamar || '-')}</span>
            <span class="timeline-date">📅 ${formatDate(c.tanggal_masuk)}</span>
          </div>
          ${c.keterangan ? `<div class="timeline-ket">📝 ${escHtml(c.keterangan)}</div>` : ''}
          <div class="timeline-by" style="margin-top:0.35rem;">👤 Petugas: ${escHtml(c.petugas || '-')} · ${formatDateTime(c.created_at)}</div>
        </div>
      </div>
    `).join('');
  }

  function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, renderTimeline, escHtml };
})();
