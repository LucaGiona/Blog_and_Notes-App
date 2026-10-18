// Notizblog – Go-Backend. Gleiche Oberfläche, gleiche API, gleiche Daten wie die
// PHP-Fassung (../php/api.php). Nur Standardbibliothek, Go 1.22 oder neuer.
//
// Im Ordner go/ starten (dort liegen auch index.html, css/, js/ …):
//
//   go run .                     Server auf Port 8002 (anderer Port: PORT=8003 go run .)
//   go run . passwd [name]       eigenen Benutzer anlegen / Passwort ändern
//   go run . export <ordner>     Blog für eine Homepage exportieren (wie php/bin/export.php)
//   go run . export --push       … mit dem eingestellten Ordner, committen + pushen

package main

import (
	"bufio"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

func main() {
	if _, err := os.Stat(filepath.Join(rootDir, "index.html")); err != nil {
		log.Fatalf("index.html nicht gefunden – bitte im Ordner go/ starten (dort, wo index.html liegt).")
	}
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "passwd":
			cmdPasswd(os.Args[2:])
			return
		case "export":
			cmdExport(os.Args[2:])
			return
		default:
			log.Fatalf("Unbekannter Befehl %q – möglich: passwd, export", os.Args[1])
		}
	}

	addr := ":" + envOr("PORT", "8002")
	if loadAuth() == nil {
		log.Printf("Noch kein Benutzer angelegt: go run . passwd")
	}
	log.Printf("Notizblog (Go) läuft auf http://localhost%s  ·  Anmelden: http://localhost%s/#/admin", addr, addr)
	log.Fatal(http.ListenAndServe(addr, http.HandlerFunc(serve)))
}

var (
	staticPath  = regexp.MustCompile(`^/(css|js|fonts|icons|uploads)/[\w./-]+$`)
	scriptLike  = regexp.MustCompile(`(?i)\.(php\d?|phtml|phar)$|/\.`)
	uploadImage = regexp.MustCompile(`^/uploads/[a-f0-9]{24}\.(jpg|png|webp|gif)$`)
)

// Wie router.php: API, App-Dateien – und sonst nichts (data/, src/, go/ … bleiben gesperrt)
func serve(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case path == "/api" || strings.HasPrefix(path, "/api/"):
		handleAPI(w, r)
	case path == "/sw.js":
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache") // Browser soll Updates des Service Workers sofort sehen
		http.ServeFile(w, r, filepath.Join(rootDir, "sw.js"))
	case path == "/manifest.webmanifest":
		w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
		http.ServeFile(w, r, filepath.Join(rootDir, "manifest.webmanifest"))
	case path == "/" || path == "/index.html":
		http.ServeFile(w, r, filepath.Join(rootDir, "index.html"))
	case staticPath.MatchString(path) && !strings.Contains(path, "..") && !scriptLike.MatchString(path):
		dir := rootDir
		if strings.HasPrefix(path, "/uploads/") {
			if !uploadImage.MatchString(path) { // im Upload-Ordner nur Bilder
				http.NotFound(w, r)
				return
			}
			dir = filepath.Dir(uploadDir) // uploadDir kann woanders liegen
			path = "/" + filepath.Base(uploadDir) + strings.TrimPrefix(path, "/uploads")
			w.Header().Set("X-Content-Type-Options", "nosniff")
		}
		if strings.HasSuffix(path, ".woff2") {
			w.Header().Set("Content-Type", "font/woff2")
		}
		file := filepath.Join(dir, filepath.FromSlash(path))
		if st, err := os.Stat(file); err != nil || st.IsDir() {
			http.Error(w, "Nicht gefunden", http.StatusNotFound)
			return
		}
		http.ServeFile(w, r, file)
	default:
		http.Error(w, "Nicht gefunden", http.StatusNotFound)
	}
}

// ---------- Befehle ----------

var validName = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

// Eigenen Benutzer anlegen oder Passwort ändern: schreibt data/auth.json neu (PBKDF2).
// Ohne Namen wird danach gefragt. Alle Geräte sind danach abgemeldet.
func cmdPasswd(args []string) {
	in := bufio.NewReader(os.Stdin)
	isTerminal := false
	if st, err := os.Stdin.Stat(); err == nil {
		isTerminal = st.Mode()&os.ModeCharDevice != 0
	}

	name := ""
	if len(args) > 0 {
		name = args[0]
	} else {
		fmt.Print("Benutzername (a-z, 0-9, _ und -): ")
		line, _ := in.ReadString('\n')
		name = strings.ToLower(strings.TrimSpace(line))
	}
	if !validName.MatchString(name) {
		log.Fatal("Ungültiger Name – erlaubt sind a-z, 0-9, _ und - (max. 32 Zeichen)")
	}

	// Passwort ohne Anzeige einlesen (macOS/Linux)
	ask := func(prompt string) string {
		fmt.Print(prompt)
		stty := func(arg string) {
			cmd := exec.Command("stty", arg)
			cmd.Stdin = os.Stdin
			cmd.Run()
		}
		if isTerminal {
			stty("-echo")
		}
		line, _ := in.ReadString('\n')
		if isTerminal {
			stty("echo")
			fmt.Println()
		}
		return strings.TrimRight(line, "\r\n")
	}

	password := ask("Neues Passwort: ")
	if password == "" {
		log.Fatal("Passwort darf nicht leer sein")
	}
	// Am Terminal zweimal fragen (Tippfehler). Aus einer Pipe nur einmal.
	if isTerminal && ask("Passwort wiederholen: ") != password {
		log.Fatal("Die Passwörter stimmen nicht überein")
	}
	cfg := &authConfig{User: name, Hash: hashPassword(password), Secret: randomHex(32)}
	if err := saveAuth(cfg); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Benutzer „%s“ gespeichert in %s\n", name, authFile)
}

// Export für die Homepage – wie php/bin/export.php
func cmdExport(args []string) {
	push := false
	dir := homepageDir()
	for _, a := range args {
		if a == "--push" {
			push = true
		} else {
			dir = strings.TrimRight(a, "/")
		}
	}
	store := Store{dataFile}

	if push {
		if dir != homepageDir() {
			log.Fatal("--push geht nur mit dem eingestellten Ordner (data/homepage-path).")
		}
		r := publishHomepage(store)
		if r["ok"] != true {
			log.Fatalf("Fehlgeschlagen: %v", r["error"])
		}
		msg := "Keine Änderung"
		if r["changed"] == true {
			msg = "Neuer Stand committet"
		}
		if r["pushed"] == true {
			fmt.Printf("%s und gepusht (Branch %v).\n", msg, r["branch"])
		} else {
			fmt.Println(msg + ", nichts zu pushen.")
		}
		return
	}

	s, err := exportBlog(store, dir)
	if err != nil {
		log.Fatalf("%v\nAufruf: go run . export <Homepage-Ordner>", err)
	}
	for _, w := range s.Warnings {
		fmt.Fprintln(os.Stderr, "Warnung: "+w)
	}
	fmt.Printf("Exportiert nach %s\n", s.target)
	fmt.Printf("  %d veröffentlicht, %d Entwurf/Entwürfe (nur Titel), %d privat (nicht exportiert)\n", s.Published, s.Draft, s.Private)
	fmt.Printf("  Bilder: %d verwendet, %d neu kopiert, %d entfernt\n", s.Images, s.Copied, s.Removed)
	fmt.Println("\nVeröffentlichen (im Homepage-Ordner):")
	fmt.Println(`  git add blog-data/ && git commit -m "Blog aktualisiert" && git push`)
}
