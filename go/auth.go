// Login für genau einen Benutzer – Gegenstück zu php/src/Auth.php.
//
// - Passwort-Hash in data/auth.json im Format pbkdf2-sha256$<Runden>$<Salz>$<Hash>
//   (base64). Dasselbe Format schreibt und liest PHP.
// - Nach dem Login ein signiertes Cookie "name.ablaufzeit.signatur" (HMAC-SHA256) –
//   gleich wie in PHP, ein Cookie gilt also für beide Backends.

package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const pbkdf2Rounds = 600_000

type authConfig struct {
	User   string `json:"user"`
	Hash   string `json:"hash"`
	Secret string `json:"secret"`
}

// Bei jeder Anfrage neu lesen – wie PHP: neues Passwort oder „Alle Geräte abmelden“
// wirken sofort, ohne Neustart.
func loadAuth() *authConfig {
	b, err := os.ReadFile(authFile)
	if err != nil {
		return nil
	}
	var cfg authConfig
	if json.Unmarshal(b, &cfg) != nil || cfg.User == "" || cfg.Hash == "" || cfg.Secret == "" {
		return nil
	}
	return &cfg
}

func saveAuth(cfg *authConfig) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	tmp := authFile + ".tmp"
	if err := os.WriteFile(tmp, encodeJSON(cfg, true), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, authFile)
}

// ---------- Passwort-Hash (PBKDF2-SHA256, nur Standardbibliothek) ----------

func pbkdf2(password, salt []byte, rounds, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	var out []byte
	for block := uint32(1); len(out) < keyLen; block++ {
		prf.Reset()
		prf.Write(salt)
		var n [4]byte
		binary.BigEndian.PutUint32(n[:], block)
		prf.Write(n[:])
		u := prf.Sum(nil)
		t := append([]byte(nil), u...)
		for i := 1; i < rounds; i++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(u[:0])
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

func hashPassword(password string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	hash := pbkdf2([]byte(password), salt, pbkdf2Rounds, 32)
	return "pbkdf2-sha256$" + strconv.Itoa(pbkdf2Rounds) + "$" +
		base64.StdEncoding.EncodeToString(salt) + "$" + base64.StdEncoding.EncodeToString(hash)
}

// errOldHash: auth.json stammt noch aus der Zeit mit bcrypt (nur PHP)
type errOldHash struct{}

func (errOldHash) Error() string { return "old hash" }

func verifyPassword(password, stored string) (bool, error) {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		if strings.HasPrefix(stored, "$2") {
			return false, errOldHash{}
		}
		return false, nil
	}
	rounds, err := strconv.Atoi(parts[1])
	salt, err2 := base64.StdEncoding.DecodeString(parts[2])
	want, err3 := base64.StdEncoding.DecodeString(parts[3])
	if err != nil || err2 != nil || err3 != nil || rounds < 1 {
		return false, nil
	}
	got := pbkdf2([]byte(password), salt, rounds, len(want))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// ---------- Cookie ----------

func sign(cfg *authConfig, payload string) string {
	m := hmac.New(sha256.New, []byte(cfg.Secret))
	m.Write([]byte(payload))
	return hex.EncodeToString(m.Sum(nil))
}

func setCookie(w http.ResponseWriter, r *http.Request, value string, expires time.Time, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: value, Path: "/",
		Expires: expires, MaxAge: maxAge,
		Secure: isHTTPS(r), HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}

// remember = true  -> Cookie bleibt 30 Tage (eigene Geräte)
// remember = false -> Sitzungs-Cookie, serverseitig spätestens nach 12 Stunden ungültig
func setSession(w http.ResponseWriter, r *http.Request, cfg *authConfig, remember bool) {
	length := shortSessionLength
	if remember {
		length = sessionLength
	}
	exp := time.Now().Add(length)
	payload := cfg.User + "." + strconv.FormatInt(exp.Unix(), 10)
	var expires time.Time
	if remember {
		expires = exp
	}
	setCookie(w, r, payload+"."+sign(cfg, payload), expires, 0)
}

func clearSession(w http.ResponseWriter, r *http.Request) {
	setCookie(w, r, "", time.Unix(0, 0), -1)
}

// Angemeldeter Benutzer oder ""
func currentUser(r *http.Request) string {
	cfg := loadAuth()
	if cfg == nil {
		return ""
	}
	c, err := r.Cookie(cookieName)
	if err != nil {
		return ""
	}
	parts := strings.Split(c.Value, ".")
	if len(parts) != 3 {
		return ""
	}
	user, exp, sig := parts[0], parts[1], parts[2]
	if !hmac.Equal([]byte(sign(cfg, user+"."+exp)), []byte(sig)) {
		return ""
	}
	n, err := strconv.ParseInt(exp, 10, 64)
	if err != nil || strings.Trim(exp, "0123456789") != "" || n < time.Now().Unix() || user != cfg.User {
		return ""
	}
	return user
}

// Ohne Login -> 401
func requireAuth(r *http.Request) {
	if currentUser(r) == "" {
		fail(401, "Nicht angemeldet")
	}
}

// ---------- Routen ----------

func handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if tooManyFails(ip) {
		fail(429, "Zu viele Versuche. Bitte später erneut.")
	}
	in := readJSONBody(r, 4096)
	name := strings.ToLower(strings.TrimSpace(str(in, "name")))
	password := str(in, "password")
	remember := isTrue(in, "remember")

	cfg := loadAuth()
	ok := false
	if cfg != nil {
		// Beides immer prüfen – verrät nichts darüber, ob der Name stimmt
		passOk, err := verifyPassword(password, cfg.Hash)
		if _, old := err.(errOldHash); old {
			fail(500, "Passwort im alten Format (bcrypt) – bitte neu setzen: go run . passwd <name>")
		}
		userOk := subtle.ConstantTimeCompare([]byte(cfg.User), []byte(name)) == 1
		ok = passOk && userOk
	}
	if !ok {
		addFail(ip)
		time.Sleep(500 * time.Millisecond) // bremst Rate-Versuche
		fail(401, "Name oder Passwort falsch")
	}
	clearFails(ip)
	setSession(w, r, cfg, remember)
	reply(200, map[string]any{"loggedIn": true, "name": cfg.User, "remember": remember})
}

// Alle Geräte abmelden: neues Secret -> jedes bisher ausgegebene Cookie ist ungültig
func handleLogoutAll(w http.ResponseWriter, r *http.Request) {
	requireAuth(r)
	cfg := loadAuth()
	cfg.Secret = randomHex(32)
	if err := saveAuth(cfg); err != nil {
		panic(err)
	}
	clearSession(w, r)
	reply(200, map[string]any{"loggedIn": false})
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ---------- Schutz vor Durchprobieren ----------
// Gleiche Datei und gleiches Format wie PHP (data/login-fails.json).

func withFails(fn func(map[string][]int64) map[string][]int64) {
	os.MkdirAll(dataDir, 0o755)
	f, err := os.OpenFile(failsFile, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		fn(map[string][]int64{}) // nicht beschreibbar -> ohne Sperre weiter
		return
	}
	defer f.Close()
	syscall.Flock(int(f.Fd()), syscall.LOCK_EX)
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)

	raw, _ := io.ReadAll(f)
	all := map[string][]int64{}
	json.Unmarshal(raw, &all) // PHP schreibt bei leerer Liste "[]" -> bleibt leer

	cut := time.Now().Add(-failWindow).Unix()
	for ip, times := range all {
		var keep []int64
		for _, t := range times {
			if t > cut {
				keep = append(keep, t)
			}
		}
		if len(keep) == 0 {
			delete(all, ip)
		} else {
			all[ip] = keep
		}
	}
	all = fn(all)
	f.Truncate(0)
	f.Seek(0, 0)
	if len(all) == 0 {
		f.Write([]byte("[]"))
	} else {
		f.Write(encodeJSON(all, false))
	}
}

func tooManyFails(ip string) bool {
	too := false
	withFails(func(all map[string][]int64) map[string][]int64 {
		too = len(all[ip]) >= maxFails
		return all
	})
	return too
}

func addFail(ip string) {
	withFails(func(all map[string][]int64) map[string][]int64 {
		all[ip] = append(all[ip], time.Now().Unix())
		return all
	})
}

func clearFails(ip string) {
	withFails(func(all map[string][]int64) map[string][]int64 {
		delete(all, ip)
		return all
	})
}
