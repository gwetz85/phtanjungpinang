/**
 * Guests Panel — tampilan per Nama Tamu dengan riwayat check-in inline
 */

const guestsPanel = (() => {
  let currentPage = 1;
  let totalPages = 1;
  let searchTerm = '';
  let searchTimeout = null;
  let expandedId = null; // Currently expanded guest

  const MONTHS_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

  function init() {
    loadGuests();
    document.getElementById('guests-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchTerm = e.target.value.trim();
        currentPage = 1;
        expandedId = null;
        loadGuests();
      }, 400);
    });
    document.getElementById('guests-refresh')?.addEventListener('click', () => {
      expandedId = null;
      loadGuests();
    });
    document.getElementById('guests-export')?.addEventListener('click', exportExcel);
  }

  async function loadGuests() {
    const listEl = document.getElementById('guests-list');
    const infoEl = document.getElementById('guests-info');
    if (!listEl) return;

    listEl.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);"><div class="spinner" style="margin:0 auto;"></div></div>`;

    try {
      const res = await api.get('/guests', { page: currentPage, limit: 20, search: searchTerm });
      const { data, pagination } = res;
      totalPages = pagination.totalPages || 1;

      if (infoEl) {
        infoEl.textContent = `Total: ${pagination.total.toLocaleString('id-ID')} tamu · Halaman ${pagination.page}/${totalPages || 1}`;
      }

      if (!data || !data.length) {
        listEl.innerHTML = `<div class="empty-state" style="padding:2.5rem;"><div class="empty-icon">👥</div><p>Belum ada data tamu.</p></div>`;
        renderPagination(0, 0);
        return;
      }

      listEl.innerHTML = data.map((g, i) => `
        <div class="guest-name-card" id="gc-${g.id}" data-guest-id="${g.id}">
          <!-- ── Header Row (clickable) ── -->
          <div class="guest-card-header" onclick="guestsPanel.toggleExpand(${g.id})">
            <div class="user-avatar" style="width:44px;height:44px;font-size:1rem;flex-shrink:0;background:var(--primary-gradient);">
              ${getInitials(g.nama_tamu)}
            </div>

            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:1rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escHtml(g.nama_tamu)}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-top:0.25rem;">
                ${identityBadge(g.jenis_identitas)}
                <code style="font-size:0.78rem;color:var(--text-muted);">${escHtml(g.no_identitas)}</code>
                ${g.kewarganegaraan ? nationalityBadge(g.kewarganegaraan) : ''}
              </div>
            </div>

            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:0.82rem;color:var(--text-secondary);">${formatDate(g.last_checkin) || '—'}</div>
              ${g.last_room ? `<div style="font-size:0.75rem;color:var(--text-muted);">Kamar ${escHtml(g.last_room)}</div>` : ''}
              <div style="font-size:0.72rem;font-weight:600;color:var(--primary);margin-top:2px;">
                🏨 ${g.total_checkins || 0}x menginap
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.3rem;flex-shrink:0;" onclick="event.stopPropagation()">
              <button class="btn btn-warning btn-sm btn-icon" title="Edit" onclick="guestsPanel.editGuest(${g.id})">✏️</button>
              <button class="btn btn-danger btn-sm btn-icon" title="Hapus" onclick="guestsPanel.deleteGuest(${g.id}, '${escHtml(g.nama_tamu)}')">🗑️</button>
            </div>

            <div style="color:var(--text-muted);font-size:1rem;flex-shrink:0;transition:transform 0.2s;" id="arrow-${g.id}">▶</div>
          </div>

          <!-- ── Expandable Check-in History ── -->
          <div id="history-${g.id}" style="display:none;border-top:1px solid var(--border);background:var(--surface-2);padding:0 1.25rem 1rem;">
            <div style="padding-top:0.75rem;padding-bottom:0.25rem;font-size:0.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">
              📋 Riwayat Check-in
            </div>
            <div id="history-content-${g.id}">
              <div style="text-align:center;padding:1rem;color:var(--text-muted);"><div class="spinner" style="margin:0 auto;width:20px;height:20px;border-width:2px;"></div></div>
            </div>
          </div>
        </div>
      `).join('');

      // Auto-expand previously expanded guest
      if (expandedId && data.find(g => String(g.id) === String(expandedId))) {
        toggleExpand(expandedId, true);
      }

      renderPagination(currentPage, totalPages);
    } catch (err) {
      listEl.innerHTML = `<div class="alert alert-error" style="margin:1rem 0;"><span>❌</span><span>${err.message}</span></div>`;
    }
  }

  async function toggleExpand(guestId, skipToggle = false) {
    const historyEl = document.getElementById(`history-${guestId}`);
    const arrowEl   = document.getElementById(`arrow-${guestId}`);
    const cardEl    = document.getElementById(`gc-${guestId}`);
    const contentEl = document.getElementById(`history-content-${guestId}`);
    if (!historyEl) return;

    const isOpen = historyEl.style.display !== 'none';

    if (!skipToggle && isOpen) {
      // Collapse
      historyEl.style.display = 'none';
      if (arrowEl) arrowEl.style.transform = 'rotate(0deg)';
      if (cardEl) cardEl.style.borderColor = '';
      expandedId = null;
      return;
    }

    // Expand
    historyEl.style.display = 'block';
    if (arrowEl) arrowEl.style.transform = 'rotate(90deg)';
    if (cardEl) { cardEl.style.borderColor = 'var(--primary)'; cardEl.style.boxShadow = '0 0 0 1px var(--primary)'; }
    expandedId = guestId;

    // Load check-in history
    if (contentEl && (!contentEl.dataset.loaded || contentEl.dataset.guestId !== String(guestId))) {
      contentEl.innerHTML = `<div style="text-align:center;padding:1rem;color:var(--text-muted);"><div class="spinner" style="margin:0 auto;width:20px;height:20px;border-width:2px;"></div></div>`;
      try {
        const res = await api.get(`/guests/${guestId}`);
        const g = res.data;
        const checkins = g.checkins || [];

        if (!checkins.length) {
          contentEl.innerHTML = `<div style="padding:0.75rem 0;color:var(--text-muted);font-size:0.85rem;">Belum ada riwayat check-in.</div>`;
        } else {
          // Group by year-month
          const grouped = {};
          checkins.forEach(ci => {
            const dt = ci.tanggal_masuk ? ci.tanggal_masuk.substring(0, 7) : '—';
            if (!grouped[dt]) grouped[dt] = [];
            grouped[dt].push(ci);
          });

          const sortedKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

          contentEl.innerHTML = `
            <div style="margin-top:0.5rem;">
              ${sortedKeys.map(ym => {
                const [yr, mo] = ym.split('-');
                const moName = mo && mo !== '—' ? MONTHS_ID[parseInt(mo) - 1] : '';
                const label = moName ? `${moName} ${yr}` : ym;
                return `
                  <div style="margin-bottom:1rem;">
                    <div style="font-size:0.78rem;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.4rem;">
                      📅 ${label}
                    </div>
                    ${grouped[ym].map(ci => `
                      <div style="display:grid;grid-template-columns:auto 1fr auto;gap:0.75rem;align-items:start;padding:0.55rem 0.75rem;border-radius:8px;background:var(--surface);margin-bottom:0.35rem;border:1px solid var(--border);">
                        <div style="width:36px;height:36px;border-radius:8px;background:rgba(79,142,247,0.15);display:flex;align-items:center;justify-content:center;font-size:0.9rem;">🏠</div>
                        <div>
                          <div style="font-weight:600;color:var(--text-primary);font-size:0.88rem;">
                            ${ci.tanggal_masuk ? formatDate(ci.tanggal_masuk) : '—'}
                          </div>
                          ${ci.keterangan ? `<div style="font-size:0.76rem;color:var(--text-muted);margin-top:2px;">${escHtml(ci.keterangan)}</div>` : ''}
                        </div>
                        <div style="text-align:right;">
                          ${ci.nomor_kamar ? `<div style="font-weight:700;color:var(--primary);font-size:0.95rem;">Kamar ${escHtml(ci.nomor_kamar)}</div>` : ''}
                          ${ci.petugas ? `<div style="font-size:0.72rem;color:var(--text-muted);">Oleh: ${escHtml(ci.petugas)}</div>` : ''}
                        </div>
                      </div>
                    `).join('')}
                  </div>
                `;
              }).join('')}
              <div style="padding:0.5rem 0;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.25rem;">
                <button class="btn btn-primary btn-sm" onclick="dashboard.openCheckinModal('${guestId}', '${escHtml(g.nama_tamu)}')">➕ Check-in Baru</button>
                <button class="btn btn-ghost btn-sm" onclick="guestsPanel.editGuest(${guestId})">✏️ Edit</button>
              </div>
            </div>
          `;
        }
        contentEl.dataset.loaded = '1';
        contentEl.dataset.guestId = String(guestId);
      } catch (err) {
        contentEl.innerHTML = `<div style="color:var(--danger);font-size:0.85rem;padding:0.5rem 0;">Gagal memuat riwayat: ${err.message}</div>`;
      }
    }
  }

  function renderPagination(current, total) {
    const el = document.getElementById('guests-pagination');
    if (!el) return;
    if (total <= 1) { el.innerHTML = ''; return; }

    const pages = [];
    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || (i >= current - 2 && i <= current + 2)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }

    el.innerHTML = `
      <div class="pagination" style="padding:0.75rem 1.5rem;">
        <span style="font-size:0.82rem;color:var(--text-muted);">Halaman ${current} dari ${total}</span>
        <div class="pagination-buttons">
          <button class="page-btn" onclick="guestsPanel.goPage(${current - 1})" ${current === 1 ? 'disabled' : ''}>‹</button>
          ${pages.map(p => p === '...' ? `<span style="padding:0 0.35rem;color:var(--text-muted);">…</span>` : `<button class="page-btn ${p === current ? 'active' : ''}" onclick="guestsPanel.goPage(${p})">${p}</button>`).join('')}
          <button class="page-btn" onclick="guestsPanel.goPage(${current + 1})" ${current === total ? 'disabled' : ''}>›</button>
        </div>
      </div>
    `;
  }

  function goPage(p) {
    if (p < 1 || p > totalPages) return;
    currentPage = p;
    expandedId = null;
    loadGuests();
  }

  async function showDetail(guestId) {
    toggleExpand(guestId);
  }

  async function editGuest(guestId) {
    try {
      const res = await api.get(`/guests/${guestId}`);
      const g = res.data;
      createModal({
        id: 'edit-guest-modal',
        title: `✏️ Edit Tamu`,
        body: `
          <form id="edit-guest-form">
            <div class="form-group">
              <label class="form-label">No. Identitas</label>
              <input class="form-control" value="${escHtml(g.no_identitas)}" disabled style="opacity:0.6;">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="eg-nama">Nama Tamu</label>
                <input type="text" id="eg-nama" class="form-control" value="${escHtml(g.nama_tamu)}" required>
              </div>
              <div class="form-group">
                <label class="form-label" for="eg-umur">Umur</label>
                <input type="text" id="eg-umur" class="form-control" value="${escHtml(String(g.umur || ''))}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="eg-nat">Kewarganegaraan</label>
                <input type="text" id="eg-nat" class="form-control" value="${escHtml(g.kewarganegaraan || '')}">
              </div>
              <div class="form-group">
                <label class="form-label" for="eg-expiry">Expiry ID</label>
                <input type="text" id="eg-expiry" class="form-control" value="${escHtml(g.expiry_identitas || '')}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="eg-dari">Datang Dari</label>
              <input type="text" id="eg-dari" class="form-control" value="${escHtml(g.datang_dari || '')}">
            </div>
          </form>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="document.getElementById('edit-guest-modal').remove()">Batal</button>
          <button class="btn btn-primary" id="edit-save-btn">💾 Simpan</button>
        `
      });

      document.getElementById('edit-save-btn').addEventListener('click', async () => {
        try {
          await api.put(`/guests/${guestId}`, {
            nama_tamu:        document.getElementById('eg-nama').value.trim(),
            umur:             document.getElementById('eg-umur').value.trim(),
            kewarganegaraan:  document.getElementById('eg-nat').value.trim(),
            expiry_identitas: document.getElementById('eg-expiry').value.trim(),
            datang_dari:      document.getElementById('eg-dari').value.trim(),
          });
          toast('Data tamu berhasil diperbarui!', 'success');
          document.getElementById('edit-guest-modal').remove();
          // Invalidate cache for this guest
          const contentEl = document.getElementById(`history-content-${guestId}`);
          if (contentEl) delete contentEl.dataset.loaded;
          loadGuests();
        } catch (err) { toast(err.message, 'error'); }
      });
    } catch (err) { toast(err.message, 'error'); }
  }

  function deleteGuest(guestId, nama) {
    confirmDialog(
      `Anda yakin ingin menghapus tamu <strong>${escHtml(nama)}</strong>? Semua riwayat check-in juga akan dihapus.`,
      async () => {
        try {
          await api.del(`/guests/${guestId}`);
          toast('Data tamu berhasil dihapus.', 'success');
          loadGuests();
        } catch (err) { toast(err.message, 'error'); }
      }
    );
  }

  async function exportExcel() {
    try {
      toast('Mempersiapkan export...', 'info');
      const res = await api.download('/excel/export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PH-Hotel-Export-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Export berhasil!', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  function escHtml(str) { return searchPanel.escHtml(str); }

  return { init, loadGuests, showDetail, editGuest, deleteGuest, goPage, toggleExpand };
})();
