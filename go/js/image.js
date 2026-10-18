// Bild im Browser verkleinern, bevor es hochgeladen wird.
// Vorteile: schneller Upload vom Handy, kleine Dateien, und beim Neuzeichnen
// fallen Metadaten wie der GPS-Ort weg.

const MAX_SIDE = 1600;   // längste Seite in Pixeln
const QUALITY = 0.85;

export async function prepareImage(file) {
  // GIFs nicht anfassen – sonst geht die Animation verloren
  if (file.type === 'image/gif') return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // Format kann der Browser nicht lesen (z. B. HEIC) -> Server entscheidet
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // PNG bleibt PNG (Screenshots, Transparenz), alles andere wird WebP –
  // falls der Browser kein WebP erzeugen kann, JPEG.
  const wanted = file.type === 'image/png' ? 'image/png' : 'image/webp';
  let blob = await toBlob(canvas, wanted);
  if (!blob || blob.type !== wanted) blob = await toBlob(canvas, 'image/jpeg');

  // Nur nehmen, wenn es wirklich kleiner geworden ist
  if (!blob || (blob.size >= file.size && scale === 1)) return file;

  const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[blob.type];
  return new File([blob], `bild.${ext}`, { type: blob.type });
}

function toBlob(canvas, type) {
  return new Promise(resolve => canvas.toBlob(resolve, type, QUALITY));
}
