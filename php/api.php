<?php
// Einstieg für alle /api/...-Anfragen.
// Apache leitet per .htaccess hierher, der PHP-Testserver per router.php.

declare(strict_types=1);

// Warnungen nie in die Antwort schreiben – sonst ist das JSON kaputt.
// Sie landen stattdessen im Log (Terminal bei php -S, error_log beim Hoster).
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

require __DIR__ . '/src/config.php';
require __DIR__ . '/src/http.php';
require __DIR__ . '/src/Store.php';
require __DIR__ . '/src/Auth.php';
require __DIR__ . '/src/Uploads.php';
require __DIR__ . '/src/Homepage.php';

$store = new JsonStore(DATA_FILE);
$auth  = new Auth(AUTH_FILE, FAILS_FILE);

$method = $_SERVER['REQUEST_METHOD'];
$path   = apiPath(); // z. B. "/posts/abc-123"

try {
    // ---------- Login ----------
    if ($path === '/health' && $method === 'GET') {
        // version: ändert sich bei jeder Speicherung -> andere Geräte merken es
        json(200, ['ok' => true, 'version' => $store->version()]);
    }
    if ($path === '/login' && $method === 'POST') {
        $auth->login();
    }
    if ($path === '/logout' && $method === 'POST') {
        $auth->clearSession();
        json(200, ['loggedIn' => false]);
    }
    if ($path === '/logout-all' && $method === 'POST') {
        $auth->logoutAll();
    }
    if ($path === '/me' && $method === 'GET') {
        $user = $auth->user();
        json(200, ['loggedIn' => $user !== null, 'name' => $user ?? '', 'configured' => $auth->configured()]);
    }

    // ---------- Bilder ----------
    if ($path === '/uploads' && $method === 'POST') {
        $auth->require();
        handleUpload();
    }
    if (preg_match('#^/uploads/([\w.-]+)$#', $path, $m) && $method === 'DELETE') {
        $auth->require();
        handleUploadDelete($m[1], $store);
    }

    // ---------- Homepage ----------
    // Status (eingestellt? letzter Stand?) und „Auf Homepage veröffentlichen“
    if ($path === '/homepage' && $method === 'GET') {
        $auth->require();
        json(200, homepageStatus());
    }
    if ($path === '/homepage/publish' && $method === 'POST') {
        $auth->require();
        readJsonBody(1024); // nur JSON annehmen (Schutz vor fremden Formularen)
        if ($problem = homepageProblem(HOMEPAGE_DIR)) {
            json(409, ['error' => $problem]);
        }
        $result = publishHomepage($store);
        json($result['ok'] ? 200 : 502, $result + ($result['ok'] ? [] : ['error' => $result['error']]));
    }

    // ---------- Themen ----------
    // Umbenennen (Tippfehler) oder überall entfernen: {"from": "Plfege", "to": "Pflege"} / {"from": "Gastro", "to": null}
    if ($path === '/tags' && $method === 'POST') {
        $auth->require();
        $in = readJsonBody(MAX_BODY_BYTES);
        $from = cleanTags([$in['from'] ?? ''])[0] ?? '';
        $to = isset($in['to']) ? (cleanTags([$in['to']])[0] ?? '') : null;
        if ($from === '' || $to === '') {
            json(400, ['error' => 'Thema fehlt']);
        }
        json(200, ['changed' => $store->renameTag($from, $to)]);
    }

    // ---------- Artikel ----------
    if ($path === '/posts') {
        if ($method === 'GET') {
            $posts = $store->list();
            if (!$auth->loggedIn()) {
                $posts = array_map('forGuest', array_values(array_filter($posts, 'isPublic')));
            }
            json(200, $posts);
        }
        if ($method === 'POST') {
            $auth->require();
            // Neue Artikel sind privat, wenn nichts anderes gesagt wird
            json(201, $store->create(readInput($base, true) + ['private' => true]));
        }
    }

    if (preg_match('#^/posts/([\w-]+)$#', $path, $m)) {
        $id = $m[1];

        if ($method === 'GET') {
            $post = $store->get($id);
            // Entwürfe und private Artikel sind für Gäste nicht einzeln abrufbar
            if ($post === null || (!$auth->loggedIn() && ($post['status'] === 'draft' || !isPublic($post)))) {
                json(404, ['error' => 'Nicht gefunden']);
            }
            json(200, $post);
        }
        if ($method === 'PUT') {
            $auth->require();
            $in = readInput($base);
            try {
                $post = $store->update($id, $in, $base);
            } catch (ConflictException $e) {
                json(409, ['error' => 'Auf einem anderen Gerät geändert', 'current' => $e->current]);
            }
            $post === null ? json(404, ['error' => 'Nicht gefunden']) : json(200, $post);
        }
        if ($method === 'DELETE') {
            $auth->require();
            if (!$store->delete($id)) {
                json(404, ['error' => 'Nicht gefunden']);
            }
            http_response_code(204);
            exit;
        }
    }

    json(404, ['error' => 'Unbekannte Route']);
} catch (Throwable $e) {
    error_log('Notizblog: ' . $e->getMessage());
    json(500, ['error' => 'Interner Fehler']);
}

// Private Artikel sieht nur der angemeldete Nutzer – Besucher erfahren nicht einmal, dass es sie gibt.
function isPublic(array $post): bool
{
    return empty($post['private']);
}

// Entfernt den Text von Entwürfen – so steht er nirgends im Browser.
function forGuest(array $post): array
{
    if ($post['status'] === 'draft') {
        $post['body'] = '';
        $post['locked'] = true;
    }
    return $post;
}
