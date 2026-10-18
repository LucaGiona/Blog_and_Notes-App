// Startseite: alle Artikel als Zeitstrahl. Entwürfe zeigen nur den Titel, der Text ist verschwommen.
// Für Gäste schickt der Server bei Entwürfen gar keinen Text (locked) –
// dann wird ein Platzhalter verschwommen angezeigt.

import { escapeHtml, formatDate, excerpt } from '../utils.js';
import { plainText } from '../markdown.js';
import { collectTags, tagLinks, sameTag } from '../tags.js';
import { revealOnScroll } from '../reveal.js';

const PLACEHOLDER =
  'Dieser Artikel ist noch in Arbeit. Hier entsteht gerade ein neuer Text, ' +
  'der bald fertig geschrieben und veröffentlicht wird. Schau später wieder vorbei.';

// activeTag: nur Artikel mit diesem Thema zeigen (Route #/thema/…)
export async function renderList(root, store, auth, activeTag = null) {
  let posts;
  try {
    posts = (await store.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (err) {
    root.innerHTML = `
      <div class="empty">
        <p>Keine Verbindung zum Server.</p>
        <p class="muted">Auf diesem Gerät ist noch keine Version zwischengespeichert.
        Sobald du wieder online bist, lädt der Blog normal.</p>
      </div>`;
    return;
  }

  if (posts.length === 0) {
    root.innerHTML = `
      <div class="empty">
        <p>Noch keine Artikel.</p>
        ${auth.canEdit ? '<a href="#/new" class="btn btn-primary">+ Erster Artikel</a>' : ''}
      </div>`;
    return;
  }

  // Zeitstrahl war schon da (Neu-Zeichnen, weil ein Gerät gespeichert hat, oder Themen-Filter)
  // -> nicht nochmal einblenden
  let stopLine = null;
  draw(!root.querySelector('.timeline'));
  return () => stopLine?.(); // Aufräumen, wenn die Seite gewechselt wird

  function draw(animate) {
    stopLine?.();

    // Nur angemeldet: Alle / Öffentlich / Privat (Besucher bekommen private Artikel gar nicht)
    const view = auth.canEdit ? scope : 'all'; // nach dem Abmelden nicht versehentlich weiterfiltern
    const inScope = posts.filter(p =>
      view === 'public' ? !p.private : view === 'private' ? !!p.private : true);
    // Themenleiste immer mit allen Themen (bleibt beim Umschalten gleich);
    // Themen ohne Artikel im gewählten Bereich werden blass angezeigt
    const allTags = collectTags(posts);
    const usedTags = collectTags(inScope);
    const shown = activeTag ? inScope.filter(p => (p.tags ?? []).some(t => sameTag(t, activeTag))) : inScope;

    const scopeFilter = auth.canEdit ? `
      <div class="scope-filter" role="group" aria-label="Sichtbarkeit">
        ${[['all', 'Alle'], ['public', 'Öffentlich'], ['private', '🔒 Privat']].map(([key, label]) => `
          <button type="button" data-scope="${key}" aria-pressed="${scope === key}">${label}</button>`).join('')}
      </div>` : '';

    // Themen-Leiste: „Alle“ plus jedes vorkommende Thema
    const tagFilter = allTags.length ? `
      <nav class="tag-filter" aria-label="Nach Thema filtern">
        <a class="tag ${activeTag ? '' : 'is-active'}" href="#/">Alle</a>
        ${tagLinks(allTags, activeTag, usedTags)}
      </nav>` : '';

    // Jeder Artikel: Punkt auf der Linie, daneben Datum und darunter Status + Themen,
    // Karte abwechselnd links/rechts
    const items = shown.map((p, i) => `
      <div class="tl-item ${i % 2 ? 'tl-right' : 'tl-left'}">
        <span class="tl-dot" aria-hidden="true"></span>
        <div class="tl-meta">
          <time datetime="${p.updatedAt}">${formatDate(p.updatedAt)}</time>
          <div class="tl-flags">
            ${p.private ? '<span class="badge badge-private" title="Nur für dich sichtbar">🔒 Privat</span>' : ''}
            ${p.status === 'draft'
              ? '<span class="badge">Entwurf</span>'
              : '<span class="badge badge-published">Veröffentlicht</span>'}
            ${p.pending ? '<span class="badge badge-pending" title="Wird synchronisiert, sobald Netz da ist">nicht synchronisiert</span>' : ''}
            ${tagLinks(p.tags, activeTag)}
          </div>
        </div>
        ${card(p, auth.canEdit)}
      </div>`).join('');

    const empty = activeTag ? `Noch keine Artikel zu „${escapeHtml(activeTag)}“.`
      : scope === 'private' ? 'Noch keine privaten Artikel.' : 'Noch keine öffentlichen Artikel.';

    root.innerHTML = `
      ${scopeFilter}
      ${tagFilter}
      <div class="timeline">
        ${shown.length
          ? `<span class="tl-line" aria-hidden="true"><span class="tl-progress"></span></span>${items}`
          : `<p class="empty">${empty}</p>`}
      </div>`;

    root.querySelector('.scope-filter')?.addEventListener('click', e => {
      const key = e.target.closest('[data-scope]')?.dataset.scope;
      if (!key || key === scope) return;
      scope = key;
      draw(false);
    });

    if (animate) revealOnScroll(root.querySelectorAll('.tl-item'));
    stopLine = growLine(root.querySelector('.timeline'));
  }
}

// Gewählte Sichtbarkeit (Alle / Öffentlich / Privat) – bleibt beim Seitenwechsel erhalten
let scope = 'all';

// ---------- Zeitstrahl: Linie wächst beim Scrollen mit ----------
function growLine(list) {
  const bar = list.querySelector('.tl-progress');
  if (!bar) return null;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    bar.style.transform = 'scaleY(1)';
    return null;
  }
  let frame = 0;
  const update = () => {
    frame = 0;
    const rect = list.getBoundingClientRect();
    // Linie reicht bis etwa 3/4 der Bildschirmhöhe
    const progress = Math.min(1, Math.max(0, (innerHeight * 0.75 - rect.top) / rect.height));
    bar.style.transform = `scaleY(${progress})`;
  };
  const onScroll = () => { frame ||= requestAnimationFrame(update); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();
  return () => {
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
    cancelAnimationFrame(frame);
  };
}

// Die Karte selbst: Titel + Anriss (Datum, Status, Themen stehen an der Linie)
function card(post, canEdit) {
  const isDraft = post.status === 'draft';
  const locked = isDraft && !canEdit;
  const title = escapeHtml(post.title || 'Ohne Titel');

  // Entwürfe öffnen den Editor, fertige Artikel die Leseansicht.
  // Gesperrte Entwürfe sind nicht klickbar.
  const href = isDraft ? `#/edit/${post.id}` : `#/post/${post.id}`;
  const heading = locked ? title : `<a href="${href}">${title}</a>`;

  let body;
  if (locked) {
    body = `<p class="excerpt" aria-hidden="true">${PLACEHOLDER}</p>`;
  } else if (plainText(post.body).trim()) {
    body = `<p class="excerpt" aria-hidden="${isDraft}">${escapeHtml(excerpt(plainText(post.body)))}</p>`;
  } else {
    body = `<p class="excerpt excerpt-empty">Noch kein Text.</p>`;
  }

  return `
    <article class="card ${isDraft ? 'is-draft' : ''} ${locked ? 'is-locked' : ''} ${post.private ? 'is-private' : ''}">
      <h2>${heading}</h2>
      ${body}
    </article>`;
}
