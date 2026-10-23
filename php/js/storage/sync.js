// Speicher mit Postausgang – das, was die App normalerweise benutzt.
//
// Online:  alles geht direkt an den Server (apiStore).
// Offline: Lesen kommt aus dem Zwischenspeicher des Service Workers.
//          Schreiben landet im Postausgang – aber NUR auf eigenen Geräten
//          („angemeldet bleiben“ beim Login angehakt). Sobald wieder Netz da ist,
//          schickt sync() alles der Reihe nach an den Server.
//
// Der Server bleibt der Türsteher: Auch beim Synchronisieren prüft er das Login-Cookie.

import { apiStore, NetworkError, HttpError, connection } from './api.js';
import * as outbox from '../outbox.js';
import { device } from '../device.js';

const notify = () => window.dispatchEvent(new Event('outbox:change'));

const nowIso = () => new Date().toISOString();
const randomId = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 12);

// ---------- Lesen ----------

// Wartende Änderungen auf eine Artikelliste anwenden, damit man sie offline sieht
function applyOps(posts, ops) {
  let list = posts.map(p => ({ ...p }));
  for (const op of ops) {
    if (op.type === 'create') {
      list.push({ ...op.data, id: op.id, createdAt: op.at, updatedAt: op.at, pending: true });
    } else if (op.type === 'update') {
      const post = list.find(p => p.id === op.id);
      if (post) Object.assign(post, op.data, { updatedAt: op.at, pending: true });
    } else if (op.type === 'delete') {
      list = list.filter(p => p.id !== op.id);
    }
  }
  return list;
}

async function list() {
  const ops = await outbox.all();
  let posts;
  try {
    posts = await apiStore.list();
  } catch (err) {
    // Offline und nichts zwischengespeichert: nur zeigen, was im Postausgang liegt
    if (!(err instanceof NetworkError) || ops.length === 0) throw err;
    posts = [];
  }
  return applyOps(posts, ops);
}

/**
 * Die zuletzt geladene Artikelliste direkt aus dem Zwischenspeicher des Geräts –
 * ohne aufs Netz zu warten. Damit zeigt die Startseite sofort etwas, während die
 * frische Liste im Hintergrund kommt. null, wenn nichts gespeichert ist.
 */
async function cachedList() {
  if (device.shortSession || !('caches' in window)) return null;
  try {
    const cache = await caches.open('notizblog-api');
    const res = await cache.match(new URL('api/posts', location.href).href, { ignoreVary: true });
    if (!res) return null;
    return applyOps(await res.json(), await outbox.all());
  } catch {
    return null;
  }
}

/**
 * Was dieses Gerät beim Server gespeichert hat, sofort auch in die gespeicherte Liste
 * (Zwischenspeicher des Service Workers) eintragen. Sonst fehlt ein Artikel offline in der
 * Liste, wenn er direkt beim Server angelegt wurde und die Verbindung kurz danach weg war –
 * er war dann bis zum nächsten Laden unsichtbar („Eintrag weg“). removeId = Artikel entfernen.
 */
async function remember(post, removeId = null) {
  if (device.shortSession || !('caches' in window)) return;
  try {
    const cache = await caches.open('notizblog-api');
    const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    const listUrl = new URL('api/posts', location.href).href;
    const res = await cache.match(listUrl, { ignoreVary: true });
    if (res) {
      const gone = removeId ?? post.id;
      const list = (await res.json()).filter(p => p.id !== gone);
      if (post) list.push(post);
      await cache.put(listUrl, json(list));
    }
    if (post) await cache.put(new URL(`api/posts/${post.id}`, location.href).href, json(post));
  } catch { /* nur eine Hilfe für offline – ohne geht es auch */ }
}
const remembered = post => { remember(post); return post; };

async function get(id) {
  id = outbox.translateId(id);
  if (id.startsWith('local-')) return (await list()).find(p => p.id === id) ?? null;
  // Schon bekannt, dass der Server nicht antwortet: gleich aus der gespeicherten Liste
  // nehmen statt 10 s auf eine Zeitüberschreitung zu warten
  if (!connection.online) {
    const known = (await list().catch(() => [])).find(p => p.id === id);
    if (known) return known;
  }

  let post;
  try {
    post = await apiStore.get(id);
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err;
    return (await list()).find(p => p.id === id) ?? null;
  }
  if (!post) return null;
  return applyOps([post], await outbox.all())[0] ?? null;
}

// ---------- Schreiben ----------

// Darf auf diesem Gerät überhaupt offline gespeichert werden?
const canQueue = () => device.trusted;

// Vorübergehender Server-Fehler (Server überlastet, PHP läuft nicht hinter Tailscale = 502,
// Wartung beim Hoster = 503): wie „kein Netz“ behandeln – später nochmal versuchen
const isTemporary = err => err instanceof HttpError && (err.status >= 500 || err.status === 408 || err.status === 429);

// Erst direkt versuchen. Kein Netz -> in den Postausgang (nur auf eigenen Geräten).
// Liegt schon etwas im Postausgang, wird hinten angestellt, damit die Reihenfolge stimmt.
async function directOrQueue(direct, queue) {
  // Wartet schon etwas – oder ist schon bekannt, dass der Server nicht antwortet –,
  // gleich in den Postausgang statt erst auf eine Zeitüberschreitung zu warten
  if (canQueue() && (!connection.online || (await outbox.count()) > 0)) {
    const result = await queue();
    sync();
    return result;
  }
  try {
    return await direct();
  } catch (err) {
    if (err instanceof NetworkError || isTemporary(err)) {
      if (!canQueue()) throw err instanceof NetworkError ? new NetworkError('keine Verbindung zum Server') : err;
      return queue();
    }
    throw err;
  }
}

// Änderung anhängen – oder mit dem letzten Eintrag zusammenfassen, wenn der denselben
// Artikel betrifft (Autosave erzeugt sonst bei jedem Tippen einen neuen Eintrag).
// Nur mit dem LETZTEN Eintrag, damit z. B. ein Bild-Upload davor nicht übersprungen wird,
// und nie mit einem Eintrag, der gerade gesendet wird (siehe outbox.mergeOrAdd).
async function queueSave(id, data) {
  const at = nowIso();
  await outbox.mergeOrAdd(id, data, at);
  notify();
  return { ...(await get(id)), ...data, id, updatedAt: at, pending: true };
}

// Jeder neue Artikel bekommt sofort eine Kennung vom Gerät (clientId). Der Server legt
// zu einer Kennung nur EINEN Artikel an – kommt dieselbe Anfrage zweimal an (Antwort ging
// verloren, Zeitgrenze abgelaufen, zwei Fenster synchronisieren gleichzeitig), bekommt
// man den schon angelegten Artikel zurück statt eines Doppelten.
async function create(data) {
  const id = 'local-' + randomId();
  return directOrQueue(
    () => apiStore.create({ ...data, clientId: id }).then(remembered),
    async () => {
      const at = nowIso();
      await outbox.add({ type: 'create', id, data, at });
      notify();
      return { ...data, id, createdAt: at, updatedAt: at, pending: true };
    },
  );
}

async function update(id, data) {
  id = outbox.translateId(id);
  return directOrQueue(() => apiStore.update(id, data).then(remembered), () => queueSave(id, data));
}

async function remove(id) {
  id = outbox.translateId(id);
  return directOrQueue(
    () => apiStore.remove(id).then(() => remember(null, id)),
    async () => {
      // Wartende Änderungen an diesem Artikel sind dann überflüssig
      for (const op of await outbox.all()) {
        if (op.id === id) await outbox.remove(op.key);
      }
      // Nur offline angelegt -> der Server kennt ihn gar nicht, nichts weiter zu tun
      if (!id.startsWith('local-')) await outbox.add({ type: 'delete', id, at: nowIso() });
      notify();
      return null;
    },
  );
}

async function upload(file) {
  return directOrQueue(
    () => apiStore.upload(file),
    async () => {
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const tempUrl = `uploads/pending-${randomId()}.${ext}`;
      await outbox.add({ type: 'upload', tempUrl, file, name: file.name || `bild.${ext}`, at: nowIso() });
      notify();
      return { url: tempUrl, pending: true };
    },
  );
}

// Bild löschen: offline eingefügte Bilder aus dem Postausgang nehmen, sonst beim
// Server löschen lassen. Klappt das nicht (offline, noch verwendet), bleibt die
// Datei einfach liegen – das ist harmlos.
async function removeUpload(url) {
  if (url.includes('/pending-')) {
    await outbox.removeUploadOp(url);
    notify();
    return true;
  }
  try {
    await apiStore.removeUpload(url);
    return true;
  } catch {
    return false;
  }
}

// Themen umbenennen/löschen betrifft viele Artikel auf einmal -> nur online
async function renameTag(from, to) {
  try {
    return await apiStore.renameTag(from, to);
  } catch (err) {
    if (err instanceof NetworkError) throw new Error('Themen umbenennen/löschen geht nur online.');
    throw err;
  }
}

// ---------- Synchronisieren ----------

let running = null;
export let lastSyncError = null;

// Mehrfachaufrufe teilen sich einen Durchlauf. Dazu eine Sperre über alle Fenster
// hinweg (App und Browser-Tab teilen sich denselben Postausgang): Sonst schicken zwei
// Fenster dieselbe Änderung gleichzeitig ab.
export function sync() {
  running ??= withSyncLock(run).finally(() => {
    running = null;
    notify();
  });
  return running;
}

function withSyncLock(fn) {
  if (!navigator.locks) return fn(); // ältere Browser: wie bisher
  return navigator.locks.request('notizblog-sync', fn);
}

// Steht auf dem Server (a) dasselbe wie in der wartenden Änderung (b)?
// Mit status: Entwurf und Veröffentlicht sind NICHT dasselbe.
const sameText = (a, b) => !!a
  && a.title === b.title && a.body === b.body
  && JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? a.tags ?? [])
  && (b.private === undefined || !!a.private === !!b.private);
const sameStatus = (a, b) => b.status === undefined || a.status === b.status;
const revOf = p => p?.rev ?? p?.updatedAt;

async function run() {
  lastSyncError = null;
  for (;;) {
    // Eintrag holen und sperren: Ab jetzt hängt Autosave nichts mehr an ihn an
    const op = await outbox.claimFirst().catch(() => null);
    if (!op) return 'done';

    try {
      if (op.type === 'upload') {
        const file = new File([op.file], op.name, { type: op.file.type });
        const { url } = await apiStore.upload(file);
        await outbox.rewriteUrl(op.tempUrl, url);
      } else if (op.type === 'create') {
        // Schreibzeit mitschicken – sonst gälte die Zeit des Synchronisierens
        const post = remembered(await apiStore.create({ ...op.data, createdAt: op.at, clientId: op.id }));
        await outbox.renameId(op.id, post.id);
        window.dispatchEvent(new CustomEvent('outbox:idmap', { detail: { from: op.id, to: post.id } }));
        await outbox.rebase(post.id, undefined, revOf(post));
      } else if (op.type === 'update') {
        await sendUpdate(op);
      } else if (op.type === 'delete') {
        try {
          await apiStore.remove(op.id);
          remember(null, op.id);
        } catch (err) {
          if (!(err instanceof HttpError && err.status === 404)) throw err;
        }
      }
      await outbox.remove(op.key);
      notify();
    } catch (err) {
      if (err instanceof NetworkError) {                          // später nochmal
        await outbox.release(op.key);
        return 'offline';
      }
      if (err instanceof HttpError && err.status === 401) {       // erst wieder anmelden
        await outbox.release(op.key);
        lastSyncError = 'Bitte neu anmelden, dann wird synchronisiert.';
        return 'auth';
      }
      if (isTemporary(err)) {                                     // Server-Fehler: Eintrag bleibt
        await outbox.release(op.key);
        lastSyncError = `Server-Fehler (${err.status}) – deine Änderungen bleiben auf diesem Gerät und werden später nochmal geschickt.`;
        return 'retry';
      }
      // Dauerhaft abgelehnt (z. B. Bild im falschen Format). Text geht trotzdem nicht verloren:
      // Er wird als eigener Entwurf „(nicht synchronisiert)“ gesichert. Klappt auch das nicht,
      // bleibt der Eintrag auf dem Gerät und die Synchronisierung wartet.
      console.error('Synchronisieren fehlgeschlagen:', op, err);
      if ((op.type === 'create' || op.type === 'update') && op.data) {
        const { baseUpdatedAt, ...data } = op.data;
        try {
          remembered(await apiStore.create({ ...data, title: `${data.title || 'Ohne Titel'} (nicht synchronisiert)`, status: 'draft' }));
        } catch {
          await outbox.release(op.key);
          lastSyncError = `Eine Änderung wird vom Server abgelehnt (${err.message}). Sie bleibt auf diesem Gerät gespeichert.`;
          return 'error';
        }
        lastSyncError = `Eine Änderung wurde vom Server abgelehnt (${err.message}) – sie liegt als Entwurf „(nicht synchronisiert)“ daneben.`;
      } else {
        lastSyncError = `Ein Eintrag konnte nicht synchronisiert werden: ${err.message}`;
      }
      await outbox.remove(op.key);
      notify();
    }
  }
}

// Eine wartende Änderung senden. Danach bekommen weitere wartende Änderungen am selben
// Artikel den neuen Stand (outbox.rebase) – sonst würden sie als Konflikt gelten.
async function sendUpdate(op) {
  const { baseUpdatedAt, ...data } = op.data;
  // Folge-Änderung einer Konflikt-Kopie: Titel und Entwurf beibehalten
  const send = op.conflictCopy
    ? { ...op.data, title: `${data.title} (Konflikt)`, status: 'draft' }
    : op.data;
  let saved;
  try {
    saved = await apiStore.update(op.id, send);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    if (err.status === 404) {
      // Artikel gibt es auf dem Server nicht mehr -> Text nicht verlieren, neu anlegen;
      // weitere wartende Änderungen gehen an den neuen Artikel
      const created = remembered(await apiStore.create(data));
      await outbox.rebase(op.id, baseUpdatedAt, revOf(created), created.id);
      return;
    }
    if (err.status === 409 && sameText(err.current, data)) {
      // Text steht schon so auf dem Server (z. B. Anfrage kam doppelt an).
      // Nur der Status ist anders (z. B. offline „Veröffentlichen“ gedrückt)? -> den nachholen
      saved = sameStatus(err.current, data)
        ? err.current
        : await apiStore.update(op.id, { ...send, baseUpdatedAt: revOf(err.current) });
    } else if (err.status === 409) {
      // Inzwischen auf einem anderen Gerät geändert -> nichts überschreiben, die Offline-Fassung
      // als eigenen Entwurf daneben legen. Weitere wartende Änderungen gehen in DIESELBE Kopie.
      const copy = remembered(await apiStore.create({ ...data, title: `${data.title} (Konflikt)`, status: 'draft' }));
      await outbox.rebase(op.id, baseUpdatedAt, revOf(copy), copy.id, { conflictCopy: true });
      lastSyncError = `„${data.title}“ wurde auch auf einem anderen Gerät geändert – deine Fassung liegt als „(Konflikt)“-Entwurf daneben.`;
      return;
    } else {
      throw err;
    }
  }
  remember(saved);
  await outbox.rebase(op.id, baseUpdatedAt, revOf(saved));
}

// Offline eingefügte Bilder direkt aus dem Postausgang anzeigen
export async function showPendingImages(container) {
  const imgs = container.querySelectorAll('img[src^="uploads/pending-"]');
  if (!imgs.length) return;
  const uploads = (await outbox.all()).filter(op => op.type === 'upload');
  for (const img of imgs) {
    const op = uploads.find(u => u.tempUrl === img.getAttribute('src'));
    if (op) img.src = URL.createObjectURL(op.file);
  }
}

export const syncStore = {
  name: 'Server',
  list, cachedList, get, create, update, remove, upload, removeUpload, renameTag,
};
