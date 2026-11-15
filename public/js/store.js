// Local persistence. Everything lives in this browser's IndexedDB; nothing
// is sent anywhere. Two keys: "items" (the imported library, written only
// on import) and "state" (rotation, flags and filters, written often).
//
// This module is the single seam a future sync backend would replace or
// wrap. See docs/EXTENDING.md.

const DB_NAME = 'saved-shuffle';
const STORE = 'kv';
let dbPromise = null;
const memory = new Map();
let usingMemory = false;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Storage is blocked by another tab.'));
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const isPersistent = () => !usingMemory;

export async function get(key) {
  if (usingMemory) return memory.get(key);
  try {
    return await run('readonly', (store) => store.get(key));
  } catch {
    usingMemory = true;
    return memory.get(key);
  }
}

export async function set(key, value) {
  memory.set(key, value);
  if (usingMemory) return false;
  try {
    await run('readwrite', (store) => store.put(value, key));
    return true;
  } catch {
    usingMemory = true;
    return false;
  }
}

export async function clearAll() {
  memory.clear();
  if (usingMemory) return;
  try {
    await run('readwrite', (store) => store.clear());
  } catch {
    usingMemory = true;
  }
}
