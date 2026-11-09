// Minimální obal nad IndexedDB.
// kv – nastavení a mezipaměť, rooms – dokumenty místností v zařízení, outbox – co čeká na odeslání,
// demo – „SharePoint“ testovacího režimu.

const DB_NAME = 'inventura';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of ['kv', 'rooms', 'demo']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  put: (store, value, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
  del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  keys: (store) => tx(store, 'readonly', (s) => s.getAllKeys()),
  count: (store) => tx(store, 'readonly', (s) => s.count()),
  clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
};
