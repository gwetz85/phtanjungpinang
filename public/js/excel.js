/**
 * Excel Upload Panel (Superadmin only)
 */

const excelPanel = (() => {
  let uploadedFile   = null;
  let rawFile        = null; // Store actual HTML5 File object for Vercel stateless upload
  let selectedSheets = [];   // array — bisa 1 sheet atau semua
  let sheetHeaders   = [];   // headers dari sheet pertama yang dipilih (untuk mapping)

  // Default column mapping — keywords to match against Excel headers (case-insensitive)
  // Multiple aliases supported per field
  const MAPPING_ALIASES = {
    no_identitas:    ['IDENTITAS', 'NIK', 'PASSPORT', 'NO IDENTITAS', 'NO_IDENTITAS', 'ID'],
    nama_tamu:       ['NAMA TAMU', 'NAMA', 'NAME', 'GUEST NAME', 'NAMA_TAMU'],
    umur:            ['UMUR', 'AGE', 'USIA'],
    expiry_identitas:['EXPIRY', 'EXPIRED', 'MASA BERLAKU', 'EXP'],
    kewarganegaraan: ['NATIONALITY', 'KEWARGANEGARAAN', 'WN', 'NEGARA'],
    datang_dari:     ['DATANG DARI', 'DATANG_DARI', 'ASAL', 'FROM', 'ORIGIN'],
    nomor_kamar:     ['ROOM NO', 'ROOM', 'KAMAR', 'NO KAMAR', 'ROOM NUMBER', 'NO ROOM'],
    tanggal_masuk:   ['TANGGAL MASUK', 'TGL MASUK', 'CHECK IN', 'CHECKIN', 'CHECK-IN', 'DATE IN'],
    keterangan:      ['KET', 'KETERANGAN', 'NOTES', 'NOTE', 'REMARKS', 'INFO'],
  };

  const FIELD_LABELS = {
    no_identitas:    'No. Identitas (NIK/Passport)',
    nama_tamu:       'Nama Tamu *',
    umur:            'Umur',
    expiry_identitas:'Expiry ID',
    kewarganegaraan: 'Kewarganegaraan',
    datang_dari:     'Datang Dari',
    nomor_kamar:     'Nomor Kamar',
    tanggal_masuk:   'Tanggal Masuk',
    keterangan:      'Keterangan',
  };

  const EMPTY_OPT = '— Tidak dipakai —';

  /**
   * Find the best matching header for a field, case-insensitive
   */
  function autoMatch(field, headers) {
    const aliases = MAPPING_ALIASES[field] || [];
    const headersUpper = headers.map(h => String(h).trim().toUpperCase());

    for (const alias of aliases) {
      const aliasUpper = alias.toUpperCase();
      // Exact match first
      const exactIdx = headersUpper.indexOf(aliasUpper);
      if (exactIdx !== -1) return headers[exactIdx];
      // Contains match
      const containsIdx = headersUpper.findIndex(h => h.includes(aliasUpper) || aliasUpper.includes(h));
      if (containsIdx !== -1) return headers[containsIdx];
    }
    return null;
  }

  function init() {
    const dropzone = document.getElementById('excel-dropzone');
    const fileInput = document.getElementById('excel-file-input');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      handleFile(e.dataTransfer.files[0]);
    });

    document.getElementById('excel-import-btn')?.addEventListener('click', doImport);
    document.getElementById('excel-reset-btn')?.addEventListener('click', resetPanel);
    document.getElementById('excel-clear-db-btn')?.addEventListener('click', clearDatabase);

    // Pre-fill month picker with current month (YYYY-MM)
    const picker = document.getElementById('import-month-picker');
    if (picker) {
      const now = new Date();
      picker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
  }

  async function handleFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
      toast('Hanya file .xlsx atau .xls yang diizinkan!', 'error'); return;
    }

    rawFile = file; // Store actual File object
    const formData = new FormData();
    formData.append('file', file);

    document.getElementById('excel-upload-status').innerHTML = `
      <div style="text-align:center;padding:1rem;color:var(--text-secondary);">
        <div class="spinner" style="margin:0 auto 0.5rem;"></div>
        Mengupload file...
      </div>`;
    document.getElementById('excel-sheet-section').style.display = 'none';
    document.getElementById('excel-mapping-section').style.display = 'none';
    document.getElementById('excel-import-btn').style.display = 'none';

    try {
      const res = await api.upload('/excel/upload', formData);
      uploadedFile = { path: res.filePath, name: res.originalName, sheets: res.sheets };

      document.getElementById('excel-upload-status').innerHTML = `
        <div class="alert alert-success">
          <span>✅</span>
          <span>File <strong>${escHtml(res.originalName)}</strong> berhasil diupload. Ditemukan <strong>${res.sheets.length}</strong> sheet.</span>
        </div>`;

      renderSheetList(res.sheets);
    } catch (err) {
      document.getElementById('excel-upload-status').innerHTML = `
        <div class="alert alert-error"><span>❌</span><span>${err.message}</span></div>`;
    }
  }

  function renderSheetList(sheets) {
    const section = document.getElementById('excel-sheet-section');
    section.style.display = 'block';
    const list = document.getElementById('sheet-list');

    const totalRows = sheets.reduce((sum, s) => sum + (s.rowCount || 0), 0);

    list.innerHTML = `
      <div id="all-sheets-card" style="
        background: linear-gradient(135deg, rgba(79,142,247,0.2), rgba(124,58,237,0.15));
        border: 2px solid var(--primary);
        border-radius: var(--radius);
        padding: 1rem 1.25rem;
        cursor: pointer;
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: all var(--transition);
        box-shadow: 0 4px 16px rgba(79,142,247,0.2);
      ">
        <div>
          <div style="font-weight:700;color:var(--text-primary);font-size:1.05rem;">📦 Import SEMUA Sheet Sekaligus</div>
          <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:0.25rem;">
            ${sheets.length} sheet · ${totalRows.toLocaleString()} total baris data
          </div>
        </div>
        <span style="font-size:1.5rem;color:var(--primary);">🚀</span>
      </div>

      <div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);margin-bottom:0.6rem;letter-spacing:0.06em;">
        — ATAU PILIH SATU SHEET SPESIFIK —
      </div>

      <div class="sheet-items-container" style="display:flex;flex-direction:column;gap:0.4rem;">
        ${sheets.map(s => `
          <div class="sheet-item" data-sheet="${escHtml(s.name)}">
            <div>
              <div class="sheet-name">📋 ${escHtml(s.name)}</div>
              <div class="sheet-count">${s.rowCount} baris · ${(s.headers || []).filter(Boolean).length} kolom</div>
            </div>
            <span style="color:var(--text-muted);">›</span>
          </div>
        `).join('')}
      </div>
    `;

    // Click ALL SHEETS
    const allCard = document.getElementById('all-sheets-card');
    if (allCard) {
      allCard.addEventListener('click', () => selectAllSheets(sheets));
    }

    // Click individual sheets
    list.querySelectorAll('.sheet-item').forEach(el => {
      el.addEventListener('click', () => {
        const sheet = sheets.find(s => s.name === el.dataset.sheet);
        if (sheet) selectOneSheet(sheet.name, sheet.headers);
      });
    });
  }

  // Select ALL sheets & trigger import automatically!
  function selectAllSheets(sheets) {
    selectedSheets = sheets.map(s => s.name);
    sheetHeaders   = sheets[0]?.headers || [];

    // Highlight card
    const allCard = document.getElementById('all-sheets-card');
    if (allCard) {
      allCard.style.borderColor = 'var(--primary)';
      allCard.style.background   = 'linear-gradient(135deg, rgba(79,142,247,0.3), rgba(124,58,237,0.2))';
    }
    document.querySelectorAll('.sheet-item').forEach(el => el.classList.remove('selected'));

    renderMapping(sheetHeaders, `Mode: Import SEMUA Sheet (${sheets.length} sheet · ${sheets.reduce((sum, s) => sum + s.rowCount, 0).toLocaleString()} baris)`);
    showMappingAndScroll();

    // Auto-start import immediately!
    doImport();
  }

  // Select ONE sheet & trigger import automatically!
  function selectOneSheet(sheetName, headers) {
    selectedSheets = [sheetName];
    sheetHeaders   = headers;

    const allCard = document.getElementById('all-sheets-card');
    if (allCard) {
      allCard.style.borderColor = 'rgba(79,142,247,0.4)';
      allCard.style.background   = 'linear-gradient(135deg, rgba(79,142,247,0.15), rgba(124,58,237,0.1))';
    }
    document.querySelectorAll('.sheet-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.sheet === sheetName);
    });

    renderMapping(headers, `Mode: Import Sheet "${escHtml(sheetName)}"`);
    showMappingAndScroll();

    // Auto-start import immediately!
    doImport();
  }

  function showMappingAndScroll() {
    const mapSec = document.getElementById('excel-mapping-section');
    if (mapSec) mapSec.style.display = 'block';

    const mainBtn = document.getElementById('excel-import-btn');
    if (mainBtn) {
      mainBtn.style.display = 'flex';
      mainBtn.innerHTML = selectedSheets.length > 1
        ? `🚀 Import SEMUA ${selectedSheets.length} Sheet`
        : `🚀 Import Sheet "${escHtml(selectedSheets[0])}"`;
    }

    mapSec?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderMapping(headers, modeLabel = '') {
    const container = document.getElementById('mapping-container');

    const validHeaders = headers.filter(h => h && String(h).trim());

    // Build auto-matched values BEFORE rendering HTML
    const matched = {};
    for (const field of Object.keys(FIELD_LABELS)) {
      matched[field] = autoMatch(field, validHeaders);
    }

    const matchedCount = Object.values(matched).filter(Boolean).length;

    const buildOptions = () =>
      `<option value="">${EMPTY_OPT}</option>` +
      validHeaders.map(h => `<option value="${escHtml(String(h))}">${escHtml(String(h))}</option>`).join('');

    container.innerHTML = `
      <div class="found-indicator" style="margin-bottom:0.75rem;font-size:0.85rem;">
        ✅ ${modeLabel || 'Siap diimport'}
      </div>
      <div class="alert alert-info" style="margin-bottom:0.75rem;padding:0.6rem 0.9rem;font-size:0.82rem;">
        <span>🔗</span>
        <span>Auto-mapping: <strong>${matchedCount}/${Object.keys(FIELD_LABELS).length}</strong> kolom dicocokkan otomatis.
        ${matchedCount < 2 ? ' <strong style="color:var(--warning);">Pastikan kolom IDENTITAS dan NAMA TAMU dipetakan!</strong>' : ''}
        </span>
      </div>
      <table class="mapping-table" style="margin-bottom:1rem;">
        <thead>
          <tr>
            <th style="padding:0.5rem 0.75rem;font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;">Field Database</th>
            <th style="padding:0.5rem 0.75rem;font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;">Kolom Excel</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(FIELD_LABELS).map(([field, label]) => {
            const isRequired = label.includes('*');
            const isMatched  = !!matched[field];
            return `
              <tr>
                <td style="${isRequired ? 'color:var(--primary);font-weight:700;' : ''}">
                  ${label}
                  ${isMatched ? '<span style="color:var(--success);font-size:0.75rem;margin-left:0.3rem;">✓</span>' : ''}
                </td>
                <td>
                  <select id="map-${field}" class="form-control" style="font-size:0.85rem;${isRequired && !isMatched ? 'border-color:var(--warning);' : ''}">
                    ${buildOptions()}
                  </select>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>

      <!-- Prominent direct import button inside mapping card -->
      <button class="btn btn-primary btn-block btn-lg" id="direct-import-btn" style="margin-top:0.75rem;">
        🚀 PROSES IMPORT SEKARANG
      </button>
    `;

    // Set selected values via DOM
    for (const [field, matchedHeader] of Object.entries(matched)) {
      if (!matchedHeader) continue;
      const select = document.getElementById(`map-${field}`);
      if (!select) continue;

      const matchedUpper = String(matchedHeader).trim().toUpperCase();
      for (const opt of select.options) {
        if (opt.value.trim().toUpperCase() === matchedUpper) {
          select.value = opt.value;
          break;
        }
      }
    }

    // Attach click to direct import button
    document.getElementById('direct-import-btn')?.addEventListener('click', doImport);
  }

  async function doImport() {
    if (!uploadedFile || !selectedSheets.length) {
      toast('Pilih sheet terlebih dahulu!', 'warning'); return;
    }

    // Build column mapping from dropdowns
    const columnMapping = {};
    const missingRequired = [];

    for (const field of Object.keys(FIELD_LABELS)) {
      const select = document.getElementById(`map-${field}`);
      const val = select?.value?.trim();
      if (val && val !== EMPTY_OPT && val !== '') {
        columnMapping[field] = val;
      }
    }

    // Validate required fields
    if (!columnMapping.nama_tamu) {
      toast('Kolom wajib belum dipilih: Nama Tamu. Pilih dari dropdown!', 'warning', 7000);
      const sel = document.getElementById('map-nama_tamu');
      if (sel) sel.style.borderColor = 'var(--danger)';
      return;
    }

    const btn       = document.getElementById('excel-import-btn');
    const directBtn = document.getElementById('direct-import-btn');

    if (btn)       { btn.disabled = true;       btn.innerHTML = '<div class="spinner"></div> Mengimport...'; }
    if (directBtn) { directBtn.disabled = true; directBtn.innerHTML = '<div class="spinner"></div> Sedang Memproses Import...'; }

    const progressEl = document.getElementById('import-progress');
    if (progressEl) {
      progressEl.style.display = 'block';
      progressEl.innerHTML = `
        <div class="progress-bar-wrap"><div class="progress-bar" style="width:70%;animation:pulse 1s infinite;"></div></div>
        <p style="font-size:0.82rem;color:var(--text-muted);margin-top:0.5rem;">Sedang memproses ${selectedSheets.length} sheet data...</p>`;
    }

    try {
      const formData = new FormData();
      formData.append('file', rawFile);
      formData.append('sheetNames', JSON.stringify(selectedSheets));
      formData.append('columnMapping', JSON.stringify(columnMapping));

      // Include selected import month for per-month cleanup
      const picker = document.getElementById('import-month-picker');
      const importMonth = picker?.value?.trim() || '';
      if (importMonth) formData.append('importMonth', importMonth);

      const res = await api.upload('/excel/import', formData);

      if (progressEl) progressEl.innerHTML = '';

      const { stats } = res;
      toast(res.message, 'success', 6000);

      const resDiv = document.getElementById('import-result');
      if (resDiv) {
        resDiv.innerHTML = `
          <div class="alert alert-success" style="flex-direction:column;align-items:flex-start;gap:0.75rem;">
            <div style="font-weight:700;font-size:1rem;">✅ Import Selesai</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;width:100%;">
              <div style="background:rgba(16,185,129,0.1);padding:0.75rem;border-radius:8px;text-align:center;">
                <div style="font-size:1.5rem;font-weight:800;color:var(--success);">${stats.imported}</div>
                <div style="font-size:0.75rem;color:var(--text-secondary);">Tamu Baru</div>
              </div>
              <div style="background:rgba(79,142,247,0.1);padding:0.75rem;border-radius:8px;text-align:center;">
                <div style="font-size:1.5rem;font-weight:800;color:var(--primary);">${stats.updated}</div>
                <div style="font-size:0.75rem;color:var(--text-secondary);">Diperbarui</div>
              </div>
              <div style="background:rgba(245,158,11,0.1);padding:0.75rem;border-radius:8px;text-align:center;">
                <div style="font-size:1.5rem;font-weight:800;color:var(--warning);">${stats.skipped}</div>
                <div style="font-size:0.75rem;color:var(--text-secondary);">Dilewati</div>
              </div>
            </div>
            ${stats.errors?.length ? `<div style="font-size:0.78rem;color:var(--warning);">⚠️ ${stats.errors.slice(0,5).join('<br>')}</div>` : ''}
          </div>`;
        resDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      resetPanel(true);
    } catch (err) {
      if (progressEl) progressEl.innerHTML = '';
      const resDiv = document.getElementById('import-result');
      if (resDiv) {
        resDiv.innerHTML = `<div class="alert alert-error"><span>❌</span><span>${err.message}</span></div>`;
      }
    } finally {
      if (btn)       { btn.disabled = false;       btn.innerHTML = '🚀 Import Data'; }
      if (directBtn) { directBtn.disabled = false; directBtn.innerHTML = '🚀 PROSES IMPORT SEKARANG'; }
    }
  }

  function resetPanel(keepResult = false) {
    uploadedFile   = null;
    selectedSheets = [];
    sheetHeaders   = [];
    const fi = document.getElementById('excel-file-input');
    if (fi) fi.value = '';
    document.getElementById('excel-upload-status').innerHTML = '';
    document.getElementById('excel-sheet-section').style.display = 'none';
    document.getElementById('excel-mapping-section').style.display = 'none';
    const importBtn = document.getElementById('excel-import-btn');
    if (importBtn) { importBtn.style.display = 'none'; importBtn.innerHTML = '🚀 Import Data'; }
    if (!keepResult) document.getElementById('import-result').innerHTML = '';
    const prog = document.getElementById('import-progress');
    if (prog) prog.innerHTML = '';
  }

  function escHtml(str) { return searchPanel.escHtml(str); }

  async function clearDatabase() {
    const btn = document.getElementById('excel-clear-db-btn');

    // First confirmation
    const confirmed1 = window.confirm(
      '⚠️ PERINGATAN!\n\nAnda akan menghapus SEMUA data tamu dan riwayat check-in dari database.\n\nTindakan ini tidak dapat dibatalkan!\n\nLanjutkan?'
    );
    if (!confirmed1) return;

    // Second confirmation
    const confirmed2 = window.confirm(
      '🔴 KONFIRMASI AKHIR\n\nApakah Anda BENAR-BENAR yakin ingin menghapus seluruh database?\n\nKlik OK untuk melanjutkan, atau Cancel untuk membatalkan.'
    );
    if (!confirmed2) return;

    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner" style="display:inline-block;width:14px;height:14px;margin-right:6px;"></div> Menghapus...'; }

    try {
      const res = await api.post('/excel/clear-database', {});

      const resDiv = document.getElementById('import-result');
      if (resDiv) {
        resDiv.innerHTML = `
          <div class="alert alert-success" style="flex-direction:column;align-items:flex-start;gap:0.5rem;">
            <div style="font-weight:700;">✅ Database Berhasil Dihapus</div>
            <div style="font-size:0.88rem;">${escHtml(res.message)}</div>
          </div>`;
        resDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      toast(res.message, 'success', 5000);
      resetPanel(true);
    } catch (err) {
      toast('Gagal menghapus database: ' + err.message, 'error', 6000);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '🗑️ Hapus Semua Database'; }
    }
  }

  return { init, resetPanel };
})();
