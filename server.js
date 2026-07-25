require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./server/db');

const authRoutes  = require('./server/routes/auth');
const guestRoutes = require('./server/routes/guests');
const excelRoutes = require('./server/routes/excel');
const userRoutes  = require('./server/routes/users');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Static Files (Frontend) ──
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ──
app.use('/api/auth',   authRoutes);
app.use('/api/guests', guestRoutes);
app.use('/api/excel',  excelRoutes);
app.use('/api/users',  userRoutes);

// ── SPA Fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global Error Handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Server error: ' + err.message });
});

// ── Start ──
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const nets = os.networkInterfaces();
    let localIP = 'localhost';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          localIP = net.address;
          break;
        }
      }
    }
    console.log('\n========================================');
    console.log('  PH Hotel DB - Server Berjalan');
    console.log(`  Lokal  : http://localhost:${PORT}`);
    console.log(`  Jaringan: http://${localIP}:${PORT}`);
    console.log('  (Bagikan alamat jaringan ke komputer lain)');
    console.log('========================================\n');
  });
}).catch(err => {
  console.error('[ERROR] Gagal start server:', err.message);
  process.exit(1);
});
