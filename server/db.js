const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.VERCEL
  ? path.join('/tmp', 'hotel.db')
  : path.join(__dirname, '..', 'hotel.db');

let db = null;
let SQL = null;

/**
 * Persist in-memory DB to disk
 */
function persist() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[DB] Persist error:', err.message);
  }
}

/**
 * Auto-persist every 10 seconds
 */
function startAutoPersist() {
  setInterval(persist, 10000);
  process.on('exit', persist);
  process.on('SIGINT', () => { persist(); process.exit(0); });
  process.on('SIGTERM', () => { persist(); process.exit(0); });
}

function getDB() {
  if (!db) throw new Error('Database belum diinisialisasi.');
  return db;
}

async function initDB() {
  if (db) return db;
  SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    db = new SQL.Database(data);
    console.log('[DB] Loaded existing database:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new database:', DB_PATH);
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      nama TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no_identitas TEXT UNIQUE NOT NULL,
      jenis_identitas TEXT DEFAULT 'PASSPORT',
      nama_tamu TEXT NOT NULL,
      umur TEXT,
      expiry_identitas TEXT,
      kewarganegaraan TEXT,
      datang_dari TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id INTEGER NOT NULL,
      nomor_kamar TEXT,
      tanggal_masuk TEXT,
      keterangan TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_guests_no_identitas ON guests(no_identitas);
    CREATE INDEX IF NOT EXISTS idx_guests_nama ON guests(nama_tamu);
    CREATE INDEX IF NOT EXISTS idx_checkins_guest_id ON checkins(guest_id);
  `);

  // Seed default users if none exist
  const countRes = db.exec('SELECT COUNT(*) as cnt FROM users');
  const count = countRes[0]?.values[0][0] || 0;

  if (count === 0) {
    const users = [
      { username: 'superadmin', password: 'superadmin123', nama: 'Super Administrator', role: 'superadmin' },
      { username: 'admin',      password: 'admin123',      nama: 'Administrator',       role: 'admin' },
      { username: 'receptionist', password: 'recep123',   nama: 'Resepsionis',          role: 'receptionist' },
    ];
    for (const u of users) {
      const hashed = bcrypt.hashSync(u.password, 10);
      db.run(
        'INSERT INTO users (username, password, nama, role) VALUES (?, ?, ?, ?)',
        [u.username, hashed, u.nama, u.role]
      );
    }
    console.log('[DB] Default users seeded.');
  }

  persist();
  startAutoPersist();
  console.log('[DB] Database initialized.');
}

// ─── Query helpers (mimic better-sqlite3 API) ─────────────────────────

/**
 * Execute a SELECT and return all rows as objects
 */
function queryAll(sql, params = []) {
  const database = getDB();
  try {
    const stmt = database.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch(e) {
    throw new Error(`SQL Error: ${e.message}\nSQL: ${sql}`);
  }
}

/**
 * Execute a SELECT and return first row or null
 */
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

/**
 * Execute INSERT/UPDATE/DELETE. Returns { lastInsertRowid, changes }
 */
function run(sql, params = []) {
  const database = getDB();
  try {
    database.run(sql, params);
    const info = {
      lastInsertRowid: database.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0],
      changes: database.getRowsModified()
    };
    persist();
    return info;
  } catch(e) {
    throw new Error(`SQL Error: ${e.message}\nSQL: ${sql}`);
  }
}

/**
 * Run multiple statements in a transaction
 */
function transaction(fn) {
  const database = getDB();
  database.run('BEGIN');
  try {
    fn();
    database.run('COMMIT');
    persist();
  } catch(e) {
    database.run('ROLLBACK');
    throw e;
  }
}

/**
 * Detect identity type from number
 */
function detectIdentityType(noIdentitas) {
  if (!noIdentitas) return 'LAINNYA';
  const clean = String(noIdentitas).trim().replace(/\s/g, '');
  if (/^\d{16}$/.test(clean)) return 'NIK';
  return 'PASSPORT';
}

module.exports = { initDB, getDB, queryAll, queryOne, run, transaction, detectIdentityType };
