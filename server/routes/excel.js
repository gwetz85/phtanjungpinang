const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { queryAll, queryOne, run, transaction, detectIdentityType } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const UPLOAD_DIR = process.env.VERCEL
  ? path.join('/tmp', 'uploads')
  : path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('Hanya file .xlsx atau .xls yang diizinkan.'));
  }
});

/**
 * Smart Excel sheet parser: finds real header row (even multi-line or below title banners)
 * and extracts data rows as objects.
 */
function parseSheetData(sheet) {
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rawData || !rawData.length) return { headers: [], rows: [] };

  const keywords = ['NAMA', 'IDENTITAS', 'ROOM', 'KAMAR', 'UMUR', 'EXPIRY', 'NATIONALITY', 'KEWARGANEGARAAN', 'DATANG', 'MASUK', 'KET'];

  // Search first 10 rows for best header row
  let headerRowIdx = 0;
  let maxScore = -1;

  for (let r = 0; r < Math.min(10, rawData.length); r++) {
    const row = rawData[r] || [];
    let score = 0;
    row.forEach(cell => {
      const txt = String(cell).trim().toUpperCase();
      if (!txt) return;
      keywords.forEach(kw => { if (txt.includes(kw)) score += 3; });
      if (txt.length > 0) score += 1;
    });
    if (score > maxScore) {
      maxScore = score;
      headerRowIdx = r;
    }
  }

  const primaryHeaders = (rawData[headerRowIdx] || []).map(c => String(c).trim());

  // Check if headerRowIdx + 1 is a sub-header row (e.g. "DARI", "MASUK", "NO")
  const nextRow = rawData[headerRowIdx + 1] || [];
  const isSubHeader = nextRow.some(c => String(c).trim().match(/^(DARI|MASUK|NO|NAMA)$/i));

  const finalHeaders = primaryHeaders.map((h, colIdx) => {
    const sub = isSubHeader ? String(nextRow[colIdx] || '').trim() : '';
    if (!h && sub) return sub;
    if (h && sub && !h.toUpperCase().includes(sub.toUpperCase())) return `${h} ${sub}`.trim();
    return h;
  });

  const startDataRowIdx = headerRowIdx + (isSubHeader ? 2 : 1);
  const rows = [];

  for (let r = startDataRowIdx; r < rawData.length; r++) {
    const rawRow = rawData[r];
    if (!rawRow || !rawRow.some(c => String(c).trim().length > 0)) continue;
    const rowObj = {};
    finalHeaders.forEach((h, colIdx) => {
      if (h) rowObj[h] = rawRow[colIdx] !== undefined ? rawRow[colIdx] : '';
    });
    rows.push(rowObj);
  }

  return { headers: finalHeaders.filter(Boolean), rows };
}

function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

router.use(authenticate);

// ─── POST /api/excel/upload ─── (superadmin - preview sheets)
router.post('/upload', authorize('superadmin'), upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'File tidak ditemukan.' });
  }

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheets = workbook.SheetNames.map(name => {
      const sheet = workbook.Sheets[name];
      const { headers, rows } = parseSheetData(sheet);
      return { name, headers, rowCount: rows.length };
    });

    res.json({
      success: true,
      message: 'File berhasil diupload.',
      filePath: req.file.filename,
      originalName: req.file.originalname,
      sheets
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.status(500).json({ success: false, message: 'Gagal membaca file Excel: ' + err.message });
  }
});

// ─── POST /api/excel/import ─── (superadmin - do import)
router.post('/import', authorize('superadmin'), (req, res) => {
  const { filePath, sheetNames, columnMapping } = req.body;

  if (!filePath || !sheetNames || !columnMapping) {
    return res.status(400).json({ success: false, message: 'Parameter import tidak lengkap.' });
  }

  const sheets = Array.isArray(sheetNames) ? sheetNames : [sheetNames];
  const fullPath = path.join(UPLOAD_DIR, filePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ success: false, message: 'File tidak ditemukan di server.' });
  }

  try {
    const workbook = XLSX.readFile(fullPath);

    let totalImported = 0, totalUpdated = 0, totalSkipped = 0;
    const allErrors = [];
    let autoIdCounter = 1;

    transaction(() => {
      for (const sheetName of sheets) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          allErrors.push(`Sheet "${sheetName}" tidak ditemukan, dilewati.`);
          continue;
        }

        const { rows } = parseSheetData(sheet);
        if (!rows.length) continue;

        let imported = 0, updated = 0, skipped = 0;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          try {
            const map = columnMapping;
            const namaTamu = String(row[map.nama_tamu] || '').trim();

            // Skip row if guest name is missing
            if (!namaTamu) { skipped++; continue; }

            let rawNoId = String(row[map.no_identitas] || '').trim();

            // Clean prefixes like "Nik.", "Psp no.", "Sim no."
            let cleanNoId = rawNoId.replace(/^(nik|psp|psp\s*no|sim|sim\s*no|ktp|id)\.?:?\s*/i, '').trim();

            // Fallback auto ID if identity column was blank
            if (!cleanNoId) {
              const room = String(row[map.nomor_kamar] || '').trim();
              cleanNoId = `AUTO-${slugify(namaTamu)}-${room || autoIdCounter++}`;
            }

            const jenis = detectIdentityType(cleanNoId);
            const now   = new Date().toISOString();

            const parseDate = (val) => {
              if (!val) return '';
              if (typeof val === 'number') {
                try {
                  const d = XLSX.SSF.parse_date_code(val);
                  return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
                } catch { return String(val); }
              }
              return String(val);
            };

            const tglMasuk = parseDate(row[map.tanggal_masuk]);
            const expiry   = parseDate(row[map.expiry_identitas]);

            const existing = queryOne('SELECT id FROM guests WHERE no_identitas = ?', [cleanNoId]);
            let guestId;

            if (existing) {
              run(
                `UPDATE guests SET nama_tamu=?, umur=?, expiry_identitas=?, kewarganegaraan=?, datang_dari=?, updated_at=? WHERE no_identitas=?`,
                [namaTamu, String(row[map.umur] || ''), expiry, String(row[map.kewarganegaraan] || ''), String(row[map.datang_dari] || ''), now, cleanNoId]
              );
              guestId = existing.id;
              updated++;
            } else {
              const result = run(
                `INSERT INTO guests (no_identitas, jenis_identitas, nama_tamu, umur, expiry_identitas, kewarganegaraan, datang_dari, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [cleanNoId, jenis, namaTamu, String(row[map.umur] || ''), expiry, String(row[map.kewarganegaraan] || ''), String(row[map.datang_dari] || ''), now, now]
              );
              guestId = result.lastInsertRowid;
              imported++;
            }

            const nomorKamar = String(row[map.nomor_kamar] || '').trim();
            if (nomorKamar || tglMasuk) {
              run(
                `INSERT INTO checkins (guest_id, nomor_kamar, tanggal_masuk, keterangan, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [guestId, nomorKamar, tglMasuk, String(row[map.keterangan] || ''), req.user.id, now]
              );
            }
          } catch (rowErr) {
            allErrors.push(`[${sheetName}] Baris ${i + 2}: ${rowErr.message}`);
            skipped++;
          }
        }

        totalImported += imported;
        totalUpdated  += updated;
        totalSkipped  += skipped;
      }
    });

    try { fs.unlinkSync(fullPath); } catch(e) {}

    const sheetWord = sheets.length > 1 ? `${sheets.length} sheet` : `sheet "${sheets[0]}"`;
    res.json({
      success: true,
      message: `Import ${sheetWord} selesai. ${totalImported} tamu baru, ${totalUpdated} diperbarui, ${totalSkipped} dilewati.`,
      stats: {
        imported: totalImported,
        updated:  totalUpdated,
        skipped:  totalSkipped,
        sheets:   sheets.length,
        errors:   allErrors.slice(0, 20)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal import: ' + err.message });
  }
});

// ─── GET /api/excel/export ─── (admin+)
router.get('/export', authorize('admin', 'superadmin'), (req, res) => {
  const rows = queryAll(`
    SELECT
      ROW_NUMBER() OVER (ORDER BY g.updated_at DESC) as "NO",
      c.nomor_kamar as "ROOM NO",
      g.nama_tamu as "NAMA TAMU",
      g.umur as "UMUR",
      g.expiry_identitas as "EXPIRY",
      g.kewarganegaraan as "NATIONALITY",
      g.no_identitas as "IDENTITAS",
      g.datang_dari as "DATANG DARI",
      c.tanggal_masuk as "TANGGAL MASUK",
      c.keterangan as "KET"
    FROM guests g
    LEFT JOIN checkins c ON c.id = (SELECT id FROM checkins WHERE guest_id = g.id ORDER BY created_at DESC LIMIT 1)
    ORDER BY g.updated_at DESC
  `);

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Tidak ada data untuk diexport.' });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  const colWidths = Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length + 2, 15) }));
  ws['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws, 'Data Tamu');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `Pelangi-Hotel-Export-${new Date().toISOString().split('T')[0]}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
