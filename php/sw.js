// Service Worker – macht den Blog zur PWA.
//
// Er sitzt zwischen App und Netz und entscheidet bei jeder Anfrage:
//   App-Dateien (HTML, CSS, JS, Schriften)  -> sofort aus dem Zwischenspeicher (schneller Start)
//   Artikel (GET api/posts…)                -> erst Netz, sonst Zwischenspeicher
//                                              (die Startseite zeigt vorher schon die gespeicherte Liste)
//   Bilder (uploads/…)                      -> erst Zwischenspeicher (ändern sich nie)
//   Login, Status, alles Schreibende        -> immer direkt ans Netz, nie speichern
//
// „Erst Netz“ heißt: Online siehst du immer den neuesten Artikel-Stand, offline den zuletzt geladenen.
// App-Dateien kommen dagegen sofort aus dem Speicher – sonst müsste die App bei jedem Start
// erst alle Dateien über Tailscale vom Mac holen. Neue Versionen kommen NUR über VERSION:
// Der Browser prüft sw.js bei jedem Start, installiert die neue Version im Hintergrund,
// und die App lädt sich dann einmal selbst neu (siehe main.js).
// Ohne VERSION zu erhöhen, sieht man Änderungen an App-Dateien also nicht!
//
// Wichtig: Bei Änderungen an der Liste unten VERSION erhöhen.

const VERSION = 'v23';
const SHELL = `notizblog-shell-${VERSION}`;
const API = 'notizblog-api';      // Artikel – wird beim Abmelden gelöscht
const IMAGES = 'notizblog-img';

// So lange wird aufs Netz gewartet, wenn es eine gespeicherte Version gibt.
// Wichtig, wenn der Server nicht antwortet, statt die Verbindung abzulehnen
// (z. B. Mac über Tailscale nicht erreichbar): Die Anfrage HÄNGT dann, statt zu scheitern.
const NETWORK_TIMEOUT = 3500;

// Hat der Server gerade nicht geantwortet, wird für kurze Zeit gar nicht mehr
// gewartet, sondern sofort die gespeicherte Version genommen (das Netz wird im
// Hintergrund trotzdem weiter gefragt). Sonst würde beim Start JEDE der vielen
// JS-Dateien einzeln 3,5 s warten.
const OFFLINE_HOLD = 15_000;
let offlineUntil = 0;

// Alles, was die App zum Starten braucht – wird beim Installieren geladen
const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/fonts.css',
  'css/style.css',
  'js/main.js',
  'js/router.js',
  'js/utils.js',
  'js/markdown.js',
  'js/image.js',
  'js/auth.js',
  'js/device.js',
  'js/outbox.js',
  'js/nav.js',
  'js/tags.js',
  'js/homepage.js',
  'js/reveal.js',
  'js/storage/index.js',
  'js/storage/api.js',
  'js/storage/local.js',
  'js/storage/sync.js',
  'js/views/list.js',
  'js/views/post.js',
  'js/views/editor.js',
  'js/views/login.js',
  'fonts/bricolage-grotesque-variable.woff2',
  'fonts/ibm-plex-sans-400.woff2',
  'fonts/ibm-plex-sans-500.woff2',
  'fonts/ibm-plex-sans-600.woff2',
  'fonts/ibm-plex-mono-400.woff2',
  'fonts/ibm-plex-mono-500.woff2',
  'fonts/ibm-plex-mono-600.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL).then(cache => cache.addAll(SHELL_FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()),
  );
});

// Alte Versionen aufräumen und sofort übernehmen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('notizblog-shell-') && k !== SHELL).map(k => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // Schreiben geht immer direkt ans Netz
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);

  // Nie zwischenspeichern: Anmeldestatus und Server-Check
  if (/^api\/(me|health)$/.test(path)) return;

  if (path.startsWith('api/posts')) {
    // Angemeldet auf fremdem Gerät -> App schickt cache: 'no-store' -> nicht speichern
    event.respondWith(networkFirst(req, API, req.cache !== 'no-store'));
    return;
  }
  if (path.startsWith('uploads/')) {
    event.respondWith(cacheFirst(req, IMAGES));
    return;
  }
  if (path.startsWith('api/')) return;

  // App-Dateien. Navigation (z. B. Start der PWA) immer auf index.html abbilden
  event.respondWith(cacheFirst(req.mode === 'navigate' ? new Request('./') : req, SHELL));
});

async function networkFirst(req, cacheName, store) {
  const cache = await caches.open(cacheName);

  // Netz-Anfrage starten; kommt sie an, wird der Zwischenspeicher aktualisiert
  const network = fetch(req).then(res => {
    if (store && res.ok) cache.put(req, res.clone());
    return res;
  });
  network.then(() => { offlineUntil = 0; }, () => { offlineUntil = Date.now() + OFFLINE_HOLD; });

  const cached = await cache.match(req, { ignoreVary: true });

  // Nichts gespeichert -> bleibt nur das Netz
  if (!cached) {
    try {
      return await network;
    } catch {
      return Response.error();
    }
  }

  // Server hat eben erst nicht geantwortet (oder die App weiß schon: offline) -> gar nicht warten.
  // Das Netz wird trotzdem gefragt und der Zwischenspeicher aktualisiert, sobald es antwortet.
  if (Date.now() < offlineUntil || req.headers.get('X-Notizblog-Offline') === '1') return markCached(cached);

  // Gespeicherte Version vorhanden -> höchstens NETWORK_TIMEOUT aufs Netz warten
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
    offlineUntil = Date.now() + OFFLINE_HOLD; // Zeit abgelaufen -> Server hängt
  } catch {
    // Netz-Fehler -> gespeicherte Version
  }
  return markCached(cached);
}

// Markieren, damit die App weiß: Server nicht erreichbar, das ist die gespeicherte Version
function markCached(cached) {
  const headers = new Headers(cached.headers);
  headers.set('X-Notizblog-Cache', '1');
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
}

// Gespeicherte Version, sonst Netz (und dann speichern).
// Ohne Hintergrund-Abfragen: Die würden beim Start die wenigen Verbindungen zum Server
// belegen, und Anmeldestatus und Artikel müssten warten.
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}
