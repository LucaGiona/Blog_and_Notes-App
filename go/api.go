// Alle /api/...-Anfragen – Gegenstück zu php/api.php (gleiche Pfade, gleiche Antworten).

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strings"
)

var (
	reUpload = regexp.MustCompile(`^/uploads/([\w.-]+)$`)
	rePost   = regexp.MustCompile(`^/posts/([\w-]+)$`)
)

func handleAPI(w http.ResponseWriter, r *http.Request) {
	defer func() {
		switch e := recover().(type) {
		case nil:
		case apiError:
			writeJSON(w, e.code, e.data)
		default:
			log.Printf("Notizblog: %v", e)
			writeJSON(w, 500, map[string]any{"error": "Interner Fehler"})
		}
	}()
	route(w, r)
	fail(404, "Unbekannte Route")
}

// "/api/posts/123/" -> "/posts/123"
func apiPath(r *http.Request) string {
	p := strings.TrimPrefix(r.URL.Path, "/api")
	return "/" + strings.Trim(p, "/")
}

func route(w http.ResponseWriter, r *http.Request) {
	store := Store{dataFile}
	path, method := apiPath(r), r.Method

	// ---------- Login ----------
	switch {
	case path == "/health" && method == "GET":
		// version: ändert sich bei jeder Speicherung -> andere Geräte merken es
		reply(200, map[string]any{"ok": true, "version": store.Version()})
	case path == "/login" && method == "POST":
		handleLogin(w, r)
	case path == "/logout" && method == "POST":
		clearSession(w, r)
		reply(200, map[string]any{"loggedIn": false})
	case path == "/logout-all" && method == "POST":
		handleLogoutAll(w, r)
	case path == "/me" && method == "GET":
		user := currentUser(r)
		reply(200, map[string]any{"loggedIn": user != "", "name": user, "configured": loadAuth() != nil})
	}

	// ---------- Bilder ----------
	if path == "/uploads" && method == "POST" {
		requireAuth(r)
		handleUpload(w, r)
	}
	if m := reUpload.FindStringSubmatch(path); m != nil && method == "DELETE" {
		requireAuth(r)
		handleUploadDelete(m[1], store)
	}

	// ---------- Homepage ----------
	if path == "/homepage" && method == "GET" {
		requireAuth(r)
		reply(200, homepageStatus())
	}
	if path == "/homepage/publish" && method == "POST" {
		requireAuth(r)
		readJSONBody(r, 1024) // nur JSON annehmen (Schutz vor fremden Formularen)
		if p := homepageProblem(homepageDir()); p != "" {
			fail(409, p)
		}
		result := publishHomepage(store)
		code := 200
		if result["ok"] != true {
			code = 502
		}
		reply(code, result)
	}

	// ---------- Themen ----------
	// Umbenennen {"from": "Plfege", "to": "Pflege"} oder überall entfernen {"from": "Gastro", "to": null}
	if path == "/tags" && method == "POST" {
		requireAuth(r)
		in := readJSONBody(r, maxBodyBytes)
		from := firstTag(in["from"])
		var to *string
		if raw, ok := in["to"]; ok && string(raw) != "null" {
			t := firstTag(raw)
			to = &t
		}
		if from == "" || (to != nil && *to == "") {
			fail(400, "Thema fehlt")
		}
		reply(200, map[string]any{"changed": store.RenameTag(from, to)})
	}

	// ---------- Artikel ----------
	if path == "/posts" {
		if method == "GET" {
			posts := store.List()
			if currentUser(r) == "" {
				guest := []Post{}
				for _, p := range posts {
					if isPublic(p) {
						guest = append(guest, forGuest(p))
					}
				}
				posts = guest
			}
			reply(200, posts)
		}
		if method == "POST" {
			requireAuth(r)
			in, _ := readInput(r)
			// Neue Artikel sind privat, wenn nichts anderes gesagt wird
			if _, ok := in["private"]; !ok {
				in["private"] = true
			}
			reply(201, store.Create(in))
		}
	}

	if m := rePost.FindStringSubmatch(path); m != nil {
		id := m[1]
		switch method {
		case "GET":
			post := store.Get(id)
			// Entwürfe und private Artikel sind für Gäste nicht einzeln abrufbar
			if post == nil || (currentUser(r) == "" && (post["status"] == "draft" || !isPublic(post))) {
				fail(404, "Nicht gefunden")
			}
			reply(200, post)
		case "PUT":
			requireAuth(r)
			in, base := readInput(r)
			post, err := store.Update(id, in, base)
			if c, ok := err.(conflictError); ok {
				reply(409, map[string]any{"error": "Auf einem anderen Gerät geändert", "current": c.current})
			}
			if post == nil {
				fail(404, "Nicht gefunden")
			}
			reply(200, post)
		case "DELETE":
			requireAuth(r)
			if !store.Delete(id) {
				fail(404, "Nicht gefunden")
			}
			reply(204, nil)
		}
	}
}

func firstTag(raw json.RawMessage) string {
	var s any
	json.Unmarshal(raw, &s)
	if t := cleanTags([]any{s}); len(t) > 0 {
		return t[0]
	}
	return ""
}

// Private Artikel sieht nur der angemeldete Nutzer – Besucher erfahren nicht einmal, dass es sie gibt.
func isPublic(p Post) bool {
	v, ok := p["private"]
	return !ok || v == nil || v == false
}

// Entfernt den Text von Entwürfen – so steht er nirgends im Browser.
func forGuest(p Post) Post {
	if p["status"] != "draft" {
		return p
	}
	copy := Post{}
	for k, v := range p {
		copy[k] = v
	}
	copy["body"] = ""
	copy["locked"] = true
	return copy
}
