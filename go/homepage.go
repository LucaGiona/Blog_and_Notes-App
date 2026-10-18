// Blog -> Homepage – Gegenstück zu php/src/Homepage.php.
//
// exportBlog():       schreibt die öffentlichen Artikel nach <Homepage>/blog-data/
// publishHomepage():  exportiert, committet NUR blog-data/ und pusht.
//
//   veröffentlicht + öffentlich -> vollständig
//   Entwurf + öffentlich        -> nur Titel, Datum, Themen
//   privat                      -> gar nicht

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	blogImage     = regexp.MustCompile(`uploads/([a-f0-9]{24}\.(?:jpg|png|webp|gif))`)
	blogImageFile = regexp.MustCompile(`^[a-f0-9]{24}\.(jpg|png|webp|gif)$`)
)

// Ist der Ordner brauchbar? Sonst Fehlermeldung, sonst "".
func homepageProblem(dir string) string {
	if dir == "" {
		return "Kein Homepage-Ordner eingestellt"
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return "Homepage-Ordner " + dir + " gibt es nicht"
	}
	// Nicht aus Versehen in den Blog selbst exportieren
	self, _ := filepath.Abs(rootDir)
	self, _ = filepath.EvalSymlinks(self)
	real, _ := filepath.EvalSymlinks(dir)
	if real == self || strings.HasPrefix(real+"/", self+"/") {
		return "Der Homepage-Ordner darf nicht im Blog-Ordner liegen"
	}
	return ""
}

// Ein Artikel, wie er auf der Homepage landet (Reihenfolge der Felder wie bei PHP)
type exportPost struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	Body      string `json:"body"`
	Tags      []any  `json:"tags"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type exportSummary struct {
	Published int      `json:"published"`
	Draft     int      `json:"draft"`
	Private   int      `json:"private"`
	Images    int      `json:"images"`
	Copied    int      `json:"copied"`
	Removed   int      `json:"removed"`
	Warnings  []string `json:"warnings"`
	target    string
}

func exportBlog(store Store, homepage string) (exportSummary, error) {
	sum := exportSummary{Warnings: []string{}}
	if p := homepageProblem(homepage); p != "" {
		return sum, errors.New(p)
	}
	sum.target = filepath.Join(homepage, "blog-data")
	targetUploads := filepath.Join(sum.target, "uploads")
	if err := os.MkdirAll(targetUploads, 0o755); err != nil {
		return sum, fmt.Errorf("Ordner %s kann nicht angelegt werden", targetUploads)
	}

	out := []exportPost{}
	images := map[string]bool{}
	for _, p := range store.List() {
		if !isPublic(p) {
			sum.Private++
			continue
		}
		isDraft := p["status"] != "published"
		body, _ := p["body"].(string)
		status := "published"
		if isDraft {
			sum.Draft++
			body, status = "", "draft"
		} else {
			sum.Published++
		}
		for _, m := range blogImage.FindAllStringSubmatch(body, -1) {
			images[m[1]] = true
		}
		tags, _ := p["tags"].([]any)
		if tags == nil {
			tags = []any{}
		}
		id, _ := p["id"].(string)
		title, _ := p["title"].(string)
		created, _ := p["createdAt"].(string)
		updated, _ := p["updatedAt"].(string)
		out = append(out, exportPost{id, title, status, body, tags, created, updated})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })

	// Bilder abgleichen: fehlende kopieren, nicht mehr benutzte entfernen
	names := make([]string, 0, len(images))
	for name := range images {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		from := filepath.Join(uploadDir, name)
		to := filepath.Join(targetUploads, name)
		src, err := os.Stat(from)
		if err != nil {
			sum.Warnings = append(sum.Warnings, "Bild "+name+" fehlt im Blog (uploads/) – übersprungen")
			continue
		}
		if dst, err := os.Stat(to); err != nil || dst.Size() != src.Size() {
			b, err := os.ReadFile(from)
			if err == nil {
				err = os.WriteFile(to, b, 0o644)
			}
			if err != nil {
				return sum, err
			}
			sum.Copied++
		}
	}
	sum.Images = len(images)
	entries, _ := os.ReadDir(targetUploads)
	for _, e := range entries {
		// Nur Dateien anfassen, die nach Blog-Bild aussehen
		if blogImageFile.MatchString(e.Name()) && !images[e.Name()] {
			os.Remove(filepath.Join(targetUploads, e.Name()))
			sum.Removed++
		}
	}

	file := filepath.Join(sum.target, "posts.json")
	if err := os.WriteFile(file, append(encodeJSON(out, true), '\n'), 0o644); err != nil {
		return sum, fmt.Errorf("%s kann nicht geschrieben werden", file)
	}
	return sum, nil
}

// Exportieren, committen (nur blog-data/) und pushen.
// Ergebnis landet auch in data/homepage-status.json (für die Anzeige in der App).
func publishHomepage(store Store) map[string]any {
	dir := homepageDir()
	result := map[string]any{"at": timestamp(), "ok": false, "changed": false, "pushed": false}
	err := func() error {
		sum, err := exportBlog(store, dir)
		if err != nil {
			return err
		}
		result["summary"] = sum

		head, _ := git(dir, publishTimeout, false, "rev-parse", "--abbrev-ref", "HEAD")
		result["branch"] = strings.TrimSpace(head.out)

		if _, err := git(dir, 20*time.Second, true, "add", "--", "blog-data"); err != nil {
			return err
		}
		// Hat sich in blog-data/ etwas geändert?
		diff, _ := git(dir, 20*time.Second, false, "diff", "--cached", "--quiet", "--", "blog-data")
		changed := diff.code != 0
		result["changed"] = changed
		if changed {
			// Pfadangabe: committet NUR blog-data/, auch wenn sonst noch etwas vorgemerkt ist
			if _, err := git(dir, 20*time.Second, true, "commit", "-m", "Blog aktualisiert", "--", "blog-data"); err != nil {
				return err
			}
		}
		// Pushen, wenn es etwas zu pushen gibt (auch ein früherer, gescheiterter Versuch)
		ahead, _ := git(dir, 20*time.Second, false, "rev-list", "--count", "@{u}..HEAD")
		if n, _ := strconv.Atoi(strings.TrimSpace(ahead.out)); ahead.code != 0 || n > 0 {
			if _, err := git(dir, publishTimeout, true, "push"); err != nil {
				return err
			}
			result["pushed"] = true
		}
		result["ok"] = true
		return nil
	}()
	if err != nil {
		result["error"] = err.Error()
	}
	os.WriteFile(homepageStatusFile, encodeJSON(result, true), 0o644)
	return result
}

// Letzter Stand fürs Anzeigen in der App
func homepageStatus() map[string]any {
	var last any
	if b, err := os.ReadFile(homepageStatusFile); err == nil {
		var m map[string]any
		if json.Unmarshal(b, &m) == nil && len(m) > 0 {
			last = m
		}
	}
	return map[string]any{"configured": homepageProblem(homepageDir()) == "", "last": last}
}

type gitResult struct {
	code     int
	out, err string
}

// git im Homepage-Ordner ausführen – ohne Shell und ohne Rückfragen:
// fehlt ein Passwort, scheitert git sofort statt zu warten.
func git(dir string, timeout time.Duration, mustWork bool, args ...string) (gitResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_SSH_COMMAND=ssh -o BatchMode=yes", "LC_ALL=C")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	runErr := cmd.Run()

	res := gitResult{0, stdout.String(), stderr.String()}
	if ctx.Err() == context.DeadlineExceeded {
		return res, fmt.Errorf("git %s hat zu lange gedauert (keine Verbindung?)", args[0])
	}
	if runErr != nil {
		var exit *exec.ExitError
		if errors.As(runErr, &exit) {
			res.code = exit.ExitCode()
		} else {
			res.code = -1
			res.err = runErr.Error()
		}
	}
	if mustWork && res.code != 0 {
		// Erste aussagekräftige Zeile reicht für die Anzeige in der App
		text := res.err
		if strings.TrimSpace(text) == "" {
			text = res.out
		}
		msg := "Fehlercode " + strconv.Itoa(res.code)
		for _, line := range strings.Split(text, "\n") {
			if line = strings.TrimSpace(line); line != "" {
				msg = strings.TrimPrefix(strings.TrimPrefix(line, "fatal: "), "error: ")
				break
			}
		}
		return res, fmt.Errorf("git %s: %s", args[0], substr(msg, 160))
	}
	return res, nil
}
