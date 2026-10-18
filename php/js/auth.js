// Anmeldestatus. Das Cookie selbst ist HttpOnly – JavaScript sieht es nie,
// es fragt nur den Server über api/me.

import { device, clearLocalData } from './device.js';
import { fetchWithTimeout } from './storage/api.js';

export const auth = {
  loggedIn: false,
  name: null,
  local: false,   // true = lokaler Testmodus ohne Server (nur Live Server/localhost)
  offline: false, // true = Server gerade nicht erreichbar

  // Schreiben darf man im lokalen Testmodus oder angemeldet
  get canEdit() {
    return this.local || this.loggedIn;
  },

  useLocal() {
    this.local = true;
  },

  // Server ist gerade nicht erreichbar (schon beim Start festgestellt):
  // nicht nochmal warten, sondern direkt mit dem Wissen des Geräts arbeiten
  assumeOffline() {
    this.offline = true;
    this.loggedIn = device.trusted && !!device.lastUser;
    this.name = this.loggedIn ? device.lastUser : null;
  },

  async refresh() {
    try {
      const res = await fetchWithTimeout('api/me', { cache: 'no-store' }, 3000);
      const data = await res.json();
      this.offline = false;
      this.loggedIn = data.loggedIn;
      this.name = data.name || null;
      // Cookie abgelaufen oder überall abgemeldet -> Gerät gilt nicht mehr als angemeldet
      if (!data.loggedIn) device.lastUser = null;
    } catch {
      // Offline: Auf eigenen Geräten weiter als angemeldet gelten (für den Postausgang).
      // Der Server prüft beim Synchronisieren trotzdem das Cookie.
      this.assumeOffline();
    }
  },

  async login(name, password, remember) {
    let res;
    try {
      res = await fetchWithTimeout('api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password, remember }),
      });
    } catch {
      throw new Error('Keine Verbindung – Anmelden geht nur online.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Anmeldung fehlgeschlagen');
    this.loggedIn = true;
    this.offline = false;
    this.name = data.name;
    device.trusted = remember;
    device.shortSession = !remember;
    device.lastUser = remember ? data.name : null;
  },

  async logout() {
    try { await fetchWithTimeout('api/logout', { method: 'POST' }, 4000); } catch { /* offline: lokal trotzdem aufräumen */ }
    await this.forget();
  },

  // Neues Server-Secret -> jedes Gerät ist abgemeldet (auch dieses)
  async logoutAll() {
    const res = await fetch('api/logout-all', { method: 'POST' });
    if (!res.ok) throw new Error('Hat nicht geklappt – bist du online und angemeldet?');
    await this.forget();
  },

  async forget() {
    this.loggedIn = false;
    this.name = null;
    await clearLocalData();
  },
};
