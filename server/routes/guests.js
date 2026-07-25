const express = require('express');
const router = express.Router();
const { queryAll, queryOne, run, detectIdentityType } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// ─── GET /api/guests ─── (admin, superadmin)
router.get('/', authorize('admin', 'superadmin'), (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', nationality = '' } = req.query;
    const pageNum   = Math.max(1, parseInt(page) || 1);
    const limitNum  = Math.max(1, parseInt(limit) || 20);
    const offsetNum = (pageNum - 1) * limitNum;

    let where = '';
    const filterParams = [];

    if (search) {
      where += ' search:' + search;
      filterParams.push(`%${search}%`, `%${search}%`);
    }
    if (nationality) {
      where += ' nationality:' + nationality;
      filterParams.push(`%${nationality}%`);
    }

    const countRow = queryOne(`SELECT COUNT(*) as total FROM guests g ${where}`, filterParams);
    const total    = countRow?.total || 0;

    // Pass limit + offset as last two params — queryAll reads them from params[-2] and params[-1]
    const guests = queryAll(
      `SELECT * FROM guests g ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [...filterParams, limitNum, offsetNum]
    );

    res.json({
      success: true,
      data: guests,
      pagination: {
        total,
        page:       pageNum,
        limit:      limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error('[GET /guests] Error:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data tamu: ' + err.message });
  }
});

// ─── GET /api/guests/search ───
router.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) {
    return res.status(400).json({ success: false, message: 'Query pencarian tidak boleh kosong.' });
  }

  const term = `%${q.trim()}%`;

  const guests = queryAll(`
    SELECT g.*,
      (SELECT COUNT(*) FROM checkins WHERE guest_id = g.id) as total_checkins,
      (SELECT tanggal_masuk FROM checkins WHERE guest_id = g.id ORDER BY created_at DESC LIMIT 1) as last_checkin,
      (SELECT nomor_kamar FROM checkins WHERE guest_id = g.id ORDER BY created_at DESC LIMIT 1) as last_room
    FROM guests g
    WHERE g.no_identitas LIKE ? OR g.nama_tamu LIKE ?
    ORDER BY g.updated_at DESC
    LIMIT 20
  `, [term, term]);

  res.json({ success: true, data: guests });
});

// ─── GET /api/guests/:id ───
router.get('/:id', (req, res) => {
  const guest = queryOne('SELECT * FROM guests WHERE id = ?', [req.params.id]);

  if (!guest) {
    return res.status(404).json({ success: false, message: 'Data tamu tidak ditemukan.' });
  }

  const checkins = queryAll(`
    SELECT c.*, u.nama as petugas
    FROM checkins c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.guest_id = ?
    ORDER BY c.created_at DESC
  `, [req.params.id]);

  res.json({ success: true, data: { ...guest, checkins } });
});

// ─── POST /api/guests ─── (tambah tamu baru + check-in)
router.post('/', (req, res) => {
  const {
    no_identitas, nama_tamu, umur, expiry_identitas,
    kewarganegaraan, datang_dari,
    nomor_kamar, tanggal_masuk, keterangan
  } = req.body;

  if (!no_identitas || !nama_tamu) {
    return res.status(400).json({ success: false, message: 'No. Identitas dan Nama Tamu wajib diisi.' });
  }

  const cleanId = String(no_identitas).trim();
  const jenis = detectIdentityType(cleanId);
  const now = new Date().toISOString();

  const existing = queryOne('SELECT * FROM guests WHERE no_identitas = ?', [cleanId]);

  let guestId;

  if (existing) {
    run(`
      UPDATE guests SET
        nama_tamu=?, umur=?, expiry_identitas=?,
        kewarganegaraan=?, datang_dari=?, updated_at=?
      WHERE no_identitas=?
    `, [nama_tamu, umur, expiry_identitas, kewarganegaraan, datang_dari, now, cleanId]);
    guestId = existing.id;
  } else {
    const result = run(`
      INSERT INTO guests (no_identitas, jenis_identitas, nama_tamu, umur, expiry_identitas, kewarganegaraan, datang_dari, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [cleanId, jenis, nama_tamu, umur, expiry_identitas, kewarganegaraan, datang_dari, now, now]);
    guestId = result.lastInsertRowid;
  }

  if (nomor_kamar || tanggal_masuk) {
    run(`
      INSERT INTO checkins (guest_id, nomor_kamar, tanggal_masuk, keterangan, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [guestId, nomor_kamar, tanggal_masuk, keterangan, req.user.id, now]);
  }

  const updatedGuest = queryOne('SELECT * FROM guests WHERE id = ?', [guestId]);
  const checkins = queryAll(`
    SELECT c.*, u.nama as petugas FROM checkins c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.guest_id = ? ORDER BY c.created_at DESC
  `, [guestId]);

  res.status(201).json({
    success: true,
    message: existing ? 'Data tamu diperbarui dan check-in baru ditambahkan.' : 'Tamu baru berhasil ditambahkan.',
    data: { ...updatedGuest, checkins }
  });
});

// ─── PUT /api/guests/:id ─── (admin+)
router.put('/:id', authorize('admin', 'superadmin'), (req, res) => {
  const { nama_tamu, umur, expiry_identitas, kewarganegaraan, datang_dari } = req.body;
  const now = new Date().toISOString();

  const guest = queryOne('SELECT * FROM guests WHERE id = ?', [req.params.id]);
  if (!guest) {
    return res.status(404).json({ success: false, message: 'Data tamu tidak ditemukan.' });
  }

  run(`
    UPDATE guests SET
      nama_tamu=?, umur=?, expiry_identitas=?,
      kewarganegaraan=?, datang_dari=?, updated_at=?
    WHERE id=?
  `, [nama_tamu, umur, expiry_identitas, kewarganegaraan, datang_dari, now, req.params.id]);

  const updated = queryOne('SELECT * FROM guests WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Data tamu berhasil diperbarui.', data: updated });
});

// ─── DELETE /api/guests/:id ─── (admin+)
router.delete('/:id', authorize('admin', 'superadmin'), (req, res) => {
  const guest = queryOne('SELECT * FROM guests WHERE id = ?', [req.params.id]);
  if (!guest) {
    return res.status(404).json({ success: false, message: 'Data tamu tidak ditemukan.' });
  }
  run('DELETE FROM checkins WHERE guest_id = ?', [req.params.id]);
  run('DELETE FROM guests WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Data tamu berhasil dihapus.' });
});

// ─── POST /api/guests/:id/checkin ───
router.post('/:id/checkin', (req, res) => {
  const guest = queryOne('SELECT * FROM guests WHERE id = ?', [req.params.id]);
  if (!guest) {
    return res.status(404).json({ success: false, message: 'Data tamu tidak ditemukan.' });
  }

  const { nomor_kamar, tanggal_masuk, keterangan } = req.body;
  const now = new Date().toISOString();

  run(`
    INSERT INTO checkins (guest_id, nomor_kamar, tanggal_masuk, keterangan, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guest.id, nomor_kamar, tanggal_masuk, keterangan, req.user.id, now]);

  run('UPDATE guests SET updated_at=? WHERE id=?', [now, guest.id]);

  const checkins = queryAll(`
    SELECT c.*, u.nama as petugas FROM checkins c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.guest_id = ? ORDER BY c.created_at DESC
  `, [guest.id]);

  res.json({ success: true, message: 'Check-in berhasil ditambahkan.', data: { ...guest, checkins } });
});

module.exports = router;
