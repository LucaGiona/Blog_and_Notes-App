// Editor: Titel + Text (Markdown), Bilder, Sprachaufnahmen und Code-Blöcke einfügen,
// Vorschau, Autosave, Auswahl „Wer sieht das?“ und ein Speichern-Knopf.

import { debounce, formatDate, formatDateTime, sameMinute, VISIBILITY, visOf, visData, visBadge } from '../utils.js';
import { renderMarkdown, enableCopyButtons, findBlocks, cutBlock, isAudio, splitSize, MAX_FLOAT } from '../markdown.js';
import { prepareImage } from '../image.js';
import { canRecord, startRecording, enableAudio, formatDuration } from '../audio.js';
import { showPendingImages } from '../storage/sync.js';
import { collectTags, cleanTag, sameTag, MAX_TAGS, tagLinks } from '../tags.js';
import { card } from './list.js';
import { escapeHtml } from '../utils.js';
import { requestPublish } from '../homepage.js';
import { setMenuExtras } from '../nav.js';
import { setLeaveGuard } from '../router.js';

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
  // Sprachaufnahmen: wie Bilder nur mit Server, und nur wenn der Browser aufnehmen kann
  const canAudio = canUpload && canRecord();

  root.innerHTML = `
    <form class="editor" autocomplete="off">
      <div class="field title-field">
        <input class="editor-title" name="title" placeholder="Titel" required aria-describedby="title-error">
        <p class="field-error" id="title-error" role="alert" hidden></p>
      </div>

      <div class="vis-picker" role="radiogroup" aria-label="Wer sieht den Artikel?">
        <span class="vis-label" aria-hidden="true">Wer sieht das?</span>
        ${VISIBILITY.map(v => `
          <button type="button" role="radio" data-vis="${v.key}" title="${v.hint}" aria-checked="false">${v.label}</button>`).join('')}
      </div>

      <div class="tag-picker" role="group" aria-label="Themen">
        <div class="tag-actions">
          <input class="tag-input" placeholder="+ Thema" maxlength="30" enterkeyhint="done"
            aria-label="Neues Thema (Enter zum Hinzufügen)">
          ${typeof store.renameTag === 'function' ? `
            <button type="button" class="tag-manage" aria-pressed="false" title="Themen umbenennen oder löschen">✎ Themen</button>` : ''}
        </div>
        <div class="tag-options"></div>
      </div>

      <div class="format-bar" role="toolbar" aria-label="Formatieren">
        <div class="tabs" role="tablist">
          <button type="button" class="tab is-active" data-tab="write" role="tab" aria-selected="true" title="Text tippen">Schreiben</button>
          <button type="button" class="tab" data-tab="preview" role="tab" aria-selected="false" title="Bilder anordnen: Größe, links/rechts, löschen">Gestalten</button>
          <button type="button" class="tab tab-view" data-tab="view" role="tab" aria-selected="false" title="So sehen Leser den Artikel">Vorschau</button>
        </div>
        <span class="spacer"></span>
        <div class="tools">
          ${canUpload ? `
            <button type="button" class="tool" data-tool="image" title="Bild einfügen (auch per Drag & Drop oder Einfügen)">＋ Bild</button>
            <input type="file" accept="image/*" multiple hidden data-file>` : ''}
          ${canAudio ? `
            <button type="button" class="tool tool-rec" data-tool="record" aria-pressed="false" title="Sprachaufnahme starten – noch einmal tippen zum Beenden">● Aufnahme</button>` : ''}
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
      <div class="editor-view" hidden>
        <label class="view-guest"><input type="checkbox" data-view-guest> als Besucher ansehen</label>
        <div class="view-content"></div>
      </div>

      <div class="rec-bar" role="status" aria-live="polite" hidden>
        <span class="rec-dot" aria-hidden="true"></span>
        <span class="rec-text">Aufnahme <span class="rec-time">0:00</span></span>
        <button type="button" class="btn rec-stop" data-rec="stop">■ Beenden</button>
      </div>

      <div class="toolbar">
        <p class="editor-alert" role="alert" hidden></p>
        <span class="save-status" aria-live="polite"></span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-danger" data-action="delete" ${post ? '' : 'hidden'}>Löschen</button>
        <button type="submit" class="btn btn-primary">Speichern</button>
      </div>
    </form>
    <div class="leave-ask" role="alertdialog" aria-modal="true" aria-labelledby="leave-ask-text" hidden>
      <div class="leave-ask-box">
        <p id="leave-ask-text"><strong>Titel fehlt</strong>Du hast geschrieben, aber noch keinen Titel vergeben.</p>
        <div class="leave-ask-actions">
          <button type="button" class="btn btn-primary" data-ask="title">Titel eingeben</button>
          <button type="button" class="btn" data-ask="untitled">Als „Ohne Titel“ speichern</button>
        </div>
      </div>
    </div>`;

  const form = root.querySelector('form');
  const title = form.elements.title;
  const body = form.elements.body;
  const preview = root.querySelector('.editor-preview');
  const status = root.querySelector('.save-status');
  const titleError = root.querySelector('#title-error');
  // Statuszeile: immer eine Zeile (CSS kürzt mit …), voller Text als Tooltip
  const setStatus = text => { status.textContent = text; status.title = text; };
  const alertBox = root.querySelector('.editor-alert');
  // Einmal merken: Beim Speichern nach dem Verlassen zeigt root schon die nächste Seite
  const deleteBtn = root.querySelector('[data-action="delete"]');
  const mdHint = root.querySelector('.md-hint');

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
  // Beim Öffnen: wann angelegt, wann zuletzt bearbeitet
  if (post?.createdAt) {
    setStatus(`Angelegt ${formatDateTime(post.createdAt)}`
      + (sameMinute(post.createdAt, post.updatedAt) ? '' : ` · bearbeitet ${formatDateTime(post.updatedAt)}`));
  }
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
  let vis = visOf(post); // Wer sieht den Artikel? – neue Artikel: nur ich
  let saved = { title: post?.title ?? '', body: post?.body ?? '', tags: [...tags], vis };
  let conflict = null;     // Fassung vom anderen Gerät, solange der Hinweis offen ist
  let saving = null;       // laufender Speichervorgang
  let leaving = false;     // Editor wird gerade verlassen (Speichern im Hintergrund)
  let deleted = false;     // Artikel gelöscht -> beim Verlassen nichts mehr speichern
  let fallbackTitle = '';  // nur beim Wegwechseln aus der App: Titel, falls noch keiner da ist

  const sameTags = (a, b) => a.length === b.length && a.every((t, i) => sameTag(t, b[i]));
  const isDirty = () =>
    title.value.trim() !== saved.title || body.value !== saved.body || !sameTags(tags, saved.tags)
    || vis !== saved.vis;
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
    vis = visOf(current);
    renderTags();
    renderVis();
    base = revOf(current);
    saved = { title: current.title, body: current.body, tags: [...tags], vis };
    if (!preview.hidden) showTab('preview');
    if (!viewBox.hidden) showTab('view');
  }

  // ---------- Wer sieht das? ----------
  // Umschalten speichert gleich und zieht die Homepage nach – kein zweiter Knopf nötig.
  const visPicker = root.querySelector('.vis-picker');
  let publishAfterSave = false; // nach dem Umschalten: Homepage nachziehen
  function renderVis() {
    visPicker.querySelectorAll('[data-vis]').forEach(b => b.setAttribute('aria-checked', b.dataset.vis === vis));
    refreshView();
  }
  // Vorschau-Tab offen? Dann Änderungen an Titel, „Wer sieht das?“ und Themen gleich zeigen
  function refreshView() {
    if (root.querySelector('.editor-view')?.hidden === false) renderView();
  }
  visPicker.addEventListener('click', e => {
    const choice = e.target.closest('[data-vis]')?.dataset.vis;
    if (!choice || choice === vis) return;
    vis = choice;
    publishAfterSave = true;
    renderVis();
    setStatus(`${VISIBILITY.find(v => v.key === vis).hint} · speichert …`);
    autosave();
  });
  // Pfeiltasten wie bei Radio-Knöpfen
  visPicker.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const buttons = [...visPicker.querySelectorAll('[data-vis]')];
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const nextBtn = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    nextBtn.focus();
    nextBtn.click();
  });
  renderVis();

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
    refreshView();
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

  // explicit = per Knopf „Speichern“ – nur dann meckert ein fehlender Titel laut
  //
  // Immer nur EIN Speichervorgang gleichzeitig. Läuft schon einer (z. B. ein neuer Artikel
  // wird gerade angelegt und der Server antwortet langsam), wird danach genau einmal mit dem
  // dann aktuellen Text nachgespeichert. Vorher konnte das automatische Speichern beim Tippen
  // des Titels denselben Artikel mehrmals anlegen („Jung und synchoni“, „… synchonizit“ …).
  let next = null; // vorgemerktes Speichern { explicit, promise }
  function save(explicit = false) {
    if (!saving) {
      saving = doSave(explicit).finally(() => { saving = null; });
      return saving;
    }
    if (next) {
      next.explicit ||= explicit;
      return next.promise;
    }
    const queued = { explicit };
    queued.promise = saving.catch(() => null).then(() => {
      next = null;
      return save(queued.explicit);
    });
    next = queued;
    return queued.promise;
  }
  // Wartet, bis alles Vorgemerkte gespeichert ist
  async function idle() {
    while (saving || next) await (next?.promise ?? saving).catch(() => null);
  }

  async function doSave(explicit) {
    if (conflict) return null; // erst entscheiden, welche Fassung gilt
    const savingVis = vis;
    const data = {
      title: title.value.trim() || fallbackTitle,
      body: withoutMarkers(body.value), // „Bild wird hochgeladen …“ nie speichern
      tags: [...tags],
      ...visData(savingVis), // private + status
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
    saved = { title: data.title, body: data.body, tags: data.tags, vis: savingVis };
    // „Wer sieht das?“ umgeschaltet: Homepage nachziehen. Tippen allein (Autosave) löst nichts aus –
    // dafür gibt es „Speichern“.
    if (publishAfterSave) {
      publishAfterSave = false;
      requestPublish();
    }
    deleteBtn.hidden = false; // ab jetzt gibt es etwas zu löschen
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
    if (e.target === title) refreshView();
  });

  // „Speichern“: speichert sofort und zieht die Homepage nach (je nach „Wer sieht das?“
  // erscheint der Artikel dort ganz, nur mit Titel oder gar nicht). Der Editor bleibt offen.
  form.addEventListener('submit', async e => {
    e.preventDefault();
    autosave.cancel();
    const saved = await save(true);
    if (saved) {
      requestPublish();
      if (!saved.pending) setStatus(`${statusTextOf(saved)} · Homepage wird aktualisiert`);
    }
  });
  const statusTextOf = p => `Gespeichert um ${new Date(p.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

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

  // Platzhalter, solange ein Bild hochgeladen bzw. eine Aufnahme gemacht wird – darf nie gespeichert werden
  const MARKER = /^!\[(?:Bild wird hochgeladen|Sprachaufnahme läuft) … \d+\]\(\)\n?/gm;
  const withoutMarkers = text => text.replace(MARKER, '');

  async function uploadImages(files) {
    const images = [...files].filter(f => f.type.startsWith('image/'));
    if (!canUpload || images.length === 0) return;
    if (body.hidden) showTab('write');

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
        if (leaving && !uploading && !deleted) save(); // wartet selbst auf laufendes Speichern
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

  // ---------- Sprachaufnahme ----------
  // Ein Tipp startet, ein zweiter beendet. Während der Aufnahme steht an der Cursor-Stelle ein
  // Platzhalter, man kann weiterschreiben. Danach wird die Datei hochgeladen (offline: Postausgang)
  // und der Platzhalter durch ![Sprachnotiz 0:42](uploads/…) ersetzt.

  const recBar = root.querySelector('.rec-bar');
  const recTime = root.querySelector('.rec-time');
  const recBtn = root.querySelector('[data-tool="record"]');
  let recording = null; // { stop, marker } solange aufgenommen wird
  let recStarting = false;
  let closed = false;   // Editor verlassen

  function showRecording(on) {
    recBar.hidden = !on;
    if (recBtn) {
      recBtn.setAttribute('aria-pressed', on);
      recBtn.classList.toggle('is-recording', on);
      recBtn.textContent = on ? '■ Beenden' : '● Aufnahme';
    }
    updateMenu(); // Burger-Menü: „● Aufnahme“ <-> „■ Aufnahme beenden“
  }

  async function toggleRecording() {
    if (recording) return stopRecording();
    if (recStarting) return;
    if (body.hidden) showTab('write');
    recStarting = true;
    clearErrors();
    let rec;
    try {
      rec = await startRecording({
        onTick: sec => { recTime.textContent = formatDuration(sec); },
        onEnd: () => stopRecording(), // Höchstdauer erreicht oder Mikrofon weg
      });
    } catch (err) {
      showError(`Keine Aufnahme: ${err.message}`);
      return;
    } finally {
      recStarting = false;
    }
    if (closed) { rec.stop(); return; } // Editor wurde verlassen, während nach dem Mikrofon gefragt wurde
    const marker = `![Sprachaufnahme läuft … ${++uploadCount}]()`;
    insert(asBlock(marker));
    uploading++; // zählt wie ein Bild-Upload: beim Verlassen wird danach nachgespeichert
    recording = { ...rec, marker };
    showRecording(true);
    setStatus('Sprachaufnahme läuft …');
  }

  async function stopRecording() {
    if (!recording) return;
    const { stop, marker } = recording;
    recording = null;
    showRecording(false);
    try {
      const result = await stop();
      if (!result) {
        replaceMarker(marker, '');
        setStatus('Aufnahme zu kurz – verworfen');
        return;
      }
      setStatus('Sprachaufnahme wird hochgeladen …');
      const { url, pending } = await store.upload(result.file);
      replaceMarker(marker, `![Sprachnotiz ${formatDuration(result.seconds)}](${url})`);
      setStatus(pending ? 'Aufnahme offline gespeichert – wird später hochgeladen' : 'Sprachaufnahme eingefügt');
    } catch (err) {
      replaceMarker(marker, '');
      showError(`Aufnahme nicht gespeichert: ${err.message}`);
    } finally {
      uploading--;
      if (leaving && !uploading && !deleted) save();
    }
  }

  recBar.addEventListener('click', e => {
    if (e.target.closest('[data-rec="stop"]')) stopRecording();
  });

  // ---------- Vorschau ----------

  // Drei Tabs: write = Schreiben (Text), preview = Gestalten (Bilder anordnen, mit Knöpfen),
  // view = Vorschau (ohne Knöpfe, genau wie Leser den Artikel sehen)
  function showTab(tab) {
    const isPreview = tab === 'preview';
    const isWrite = tab === 'write';
    if (isPreview) {
      preview.innerHTML = renderMarkdown(body.value) || '<p class="excerpt-empty">Noch kein Text.</p>';
      addRemoveButtons();
      showPendingImages(preview); // offline eingefügte Bilder aus dem Postausgang zeigen
      enableAudio(preview);
    }
    if (tab === 'view') renderView();
    preview.hidden = !isPreview;
    viewBox.hidden = tab !== 'view';
    body.hidden = !isWrite;
    mdHint.hidden = !isWrite; // Schreibhilfe nur beim Schreiben
    form.querySelectorAll('[data-tab]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab);
    });
    // „Beenden“ muss auch in den anderen Tabs gehen
    form.querySelectorAll('[data-tool]').forEach(b => (b.disabled = !isWrite && !(b === recBtn && recording)));
    if (isWrite) body.focus();
  }

  // ---------- Vorschau: so sehen Leser den Artikel ----------
  // Wie die Leseansicht (Titel, Datum, Themen, Text). „Als Besucher“ zeigt, was Fremde je nach
  // „Wer sieht das?“ sehen: alles, nur den Titel mit verschwommenem Text – oder gar nichts.
  const viewBox = root.querySelector('.editor-view');
  const viewContent = root.querySelector('.view-content');
  const guestToggle = root.querySelector('[data-view-guest]');
  guestToggle.addEventListener('change', () => renderView());

  function renderView() {
    const now = new Date().toISOString();
    const shown = {
      id: post?.id ?? 'neu',
      title: title.value.trim() || 'Ohne Titel',
      body: withoutMarkers(body.value),
      tags: [...tags],
      createdAt: post?.createdAt ?? now,
      updatedAt: post?.updatedAt ?? now,
      ...visData(vis),
    };
    const hint = text => `<p class="view-hint">${text}</p>`;

    if (guestToggle.checked && vis === 'me') {
      viewContent.innerHTML = hint('🔒 Besucher sehen diesen Artikel gar nicht – er steht für sie auch nicht in der Liste.');
      return;
    }
    if (guestToggle.checked && vis === 'title') {
      viewContent.innerHTML = hint('👁 Besucher sehen in der Liste nur den Titel, der Text ist verschwommen. Öffnen können sie den Artikel nicht.')
        + `<div class="view-card"><span class="badge">In Arbeit</span>${card(shown, false)}</div>`; // Abzeichen wie in der Liste
      return;
    }
    viewContent.innerHTML = `
      <article class="article">
        <h1>${escapeHtml(shown.title)}</h1>
        <div class="article-info">
          <div class="meta"><time datetime="${shown.createdAt}">${formatDate(shown.createdAt)}</time></div>
          ${guestToggle.checked ? '' : `<div class="article-flags">${visBadge(shown)}</div>`}
          ${shown.tags.length ? `<div class="article-tags">${tagLinks(shown.tags)}</div>` : ''}
        </div>
        <div class="article-body md">${renderMarkdown(shown.body) || '<p class="excerpt-empty">Noch kein Text.</p>'}</div>
      </article>`;
    // Links in der Vorschau nicht folgen (würde den Editor verlassen)
    viewContent.querySelectorAll('.article-tags a').forEach(a => a.removeAttribute('href'));
    const md = viewContent.querySelector('.article-body');
    enableCopyButtons(md);
    showPendingImages(md);
    enableAudio(md);
  }

  // ---------- Bilder und Code-Blöcke entfernen (in der Vorschau) ----------

  const ICON_TRASH = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;

  // Jedes Bild / jeder Code-Block in der Vorschau bekommt einen Papierkorb.
  // Die Reihenfolge entspricht findBlocks() – so weiß der Knopf, welche Stelle im Text gemeint ist.
  // Bilder und Sprachaufnahmen zählen zusammen (wie in findBlocks), in der Reihenfolge im Text.
  // Bilder bekommen zusätzlich darunter die Knöpfe für Größe (S · M · L · ganz) und Ausrichtung (◧ ▣ ◨).
  function addRemoveButtons() {
    preview.querySelectorAll('img, .audio-note').forEach((el, i) => {
      const isImage = el.matches('img');
      const what = isImage ? 'Bild' : 'Sprachaufnahme';
      const wrap = document.createElement('span');
      wrap.className = 'removable';
      el.replaceWith(wrap);
      wrap.append(el);
      wrap.insertAdjacentHTML('beforeend',
        `<button type="button" class="remove-btn" data-remove="image" data-index="${i}" aria-label="${what} entfernen" title="${what} entfernen">${ICON_TRASH}</button>`);
      if (!isImage) return;
      // Die Breite sitzt in der Vorschau am Rahmen (sonst bezöge sich % auf den Rahmen selbst)
      if (el.dataset.w) {
        wrap.classList.add('is-sized');
        wrap.style.setProperty('--w', `${el.dataset.w}%`);
      }
      const current = Number(el.dataset.w) || 100;
      const side = el.dataset.align ?? 'mitte';
      wrap.insertAdjacentHTML('beforeend', `
        <span class="size-btns">
          <span class="btn-group" role="group" aria-label="Bildgröße">
            ${SIZES.map(([label, width, name]) => `
              <button type="button" class="size-btn" data-size="${width}" data-index="${i}"
                aria-pressed="${current === width}" title="${name}">${label}</button>`).join('')}
          </span>
          <span class="btn-group" role="group" aria-label="Ausrichtung">
            ${ALIGNS.map(([label, align, name]) => `
              <button type="button" class="size-btn" data-align-to="${align}" data-index="${i}"
                aria-pressed="${side === align}" aria-label="${name}" title="${name}">${label}</button>`).join('')}
          </span>
        </span>`);
    });
    preview.querySelectorAll('.code-head').forEach((head, i) => {
      head.querySelector('[data-copy]').insertAdjacentHTML('beforebegin',
        `<button type="button" class="code-remove" data-remove="code" data-index="${i}" aria-label="Code-Block entfernen" title="Code-Block entfernen">${ICON_TRASH}</button>`);
    });
  }

  // ---------- Bildgröße und Ausrichtung (in der Vorschau) ----------
  // Steht im Text hinter der Beschreibung: ![Abendhimmel|50](uploads/…), ![Abendhimmel|25 links](…).
  // „ganz“ = ohne Zahl. Links/rechts fließt der Text daneben – das geht nur bis halbe Breite:
  // Wer links/rechts wählt, bekommt höchstens M; wer danach L/ganz wählt, ist wieder in der Mitte.
  const SIZES = [['S', 25, 'Klein – ein Viertel der Breite'], ['M', 50, 'Mittel – halbe Breite'],
    ['L', 75, 'Groß – drei Viertel der Breite'], ['ganz', 100, 'Ganze Breite']];
  const ALIGNS = [['◧', 'links', 'Links, Text fließt rechts daneben'], ['▣', 'mitte', 'Mitte, ohne Text daneben'],
    ['◨', 'rechts', 'Rechts, Text fließt links daneben']];

  function setImage(index, change, focusSelector) {
    const block = findBlocks(body.value).images[index];
    if (!block || isAudio(block.url)) return;
    const now = splitSize(block.alt);
    let width = change.width ?? now.width ?? 100;
    let align = 'align' in change ? change.align : now.align;
    if (change.align && width > MAX_FLOAT) width = MAX_FLOAT;
    if (change.width && width > MAX_FLOAT) align = null;
    const opts = [width < 100 ? width : '', align ?? ''].filter(Boolean).join(' ');
    const md = `![${now.alt}${opts ? `|${opts}` : ''}](${block.url})`;
    if (body.value.slice(block.start, block.end) === md) return;
    body.value = body.value.slice(0, block.start) + md + body.value.slice(block.end);

    // Neu zeichnen, ohne dass die Vorschau springt; Fokus bleibt auf dem gewählten Knopf
    const scroll = [preview.scrollTop, document.scrollingElement.scrollTop];
    showTab('preview');
    [preview.scrollTop, document.scrollingElement.scrollTop] = scroll;
    preview.querySelector(`${focusSelector}[data-index="${index}"]`)?.focus({ preventScroll: true });
    setStatus('Ungespeicherte Änderungen');
    autosave();
  }

  async function removeBlock(kind, index) {
    const blocks = findBlocks(body.value);
    const block = (kind === 'image' ? blocks.images : blocks.codes)[index];
    if (!block) return;
    const audio = kind === 'image' && isAudio(block.url);
    if (!confirm(audio ? 'Diese Sprachaufnahme aus dem Artikel entfernen?'
      : kind === 'image' ? 'Dieses Bild aus dem Artikel entfernen?' : 'Diesen Code-Block entfernen?')) return;

    body.value = cutBlock(body.value, block);
    showTab('preview'); // Vorschau neu zeichnen

    if (kind === 'image') {
      // Erst den Text ohne Bild speichern, dann die Datei löschen lassen
      // (der Server löscht nur Bilder, die kein Artikel mehr verwendet)
      autosave.cancel();
      const saved = await save();
      if (saved && store.removeUpload) await store.removeUpload(block.url);
      if (saved) setStatus(audio ? 'Sprachaufnahme entfernt' : 'Bild entfernt');
    } else {
      setStatus('Ungespeicherte Änderungen');
      autosave();
    }
  }

  preview.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (btn) removeBlock(btn.dataset.remove, Number(btn.dataset.index));
    const size = e.target.closest('[data-size]');
    if (size) setImage(Number(size.dataset.index), { width: Number(size.dataset.size) }, `[data-size="${size.dataset.size}"]`);
    const side = e.target.closest('[data-align-to]');
    if (side) {
      const to = side.dataset.alignTo;
      setImage(Number(side.dataset.index), { align: to === 'mitte' ? null : to }, `[data-align-to="${to}"]`);
    }
  });

  // ---------- Klicks ----------

  form.addEventListener('click', async e => {
    const el = e.target.closest('button');
    if (!el) return;

    if (el.dataset.tab) showTab(el.dataset.tab);
    if (el.dataset.tool === 'image') fileInput.click();
    if (el.dataset.tool === 'code') insertCode();
    if (el.dataset.tool === 'record') toggleRecording();

    const action = el.dataset.action;
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
    await idle();                          // eigenes Speichern erst abwarten
    let current;
    try {
      current = await store.get(post.id);
    } catch {
      return;
    }
    if (!current || current.pending || revOf(current) === base) return;

    // Steht auf dem Server genau das, was hier steht? (z. B. eigenes Speichern) -> nur Stand merken
    if (current.title === title.value.trim() && current.body === body.value
        && sameTags(current.tags ?? [], tags) && visOf(current) === vis) {
      base = revOf(current);
      saved = { title: current.title, body: current.body, tags: [...tags], vis };
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
    save() // wartet selbst auf laufendes Speichern
      .then(p => { if (p) window.dispatchEvent(new Event('data:changed')); }); // Liste zeigt ihn sofort
  }

  // ---------- Titel fehlt: beim Verlassen nachfragen ----------
  // Tippt man auf „Blog“, „+ Neu“ oder zurück, obwohl Text, aber kein Titel da ist, bleibt der
  // Editor offen und fragt: Titel eingeben – oder als „Ohne Titel“ speichern.
  const leaveAsk = root.querySelector('.leave-ask');
  let leaveTo = null;
  const needsTitle = () => !deleted && !conflict && !title.value.trim() && !!withoutMarkers(body.value).trim();
  setLeaveGuard(next => {
    if (!needsTitle()) return true;
    leaveTo = next || '#/';
    history.replaceState(null, '', post ? `#/edit/${post.id}` : '#/new'); // Adresse zurück auf den Editor
    leaveAsk.hidden = false;
    leaveAsk.querySelector('[data-ask="title"]').focus();
    return false;
  });
  const askTitle = () => {
    leaveAsk.hidden = true;
    leaveTo = null;
    title.focus();
  };
  leaveAsk.addEventListener('click', e => {
    const choice = e.target.closest('[data-ask]')?.dataset.ask;
    if (choice === 'title' || e.target === leaveAsk) askTitle(); // auch Klick daneben = weiterschreiben
    if (choice === 'untitled') {
      title.value = saved.title || 'Ohne Titel';
      leaveAsk.hidden = true;
      location.hash = leaveTo ?? '#/'; // jetzt mit Titel -> darf gehen, beim Verlassen wird gespeichert
    }
  });
  leaveAsk.addEventListener('keydown', e => { if (e.key === 'Escape') askTitle(); });

  // App wird weggewischt oder ein anderes Programm geöffnet: Dann kann niemand mehr gefragt
  // werden. Text ohne Titel trotzdem sichern – als „Ohne Titel“, das Titelfeld bleibt leer.
  const onHide = () => {
    if (document.visibilityState !== 'hidden' || !isDirty()) return;
    autosave.cancel();
    if (title.value.trim()) { save(); return; }
    if (!needsTitle()) return;
    fallbackTitle = saved.title || 'Ohne Titel';
    save().finally(() => { fallbackTitle = ''; });
  };
  document.addEventListener('visibilitychange', onHide);

  // Auf dem Handy wandern „＋ Bild“, „{ } Block“ und „● Aufnahme“ ins Burger-Menü (CSS blendet sie hier aus).
  // Während der Aufnahme steht unten zusätzlich die Leiste mit „■ Beenden“.
  function updateMenu() {
    setMenuExtras([
      ...(canUpload ? [{ label: '＋ Bild', onClick: () => { showTab('write'); fileInput.click(); } }] : []),
      { label: '{ } Block', onClick: () => { showTab('write'); insertCode(); } },
      ...(canAudio ? [{ label: recording ? '■ Aufnahme beenden' : '● Aufnahme', onClick: toggleRecording }] : []),
    ]);
  }
  updateMenu();

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
    requestAnimationFrame(keepCaret); // Editor ist kleiner geworden (Tastatur) -> Cursor nachholen
  };
  // Cursor ganz sichtbar halten. Das iPhone scrollt ihn nur bis an den Rand des Textfelds –
  // und das, BEVOR der Editor an die Tastatur angepasst ist. Steht der Cursor am Textende
  // (beim Schreiben fast immer), ganz nach unten scrollen; unten ist etwas Luft (CSS).
  function keepCaret() {
    if (document.activeElement !== body || body.selectionEnd < body.value.length - 1) return;
    body.scrollTop = body.scrollHeight;
  }
  body.addEventListener('input', () => requestAnimationFrame(keepCaret));
  // „Tippen“-Ansicht: Textfeld hat den Fokus und es ist eng (Handy mit Tastatur)
  const updateTyping = () => {
    const tight = (vv?.height ?? window.innerHeight) < 560;
    const typing = tight && document.activeElement === body;
    if (typing) headerTitle.textContent = title.value.trim() || 'Ohne Titel';
    document.body.classList.toggle('is-typing', typing);
  };

  // Beim Tippen steht der Titel oben in der Kopfzeile: Blog · Titel · ☰. Die Zeile mit
  // Titelfeld und Privat-Schalter ist dann ausgeblendet (CSS), der Burger mit Bild/Block bleibt
  // erreichbar. Antippen -> zurück ins Titelfeld (dabei kommt alles wieder).
  const headerTitle = document.createElement('button');
  headerTitle.type = 'button';
  headerTitle.className = 'header-title';
  headerTitle.title = 'Titel bearbeiten';
  headerTitle.addEventListener('click', () => {
    document.body.classList.remove('is-typing'); // erst einblenden, sonst lässt sich das Feld nicht fokussieren
    title.focus();
  });
  document.querySelector('.site-header .brand')?.after(headerTitle);
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
    headerTitle.remove();
    html.style.removeProperty('--vv-h');
    html.style.removeProperty('--vv-top');
    autosave.cancel();
    closed = true;
    stopRecording(); // Editor verlassen: Aufnahme beenden und trotzdem speichern
    setMenuExtras([]);
    setLeaveGuard(null);
    document.removeEventListener('visibilitychange', onHide);
    leaveSave();
    window.removeEventListener('outbox:idmap', onIdMap);
    window.removeEventListener('data:changed', onDataChanged);
  };
}
