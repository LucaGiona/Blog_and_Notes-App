// Bild-Upload – Gegenstück zu php/src/Uploads.php.
//
// - Der Dateityp wird am INHALT erkannt, nicht an der Endung.
// - Der Dateiname wird zufällig erzeugt – nie der vom Browser.
// - JPG und PNG werden neu gespeichert (dabei fallen Metadaten wie der GPS-Ort weg)
//   und auf maxImageSide verkleinert. GIF bleibt unverändert (Animationen).
// - WebP kann die Go-Standardbibliothek nicht schreiben: Es wird am Inhalt geprüft
//   und unverändert übernommen. Der Browser hat es vorher schon verkleinert und ohne
//   Metadaten neu erzeugt (js/image.js) – genau wie PHP ohne GD.

package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var imageTypes = map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}

var uploadName = regexp.MustCompile(`^[a-f0-9]{24}\.(jpg|png|webp|gif)$`)

func handleUpload(w http.ResponseWriter, r *http.Request) {
	// Eigener Header: fremde Webseiten können ihn nicht ohne Weiteres mitschicken (CSRF-Schutz)
	if r.Header.Get("X-Notizblog") != "1" {
		fail(400, "Ungültige Anfrage")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+1024*1024)
	file, header, err := r.FormFile("image")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(413, "Bild zu groß (max. "+strconv.Itoa(maxUploadBytes/1024/1024)+" MB)")
		}
		fail(413, "Kein Bild empfangen – evtl. zu groß für den Server")
	}
	defer file.Close()
	if header.Size > maxUploadBytes {
		fail(413, "Bild zu groß (max. "+strconv.Itoa(maxUploadBytes/1024/1024)+" MB)")
	}
	data, err := io.ReadAll(file)
	if err != nil {
		fail(400, "Upload fehlgeschlagen")
	}

	mime := sniffImage(data)
	ext, ok := imageTypes[mime]
	if !ok {
		fail(415, "Nur JPG, PNG, WebP oder GIF")
	}
	width, height, err := imageSize(data, mime)
	if err != nil {
		fail(415, "Bild ist beschädigt oder wird nicht unterstützt")
	}
	if width*height > maxImagePixels {
		fail(413, "Bild hat zu viele Pixel")
	}

	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		panic(err)
	}
	name := randomHex(12) + "." + ext
	target := filepath.Join(uploadDir, name)

	out := data
	if mime == "image/jpeg" || mime == "image/png" {
		if out, err = reencode(data, mime); err != nil {
			fail(415, "Bild ist beschädigt oder wird nicht unterstützt")
		}
	}
	if err := os.WriteFile(target, out, 0o644); err != nil {
		panic(err)
	}
	reply(201, map[string]any{"url": "uploads/" + name})
}

// Bildtyp am Inhalt erkennen (die ersten Bytes jedes Formats)
func sniffImage(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF}):
		return "image/jpeg"
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(b, []byte("GIF87a")), bytes.HasPrefix(b, []byte("GIF89a")):
		return "image/gif"
	case len(b) > 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "image/webp"
	}
	return ""
}

func imageSize(b []byte, mime string) (int, int, error) {
	if mime == "image/webp" {
		return webpSize(b)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
	return cfg.Width, cfg.Height, err
}

// Breite/Höhe aus dem WebP-Kopf lesen (VP8 verlustbehaftet, VP8L verlustfrei, VP8X erweitert)
func webpSize(b []byte) (int, int, error) {
	bad := errors.New("kein gültiges WebP")
	if len(b) < 30 {
		return 0, 0, bad
	}
	chunk := string(b[12:16])
	switch chunk {
	case "VP8 ":
		if b[23] != 0x9d || b[24] != 0x01 || b[25] != 0x2a {
			return 0, 0, bad
		}
		w := int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff)
		h := int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff)
		return w, h, nil
	case "VP8L":
		if b[20] != 0x2f {
			return 0, 0, bad
		}
		bits := binary.LittleEndian.Uint32(b[21:25])
		return int(bits&0x3fff) + 1, int(bits>>14&0x3fff) + 1, nil
	case "VP8X":
		w := int(b[24]) | int(b[25])<<8 | int(b[26])<<16
		h := int(b[27]) | int(b[28])<<8 | int(b[29])<<16
		return w + 1, h + 1, nil
	}
	return 0, 0, bad
}

// JPG/PNG neu speichern, dabei auf maxImageSide verkleinern
func reencode(data []byte, mime string) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	b := img.Bounds()
	if longest := max(b.Dx(), b.Dy()); longest > maxImageSide {
		scale := float64(maxImageSide) / float64(longest)
		img = shrink(img, max(1, int(float64(b.Dx())*scale+0.5)), max(1, int(float64(b.Dy())*scale+0.5)))
	}
	var buf bytes.Buffer
	if mime == "image/jpeg" {
		err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85})
	} else {
		err = png.Encode(&buf, img) // Transparenz bleibt erhalten
	}
	return buf.Bytes(), err
}

// Verkleinern durch Mitteln der Pixel (Flächenmittel) – sieht deutlich besser aus
// als einfaches Weglassen von Pixeln. Nur Standardbibliothek.
func shrink(src image.Image, w, h int) image.Image {
	b := src.Bounds()
	rgba := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(rgba, rgba.Bounds(), src, b.Min, draw.Src)

	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	sx := float64(b.Dx()) / float64(w)
	sy := float64(b.Dy()) / float64(h)
	for y := 0; y < h; y++ {
		y0, y1 := int(float64(y)*sy), max(int(float64(y+1)*sy), int(float64(y)*sy)+1)
		for x := 0; x < w; x++ {
			x0, x1 := int(float64(x)*sx), max(int(float64(x+1)*sx), int(float64(x)*sx)+1)
			var r, g, bl, a, n uint32
			for yy := y0; yy < y1 && yy < b.Dy(); yy++ {
				i := rgba.PixOffset(x0, yy)
				for xx := x0; xx < x1 && xx < b.Dx(); xx++ {
					r += uint32(rgba.Pix[i])
					g += uint32(rgba.Pix[i+1])
					bl += uint32(rgba.Pix[i+2])
					a += uint32(rgba.Pix[i+3])
					n++
					i += 4
				}
			}
			if n > 0 {
				dst.SetRGBA(x, y, color.RGBA{uint8(r / n), uint8(g / n), uint8(bl / n), uint8(a / n)})
			}
		}
	}
	return dst
}

// Bild löschen – nur wenn KEIN Artikel es mehr verwendet, sonst 409
func handleUploadDelete(name string, store Store) {
	// Nur Namen, wie der Server sie selbst vergibt (verhindert z. B. "../data/auth.json")
	if !uploadName.MatchString(name) {
		fail(400, "Ungültiger Dateiname")
	}
	for _, p := range store.List() {
		body, _ := p["body"].(string)
		if strings.Contains(body, "uploads/"+name) {
			title, _ := p["title"].(string)
			fail(409, "Bild wird noch in „"+title+"“ verwendet")
		}
	}
	file := filepath.Join(uploadDir, name)
	if _, err := os.Stat(file); err != nil {
		fail(404, "Nicht gefunden")
	}
	if err := os.Remove(file); err != nil {
		panic(err)
	}
	reply(204, nil)
}
