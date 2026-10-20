// Kleine Helfer – Gegenstück zu php/src/http.php.

package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// apiError beendet eine Anfrage mit Statuscode + {"error": …} (wie json() in PHP)
type apiError struct {
	code int
	data any
}

func fail(code int, msg string) { panic(apiError{code, map[string]any{"error": msg}}) }
func reply(code int, data any)  { panic(apiError{code, data}) }

func writeJSON(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	if code == http.StatusNoContent {
		return
	}
	w.Write(encodeJSON(data, false))
}

// JSON wie PHP mit JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
func encodeJSON(data any, pretty bool) []byte {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if pretty {
		enc.SetIndent("", "    ")
	}
	enc.Encode(data)
	return bytes.TrimRight(buf.Bytes(), "\n")
}

func isJSON(r *http.Request) bool {
	return strings.HasPrefix(r.Header.Get("Content-Type"), "application/json")
}

// JSON-Body lesen. Nur JSON annehmen – schützt zusätzlich vor fremden Formularen (CSRF).
func readJSONBody(r *http.Request, maxBytes int64) map[string]json.RawMessage {
	if !isJSON(r) {
		fail(415, "JSON erwartet")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
	if err != nil || int64(len(raw)) > maxBytes {
		fail(413, "Anfrage zu groß")
	}
	var data map[string]json.RawMessage
	if json.Unmarshal(raw, &data) != nil || data == nil {
		fail(400, "Ungültiges JSON")
	}
	return data
}

// Feld als Text (wie (string) in PHP; fehlt es, dann "")
func str(in map[string]json.RawMessage, key string) string {
	var s string
	if raw, ok := in[key]; ok && json.Unmarshal(raw, &s) == nil {
		return s
	}
	return ""
}

// Feld ist genau true
func isTrue(in map[string]json.RawMessage, key string) bool {
	var b bool
	raw, ok := in[key]
	return ok && json.Unmarshal(raw, &b) == nil && b
}

// Nur erlaubte Felder für Artikel übernehmen (wie readInput() in PHP).
// base = mitgeschickter Stand (baseUpdatedAt) für den Konfliktschutz.
func readInput(r *http.Request, isNew bool) (map[string]any, *string) {
	in := readJSONBody(r, maxBodyBytes)
	var base *string
	if raw, ok := in["baseUpdatedAt"]; ok {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			base = &s
		}
	}
	status := "draft"
	if str(in, "status") == "published" {
		status = "published"
	}
	out := map[string]any{
		"title":  substr(strings.TrimSpace(str(in, "title")), 300),
		"body":   str(in, "body"),
		"status": status,
	}
	// Fehlende Felder (ältere App-Version) nicht überschreiben, sondern beibehalten
	if raw, ok := in["tags"]; ok {
		var tags []any
		json.Unmarshal(raw, &tags)
		out["tags"] = cleanTags(tags)
	}
	if _, ok := in["private"]; ok {
		out["private"] = isTrue(in, "private")
	}
	// Neuer Artikel, offline geschrieben: Schreibzeit vom Gerät übernehmen (statt Ankunftszeit)
	if isNew {
		if written := clientTime(str(in, "createdAt")); written != "" {
			out["createdAt"] = written
		}
		// Kennung vom Gerät: Kommt dieselbe Anfrage zweimal an, wird nur EIN Artikel angelegt
		if id := str(in, "clientId"); clientIDPattern.MatchString(id) {
			out["clientId"] = id
		}
	}
	return out, base
}

var clientIDPattern = regexp.MustCompile(`^local-[A-Za-z0-9-]{1,40}$`)

var isoTime = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$`)

// Zeitangabe vom Gerät prüfen: ISO-Format, nicht in der Zukunft (5 Min. Spielraum
// für falsch gehende Uhren), höchstens ein Jahr alt. Sonst "".
func clientTime(value string) string {
	if !isoTime.MatchString(value) {
		return ""
	}
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return ""
	}
	now := time.Now()
	if t.After(now.Add(5*time.Minute)) || t.Before(now.Add(-366*24*time.Hour)) {
		return ""
	}
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

var spaces = regexp.MustCompile(`\s+`)

// Themen: höchstens 8, je höchstens 30 Zeichen, keine doppelten (Groß-/Kleinschreibung egal)
func cleanTags(tags []any) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, t := range tags {
		s, ok := t.(string)
		if !ok {
			continue
		}
		s = substr(strings.TrimSpace(spaces.ReplaceAllString(s, " ")), 30)
		key := strings.ToLower(s)
		if s == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, s)
		if len(out) == 8 {
			break
		}
	}
	return out
}

// Die ersten n Zeichen (nicht Bytes) – wie mb_substr
func substr(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Neue Kennung für den Stand eines Artikels
func newRev() string { return randomHex(6) }

// Gleiches Format wie JavaScripts toISOString(), z. B. 2026-10-17T09:27:05.769Z
func timestamp() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

func uuid4() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return fmt.Sprintf("%s-%s-%s-%s-%s", h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}
