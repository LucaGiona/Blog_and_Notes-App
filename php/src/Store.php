<?php
// Speicher in einer JSON-Datei.
// PHP startet für jede Anfrage neu – deshalb wird die Datei bei jedem
// Zugriff gelesen und mit flock() gesperrt, damit sich zwei gleichzeitige
// Anfragen nicht gegenseitig überschreiben.
// Später kann hier eine SqliteStore-Klasse mit denselben Methoden daneben stehen.

declare(strict_types=1);

/** Der Artikel wurde inzwischen auf einem anderen Gerät geändert. */
final class ConflictException extends RuntimeException
{
    public function __construct(public readonly array $current)
    {
        parent::__construct('Konflikt');
    }
}

final class JsonStore
{
    public function __construct(private string $path)
    {
    }

    public function list(): array
    {
        return $this->withLock(LOCK_SH, fn(array $posts) => [$posts, false]);
    }

    public function get(string $id): ?array
    {
        foreach ($this->list() as $post) {
            if ($post['id'] === $id) {
                return $post;
            }
        }
        return null;
    }

    public function create(array $in): array
    {
        return $this->withLock(LOCK_EX, function (array $posts) use ($in) {
            // Gleiche Kennung vom Gerät schon angelegt (Anfrage kam doppelt) -> den nehmen
            if (isset($in['clientId'])) {
                foreach ($posts as $post) {
                    if (($post['clientId'] ?? null) === $in['clientId']) {
                        return [$post, false];
                    }
                }
            }
            $now = timestamp();
            $post = ['id' => uuid4()] + $in + ['createdAt' => $now, 'updatedAt' => $now, 'rev' => newRev()];
            $posts[] = $post;
            return [$post, $posts];
        });
    }

    /**
     * $base = Stand (rev) des Artikels, wie das Gerät ihn zuletzt kannte.
     * Weicht er ab, hat ein anderes Gerät inzwischen gespeichert -> ConflictException,
     * statt dessen Änderung stillschweigend zu überschreiben.
     * Ohne $base (null) wird einfach überschrieben.
     *
     * rev ändert sich bei JEDER Änderung, updatedAt nur, wenn Titel/Text/Status
     * geändert wurden (Themen umbenennen soll die Reihenfolge nicht durcheinanderbringen).
     * Ältere Artikel ohne rev werden über updatedAt verglichen.
     */
    public function update(string $id, array $in, ?string $base = null): ?array
    {
        return $this->withLock(LOCK_EX, function (array $posts) use ($id, $in, $base) {
            foreach ($posts as $i => $post) {
                if ($post['id'] === $id) {
                    if ($base !== null && $base !== ($post['rev'] ?? $post['updatedAt'])) {
                        throw new ConflictException($post);
                    }
                    $posts[$i] = array_merge($post, $in, ['updatedAt' => timestamp(), 'rev' => newRev()]);
                    return [$posts[$i], $posts];
                }
            }
            return [null, false];
        });
    }

    /**
     * Thema in allen Artikeln umbenennen ($to) oder entfernen ($to = null).
     * Groß-/Kleinschreibung egal. Gibt die Zahl der geänderten Artikel zurück.
     */
    public function renameTag(string $from, ?string $to): int
    {
        return $this->withLock(LOCK_EX, function (array $posts) use ($from, $to) {
            $count = 0;
            $key = mb_strtolower($from);
            foreach ($posts as $i => $post) {
                $tags = $post['tags'] ?? [];
                $hit = false;
                $new = [];
                foreach ($tags as $tag) {
                    if (mb_strtolower($tag) === $key) {
                        $hit = true;
                        if ($to !== null) $new[] = $to;
                    } else {
                        $new[] = $tag;
                    }
                }
                if ($hit) {
                    $posts[$i]['tags'] = cleanTags($new); // fällt beim Umbenennen mit einem bestehenden Thema zusammen
                    $posts[$i]['rev'] = newRev();
                    $count++;
                }
            }
            return [$count, $count ? $posts : false];
        });
    }

    /**
     * Kurze Kennung des aktuellen Stands. Ändert sich, sobald irgendein Gerät
     * etwas speichert – die App fragt sie regelmäßig ab (über api/health).
     */
    public function version(): string
    {
        clearstatcache(true, $this->path);
        return is_file($this->path) ? substr(md5_file($this->path), 0, 12) : 'leer';
    }

    public function delete(string $id): bool
    {
        return $this->withLock(LOCK_EX, function (array $posts) use ($id) {
            $left = array_values(array_filter($posts, fn($p) => $p['id'] !== $id));
            return count($left) === count($posts) ? [false, false] : [true, $left];
        });
    }

    /**
     * Öffnet die Datei, sperrt sie und ruft $fn mit allen Artikeln auf.
     * $fn gibt [ergebnis, neueArtikel|false] zurück – bei false wird nicht geschrieben.
     */
    private function withLock(int $mode, callable $fn): mixed
    {
        $dir = dirname($this->path);
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new RuntimeException("Ordner $dir kann nicht angelegt werden");
        }

        $fh = fopen($this->path, 'c+');
        if ($fh === false) {
            throw new RuntimeException("{$this->path} kann nicht geöffnet werden");
        }
        try {
            flock($fh, $mode);
            $raw = stream_get_contents($fh);
            $posts = $raw === '' || $raw === false ? [] : json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

            [$result, $newPosts] = $fn($posts);

            if ($newPosts !== false) {
                $json = json_encode($newPosts, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                ftruncate($fh, 0);
                rewind($fh);
                fwrite($fh, $json);
                fflush($fh);
            }
            return $result;
        } finally {
            flock($fh, LOCK_UN);
            fclose($fh);
        }
    }
}
