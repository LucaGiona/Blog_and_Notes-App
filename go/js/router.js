// Minimaler Hash-Router: #/  #/new  #/edit/:id  #/post/:id

export function createRouter(routes, onRoute) {
  let cleanup = null;

  // silent = nur neu zeichnen (z. B. weil ein anderes Gerät etwas geändert hat):
  // kein Hochscrollen, kein onRoute
  async function resolve(silent = false) {
    const path = location.hash.slice(1) || '/';

    for (const [pattern, handler] of routes) {
      const match = path.match(pattern);
      if (match) {
        cleanup?.();
        cleanup = (await handler(...match.slice(1))) ?? null;
        if (silent !== true) onRoute?.(path);
        return;
      }
    }
    location.hash = '#/'; // Unbekannte Route -> Startseite
  }

  window.addEventListener('hashchange', () => resolve());
  return { start: () => resolve(), refresh: () => resolve(true) };
}
