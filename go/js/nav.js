// Navigation oben rechts – hängt vom Anmeldestatus ab.
// Besucher sehen hier nichts: Der Login ist nur über …/#/admin erreichbar
// (bzw. in der installierten App über „Anmelden“ im Footer).
//
// Auf schmalen Bildschirmen (Handy) werden die Knöpfe in ein Burger-Menü gepackt.
// Ob Burger oder Knöpfe nebeneinander, entscheidet allein das CSS (@media).
//
// Angemeldet gibt es außerdem „Status“ (Online/Offline, wartende Änderungen, Reihenfolge,
// Homepage, Alle Geräte abmelden): am Laptop als Knopf „● Online ▾“ mit aufklappendem Feld,
// auf dem Handy unten im Burger-Menü. Gefüllt werden beide von main.js (data-status-box).

import { auth } from './auth.js';

const ICON_MENU = `<svg class="icon-open" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;
const ICON_CLOSE = `<svg class="icon-close" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

const ICON_MOON = `<svg class="icon-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`;
const ICON_SUN = `<svg class="icon-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;

// Hell/Dunkel (umgeschaltet wird in js/theme.js). Icon zeigt, wohin es geht: Mond = dunkel machen.
const isDark = () => (window.notizblogTheme?.get() ?? 'dark') === 'dark';
const themeIcon = hasMenu => `
  <button type="button" class="theme-toggle${hasMenu ? ' has-menu' : ''}" data-theme-toggle
    aria-pressed="${isDark()}" aria-label="Dunkler Modus" title="Hell / Dunkel">${ICON_MOON}${ICON_SUN}</button>`;
const themeMenuItem = () => `
  <button type="button" class="btn nav-theme" data-theme-toggle data-keep-open aria-pressed="${isDark()}">
    ${ICON_MOON}${ICON_SUN}<span class="label-dark">Dunkel</span><span class="label-light">Hell</span></button>`;

let closeMenu = () => {};
let closeStatus = () => {};
let last = null;      // zuletzt gezeichnete Navigation (für setMenuExtras)
let extras = [];      // Zusatzpunkte der aktuellen Seite, z. B. im Editor „＋ Bild“, „{ } Block“

/**
 * Seitenabhängige Punkte im Burger-Menü (nur auf dem Handy sichtbar, am Laptop
 * stehen sie auf der Seite selbst). items = [{ label, onClick }], [] = keine.
 */
export function setMenuExtras(items) {
  extras = items;
  if (last) renderNav(...last);
}

export function renderNav(nav, { onLogout, onRender }) {
  last = [nav, { onLogout, onRender }];
  closeMenu();
  closeStatus();

  const items = [];
  if (auth.local || auth.loggedIn) items.push(`<a href="#/new" class="btn btn-primary">+ Neu</a>`);
  if (auth.loggedIn && !auth.local) items.push(`<button type="button" class="btn btn-ghost" data-action="logout">Abmelden</button>`);

  if (items.length === 0) {
    // Besucher: kein Menü, nur Hell/Dunkel
    nav.innerHTML = themeIcon(false);
    closeMenu = () => {};
    return;
  }

  const showStatus = auth.loggedIn && !auth.local;

  nav.innerHTML = `${showStatus ? `
    <div class="status-wrap">
      <button type="button" class="status-btn" aria-expanded="false" aria-controls="status-panel" title="Status und Einstellungen">
        <span class="status-dot" aria-hidden="true"></span><span class="status-label">Status</span><span class="status-caret" aria-hidden="true"></span>
      </button>
      <div class="status-panel" id="status-panel" data-status-box aria-live="polite" hidden></div>
    </div>` : ''}
    ${themeIcon(true)}
    <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="nav-menu" aria-label="Menü öffnen">
      ${ICON_MENU}${ICON_CLOSE}
    </button>
    <div class="nav-menu" id="nav-menu">${extras.length ? `
      <div class="nav-extra">${extras.map((x, i) =>
        `<button type="button" class="btn" data-extra="${i}">${x.label}</button>`).join('')}</div>` : ''}
      ${items.join('')}
      ${themeMenuItem()}
      ${showStatus ? '<div class="nav-status" id="nav-status" data-status-box aria-live="polite"></div>' : ''}
    </div>`;

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

  // Klick auf einen Menüpunkt schließt das Menü (außer z. B. bei der Reihenfolge)
  nav.querySelector('.nav-menu').addEventListener('click', e => {
    if (e.target.closest('a, button') && !e.target.closest('[data-keep-open]')) closeMenu();
  });

  // Status-Feld (Laptop) auf- und zuklappen
  const statusBtn = nav.querySelector('.status-btn');
  const statusPanel = nav.querySelector('.status-panel');
  if (statusBtn) {
    const setStatusOpen = open => {
      statusPanel.hidden = !open;
      statusBtn.setAttribute('aria-expanded', open);
    };
    closeStatus = () => setStatusOpen(false);
    statusBtn.addEventListener('click', () => setStatusOpen(statusPanel.hidden));
    statusPanel.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) closeStatus();
    });
  } else {
    closeStatus = () => {};
  }
  nav.querySelector('[data-action="logout"]')?.addEventListener('click', onLogout);
  onRender?.(); // z. B. Status-Bereich füllen (main.js)
  nav.querySelector('.nav-extra')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-extra]');
    if (btn) extras[btn.dataset.extra]?.onClick();
  });
}

// Menü schließen: Klick daneben, Escape, Seitenwechsel
document.addEventListener('click', e => {
  const path = e.composedPath();
  if (!path.some(el => el.id === 'nav')) closeMenu();
  if (!path.some(el => el.classList?.contains('status-wrap'))) closeStatus();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMenu(); closeStatus(); }
});
window.addEventListener('hashchange', () => { closeMenu(); closeStatus(); });
