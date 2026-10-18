// Artikel beim Scrollen einblenden: Sie steigen ruhig von unten auf.
//
// Ablauf: Jedes Element bekommt .reveal (unsichtbar, etwas tiefer).
// Sobald es ins Bild scrollt, kommt .is-in dazu -> CSS-Übergang zum Normalzustand.
// Elemente, die gleichzeitig sichtbar werden (z. B. beim Laden), kommen leicht nacheinander.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function revealOnScroll(elements) {
  if (reduceMotion.matches || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(entries => {
    let delay = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      el.style.transitionDelay = `${delay}ms`;
      el.classList.add('is-in');
      delay += 90;
      observer.unobserve(el);
      // Verzögerung danach entfernen, sonst reagiert z. B. Hover träge
      el.addEventListener('transitionend', () => { el.style.transitionDelay = ''; }, { once: true });
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

  elements.forEach(el => {
    el.classList.add('reveal');
    observer.observe(el);
  });
}
