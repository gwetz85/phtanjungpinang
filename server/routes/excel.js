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

const MAPPING_ALIASES = {
  no_identitas:    ['IDENTITAS', 'NIK / PSP NO', 'NIK', 'PSP NO', 'PASSPORT', 'NO IDENTITAS', 'ID'],
  nama_tamu:       ['NAMA TAMU', 'NAMA', 'NAME', 'GUEST NAME'],
  umur:            ['TANGGAL LAHIR', 'TGL LAHIR', 'UMUR', 'AGE', 'USIA'],
  expiry_identitas:['EXPIRY', 'EXPIRY DATE', 'EXPIRED', 'EXP'],
  kewarganegaraan: ['NATIONALITY', 'KEWARGANEGARAAN', 'WN', 'NEGARA'],
  datang_dari:     ['DATANG DARI', 'DATANG', 'ASAL', 'FROM', 'ORIGIN'],
  nomor_kamar:     ['NOMOR ROOM', 'ROOM NO', 'KAMAR', 'ROOM', 'NO KAMAR', 'NO ROOM'],
  tanggal_masuk:   ['TANGGAL MASUK', 'TANGGAL', 'TGL MASUK', 'CHECK IN', 'DATE IN'],
  keterangan:      ['KETERANGAN', 'KET', 'NOTES', 'REMARKS'],
};

function getRowValue(row, field, mappedHeader) {
  if (!row) return '';

  if (mappedHeader && row[mappedHeader] !== undefined && String(row[mappedHeader]).trim() !== '') {
    return row[mappedHeader];
  }

  const rowKeys = Object.keys(row);
  if (mappedHeader) {
    const targetKeyLower = String(mappedHeader).replace(/\s+/g, ' ').trim().toLowerCase();
    const foundKey = rowKeys.find(k => k.replace(/\s+/g, ' ').trim().toLowerCase() === targetKeyLower);
    if (foundKey && row[foundKey] !== undefined && String(row[foundKey]).trim() !== '') {
      return row[foundKey];
    }
  }

  const aliases = MAPPING_ALIASES[field] || [];
  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase();
    const foundKey = rowKeys.find(k => {
      const kLower = k.replace(/\s+/g, ' ').trim().toLowerCase();
      return kLower === aliasLower || kLower.includes(aliasLower) || aliasLower.includes(kLower);
    });
    if (foundKey && row[foundKey] !== undefined && String(row[foundKey]).trim() !== '') {
      return row[foundKey];
    }
  }

  return '';
}

function formatBirthdate(val) {
  if (!val || val === '"') return '';
  if (typeof val === 'number') {
    if (val > 0 && val < 150) return String(val);
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d && d.y > 1900 && d.y < 2100) {
        return `${String(d.d).padStart(2,'0')}/${String(d.m).padStart(2,'0')}/${d.y}`;
      }
    } catch {}
  }
  let str = String(val).trim();
  const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (match) {
    let day = String(match[1]).padStart(2, '0');
    let month = String(match[2]).padStart(2, '0');
    let year = parseInt(match[3]);
    if (year < 100) {
      year = year > 26 ? 1900 + year : 2000 + year;
    }
    return `${day}/${month}/${year}`;
  }
  return str;
}

function formatCheckinDate(val, importMonth) {
  if (!val || val === '"') return importMonth ? `${importMonth}-01` : '';
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d && d.y >= 1970 && d.y <= 2100) {
        return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
      }
    } catch {}
  }
  let str = String(val).trim();
  const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (match) {
    let day = parseInt(match[1]);
    let month = parseInt(match[2]);
    let year = parseInt(match[3]);
    if (year < 100) {
      year = year > 50 ? 1900 + year : 2000 + year;
    }
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (importMonth && /^\d{1,2}$/.test(str)) {
    return `${importMonth}-${String(str).padStart(2,'0')}`;
  }
  if (importMonth) return `${importMonth}-01`;
  return new Date().toISOString().split('T')[0];
}

        let imported = 0, updated = 0, skipped = 0;
        let lastRoom = '';
        let lastNationality = '';
        let lastDatang = '';
        let lastTanggal = '';
        let lastKet = '';

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          try {
            const map = columnMapping;
            const namaTamu = String(getRowValue(row, 'nama_tamu', map.nama_tamu) || '').trim();

            const nameUpper = namaTamu.toUpperCase();
            if (!namaTamu || nameUpper.includes('NAMA TAMU') || nameUpper === 'NAMA' || nameUpper === 'NAME' || nameUpper === 'GUEST NAME' || nameUpper === 'IDENTITAS' || nameUpper === 'KEWARGANEGARAAN') {
              skipped++;
              continue;
            }

            let rawNoId = String(getRowValue(row, 'no_identitas', map.no_identitas) || '').trim();
            if (['IDENTITAS', 'NIK', 'PASSPORT', 'NO IDENTITAS', 'ID'].includes(rawNoId.toUpperCase())) {
              skipped++;
              continue;
            }

            // Carry-forward / ditto mark (") handling for group guests
            let room = String(getRowValue(row, 'nomor_kamar', map.nomor_kamar) || '').trim();
            let nationality = String(getRowValue(row, 'kewarganegaraan', map.kewarganegaraan) || '').trim();
            let datang = String(getRowValue(row, 'datang_dari', map.datang_dari) || '').trim();
            let tglRaw = String(getRowValue(row, 'tanggal_masuk', map.tanggal_masuk) || '').trim();
            let ket = String(getRowValue(row, 'keterangan', map.keterangan) || '').trim();

            if (room === '"' || !room) room = lastRoom; else lastRoom = room;
            if (nationality === '"' || !nationality) nationality = lastNationality; else lastNationality = nationality;
            if (datang === '"' || !datang) datang = lastDatang; else lastDatang = datang;
            if (tglRaw === '"' || !tglRaw) tglRaw = lastTanggal; else lastTanggal = tglRaw;
            if (ket === '"' || !ket) ket = lastKet; else lastKet = ket;

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
              cleanNoId = `AUTO-${slugify(namaTamu)}-${room || autoIdCounter++}`;
            }

            const now   = new Date().toISOString();

            const parseDate = (val) => {
              if (!val || val === '"') return '';
              if (typeof val === 'number') {
                try {
                  const d = XLSX.SSF.parse_date_code(val);
                  return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
                } catch { return String(val); }
              }
              return String(val);
            };

            const tglMasuk = formatCheckinDate(tglRaw, importMonth);
            const expiryVal = getRowValue(row, 'expiry_identitas', map.expiry_identitas);
            const umurVal   = getRowValue(row, 'umur', map.umur);
            const expiry   = parseDate(expiryVal);
            const birthdateFormatted = formatBirthdate(umurVal);

            // Smart Upsert: match by ID first (if non-AUTO), then match by exact Name
            let existing = null;
            if (cleanNoId && !cleanNoId.toUpperCase().startsWith('AUTO-')) {
              existing = queryOne('SELECT id, no_identitas FROM guests WHERE no_identitas = ?', [cleanNoId]);
            }
            if (!existing && namaTamu) {
              const cleanName = namaTamu.replace(/\s+/g, ' ').trim();
              existing = queryOne('SELECT id, no_identitas FROM guests WHERE LOWER(TRIM(nama_tamu)) = LOWER(TRIM(?))', [cleanName]);
            }

            let guestId;

            if (existing) {
              // Update metadata for existing guest
              run(
                `UPDATE guests SET nama_tamu=?, jenis_identitas=?, no_identitas=?, umur=?, expiry_identitas=?, kewarganegaraan=?, datang_dari=?, updated_at=? WHERE id=?`,
                [
                  namaTamu,
                  jenis,
                  cleanNoId,
                  birthdateFormatted,
                  expiry,
                  nationality,
                  datang,
                  now,
                  existing.id
                ]
              );
              guestId = existing.id;
              updated++;
            } else {
              const result = run(
                `INSERT INTO guests (no_identitas, jenis_identitas, nama_tamu, umur, expiry_identitas, kewarganegaraan, datang_dari, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [cleanNoId, jenis, namaTamu, birthdateFormatted, expiry, nationality, datang, now, now]
              );
              guestId = result.lastInsertRowid;
              imported++;
            }

            if (room || tglMasuk) {
              run(
                `INSERT INTO checkins (guest_id, nomor_kamar, tanggal_masuk, keterangan, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [guestId, room, tglMasuk, ket, req.user.id, now]
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
