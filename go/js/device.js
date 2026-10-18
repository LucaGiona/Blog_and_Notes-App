// Was dieses Gerät über sich selbst weiß (in localStorage).
//
// trusted      = beim Login „Auf diesem Gerät angemeldet bleiben“ angehakt.
//                Nur dann darf offline geschrieben werden (Postausgang).
// shortSession = angemeldet OHNE Haken (fremdes Gerät): Artikeltexte
//                werden dann nicht für offline zwischengespeichert.
// lastUser     = wer zuletzt angemeldet war – damit die App auf eigenen
//                Geräten auch offline weiß, dass du schreiben darfst.
//                (Der Server prüft beim Synchronisieren trotzdem das Cookie.)

import { clearOutbox } from './outbox.js';

const KEYS = {
  trusted: 'notizblog.trusted',
  shortSession: 'notizblog.shortSession',
  lastUser: 'notizblog.user',
};

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try {
    if (value === null || value === false) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { /* privater Modus o. Ä. – dann eben ohne */ }
}

export const device = {
  get trusted() { return read(KEYS.trusted) === '1'; },
  set trusted(on) { write(KEYS.trusted, on ? '1' : null); },

  get shortSession() { return read(KEYS.shortSession) === '1'; },
  set shortSession(on) { write(KEYS.shortSession, on ? '1' : null); },

  get lastUser() { return read(KEYS.lastUser); },
  set lastUser(name) { write(KEYS.lastUser, name || null); },
};

// Lokale Entwicklung (Live Server, php -S): nur hier ist der Browser-Speicher
// ohne Login erlaubt. Online gibt es diesen Modus nicht.
export const isLocalDev = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);

// Beim Abmelden: alles entfernen, was auf diesem Gerät von dir übrig wäre
export async function clearLocalData() {
  device.trusted = false;
  device.shortSession = false;
  device.lastUser = null;
  try { localStorage.removeItem('notizblog.idmap'); } catch {}
  try { localStorage.removeItem('notizblog.homepagePending'); } catch {}
  await clearOutbox();
  if ('caches' in window) {
    for (const key of await caches.keys()) {
      if (key.startsWith('notizblog-api')) await caches.delete(key);
    }
  }
}
