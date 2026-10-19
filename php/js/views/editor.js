// Editor: Titel + Text (Markdown), Bilder und Code-Blöcke einfügen,
// Vorschau, Autosave als Entwurf, Veröffentlichen-Button.

import { debounce } from '../utils.js';
import { renderMarkdown, enableCopyButtons, findBlocks, cutBlock } from '../markdown.js';
import { prepareImage } from '../image.js';
import { showPendingImages } from '../storage/sync.js';
import { collectTags, cleanTag, sameTag, MAX_TAGS } from '../tags.js';
import { escapeHtml } from '../utils.js';
import { requestPublish } from '../homepage.js';
import { setMenuExtras } from '../nav.js';

export async function renderEditor(root, store, id = null) {
  let post = null;
  try {
    post = id ? await store.get(id) : null;
  } catch {
    root.innerHTML = `<p class="empty">Keine Verbindung – dieser Artikel ist auf diesem Gerät nicht zwischengespeichert.</p>`;
    return;
  }
  if (id && !post) {
    root.innerHTML = `<p class="empty">Artikel nicht gefunden.</p>`;
    return;
  }

  // Bilder gehen nur mit Server (im localStorage-Modus gibt es keinen Upload)
  const canUpload = typeof store.upload === 'function';

  root.innerHTML = `
    <form class="editor" autocomplete="off">
      <div class="field title-field">
        <input class="editor-title" name="title" placeholder="Titel" required aria-describedby="title-error">
        <button type="button" class="privacy-toggle" aria-pressed="true"></button>
        <p class="field-error" id="title-error" role="alert" hidden></p>
      </div>

      <div class="tag-picker" role="group" aria-label="Themen">
        <div class="tag-options"></div>
        <input class="tag-input" placeholder="+ Thema" maxlength="30" enterkeyhint="done"
          aria-label="Neues Thema (Enter zum Hinzufügen)">
        ${typeof store.renameTag === 'function' ? `
          <button type="button" class="tag-manage" aria-pressed="false" title="Themen umbenennen oder löschen">✎ Themen</button>` : ''}
      </div>

      <div class="format-bar" role="toolbar" aria-label="Formatieren">
        <div class="tabs" role="tablist">
          <button type="button" class="tab is-active" data-tab="write" role="tab" aria-selected="true">Schreiben</button>
          <button type="button" class="tab" data-tab="preview" role="tab" aria-selected="false">Vorschau</button>
        </div>
        <span class="spacer"></span>
        <div class="tools">
          ${canUpload ? `
            <button type="button" class="tool" data-tool="image" title="Bild einfügen (auch per Drag & Drop oder Einfügen)">＋ Bild</button>
            <input type="file" accept="image/*" multiple hidden data-file>` : ''}
          <button type="button" class="tool" data-tool="code" title="Block einfügen – für Code oder Text, mit Kopieren-Knopf">{ } Block</button>
        </div>
      </div>

      <div class="conflict" role="alert" hidden>
        <p><strong>Dieser Artikel wurde auf einem anderen Gerät geändert.</strong>
        Deine Änderungen hier sind noch nicht gespeichert – welche Fassung soll gelten?</p>
        <div class="conflict-actions">
          <button type="button" class="btn" data-conflict="theirs">Andere Fassung laden</button>
          <button type="button" class="btn btn-primary" data-conflict="mine">Meine Fassung behalten</button>
        </div>
      </div>

      <p class="md-hint">Leerzeile = neuer Absatz · **fett** · *kursiv* · # Überschrift · \`\`\` = Block</p>
      <textarea class="editor-body" name="body" placeholder="Hier schreiben …"></textarea>
      <div class="editor-preview md" hidden></div>

      <div class="toolbar">
        <p class="editor-alert" role="alert" hidden></p>
        <span class="save-status" aria-live="polite"></span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-danger" data-action="delete" ${post ? '' : 'hidden'}>Löschen</button>
        <button type="button" class="btn" data-action="draft">Zwischenspeichern</button>
        <button type="submit" class="btn btn-primary">
          ${post?.status === 'published' ? 'Aktualisieren' : 'Veröffentlichen'}
        </button>
      </div>
    </form>`;

  const form = root.querySelector('form');
  const title = form.elements.title;
  const body = form.elements.body;
  const preview = root.querySelector('.editor-preview');
  const status = root.querySelector('.save-status');
  const titleError = root.querySelector('#title-error');
  // Statuszeile: immer eine Zeile (CSS kürzt mit …), voller Text als Tooltip
  const setStatus = text => { status.textContent = text; status.title = text; };
  const alertBox = root.querySelector('.editor-alert');

  // ---------- Fehlermeldungen ----------
  // Titel fehlt -> Hinweis direkt unter dem Titelfeld.
  // Alles andere (Speichern, Bild, Löschen …) -> Hinweisfeld über den Knöpfen.
  function showError(message, field = null) {
    if (field === title) {
      titleError.textContent = message;
      titleError.hidden = false;
      title.setAttribute('aria-invalid', 'true');
      title.focus();
    } else {
      alertBox.textContent = message;
      alertBox.hidden = false;
    }
    setStatus('');
  }
  function clearErrors() {
    titleError.hidden = alertBox.hidden = true;
    title.removeAttribute('aria-invalid');
  }
  const fileInput = root.querySelector('[data-file]');

  // Werte über .value setzen statt im HTML -> kein Escaping-Problem
  title.value = post?.title ?? '';
  body.value = post?.body ?? '';
  if (!post) title.focus();
  enableCopyButtons(preview);

  // ---------- Stand merken (für andere Geräte) ----------
  // base  = Stand (rev) des Artikels, auf dem meine Änderungen aufbauen.
  //         Wird beim Speichern mitgeschickt; hat ein anderes Gerät inzwischen
  //         gespeichert, lehnt der Server ab (409) statt zu überschreiben.
  // saved = Titel/Text, wie sie zuletzt gespeichert oder geladen wurden.
  // rev ändert sich bei jeder Änderung (auch Themen umbenennen); ältere Artikel haben nur updatedAt
  const revOf = p => p.rev ?? p.updatedAt;
  let base = post ? revOf(post) : null;
  let tags = [...(post?.tags ?? [])];   // gewählte Themen
  let isPrivate = post ? !!post.private : true; // nur für mich sichtbar – neue Artikel sind privat
  let saved = { title: post?.title ?? '', body: post?.body ?? '', tags: [...tags], private: isPrivate };
  let conflict = null;     // Fassung vom anderen Gerät, solange der Hinweis offen ist
  let saving = null;       // laufender Speichervorgang
  let leaving = false;     // Editor wird gerade verlassen (Speichern im Hintergrund)
  let deleted = false;     // Artikel gelöscht -> beim Verlassen nichts mehr speichern

  const sameTags = (a, b) => a.length === b.length && a.every((t, i) => sameTag(t, b[i]));
  const isDirty = () =>
    title.value.trim() !== saved.title || body.value !== saved.body || !sameTags(tags, saved.tags)
    || isPrivate !== saved.private;
  const conflictBox = root.querySelector('.conflict');

  function showConflict(current) {
    conflict = current;
    autosave.cancel();
    conflictBox.hidden = false;
    setStatus('Nicht gespeichert – bitte Fassung wählen');
  }

  function loadVersion(current) {
    title.value = current.title;
    body.value = current.body;
    tags = [...(current.tags ?? [])];
    isPrivate = !!current.private;
    renderTags();
    renderPrivacy();
    base = revOf(current);
    saved = { title: current.title, body: current.body, tags: [...tags], private: isPrivate };
    if (!preview.hidden) showTab('preview');
  }

  // ---------- Privat ----------
  const privacyBtn = root.querySelector('.privacy-toggle');
  let publishAfterSave = false; // nach dem Umschalten: Homepage nachziehen
  function renderPrivacy() {
    privacyBtn.setAttribute('aria-pressed', isPrivate);
    privacyBtn.classList.toggle('is-active', isPrivate);
    privacyBtn.textContent = isPrivate ? '🔒 Privat' : '🌐 Öffentlich';
    privacyBtn.title = isPrivate
      ? 'Privat: nur du siehst diesen Artikel – er kommt nie auf die Homepage. Antippen = öffentlich machen'
      : 'Öffentlich: kommt beim Veröffentlichen auf die Homepage. Antippen = privat machen';
  }
  privacyBtn.addEventListener('click', () => {
    isPrivate = !isPrivate;
    publishAfterSave = true;
    renderPrivacy();
    setStatus(isPrivate
      ? '🔒 Privat – nur für dich · speichert …'
      : '🌐 Öffentlich – geht beim Veröffentlichen auf die Homepage');
    autosave();
  });
  renderPrivacy();

  // ---------- Themen ----------
  // Alle bisher benutzten Themen (plus Vorschläge) als Knöpfe zum An-/Abwählen,
  // neue Themen über das Feld „+ Thema“ (Enter oder Komma).

  const tagOptions = root.querySelector('.tag-options');
  const tagInput = root.querySelector('.tag-input');
  let known = collectTags([{ tags }], true);

  const manageBtn = root.querySelector('.tag-manage');
  let managing = false; // Bearbeiten-Modus: ✎ umbenennen, ✕ löschen (in allen Artikeln)

  function renderTags() {
    for (const tag of tags) if (!known.some(k => sameTag(k, tag))) known.push(tag);
    known.sort((a, b) => a.localeCompare(b, 'de'));
    tagOptions.innerHTML = known.map(tag => {
      const on = tags.some(t => sameTag(t, tag));
      const name = escapeHtml(tag);
      if (managing) {
        return `
          <span class="tag is-managing">${name}
            <button type="button" class="tag-act" data-rename="${name}" aria-label="„${name}“ umbenennen" title="Umbenennen">✎</button>
            <button type="button" class="tag-act" data-drop="${name}" aria-label="„${name}“ löschen" title="Aus allen Artikeln löschen">✕</button>
          </span>`;
      }
      return `<button type="button" class="tag ${on ? 'is-active' : ''}" data-tag="${name}" aria-pressed="${on}">${name}</button>`;
    }).join('');
    tagInput.hidden = managing || tags.length >= MAX_TAGS;
    if (manageBtn) {
      manageBtn.textContent = managing ? 'Fertig' : '✎ Themen';
      manageBtn.setAttribute('aria-pressed', managing);
      manageBtn.classList.toggle('is-active', managing);
    }
  }

  // Thema in ALLEN Artikeln umbenennen (to) oder löschen (to = null)
  async function changeTagEverywhere(from, to) {
    try {
      const { changed } = await store.renameTag(from, to);
      setStatus(to
        ? `„${from}“ heißt jetzt „${to}“ (${changed} Artikel)`
        : `„${from}“ gelöscht (${changed} Artikel)`);
    } catch (err) {
      showError(`Thema nicht geändert: ${err.message}`);
      return;
    }
    const swap = list => {
      const out = [];
      for (const t of list) {
        const n = sameTag(t, from) ? to : t;
        if (n && !out.some(o => sameTag(o, n))) out.push(n);
      }
      return out;
    };
    known = swap(known);
    tags = swap(tags);
    saved.tags = swap(saved.tags); // auf dem Server schon geändert -> gilt als gespeichert
    renderTags();
  }

  manageBtn?.addEventListener('click', () => {
    managing = !managing;
    renderTags();
  });

  function tagsChanged() {
    renderTags();
    setStatus('Ungespeicherte Änderungen');
    autosave();
  }

  function toggleTag(tag) {
    const i = tags.findIndex(t => sameTag(t, tag));
    if (i >= 0) tags.splice(i, 1);
    else if (tags.length < MAX_TAGS) tags.push(tag);
    tagsChanged();
  }

  function addTagFromInput() {
    const tag = cleanTag(tagInput.value.replace(/,/g, ''));
    tagInput.value = '';
    if (!tag) return;
    const existing = known.find(k => sameTag(k, tag)) ?? tag; // Schreibweise des bestehenden Themas nehmen
    if (!tags.some(t => sameTag(t, existing)) && tags.length < MAX_TAGS) {
      tags.push(existing);
      tagsChanged();
    }
  }

  tagOptions.addEventListener('click', e => {
    const btn = e.target.closest('[data-tag], [data-rename], [data-drop]');
    if (!btn) return;
    if (btn.dataset.tag) toggleTag(btn.dataset.tag);

    if (btn.dataset.rename) {
      const from = btn.dataset.rename;
      const to = cleanTag(prompt(`Thema „${from}“ umbenennen in:`, from) ?? '');
      if (to && to !== from) changeTagEverywhere(from, to);
    }
    if (btn.dataset.drop) {
      const tag = btn.dataset.drop;
      if (confirm(`Thema „${tag}“ aus allen Artikeln entfernen?\n(Die Artikel selbst bleiben.)`)) changeTagEverywhere(tag, null);
    }
  });
  tagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault(); // Enter würde sonst das Formular abschicken (= veröffentlichen)
      addTagFromInput();
    }
  });
  tagInput.addEventListener('blur', addTagFromInput);

  renderTags();
  // Themen der anderen Artikel nachladen (blockiert den Editor nicht)
  store.list().then(posts => {
    known = collectTags([...posts, { tags }], true);
    renderTags();
  }).catch(() => {});

  // ---------- Speichern ----------

  // explicit = per Knopf (Zwischenspeichern/Veröffentlichen) – nur dann meckert ein fehlender Titel laut
  function save(newStatus, explicit = false) {
    saving = doSave(newStatus, explicit).finally(() => { saving = null; });
    return saving;
  }

  async function doSave(newStatus, explicit) {
    if (conflict) return null; // erst entscheiden, welche Fassung gilt
    const data = {
      title: title.value.trim(),
      body: withoutMarkers(body.value), // „Bild wird hochgeladen …“ nie speichern
      status: newStatus ?? post?.status ?? 'draft',
      tags: [...tags],
      private: isPrivate,
    };
    if (!data.title) {
      if (explicit) showError('Bitte zuerst einen Titel eingeben – ohne Titel wird nicht gespeichert.', title);
      else setStatus('Noch ohne Titel – nicht gespeichert');
      return null;
    }

    setStatus('Speichert …');
    try {
      post = post
        ? await store.update(post.id, { ...data, baseUpdatedAt: base ?? undefined })
        : await store.create(data);
    } catch (err) {
      if (err.status === 409 && err.current) {
        showConflict(err.current);
        return null;
      }
      showError(err.message === 'Nicht angemeldet'
        ? 'Nicht gespeichert – die Anmeldung ist abgelaufen. Text kopieren, dann neu anmelden.'
        : `Nicht gespeichert: ${err.message}`);
      return null;
    }

    clearErrors();
    saved = { title: data.title, body: data.body, tags: data.tags, private: data.private };
    // Privat umgeschaltet: Homepage nachziehen (bei privat -> dort entfernen; bei
    // öffentlich + veröffentlicht -> dort zeigen). Autosave allein löst nichts aus.
    if (publishAfterSave) {
      publishAfterSave = false;
      requestPublish();
    }
    root.querySelector('[data-action="delete"]').hidden = false; // ab jetzt gibt es etwas zu löschen
    // Offline (Postausgang) hat der Server noch nichts -> Stand bleibt der alte
    if (!post.pending) base = revOf(post);

    // URL auf "edit" umstellen, ohne die Seite neu zu rendern (nicht, wenn schon woanders)
    if (!leaving) history.replaceState(null, '', `#/edit/${post.id}`);
    const time = new Date(post.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    setStatus(post.pending
      ? `Offline gespeichert ${time} · wartet auf den Server`
      : `Gespeichert um ${time}`);
    return post;
  }

  // Autosave: 1,5 s nach der letzten Eingabe
  const autosave = debounce(() => save(), 1500);
  form.addEventListener('input', e => {
    if (e.target === fileInput || e.target === tagInput) return;
    if (e.target === title && title.value.trim()) {
      titleError.hidden = true;
      title.removeAttribute('aria-invalid');
    }
    setStatus('Ungespeicherte Änderungen');
    autosave();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    autosave.cancel();
    const saved = await save('published', true);
    if (saved) {
      requestPublish(); // öffentliche Artikel gehen damit auf die Homepage
      location.hash = `#/post/${saved.id}`;
    }
  });

  // ---------- Text einfügen ----------

  // Fügt Text an der Cursorposition ein. execCommand hält Rückgängig (Cmd+Z) intakt
  // und löst selbst ein input-Event aus (-> Autosave).
  function insert(text) {
    body.focus();
    if (!document.execCommand('insertText', false, text)) {
      body.setRangeText(text, body.selectionStart, body.selectionEnd, 'end');
      body.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Sorgt dafür, dass ein Block (Bild, Code) in einer eigenen Zeile steht
  function asBlock(text) {
    const before = body.value.slice(0, body.selectionStart);
    const after = body.value.slice(body.selectionEnd);
    const prefix = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const suffix = after.startsWith('\n') ? '' : '\n';
    return prefix + text + suffix;
  }

  function insertCode() {
    const selected = body.value.slice(body.selectionStart, body.selectionEnd);
    const start = body.selectionStart;
    const block = asBlock('```\n' + (selected || '') + '\n```');
    insert(block);
    if (!selected) {
      // Cursor in die leere Zeile im Block setzen
      const cursor = start + block.indexOf('```\n') + 4;
      body.setSelectionRange(cursor, cursor);
    }
  }

  // ---------- Bilder ----------

  let uploadCount = 0;
  let uploading = 0; // Bilder, die gerade hochgeladen werden

  // Platzhalter, solange ein Bild hochgeladen wird – darf nie gespeichert werden
  const MARKER = /^!\[Bild wird hochgeladen … \d+\]\(\)\n?/gm;
  const withoutMarkers = text => text.replace(MARKER, '');

  async function uploadImages(files) {
    const images = [...files].filter(f => f.type.startsWith('image/'));
    if (!canUpload || images.length === 0) return;
    if (preview.hidden === false) showTab('write');

    for (const file of images) {
      // Platzhalter sofort einfügen, damit man weiterschreiben kann
      const marker = `![Bild wird hochgeladen … ${++uploadCount}]()`;
      insert(asBlock(marker));
      setStatus('Bild wird hochgeladen …');
      uploading++;

      try {
        const { url, pending } = await store.upload(await prepareImage(file));
        replaceMarker(marker, `![${altFrom(file.name)}](${url})`);
        setStatus(pending ? 'Bild offline gespeichert – wird später hochgeladen' : 'Bild eingefügt');
      } catch (err) {
        replaceMarker(marker, '');
        showError(`Bild nicht hochgeladen: ${err.message}`);
      } finally {
        uploading--;
        // Editor inzwischen verlassen -> mit dem fertigen Bild nachspeichern
        if (leaving && !uploading && !deleted) (saving ?? Promise.resolve()).then(() => save());
      }
    }
  }

  function replaceMarker(marker, text) {
    const at = body.value.indexOf(marker);
    if (at === -1) return; // Platzhalter wurde inzwischen gelöscht
    const { selectionStart: s, selectionEnd: e } = body;
    const shift = pos => (pos > at ? pos + text.length - marker.length : pos);
    body.value = body.value.slice(0, at) + text + body.value.slice(at + marker.length);
    body.setSelectionRange(shift(s), shift(e));
    body.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // "IMG_2041.HEIC" -> "" ; "abendhimmel-berlin.jpg" -> "abendhimmel berlin"
  function altFrom(name) {
    const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    return /^(img|image|bild|dsc|pxl|photo|screenshot)?[\s\d.:]*$/i.test(base) ? '' : base.replace(/[[\]]/g, '');
  }

  fileInput?.addEventListener('change', () => {
    uploadImages(fileInput.files);
    fileInput.value = '';
  });

  body.addEventListener('paste', e => {
    if (e.clipboardData?.files.length) {
      e.preventDefault();
      uploadImages(e.clipboardData.files);
    }
  });

  body.addEventListener('dragover', e => {
    if (canUpload && e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      body.classList.add('is-dropping');
    }
  });
  body.addEventListener('dragleave', () => body.classList.remove('is-dropping'));
  body.addEventListener('drop', e => {
    body.classList.remove('is-dropping');
    if (e.dataTransfer?.files.length) {
      e.preventDefault();
      uploadImages(e.dataTransfer.files);
    }
  });

  // ---------- Vorschau ----------

  function showTab(tab) {
    const isPreview = tab === 'preview';
    if (isPreview) {
      preview.innerHTML = renderMarkdown(body.value) || '<p class="excerpt-empty">Noch kein Text.</p>';
      addRemoveButtons();
      showPendingImages(preview); // offline eingefügte Bilder aus dem Postausgang zeigen
    }
    preview.hidden = !isPreview;
    body.hidden = isPreview;
    root.querySelector('.md-hint').hidden = isPreview; // Schreibhilfe nur beim Schreiben
    form.querySelectorAll('[data-tab]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab);
    });
    form.querySelectorAll('[data-tool]').forEach(b => (b.disabled = isPreview));
    if (!isPreview) body.focus();
  }

  // ---------- Bilder und Code-Blöcke entfernen (in der Vorschau) ----------

  const ICON_TRASH = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;

  // Jedes Bild / jeder Code-Block in der Vorschau bekommt einen Papierkorb.
  // Die Reihenfolge entspricht findBlocks() – so weiß der Knopf, welche Stelle im Text gemeint ist.
  function addRemoveButtons() {
    preview.querySelectorAll('img').forEach((img, i) => {
      const wrap = document.createElement('span');
      wrap.className = 'removable';
      img.replaceWith(wrap);
      wrap.append(img);
      wrap.insertAdjacentHTML('beforeend',
        `<button type="button" class="remove-btn" data-remove="image" data-index="${i}" aria-label="Bild entfernen" title="Bild entfernen">${ICON_TRASH}</button>`);
    });
    preview.querySelectorAll('.code-head').forEach((head, i) => {
      head.querySelector('[data-copy]').insertAdjacentHTML('beforebegin',
        `<button type="button" class="code-remove" data-remove="code" data-index="${i}" aria-label="Code-Block entfernen" title="Code-Block entfernen">${ICON_TRASH}</button>`);
    });
  }

  async function removeBlock(kind, index) {
    const blocks = findBlocks(body.value);
    const block = (kind === 'image' ? blocks.images : blocks.codes)[index];
    if (!block) return;
    if (!confirm(kind === 'image' ? 'Dieses Bild aus dem Artikel entfernen?' : 'Diesen Code-Block entfernen?')) return;

    body.value = cutBlock(body.value, block);
    showTab('preview'); // Vorschau neu zeichnen

    if (kind === 'image') {
      // Erst den Text ohne Bild speichern, dann die Datei löschen lassen
      // (der Server löscht nur Bilder, die kein Artikel mehr verwendet)
      autosave.cancel();
      const saved = await save();
      if (saved && store.removeUpload) await store.removeUpload(block.url);
      if (saved) setStatus('Bild entfernt');
    } else {
      setStatus('Ungespeicherte Änderungen');
      autosave();
    }
  }

  preview.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (btn) removeBlock(btn.dataset.remove, Number(btn.dataset.index));
  });

  // ---------- Klicks ----------

  form.addEventListener('click', async e => {
    const el = e.target.closest('button');
    if (!el) return;

    if (el.dataset.tab) showTab(el.dataset.tab);
    if (el.dataset.tool === 'image') fileInput.click();
    if (el.dataset.tool === 'code') insertCode();

    const action = el.dataset.action;
    if (action === 'draft') {
      autosave.cancel();
      await save('draft', true);
    }
    if (action === 'delete' && confirm('Artikel wirklich löschen?')) {
      autosave.cancel();
      try {
        await store.remove(post.id);
        deleted = true;
        requestPublish(); // war er auf der Homepage, verschwindet er dort
        location.hash = '#/';
      } catch (err) {
        showError(`Nicht gelöscht: ${err.message}`);
      }
    }
  });

  // ---------- Änderungen von anderen Geräten ----------

  conflictBox.addEventListener('click', async e => {
    const choice = e.target.closest('[data-conflict]')?.dataset.conflict;
    if (!choice || !conflict) return;
    const current = conflict;
    conflict = null;
    conflictBox.hidden = true;
    if (choice === 'theirs') {
      loadVersion(current);
      setStatus('Fassung vom anderen Gerät geladen');
    } else {
      base = revOf(current); // „Ich kenne die andere Fassung und überschreibe sie bewusst“
      await save();
    }
  });

  // Die App meldet: Auf dem Server hat sich etwas geändert (alle 10 s geprüft)
  const onDataChanged = async () => {
    if (!post || post.id.startsWith('local-') || conflict) return;
    if (saving) await saving;              // eigenes Speichern erst abwarten
    let current;
    try {
      current = await store.get(post.id);
    } catch {
      return;
    }
    if (!current || current.pending || revOf(current) === base) return;

    // Steht auf dem Server genau das, was hier steht? (z. B. eigenes Speichern) -> nur Stand merken
    if (current.title === title.value.trim() && current.body === body.value
        && sameTags(current.tags ?? [], tags) && !!current.private === isPrivate) {
      base = revOf(current);
      saved = { title: current.title, body: current.body, tags: [...tags], private: isPrivate };
      return;
    }
    if (isDirty()) {
      showConflict(current);               // hier ungespeicherte Änderungen -> nachfragen
    } else {
      loadVersion(current);                // hier nichts geändert -> einfach übernehmen
      setStatus('Auf einem anderen Gerät geändert – neu geladen');
    }
  };
  window.addEventListener('data:changed', onDataChanged);

  // Offline angelegter Artikel wurde beim Synchronisieren auf dem Server erstellt:
  // ab jetzt mit der echten ID weiterarbeiten
  const onIdMap = e => {
    if (post?.id === e.detail.from) {
      post = { ...post, id: e.detail.to };
      history.replaceState(null, '', `#/edit/${post.id}`);
    }
  };
  window.addEventListener('outbox:idmap', onIdMap);

  // Beim Verlassen nichts verlieren: Ungespeichertes sofort speichern.
  // Text ohne Titel wird als privater Entwurf „Ohne Titel“ gesichert (bei einem
  // bestehenden Artikel mit gelöschtem Titel bleibt der bisherige Titel).
  function leaveSave() {
    if (deleted || conflict || !isDirty()) return;
    if (!title.value.trim() && !body.value.trim()) return; // ganz leer -> nichts zu sichern
    leaving = true;
    if (!title.value.trim()) title.value = saved.title || 'Ohne Titel';
    (saving ?? Promise.resolve())
      .then(() => save())
      .then(p => { if (p) window.dispatchEvent(new Event('data:changed')); }); // Liste zeigt ihn sofort
  }

  // Auf dem Handy wandern „＋ Bild“ und „{ } Block“ ins Burger-Menü (CSS blendet sie hier aus)
  setMenuExtras([
    ...(canUpload ? [{ label: '＋ Bild', onClick: () => { showTab('write'); fileInput.click(); } }] : []),
    { label: '{ } Block', onClick: () => { showTab('write'); insertCode(); } },
  ]);

  // ---------- Ganze Seite, Tastatur ----------
  // Editor füllt genau den sichtbaren Bereich (iPhone: über der Tastatur).
  const html = document.documentElement;
  document.body.classList.add('is-editing');
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    html.style.setProperty('--vv-h', `${vv.height}px`);
    html.style.setProperty('--vv-top', `${vv.offsetTop}px`);
    updateTyping();
  };
  // „Tippen“-Ansicht: Textfeld hat den Fokus und es ist eng (Handy mit Tastatur)
  const updateTyping = () => {
    const tight = (vv?.height ?? window.innerHeight) < 560;
    document.body.classList.toggle('is-typing', tight && document.activeElement === body);
  };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  body.addEventListener('focus', updateTyping);
  body.addEventListener('blur', () => setTimeout(updateTyping, 50));
  fit();

  // Aufräumfunktion für den Router
  return () => {
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
    document.body.classList.remove('is-editing', 'is-typing');
    html.style.removeProperty('--vv-h');
    html.style.removeProperty('--vv-top');
    autosave.cancel();
    setMenuExtras([]);
    leaveSave();
    window.removeEventListener('outbox:idmap', onIdMap);
    window.removeEventListener('data:changed', onDataChanged);
  };
}
