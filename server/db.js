const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const FIREBASE_URL = process.env.FIREBASE_URL || 'https://pelangihotel-35986-default-rtdb.asia-southeast1.firebasedatabase.app';
const DB_PATH = process.env.VERCEL
  ? path.join('/tmp', 'hotel.db')
  : path.join(__dirname, '..', 'hotel.db');

let db = null;
let SQL = null;
let useFirebase = false;

/**
 * Firebase REST API helper
 */
async function firebaseFetch(endpoint, method = 'GET', data = null) {
  const url = `${FIREBASE_URL}${endpoint}.json`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (data !== null) options.body = JSON.stringify(data);
  const res = await fetch(url, options);
  const json = await res.json();
  if (json && json.error) {
    throw new Error(`Firebase Error (${endpoint}): ${json.error}`);
  }
  return json;
}

/**
 * Persist in-memory DB to disk (and sync to Firebase if available)
 */
function persist() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[DB] Persist error:', err.message);
  }
  if (useFirebase) {
    syncToFirebase().catch(e => console.error('[Firebase Sync Error]', e.message));
  }
}

/**
 * Sync SQLite tables to Firebase Realtime Database
 */
async function syncToFirebase() {
  if (!useFirebase || !db) return;
  try {
    const users = queryAll('SELECT * FROM users');
    const guests = queryAll('SELECT * FROM guests');
    const checkins = queryAll('SELECT * FROM checkins');

    await firebaseFetch('/users', 'PUT', users);
    await firebaseFetch('/guests', 'PUT', guests);
    await firebaseFetch('/checkins', 'PUT', checkins);
  } catch (err) {
    console.error('[Firebase Sync Failed]', err.message);
  }
}

/**
 * Load data from Firebase Realtime Database into SQLite
 */
async function syncFromFirebase() {
  try {
    const fbUsers = await firebaseFetch('/users', 'GET');
    const fbGuests = await firebaseFetch('/guests', 'GET');
    const fbCheckins = await firebaseFetch('/checkins', 'GET');

    useFirebase = true;
    console.log('[Firebase] Realtime Database terhubung:', FIREBASE_URL);

    if (Array.isArray(fbUsers) && fbUsers.length > 0) {
      db.run('DELETE FROM users');
      for (const u of fbUsers) {
        if (u) db.run('INSERT OR REPLACE INTO users (id, username, password, nama, role, created_at) VALUES (?, ?, ?, ?, ?, ?)', [u.id, u.username, u.password, u.nama, u.role, u.created_at || new Date().toISOString()]);
      }
    }

    if (Array.isArray(fbGuests) && fbGuests.length > 0) {
      db.run('DELETE FROM guests');
      for (const g of fbGuests) {
        if (g) db.run('INSERT OR REPLACE INTO guests (id, no_identitas, jenis_identitas, nama_tamu, umur, expiry_identitas, kewarganegaraan, datang_dari, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [g.id, g.no_identitas, g.jenis_identitas, g.nama_tamu, g.umur, g.expiry_identitas, g.kewarganegaraan, g.datang_dari, g.created_at, g.updated_at]);
      }
    }

    if (Array.isArray(fbCheckins) && fbCheckins.length > 0) {
      db.run('DELETE FROM checkins');
      for (const c of fbCheckins) {
        if (c) db.run('INSERT OR REPLACE INTO checkins (id, guest_id, nomor_kamar, tanggal_masuk, keterangan, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [c.id, c.guest_id, c.nomor_kamar, c.tanggal_masuk, c.keterangan, c.created_by, c.created_at]);
      }
    }

    persist();
  } catch (err) {
    if (err.message.includes('Permission denied')) {
      console.warn('\n⚠️ [Firebase Notice] Realtime Database memerlukan pengubahan Rules agar bisa diakses public:');
      console.warn('   Buka Firebase Console -> Realtime Database -> Rules -> Ubah menjadi:');
      console.warn('   { "rules": { ".read": true, ".write": true } }\n');
    } else {
      console.warn('[Firebase Sync Skipped]', err.message);
    }
  }
}

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

  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    db = new SQL.Database(data);
    console.log('[DB] Loaded database:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created database:', DB_PATH);
  }

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

  // Try sync with Firebase Realtime Database
  await syncFromFirebase();

  startAutoPersist();
  console.log('[DB] Database initialized.');
}

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

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

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

function detectIdentityType(noIdentitas) {
  if (!noIdentitas) return 'LAINNYA';
  const clean = String(noIdentitas).trim().replace(/\s/g, '');
  if (/^\d{16}$/.test(clean)) return 'NIK';
  return 'PASSPORT';
}

module.exports = { initDB, getDB, queryAll, queryOne, run, transaction, detectIdentityType };
