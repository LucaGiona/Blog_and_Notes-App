// Postausgang: Änderungen, die offline gemacht wurden und noch zum Server müssen.
// Liegt in IndexedDB, weil dort auch Bilder (Blobs) gespeichert werden können.
//
// Ein Eintrag sieht z. B. so aus:
//   { key: 3, type: 'update', id: 'abc-123', data: { title, body, status }, at: '2026-…' }
//   { key: 4, type: 'upload', tempUrl: 'uploads/pending-x1y2.webp', file: Blob, name: 'bild.webp' }
// Typen: create | update | delete | upload. Abgearbeitet wird in der Reihenfolge von key.

const DB_NAME = 'notizblog';
const STORE = 'outbox';
let dbPromise = null;

function openDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB nicht verfügbar'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Kleiner Helfer: eine Aktion in einer Transaktion ausführen und auf das Ergebnis warten
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export async function all() {
  try {
    return (await tx('readonly', s => s.getAll())) ?? [];
  } catch {
    return [];
  }
}

export const count = async () => (await all()).length;
export const add = op => tx('readwrite', s => s.add(op));
export const put = op => tx('readwrite', s => s.put(op));
export const remove = key => tx('readwrite', s => s.delete(key));

export async function clearOutbox() {
  try { await tx('readwrite', s => s.clear()); } catch {}
}

// Offline eingefügtes Bild wieder entfernt -> gar nicht erst hochladen
export async function removeUploadOp(tempUrl) {
  for (const op of await all()) {
    if (op.type === 'upload' && op.tempUrl === tempUrl) await remove(op.key);
  }
}

// Nach dem Hochladen eines Bildes: Platzhalter-Adresse in allen wartenden Texten ersetzen
export async function rewriteUrl(from, to) {
  for (const op of await all()) {
    if (op.data?.body?.includes(from)) {
      op.data.body = op.data.body.split(from).join(to);
      await put(op);
    }
  }
}

// Nach dem Anlegen eines offline erstellten Artikels: vorläufige ID durch die echte ersetzen
export async function renameId(from, to) {
  for (const op of await all()) {
    if (op.id === from) {
      op.id = to;
      await put(op);
    }
  }
  const map = idMap();
  map[from] = to;
  try { localStorage.setItem('notizblog.idmap', JSON.stringify(map)); } catch {}
}

// Ein noch offener Editor kennt evtl. nur die vorläufige ID -> übersetzen
export function translateId(id) {
  return idMap()[id] ?? id;
}

function idMap() {
  try { return JSON.parse(localStorage.getItem('notizblog.idmap')) ?? {}; } catch { return {}; }
}
