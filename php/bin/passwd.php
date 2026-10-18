<?php
// Eigenen Benutzer anlegen oder Passwort ändern:
//   php bin/passwd.php            (fragt nach Name und Passwort)
//   php bin/passwd.php <name>
// Schreibt data/auth.json neu. Alle Geräte sind danach abgemeldet.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/config.php';
require __DIR__ . '/../src/Auth.php';

// Name als Argument oder abfragen
$name = $argv[1] ?? '';
if ($name === '') {
    fwrite(STDOUT, 'Benutzername (a-z, 0-9, _ und -): ');
    $name = strtolower(trim((string)fgets(STDIN)));
}
if (!preg_match('/^[a-z0-9_-]{1,32}$/', $name)) {
    fwrite(STDERR, "Ungültiger Name – erlaubt sind a-z, 0-9, _ und - (max. 32 Zeichen)\n");
    exit(1);
}

// Passwort ohne Anzeige einlesen (macOS/Linux)
function askPassword(string $prompt): string
{
    fwrite(STDOUT, $prompt);
    $tty = stream_isatty(STDIN);
    if ($tty) shell_exec('stty -echo');
    $password = rtrim((string)fgets(STDIN), "\r\n");
    if ($tty) {
        shell_exec('stty echo');
        fwrite(STDOUT, "\n");
    }
    return $password;
}

$password = askPassword('Neues Passwort: ');
if ($password === '') {
    fwrite(STDERR, "Passwort darf nicht leer sein\n");
    exit(1);
}
// Am Terminal zweimal fragen (Tippfehler). Aus einer Pipe nur einmal.
if (stream_isatty(STDIN) && askPassword('Passwort wiederholen: ') !== $password) {
    fwrite(STDERR, "Die Passwörter stimmen nicht überein\n");
    exit(1);
}

$cfg = [
    'user'   => $name,
    'hash'   => hashPassword($password), // PBKDF2 – lesen PHP und Go
    'secret' => bin2hex(random_bytes(32)), // neues Secret = alle abgemeldet
];

if (!is_dir(DATA_DIR)) {
    mkdir(DATA_DIR, 0755, true);
}
file_put_contents(AUTH_FILE, json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
chmod(AUTH_FILE, 0600);

echo "Benutzer „{$name}“ gespeichert in " . AUTH_FILE . "\n";
