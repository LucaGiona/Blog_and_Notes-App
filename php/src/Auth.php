<?php
// Login für genau einen Benutzer.
//
// - Passwort nur als Hash in data/auth.json: PBKDF2-SHA256 (versteht auch das
//   Go-Backend). Ältere bcrypt-Hashes (password_hash) werden weiter akzeptiert.
// - Nach dem Login ein signiertes Cookie "name.ablaufzeit.signatur".
//   Keine PHP-Sessions: die werden bei vielen Hostern nach ~24 Minuten
//   aufgeräumt – das Cookie hier hält zuverlässig 30 Tage.
//
// Passwort setzen/ändern:  php bin/passwd.php <name>

declare(strict_types=1);

final class Auth
{
    private ?array $cfg = null;

    public function __construct(private string $authFile, private string $failsFile)
    {
        if (is_file($authFile)) {
            $cfg = json_decode((string)file_get_contents($authFile), true);
            if (is_array($cfg) && isset($cfg['user'], $cfg['hash'], $cfg['secret'])) {
                $this->cfg = $cfg;
            }
        }
    }

    public function configured(): bool
    {
        return $this->cfg !== null;
    }

    // ---------- Anmelden ----------

    public function login(): never
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '?';
        if ($this->tooManyFails($ip)) {
            json(429, ['error' => 'Zu viele Versuche. Bitte später erneut.']);
        }

        $in = readJsonBody(4096);
        $name = strtolower(trim((string)($in['name'] ?? '')));
        $password = (string)($in['password'] ?? '');
        $remember = ($in['remember'] ?? false) === true;

        if (!$this->check($name, $password)) {
            $this->addFail($ip);
            usleep(500_000); // bremst Rate-Versuche
            json(401, ['error' => 'Name oder Passwort falsch']);
        }

        $this->clearFails($ip);
        $this->setSession($this->cfg['user'], $remember);
        json(200, ['loggedIn' => true, 'name' => $this->cfg['user'], 'remember' => $remember]);
    }

    /**
     * Alle Geräte abmelden: neues Secret -> jedes bisher ausgegebene Cookie
     * hat eine ungültige Signatur. Praktisch, wenn man sich irgendwo
     * vergessen hat abzumelden.
     */
    public function logoutAll(): never
    {
        $this->require();
        $this->cfg['secret'] = bin2hex(random_bytes(32));
        $tmp = $this->authFile . '.tmp';
        file_put_contents($tmp, json_encode($this->cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        chmod($tmp, 0600);
        rename($tmp, $this->authFile);
        $this->clearSession();
        json(200, ['loggedIn' => false]);
    }

    private function check(string $name, string $password): bool
    {
        if ($this->cfg === null) {
            return false;
        }
        // Beides immer prüfen – verrät nichts darüber, ob der Name stimmt
        $passOk = verifyPassword($password, $this->cfg['hash']);
        $userOk = hash_equals($this->cfg['user'], $name);
        return $userOk && $passOk;
    }

    // ---------- Cookie ----------

    private function sign(string $payload): string
    {
        return hash_hmac('sha256', $payload, $this->cfg['secret']);
    }

    private function cookieOptions(int $expires): array
    {
        return [
            'expires'  => $expires,
            'path'     => (basePath() ?: '') . '/',
            'secure'   => isHttps(),
            'httponly' => true,   // JavaScript kommt nicht an das Cookie
            'samesite' => 'Lax',
        ];
    }

    /**
     * $remember = true  -> Cookie bleibt 30 Tage (eigene Geräte)
     * $remember = false -> Sitzungs-Cookie: weg, sobald der Browser schließt,
     *                      und serverseitig spätestens nach 12 Stunden ungültig
     */
    private function setSession(string $user, bool $remember): void
    {
        $exp = time() + ($remember ? SESSION_LENGTH : SHORT_SESSION_LENGTH);
        $payload = $user . '.' . $exp;
        $options = $this->cookieOptions($remember ? $exp : 0);
        setcookie(COOKIE_NAME, $payload . '.' . $this->sign($payload), $options);
    }

    public function clearSession(): void
    {
        setcookie(COOKIE_NAME, '', $this->cookieOptions(time() - 3600));
    }

    /** Angemeldeter Benutzer oder null */
    public function user(): ?string
    {
        if ($this->cfg === null) {
            return null;
        }
        $parts = explode('.', $_COOKIE[COOKIE_NAME] ?? '');
        if (count($parts) !== 3) {
            return null;
        }
        [$user, $exp, $sig] = $parts;
        if (!hash_equals($this->sign("$user.$exp"), $sig)) {
            return null;
        }
        if (!ctype_digit($exp) || (int)$exp < time() || $user !== $this->cfg['user']) {
            return null;
        }
        return $user;
    }

    public function loggedIn(): bool
    {
        return $this->user() !== null;
    }

    /** Ohne Login -> 401 und Ende */
    public function require(): void
    {
        if (!$this->loggedIn()) {
            json(401, ['error' => 'Nicht angemeldet']);
        }
    }

    // ---------- Schutz vor Durchprobieren ----------
    // Fehlversuche in einer Datei, weil PHP sich zwischen Anfragen nichts merkt.

    private function withFails(callable $fn): mixed
    {
        $fh = @fopen($this->failsFile, 'c+');
        if ($fh === false) {
            return $fn([])[0]; // Datei nicht beschreibbar -> ohne Sperre weiter
        }
        try {
            flock($fh, LOCK_EX);
            $all = json_decode((string)stream_get_contents($fh), true) ?: [];
            // Alte Einträge verwerfen
            $cut = time() - FAIL_WINDOW;
            foreach ($all as $ip => $times) {
                $all[$ip] = array_values(array_filter($times, fn($t) => $t > $cut));
                if (!$all[$ip]) {
                    unset($all[$ip]);
                }
            }
            [$result, $all] = $fn($all);
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, json_encode($all));
            return $result;
        } finally {
            flock($fh, LOCK_UN);
            fclose($fh);
        }
    }

    private function tooManyFails(string $ip): bool
    {
        return $this->withFails(fn($all) => [count($all[$ip] ?? []) >= MAX_FAILS, $all]);
    }

    private function addFail(string $ip): void
    {
        $this->withFails(function ($all) use ($ip) {
            $all[$ip][] = time();
            return [null, $all];
        });
    }

    private function clearFails(string $ip): void
    {
        $this->withFails(function ($all) use ($ip) {
            unset($all[$ip]);
            return [null, $all];
        });
    }
}

// ---------- Passwort-Hash ----------
// Format: pbkdf2-sha256$<Runden>$<Salz base64>$<Hash base64>
// Gleich in PHP und Go (go/auth.go), damit beide Backends dieselbe auth.json lesen.

const PBKDF2_ROUNDS = 600_000;

function hashPassword(string $password): string
{
    $salt = random_bytes(16);
    $hash = hash_pbkdf2('sha256', $password, $salt, PBKDF2_ROUNDS, 32, true);
    return 'pbkdf2-sha256$' . PBKDF2_ROUNDS . '$' . base64_encode($salt) . '$' . base64_encode($hash);
}

function verifyPassword(string $password, string $stored): bool
{
    if (str_starts_with($stored, 'pbkdf2-sha256$')) {
        $parts = explode('$', $stored);
        if (count($parts) !== 4 || !ctype_digit($parts[1])) return false;
        $salt = base64_decode($parts[2], true);
        $want = base64_decode($parts[3], true);
        if ($salt === false || $want === false) return false;
        $got = hash_pbkdf2('sha256', $password, $salt, (int)$parts[1], strlen($want), true);
        return hash_equals($want, $got);
    }
    return password_verify($password, $stored); // älteres bcrypt
}
