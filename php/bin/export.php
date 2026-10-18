<?php
// Blog für die Homepage exportieren – von Hand, ohne Git.
//
//   php bin/export.php /pfad/zu/meiner-website
//   php bin/export.php                   (nimmt den eingestellten Ordner, siehe data/homepage-path)
//   php bin/export.php --push            (zusätzlich committen + pushen, wie der Knopf in der App)
//
// Was genau exportiert wird, steht in src/Homepage.php.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/config.php';
require __DIR__ . '/../src/http.php';
require __DIR__ . '/../src/Store.php';
require __DIR__ . '/../src/Homepage.php';

$args = array_slice($argv, 1);
$push = in_array('--push', $args, true);
$dir = rtrim(array_values(array_filter($args, fn($a) => $a !== '--push'))[0] ?? HOMEPAGE_DIR, '/');
$store = new JsonStore(DATA_FILE);

if ($push) {
    if ($dir !== HOMEPAGE_DIR) {
        fwrite(STDERR, "--push geht nur mit dem eingestellten Ordner (data/homepage-path).\n");
        exit(1);
    }
    $r = publishHomepage($store);
    if (!$r['ok']) {
        fwrite(STDERR, "Fehlgeschlagen: {$r['error']}\n");
        exit(1);
    }
    echo $r['changed'] ? "Neuer Stand committet" : "Keine Änderung";
    echo $r['pushed'] ? " und gepusht (Branch {$r['branch']}).\n" : ", nichts zu pushen.\n";
    exit(0);
}

try {
    $s = exportBlog($store, $dir);
} catch (RuntimeException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    fwrite(STDERR, "Aufruf: php bin/export.php <Homepage-Ordner>\n");
    exit(1);
}

foreach ($s['warnings'] as $w) fwrite(STDERR, "Warnung: $w\n");
echo "Exportiert nach {$s['target']}\n";
echo "  {$s['published']} veröffentlicht, {$s['draft']} Entwurf/Entwürfe (nur Titel), {$s['private']} privat (nicht exportiert)\n";
echo "  Bilder: {$s['images']} verwendet, {$s['copied']} neu kopiert, {$s['removed']} entfernt\n";
echo "\nVeröffentlichen (im Homepage-Ordner):\n";
echo "  git add blog-data/ && git commit -m \"Blog aktualisiert\" && git push\n";
