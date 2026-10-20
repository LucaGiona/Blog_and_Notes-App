// Kleine Helfer, die von mehreren Views genutzt werden.

// Schützt vor HTML-Injection, wenn Nutzertext ins innerHTML kommt
export function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

// „20.10.2026, 09:17“ – mit Uhrzeit, z. B. für „angelegt“ / „bearbeitet“
export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Zeitpunkt, nach dem sortiert wird bzw. der am Punkt im Zeitstrahl steht
export const sortTime = (post, by) => (by === 'updated' ? post.updatedAt : post.createdAt) || post.updatedAt || '';

// Zwei Zeitpunkte in derselben Minute? (dann ist „bearbeitet“ nicht der Rede wert)
export const sameMinute = (a, b) => !!a && !!b && a.slice(0, 16) === b.slice(0, 16);

export function excerpt(text = '', length = 220) {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > length ? clean.slice(0, length) + ' …' : clean;
}

// Absätze aus Leerzeilen machen
export function paragraphs(text = '') {
  return text
    .split(/\n{2,}/)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Funktion erst ausführen, wenn eine Weile Ruhe ist (für Autosave)
export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}
