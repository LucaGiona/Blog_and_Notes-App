<?php
// Blog -> Homepage.
//
// exportBlog():       schreibt die öffentlichen Artikel nach <Homepage>/blog-data/
// publishHomepage():  exportiert, committet NUR blog-data/ und pusht – ein Hoster wie
//                     Netlify oder GitHub Pages veröffentlicht danach von selbst.
//
// Was mitkommt:
//   veröffentlicht + öffentlich -> vollständig
//   Entwurf + öffentlich        -> nur Titel, Datum, Themen (der Text bleibt hier)
//   privat                      -> gar nicht
//
// Benutzt von bin/export.php (Kommandozeile) und api.php (Knopf/Automatik in der App).

declare(strict_types=1);

// Gleiche Form wie die Dateinamen, die der Blog beim Hochladen vergibt
const BLOG_IMAGE = '/uploads\/([a-f0-9]{24}\.(?:jpg|png|webp|gif))/';
const BLOG_IMAGE_FILE = '/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/';

/** Ist das wirklich der Homepage-Ordner? Sonst Fehlermeldung, sonst null. */
function homepageProblem(string $homepage): ?string
{
    if ($homepage === '') return 'Kein Homepage-Ordner eingestellt';
    if (!is_dir($homepage)) return "Homepage-Ordner $homepage gibt es nicht";
    // Nicht aus Versehen in den Blog selbst exportieren
    $self = realpath(dirname(__DIR__));
    $real = realpath($homepage);
    if ($real === $self || str_starts_with($real . '/', $self . '/')) {
        return 'Der Homepage-Ordner darf nicht im Blog-Ordner liegen';
    }
    return null;
}

/**
 * Schreibt blog-data/posts.json und gleicht blog-data/uploads/ ab.
 * Gibt eine Zusammenfassung zurück; wirft RuntimeException bei Fehlern.
 */
function exportBlog(JsonStore $store, string $homepage): array
{
    if ($problem = homepageProblem($homepage)) throw new RuntimeException($problem);

    $target = "$homepage/blog-data";
    $targetUploads = "$target/uploads";
    if (!is_dir($targetUploads) && !mkdir($targetUploads, 0755, true)) {
        throw new RuntimeException("Ordner $targetUploads kann nicht angelegt werden");
    }

    $out = [];
    $images = [];
    $count = ['published' => 0, 'draft' => 0, 'private' => 0];
    $warnings = [];

    foreach ($store->list() as $post) {
        if (!empty($post['private'])) {
            $count['private']++;
            continue;
        }
        $isDraft = ($post['status'] ?? 'draft') !== 'published';
        $count[$isDraft ? 'draft' : 'published']++;

        $body = $isDraft ? '' : (string)($post['body'] ?? '');
        if (preg_match_all(BLOG_IMAGE, $body, $m)) {
            foreach ($m[1] as $name) $images[$name] = true;
        }

        // Nur die Felder, die die Homepage braucht (kein rev, kein private)
        $out[] = [
            'id'        => $post['id'],
            'title'     => (string)($post['title'] ?? ''),
            'status'    => $isDraft ? 'draft' : 'published',
            'body'      => $body,
            'tags'      => array_values($post['tags'] ?? []),
            'createdAt' => $post['createdAt'] ?? '',
            'updatedAt' => $post['updatedAt'] ?? '',
        ];
    }
    usort($out, fn($a, $b) => strcmp($b['updatedAt'], $a['updatedAt']));

    // Bilder abgleichen: fehlende kopieren, nicht mehr benutzte entfernen
    $copied = $removed = 0;
    foreach (array_keys($images) as $name) {
        $from = UPLOAD_DIR . "/$name";
        $to = "$targetUploads/$name";
        if (!is_file($from)) {
            $warnings[] = "Bild $name fehlt im Blog (uploads/) – übersprungen";
            continue;
        }
        if (!is_file($to) || filesize($to) !== filesize($from)) {
            copy($from, $to);
            $copied++;
        }
    }
    foreach (glob("$targetUploads/*") ?: [] as $file) {
        // Nur Dateien anfassen, die nach Blog-Bild aussehen
        if (preg_match(BLOG_IMAGE_FILE, basename($file)) && !isset($images[basename($file)])) {
            unlink($file);
            $removed++;
        }
    }

    $json = json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    if (file_put_contents("$target/posts.json", $json) === false) {
        throw new RuntimeException("$target/posts.json kann nicht geschrieben werden");
    }

    return $count + [
        'images' => count($images), 'copied' => $copied, 'removed' => $removed,
        'warnings' => $warnings, 'target' => $target,
    ];
}

/**
 * Exportieren, committen (nur blog-data/) und pushen.
 * Ergebnis landet auch in data/homepage-status.json (für die Anzeige in der App).
 */
function publishHomepage(JsonStore $store): array
{
    $result = ['at' => timestamp(), 'ok' => false, 'changed' => false, 'pushed' => false];
    try {
        $summary = exportBlog($store, HOMEPAGE_DIR);
        $result['summary'] = array_diff_key($summary, ['target' => 1]);

        $branch = trim(git(['rev-parse', '--abbrev-ref', 'HEAD'])['out']);
        $result['branch'] = $branch;

        git(['add', '--', 'blog-data'], true);
        // Hat sich in blog-data/ etwas geändert?
        $result['changed'] = git(['diff', '--cached', '--quiet', '--', 'blog-data'])['code'] !== 0;

        if ($result['changed']) {
            // Pfadangabe: committet NUR blog-data/, auch wenn sonst noch etwas vorgemerkt ist
            git(['commit', '-m', 'Blog aktualisiert', '--', 'blog-data'], true);
        }

        // Pushen, wenn es etwas zu pushen gibt (auch ein früherer, gescheiterter Versuch)
        $ahead = git(['rev-list', '--count', '@{u}..HEAD']);
        if ($ahead['code'] !== 0 || (int)trim($ahead['out']) > 0) {
            git(['push'], true, PUBLISH_TIMEOUT);
            $result['pushed'] = true;
        }
        $result['ok'] = true;
    } catch (Throwable $e) {
        $result['error'] = $e->getMessage();
    }

    file_put_contents(HOMEPAGE_STATUS_FILE, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    return $result;
}

/** Letzter Stand fürs Anzeigen in der App */
function homepageStatus(): array
{
    $status = is_file(HOMEPAGE_STATUS_FILE)
        ? (json_decode((string)file_get_contents(HOMEPAGE_STATUS_FILE), true) ?: [])
        : [];
    return ['configured' => homepageProblem(HOMEPAGE_DIR) === null, 'last' => $status ?: null];
}

/**
 * git im Homepage-Ordner ausführen – ohne Shell (keine Sonderzeichen-Probleme)
 * und ohne Rückfragen: fehlt ein Passwort, scheitert git sofort statt zu warten.
 */
function git(array $args, bool $mustWork = false, int $timeout = 20): array
{
    $env = getenv() + [
        'GIT_TERMINAL_PROMPT' => '0',
        'GIT_SSH_COMMAND' => 'ssh -o BatchMode=yes',
        'LC_ALL' => 'C',
    ];
    $proc = proc_open(array_merge(['git'], $args), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, HOMEPAGE_DIR, $env);
    if (!is_resource($proc)) throw new RuntimeException('git konnte nicht gestartet werden');

    stream_set_blocking($pipes[1], false);
    stream_set_blocking($pipes[2], false);
    $out = $err = '';
    $deadline = microtime(true) + $timeout;
    while (true) {
        $out .= stream_get_contents($pipes[1]);
        $err .= stream_get_contents($pipes[2]);
        $status = proc_get_status($proc);
        if (!$status['running']) break;
        if (microtime(true) > $deadline) {
            proc_terminate($proc);
            throw new RuntimeException('git ' . $args[0] . ' hat zu lange gedauert (keine Verbindung?)');
        }
        usleep(50_000);
    }
    $out .= stream_get_contents($pipes[1]);
    $err .= stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);
    $code = $status['exitcode'];

    if ($mustWork && $code !== 0) {
        // Erste aussagekräftige Zeile reicht für die Anzeige in der App
        $lines = array_values(array_filter(array_map('trim', explode("\n", $err ?: $out))));
        $msg = preg_replace('/^(fatal|error):\s*/', '', $lines[0] ?? "Fehlercode $code");
        throw new RuntimeException('git ' . $args[0] . ': ' . mb_substr($msg, 0, 160));
    }
    return ['code' => $code, 'out' => $out, 'err' => $err];
}
