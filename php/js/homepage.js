// „Auf Homepage veröffentlichen“: Der Server exportiert die öffentlichen Artikel in den
// Homepage-Ordner, committet nur blog-data/ und pusht – Netlify macht den Rest.
//
// Ausgelöst wird es nur bei bewussten Aktionen (Veröffentlichen/Aktualisieren,
// Privat umschalten, Löschen) – nie beim Autosave.
// Offline oder solange noch etwas im Postausgang wartet, wird es vorgemerkt
// und nachgeholt, sobald alles synchronisiert ist.

import { apiStore, connection, NetworkError } from './storage/api.js';
import { count as outboxCount } from './outbox.js';

const PENDING_KEY = 'notizblog.homepagePending';

export const homepage = {
  configured: false,
  last: null,       // letztes Ergebnis vom Server
  busy: false,
  get pending() {
    try { return localStorage.getItem(PENDING_KEY) === '1'; } catch { return false; }
  },
};

function setPending(on) {
  try { on ? localStorage.setItem(PENDING_KEY, '1') : localStorage.removeItem(PENDING_KEY); } catch { /* egal */ }
}

const changed = () => window.dispatchEvent(new Event('homepage:change'));

// Beim Start / nach dem Anmelden: Ist die Funktion eingeschaltet? Letzter Stand?
export async function loadHomepageStatus() {
  try {
    const status = await apiStore.homepageStatus();
    homepage.configured = status.configured;
    homepage.last = status.last;
  } catch {
    // offline oder nicht angemeldet: alten Stand behalten
  }
  changed();
}

// Nach einer bewussten Aktion aufrufen
export async function requestPublish() {
  if (!homepage.configured) return;
  setPending(true);
  changed();
  await flushPublish();
}

// Vorgemerktes Veröffentlichen nachholen (nach dem Synchronisieren aufrufen)
export async function flushPublish() {
  if (!homepage.pending || homepage.busy || !connection.online) return;
  if ((await outboxCount()) > 0) return; // erst muss alles auf dem Server sein

  homepage.busy = true;
  changed();
  try {
    homepage.last = await apiStore.publishHomepage();
    setPending(false);
  } catch (err) {
    if (!(err instanceof NetworkError)) {
      // Server hat geantwortet, aber Export/Git ist gescheitert -> nicht endlos wiederholen
      homepage.last = { ok: false, at: new Date().toISOString(), error: err.message };
      setPending(false);
    }
  } finally {
    homepage.busy = false;
    changed();
  }
}

// Kurzer Text für den Footer
export function homepageLabel() {
  if (!homepage.configured) return '';
  if (homepage.busy) return 'Homepage wird aktualisiert …';
  if (homepage.pending) return 'Homepage: wartet auf Verbindung';
  const last = homepage.last;
  if (!last) return 'Homepage: noch nicht veröffentlicht';
  const time = new Date(last.at).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  if (!last.ok) return `Homepage: Fehler (${time}) – ${last.error}`;
  const branch = last.branch && last.branch !== 'main'
    ? ` · Branch „${last.branch}“ – viele Hoster veröffentlichen nur main` : '';
  return `Homepage aktuell (${time})${branch}`;
}
