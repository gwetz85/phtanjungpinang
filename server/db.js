const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const FIREBASE_URL = process.env.FIREBASE_URL || 'https://pelangihotel-35986-default-rtdb.asia-southeast1.firebasedatabase.app';
const LOCAL_JSON = path.join(__dirname, '..', 'hotel-data.json');

// In-Memory Database State
let dbData = {
  users: [],
  guests: [],
  checkins: [],
  counters: { users: 1, guests: 1, checkins: 1 }
};

let isInitialized = false;

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
  if (json && json.error && !String(json.error).includes('Permission denied')) {
    throw new Error(`Firebase Error (${endpoint}): ${json.error}`);
  }
  return json;
}

/**
 * Persist memory state to disk and Firebase
 */
function persist() {
  // Local JSON fallback
  if (!process.env.VERCEL) {
    try {
      fs.writeFileSync(LOCAL_JSON, JSON.stringify(dbData, null, 2));
    } catch (e) {}
  }
  // Sync to Firebase Cloud
  syncToFirebase().catch(() => {});
}

async function syncToFirebase() {
  try {
    await firebaseFetch('/dbData', 'PUT', dbData);
  } catch (e) {}
}

async function syncFromFirebase() {
  try {
    const cloudData = await firebaseFetch('/dbData', 'GET');
    if (cloudData && typeof cloudData === 'object' && cloudData.users) {
      dbData = {
        users: Array.isArray(cloudData.users) ? cloudData.users.filter(Boolean) : Object.values(cloudData.users),
        guests: Array.isArray(cloudData.guests) ? cloudData.guests.filter(Boolean) : (cloudData.guests ? Object.values(cloudData.guests) : []),
        checkins: Array.isArray(cloudData.checkins) ? cloudData.checkins.filter(Boolean) : (cloudData.checkins ? Object.values(cloudData.checkins) : []),
        counters: cloudData.counters || { users: 1, guests: 1, checkins: 1 }
      };
      console.log('[Firebase] Cloud data synced successfully.');
      return true;
    }
  } catch (err) {}
  return false;
}

async function initDB() {
  if (isInitialized) return;

  // Try loading local JSON file if exists
  if (!process.env.VERCEL && fs.existsSync(LOCAL_JSON)) {
    try {
      dbData = JSON.parse(fs.readFileSync(LOCAL_JSON, 'utf8'));
    } catch (e) {}
  }

  // Sync from Firebase Cloud
  await syncFromFirebase();

  // Seed default users if empty
  if (!dbData.users || dbData.users.length === 0) {
    const seedUsers = [
      { username: 'superadmin', password: 'superadmin123', nama: 'Super Administrator', role: 'superadmin' },
      { username: 'admin',      password: 'admin123',      nama: 'Administrator',       role: 'admin' },
      { username: 'receptionist', password: 'recep123',   nama: 'Resepsionis',          role: 'receptionist' },
    ];
    dbData.users = seedUsers.map((u, i) => ({
      id: i + 1,
      username: u.username,
      password: bcrypt.hashSync(u.password, 10),
      nama: u.nama,
      role: u.role,
      created_at: new Date().toISOString()
    }));
    dbData.counters.users = 4;
    persist();
    console.log('[DB] Default users seeded.');
  }

  isInitialized = true;
  console.log('[DB] Database initialized.');
}

/**
 * Helper to compute calculated fields for a guest (total_checkins, last_checkin, last_room)
 */
/**
 * Helper to compute calculated fields for a guest (total_checkins, last_checkin, last_room)
 */
function enrichGuest(guest) {
  if (!guest) return null;
  const checkins = (dbData.checkins || []).filter(Boolean);
  const guestCheckins = checkins
    .filter(c => String(c.guest_id) === String(guest.id))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const lastCi = guestCheckins[0] || null;

  return {
    ...guest,
    total_checkins: guestCheckins.length,
    last_checkin: lastCi ? lastCi.tanggal_masuk : null,
    last_room: lastCi ? lastCi.nomor_kamar : null
  };
}

/**
 * Pure JavaScript Query Engine
 */
function queryAll(sql, params = []) {
  const cleanSql = sql.replace(/\s+/g, ' ').trim();
  const safeUsers = (dbData.users || []).filter(Boolean);
  const safeGuests = (dbData.guests || []).filter(Boolean);
  const safeCheckins = (dbData.checkins || []).filter(Boolean);

  // 1. SELECT users
  if (cleanSql.toLowerCase().includes('from users')) {
    if (cleanSql.toLowerCase().includes('where username =')) {
      const u = safeUsers.find(x => x.username === params[0]);
      return u ? [u] : [];
    }
    if (cleanSql.toLowerCase().includes('where id =')) {
      const u = safeUsers.find(x => String(x.id) === String(params[0]));
      return u ? [u] : [];
    }
    return [...safeUsers].sort((a,b) => (a.role || '').localeCompare(b.role || '') || (a.nama || '').localeCompare(b.nama || ''));
  }

  // 2. GET guests with checkin history (Paginated / Search)
  if (cleanSql.toLowerCase().includes('from guests')) {
    let list = [...safeGuests];

    // Filter by search / nationality if present
    if (params.length > 0) {
      const searchStr = params[0] ? String(params[0]).replace(/%/g, '').toLowerCase() : '';
      if (searchStr && cleanSql.toLowerCase().includes('like')) {
        list = list.filter(g =>
          (g.no_identitas && g.no_identitas.toLowerCase().includes(searchStr)) ||
          (g.nama_tamu && g.nama_tamu.toLowerCase().includes(searchStr))
        );
      }
    }

    // Enrich guests with check-in info
    const enriched = list.map(enrichGuest).filter(Boolean);

    // Sort by updated_at DESC
    enriched.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));

    // Export query check
    if (cleanSql.includes('ROW_NUMBER()') || cleanSql.includes('"ROOM NO"')) {
      return enriched.map((g, idx) => ({
        "NO": idx + 1,
        "ROOM NO": g.last_room || '-',
        "NAMA TAMU": g.nama_tamu,
        "UMUR": g.umur || '-',
        "EXPIRY": g.expiry_identitas || '-',
        "NATIONALITY": g.kewarganegaraan || '-',
        "IDENTITAS": g.no_identitas,
        "DATANG DARI": g.datang_dari || '-',
        "TANGGAL MASUK": g.last_checkin || '-',
        "KET": ''
      }));
    }

    // Handle LIMIT / OFFSET if present at end of query
    const limitMatch = cleanSql.match(/limit\s+(\d+)(?:\s+offset\s+(\d+))?/i);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1]);
      const offset = limitMatch[2] ? parseInt(limitMatch[2]) : 0;
      return enriched.slice(offset, offset + limit);
    }

    return enriched;
  }

  // 3. SELECT checkins for guest
  if (cleanSql.toLowerCase().includes('from checkins')) {
    const guestId = params[0];
    const list = safeCheckins
      .filter(c => String(c.guest_id) === String(guestId))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    return list.map(c => {
      const u = safeUsers.find(x => String(x.id) === String(c.created_by));
      return { ...c, petugas: u ? u.nama : '-' };
    });
  }

  return [];
}

function queryOne(sql, params = []) {
  const cleanSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const safeUsers = (dbData.users || []).filter(Boolean);
  const safeGuests = (dbData.guests || []).filter(Boolean);

  // COUNT guests
  if (cleanSql.includes('count(*)') && cleanSql.includes('from guests')) {
    let list = [...safeGuests];
    if (params.length > 0 && params[0]) {
      const searchStr = String(params[0]).replace(/%/g, '').toLowerCase();
      list = list.filter(g =>
        (g.no_identitas && g.no_identitas.toLowerCase().includes(searchStr)) ||
        (g.nama_tamu && g.nama_tamu.toLowerCase().includes(searchStr))
      );
    }
    return { total: list.length };
  }

  // GET single user
  if (cleanSql.includes('from users')) {
    if (cleanSql.includes('where username =')) {
      return safeUsers.find(x => x.username === String(params[0]).trim()) || null;
    }
    if (cleanSql.includes('where id =')) {
      return safeUsers.find(x => String(x.id) === String(params[0])) || null;
    }
  }

  // GET single guest
  if (cleanSql.includes('from guests')) {
    if (cleanSql.includes('where no_identitas =')) {
      return safeGuests.find(x => x.no_identitas === String(params[0]).trim()) || null;
    }
    if (cleanSql.includes('where id =')) {
      return safeGuests.find(x => String(x.id) === String(params[0])) || null;
    }
  }

  const rows = queryAll(sql, params);
  return rows[0] || null;
}

/**
 * Pure JavaScript Mutation Engine (INSERT / UPDATE / DELETE)
 */
function run(sql, params = []) {
  const cleanSql = sql.replace(/\s+/g, ' ').trim();
  const now = new Date().toISOString();
  let lastInsertRowid = 0;

  // 1. INSERT INTO users
  if (cleanSql.toLowerCase().startsWith('insert into users')) {
    const id = dbData.counters.users++;
    const newUser = {
      id,
      username: params[0],
      password: params[1],
      nama: params[2],
      role: params[3],
      created_at: now
    };
    dbData.users.push(newUser);
    lastInsertRowid = id;
  }

  // 2. INSERT INTO guests
  else if (cleanSql.toLowerCase().startsWith('insert into guests')) {
    const id = dbData.counters.guests++;
    const newGuest = {
      id,
      no_identitas: params[0],
      jenis_identitas: params[1] || 'PASSPORT',
      nama_tamu: params[2],
      umur: params[3] || '',
      expiry_identitas: params[4] || '',
      kewarganegaraan: params[5] || '',
      datang_dari: params[6] || '',
      created_at: params[7] || now,
      updated_at: params[8] || now
    };
    dbData.guests.push(newGuest);
    lastInsertRowid = id;
  }

  // 3. INSERT INTO checkins
  else if (cleanSql.toLowerCase().startsWith('insert into checkins')) {
    const id = dbData.counters.checkins++;
    const newCheckin = {
      id,
      guest_id: parseInt(params[0]),
      nomor_kamar: params[1] || '',
      tanggal_masuk: params[2] || '',
      keterangan: params[3] || '',
      created_by: params[4] ? parseInt(params[4]) : null,
      created_at: params[5] || now
    };
    dbData.checkins.push(newCheckin);
    lastInsertRowid = id;
  }

  // 4. UPDATE guests
  else if (cleanSql.toLowerCase().startsWith('update guests')) {
    if (cleanSql.toLowerCase().includes('where no_identitas=')) {
      // params: [nama_tamu, umur, expiry_identitas, kewarganegaraan, datang_dari, updated_at, no_identitas]
      const g = dbData.guests.find(x => x.no_identitas === params[6]);
      if (g) {
        g.nama_tamu = params[0];
        g.umur = params[1];
        g.expiry_identitas = params[2];
        g.kewarganegaraan = params[3];
        g.datang_dari = params[4];
        g.updated_at = params[5] || now;
      }
    } else if (cleanSql.toLowerCase().includes('where id=')) {
      if (params.length === 2 && cleanSql.includes('updated_at=?')) {
        const g = dbData.guests.find(x => String(x.id) === String(params[1]));
        if (g) g.updated_at = params[0];
      } else {
        const g = dbData.guests.find(x => String(x.id) === String(params[5]));
        if (g) {
          g.nama_tamu = params[0];
          g.umur = params[1];
          g.expiry_identitas = params[2];
          g.kewarganegaraan = params[3];
          g.datang_dari = params[4];
          g.updated_at = now;
        }
      }
    }
  }

  // 5. UPDATE users
  else if (cleanSql.toLowerCase().startsWith('update users')) {
    if (params.length === 4) {
      // nama, role, password, id
      const u = dbData.users.find(x => String(x.id) === String(params[3]));
      if (u) { u.nama = params[0]; u.role = params[1]; u.password = params[2]; }
    } else if (params.length === 3) {
      // nama, role, id
      const u = dbData.users.find(x => String(x.id) === String(params[2]));
      if (u) { u.nama = params[0]; u.role = params[1]; }
    }
  }

  // 6. DELETE FROM checkins
  else if (cleanSql.toLowerCase().startsWith('delete from checkins')) {
    const guestId = params[0];
    dbData.checkins = dbData.checkins.filter(c => String(c.guest_id) !== String(guestId));
  }

  // 7. DELETE FROM guests
  else if (cleanSql.toLowerCase().startsWith('delete from guests')) {
    const guestId = params[0];
    dbData.guests = dbData.guests.filter(g => String(g.id) !== String(guestId));
    dbData.checkins = dbData.checkins.filter(c => String(c.guest_id) !== String(guestId));
  }

  // 8. DELETE FROM users
  else if (cleanSql.toLowerCase().startsWith('delete from users')) {
    const userId = params[0];
    dbData.users = dbData.users.filter(u => String(u.id) !== String(userId));
  }

  persist();
  return { lastInsertRowid, changes: 1 };
}

function transaction(fn) {
  fn();
  persist();
}

function detectIdentityType(noIdentitas) {
  if (!noIdentitas) return 'LAINNYA';
  const clean = String(noIdentitas).trim().replace(/\s/g, '');
  if (/^\d{16}$/.test(clean)) return 'NIK';
  return 'PASSPORT';
}

function getDB() {
  return dbData;
}

module.exports = { initDB, getDB, queryAll, queryOne, run, transaction, detectIdentityType };
