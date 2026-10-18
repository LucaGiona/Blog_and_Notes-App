// Anmeldeformular (erreichbar über #/admin oder #/login).

import { auth } from '../auth.js';

export function renderLogin(root, onSuccess) {
  root.innerHTML = `
    <form class="login" autocomplete="on">
      <h1>Anmelden</h1>
      <label>
        Name
        <input name="name" autocomplete="username" autocapitalize="none" required>
      </label>
      <label>
        Passwort
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <label class="check">
        <input type="checkbox" name="remember">
        <span>
          Auf diesem Gerät angemeldet bleiben
          <small>Nur auf eigenen Geräten: 30 Tage angemeldet, offline schreiben möglich.
          Ohne Haken bist du abgemeldet, sobald der Browser schließt.</small>
        </span>
      </label>
      <div class="login-setup" hidden>
        <strong>Noch kein Benutzer eingerichtet.</strong>
        Lege im Terminal im Ordner der App deinen eigenen Namen und dein Passwort an:
        <code>php bin/passwd.php</code> (PHP) bzw. <code>go run . passwd</code> (Go).
        Danach hier anmelden.
      </div>
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary" type="submit">Anmelden</button>
    </form>`;

  const form = root.querySelector('form');
  const error = root.querySelector('.form-error');
  const button = form.querySelector('button');
  form.elements.name.focus();

  // Frisch heruntergeladen und noch kein Benutzer angelegt? Dann zeigen, wie es geht.
  fetch('api/me', { cache: 'no-store' })
    .then(res => res.json())
    .then(me => { if (me.configured === false) root.querySelector('.login-setup').hidden = false; })
    .catch(() => {});

  form.addEventListener('submit', async e => {
    e.preventDefault();
    error.textContent = '';
    button.disabled = true;
    try {
      await auth.login(
        form.elements.name.value.trim(),
        form.elements.password.value,
        form.elements.remember.checked,
      );
      onSuccess();
    } catch (err) {
      error.textContent = err.message;
      form.elements.password.select();
    } finally {
      button.disabled = false;
    }
  });
}
