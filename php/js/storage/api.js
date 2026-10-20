// Direkter Zugriff auf den PHP-Server (api.php).
// Unterscheidet zwei Fehlerarten – wichtig für den Offline-Modus:
//   NetworkError = Server gar nicht erreichbar (kein Netz) -> darf in den Postausgang
//   HttpError    = Server hat geantwortet, aber mit Fehler (z. B. 401, 415) -> echter Fehler

import { device } from '../device.js';

const BASE = 'api/posts';

export class NetworkError extends Error {}

/**
 * fetch mit Zeitgrenze. Antwortet der Server gar nicht (statt abzulehnen),
 * würde fetch sonst ewig hängen – z. B. wenn der Mac über Tailscale nicht
 * erreichbar ist. Nach `ms` wird abgebrochen und wie „kein Netz“ behandelt.
 */
export async function fetchWithTimeout(url, options = {}, ms = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Ist der SERVER gerade erreichbar? (Nicht dasselbe wie „Internet da“ –
// der Server kann auch aus sein, während das WLAN läuft.)
export const connection = { online: true, version: null };
function setOnline(online) {
  if (connection.online === online) return;
  connection.online = online;
  window.dispatchEvent(new Event('connection:change'));
}
export class HttpError extends Error {
  constructor(message, status, current = null) {
    super(message);
    this.status = status;
    this.current = current; // bei 409: der Artikel, wie er jetzt auf dem Server steht
  }
}

async function send(url, options = {}, ms = 10_000) {
  let res;
  try {
    res = await fetchWithTimeout(url, {
      // Angemeldet auf fremdem Gerät: Artikeltexte nicht offline zwischenspeichern
      cache: device.shortSession ? 'no-store' : 'default',
      ...options,
    }, ms);
  } catch {
    setOnline(false);
    throw new NetworkError('Keine Verbindung zum Server');
  }
  // Antwort kam aus dem Zwischenspeicher des Service Workers -> Server war nicht erreichbar
  setOnline(res.headers.get('X-Notizblog-Cache') !== '1');
  return res;
}

async function request(url, options = {}, ms = 10_000) {
  const headers = { 'Content-Type': 'application/json' };
  // Schon bekannt, dass der Server nicht antwortet: Der Service Worker soll beim Lesen
  // nicht erst 3,5 s aufs Netz warten, sondern sofort die gespeicherte Fassung geben
  if (!connection.online && !options.method) headers['X-Notizblog-Offline'] = '1';
  const res = await send(url, { headers, ...options }, ms);
  if (res.type === 'error' || res.status === 0) throw new NetworkError('Keine Verbindung zum Server');
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:required'));
    throw new HttpError('Nicht angemeldet', 401);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new HttpError(data.error || `Server-Fehler ${res.status}`, res.status, data.current ?? null);
  }
  return res.status === 204 ? null : res.json();
}

export const apiStore = {
  list: () => request(BASE),

  // 404 -> null, kein Netz -> NetworkError
  async get(id) {
    try {
      return await request(`${BASE}/${id}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  },

  create: data => request(BASE, { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: id => request(`${BASE}/${id}`, { method: 'DELETE' }),

  // Thema in allen Artikeln umbenennen (to = neuer Name) oder entfernen (to = null)
  renameTag: (from, to) => request('api/tags', { method: 'POST', body: JSON.stringify({ from, to }) }),

  // Homepage: Status und „Auf Homepage veröffentlichen“ (exportiert, committet, pusht)
  homepageStatus: () => request('api/homepage'),
  publishHomepage: () => request('api/homepage/publish', { method: 'POST', body: '{}' }, 60_000),

  // Bild auf dem Server löschen (nur wenn kein Artikel es mehr verwendet, sonst 409)
  removeUpload: url => request(`api/uploads/${url.split('/').pop()}`, { method: 'DELETE' }),

  // Bild hochladen -> { url: "uploads/…" }
  async upload(file) {
    const form = new FormData();
    form.append('image', file, file.name || 'bild');
    const res = await send('api/uploads', {
      method: 'POST',
      headers: { 'X-Notizblog': '1' }, // Content-Type setzt der Browser selbst (multipart)
      body: form,
    }, 60_000); // Bilder dürfen länger brauchen
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) window.dispatchEvent(new Event('auth:required'));
    if (!res.ok) throw new HttpError(data.error || `Server-Fehler ${res.status}`, res.status);
    if (!data.url) throw new HttpError('Unerwartete Antwort vom Server (siehe Terminal)', res.status);
    return data;
  },
};

/**
 * Ist ein Backend da? Nebenbei: Hat sich seit dem letzten Mal etwas geändert?
 * Der Server schickt eine Versionskennung mit, die sich bei jeder Speicherung
 * ändert (auch von anderen Geräten). Ändert sie sich -> Ereignis 'data:changed'.
 *   'online'     – api/health antwortet
 *   'no-backend' – Seite erreichbar, aber keine API (z. B. Live Server)
 *   'offline'    – gar keine Verbindung
 */
export async function serverStatus() {
  let status;
  try {
    const res = await fetchWithTimeout('api/health', { cache: 'no-store' }, 3000);
    const data = res.type === 'error' ? null : await res.json().catch(() => null);
    status = res.type === 'error' ? 'offline' : res.ok && data?.ok ? 'online' : 'no-backend';
    if (status === 'online' && data.version) {
      const changed = connection.version !== null && connection.version !== data.version;
      connection.version = data.version;
      if (changed) window.dispatchEvent(new Event('data:changed'));
    }
  } catch {
    status = 'offline';
  }
  setOnline(status === 'online');
  return status;
}
