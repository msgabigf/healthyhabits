// One-file backup of everything, shared to iCloud Drive / Files via the share sheet.
// Import also accepts records exported from the old claude.ai version.

import { checkins, files, kv } from './store.js';
import { getConfig, saveConfig } from './config.js';
import { normalizeRecord } from './data.js';
import { scheduleSync } from './sync.js';
import { blobToBase64, base64ToBlob, todayISO, toast } from './util.js';

export async function exportBackup() {
  const recs = (await checkins.all()).map(({ dirty, ...r }) => r);
  const fileRecs = await files.all();
  const payload = {
    app: 'rotina',
    version: 1,
    exportedAt: new Date().toISOString(),
    config: getConfig(),
    checkins: recs,
    files: await Promise.all(fileRecs.map(async f => ({ id: f.id, name: f.name, type: f.type, date: f.date, data: await blobToBase64(f.blob) }))),
  };
  const name = `rotina-backup-${todayISO()}.json`;
  const file = new File([JSON.stringify(payload)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Backup da Rotina' });
    } catch (e) {
      if (e.name === 'AbortError') return; // user closed the share sheet
      throw e;
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  await kv.set('lastBackup', new Date().toISOString());
  toast('backup pronto ✓');
}

export async function lastBackupText() {
  const last = await kv.get('lastBackup');
  if (!last) return 'Ainda sem backup.';
  const days = Math.floor((Date.now() - Date.parse(last)) / 86400000);
  return days === 0 ? 'Último backup: hoje.' : `Último backup: há ${days} dia${days > 1 ? 's' : ''}.`;
}

export async function daysSinceBackup() {
  const last = await kv.get('lastBackup');
  return last ? Math.floor((Date.now() - Date.parse(last)) / 86400000) : null;
}

// Accepts: a Rotina backup, {config}, {checkins:[...]}, or a bare array of day records.
export async function importBackup(obj) {
  let list = [];
  let cfg = null;
  let fileList = [];
  if (Array.isArray(obj)) list = obj;
  else if (obj && typeof obj === 'object') {
    list = Array.isArray(obj.checkins) ? obj.checkins : [];
    cfg = obj.config || null;
    fileList = Array.isArray(obj.files) ? obj.files : [];
  }
  if (!list.length && !cfg) throw new Error('empty');

  for (const f of fileList) {
    if (!f.id || !f.data) continue;
    if (!(await files.get(f.id))) await files.put({ id: f.id, name: f.name, type: f.type, date: f.date, blob: base64ToBlob(f.data, f.type) });
  }
  let days = 0;
  for (const raw of list) {
    // old claude.ai docs may wrap the data
    const d = raw && raw.data && raw.data.date ? raw.data : raw;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) continue;
    const incoming = normalizeRecord(d);
    const local = await checkins.get(incoming.date);
    if (local && local.updatedAt && incoming.updatedAt && local.updatedAt >= incoming.updatedAt) continue;
    await checkins.put({ ...incoming, updatedAt: incoming.updatedAt || new Date().toISOString(), dirty: true });
    days++;
  }
  if (cfg) await saveConfig({ ...cfg, updatedAt: undefined });
  scheduleSync();
  return { days, config: !!cfg };
}
