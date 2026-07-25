/**
 * Guests Panel — Table View with expandable check-in history
 */

const guestsPanel = (() => {
  let currentPage = 1;
  let totalPages = 1;
  let searchTerm = '';
  let searchTimeout = null;
  let expandedId = null;

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
    const tbody = document.getElementById('guests-tbody');
    const infoEl = document.getElementById('guests-info');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-muted);"><div class="spinner" style="margin:0 auto;"></div></td></tr>`;

    try {
      const res = await api.get('/guests', { page: currentPage, limit: 20, search: searchTerm });
      const { data, pagination } = res;
      totalPages = pagination.totalPages || 1;

      if (infoEl) {
        infoEl.textContent = `Total: ${pagination.total.toLocaleString('id-ID')} tamu · Halaman ${pagination.page}/${totalPages || 1}`;
      }

      if (!data || !data.length) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state" style="padding:2.5rem;"><div class="empty-icon">👥</div><p>Belum ada data tamu.</p></div></td></tr>`;
        renderPagination(0, 0);
        return;
      }

      const startNo = ((pagination.page - 1) * 20) + 1;
      const u = auth.getUser();
      const isAdmin = u && (u.role === 'admin' || u.role === 'superadmin');

      tbody.innerHTML = data.map((g, i) => {
        const age = getRealtimeAge(g.umur);
        const ageDisplay = age ? `${age}` : '-';

        return `
          <tr class="guest-row" id="gr-${g.id}" onclick="guestsPanel.toggleExpand(${g.id})">
            <td style="color:var(--text-muted);font-weight:600;">${startNo + i}</td>
            <td>
              <span class="guest-name-cell">${escHtml(g.nama_tamu)}</span>
            </td>
            <td>
              <div class="identity-cell">
                ${identityBadge(g.jenis_identitas)}
                <code>${escHtml(g.no_identitas)}</code>
              </div>
            </td>
            <td class="age-cell">
              ${ageDisplay !== '-' ? `<span>${ageDisplay}</span><span class="age-unit">Tahun</span>` : '<span style="color:var(--text-muted);">-</span>'}
            </td>
            <td>${g.kewarganegaraan ? nationalityBadge(g.kewarganegaraan) : '<span style="color:var(--text-muted);">-</span>'}</td>
            <td style="font-size:0.82rem;">${formatDate(g.last_checkin) || '<span style="color:var(--text-muted);">—</span>'}</td>
            <td style="font-weight:600;color:var(--primary);">${g.last_room ? escHtml(g.last_room) : '<span style="color:var(--text-muted);">-</span>'}</td>
            <td style="text-align:center;">
              <span style="font-weight:700;color:var(--primary);">${g.total_checkins || 0}x</span>
            </td>
            <td onclick="event.stopPropagation()">
              <div class="actions-cell">
                <button class="btn btn-ghost btn-sm" title="Detail" onclick="guestsPanel.toggleExpand(${g.id})">👁️</button>
                ${isAdmin ? `
                  <button class="btn btn-warning btn-sm" title="Edit" onclick="guestsPanel.editGuest(${g.id})">✏️</button>
                  <button class="btn btn-danger btn-sm" title="Hapus" onclick="guestsPanel.deleteGuest(${g.id}, '${escHtml(g.nama_tamu)}')">🗑️</button>
                ` : ''}
              </div>
            </td>
          </tr>
          <tr class="detail-row" id="detail-${g.id}" style="display:none;">
            <td colspan="9">
              <div class="detail-content" id="detail-content-${g.id}">
                <div style="text-align:center;padding:1rem;color:var(--text-muted);"><div class="spinner" style="margin:0 auto;width:20px;height:20px;border-width:2px;"></div></div>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Auto-expand previously expanded guest
      if (expandedId && data.find(g => String(g.id) === String(expandedId))) {
        toggleExpand(expandedId, true);
      }

      renderPagination(currentPage, totalPages);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="alert alert-error" style="margin:1rem;">\u274C ${err.message}</div></td></tr>`;
    }
  }

  async function toggleExpand(guestId, skipToggle = false) {
    const detailRow = document.getElementById(`detail-${guestId}`);
    const guestRow  = document.getElementById(`gr-${guestId}`);
    const contentEl = document.getElementById(`detail-content-${guestId}`);
    if (!detailRow) return;

    const isOpen = detailRow.style.display !== 'none';

    // Close all other detail rows first
    document.querySelectorAll('.detail-row').forEach(row => {
      if (row.id !== `detail-${guestId}`) {
        row.style.display = 'none';
        const otherId = row.id.replace('detail-', '');
        const otherGuestRow = document.getElementById(`gr-${otherId}`);
        if (otherGuestRow) otherGuestRow.style.background = '';
      }
    });

    if (!skipToggle && isOpen) {
      detailRow.style.display = 'none';
      if (guestRow) guestRow.style.background = '';
      expandedId = null;
      return;
    }

    // Expand
    detailRow.style.display = 'table-row';
    if (guestRow) guestRow.style.background = 'rgba(79, 142, 247, 0.08)';
    expandedId = guestId;

    // Load check-in history
    if (contentEl && (!contentEl.dataset.loaded || contentEl.dataset.guestId !== String(guestId))) {
      contentEl.innerHTML = `<div style="text-align:center;padding:1rem;color:var(--text-muted);"><div class="spinner" style="margin:0 auto;width:20px;height:20px;border-width:2px;"></div></div>`;
      try {
        const res = await api.get(`/guests/${guestId}`);
        const g = res.data;
        const checkins = g.checkins || [];

        // Guest detail header grid
        const detailGrid = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:0.75rem;padding:0.75rem 1rem;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid var(--border);margin-bottom:1rem;font-size:0.85rem;">
            <div><span style="color:var(--text-muted);">Tanggal Lahir:</span> <strong style="color:var(--text-primary);">${escHtml(g.umur || '-')}</strong></div>
            <div><span style="color:var(--text-muted);">Umur (Real-time):</span> <strong style="color:var(--primary);">${getRealtimeAge(g.umur) || '-'}</strong></div>
            <div><span style="color:var(--text-muted);">Expiry ID:</span> <strong style="color:var(--text-primary);">${escHtml(g.expiry_identitas || '-')}</strong></div>
            <div><span style="color:var(--text-muted);">Datang Dari:</span> <strong style="color:var(--text-primary);">${escHtml(g.datang_dari || '-')}</strong></div>
          </div>
        `;

        const u = auth.getUser();
        const isAdmin = u && (u.role === 'admin' || u.role === 'superadmin');

        if (!checkins.length) {
          contentEl.innerHTML = `
            ${detailGrid}
            <div style="padding:0.5rem 0;color:var(--text-muted);font-size:0.85rem;">Belum ada riwayat check-in.</div>
            <div style="padding:0.5rem 0;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem;">
              <button class="btn btn-primary btn-sm" onclick="dashboard.openCheckinModal('${guestId}', '${escHtml(g.nama_tamu)}')">➕ Check-in Baru</button>
              ${isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="guestsPanel.editGuest(${guestId})">✏️ Edit</button>` : ''}
            </div>
          `;
        } else {
          // Group by year-month
          const grouped = {};
          checkins.forEach(ci => {
            const dt = ci.tanggal_masuk ? ci.tanggal_masuk.substring(0, 7) : '—';
            if (!grouped[dt]) grouped[dt] = [];
            grouped[dt].push(ci);
          });

          const sortedKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

          // Render check-in history as mini table
          contentEl.innerHTML = `
            ${detailGrid}
            <div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">📋 Riwayat Check-in (${checkins.length}x)</div>
            <table style="width:100%;border-collapse:collapse;font-size:0.82rem;margin-bottom:0.75rem;">
              <thead>
                <tr style="border-bottom:1px solid var(--border);">
                  <th style="padding:0.5rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;">Tanggal</th>
                  <th style="padding:0.5rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;">Kamar</th>
                  <th style="padding:0.5rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;">Keterangan</th>
                  <th style="padding:0.5rem 0.75rem;text-align:left;color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;">Petugas</th>
                </tr>
              </thead>
              <tbody>
                ${checkins.map(ci => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                    <td style="padding:0.5rem 0.75rem;color:var(--text-primary);">${ci.tanggal_masuk ? formatDate(ci.tanggal_masuk) : '—'}</td>
                    <td style="padding:0.5rem 0.75rem;font-weight:600;color:var(--primary);">${ci.nomor_kamar ? escHtml(ci.nomor_kamar) : '-'}</td>
                    <td style="padding:0.5rem 0.75rem;color:var(--text-secondary);">${ci.keterangan ? escHtml(ci.keterangan) : '-'}</td>
                    <td style="padding:0.5rem 0.75rem;color:var(--text-muted);font-size:0.78rem;">${ci.petugas ? escHtml(ci.petugas) : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
              <button class="btn btn-primary btn-sm" onclick="dashboard.openCheckinModal('${guestId}', '${escHtml(g.nama_tamu)}')">➕ Check-in Baru</button>
              ${isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="guestsPanel.editGuest(${guestId})">✏️ Edit</button>` : ''}
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
        title: '✏️ Edit Data Tamu',
        size: 'modal-lg',
        body: `
          <form id="edit-guest-form">
            <div class="form-row">
              <div class="form-group" style="flex: 0 0 35%;">
                <label class="form-label">Jenis Identitas</label>
                <select id="eg-jenis-identitas" class="form-control" style="padding:0.6rem 0.5rem;">
                  <option value="NIK" ${g.jenis_identitas === 'NIK' ? 'selected' : ''}>NIK</option>
                  <option value="PASSPORT" ${g.jenis_identitas === 'PASSPORT' ? 'selected' : ''}>Psp no</option>
                  <option value="SIM" ${g.jenis_identitas === 'SIM' ? 'selected' : ''}>SIM</option>
                </select>
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">No. Identitas</label>
                <input class="form-control" value="${escHtml(g.no_identitas)}" disabled style="opacity:0.6;">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="eg-nama">Nama Tamu</label>
                <input type="text" id="eg-nama" class="form-control" value="${escHtml(g.nama_tamu)}" required>
              </div>
              <div class="form-group">
                <label class="form-label" for="eg-umur">Tanggal Lahir</label>
                <input type="date" id="eg-umur" class="form-control" value="${g.umur && /^\d{4}-\d{2}-\d{2}$/.test(String(g.umur).trim()) ? String(g.umur).trim() : ''}">
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
            jenis_identitas:  document.getElementById('eg-jenis-identitas').value,
            umur:             document.getElementById('eg-umur').value.trim(),
            kewarganegaraan:  document.getElementById('eg-nat').value.trim(),
            expiry_identitas: document.getElementById('eg-expiry').value.trim(),
            datang_dari:      document.getElementById('eg-dari').value.trim(),
          });
          toast('Data tamu berhasil diperbarui!', 'success');
          document.getElementById('edit-guest-modal').remove();
          // Invalidate cache for this guest
          const contentEl = document.getElementById(`detail-content-${guestId}`);
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
