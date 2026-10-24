// Hell / Dunkel
//
// Wird im <head> OHNE defer und ohne type="module" geladen: So steht data-theme auf <html>,
// bevor die Seite gezeichnet wird – kein kurzes helles Aufblitzen im dunklen Modus.
//
// Standard ist DUNKEL. Wer umschaltet, dessen Wahl merkt sich jedes Gerät (localStorage
// „notizblog.theme“), auch über Tabs hinweg. Die Farben stehen in css/style.css
// (:root = hell, :root[data-theme="dark"] = dunkel).
//
// Knöpfe mit dem Attribut data-theme-toggle schalten um (Laptop: Icon in der Kopfzeile,
// Handy: im Burger-Menü). nav.js zeichnet sie, das Umschalten passiert hier.
(() => {
  const KEY = 'notizblog.theme';
  const COLORS = { light: '#faf8f4', dark: '#171614' }; // = --bg, für die Statusleiste
  const root = document.documentElement;

  const stored = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };

  function apply(theme) {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme]);
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.setAttribute('aria-pressed', theme === 'dark');
    });
  }

  function set(theme) {
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* privates Fenster: gilt nur jetzt */ }
  }

  apply(stored() === 'light' ? 'light' : 'dark');

  // Für nav.js: aktuellen Stand abfragen (Knöpfe richtig zeichnen)
  window.notizblogTheme = { get: () => root.dataset.theme, set };

  document.addEventListener('click', e => {
    if (e.target.closest('[data-theme-toggle]')) set(root.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  // Anderer Tab hat umgeschaltet -> hier auch
  window.addEventListener('storage', e => {
    if (e.key === KEY) apply(e.newValue === 'light' ? 'light' : 'dark');
  });
  // Meta-Tag steht erst nach dem Parsen fest im DOM -> Farbe nochmal setzen
  document.addEventListener('DOMContentLoaded', () => apply(root.dataset.theme));
})();
