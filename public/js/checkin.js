/**
 * Check-in Module — tambah tamu baru atau check-in ulang
 */

const checkinModule = (() => {
  let lookupTimeout = null;
  let foundGuestId = null;

  function init() {
    const identitasInput = document.getElementById('ci-identitas');
    if (!identitasInput) return;

    identitasInput.addEventListener('input', () => {
      clearTimeout(lookupTimeout);
      foundGuestId = null;
      const val = identitasInput.value.trim();
      if (val.length >= 4) {
        lookupTimeout = setTimeout(() => lookupGuest(val), 500);
      } else {
        resetLookup();
      }
    });

    document.getElementById('ci-form').addEventListener('submit', handleSubmit);
    document.getElementById('ci-clear-btn')?.addEventListener('click', resetForm);
  }

  async function lookupGuest(q) {
    const indicator = document.getElementById('ci-lookup-indicator');
    const guestInfoDiv = document.getElementById('ci-guest-info');
    indicator.innerHTML = `<span style="color:var(--text-muted);font-size:0.85rem;">🔍 Mencari...</span>`;

    try {
      const res = await api.get('/guests/search', { q });
      const guests = res.data || [];

      // Exact match
      const exact = guests.find(g => g.no_identitas === q);
      const found = exact || (guests.length === 1 ? guests[0] : null);

      if (found) {
        foundGuestId = found.id;
        indicator.innerHTML = `
          <div class="found-indicator">
            ✅ Tamu ditemukan! Data akan diperbarui otomatis.
          </div>`;
        guestInfoDiv.style.display = 'block';
        populateGuestInfo(found);
        // Pre-fill fields
        document.getElementById('ci-nama').value = found.nama_tamu || '';
        document.getElementById('ci-jenis-identitas').value = found.jenis_identitas || 'NIK';
        document.getElementById('ci-umur').value = found.umur && /^\d{4}-\d{2}-\d{2}$/.test(String(found.umur).trim()) ? String(found.umur).trim() : '';
        document.getElementById('ci-expiry').value = found.expiry_identitas || '';
        document.getElementById('ci-nationality').value = found.kewarganegaraan || '';
        document.getElementById('ci-dari').value = found.datang_dari || '';
      } else if (guests.length === 0) {
        foundGuestId = null;
        indicator.innerHTML = `
          <div class="not-found-indicator">
            ⚠️ Tamu baru — akan ditambahkan sebagai tamu baru.
          </div>`;
        guestInfoDiv.style.display = 'none';
        clearGuestFields();
      } else {
        // Multiple — show first match
        foundGuestId = null;
        indicator.innerHTML = `<span style="color:var(--text-muted);font-size:0.85rem;">${guests.length} hasil ditemukan. Lengkapi nomor identitas.</span>`;
        guestInfoDiv.style.display = 'none';
      }
    } catch {
      indicator.innerHTML = '';
    }
  }

  function populateGuestInfo(g) {
    const div = document.getElementById('ci-guest-info');
    div.innerHTML = `
      <div class="card" style="border-color:rgba(16,185,129,0.3);background:rgba(16,185,129,0.05);">
        <div class="card-body" style="padding:1rem;">
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
            <div class="user-avatar" style="width:44px;height:44px;font-size:1rem;">${getInitials(g.nama_tamu)}</div>
            <div>
              <div style="font-weight:700;color:var(--text-primary);">${escHtml(g.nama_tamu)}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">
                ${identityBadge(g.jenis_identitas)} ${escHtml(g.no_identitas)} &nbsp;·&nbsp; ${g.total_checkins || 0}x menginap
              </div>
            </div>
          </div>
          ${g.last_checkin ? `<div style="font-size:0.82rem;color:var(--text-secondary);">🕐 Terakhir: ${formatDate(g.last_checkin)} — Kamar ${escHtml(g.last_room || '-')}</div>` : ''}
        </div>
      </div>
    `;
  }

  function clearGuestFields() {
    ['ci-nama','ci-umur','ci-expiry','ci-nationality','ci-dari'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  function resetLookup() {
    foundGuestId = null;
    document.getElementById('ci-lookup-indicator').innerHTML = '';
    document.getElementById('ci-guest-info').style.display = 'none';
    document.getElementById('ci-guest-info').innerHTML = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('ci-submit-btn');
    const btnText = document.getElementById('ci-submit-text');
    btn.disabled = true;
    btnText.textContent = 'Menyimpan...';

    const body = {
      no_identitas: document.getElementById('ci-identitas').value.trim(),
      jenis_identitas: document.getElementById('ci-jenis-identitas').value,
      nama_tamu: document.getElementById('ci-nama').value.trim(),
      umur: document.getElementById('ci-umur').value.trim(),
      expiry_identitas: document.getElementById('ci-expiry').value.trim(),
      kewarganegaraan: document.getElementById('ci-nationality').value.trim(),
      datang_dari: document.getElementById('ci-dari').value.trim(),
      nomor_kamar: document.getElementById('ci-room').value.trim(),
      tanggal_masuk: document.getElementById('ci-date').value,
      keterangan: document.getElementById('ci-ket').value.trim(),
    };

    if (!body.no_identitas || !body.nama_tamu) {
      toast('Nomor Identitas dan Nama Tamu wajib diisi!', 'warning');
      btn.disabled = false;
      btnText.textContent = 'Simpan Check-in';
      return;
    }

    try {
      let res;
      if (foundGuestId) {
        // Add check-in to existing guest
        res = await api.post(`/guests/${foundGuestId}/checkin`, {
          nomor_kamar: body.nomor_kamar,
          tanggal_masuk: body.tanggal_masuk,
          keterangan: body.keterangan
        });
        // Also update guest data
        await api.put(`/guests/${foundGuestId}`, {
          nama_tamu: body.nama_tamu,
          jenis_identitas: body.jenis_identitas,
          umur: body.umur,
          expiry_identitas: body.expiry_identitas,
          kewarganegaraan: body.kewarganegaraan,
          datang_dari: body.datang_dari
        });
      } else {
        res = await api.post('/guests', body);
      }

      toast(res.message || 'Check-in berhasil!', 'success');
      resetForm();

      // Show result
      showCheckinSuccess(res.data);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btnText.textContent = 'Simpan Check-in';
    }
  }

  function showCheckinSuccess(guest) {
    const div = document.getElementById('ci-success-result');
    if (!div || !guest) return;
    div.style.display = 'block';
    div.innerHTML = `
      <div class="card" style="border-color:rgba(16,185,129,0.4);background:rgba(16,185,129,0.07);animation:fadeIn 0.4s ease;">
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;">
            <span style="font-size:1.5rem;">✅</span>
            <div>
              <div style="font-weight:700;color:var(--success);">Check-in Berhasil Disimpan</div>
              <div style="font-size:0.82rem;color:var(--text-secondary);">${guest.nama_tamu}</div>
            </div>
          </div>
          ${searchPanel.renderTimeline((guest.checkins || []).slice(0, 1))}
        </div>
      </div>
    `;
  }

  function resetForm() {
    document.getElementById('ci-form').reset();
    resetLookup();
    const successDiv = document.getElementById('ci-success-result');
    if (successDiv) { successDiv.style.display = 'none'; successDiv.innerHTML = ''; }
    // Set today as default date
    const dateInput = document.getElementById('ci-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
  }

  // Open from other panels (quick check-in modal for existing guest)
  function openCheckinModal(guestId, guestName) {
    createModal({
      id: 'quick-checkin-modal',
      title: `➕ Check-in: ${escHtml(guestName)}`,
      body: `
        <form id="quick-ci-form">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="qci-room">Nomor Kamar</label>
              <input type="text" id="qci-room" class="form-control" placeholder="Contoh: 101" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="qci-date">Tanggal Masuk</label>
              <input type="date" id="qci-date" class="form-control" value="${new Date().toISOString().split('T')[0]}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="qci-ket">Keterangan</label>
            <textarea id="qci-ket" class="form-control" rows="2" placeholder="Opsional..."></textarea>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="document.getElementById('quick-checkin-modal').remove()">Batal</button>
        <button class="btn btn-primary" id="qci-save-btn">💾 Simpan</button>
      `
    });

    document.getElementById('qci-save-btn').addEventListener('click', async () => {
      const room = document.getElementById('qci-room').value.trim();
      const date = document.getElementById('qci-date').value;
      const ket = document.getElementById('qci-ket').value.trim();
      if (!room) { toast('Nomor kamar wajib diisi!', 'warning'); return; }
      try {
        const res = await api.post(`/guests/${guestId}/checkin`, { nomor_kamar: room, tanggal_masuk: date, keterangan: ket });
        toast(res.message, 'success');
        document.getElementById('quick-checkin-modal').remove();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function escHtml(str) { return searchPanel.escHtml(str); }

  return { init, openCheckinModal, resetForm };
})();
