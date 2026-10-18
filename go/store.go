// Artikel in data/posts.json – Gegenstück zu php/src/Store.php.
// Gleiches Dateiformat und dieselbe Dateisperre (flock) wie PHP: Beide Backends
// können sogar gleichzeitig auf dieselben Daten zugreifen.

package main

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

type Post = map[string]any

// Der Artikel wurde inzwischen auf einem anderen Gerät geändert
type conflictError struct{ current Post }

func (conflictError) Error() string { return "Konflikt" }

type Store struct{ path string }

func (s Store) List() []Post {
	var out []Post
	s.withLock(syscall.LOCK_SH, func(posts []Post) []Post {
		out = posts
		return nil
	})
	return out
}

func (s Store) Get(id string) Post {
	for _, p := range s.List() {
		if p["id"] == id {
			return p
		}
	}
	return nil
}

func (s Store) Create(in Post) Post {
	var post Post
	s.withLock(syscall.LOCK_EX, func(posts []Post) []Post {
		now := timestamp()
		post = Post{"id": uuid4(), "createdAt": now, "updatedAt": now, "rev": newRev()}
		for k, v := range in {
			post[k] = v
		}
		return append(posts, post)
	})
	return post
}

// base = Stand (rev) des Artikels, wie das Gerät ihn zuletzt kannte. Weicht er ab,
// hat ein anderes Gerät inzwischen gespeichert -> conflictError. Ohne base: überschreiben.
// Ältere Artikel ohne rev werden über updatedAt verglichen.
func (s Store) Update(id string, in Post, base *string) (Post, error) {
	var post Post
	var err error
	s.withLock(syscall.LOCK_EX, func(posts []Post) []Post {
		for i, p := range posts {
			if p["id"] != id {
				continue
			}
			current, _ := p["rev"].(string)
			if current == "" {
				current, _ = p["updatedAt"].(string)
			}
			if base != nil && *base != current {
				err = conflictError{p}
				return nil
			}
			for k, v := range in {
				p[k] = v
			}
			p["updatedAt"] = timestamp()
			p["rev"] = newRev()
			posts[i] = p
			post = p
			return posts
		}
		return nil
	})
	return post, err
}

func (s Store) Delete(id string) bool {
	found := false
	s.withLock(syscall.LOCK_EX, func(posts []Post) []Post {
		left := posts[:0:0]
		for _, p := range posts {
			if p["id"] == id {
				found = true
			} else {
				left = append(left, p)
			}
		}
		if !found {
			return nil
		}
		return left
	})
	return found
}

// Thema in allen Artikeln umbenennen (to) oder entfernen (to = nil). Groß-/Kleinschreibung egal.
// Ändert rev, aber nicht updatedAt (Reihenfolge der Artikel bleibt).
func (s Store) RenameTag(from string, to *string) int {
	count := 0
	key := strings.ToLower(from)
	s.withLock(syscall.LOCK_EX, func(posts []Post) []Post {
		for _, p := range posts {
			tags, _ := p["tags"].([]any)
			hit := false
			var renamed []any
			for _, t := range tags {
				if s, ok := t.(string); ok && strings.ToLower(s) == key {
					hit = true
					if to != nil {
						renamed = append(renamed, *to)
					}
				} else {
					renamed = append(renamed, t)
				}
			}
			if hit {
				p["tags"] = cleanTags(renamed) // fällt beim Umbenennen mit einem bestehenden Thema zusammen
				p["rev"] = newRev()
				count++
			}
		}
		if count == 0 {
			return nil
		}
		return posts
	})
	return count
}

// Kurze Kennung des aktuellen Stands – ändert sich bei jeder Speicherung
func (s Store) Version() string {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return "leer"
	}
	sum := md5.Sum(b)
	return hex.EncodeToString(sum[:])[:12]
}

// Öffnet die Datei, sperrt sie und ruft fn mit allen Artikeln auf.
// Gibt fn eine Liste zurück, wird sie geschrieben; bei nil nicht.
func (s Store) withLock(mode int, fn func([]Post) []Post) {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		panic(err)
	}
	f, err := os.OpenFile(s.path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), mode); err != nil {
		panic(err)
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)

	raw, err := io.ReadAll(f)
	if err != nil {
		panic(err)
	}
	posts := []Post{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &posts); err != nil {
			panic(err)
		}
	}

	changed := fn(posts)
	if changed == nil || mode != syscall.LOCK_EX {
		return
	}
	f.Truncate(0)
	f.Seek(0, 0)
	f.Write(encodeJSON(changed, true))
}
