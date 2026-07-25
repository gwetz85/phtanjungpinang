const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { queryOne } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'ph_hotel_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password, deviceId } = req.body;

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
  
  const { run } = require('../db');

  // Device Lock Logic (Skip for superadmin)
  if (user.role !== 'superadmin' && deviceId) {
    if (!user.device_id) {
      // First time login on a device, bind it
      run('UPDATE users SET device_id = ? WHERE id = ?', [deviceId, user.id]);
    } else if (user.device_id !== deviceId) {
      // Trying to login from a different device
      return res.status(403).json({ 
        success: false, 
        message: 'Perangkat tidak dikenali. Akun ini sudah terikat dengan perangkat lain. Hubungi admin untuk mereset perangkat.' 
      });
    }
  }

  const payload = {
    id: user.id,
    username: user.username,
    nama: user.nama,
    role: user.role
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  // Update last login
  const { run } = require('../db');
  run('UPDATE users SET last_login = ? WHERE id = ?', [new Date().toISOString(), user.id]);

  res.json({
    success: true,
    message: 'Login berhasil.',
    token,
    user: payload
  });
});

// GET /api/auth/system-info
router.get('/system-info', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    let userRecord = null;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userRecord = queryOne('SELECT * FROM users WHERE id = ?', [decoded.id]);
      } catch (e) {}
    }

    const { getDB } = require('../db');
    const dbData = getDB();
    const totalData = dbData.guests ? dbData.guests.length : 0;
    
    // Get client IP
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    if (ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip === '::1') ip = '127.0.0.1';

    res.json({
      success: true,
      data: {
        totalData,
        ip,
        lastLogin: userRecord ? userRecord.last_login : null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logout berhasil.' });
});

module.exports = router;
