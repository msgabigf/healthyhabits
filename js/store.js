// Local-first storage on the phone (IndexedDB).
// checkins: one record per day, keyed by ISO date ("2026-09-25")
// files:    attachment blobs, keyed by id
// kv:       settings, config and small app state

const DB_NAME = 'rotina';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('checkins')) db.createObjectStore('checkins', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgraded the schema: let go so it can proceed
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const checkins = {
  get: (date) => tx('checkins', 'readonly', s => wrap(s.get(date))),
  put: (rec) => tx('checkins', 'readwrite', s => wrap(s.put(rec))),
  all: () => tx('checkins', 'readonly', s => wrap(s.getAll())),
  // newest first
  async recent(limit = 60) {
    const all = await checkins.all();
    all.sort((a, b) => (a.date < b.date ? 1 : -1));
    return all.slice(0, limit);
  },
  async range(from, to) {
    return tx('checkins', 'readonly', s => wrap(s.getAll(IDBKeyRange.bound(from, to))));
  },
};

export const files = {
  get: (id) => tx('files', 'readonly', s => wrap(s.get(id))),
  put: (rec) => tx('files', 'readwrite', s => wrap(s.put(rec))),
  delete: (id) => tx('files', 'readwrite', s => wrap(s.delete(id))),
  all: () => tx('files', 'readonly', s => wrap(s.getAll())),
};

export const kv = {
  get: (key) => tx('kv', 'readonly', s => wrap(s.get(key))),
  set: (key, value) => tx('kv', 'readwrite', s => wrap(s.put(value, key))),
};

// Ask iOS to treat this data as something the user wants kept, not a cache.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) { /* not supported */ }
  return false;
}
