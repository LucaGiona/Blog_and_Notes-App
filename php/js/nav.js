// Navigation oben rechts – hängt vom Anmeldestatus ab.
// Besucher sehen hier nichts: Der Login ist nur über …/#/admin erreichbar
// (bzw. in der installierten App über „Anmelden“ im Footer).
//
// Auf schmalen Bildschirmen (Handy) werden die Knöpfe in ein Burger-Menü gepackt.
// Ob Burger oder Knöpfe nebeneinander, entscheidet allein das CSS (@media).

import { auth } from './auth.js';

const ICON_MENU = `<svg class="icon-open" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;
const ICON_CLOSE = `<svg class="icon-close" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

let closeMenu = () => {};

export function renderNav(nav, { onLogout }) {
  closeMenu();

  const items = [];
  if (auth.local || auth.loggedIn) items.push(`<a href="#/new" class="btn btn-primary">+ Neu</a>`);
  if (auth.loggedIn && !auth.local) items.push(`<button type="button" class="btn btn-ghost" data-action="logout">Abmelden</button>`);

  if (items.length === 0) {
    nav.innerHTML = '';
    return;
  }

  nav.innerHTML = `
    <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="nav-menu" aria-label="Menü öffnen">
      ${ICON_MENU}${ICON_CLOSE}
    </button>
    <div class="nav-menu" id="nav-menu">${items.join('')}</div>`;

  const toggle = nav.querySelector('.nav-toggle');

  const setOpen = open => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open);
    toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
    // Symbol ☰ / ✕ wechselt per CSS – nicht per innerHTML, sonst wäre das
    // angeklickte Element danach weg und „Klick daneben“ würde fälschlich greifen
  };
  closeMenu = () => setOpen(false);

  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));

  // Klick auf einen Menüpunkt schließt das Menü
  nav.querySelector('.nav-menu').addEventListener('click', e => {
    if (e.target.closest('a, button')) closeMenu();
  });
  nav.querySelector('[data-action="logout"]')?.addEventListener('click', onLogout);
}

// Menü schließen: Klick daneben, Escape, Seitenwechsel
document.addEventListener('click', e => {
  if (!e.composedPath().some(el => el.id === 'nav')) closeMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenu();
});
window.addEventListener('hashchange', () => closeMenu());
