// Einstiegspunkt: Speicher wählen, Anmeldestatus holen, Routen verbinden,
// Service Worker (PWA) registrieren, Postausgang synchronisieren.

import { createStore } from './storage/index.js';
import { syncStore } from './storage/sync.js';
import { connection, serverStatus } from './storage/api.js';
import { localStore } from './storage/local.js';
import { sync, lastSyncError } from './storage/sync.js';
import { count as outboxCount } from './outbox.js';
import { auth } from './auth.js';
import { homepage, loadHomepageStatus, requestPublish, flushPublish, homepageLabel } from './homepage.js';
import { escapeHtml } from './utils.js';
import { device, isLocalDev } from './device.js';
import { renderNav } from './nav.js';
import { createRouter } from './router.js';
import { renderList } from './views/list.js';
import { renderEditor } from './views/editor.js';
import { renderPost } from './views/post.js';
import { renderLogin } from './views/login.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const storageMode = document.getElementById('storage-mode');
const syncStatus = document.getElementById('sync-status');
const logoutAllButton = document.getElementById('logout-all');
const loginLink = document.getElementById('login-link');
const homepageStatus = document.getElementById('homepage-status');
const homepagePublish = document.getElementById('homepage-publish');

// Läuft der Blog als installierte App (PWA)? Dort gibt es keine Adressleiste,
// also braucht es einen sichtbaren Weg zum Login. Im normalen Browser
// (Besucher deines Portfolios) bleibt er unsichtbar – dort geht es über …/#/admin.
const isInstalledApp =
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- PWA ----------
// Service Worker nur über https oder localhost möglich (Browser-Regel)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(watchForUpdates).catch(err => console.warn('Service Worker:', err));
  // Neue App-Version installiert -> einmal neu laden, damit sie sofort gilt.
  // Nicht mitten im Schreiben: im Editor erst beim nächsten Seitenwechsel.
  const hadController = !!navigator.serviceWorker.controller;
  let updateReady = false;
  const reloadIfSafe = () => {
    if (updateReady && !/^#\/(new|edit\/)/.test(location.hash)) location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // erster Besuch: nichts neu zu laden
    updateReady = true;
    reloadIfSafe();
  });
  // kurz warten, damit das Speichern beim Verlassen des Editors noch durchkommt
  window.addEventListener('hashchange', () => setTimeout(reloadIfSafe, 2000));
}

// Selbst nach Updates suchen. Der Browser prüft sw.js sonst nur beim Start bzw. Neuladen –
// eine App, die tagelang offen bleibt (Schul-Laptop, Handy im Hintergrund), bliebe auf der
// alten Version. Darum: beim Zurückkehren zur App und alle 30 Minuten nachsehen.
// Höchstens alle 5 Minuten, damit nicht jeder Fensterwechsel eine Anfrage über Tailscale macht.
// Kommt eine neue Version, greift der Neustart oben (im Editor erst beim Verlassen).
function watchForUpdates(reg) {
  let lastCheck = Date.now(); // beim Start hat der Browser gerade selbst geprüft
  const check = () => {
    if (Date.now() - lastCheck < 5 * 60_000) return;
    lastCheck = Date.now();
    reg.update().catch(() => {}); // Server nicht erreichbar -> nächstes Mal
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('focus', check);
  setInterval(check, 30 * 60_000);
}

// ---------- Start ----------
// Server-Check und Anmeldestatus GLEICHZEITIG fragen – nacheinander kostet über
// Tailscale spürbar Zeit beim Start
const authReady = auth.refresh();
const storeReady = createStore();

// Eigenes Gerät, auf dem du angemeldet bist: NICHT auf den Server warten (über Tailscale
// oder bei schlafendem Mac bis zu 3 s), sondern sofort mit dem Wissen des Geräts starten.
// Die Antworten des Servers kommen nach und korrigieren, falls nötig (siehe serverChecked).
const quickStart = !isLocalDev && device.trusted && !!device.lastUser;
let store;
if (quickStart) {
  store = syncStore;
  auth.assumeKnown();
} else {
  store = await storeReady; // Top-level await geht nur in Modulen
  await authReady;
  if (store === localStore) auth.useLocal();
  else if (!connection.online) auth.assumeOffline(); // Server antwortet nicht
}

function updateNav() {
  renderNav(nav, { onLogout: logout, onRender: renderMenuStatus });
  // Angemeldet stehen die Footer-Infos im Status-Feld (Laptop: Knopf oben, Handy: Burger) – Footer aus
  document.body.classList.toggle('logged-in', auth.loggedIn && !auth.local);
  logoutAllButton.hidden = !auth.loggedIn || auth.local;
  loginLink.hidden = auth.loggedIn || auth.local || !isInstalledApp;
  updateHomepage();
}

// ---------- Homepage (Export + git push, siehe js/homepage.js) ----------
function updateHomepage() {
  const show = auth.loggedIn && !auth.local && homepage.configured;
  homepageStatus.hidden = homepagePublish.hidden = !show;
  if (!show) return;
  homepageStatus.textContent = homepageLabel();
  homepageStatus.classList.toggle('is-error', homepage.last?.ok === false);
  homepagePublish.disabled = homepage.busy;
  renderMenuStatus();
}
homepagePublish.addEventListener('click', () => requestPublish());
window.addEventListener('homepage:change', updateHomepage);

async function logout() {
  // Erst versuchen, Wartendes noch hochzuladen
  if (!auth.local) await sync();
  const waiting = await outboxCount();
  if (waiting && !confirm(
    `${waiting} Änderung(en) sind noch nicht auf dem Server.\n` +
    'Beim Abmelden werden sie von diesem Gerät gelöscht. Trotzdem abmelden?')) return;
  await auth.logout();
  afterLogout();
}

logoutAllButton.addEventListener('click', async () => {
  if (!confirm('Auf allen Geräten abmelden (Handy, Laptop, …)? Du musst dich danach überall neu anmelden.')) return;
  try {
    await sync();
    await auth.logoutAll();
    afterLogout();
  } catch (err) {
    alert(err.message);
  }
});

function afterLogout() {
  updateNav();
  updateStatus();
  if (location.hash === '#/' || location.hash === '') router.start(); // gleiche Seite -> neu rendern
  else location.hash = '#/';
}

// ---------- Status im Footer ----------
async function updateStatus() {
  if (auth.local) {
    storageMode.textContent = `Speicher: ${store.name}`;
    syncStatus.textContent = '';
    return;
  }
  storageMode.textContent = connection.online ? 'Online' : 'Offline – Server nicht erreichbar';
  const waiting = auth.loggedIn ? await outboxCount() : 0;
  syncStatus.textContent =
    lastSyncError ? ` · ${lastSyncError}` :
    waiting ? ` · ${waiting} Änderung(en) warten auf Verbindung` : '';
  menuWaiting = waiting;
  renderMenuStatus();
}

// ---------- Status-Feld (Laptop: Knopf „● Online ▾“ oben, Handy: im Burger-Menü) ----------
// Dieselben Infos wie im Footer, dazu die Reihenfolge im Zeitstrahl. Beide Stellen
// (data-status-box) bekommen denselben Inhalt.
let menuWaiting = 0;
function renderMenuStatus() {
  updateStatusButton();
  const boxes = document.querySelectorAll('[data-status-box]');
  if (!boxes.length) return;
  const by = device.sortBy;
  const lines = [
    `<li class="${connection.online ? 'is-ok' : 'is-off'}">${connection.online ? 'Online' : 'Offline – Server nicht erreichbar'}</li>`,
  ];
  if (lastSyncError) lines.push(`<li class="is-error">${escapeHtml(lastSyncError)}</li>`);
  else if (menuWaiting) lines.push(`<li>${menuWaiting} Änderung(en) warten auf Verbindung</li>`);
  else lines.push('<li>Alles synchronisiert</li>');
  if (homepage.configured) {
    lines.push(`<li class="${homepage.last?.ok === false ? 'is-error' : ''}">${escapeHtml(homepageLabel())}</li>`);
  }
  if (appVersion) lines.push(`<li class="is-version">App ${escapeHtml(appVersion)}</li>`);
  const html = `
    <p class="nav-status-title">Status</p>
    <ul>${lines.join('')}</ul>
    <div class="status-sort" role="group" aria-label="Reihenfolge im Zeitstrahl" data-keep-open>
      <span>Reihenfolge</span>
      <button type="button" data-sort="created" aria-pressed="${by === 'created'}">angelegt</button>
      <button type="button" data-sort="updated" aria-pressed="${by === 'updated'}">bearbeitet</button>
    </div>
    ${homepage.configured ? `<button type="button" class="btn" data-menu="publish" ${homepage.busy ? 'disabled' : ''}>Homepage aktualisieren</button>` : ''}
    <button type="button" class="link-button nav-danger" data-menu="logout-all" data-close>Alle Geräte abmelden</button>`;
  boxes.forEach(box => { box.innerHTML = html; });
}

// Welche App-Version läuft? (= VERSION in sw.js, steckt im Namen des Zwischenspeichers.)
// Steht im Status-Feld – so sieht man beim Testen, ob ein Update angekommen ist.
let appVersion = null;
if ('caches' in window) {
  caches.keys().then(keys => {
    // Während eines Updates liegen kurz zwei Fassungen da -> die neueste nehmen
    const versions = keys.filter(k => k.startsWith('notizblog-shell-')).map(k => k.slice('notizblog-shell-'.length));
    versions.sort((x, y) => (parseInt(y.slice(1)) || 0) - (parseInt(x.slice(1)) || 0));
    appVersion = versions[0] ?? null;
    renderMenuStatus();
  }).catch(() => {});
}

// Knopf oben (Laptop): Punkt + kurzes Wort. Grün = online und alles da, gelb = Änderungen
// warten, grau = Server nicht erreichbar, rot = Fehler (Synchronisieren oder Homepage).
function updateStatusButton() {
  const btn = nav.querySelector('.status-btn');
  if (!btn) return;
  const error = lastSyncError || homepage.last?.ok === false;
  const state = !connection.online ? 'is-off' : error ? 'is-error' : menuWaiting ? 'is-wait' : 'is-ok';
  const label = !connection.online ? 'Offline' : menuWaiting ? `${menuWaiting} warten` : 'Online';
  btn.dataset.state = state;
  btn.querySelector('.status-label').textContent = label;
  btn.title = `${label} – Status und Einstellungen`;
}

nav.addEventListener('click', e => {
  const action = e.target.closest('[data-menu]')?.dataset.menu;
  if (action === 'publish') requestPublish();
  if (action === 'logout-all') logoutAllButton.click(); // gleiche Rückfrage wie im Footer
  const sort = e.target.closest('[data-sort]')?.dataset.sort;
  if (sort && sort !== device.sortBy) {
    device.sortBy = sort; // löst 'sort:change' aus
    renderMenuStatus();
  }
});

// ---------- Routen ----------
// Seiten, die nur mit Login erreichbar sind
const protect = view => (...args) => {
  if (!auth.canEdit) {
    location.hash = '#/admin';
    return;
  }
  return view(...args);
};

const showLogin = () => {
  if (auth.canEdit) {          // schon angemeldet -> direkt zur Übersicht
    location.hash = '#/';
    return;
  }
  renderLogin(app, async () => {
    updateNav();
    await sync();
    loadHomepageStatus();
    location.hash = '#/';
  });
};

// Kaputte %-Folgen in der Adresse sollen nicht die ganze Seite abstürzen lassen
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };

const router = createRouter([
  [/^\/$/,               () => renderList(app, store, auth)],
  [/^\/thema\/([^/]+)$/,  tag => renderList(app, store, auth, safeDecode(tag))],
  [/^\/(admin|login)$/,  showLogin],
  [/^\/new$/,            protect(() => renderEditor(app, store))],
  [/^\/edit\/([\w-]+)$/, protect(id => renderEditor(app, store, id))],
  [/^\/post\/([\w-]+)$/, id => renderPost(app, store, id, auth)],
], () => window.scrollTo(0, 0));

// ---------- Ereignisse ----------

// Server meldet "nicht angemeldet" (z. B. Cookie abgelaufen).
// Nicht automatisch wegnavigieren – sonst wäre ungespeicherter Text im Editor weg.
window.addEventListener('auth:required', () => {
  auth.loggedIn = false;
  updateNav();
  updateStatus();
});

window.addEventListener('outbox:change', () => {
  updateStatus();
  flushPublish(); // vorgemerktes Veröffentlichen, sobald der Postausgang leer ist
});

// Server wieder erreichbar -> Anmeldestatus prüfen und Postausgang abschicken
async function backOnline() {
  if (auth.local) return;
  await auth.refresh();
  updateNav();
  await sync();
  updateStatus();
  if (auth.loggedIn) {
    if (!homepage.configured) await loadHomepageStatus();
    flushPublish();
  }
  // Was offline aus dem Speicher kam, jetzt frisch vom Server zeigen
  window.dispatchEvent(new Event('data:changed'));
}
window.addEventListener('connection:change', () => {
  updateStatus();
  if (connection.online) backOnline();
});
window.addEventListener('online', () => serverStatus());   // Internet zurück -> Server prüfen
window.addEventListener('offline', () => serverStatus());

// Beim Zurückkehren zur App (z. B. Handy entsperrt) und alle 10 Sekunden nachsehen,
// ob der Server erreichbar ist und ob sich etwas geändert hat
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !auth.local) serverStatus().then(() => sync());
});
setInterval(async () => {
  if (auth.local) return;
  await serverStatus();
  if (connection.online && (await outboxCount()) > 0) sync();
}, 10_000);
window.addEventListener('focus', () => { if (!auth.local) serverStatus(); });

// Ein anderes Gerät (oder dieses) hat etwas gespeichert -> Liste bzw. Artikel neu zeichnen.
// Der Editor kümmert sich selbst darum (siehe views/editor.js).
window.addEventListener('data:changed', () => {
  const hash = location.hash || '#/';
  if (hash === '#/' || hash.startsWith('#/post/') || hash.startsWith('#/thema/')) router.refresh();
});

// Reihenfolge umgestellt -> Zeitstrahl neu zeichnen
window.addEventListener('sort:change', () => {
  renderMenuStatus(); // Knöpfe im Status-Feld auf denselben Stand
  const hash = location.hash || '#/';
  if (hash === '#/' || hash.startsWith('#/thema/')) router.refresh();
});

updateNav();
updateStatus();
router.start();
if (quickStart) {
  // Antworten vom Server da: Anmeldung bestätigt? Server erreichbar?
  Promise.all([authReady, storeReady]).then(serverChecked);
} else if (!auth.local && auth.loggedIn) {
  sync().then(() => flushPublish());
  if (connection.online) loadHomepageStatus();
}

function serverChecked() {
  if (!connection.online) auth.assumeOffline();
  updateNav();
  updateStatus();
  if (!auth.loggedIn) {
    // Anmeldung abgelaufen: Liste ohne private Artikel zeigen. Im Editor bleiben
    // (sonst wäre ungespeicherter Text weg) – Speichern meldet dann „Nicht angemeldet“.
    if (!/^#\/(new|edit\/)/.test(location.hash)) router.refresh();
    return;
  }
  sync().then(() => flushPublish());
  if (connection.online) loadHomepageStatus();
}
