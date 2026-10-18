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
