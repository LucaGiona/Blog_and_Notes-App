<?php
// Nur für den lokalen PHP-Testserver:
//   php -S localhost:8000 router.php
// Beim Hoster (Apache) übernimmt das die .htaccess.

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// API
if (preg_match('#^/api(/|$)#', $path)) {
    // Bei Adressen mit Dateiendung (z. B. api/uploads/x.png) setzt der Testserver
    // SCRIPT_NAME auf diese Adresse – api.php braucht aber den eigenen Pfad
    $_SERVER['SCRIPT_NAME'] = '/api.php';
    require __DIR__ . '/api.php';
    return true;
}

// PWA-Dateien im Hauptordner
if ($path === '/sw.js') {
    header('Content-Type: text/javascript; charset=utf-8');
    header('Cache-Control: no-cache'); // Browser soll Updates des Service Workers sofort sehen
    readfile(__DIR__ . '/sw.js');
    return true;
}
if ($path === '/manifest.webmanifest') {
    header('Content-Type: application/manifest+json; charset=utf-8');
    readfile(__DIR__ . '/manifest.webmanifest');
    return true;
}

// Hochgeladene Bilder – aus UPLOAD_DIR (kann per NOTIZBLOG_UPLOADS woanders liegen)
if (preg_match('#^/uploads/([a-f0-9]{24}\.(jpg|png|webp|gif))$#', $path, $m)) {
    require __DIR__ . '/src/config.php';
    $file = UPLOAD_DIR . '/' . $m[1];
    if (!is_file($file)) {
        http_response_code(404);
        echo 'Nicht gefunden';
        return true;
    }
    $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif'];
    header('Content-Type: ' . $types[$m[2]]);
    header('X-Content-Type-Options: nosniff');
    readfile($file);
    return true;
}

// Nur das Frontend ausliefern – data/, src/, bin/ und PHP-Dateien sperren
if ($path === '/' || $path === '/index.html'
    || preg_match('#^/(css|js|fonts|icons)/[\w./-]+$#', $path) && !str_contains($path, '..')
    && !preg_match('#\.(php\d?|phtml|phar)$|/\.#i', $path)) {
    if (str_ends_with($path, '.woff2')) {
        header('Content-Type: font/woff2');
        readfile(__DIR__ . $path);
        return true;
    }
    return false; // PHP-Testserver liefert die Datei selbst aus
}

http_response_code(404);
echo 'Nicht gefunden';
return true;
