<?php
// Bild-Upload: POST api/uploads (multipart, Feld "image"), nur mit Login.
//
// Sicherheit:
// - Der Dateityp wird am INHALT erkannt (getimagesize), nicht an der Endung.
// - Der Dateiname wird zufällig erzeugt – nie der vom Browser.
// - Wenn GD vorhanden ist, wird das Bild neu gespeichert. Dabei fallen
//   Metadaten wie GPS-Ort weg, und versteckter Code im Bild wird zerstört.

declare(strict_types=1);

const IMAGE_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/webp' => 'webp',
    'image/gif'  => 'gif',
];

function handleUpload(): never
{
    // Eigener Header: fremde Webseiten können ihn nicht ohne Weiteres mitschicken (CSRF-Schutz)
    if (($_SERVER['HTTP_X_NOTIZBLOG'] ?? '') !== '1') {
        json(400, ['error' => 'Ungültige Anfrage']);
    }

    $file = $_FILES['image'] ?? null;
    if (!is_array($file) || is_array($file['error'])) {
        // Ist die Datei größer als post_max_size, kommt bei PHP gar nichts an
        json(413, ['error' => 'Kein Bild empfangen – evtl. zu groß für den Server (' . ini_get('post_max_size') . ')']);
    }
    if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE) {
        json(413, ['error' => 'Bild zu groß für den Server (max. ' . ini_get('upload_max_filesize') . ')']);
    }
    if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        json(400, ['error' => 'Upload fehlgeschlagen']);
    }
    if ($file['size'] > MAX_UPLOAD_BYTES) {
        json(413, ['error' => 'Bild zu groß (max. ' . round(MAX_UPLOAD_BYTES / 1024 / 1024) . ' MB)']);
    }

    $info = @getimagesize($file['tmp_name']);
    $mime = $info['mime'] ?? '';
    if (!isset(IMAGE_TYPES[$mime])) {
        json(415, ['error' => 'Nur JPG, PNG, WebP oder GIF']);
    }
    if ($info[0] * $info[1] > 40_000_000) { // 40 Megapixel – schützt den Server-Speicher
        json(413, ['error' => 'Bild hat zu viele Pixel']);
    }

    if (!is_dir(UPLOAD_DIR) && !mkdir(UPLOAD_DIR, 0755, true) && !is_dir(UPLOAD_DIR)) {
        throw new RuntimeException('uploads/ kann nicht angelegt werden');
    }

    $name = bin2hex(random_bytes(12)) . '.' . IMAGE_TYPES[$mime];
    $target = UPLOAD_DIR . '/' . $name;

    if (!reencode($file['tmp_name'], $mime, $target)) {
        // Kein GD (oder Format nicht unterstützt): Datei unverändert übernehmen.
        // Der Browser hat sie vorher schon verkleinert und ohne Metadaten neu erzeugt.
        if (!move_uploaded_file($file['tmp_name'], $target)) {
            throw new RuntimeException('Bild konnte nicht gespeichert werden');
        }
    }
    chmod($target, 0644);

    json(201, ['url' => 'uploads/' . $name]);
}

/** Bild mit GD neu speichern, dabei auf MAX_IMAGE_SIDE verkleinern. false = nicht möglich. */
function reencode(string $source, string $mime, string $target): bool
{
    // GIFs bleiben unverändert – sonst gingen Animationen verloren
    if ($mime === 'image/gif' || !function_exists('imagecreatefromstring')) {
        return false;
    }
    $writers = ['image/jpeg' => 'imagejpeg', 'image/png' => 'imagepng', 'image/webp' => 'imagewebp'];
    if (!function_exists($writers[$mime])) {
        return false;
    }

    $img = @imagecreatefromstring((string)file_get_contents($source));
    if ($img === false) {
        json(415, ['error' => 'Bild ist beschädigt oder wird nicht unterstützt']);
    }

    $w = imagesx($img);
    $h = imagesy($img);
    $scale = min(1, MAX_IMAGE_SIDE / max($w, $h));
    if ($scale < 1) {
        $img = imagescale($img, (int)round($w * $scale), (int)round($h * $scale));
    }

    if ($mime !== 'image/jpeg') { // Transparenz erhalten
        imagealphablending($img, false);
        imagesavealpha($img, true);
    }

    $ok = match ($mime) {
        'image/jpeg' => imagejpeg($img, $target, 85),
        'image/png'  => imagepng($img, $target, 6),
        'image/webp' => imagewebp($img, $target, 85),
    };
    // Kein imagedestroy(): seit PHP 8 überflüssig und ab PHP 8.5 als veraltet markiert
    return $ok;
}

/**
 * Bild löschen: DELETE api/uploads/<name>, nur mit Login.
 * Gelöscht wird nur, wenn KEIN Artikel das Bild mehr verwendet – sonst 409.
 */
function handleUploadDelete(string $name, JsonStore $store): never
{
    // Nur Namen, wie der Server sie selbst vergibt (verhindert z. B. "../data/auth.json")
    if (!preg_match('/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/', $name)) {
        json(400, ['error' => 'Ungültiger Dateiname']);
    }
    foreach ($store->list() as $post) {
        if (str_contains($post['body'] ?? '', 'uploads/' . $name)) {
            json(409, ['error' => 'Bild wird noch in „' . $post['title'] . '“ verwendet']);
        }
    }
    $file = UPLOAD_DIR . '/' . $name;
    if (!is_file($file)) {
        json(404, ['error' => 'Nicht gefunden']);
    }
    if (!unlink($file)) {
        throw new RuntimeException('Bild konnte nicht gelöscht werden');
    }
    http_response_code(204);
    exit;
}
