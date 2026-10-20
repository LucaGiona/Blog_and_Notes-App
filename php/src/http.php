<?php
// Kleine HTTP-Helfer.

declare(strict_types=1);

// Antwort als JSON senden und beenden
function json(int $code, mixed $data): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// Basis-Pfad der App, z. B. "" oder "/blog" – damit läuft sie auch in einem Unterordner
function basePath(): string
{
    return rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
}

// "/blog/api/posts/123" -> "/posts/123"
function apiPath(): string
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $path = substr($path, strlen(basePath()));
    $path = preg_replace('#^/api(\.php)?#', '', $path);
    return '/' . trim($path, '/');
}

function isJson(): bool
{
    return str_starts_with($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '', 'application/json');
}

// JSON-Body lesen. Nur JSON annehmen – schützt zusätzlich vor fremden Formularen (CSRF).
function readJsonBody(int $maxBytes): array
{
    if (!isJson()) {
        json(415, ['error' => 'JSON erwartet']);
    }
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw === false || strlen($raw) > $maxBytes) {
        json(413, ['error' => 'Anfrage zu groß']);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        json(400, ['error' => 'Ungültiges JSON']);
    }
    return $data;
}

// Nur erlaubte Felder für Artikel übernehmen.
// $base bekommt den mitgeschickten Stand (baseUpdatedAt) für den Konfliktschutz.
function readInput(?string &$base = null, bool $isNew = false): array
{
    $in = readJsonBody(MAX_BODY_BYTES);
    $base = isset($in['baseUpdatedAt']) && is_string($in['baseUpdatedAt']) ? $in['baseUpdatedAt'] : null;
    $title = trim((string)($in['title'] ?? ''));
    $out = [
        'title'  => mb_substr($title, 0, 300),
        'body'   => (string)($in['body'] ?? ''),
        'status' => ($in['status'] ?? '') === 'published' ? 'published' : 'draft',
    ];
    // Fehlende Felder (ältere App-Version) nicht überschreiben, sondern beibehalten
    if (array_key_exists('tags', $in)) {
        $out['tags'] = cleanTags($in['tags']);
    }
    // Privat = nur für dich: Besucher bekommen den Artikel gar nicht (auch keinen Titel).
    // Auch hier: fehlt das Feld, bleibt der bisherige Wert – sonst würde ein privater
    // Artikel beim Speichern von einem nicht aktualisierten Gerät versehentlich öffentlich.
    if (array_key_exists('private', $in)) {
        $out['private'] = $in['private'] === true;
    }
    // Neuer Artikel, offline geschrieben: Schreibzeit vom Gerät übernehmen (statt Ankunftszeit)
    if ($isNew && ($written = clientTime($in['createdAt'] ?? null))) {
        $out['createdAt'] = $written;
    }
    // Kennung vom Gerät: Kommt dieselbe Anfrage zweimal an, wird nur EIN Artikel angelegt
    if ($isNew && is_string($in['clientId'] ?? null) && preg_match('/^local-[A-Za-z0-9-]{1,40}$/', $in['clientId'])) {
        $out['clientId'] = $in['clientId'];
    }
    return $out;
}

/**
 * Zeitangabe vom Gerät prüfen: ISO-Format, nicht in der Zukunft (5 Min. Spielraum
 * für falsch gehende Uhren), höchstens ein Jahr alt. Sonst null.
 */
function clientTime(mixed $value): ?string
{
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/', $value)) {
        return null;
    }
    try {
        $t = new DateTimeImmutable($value);
    } catch (Exception) {
        return null;
    }
    $ts = $t->getTimestamp();
    if ($ts > time() + 300 || $ts < time() - 366 * 86400) {
        return null;
    }
    return $t->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
}

/** Neue Kennung für den Stand eines Artikels */
function newRev(): string
{
    return bin2hex(random_bytes(6));
}

/**
 * Themen (z. B. „Pflege“, „Gastro“): höchstens 8, je höchstens 30 Zeichen,
 * keine doppelten (Groß-/Kleinschreibung egal).
 */
function cleanTags(mixed $tags): array
{
    if (!is_array($tags)) return [];
    $out = [];
    foreach ($tags as $tag) {
        if (!is_string($tag)) continue;
        $tag = mb_substr(trim(preg_replace('/\s+/u', ' ', $tag)), 0, 30);
        if ($tag === '' || isset($out[mb_strtolower($tag)])) continue;
        $out[mb_strtolower($tag)] = $tag;
        if (count($out) === 8) break;
    }
    return array_values($out);
}

function isHttps(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

// Gleiches Format wie JavaScripts toISOString(), z. B. 2026-10-17T09:27:05.769Z
function timestamp(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
}

function uuid4(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}
