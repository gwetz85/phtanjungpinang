const express = require('express');
const router = express.Router();
const { getDB, persist } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

// Apply authentication to all settings routes
router.use(authenticate);

// GET /api/settings/running-text
router.get('/running-text', (req, res) => {
  try {
    const db = getDB();
    res.json({
      success: true,
      runningText: db.runningText || ''
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/settings/running-text
router.put('/running-text', authorize('superadmin'), (req, res) => {
  try {
    const { runningText } = req.body;
    if (runningText === undefined) {
      return res.status(400).json({ success: false, message: 'Running text tidak boleh kosong.' });
    }
    const db = getDB();
    db.runningText = String(runningText).trim();
    persist();
    res.json({
      success: true,
      message: 'Running text berhasil diperbarui.',
      runningText: db.runningText
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
