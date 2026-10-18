// Leseansicht eines Artikels.

import { escapeHtml, formatDate } from '../utils.js';
import { renderMarkdown, enableCopyButtons } from '../markdown.js';
import { showPendingImages } from '../storage/sync.js';
import { tagLinks } from '../tags.js';

export async function renderPost(root, store, id, auth) {
  let post;
  try {
    post = await store.get(id);
  } catch {
    root.innerHTML = `<p class="empty">Keine Verbindung – dieser Artikel ist auf diesem Gerät nicht zwischengespeichert.</p>`;
    return;
  }
  if (!post) {
    root.innerHTML = `<p class="empty">Artikel nicht gefunden.</p>`;
    return;
  }

  root.innerHTML = `
    <a href="#/" class="back">← Alle Artikel</a>
    <article class="article">
      <h1>${escapeHtml(post.title)}</h1>
      <div class="meta">
        ${post.private ? '<span class="badge badge-private" title="Nur für dich sichtbar">🔒 Privat</span>' : ''}
        ${post.status === 'draft' ? '<span class="badge">Entwurf</span>' : ''}
        <time datetime="${post.updatedAt}">${formatDate(post.updatedAt)}</time>
      </div>
      ${post.tags?.length ? `<div class="article-tags">${tagLinks(post.tags)}</div>` : ''}
      <div class="article-body md">${renderMarkdown(post.body)}</div>
      ${auth.canEdit ? `
        <div class="article-actions">
          <a href="#/edit/${post.id}" class="btn">Bearbeiten</a>
        </div>` : ''}
    </article>`;

  enableCopyButtons(root.querySelector('.article-body'));
  showPendingImages(root.querySelector('.article-body'));
}
