// Speicher im Browser (localStorage) – funktioniert ohne Server.
// Gleiche Schnittstelle wie api.js, damit man einfach austauschen kann.

const KEY = 'notizblog.posts';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

function writeAll(posts) {
  localStorage.setItem(KEY, JSON.stringify(posts));
}

export const localStore = {
  name: 'Browser (nur lokal zum Testen – kein Login)',

  async list() {
    return readAll();
  },

  async get(id) {
    return readAll().find(p => p.id === id) ?? null;
  },

  async create(data) {
    const now = new Date().toISOString();
    const post = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...data };
    writeAll([...readAll(), post]);
    return post;
  },

  async update(id, data) {
    const posts = readAll();
    const i = posts.findIndex(p => p.id === id);
    if (i === -1) throw new Error('Artikel nicht gefunden');
    posts[i] = { ...posts[i], ...data, updatedAt: new Date().toISOString() };
    writeAll(posts);
    return posts[i];
  },

  async remove(id) {
    writeAll(readAll().filter(p => p.id !== id));
  },
};
