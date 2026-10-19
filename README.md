# Notizblog

**[English version below ↓](#english)**

## Deutsch

Ein Blog, den alle lesen und nur du schreibst – im Browser, als installierbare App (PWA)
auf Handy und Laptop, auch offline. Neue Artikel sind **privat**; was du **öffentlich**
stellst, kann auf Wunsch automatisch auf deine statische Website (Netlify, GitHub Pages …).

Zwei gleichwertige Fassungen in eigenen Ordnern – such dir eine aus:

| Ordner | Backend | Gut für |
| --- | --- | --- |
| [`php/`](php) | PHP 8.1+ | fast jedes Webhosting, einfach hochladen |
| [`go/`](go) | Go 1.22+ | ein einzelnes Programm, eigener Server oder lokal |

Beide haben dieselbe Oberfläche, dieselbe API und dasselbe Datenformat – das prüft ein
gemeinsamer Test. Daten lassen sich also von einer Fassung zur anderen mitnehmen.

Ohne Framework, ohne Build-Schritt, ohne Abhängigkeiten.

### Was die App kann

- **Schreiben** in Markdown mit Vorschau, Bildern (Drag & Drop, Einfügen, Kamera) und
  Code-Blöcken mit Kopieren-Knopf; Bilder und Code-Blöcke in der Vorschau per Papierkorb entfernen.
- **Editor als ganze Seite:** Titel und Werkzeuge oben, Knöpfe unten, dazwischen scrollt nur der
  Text. Auf dem Handy mit offener Tastatur bleiben nur Titel, Text und eine Knopfzeile.
  Text ohne Titel geht beim Verlassen nicht verloren (Entwurf „Ohne Titel“).
- **🔒 Privat / 🌐 Öffentlich** – neue Artikel sind privat. Private Artikel bekommt ein Besucher
  gar nicht zu sehen (kein Titel, kein Eintrag). Öffentliche Entwürfe zeigen nur den Titel,
  der Text ist verschwommen.
- **Themen** (Tags), beliebig kombinierbar, mit Filter; umbenennen und löschen in allen Artikeln.
- **Zeitstrahl** als Startseite, Artikel steigen beim Scrollen auf.
- **PWA**: installierbar, offline lesen und schreiben. Offline Geschriebenes liegt in einem
  Postausgang und wird automatisch synchronisiert.
- **Mehrere Geräte**: Änderungen erscheinen nach wenigen Sekunden überall; ein Konfliktschutz
  verhindert, dass ein Gerät still die Fassung eines anderen überschreibt.
- **Auf die eigene Website**: öffentliche Artikel als `blog-data/posts.json` + Bilder exportieren,
  auf Wunsch automatisch committen und pushen.
- **Ein Login** (ein Benutzer), signiertes Cookie, Schutz vor Durchprobieren,
  „Alle Geräte abmelden“.

### Erste Schritte

Nach dem Herunterladen gibt es noch **keinen Benutzer** – du legst deinen eigenen an
(Name frei wählbar, Passwort wird nur als Hash gespeichert). Die Anmeldeseite zeigt einen
Hinweis, solange das noch fehlt.

#### Mit PHP (8.1 oder neuer)

```bash
cd php
php bin/passwd.php                  # fragt nach Benutzername und Passwort
php -S localhost:8001 router.php
```

→ <http://localhost:8001> · Anmelden: <http://localhost:8001/#/admin>

#### Mit Go (1.22 oder neuer)

```bash
cd go
go run . passwd                     # fragt nach Benutzername und Passwort
go run .                            # Port 8002, anderer Port: PORT=8003 go run .
```

→ <http://localhost:8002> · Anmelden: <http://localhost:8002/#/admin>

Fertiges Programm: `go build -o notizblog .`, dann `./notizblog` im Ordner `go/` starten.

Passwort ändern oder anderen Namen nehmen: denselben Befehl noch einmal ausführen
(es gibt immer genau einen Benutzer; alle Geräte sind danach abgemeldet).

Jede Fassung speichert in ihrem eigenen `data/` und `uploads/`. Das Format ist gleich:
Zum Wechseln die beiden Ordner einfach mitnehmen. Pfade lassen sich per Umgebungsvariable
ändern: `NOTIZBLOG_DATA`, `NOTIZBLOG_UPLOADS`, `NOTIZBLOG_HOMEPAGE`
(Go zusätzlich `NOTIZBLOG_ROOT`, `PORT`) – so können auch beide dieselben Daten benutzen.

**Ohne Backend** (z. B. VS Code Live Server auf `localhost`): Die App speichert dann nur im
Browser, ohne Login und ohne Bilder – zum Ausprobieren der Oberfläche.

### Auf allen eigenen Geräten – ohne Hosting (Empfehlung: Tailscale)

Die App kann einfach auf deinem Rechner laufen und trotzdem auf Handy und Laptop als App
(PWA) funktionieren – auch unterwegs. Am einfachsten geht das mit
[Tailscale](https://tailscale.com): Es verbindet deine Geräte zu einem privaten Netz, nur
deine eigenen Geräte erreichen den Server, und `tailscale serve` liefert das HTTPS, das eine
PWA braucht. Für private Nutzung kostenlos.

1. Tailscale auf dem Rechner und auf Handy/Laptop installieren und überall mit **demselben
   Konto** anmelden: <https://tailscale.com/download>
2. Server auf dem Rechner starten – PHP: `php -S 0.0.0.0:8001 router.php` · Go: `go run .`
3. Freigeben (Port 8001 für PHP bzw. 8002 für Go):

   ```bash
   tailscale serve --bg 8001
   ```

   Beim ersten Mal fragt Tailscale, ob HTTPS für dein Netz eingeschaltet werden soll – bestätigen.
   Danach steht die Adresse da, etwa `https://<rechnername>.<dein-netz>.ts.net/`.
4. Diese Adresse auf dem Handy öffnen, unter `…/#/admin` mit Haken „angemeldet bleiben“
   anmelden und die App installieren (siehe unten).

- Der Rechner muss dafür laufen. Ist er aus, startet die App trotzdem aus dem Zwischenspeicher;
  Geschriebenes wartet im Postausgang und wird synchronisiert, sobald er wieder erreichbar ist.
- Zwei Fassungen gleichzeitig (z. B. zum Ausprobieren): die zweite auf einen anderen
  HTTPS-Port legen, `tailscale serve --bg --https=8443 8002`.
- Mehr zu `tailscale serve`: <https://tailscale.com/kb/1312/serve>

### Anmelden

- Besucher sehen keinen Anmelde-Knopf. Im Browser geht es über **`…/#/admin`**, in der
  installierten App unten im Footer über „Anmelden“.
- **„Auf diesem Gerät angemeldet bleiben“**: 30 Tage angemeldet, Artikel werden für offline
  gespeichert, offline schreiben möglich. Ohne Haken (fremde Geräte): abgemeldet, sobald
  der Browser schließt (spätestens nach 12 Stunden), nichts wird gespeichert.
- **Abmelden** löscht auf dem Gerät alles Zwischengespeicherte; **„Alle Geräte abmelden“**
  macht alle Login-Cookies ungültig.
- Benutzer/Passwort ändern: wie beim Anlegen (`php bin/passwd.php` bzw. `go run . passwd`).
  Gespeichert wird nur ein Hash (PBKDF2-SHA256) in `data/auth.json`.
- Nach 5 falschen Versuchen ist das Login für diese IP 15 Minuten gesperrt
  (aufheben: `data/login-fails.json` löschen).

### Als App auf Handy und Laptop (PWA)

- **Installieren:** iPhone/iPad (Safari): Teilen → „Zum Home-Bildschirm“ ·
  Android (Chrome): Menü → „App installieren“ · Desktop (Chrome/Edge): Symbol in der Adressleiste.
- **Voraussetzung: HTTPS** (oder `localhost`) – beim Hoster oder ohne Hosting über
  Tailscale (siehe oben).
- **Offline:** Alles einmal Geladene ist offline verfügbar. Geschriebenes (nur bei
  „angemeldet bleiben“) kommt in den Postausgang und wird später in der richtigen Reihenfolge
  hochgeladen – auch eingefügte Bilder.
- Antwortet der Server gar nicht (statt abzulehnen), greifen Zeitgrenzen: Nach höchstens
  3,5 s startet die App aus dem Zwischenspeicher.
- Wurde derselbe Artikel offline auf einem Gerät und online auf einem anderen geändert,
  wird nichts überschrieben: Die Offline-Fassung landet als Entwurf „Titel (Konflikt)“ daneben.
- **Schneller Start:** App-Dateien kommen sofort aus dem Speicher des Geräts, Artikel zuerst
  aus dem Netz. **Updates** kommen über `VERSION` in `sw.js`: Nach jeder Änderung an
  HTML/CSS/JS `VERSION` erhöhen – die App lädt die neue Fassung im Hintergrund und lädt sich
  einmal selbst neu. Eine neue JS-/CSS-Datei zusätzlich in `SHELL_FILES` eintragen.

### Schreiben

| Eingabe | Ergebnis |
| --- | --- |
| Leerzeile | neuer Absatz |
| `# Titel` / `## …` | Zwischenüberschrift |
| `**fett**`, `*kursiv*` | **fett**, *kursiv* |
| `` `code` `` | Code im Satz |
| `[Text](https://…)` | Link |
| `- Punkt` / `1. Punkt` | Liste |
| `> Zitat` | Zitat |
| ```` ```js ```` … ```` ``` ```` | Code-Block mit Kopieren-Knopf |
| `![Beschreibung](uploads/…)` | Bild (macht der Bild-Knopf automatisch) |

Eigenes HTML im Text wird nur als Text angezeigt, nie ausgeführt.

**Bilder:** Der Browser verkleinert sie auf max. 1600 px und speichert sie neu (WebP, PNG
bleibt PNG) – dabei fallen Metadaten wie der GPS-Ort weg. Der Server prüft am Inhalt, ob es
wirklich ein Bild ist, und vergibt einen zufälligen Namen.
PHP speichert JPG/PNG/WebP mit GD noch einmal neu (max. 2000 px), Go JPG/PNG
(WebP prüft Go nur, die Standardbibliothek kann es nicht schreiben). GIF bleibt unverändert.

**Themen:** Unter dem Titel an-/abwählen, neue über „+ Thema“. „✎ Themen“ benennt ein Thema in
allen Artikeln um oder löscht es dort. Die Vorschläge für den Anfang stehen in `js/tags.js`.

### Auf die eigene Website

Öffentliche Artikel lassen sich auf eine statische Website bringen – ohne dass dort PHP oder
Go laufen muss. Der Export schreibt in den Website-Ordner:

```text
blog-data/posts.json     öffentliche Artikel, neueste zuerst
blog-data/uploads/       genau die Bilder, die diese Artikel verwenden
```

| Im Blog | Im Export |
| --- | --- |
| 🌐 öffentlich + veröffentlicht | vollständig |
| 🌐 öffentlich + Entwurf | nur Titel, Datum, Themen (`body` leer) |
| 🔒 privat | gar nicht |

Jeder Eintrag: `{id, title, status, body, tags, createdAt, updatedAt}`; `body` ist Markdown,
Bilder darin heißen `uploads/<name>` (auf der Website also unter `blog-data/uploads/`).
Den Markdown-Renderer `js/markdown.js` kann die Website direkt mitbenutzen.

**Von Hand:**

```bash
php bin/export.php /pfad/zur/website          # bzw. in go/: go run . export /pfad/zur/website
```

**Automatisch aus der App:** Website-Ordner (ein Git-Repo) in `data/homepage-path` eintragen:

```bash
echo /pfad/zur/website > data/homepage-path
```

Dann exportiert der Server bei **Veröffentlichen/Aktualisieren**, beim **Umschalten
Privat ↔ Öffentlich** und beim **Löschen**, committet **nur `blog-data/`** und macht `git push`.
Autosave löst nichts aus; offline wird es vorgemerkt. Im Footer (auf dem Handy im Burger-Menü
unter „Status“) stehen Stand und Fehler, dazu ein Knopf „Homepage aktualisieren“.

- Gepusht wird der gerade ausgecheckte Branch – samt anderer, noch nicht gepushter Commits.
- git fragt nie nach einem Passwort; Pushen muss auf dem Rechner also schon ohne Rückfrage gehen.
- Was einmal gepusht war, bleibt in der Git-Geschichte der Website.
- Ausschalten: `data/homepage-path` löschen.

### Beim Hoster (PHP)

1. Den Ordner `php/` hochladen (auch in einen Unterordner, z. B. `/blog`).
2. `data/` und `uploads/` müssen für PHP beschreibbar sein.
3. Prüfen, dass die Sperre greift: `…/data/auth.json` muss **403** liefern. Sonst wertet der
   Server `.htaccess` nicht aus (z. B. nginx) – dann `data/` außerhalb des Web-Ordners ablegen
   und `NOTIZBLOG_DATA` setzen.
4. Benutzer lokal anlegen (`php bin/passwd.php`) und `data/auth.json` hochladen.
5. Nur über **HTTPS** betreiben.

Die Go-Fassung braucht einen eigenen Server (z. B. VPS) mit HTTPS davor (Caddy, nginx, Tailscale).
Sie liefert selbst nur die App-Dateien aus; `data/`, der Go-Quellcode usw. sind gesperrt.

### Aufbau

```text
php/                                PHP-Fassung – komplett, so hochladbar
  index.html, manifest.webmanifest, sw.js, css/, js/, fonts/, icons/   ← Oberfläche
  api.php, router.php, .htaccess    API, lokaler Testserver, Apache-Regeln
  src/   config.php http.php Store.php Auth.php Uploads.php Homepage.php
  bin/   passwd.php export.php      Kommandozeile
  data/, uploads/                   deine Daten (nicht im Repo)
go/                                 Go-Fassung – komplett, go run .
  index.html, …, css/, js/, …       ← dieselbe Oberfläche (Kopie, siehe unten)
  icons/                            blaue Icons – Go-Fassung auf einen Blick erkennbar
  main.go api.go store.go auth.go uploads.go homepage.go config.go util.go
  data/, uploads/                   deine Daten (nicht im Repo)
tests/   api_test.py run-both.sh    Test beider Fassungen
sync-frontend.sh                    Oberfläche von php/ nach go/ kopieren
```

**Die Oberfläche gibt es zweimal**, damit jeder Ordner für sich vollständig ist.
Bearbeitet wird sie in `php/`; danach `bash sync-frontend.sh` – das kopiert sie nach `go/`.
`tests/run-both.sh` bricht ab, wenn die beiden Kopien voneinander abweichen.
Ausnahme sind die Icons: Die Go-Fassung hat bewusst blaue, damit man auf dem Home-Bildschirm
sieht, welche läuft. Das Skript lässt `go/icons/` deshalb in Ruhe.

JavaScript (beide Fassungen gleich): `js/main.js` (Start, Routen, Sync, Footer),
`js/storage/` (Server + Postausgang, Browser-Speicher), `js/views/` (Zeitstrahl, Artikel, Editor, Login),
dazu `markdown.js`, `tags.js`, `image.js`, `homepage.js`, `reveal.js`, `outbox.js` u. a.

### API

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | api/health | erreichbar? + `version` (ändert sich bei jeder Speicherung) |
| POST | api/login | anmelden `{name, password, remember}` |
| POST | api/logout | abmelden (dieses Gerät) |
| POST | api/logout-all | alle Geräte abmelden 🔒 |
| GET | api/me | angemeldet? |
| GET | api/posts | alle Artikel (Gäste: ohne private, Entwürfe ohne Text) |
| GET | api/posts/:id | ein Artikel (Gäste: nur veröffentlichte, nicht private) |
| POST | api/posts | neuer Artikel 🔒 `{title, body, status, tags[], private, createdAt?}` – ohne `private`: privat; `createdAt` = Schreibzeit (offline geschrieben) |
| PUT | api/posts/:id | ändern 🔒 – `baseUpdatedAt` = bekannter `rev`; veraltet → 409 + `current` |
| DELETE | api/posts/:id | löschen 🔒 |
| POST | api/tags | Thema umbenennen `{from, to}` / löschen `{from, to: null}` 🔒 |
| POST | api/uploads | Bild hochladen 🔒 (multipart `image`, Header `X-Notizblog: 1`) → `{url}` |
| DELETE | api/uploads/:name | Bild löschen 🔒 – nur wenn kein Artikel es verwendet, sonst 409 |
| GET | api/homepage | Website-Export eingestellt? letzter Stand 🔒 |
| POST | api/homepage/publish | exportieren, `blog-data/` committen, pushen 🔒 |

🔒 = nur angemeldet. Fehlen beim Ändern `tags` oder `private`, bleiben die bisherigen Werte.
Schreibende Anfragen nehmen nur JSON (bzw. den `X-Notizblog`-Header) an – Schutz vor fremden Formularen.

### Tests

```bash
bash tests/run-both.sh
```

Prüft zuerst, ob die Oberfläche in `php/` und `go/` gleich ist. Startet dann beide Fassungen
mit frischen Testdaten, schickt beiden dieselben Anfragen
(Login, Artikel, Konflikte, Privat, Themen, Bilder, Dateisperren, Website-Export mit Git,
Sperre nach Fehlversuchen) und vergleicht die Antworten. Braucht `php`, `go`, `git`, `python3`.

### Lizenz

[MIT](LICENSE) – Schriften unter der SIL Open Font License ([php/fonts/OFL-LICENSE.txt](php/fonts/OFL-LICENSE.txt)).

---

## English

**[↑ Deutsche Fassung oben](#deutsch)**

A blog that everyone can read and only you write – in the browser, as an installable app
(PWA) on phone and laptop, offline too. New posts are **private**; whatever you make
**public** can be pushed automatically to your static website (Netlify, GitHub Pages …).

Two equivalent versions in separate folders – pick one:

| Folder | Backend | Good for |
| --- | --- | --- |
| [`php/`](php) | PHP 8.1+ | almost any web host, just upload |
| [`go/`](go) | Go 1.22+ | a single program, your own server or local |

Both share the same interface, the same API and the same data format – a shared test
makes sure of that. So you can take your data from one version to the other.

No framework, no build step, no dependencies. The user interface is in German.

### Features

- **Write** in Markdown with preview, images (drag & drop, paste, camera) and
  code blocks with a copy button; remove images and code blocks in the preview via the trash icon.
- **Full-page editor:** title and tools at the top, buttons at the bottom, only the text scrolls
  in between. On a phone with the keyboard open, only title, text and one row of buttons remain.
  Text without a title is not lost when leaving (draft “Ohne Titel”).
- **🔒 Private / 🌐 Public** – new posts are private. Visitors never see private posts
  (no title, no entry). Public drafts show only the title; the text is blurred.
- **Topics** (tags), freely combinable, with a filter; rename or delete across all posts.
- **Timeline** as the start page; posts rise into view while scrolling.
- **PWA**: installable, read and write offline. Anything written offline goes into an
  outbox and is synced automatically.
- **Several devices**: changes show up everywhere within seconds; conflict protection
  prevents one device from silently overwriting another device's version.
- **To your own website**: export public posts as `blog-data/posts.json` + images,
  optionally commit and push automatically.
- **One login** (one user), signed cookie, protection against password guessing,
  “sign out all devices”.

### Getting started

After downloading there is **no user yet** – you create your own
(any name you like; the password is stored only as a hash). The login page shows a
hint until you have done so.

#### With PHP (8.1 or newer)

```bash
cd php
php bin/passwd.php                  # asks for user name and password
php -S localhost:8001 router.php
```

→ <http://localhost:8001> · Sign in: <http://localhost:8001/#/admin>

#### With Go (1.22 or newer)

```bash
cd go
go run . passwd                     # asks for user name and password
go run .                            # port 8002, other port: PORT=8003 go run .
```

→ <http://localhost:8002> · Sign in: <http://localhost:8002/#/admin>

Compiled program: `go build -o notizblog .`, then run `./notizblog` inside `go/`.

To change the password or use a different name, run the same command again
(there is always exactly one user; all devices are signed out afterwards).

Each version stores its data in its own `data/` and `uploads/`. The format is the same:
to switch, just take both folders with you. Paths can be changed with environment
variables: `NOTIZBLOG_DATA`, `NOTIZBLOG_UPLOADS`, `NOTIZBLOG_HOMEPAGE`
(Go also `NOTIZBLOG_ROOT`, `PORT`) – this way both can even use the same data.

**Without a backend** (e.g. VS Code Live Server on `localhost`) the app stores everything
in the browser only, without login and without images – good for trying out the interface.

### On all your devices – without hosting (recommended: Tailscale)

The app can simply run on your computer and still work as an app (PWA) on your phone
and laptop – even on the go. The easiest way is [Tailscale](https://tailscale.com): it
connects your devices into a private network, only your own devices can reach the
server, and `tailscale serve` provides the HTTPS a PWA needs. Free for personal use.

1. Install Tailscale on the computer and on phone/laptop and sign in everywhere with the
   **same account**: <https://tailscale.com/download>
2. Start the server on the computer – PHP: `php -S 0.0.0.0:8001 router.php` · Go: `go run .`
3. Share it (port 8001 for PHP, 8002 for Go):

   ```bash
   tailscale serve --bg 8001
   ```

   The first time, Tailscale asks whether to enable HTTPS for your network – confirm.
   It then prints the address, something like `https://<computer-name>.<your-tailnet>.ts.net/`.
4. Open that address on your phone, sign in at `…/#/admin` with “stay signed in” checked,
   and install the app (see below).

- The computer has to be running. If it is off, the app still starts from its cache;
  anything you write waits in the outbox and syncs as soon as the computer is reachable again.
- Two versions at the same time (e.g. for testing): put the second one on another
  HTTPS port, `tailscale serve --bg --https=8443 8002`.
- More about `tailscale serve`: <https://tailscale.com/kb/1312/serve>

### Signing in

- Visitors see no sign-in button. In the browser, go to **`…/#/admin`**; in the
  installed app, use “Anmelden” in the footer.
- **“Stay signed in on this device”**: signed in for 30 days, posts are kept for offline use,
  writing offline is possible. Unchecked (other people's devices): signed out as soon as
  the browser closes (after 12 hours at the latest), nothing is stored.
- **Signing out** removes everything cached on the device; **“sign out all devices”**
  invalidates all login cookies.
- Change user/password: same as creating it (`php bin/passwd.php` or `go run . passwd`).
  Only a hash (PBKDF2-SHA256) is stored, in `data/auth.json`.
- After 5 failed attempts, login is blocked for that IP for 15 minutes
  (to lift it: delete `data/login-fails.json`).

### As an app on phone and laptop (PWA)

- **Install:** iPhone/iPad (Safari): Share → “Add to Home Screen” ·
  Android (Chrome): menu → “Install app” · Desktop (Chrome/Edge): icon in the address bar.
- **Requirement: HTTPS** (or `localhost`) – at your host, or without hosting via
  Tailscale (see above).
- **Offline:** everything loaded once is available offline. Anything written (only with
  “stay signed in”) goes into the outbox and is uploaded later in the right order –
  pasted images too.
- If the server doesn't answer at all (instead of refusing), timeouts kick in: after at most
  3.5 s the app starts from its cache.
- If the same post was changed offline on one device and online on another, nothing is
  overwritten: the offline version is saved next to it as a draft “Title (Konflikt)”.
- **Fast start:** app files come straight from the device's cache, posts from the network
  first. **Updates** come via `VERSION` in `sw.js`: after every change to HTML/CSS/JS,
  increase `VERSION` – the app fetches the new version in the background and reloads itself
  once. A new JS/CSS file also goes into `SHELL_FILES`.

### Writing

| Input | Result |
| --- | --- |
| Blank line | new paragraph |
| `# Title` / `## …` | heading |
| `**bold**`, `*italic*` | **bold**, *italic* |
| `` `code` `` | inline code |
| `[Text](https://…)` | link |
| `- item` / `1. item` | list |
| `> quote` | quote |
| ```` ```js ```` … ```` ``` ```` | code block with copy button |
| `![Description](uploads/…)` | image (the image button does this for you) |

HTML in the text is only shown as text, never executed.

**Images:** the browser scales them down to max. 1600 px and saves them again (WebP; PNG
stays PNG) – which drops metadata such as GPS location. The server checks the content to
make sure it really is an image, and assigns a random name.
PHP re-saves JPG/PNG/WebP once more with GD (max. 2000 px), Go JPG/PNG
(Go only checks WebP, as the standard library cannot write it). GIF stays unchanged.

**Topics:** toggle them below the title, add new ones with “+ Thema”. “✎ Themen” renames a
topic in all posts or deletes it there. The initial suggestions are in `js/tags.js`.

### To your own website

Public posts can be published to a static website – without PHP or Go running there.
The export writes into the website folder:

```text
blog-data/posts.json     public posts, newest first
blog-data/uploads/       exactly the images these posts use
```

| In the blog | In the export |
| --- | --- |
| 🌐 public + published | complete |
| 🌐 public + draft | title, date, topics only (`body` empty) |
| 🔒 private | not at all |

Each entry: `{id, title, status, body, tags, createdAt, updatedAt}`; `body` is Markdown,
images in it are referenced as `uploads/<name>` (so on the website under `blog-data/uploads/`).
The website can reuse the Markdown renderer `js/markdown.js` directly.

**Manually:**

```bash
php bin/export.php /path/to/website          # or in go/: go run . export /path/to/website
```

**Automatically from the app:** put the website folder (a Git repo) into `data/homepage-path`:

```bash
echo /path/to/website > data/homepage-path
```

The server then exports on **publish/update**, on **switching private ↔ public** and on
**delete**, commits **only `blog-data/`** and runs `git push`.
Autosave triggers nothing; offline, the publish is queued. The footer (on phones: burger menu →
“Status”) shows status and errors, plus a “Homepage aktualisieren” (update homepage) button.

- The branch that is currently checked out is pushed – including other commits not yet pushed.
- git never asks for a password, so pushing must already work without a prompt on the computer.
- Whatever was pushed once stays in the website's Git history.
- To turn it off: delete `data/homepage-path`.

### At a web host (PHP)

1. Upload the `php/` folder (a subfolder such as `/blog` works too).
2. `data/` and `uploads/` must be writable by PHP.
3. Check that the protection works: `…/data/auth.json` must return **403**. Otherwise the
   server ignores `.htaccess` (e.g. nginx) – then move `data/` outside the web root
   and set `NOTIZBLOG_DATA`.
4. Create the user locally (`php bin/passwd.php`) and upload `data/auth.json`.
5. Only run it over **HTTPS**.

The Go version needs its own server (e.g. a VPS) with HTTPS in front (Caddy, nginx, Tailscale).
It only serves the app files itself; `data/`, the Go source code etc. are blocked.

### Structure

```text
php/                                PHP version – complete, ready to upload
  index.html, manifest.webmanifest, sw.js, css/, js/, fonts/, icons/   ← interface
  api.php, router.php, .htaccess    API, local dev server, Apache rules
  src/   config.php http.php Store.php Auth.php Uploads.php Homepage.php
  bin/   passwd.php export.php      command line
  data/, uploads/                   your data (not in the repo)
go/                                 Go version – complete, go run .
  index.html, …, css/, js/, …       ← the same interface (copy, see below)
  icons/                            blue icons – Go version recognisable at a glance
  main.go api.go store.go auth.go uploads.go homepage.go config.go util.go
  data/, uploads/                   your data (not in the repo)
tests/   api_test.py run-both.sh    test of both versions
sync-frontend.sh                    copy the interface from php/ to go/
```

**The interface exists twice** so that each folder is complete on its own.
Edit it in `php/`, then run `bash sync-frontend.sh` – it copies it to `go/`.
`tests/run-both.sh` stops if the two copies differ.
The icons are the exception: the Go version deliberately has blue ones, so you can tell on
the home screen which one is running. The script therefore leaves `go/icons/` alone.

JavaScript (identical in both versions): `js/main.js` (startup, routes, sync, footer),
`js/storage/` (server + outbox, browser storage), `js/views/` (timeline, post, editor, login),
plus `markdown.js`, `tags.js`, `image.js`, `homepage.js`, `reveal.js`, `outbox.js` and others.

### API reference

| Method | Path | Purpose |
| --- | --- | --- |
| GET | api/health | reachable? + `version` (changes with every save) |
| POST | api/login | sign in `{name, password, remember}` |
| POST | api/logout | sign out (this device) |
| POST | api/logout-all | sign out all devices 🔒 |
| GET | api/me | signed in? |
| GET | api/posts | all posts (guests: without private ones, drafts without text) |
| GET | api/posts/:id | one post (guests: published and non-private only) |
| POST | api/posts | new post 🔒 `{title, body, status, tags[], private, createdAt?}` – without `private`: private; `createdAt` = time written (offline) |
| PUT | api/posts/:id | update 🔒 – `baseUpdatedAt` = known `rev`; outdated → 409 + `current` |
| DELETE | api/posts/:id | delete 🔒 |
| POST | api/tags | rename topic `{from, to}` / delete `{from, to: null}` 🔒 |
| POST | api/uploads | upload image 🔒 (multipart `image`, header `X-Notizblog: 1`) → `{url}` |
| DELETE | api/uploads/:name | delete image 🔒 – only if no post uses it, otherwise 409 |
| GET | api/homepage | website export configured? last status 🔒 |
| POST | api/homepage/publish | export, commit `blog-data/`, push 🔒 |

🔒 = signed in only. If `tags` or `private` are missing on update, the previous values are kept.
Write requests only accept JSON (or the `X-Notizblog` header) – protection against foreign forms.

### Testing

```bash
bash tests/run-both.sh
```

First checks that the interface in `php/` and `go/` is identical. Then starts both versions
with fresh test data, sends both the same requests
(login, posts, conflicts, private, topics, images, file protection, website export with Git,
lockout after failed attempts) and compares the responses. Requires `php`, `go`, `git`, `python3`.

### License

[MIT](LICENSE) – fonts under the SIL Open Font License ([php/fonts/OFL-LICENSE.txt](php/fonts/OFL-LICENSE.txt)).
