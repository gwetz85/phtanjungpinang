const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { queryOne } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'ph_hotel_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }

  const user = queryOne('SELECT * FROM users WHERE username = ?', [username.trim()]);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Username tidak ditemukan.' });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Password salah.' });
  }

  const payload = {
    id: user.id,
    username: user.username,
    nama: user.nama,
    role: user.role
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  res.json({
    success: true,
    message: 'Login berhasil.',
    token,
    user: payload
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logout berhasil.' });
});

module.exports = router;
