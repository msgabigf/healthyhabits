// Day records + attachments. Every change is saved immediately on the phone
// and flagged `dirty` so sync.js can send it to the Google Sheet later.

import { checkins, files } from './store.js';
import { WEEKDAYS, weekday, uid } from './util.js';

const listeners = new Set();
export function onRecordsChange(fn) { listeners.add(fn); }
function emit(date) { listeners.forEach(fn => fn(date)); }

export function emptyRecord(date) {
  return {
    date, weekday: WEEKDAYS[weekday(date)],
    activities: [], movNote: '', energy: null, foodTag: null,
    sleepTime: '', wakeTime: '', files: [],
    updatedAt: null, dirty: false,
  };
}

export function hasContent(r) {
  return !!(r && (r.activities.length || r.movNote || r.energy || r.foodTag || r.sleepTime || r.wakeTime || r.files.length));
}

// Accept records from older versions / imports (incl. the claude.ai artifact).
export function normalizeRecord(d) {
  const r = emptyRecord(d.date);
  if (Array.isArray(d.activities)) r.activities = d.activities.filter(a => a && a.l && a.c).map(a => ({ l: String(a.l), c: String(a.c) }));
  else if (d.category) r.activities = [{ l: d.optionLabel || d.category, c: d.category }];
  r.movNote = d.movNote || '';
  r.energy = Number.isFinite(d.energy) ? d.energy : null;
  r.foodTag = d.foodTag || null;
  r.sleepTime = d.sleepTime || '';
  r.wakeTime = d.wakeTime || '';
  const f = Array.isArray(d.files) ? d.files : Array.isArray(d.foodAssets) ? d.foodAssets : [];
  r.files = f.map(x => ({
    id: x.id || uid(),
    name: x.name || (x.contentType === 'application/pdf' ? 'PDF' : 'imagem'),
    type: x.type || x.contentType || 'application/octet-stream',
    driveId: x.driveId || null,
    driveUrl: x.driveUrl || x.url || null,
  }));
  r.updatedAt = d.updatedAt || null;
  return r;
}

export async function getRecord(date) {
  const r = await checkins.get(date);
  return r ? { ...normalizeRecord(r), dirty: !!r.dirty } : emptyRecord(date);
}

export async function saveRecord(rec) {
  const out = { ...rec, weekday: WEEKDAYS[weekday(rec.date)], updatedAt: new Date().toISOString(), dirty: true };
  await checkins.put(out);
  emit(rec.date);
  return out;
}

// ---- attachments ----

const MAX_EDGE = 1600;

// Shrink photos/screenshots before storing: ~2MB → ~200KB.
async function downscale(file) {
  if (!/^image\/(jpeg|png|heic|heif|webp)$/i.test(file.type)) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch (e) {
    return file;
  }
}

export async function attachFiles(rec, fileList) {
  const added = [];
  for (const file of fileList) {
    const blob = await downscale(file);
    const id = uid();
    const type = blob.type || file.type || 'application/octet-stream';
    let name = file.name || 'anexo';
    if (type === 'image/jpeg' && !/\.jpe?g$/i.test(name)) name = name.replace(/\.[^.]+$/, '') + '.jpg';
    await files.put({ id, blob, name, type, date: rec.date });
    added.push({ id, name, type, driveId: null, driveUrl: null });
  }
  return saveRecord({ ...rec, files: [...rec.files, ...added] });
}

export async function removeFile(rec, id) {
  await files.delete(id);
  return saveRecord({ ...rec, files: rec.files.filter(f => f.id !== id) });
}

export async function fileBlob(id) {
  const f = await files.get(id);
  return f ? f.blob : null;
}
