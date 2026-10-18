// Kleiner Markdown-Renderer – nur das, was der Blog braucht.
//
// Sicherheit: Jeder Text wird ZUERST escaped, danach werden nur bekannte
// Muster in HTML umgewandelt. Eigenes HTML im Artikel wird also nie ausgeführt.
//
// Unterstützt:
//   # Überschrift (## und ### auch)
//   **fett**  *kursiv*  `code`  [Link](https://…)  ![Bild](uploads/…)
//   - Liste / 1. Liste
//   > Zitat
//   ```js           <- Code-Block mit Sprache (optional)
//   …
//   ```
//   Leerzeile = neuer Absatz

import { escapeHtml } from './utils.js';

// ---------- Blöcke ----------

export function renderMarkdown(text = '') {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code-Block ``` … ```
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++; // schließendes ```
      out.push(codeBlock(code.join('\n'), fence[1]));
      continue;
    }

    // Leerzeile
    if (!line.trim()) { i++; continue; }

    // Überschrift
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const level = h[1].length + 1; // # -> h2, weil h1 der Artikeltitel ist
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Zitat
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
      continue;
    }

    // Liste (- * oder 1.)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const itemRe = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/; // Listenart wechselt -> neue Liste
      const items = [];
      while (i < lines.length && itemRe.test(lines[i])) {
        items.push(`<li>${inline(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`);
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Absatz: alles bis zur nächsten Leerzeile oder zum nächsten Block
    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
    const html = para.map(inline).join('<br>');
    // Ein Bild allein im Absatz -> als Abbildung, nicht als Text
    out.push(/^<img [^>]+>$/.test(html) ? `<figure>${html}</figure>` : `<p>${html}</p>`);
  }

  return out.join('\n');
}

function isBlockStart(line) {
  return /^\s*```/.test(line) || /^#{1,3}\s/.test(line) || /^>/.test(line) || /^\s*([-*]|\d+\.)\s+/.test(line);
}

function codeBlock(code, lang) {
  return `
    <div class="code-block">
      <div class="code-head">
        <span class="code-lang">${escapeHtml(lang || 'code')}</span>
        <button type="button" class="code-copy" data-copy aria-label="Code kopieren" title="Kopieren">${ICON_COPY}</button>
      </div>
      <pre><code>${escapeHtml(code)}</code></pre>
    </div>`;
}

// Icons als Inline-SVG (Strichstärke/Farbe kommen aus dem CSS über currentColor)
const ICON_COPY = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>`;

// ---------- Inline ----------

// Nur diese Adressen sind erlaubt – verhindert z. B. "javascript:"-Links
const SAFE_IMG = /^(uploads\/[\w.-]+|https:\/\/[^\s"]+)$/;
const SAFE_LINK = /^(https?:\/\/[^\s"]+|mailto:[^\s"]+|#[\w/-]*)$/;

function inline(raw) {
  // Fertige HTML-Stücke parken, damit spätere Regeln (z. B. _kursiv_) sie
  // nicht verändern – etwa Unterstriche in einer Bild-Adresse.
  const parked = [];
  const park = html => `\u0000${parked.push(html) - 1}\u0000`;

  // 1. Inline-Code herausnehmen, damit darin nichts umgewandelt wird
  let s = raw.replace(/`([^`]+)`/g, (_, c) => park(`<code>${escapeHtml(c)}</code>`));

  // 2. Rest escapen
  s = escapeHtml(s);

  // 3. Bilder ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) =>
    SAFE_IMG.test(url) ? park(`<img src="${url}" alt="${alt}" loading="lazy">`) : m);

  // 4. Links [text](url) – der Text darf fett/kursiv sein, die Tags werden geparkt
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) =>
    SAFE_LINK.test(url)
      ? park(`<a href="${url}" target="_blank" rel="noopener noreferrer">`) + label + park('</a>')
      : m);

  // 5. Fett und kursiv
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');

  // 6. Geparkte Stücke zurücksetzen
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => parked[n]);
}

// ---------- Wo stehen Bilder und Code-Blöcke im Text? ----------
// Für die Löschen-Knöpfe in der Editor-Vorschau: Das n-te Bild in der Vorschau
// gehört zum n-ten Eintrag in `images`. Dafür gelten genau dieselben Regeln wie
// beim Anzeigen (Bilder in Code-Blöcken oder `code` zählen nicht mit).
// Ergebnis: { images: [{ start, end, url }], codes: [{ start, end }] }
// start/end sind Zeichenpositionen im Text.

export function findBlocks(text = '') {
  text = text.replace(/\r\n?/g, '\n');
  const images = [];
  const codes = [];
  const lines = text.split('\n');
  let pos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*```\s*([\w+-]*)\s*$/.test(line)) {
      // Code-Block: von der öffnenden bis einschließlich der schließenden Zeile
      const start = pos;
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) j++;
      const lastLine = Math.min(j, lines.length - 1);
      let end = start;
      for (let k = i; k <= lastLine; k++) end += lines[k].length + 1;
      codes.push({ start, end: Math.min(end, text.length) });
      pos = end;
      i = lastLine;
      continue;
    }

    // Inline-Code ausblenden (gleiche Länge, damit Positionen stimmen)
    const visible = line.replace(/`[^`]+`/g, s => ' '.repeat(s.length));
    for (const match of visible.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      if (SAFE_IMG.test(match[2])) {
        images.push({ start: pos + match.index, end: pos + match.index + match[0].length, url: match[2] });
      }
    }
    pos += line.length + 1;
  }
  return { images, codes };
}

// Ein Stück aus dem Text entfernen. Steht es allein in seiner Zeile (Bild als
// eigener Absatz, Code-Block), werden überzählige Leerzeilen mit entfernt.
export function cutBlock(text, { start, end }) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const ownLine = (start === 0 || before.endsWith('\n')) && (end >= text.length || after.startsWith('\n') || text[end - 1] === '\n');
  if (!ownLine) return (before + after).replace(/ {2,}/g, ' ');
  const head = before.replace(/\n+$/, '');
  const tail = after.replace(/^\n+/, '');
  return head && tail ? `${head}\n\n${tail}` : head || tail;
}

// ---------- Für die Vorschau in der Liste: Markdown-Zeichen entfernen ----------

export function plainText(text = '') {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ')      // Code-Blöcke weg
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')     // Bilder weg
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')   // Links -> nur Text
    .replace(/^#{1,3}\s+|^>\s?|^\s*([-*]|\d+\.)\s+/gm, '')
    .replace(/[*_`]/g, '');
}

// ---------- Kopieren-Buttons ----------
// Einmal pro Container aufrufen; funktioniert für alle Code-Blöcke darin.

export function enableCopyButtons(container) {
  container.addEventListener('click', async e => {
    const button = e.target.closest('[data-copy]');
    if (!button) return;
    const code = button.closest('.code-block').querySelector('code').textContent;
    const ok = await copyText(code);
    button.innerHTML = ok ? ICON_CHECK : ICON_COPY;
    button.title = ok ? 'Kopiert' : 'Kopieren fehlgeschlagen';
    button.classList.toggle('is-done', ok);
    clearTimeout(button._reset);
    button._reset = setTimeout(() => {
      button.innerHTML = ICON_COPY;
      button.title = 'Kopieren';
      button.classList.remove('is-done');
    }, 1500);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback, z. B. ohne HTTPS im WLAN (http://192.168…): Clipboard-API ist dort gesperrt
    const area = Object.assign(document.createElement('textarea'), { value: text });
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
