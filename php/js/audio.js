// Sprachaufnahmen: mit dem Mikrofon aufnehmen und im Artikel abspielen.
//
// Gespeichert wird eine Aufnahme wie ein Bild: Sie wird hochgeladen (offline in den
// Postausgang), im Text steht dann
//   ![Sprachnotiz 0:42](uploads/3f9a….m4a)
// markdown.js macht daraus einen Audio-Player.
//
// Aufnehmen: MediaRecorder. Safari/iPhone nimmt als MP4 (AAC) auf, Chrome je nach
// Version als MP4 oder WebM (Opus) – genommen wird das erste Format, das der Browser kann.
// Mikrofon gibt es nur über HTTPS oder auf localhost (Browser-Regel).
//
// Abspielen: Die Datei wird ganz geladen und als Blob abgespielt. Grund: Safari spielt
// Audio sonst nur, wenn der Server Teilstücke („Range“) liefern kann – das können weder der
// PHP-Testserver noch der Service Worker. Als Blob geht es überall, auch offline.

import * as outbox from './outbox.js';

export const MAX_SECONDS = 10 * 60; // danach wird automatisch beendet
const MIN_SECONDS = 1;              // kürzer = versehentlich getippt -> verwerfen

const RECORD_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];
const EXT = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg' };
const TYPE_OF_EXT = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg' };

/** Gibt es im Browser überhaupt Aufnahme? (Ohne HTTPS fehlt nur das Mikrofon – dafür eigene Meldung) */
export const canRecord = () => typeof window.MediaRecorder === 'function';

/** "125" -> "2:05" */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Aufnahme starten. Fragt beim ersten Mal nach dem Mikrofon.
 * onTick(sekunden) jede halbe Sekunde, onEnd() wenn die Aufnahme von selbst endet
 * (Höchstdauer, Mikrofon weg, App im Hintergrund).
 * Ergebnis: { stop() -> Promise<{ file, seconds } | null> }   (null = zu kurz / nichts aufgenommen)
 */
export async function startRecording({ onTick = () => {}, onEnd = () => {} } = {}) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Das Mikrofon geht nur über HTTPS (oder auf localhost)');
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    throw new Error({
      NotAllowedError: 'Mikrofon nicht erlaubt – in den Einstellungen des Browsers freigeben',
      SecurityError: 'Mikrofon nicht erlaubt – in den Einstellungen des Browsers freigeben',
      NotFoundError: 'Kein Mikrofon gefunden',
      NotReadableError: 'Mikrofon wird gerade von einem anderen Programm benutzt',
    }[err.name] ?? `Mikrofon nicht verfügbar (${err.message || err.name})`);
  }

  const mimeType = RECORD_TYPES.find(t => MediaRecorder.isTypeSupported?.(t));
  let recorder;
  try {
    // Sprache braucht wenig: 48 kbit/s ≈ 0,35 MB pro Minute (manche Browser nehmen trotzdem mehr)
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48_000 });
  } catch {
    recorder = new MediaRecorder(stream);
  }

  const chunks = [];
  recorder.addEventListener('dataavailable', e => { if (e.data?.size) chunks.push(e.data); });

  const started = Date.now();
  const seconds = () => (Date.now() - started) / 1000;
  const timer = setInterval(() => {
    onTick(seconds());
    if (seconds() >= MAX_SECONDS) finish(true);
  }, 500);

  const stopped = new Promise(resolve => {
    recorder.addEventListener('stop', resolve, { once: true });
    recorder.addEventListener('error', resolve, { once: true });
  });

  let result = null;
  async function finish(bySelf = false) {
    if (result) return result;
    result = (async () => {
      clearInterval(timer);
      const duration = seconds();
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      stream.getTracks().forEach(t => t.stop()); // Mikrofon wirklich freigeben (Anzeige im Browser geht aus)
      if (bySelf) onEnd();
      if (!chunks.length || duration < MIN_SECONDS) return null;

      // Typ ohne „;codecs=…“, sonst stimmt die Endung nicht
      const type = (recorder.mimeType || chunks[0].type || 'audio/webm').split(';')[0];
      const ext = EXT[type] ?? 'webm';
      const file = new File(chunks, `sprachnotiz.${ext}`, { type });
      return { file, seconds: duration };
    })();
    return result;
  }

  // Mikrofon fällt weg (z. B. iPhone: App in den Hintergrund, Anruf) -> sauber beenden
  stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => finish(true)));

  recorder.start();
  onTick(0);
  return { stop: () => finish(false) };
}

/**
 * Alle Audio-Player in container abspielbereit machen (nach jedem renderMarkdown aufrufen).
 * Offline aufgenommene Dateien kommen direkt aus dem Postausgang.
 */
export async function enableAudio(container) {
  const players = [...(container?.querySelectorAll('audio[data-audio]:not([src])') ?? [])];
  if (!players.length) return;
  let waiting = null; // Postausgang nur einmal lesen

  await Promise.all(players.map(async audio => {
    const url = audio.dataset.audio;
    const type = TYPE_OF_EXT[url.split('.').pop().toLowerCase()] ?? 'audio/mp4';
    try {
      let blob;
      if (url.startsWith('uploads/pending-')) {
        waiting ??= outbox.all().then(ops => ops.filter(op => op.type === 'upload'));
        blob = (await waiting).find(op => op.tempUrl === url)?.file;
      } else {
        const res = await fetch(url); // geht über den Service Worker -> offline aus dem Zwischenspeicher
        if (!res.ok) throw new Error(res.status);
        blob = await res.blob();
      }
      if (!blob) throw new Error('fehlt');
      // Typ immer selbst setzen – der Server schickt evtl. „application/octet-stream“
      audio.src = URL.createObjectURL(new Blob([blob], { type }));
    } catch {
      if (url.startsWith('uploads/pending-')) {
        audio.closest('.audio-note')?.classList.add('is-missing');
        return;
      }
      audio.src = url; // letzter Versuch: direkt vom Server
    }
    fixDuration(audio);
  }));
}

// Aufnahmen aus dem Browser haben oft keine Längenangabe (Chrome/WebM): Der Player zeigt
// dann 0:00 und man kann nicht spulen. Trick: einmal ans Ende springen, dann kennt er die Länge.
function fixDuration(audio) {
  audio.addEventListener('loadedmetadata', () => {
    if (audio.duration !== Infinity && !Number.isNaN(audio.duration)) return;
    const back = () => {
      if (audio.duration === Infinity) return;
      audio.removeEventListener('durationchange', back);
      audio.currentTime = 0;
    };
    audio.addEventListener('durationchange', back);
    audio.currentTime = 1e7;
  }, { once: true });
  audio.preload = 'metadata';
}
