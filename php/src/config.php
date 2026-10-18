<?php
// Einstellungen. Pfade lassen sich per Umgebungsvariable ändern –
// z. B. um data/ beim Hoster außerhalb des Web-Ordners abzulegen.

declare(strict_types=1);

if (PHP_VERSION_ID < 80100) {
    http_response_code(500);
    exit('Notizblog braucht PHP 8.1 oder neuer.');
}

define('DATA_DIR',   getenv('NOTIZBLOG_DATA') ?: dirname(__DIR__) . '/data');
define('DATA_FILE',  DATA_DIR . '/posts.json');
define('AUTH_FILE',  DATA_DIR . '/auth.json');
define('FAILS_FILE', DATA_DIR . '/login-fails.json');
define('UPLOAD_DIR', getenv('NOTIZBLOG_UPLOADS') ?: dirname(__DIR__) . '/uploads');

// Homepage-Ordner für „Auf Homepage veröffentlichen“ (siehe src/Homepage.php).
// Eingeschaltet wird die Funktion, indem man den Pfad in data/homepage-path schreibt
// (eine Zeile) oder die Umgebungsvariable NOTIZBLOG_HOMEPAGE setzt. Ohne beides: aus.
define('HOMEPAGE_PATH_FILE',   DATA_DIR . '/homepage-path');
define('HOMEPAGE_STATUS_FILE', DATA_DIR . '/homepage-status.json');
define('HOMEPAGE_DIR', (function (): string {
    $dir = getenv('NOTIZBLOG_HOMEPAGE') ?: (is_file(HOMEPAGE_PATH_FILE) ? trim((string)file_get_contents(HOMEPAGE_PATH_FILE)) : '');
    return rtrim($dir, '/');
})());
const PUBLISH_TIMEOUT = 45; // Sekunden für git push, danach Abbruch

const SESSION_LENGTH = 30 * 24 * 3600; // „Angemeldet bleiben“: 30 Tage
const SHORT_SESSION_LENGTH = 12 * 3600; // ohne Haken: max. 12 Stunden
const MAX_FAILS      = 5;              // Fehlversuche pro IP …
const FAIL_WINDOW    = 15 * 60;        // … in diesem Zeitraum (Sekunden)
const MAX_BODY_BYTES = 1024 * 1024;    // 1 MB pro Anfrage
const COOKIE_NAME    = 'notizblog_session';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB pro Bild (Server-Limit kann kleiner sein)
const MAX_IMAGE_SIDE   = 2000;             // längste Seite in Pixeln
