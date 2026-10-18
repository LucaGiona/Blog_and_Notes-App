// Themen (Tags) wie „Gedanken“, „Notizen“, „Projekte“ – beliebig kombinierbar.
// Gleiche Regeln wie auf dem Server (src/http.php → cleanTags).

import { escapeHtml } from './utils.js';

// Vorschläge, solange noch gar kein Artikel ein Thema hat
export const DEFAULT_TAGS = ['Gedanken', 'Notizen', 'Projekte'];

export const MAX_TAGS = 8;

export function cleanTag(tag) {
  return String(tag).replace(/\s+/g, ' ').trim().slice(0, 30);
}

export const sameTag = (a, b) => a.toLowerCase() === b.toLowerCase();

// Alle Themen aus allen Artikeln, alphabetisch.
// withDefaults: Gibt es noch gar keine, die Vorschläge nehmen.
export function collectTags(posts, withDefaults = false) {
  const all = new Map();
  for (const post of posts) {
    for (const tag of post.tags ?? []) all.set(tag.toLowerCase(), tag);
  }
  const list = [...all.values()];
  return (list.length || !withDefaults ? list : [...DEFAULT_TAGS]).sort((a, b) => a.localeCompare(b, 'de'));
}

export const tagHref = tag => `#/thema/${encodeURIComponent(tag)}`;

// Themen als kleine Links. used (optional): Themen, die gerade Artikel haben –
// die übrigen werden blass dargestellt (z. B. im Filter „Öffentlich“)
export function tagLinks(tags = [], active = null, used = null) {
  return tags.map(tag => {
    const isActive = active && sameTag(tag, active);
    const isEmpty = used && !used.some(u => sameTag(u, tag));
    return `
    <a class="tag ${isActive ? 'is-active' : ''} ${isEmpty ? 'is-empty' : ''}" href="${tagHref(tag)}">${escapeHtml(tag)}</a>`;
  }).join('');
}
