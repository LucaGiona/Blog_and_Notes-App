// Einstellungen – dieselben wie in php/src/config.php. Dateiformate sind gleich:
// Mit NOTIZBLOG_DATA / NOTIZBLOG_UPLOADS können PHP und Go dieselben Daten benutzen.

package main

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	sessionLength      = 30 * 24 * time.Hour // „Angemeldet bleiben“: 30 Tage
	shortSessionLength = 12 * time.Hour      // ohne Haken: max. 12 Stunden
	maxFails           = 5                   // Fehlversuche pro IP …
	failWindow         = 15 * time.Minute    // … in diesem Zeitraum
	maxBodyBytes       = 1024 * 1024         // 1 MB pro Anfrage
	cookieName         = "notizblog_session"
	maxUploadBytes     = 10 * 1024 * 1024 // 10 MB pro Bild
	maxImageSide       = 2000             // längste Seite in Pixeln
	maxImagePixels     = 40_000_000       // schützt den Speicher
	publishTimeout     = 45 * time.Second // git push, danach Abbruch
)

// Pfade. Wie bei PHP per Umgebungsvariable änderbar.
var (
	rootDir   = envOr("NOTIZBLOG_ROOT", ".") // Ordner mit index.html, css/, js/ …
	dataDir   = envOr("NOTIZBLOG_DATA", filepath.Join(rootDir, "data"))
	uploadDir = envOr("NOTIZBLOG_UPLOADS", filepath.Join(rootDir, "uploads"))

	dataFile           = filepath.Join(dataDir, "posts.json")
	authFile           = filepath.Join(dataDir, "auth.json")
	failsFile          = filepath.Join(dataDir, "login-fails.json")
	homepagePathFile   = filepath.Join(dataDir, "homepage-path")
	homepageStatusFile = filepath.Join(dataDir, "homepage-status.json")
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Homepage-Ordner für „Auf Homepage veröffentlichen“. Bei jeder Anfrage neu gelesen –
// wie in PHP: Datei data/homepage-path anlegen oder löschen wirkt ohne Neustart.
func homepageDir() string {
	dir := os.Getenv("NOTIZBLOG_HOMEPAGE")
	if dir == "" {
		if b, err := os.ReadFile(homepagePathFile); err == nil {
			dir = strings.TrimSpace(string(b))
		}
	}
	return strings.TrimRight(dir, "/")
}
