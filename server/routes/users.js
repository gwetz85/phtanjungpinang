const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { queryAll, queryOne, run } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize('admin', 'superadmin'));

// GET /api/users
router.get('/', (req, res) => {
  let users = queryAll('SELECT id, username, nama, role, created_at FROM users ORDER BY role, nama');
  // Removed: Admin cannot see superadmin accounts (Admin is now allowed to see them, but not edit/delete them)
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
  // Admin cannot create superadmin accounts
  if (req.user.role === 'admin' && role === 'superadmin') {
    return res.status(403).json({ success: false, message: 'Admin tidak bisa membuat akun superadmin.' });
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

  // Admin cannot edit superadmin accounts or promote to superadmin
  if (req.user.role === 'admin' && (user.role === 'superadmin' || req.body.role === 'superadmin')) {
    return res.status(403).json({ success: false, message: 'Admin tidak bisa mengelola akun superadmin.' });
  }

  const { nama, role, password } = req.body;
  if (password && password.length > 0) {
    const hashed = bcrypt.hashSync(password, 10);
    run('UPDATE users SET nama=?, role=?, password=? WHERE id=?', [nama, role, hashed, req.params.id]);
  } else {
    run('UPDATE users SET nama=?, role=? WHERE id=?', [nama, role, req.params.id]);
  }
  res.json({ success: true, message: 'User berhasil diperbarui.' });
});

// POST /api/users/:id/reset-device
router.post('/:id/reset-device', (req, res) => {
  const userToReset = queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!userToReset) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
  
  if (req.user.role === 'admin' && userToReset.role === 'superadmin') {
    return res.status(403).json({ success: false, message: 'Admin tidak bisa reset perangkat superadmin.' });
  }

  run('UPDATE users SET device_id = NULL WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Perangkat user berhasil direset.' });
});

// DELETE /api/users/:id
router.delete('/:id', (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'Tidak bisa menghapus akun sendiri.' });
  }
  const user = queryOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
  // Admin cannot delete superadmin accounts
  if (req.user.role === 'admin' && user.role === 'superadmin') {
    return res.status(403).json({ success: false, message: 'Admin tidak bisa menghapus akun superadmin.' });
  }
  run('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'User berhasil dihapus.' });
});

module.exports = router;
