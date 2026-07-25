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
  counters: { users: 1, guests: 1, checkins: 1 },
  runningText: 'Selamat Datang di PELANGI HOTEL Tanjungpinang! Nikmati kenyamanan dan layanan terbaik kami.'
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
        counters: cloudData.counters || { users: 1, guests: 1, checkins: 1 },
        runningText: cloudData.runningText || 'Selamat Datang di PELANGI HOTEL Tanjungpinang! Nikmati kenyamanan dan layanan terbaik kami.'
      };
      sanitizeData();
      console.log('[Firebase] Cloud data synced successfully.');
      return true;
    }
  } catch (err) {}
  return false;
}

function sanitizeData() {
  const invalid = ['NAMA TAMU', 'NAMA', 'NAME', 'DATANG', 'NATIONALITY', 'KEWARGANEGARAAN', 'IDENTITAS', 'ENTITAS', 'UMUR'];
  if (dbData.guests) {
    dbData.guests = dbData.guests.filter(g => {
      if (!g || !g.nama_tamu) return false;
      const u = String(g.nama_tamu).trim().toUpperCase();
      if (invalid.includes(u) || u.includes('NAMA TAMU')) return false;
      return true;
    });
  }
  if (dbData.checkins) {
    const validGuestIds = new Set((dbData.guests || []).map(g => String(g.id)));
    dbData.checkins = dbData.checkins.filter(c => {
      if (!c) return false;
      if (!validGuestIds.has(String(c.guest_id))) return false;
      const roomUpper = String(c.nomor_kamar || '').trim().toUpperCase();
      const tglUpper = String(c.tanggal_masuk || '').trim().toUpperCase();
      if (roomUpper === 'ROOM' || roomUpper === 'KAMAR' || tglUpper === 'TANGGAL' || tglUpper === 'DATANG') return false;
      return true;
    });
  }
}

async function initDB() {
  // Try loading local JSON file if exists
  if (!process.env.VERCEL && fs.existsSync(LOCAL_JSON)) {
    try {
      dbData = JSON.parse(fs.readFileSync(LOCAL_JSON, 'utf8'));
    } catch (e) {}
  }

  // Sync from Firebase Cloud
  await syncFromFirebase();

  sanitizeData();

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
function enrichGuest(guest) {
  if (!guest || typeof guest !== 'object' || !guest.id) return null;
  try {
    const checkins = (dbData.checkins || []).filter(c => c && typeof c === 'object' && c.guest_id);
    const guestCheckins = checkins
      .filter(c => String(c.guest_id) === String(guest.id))
      .sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
      });

    const lastCi = guestCheckins[0] || null;

    return {
      ...guest,
      total_checkins: guestCheckins.length,
      last_checkin: lastCi ? (lastCi.tanggal_masuk || null) : null,
      last_room: lastCi ? (lastCi.nomor_kamar || null) : null
    };
  } catch (e) {
    console.error('[enrichGuest] Error:', e);
    return {
      ...guest,
      total_checkins: 0,
      last_checkin: null,
      last_room: null
    };
  }
}

/**
 * Pure JavaScript Query Engine
 */
function queryAll(sql, params = []) {
  const cleanSql = sql.replace(/\s+/g, ' ').trim();
  const safeUsers = (dbData.users || []).filter(Boolean);
  const safeGuests = (dbData.guests || []).filter(g => g && typeof g === 'object' && g.id);
  const safeCheckins = (dbData.checkins || []).filter(c => c && typeof c === 'object');

  // 1. SELECT users
  if (cleanSql.toLowerCase().includes('from users')) {
    if (cleanSql.toLowerCase().includes('where username =')) {
      const u = safeUsers.find(x => x.username === params[0]);
      return u ? [u] : [];
    }
    return [...safeUsers].sort((a,b) => (a.role || '').localeCompare(b.role || '') || (a.nama || '').localeCompare(b.nama || ''));
  }

  // 2. GET guests with checkin history (Paginated / Search)
  if (cleanSql.toLowerCase().includes('from guests')) {
    let list = [...safeGuests];

    // Extract limit and offset from LAST two params (they are always appended last)
    let limit  = null;
    let offset = 0;
    const sqlLower = cleanSql.toLowerCase();

    if (sqlLower.includes('limit ?')) {
      const allParams = [...params];
      if (allParams.length >= 2) {
        offset = parseInt(allParams[allParams.length - 1]) || 0;
        limit  = parseInt(allParams[allParams.length - 2]) || null;
      } else if (allParams.length === 1) {
        limit = parseInt(allParams[0]) || null;
      }
    }

    // Filter by search keyword (encoded in SQL as "search:keyword")
    const searchMatch = cleanSql.match(/search:([^\s]+)/i);
    if (searchMatch) {
      const term = decodeURIComponent(searchMatch[1]).toLowerCase();
      list = list.filter(g =>
        (g.no_identitas && String(g.no_identitas).toLowerCase().includes(term)) ||
        (g.nama_tamu    && String(g.nama_tamu).toLowerCase().includes(term))
      );
    }

    // Filter by nationality (encoded as "nationality:keyword")
    const natMatch = cleanSql.match(/nationality:([^\s]+)/i);
    if (natMatch) {
      const term = decodeURIComponent(natMatch[1]).toLowerCase();
      list = list.filter(g =>
        g.kewarganegaraan && String(g.kewarganegaraan).toLowerCase().includes(term)
      );
    }

    // Filter by WHERE ... LIKE ? (used by /search route: "WHERE g.no_identitas LIKE ? OR g.nama_tamu LIKE ?")
    if (!searchMatch && !natMatch && sqlLower.includes('where') && sqlLower.includes('like ?')) {
      // Extract LIKE params — they come before limit/offset params
      // For search: params = [term, term] or [term, term, limit]
      // term looks like "%keyword%"
      const likeParams = params.filter(p => typeof p === 'string' && p.startsWith('%') && p.endsWith('%'));
      if (likeParams.length > 0) {
        const term = likeParams[0].replace(/%/g, '').toLowerCase();
        if (term) {
          list = list.filter(g =>
            (g.no_identitas && String(g.no_identitas).toLowerCase().includes(term)) ||
            (g.nama_tamu    && String(g.nama_tamu).toLowerCase().includes(term))
          );
        }
      }
    }

    // Enrich guests with check-in info
    const enriched = list.map(enrichGuest).filter(Boolean);

    // Sort by updated_at DESC safely
    enriched.sort((a, b) => {
      const timeA = a && a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const timeB = b && b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });

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

    // Apply pagination (handle both "LIMIT ?" and literal "LIMIT N")
    if (limit !== null) {
      return enriched.slice(offset, offset + limit);
    }
    const literalLimitMatch = sqlLower.match(/limit\s+(\d+)/);
    if (literalLimitMatch) {
      const literalLimit = parseInt(literalLimitMatch[1]);
      return enriched.slice(0, literalLimit);
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

    // Search token format: "search:keyword"
    const sMatch = cleanSql.match(/search:([^\s]+)/i);
    if (sMatch) {
      const term = sMatch[1].toLowerCase();
      list = list.filter(g =>
        (g.no_identitas && g.no_identitas.toLowerCase().includes(term)) ||
        (g.nama_tamu    && g.nama_tamu.toLowerCase().includes(term))
      );
    }

    // Nationality token format: "nationality:keyword"
    const nMatch = cleanSql.match(/nationality:([^\s]+)/i);
    if (nMatch) {
      const term = nMatch[1].toLowerCase();
      list = list.filter(g =>
        g.kewarganegaraan && g.kewarganegaraan.toLowerCase().includes(term)
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
    if (cleanSql.includes('no_identitas')) {
      const searchId = String(params[0] || '').trim().toLowerCase();
      return safeGuests.find(x => x.no_identitas && String(x.no_identitas).trim().toLowerCase() === searchId) || null;
    }
    if (cleanSql.includes('where id =')) {
      return safeGuests.find(x => String(x.id) === String(params[0])) || null;
    }
    if (cleanSql.includes('nama_tamu')) {
      const searchName = String(params[0] || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return safeGuests.find(x => x.nama_tamu && String(x.nama_tamu).replace(/\s+/g, ' ').trim().toLowerCase() === searchName) || null;
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
    try {
      const whereVal = params[params.length - 1];
      let g = dbData.guests.find(x => String(x.id) === String(whereVal));
      if (!g && cleanSql.includes('no_identitas =')) {
        g = dbData.guests.find(x => String(x.no_identitas).trim() === String(whereVal).trim());
      }

      if (g && params.length >= 8) {
        g.nama_tamu        = params[0] || g.nama_tamu;
        g.jenis_identitas  = (params[1] && !String(params[1]).startsWith('AUTO-')) ? params[1] : g.jenis_identitas;
        g.no_identitas     = (params[2] && !String(params[2]).startsWith('AUTO-')) ? params[2] : g.no_identitas;
        g.umur             = params[3] !== undefined ? params[3] : g.umur;
        g.expiry_identitas = params[4] !== undefined ? params[4] : g.expiry_identitas;
        g.kewarganegaraan  = params[5] !== undefined ? params[5] : g.kewarganegaraan;
        g.datang_dari      = params[6] !== undefined ? params[6] : g.datang_dari;
        g.updated_at       = params[7] || now;
      }
    } catch (e) {
      console.error('[DB UPDATE guests] parse error:', e);
    }
  }

  // 5. UPDATE users
  else if (cleanSql.toLowerCase().startsWith('update users')) {
    if (cleanSql.toLowerCase().includes('device_id = null')) {
      const u = dbData.users.find(x => String(x.id) === String(params[0]));
      if (u) { u.device_id = null; }
    } else if (cleanSql.toLowerCase().includes('device_id = ?')) {
      const u = dbData.users.find(x => String(x.id) === String(params[1]));
      if (u) { u.device_id = params[0]; }
    } else if (cleanSql.toLowerCase().includes('last_login')) {
      const u = dbData.users.find(x => String(x.id) === String(params[1]));
      if (u) { u.last_login = params[0]; }
    } else if (params.length === 4) {
      // nama, role, password, id
      const u = dbData.users.find(x => String(x.id) === String(params[3]));
      if (u) { u.nama = params[0]; u.role = params[1]; u.password = params[2]; }
    } else if (params.length === 3) {
      // nama, role, id
      const u = dbData.users.find(x => String(x.id) === String(params[2]));
      if (u) { u.nama = params[0]; u.role = params[1]; }
    }
  }

  // 6. DELETE FROM checkins (by guest_id OR by month prefix)
  else if (cleanSql.toLowerCase().startsWith('delete from checkins')) {
    if (cleanSql.toLowerCase().includes('like')) {
      // DELETE FROM checkins WHERE tanggal_masuk LIKE 'YYYY-MM-%'
      const prefix = String(params[0] || '').replace(/%/g, '');
      dbData.checkins = dbData.checkins.filter(c => !String(c.tanggal_masuk || '').startsWith(prefix));
    } else {
      const guestId = params[0];
      dbData.checkins = dbData.checkins.filter(c => String(c.guest_id) !== String(guestId));
    }
  }

  // 7. DELETE FROM guests (by id, or ALL if no params)
  else if (cleanSql.toLowerCase().startsWith('delete from guests')) {
    if (params.length === 0) {
      // Clear ALL guests and checkins
      dbData.guests   = [];
      dbData.checkins = [];
    } else {
      const guestId = params[0];
      dbData.guests   = dbData.guests.filter(g => String(g.id) !== String(guestId));
      dbData.checkins = dbData.checkins.filter(c => String(c.guest_id) !== String(guestId));
    }
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
  const clean = String(noIdentitas).trim().replace(/\s/g, '').toUpperCase();
  if (clean.startsWith('NIK') || /^\d{16}$/.test(clean)) return 'NIK';
  if (clean.startsWith('SIM') || /^\d{12}$/.test(clean)) return 'SIM';
  return 'PASSPORT';
}

function getDB() {
  return dbData;
}

module.exports = { initDB, getDB, queryAll, queryOne, run, transaction, detectIdentityType, persist, syncFromFirebase, syncToFirebase };
