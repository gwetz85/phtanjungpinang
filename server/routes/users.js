const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { queryAll, queryOne, run } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize('admin', 'superadmin'));

// GET /api/users
router.get('/', (req, res) => {
  const users = queryAll('SELECT id, username, nama, role, created_at FROM users ORDER BY role, nama');
  res.json({ success: true, data: users });
});

// POST /api/users
router.post('/', (req, res) => {
  const { username, password, nama, role } = req.body;
  if (!username || !password || !nama || !role) {
    return res.status(400).json({ success: false, message: 'Semua field wajib diisi.' });
  }
  const validRoles = ['superadmin', 'admin', 'receptionist'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Role tidak valid.' });
  }
  const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    return res.status(409).json({ success: false, message: 'Username sudah digunakan.' });
  }
  const hashed = bcrypt.hashSync(password, 10);
  const result = run('INSERT INTO users (username, password, nama, role) VALUES (?, ?, ?, ?)', [username, hashed, nama, role]);
  res.status(201).json({ success: true, message: 'User berhasil ditambahkan.', id: result.lastInsertRowid });
});

// PUT /api/users/:id
router.put('/:id', (req, res) => {
  const user = queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });

  const { nama, role, password } = req.body;
  if (password && password.length > 0) {
    const hashed = bcrypt.hashSync(password, 10);
    run('UPDATE users SET nama=?, role=?, password=? WHERE id=?', [nama, role, hashed, req.params.id]);
  } else {
    run('UPDATE users SET nama=?, role=? WHERE id=?', [nama, role, req.params.id]);
  }
  res.json({ success: true, message: 'User berhasil diperbarui.' });
});

// DELETE /api/users/:id
router.delete('/:id', (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'Tidak bisa menghapus akun sendiri.' });
  }
  const user = queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
  run('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'User berhasil dihapus.' });
});

module.exports = router;
