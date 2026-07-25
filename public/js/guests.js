/**
 * Guests Panel — tabel semua data tamu (Admin+)
 */

const guestsPanel = (() => {
  let currentPage = 1;
  let totalPages = 1;
  let searchTerm = '';
  let searchTimeout = null;

  function init() {
    loadGuests();
    document.getElementById('guests-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchTerm = e.target.value.trim();
        currentPage = 1;
        loadGuests();
      }, 400);
    });
    document.getElementById('guests-refresh')?.addEventListener('click', loadGuests);
    document.getElementById('guests-export')?.addEventListener('click', exportExcel);
  }

  async function loadGuests() {
    const tbody = document.getElementById('guests-tbody');
    const infoEl = document.getElementById('guests-info');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">
      <div class="spinner" style="margin:0 auto;"></div>
    </td></tr>`;

    try {
      const res = await api.get('/guests', { page: currentPage, limit: 20, search: searchTerm });
      const { data, pagination } = res;
      totalPages = pagination.totalPages;

      if (infoEl) {
        infoEl.textContent = `Total: ${pagination.total} tamu · Halaman ${pagination.page}/${totalPages || 1}`;
      }

      if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">👥</div><p>Belum ada data tamu.</p></div></td></tr>`;
        renderPagination(0, 0);
        return;
      }

      tbody.innerHTML = data.map((g, i) => `
        <tr data-guest-id="${g.id}" title="Klik untuk detail">
          <td>${(currentPage - 1) * 20 + i + 1}</td>
          <td class="td-main">${escHtml(g.nama_tamu)}</td>
          <td>
            <div style="display:flex;flex-direction:column;gap:0.2rem;">
              ${identityBadge(g.jenis_identitas)}
              <code style="font-size:0.78rem;color:var(--text-secondary);">${escHtml(g.no_identitas)}</code>
            </div>
          </td>
          <td>${escHtml(g.umur || '-')}</td>
          <td>${nationalityBadge(g.kewarganegaraan)}</td>
          <td>${escHtml(g.datang_dari || '-')}</td>
          <td>
            <div style="font-size:0.82rem;">${formatDate(g.last_checkin)}</div>
            ${g.last_room ? `<div style="font-size:0.75rem;color:var(--text-muted);">Kamar ${escHtml(g.last_room)}</div>` : ''}
            <div style="font-size:0.72rem;color:var(--primary);">${g.total_checkins || 0}x menginap</div>
          </td>
          <td>
            <div style="display:flex;gap:0.4rem;" onclick="event.stopPropagation()">
              <button class="btn btn-ghost btn-sm btn-icon" title="Detail" onclick="guestsPanel.showDetail(${g.id})">👁️</button>
              <button class="btn btn-warning btn-sm btn-icon" title="Edit" onclick="guestsPanel.editGuest(${g.id})">✏️</button>
              <button class="btn btn-danger btn-sm btn-icon" title="Hapus" onclick="guestsPanel.deleteGuest(${g.id}, '${escHtml(g.nama_tamu)}')">🗑️</button>
            </div>
          </td>
        </tr>
      `).join('');

      // Row click → detail
      tbody.querySelectorAll('tr[data-guest-id]').forEach(tr => {
        tr.addEventListener('click', () => guestsPanel.showDetail(tr.dataset.guestId));
      });

      renderPagination(currentPage, totalPages);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="alert alert-error"><span>❌</span><span>${err.message}</span></div></td></tr>`;
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
      <div class="pagination">
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
    loadGuests();
  }

  async function showDetail(guestId) {
    try {
      const res = await api.get(`/guests/${guestId}`);
      const g = res.data;
      createModal({
        id: 'guest-detail-modal-2',
        title: `🧍 ${escHtml(g.nama_tamu)}`,
        size: 'modal-lg',
        body: `
          <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;">
            <div class="guest-avatar-lg">${getInitials(g.nama_tamu)}</div>
            <div>
              <div style="font-size:1.2rem;font-weight:700;color:var(--text-primary);">${escHtml(g.nama_tamu)}</div>
              <div class="guest-meta" style="margin-top:0.35rem;">
                ${identityBadge(g.jenis_identitas)}
                <code style="font-size:0.85rem;color:var(--text-secondary);">${escHtml(g.no_identitas)}</code>
                ${nationalityBadge(g.kewarganegaraan)}
              </div>
            </div>
          </div>
          <div class="guest-detail-grid" style="padding:0;margin-bottom:1.5rem;">
            <div class="detail-item"><label>Umur</label><span>${escHtml(String(g.umur || '-'))}</span></div>
            <div class="detail-item"><label>Expiry ID</label><span>${escHtml(g.expiry_identitas || '-')}</span></div>
            <div class="detail-item"><label>Datang Dari</label><span>${escHtml(g.datang_dari || '-')}</span></div>
            <div class="detail-item"><label>Terdaftar</label><span>${formatDateTime(g.created_at)}</span></div>
          </div>
          <hr class="divider" style="margin:0 0 1.5rem;">
          <div class="timeline">
            <div class="timeline-title">📋 Riwayat Check-in (${g.checkins?.length || 0}x)</div>
            ${searchPanel.renderTimeline(g.checkins || [])}
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="document.getElementById('guest-detail-modal-2').remove()">Tutup</button>
          <button class="btn btn-primary" onclick="document.getElementById('guest-detail-modal-2').remove(); dashboard.openCheckinModal('${g.id}', '${escHtml(g.nama_tamu)}')">➕ Check-in</button>
        `
      });
    } catch (err) { toast(err.message, 'error'); }
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
            nama_tamu: document.getElementById('eg-nama').value.trim(),
            umur: document.getElementById('eg-umur').value.trim(),
            kewarganegaraan: document.getElementById('eg-nat').value.trim(),
            expiry_identitas: document.getElementById('eg-expiry').value.trim(),
            datang_dari: document.getElementById('eg-dari').value.trim(),
          });
          toast('Data tamu berhasil diperbarui!', 'success');
          document.getElementById('edit-guest-modal').remove();
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

  return { init, loadGuests, showDetail, editGuest, deleteGuest, goPage };
})();
