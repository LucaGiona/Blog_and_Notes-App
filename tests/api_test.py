#!/usr/bin/env python3
"""
API-Test für beide Backends (PHP und Go) – prüft, dass sie sich gleich verhalten.

    python3 tests/api_test.py http://localhost:8001 <data-ordner> [<homepage-repo>]

Voraussetzungen: Server läuft mit eigenem, frischem data-Ordner (NOTIZBLOG_DATA),
darin eine auth.json für Benutzer "test" mit Passwort "test-passwort"
(php php/bin/passwd.php test  bzw.  im Ordner go/: go run . passwd test).
Optional: ein Git-Repo mit Remote als Test-Homepage.

Gibt alle Schritte als JSON aus (zufällige Werte wie IDs und Zeiten durch
Platzhalter ersetzt). So lassen sich die Ausgaben beider Server direkt vergleichen.
Nur Standardbibliothek.
"""
import json
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib
from http.cookiejar import CookieJar

BASE = sys.argv[1].rstrip('/')
DATA = sys.argv[2]
HOMEPAGE = sys.argv[3] if len(sys.argv) > 3 else None

results = []
failures = []


def opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


owner = opener()   # angemeldet
guest = opener()   # Besucher


def call(op, method, path, body=None, ctype='application/json', headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None and ctype:
        req.add_header('Content-Type', ctype)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        res = op.open(req, timeout=60)
        status, text, hdrs = res.status, res.read().decode('utf-8', 'replace'), res.headers
    except urllib.error.HTTPError as e:
        status, text, hdrs = e.code, e.read().decode('utf-8', 'replace'), e.headers
    try:
        payload = json.loads(text) if text else None
    except ValueError:
        payload = text.strip()
    return status, payload, hdrs


# Zufällige Werte durch Platzhalter ersetzen
RANDOM_KEYS = {'id', 'rev', 'createdAt', 'updatedAt', 'at', 'version'}


def normalize(x):
    if isinstance(x, dict):
        out = {}
        for k, v in sorted(x.items()):
            if k in RANDOM_KEYS and isinstance(v, str):
                out[k] = f'<{k}>'
            elif k == 'url' and isinstance(v, str) and v.startswith('uploads/'):
                out[k] = 'uploads/<name>.' + v.rsplit('.', 1)[-1]
            else:
                out[k] = normalize(v)
        return out
    if isinstance(x, list):
        return [normalize(v) for v in x]
    if isinstance(x, str):  # zufällige Bildnamen im Text
        return re.sub(r'uploads/[a-f0-9]{24}\.', 'uploads/<name>.', x)
    return x


def step(name, status, payload, expect=None, check=None):
    entry = {'step': name, 'status': status, 'body': normalize(payload)}
    results.append(entry)
    ok = (expect is None or status == expect) and (check is None or check(payload))
    if not ok:
        failures.append(f'{name}: Status {status}, Antwort {json.dumps(payload, ensure_ascii=False)[:300]}')
    return payload


def png(width, height, rgba=(200, 80, 40, 255)):
    """Kleines PNG ohne Bibliothek bauen"""
    row = b'\x00' + bytes(rgba) * width
    raw = row * height

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def multipart(field, filename, content, ctype):
    boundary = '----notizblogtest'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
            f'Content-Type: {ctype}\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    return body, f'multipart/form-data; boundary={boundary}'


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    return struct.unpack('>II', head[16:24])


# ---------- Grundlagen ----------
step('health', *call(guest, 'GET', '/api/health')[:2], 200, lambda p: p['ok'] is True)
step('me (Gast)', *call(guest, 'GET', '/api/me')[:2], 200, lambda p: p['loggedIn'] is False and p['configured'] is True)
step('login ohne JSON', *call(owner, 'POST', '/api/login', raw=b'name=test', ctype='application/x-www-form-urlencoded')[:2], 415)
step('login falsch', *call(owner, 'POST', '/api/login', {'name': 'test', 'password': 'nein'})[:2], 401)
step('login richtig', *call(owner, 'POST', '/api/login', {'name': ' TEST ', 'password': 'test-passwort', 'remember': True})[:2], 200,
     lambda p: p == {'loggedIn': True, 'name': 'test', 'remember': True})
step('me (angemeldet)', *call(owner, 'GET', '/api/me')[:2], 200, lambda p: p['loggedIn'] is True and p['name'] == 'test')
step('Artikel anlegen ohne Login', *call(guest, 'POST', '/api/posts', {'title': 'x'})[:2], 401)

# ---------- Artikel ----------
a = step('neuer Artikel ist privat', *call(owner, 'POST', '/api/posts', {'title': '  Eins  ', 'body': 'Text', 'status': 'draft'})[:2], 201,
         lambda p: p['private'] is True and p['title'] == 'Eins' and p['status'] == 'draft')
b = step('öffentlich + veröffentlicht, Themen bereinigt', *call(owner, 'POST', '/api/posts', {
    'title': 'Zwei', 'body': 'Hallo', 'status': 'published', 'private': False,
    'tags': ['  Pflege  ', 'pflege', 'Gedanken', 'Mehr   Leer', 5]})[:2], 201,
    lambda p: p['tags'] == ['Pflege', 'Gedanken', 'Mehr Leer'] and p['private'] is False)
c = step('öffentlicher Entwurf', *call(owner, 'POST', '/api/posts', {
    'title': 'Drei', 'body': 'Geheimer Entwurfstext', 'status': 'draft', 'private': False})[:2], 201)
step('acht Themen höchstens', *call(owner, 'POST', '/api/posts', {
    'title': 'Viele', 'body': '', 'status': 'draft', 'tags': [f'T{i}' for i in range(12)]})[:2], 201,
    lambda p: len(p['tags']) == 8)

step('Liste angemeldet', *call(owner, 'GET', '/api/posts')[:2], 200, lambda p: len(p) == 4)
guest_list = step('Liste Gast: ohne private, Entwurf ohne Text', *call(guest, 'GET', '/api/posts')[:2], 200,
                  lambda p: sorted(x['title'] for x in p) == ['Drei', 'Zwei']
                  and [x for x in p if x['title'] == 'Drei'][0]['body'] == ''
                  and [x for x in p if x['title'] == 'Drei'][0]['locked'] is True)
step('Gast: privater Artikel 404', *call(guest, 'GET', f"/api/posts/{a['id']}")[:2], 404)
step('Gast: Entwurf einzeln 404', *call(guest, 'GET', f"/api/posts/{c['id']}")[:2], 404)
step('Gast: veröffentlicht 200', *call(guest, 'GET', f"/api/posts/{b['id']}")[:2], 200, lambda p: p['body'] == 'Hallo')
step('unbekannter Artikel 404', *call(owner, 'GET', '/api/posts/gibtsnicht')[:2], 404)

# ---------- Konfliktschutz ----------
step('veralteter Stand -> 409', *call(owner, 'PUT', f"/api/posts/{b['id']}", {
    'title': 'Zwei', 'body': 'alt', 'status': 'published', 'baseUpdatedAt': 'veraltet'})[:2], 409,
    lambda p: p['current']['body'] == 'Hallo')
b2 = step('richtiger Stand -> 200', *call(owner, 'PUT', f"/api/posts/{b['id']}", {
    'title': 'Zwei', 'body': 'Hallo Welt', 'status': 'published', 'baseUpdatedAt': b['rev']})[:2], 200,
    lambda p: p['body'] == 'Hallo Welt' and p['rev'] != b['rev'] and p['tags'] == ['Pflege', 'Gedanken', 'Mehr Leer'])
step('fehlendes private/tags bleibt (alte App)', *call(owner, 'PUT', f"/api/posts/{a['id']}", {
    'title': 'Eins', 'body': 'neu', 'status': 'draft'})[:2], 200,
    lambda p: p['private'] is True)
step('ohne Stand -> überschreibt', *call(owner, 'PUT', f"/api/posts/{a['id']}", {
    'title': 'Eins', 'body': 'neu2', 'status': 'draft', 'tags': ['Pflege']})[:2], 200)
step('PUT unbekannt 404', *call(owner, 'PUT', '/api/posts/gibtsnicht', {'title': 'x'})[:2], 404)

# ---------- Themen ----------
step('Thema umbenennen', *call(owner, 'POST', '/api/tags', {'from': 'pflege', 'to': 'Pflegealltag'})[:2], 200, lambda p: p['changed'] == 2)
step('Thema löschen', *call(owner, 'POST', '/api/tags', {'from': 'Gedanken', 'to': None})[:2], 200, lambda p: p['changed'] == 1)
step('Thema leer -> 400', *call(owner, 'POST', '/api/tags', {'from': '  ', 'to': 'x'})[:2], 400)
step('Stand nach Umbenennen', *call(owner, 'GET', f"/api/posts/{b['id']}")[:2], 200,
     lambda p: p['tags'] == ['Pflegealltag', 'Mehr Leer'] and p['updatedAt'] == b2['updatedAt'] and p['rev'] != b2['rev'])

# ---------- Bilder ----------
small = png(40, 30)
body, ctype = multipart('image', 'bild.png', small, 'image/png')
step('Upload ohne Header -> 400', *call(owner, 'POST', '/api/uploads', raw=body, ctype=ctype)[:2], 400)
step('Upload ohne Login -> 401', *call(guest, 'POST', '/api/uploads', raw=body, ctype=ctype, headers={'X-Notizblog': '1'})[:2], 401)
up = step('Upload PNG', *call(owner, 'POST', '/api/uploads', raw=body, ctype=ctype, headers={'X-Notizblog': '1'})[:2], 201,
          lambda p: p['url'].startswith('uploads/') and p['url'].endswith('.png'))
fake, fctype = multipart('image', 'boese.png', b'<?php echo 1; ?>', 'image/png')
step('Upload kein Bild -> 415', *call(owner, 'POST', '/api/uploads', raw=fake, ctype=fctype, headers={'X-Notizblog': '1'})[:2], 415)
big, bctype = multipart('image', 'gross.png', png(2600, 20), 'image/png')
bigup = step('großes Bild wird verkleinert', *call(owner, 'POST', '/api/uploads', raw=big, ctype=bctype, headers={'X-Notizblog': '1'})[:2], 201)
uploads_dir = os.environ.get('UPLOADS_DIR')
if uploads_dir and bigup:
    w, h = png_size(os.path.join(uploads_dir, bigup['url'].split('/')[-1]))
    step('… auf 2000 px', 200, {'size': [w, h]}, 200, lambda p: p['size'][0] == 2000)
# Echtes kleines WebP (8×6). PHP speichert es mit GD neu, Go prüft und übernimmt es.
webp = bytes.fromhex('524946463c0000005745425056503820300000001002009d012a0800060001402625a00274ba01f801f80003c800feeeff9ffea0b7c99e7cf6fffaf441e20df9d9000000')
wbody, wctype = multipart('image', 'mini.webp', webp, 'image/webp')
step('Upload WebP', *call(owner, 'POST', '/api/uploads', raw=wbody, ctype=wctype, headers={'X-Notizblog': '1'})[:2], 201,
     lambda p: p['url'].endswith('.webp'))

name = up['url'].split('/')[-1]
call(owner, 'PUT', f"/api/posts/{b['id']}", {'title': 'Zwei', 'body': f"Bild: ![x](uploads/{name})", 'status': 'published'})
step('Bild in Benutzung -> 409', *call(owner, 'DELETE', f'/api/uploads/{name}')[:2], 409)
step('ungültiger Name -> 400', *call(owner, 'DELETE', '/api/uploads/..%2Fdata%2Fauth.json')[:2], None,
     lambda p: True)
step('fremdes Bild löschen -> 404', *call(owner, 'DELETE', '/api/uploads/' + 'a' * 24 + '.png')[:2], 404)
step('ungenutztes Bild löschen -> 204', *call(owner, 'DELETE', '/api/uploads/' + bigup['url'].split('/')[-1])[:2], 204)

# ---------- Statische Dateien ----------
for path, want in [('/js/main.js', 200), ('/fonts/ibm-plex-sans-400.woff2', 200), ('/data/auth.json', 404),
                   ('/src/Auth.php', 404), ('/main.go', 404), ('/go.mod', 404), ('/data/.gitkeep', 404), ('/api.php', 404), ('/.gitignore', 404),
                   ('/js/../data/auth.json', 404)]:
    st, _, _ = call(guest, 'GET', path)
    step(f'Datei {path}', st, None, want)
st, _, hdrs = call(guest, 'GET', '/sw.js')
step('sw.js ohne Cache', st, {'cache': hdrs.get('Cache-Control')}, 200, lambda p: p['cache'] == 'no-cache')
st, _, hdrs = call(guest, 'GET', '/' + up['url'])
step('Bild ausliefern', st, None, 200)

# ---------- Homepage ----------
step('Homepage: nicht eingestellt', *call(owner, 'GET', '/api/homepage')[:2], 200, lambda p: p['configured'] is False)
step('Homepage: veröffentlichen ohne Ordner -> 409', *call(owner, 'POST', '/api/homepage/publish', {})[:2], 409)
if HOMEPAGE:
    with open(os.path.join(DATA, 'homepage-path'), 'w') as f:
        f.write(HOMEPAGE + '\n')
    step('Homepage: eingestellt', *call(owner, 'GET', '/api/homepage')[:2], 200, lambda p: p['configured'] is True and p['last'] is None)
    step('Homepage: veröffentlichen', *call(owner, 'POST', '/api/homepage/publish', {})[:2], 200,
         lambda p: p['ok'] and p['changed'] and p['pushed'] and p['summary']['published'] == 1 and p['summary']['private'] == 2
         and p['summary']['draft'] == 1 and p['summary']['copied'] == 1)
    step('Homepage: ohne Änderung', *call(owner, 'POST', '/api/homepage/publish', {})[:2], 200,
         lambda p: p['ok'] and not p['changed'] and not p['pushed'])
    with open(os.path.join(HOMEPAGE, 'blog-data', 'posts.json')) as f:
        step('Homepage: Export-Datei', 200, json.load(f), 200,
             lambda p: [x['title'] for x in p] == ['Zwei', 'Drei'] and p[1]['body'] == '')
    step('Homepage: Status gemerkt', *call(owner, 'GET', '/api/homepage')[:2], 200, lambda p: p['last']['ok'] is True)

# ---------- Schreibzeit offline geschriebener Artikel ----------
from datetime import datetime, timedelta, timezone
iso = lambda t: t.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + f'{t.microsecond // 1000:03d}Z'
earlier = iso(datetime.now(timezone.utc) - timedelta(hours=2))
o = step('Schreibzeit vom Gerät übernommen', *call(owner, 'POST', '/api/posts', {'title': 'Offline', 'createdAt': earlier})[:2], 201,
         lambda p: p['createdAt'] == earlier and p['updatedAt'] != earlier)
f = step('Zeit in der Zukunft ignoriert', *call(owner, 'POST', '/api/posts', {'title': 'Zukunft', 'createdAt': '2099-01-01T00:00:00.000Z'})[:2], 201,
         lambda p: p['createdAt'] != '2099-01-01T00:00:00.000Z')
step('Ändern ändert die Schreibzeit nicht', *call(owner, 'PUT', f"/api/posts/{o['id']}", {'title': 'Offline', 'createdAt': iso(datetime.now(timezone.utc) - timedelta(days=3))})[:2], 200,
     lambda p: p['createdAt'] == earlier)
for x in (o, f):
    call(owner, 'DELETE', f"/api/posts/{x['id']}")

# ---------- Doppelt angekommen: dieselbe Gerätekennung legt nur EINEN Artikel an ----------
before = len(call(owner, 'GET', '/api/posts')[1])
d1 = step('Neu mit Gerätekennung', *call(owner, 'POST', '/api/posts', {'title': 'Jung', 'clientId': 'local-abc123-def4'})[:2], 201,
          lambda p: p['clientId'] == 'local-abc123-def4')
d2 = step('Gleiche Kennung nochmal -> derselbe Artikel', *call(owner, 'POST', '/api/posts', {'title': 'Jung und', 'clientId': 'local-abc123-def4'})[:2], 201,
          lambda p: p['id'] == d1['id'] and p['title'] == 'Jung')
step('Nur ein Artikel dazugekommen', 200, len(call(owner, 'GET', '/api/posts')[1]) - before, 200, lambda n: n == 1)
d3 = step('Ungültige Kennung wird ignoriert', *call(owner, 'POST', '/api/posts', {'title': 'X', 'clientId': '../böse'})[:2], 201,
          lambda p: 'clientId' not in p)
for x in (d1, d3):
    call(owner, 'DELETE', f"/api/posts/{x['id']}")

# ---------- Löschen, Abmelden ----------
step('Artikel löschen', *call(owner, 'DELETE', f"/api/posts/{c['id']}")[:2], 204)
step('nochmal löschen -> 404', *call(owner, 'DELETE', f"/api/posts/{c['id']}")[:2], 404)
step('unbekannte Route', *call(owner, 'GET', '/api/gibtsnicht')[:2], 404)
step('falsche Methode', *call(owner, 'PATCH', '/api/posts')[:2], 404)
step('alle Geräte abmelden', *call(owner, 'POST', '/api/logout-all')[:2], 200)
step('danach abgemeldet', *call(owner, 'GET', '/api/me')[:2], 200, lambda p: p['loggedIn'] is False)

# ---------- Schutz vor Durchprobieren ----------
for i in range(5):
    call(guest, 'POST', '/api/login', {'name': 'test', 'password': f'falsch{i}'})
step('6. Fehlversuch -> 429', *call(guest, 'POST', '/api/login', {'name': 'test', 'password': 'test-passwort'})[:2], 429)

print(json.dumps({'results': results, 'failures': failures}, ensure_ascii=False, indent=1))
sys.exit(1 if failures else 0)
