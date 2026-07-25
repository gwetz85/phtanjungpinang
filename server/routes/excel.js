const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { queryAll, queryOne, run, transaction, detectIdentityType } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

// Memory storage for stateless serverless functions (Vercel)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
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

// ─── POST /api/excel/upload ─── (superadmin - preview sheets in memory)
router.post('/upload', authorize('superadmin'), upload.single('file'), (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, message: 'File tidak ditemukan.' });
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheets = workbook.SheetNames.map(name => {
      const sheet = workbook.Sheets[name];
      const { headers, rows } = parseSheetData(sheet);
      return { name, headers, rowCount: rows.length };
    });

    res.json({
      success: true,
      message: 'File berhasil diupload.',
      originalName: req.file.originalname,
      sheets
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membaca file Excel: ' + err.message });
  }
});

// ─── POST /api/excel/import ─── (superadmin - do import directly from memory)
router.post('/import', authorize('superadmin'), upload.single('file'), (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, message: 'File tidak ditemukan di request.' });
  }

  const sheetNamesRaw = req.body.sheetNames;
  const columnMappingRaw = req.body.columnMapping;

  if (!sheetNamesRaw || !columnMappingRaw) {
    return res.status(400).json({ success: false, message: 'Parameter import tidak lengkap.' });
  }

  let sheets = [];
  let columnMapping = {};

  try {
    sheets = typeof sheetNamesRaw === 'string' ? JSON.parse(sheetNamesRaw) : sheetNamesRaw;
    columnMapping = typeof columnMappingRaw === 'string' ? JSON.parse(columnMappingRaw) : columnMappingRaw;
  } catch (e) {
    return res.status(400).json({ success: false, message: 'Format parameter JSON tidak valid.' });
  }

  const importMonth = req.body.importMonth || ''; // format: YYYY-MM

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });

    let totalImported = 0, totalUpdated = 0, totalSkipped = 0;
    let totalCheckinDeleted = 0;
    const allErrors = [];
    let autoIdCounter = 1;

    transaction(() => {
      // ── Hapus semua checkin di bulan yang dipilih (prevent duplikasi) ──
      if (importMonth) {
        const before = (require('../db').getDB().checkins || []).length;
        run(`DELETE FROM checkins WHERE tanggal_masuk LIKE ?`, [`${importMonth}-%`]);
        const after = (require('../db').getDB().checkins || []).length;
        totalCheckinDeleted = before - after;
      }

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

            // Skip row if guest name is missing, empty, or is a header label
            if (!namaTamu || ['NAMA TAMU', 'NAMA', 'NAME', 'GUEST NAME'].includes(namaTamu.toUpperCase())) {
              skipped++;
              continue;
            }

            let rawNoId = String(row[map.no_identitas] || '').trim();
            if (['IDENTITAS', 'NIK', 'PASSPORT', 'NO IDENTITAS', 'ID'].includes(rawNoId.toUpperCase())) {
              skipped++;
              continue;
            }

            let jenis = 'PASSPORT';
            const rawNoIdUpper = rawNoId.toUpperCase();
            if (rawNoIdUpper.startsWith('NIK') || /^\d{16}$/.test(rawNoId.replace(/\s/g, ''))) {
              jenis = 'NIK';
            } else if (rawNoIdUpper.startsWith('SIM')) {
              jenis = 'SIM';
            } else if (rawNoIdUpper.startsWith('PSP') || rawNoIdUpper.startsWith('PASSPORT')) {
              jenis = 'PASSPORT';
            } else {
              const digitsOnly = rawNoId.replace(/\D/g, '');
              if (digitsOnly.length === 16) {
                jenis = 'NIK';
              } else if (digitsOnly.length === 12) {
                jenis = 'SIM';
              }
            }

            let cleanNoId = rawNoId.replace(/^(nik|psp|psp\s*no|sim|sim\s*no|ktp|id)\.?:?\s*/i, '').trim();

            if (!cleanNoId) {
              const room = String(row[map.nomor_kamar] || '').trim();
              cleanNoId = `AUTO-${slugify(namaTamu)}-${room || autoIdCounter++}`;
            }

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

            let rawUmur = row[map.umur];
            let parsedUmur = '';
            if (rawUmur !== undefined && rawUmur !== null) {
              if (typeof rawUmur === 'number') {
                if (rawUmur > 10000) {
                  parsedUmur = parseDate(rawUmur);
                } else {
                  parsedUmur = String(rawUmur);
                }
              } else {
                parsedUmur = String(rawUmur).trim();
              }
            }

            // Upsert guest (insert or update info only — never re-add duplicate)
            const existing = queryOne('SELECT id FROM guests WHERE no_identitas = ?', [cleanNoId]);
            let guestId;

            if (existing) {
              run(
                `UPDATE guests SET nama_tamu=?, umur=?, expiry_identitas=?, kewarganegaraan=?, datang_dari=?, updated_at=? WHERE no_identitas=?`,
                [namaTamu, parsedUmur, expiry, String(row[map.kewarganegaraan] || ''), String(row[map.datang_dari] || ''), now, cleanNoId]
              );
              guestId = existing.id;
              updated++;
            } else {
              const result = run(
                `INSERT INTO guests (no_identitas, jenis_identitas, nama_tamu, umur, expiry_identitas, kewarganegaraan, datang_dari, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [cleanNoId, jenis, namaTamu, parsedUmur, expiry, String(row[map.kewarganegaraan] || ''), String(row[map.datang_dari] || ''), now, now]
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

    const sheetWord  = sheets.length > 1 ? `${sheets.length} sheet` : `sheet "${sheets[0]}"`;
    const monthLabel = importMonth ? ` (Bulan: ${importMonth})` : '';
    const clearNote  = totalCheckinDeleted > 0 ? ` Sebelumnya ${totalCheckinDeleted} data check-in bulan ini dibersihkan.` : '';

    res.json({
      success: true,
      message: `Import ${sheetWord}${monthLabel} selesai. ${totalImported} tamu baru, ${totalUpdated} diperbarui, ${totalSkipped} dilewati.${clearNote}`,
      stats: {
        imported:        totalImported,
        updated:         totalUpdated,
        skipped:         totalSkipped,
        sheets:          sheets.length,
        checkinCleared:  totalCheckinDeleted,
        importMonth:     importMonth || null,
        errors:          allErrors.slice(0, 20)
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
    return res.status(404).json({
      success: false,
      message: 'Belum ada data tamu di database. Silakan upload/import file Excel Anda terlebih dahulu melalui menu "Upload Excel" (Superadmin).'
    });
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

// ─── POST /api/excel/clear-database ─── (superadmin - purge guest/checkin data)
router.post('/clear-database', authorize('superadmin'), (req, res) => {
  try {
    const { getDB } = require('../db');

    const dbData = getDB();
    const guestCount   = (dbData.guests   || []).length;
    const checkinCount = (dbData.checkins || []).length;

    // Wipe collections
    dbData.guests   = [];
    dbData.checkins = [];

    // Reset counters
    if (dbData.counters) {
      dbData.counters.guests   = 1;
      dbData.counters.checkins = 1;
    }

    // Persist to Firebase
    run('DELETE FROM guests');

    res.json({
      success: true,
      message: `Berhasil menghapus ${guestCount} data tamu dan ${checkinCount} riwayat check-in dari database.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membersihkan database: ' + err.message });
  }
});

module.exports = router;
