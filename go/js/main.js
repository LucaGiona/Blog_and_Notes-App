// Einstiegspunkt: Speicher wählen, Anmeldestatus holen, Routen verbinden,
// Service Worker (PWA) registrieren, Postausgang synchronisieren.

import { createStore } from './storage/index.js';
import { connection, serverStatus } from './storage/api.js';
import { localStore } from './storage/local.js';
import { sync, lastSyncError } from './storage/sync.js';
import { count as outboxCount } from './outbox.js';
import { auth } from './auth.js';
import { homepage, loadHomepageStatus, requestPublish, flushPublish, homepageLabel } from './homepage.js';
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
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker:', err));
}

// ---------- Start ----------
const store = await createStore(); // Top-level await geht nur in Modulen
if (store === localStore) auth.useLocal();
else if (!connection.online) auth.assumeOffline(); // Server antwortet nicht -> nicht nochmal warten
else await auth.refresh();

function updateNav() {
  renderNav(nav, { onLogout: logout });
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
}

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

updateNav();
updateStatus();
router.start();
if (!auth.local && auth.loggedIn) {
  sync().then(() => flushPublish());
  if (connection.online) loadHomepageStatus();
}
