// Sync with your own Google Sheet through a Google Apps Script web app
// (see apps-script/Code.gs). The phone is always the source of truth for
// what you're editing; the Sheet is the backup and what Claude reads.

import { checkins, files, kv } from './store.js';
import { getConfig, saveConfig } from './config.js';
import { normalizeRecord } from './data.js';
import { blobToBase64, debounce } from './util.js';

let settings = { url: '', token: '', lastSync: null, lastPull: null };
let status = 'off'; // off | pending | syncing | ok | error
let lastError = '';
let running = false;
let again = false;
const listeners = new Set();

export function onSyncStatus(fn) { listeners.add(fn); fn(status, lastError); }
function setStatus(s, err = '') { status = s; lastError = err; listeners.forEach(fn => fn(s, err)); }

export async function loadSyncSettings() {
  settings = { ...settings, ...(await kv.get('sync') || {}) };
  setStatus(isConfigured() ? 'pending' : 'off');
  return settings;
}
export function getSyncSettings() { return settings; }
export function isConfigured() { return !!(settings.url && settings.token); }

export async function saveSyncSettings(patch) {
  settings = { ...settings, ...patch };
  await kv.set('sync', settings);
  setStatus(isConfigured() ? 'pending' : 'off');
}

async function call(action, body = {}) {
  // text/plain body = "simple" CORS request, which Apps Script accepts
  const res = await fetch(settings.url, {
    method: 'POST',
    body: JSON.stringify({ action, token: settings.token, ...body }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('Resposta inválida — confira o link do script.'); }
  if (!data.ok) throw new Error(data.error === 'unauthorized' ? 'Código secreto incorreto.' : (data.error || 'Erro no script.'));
  return data;
}

export async function testConnection() {
  const r = await call('ping');
  return r.sheetUrl;
}

async function pushFiles(rec) {
  let changed = false;
  for (const meta of rec.files) {
    if (meta.driveId) continue;
    const f = await files.get(meta.id);
    if (!f) continue; // attachment only exists on another device
    const r = await call('upload', { date: rec.date, name: meta.name, type: meta.type, data: await blobToBase64(f.blob) });
    meta.driveId = r.id;
    meta.driveUrl = r.url;
    changed = true;
  }
  return changed;
}

async function push() {
  const cfgDirty = await kv.get('configDirty');
  if (cfgDirty) {
    await call('saveConfig', { config: getConfig() });
    await kv.set('configDirty', false);
  }
  const dirty = (await checkins.all()).filter(r => r.dirty);
  for (const rec of dirty) {
    if (await pushFiles(rec)) {
      // store the Drive ids without touching updatedAt
      const fresh = await checkins.get(rec.date);
      if (fresh) {
        fresh.files = fresh.files.map(f => rec.files.find(x => x.id === f.id && x.driveId) || f);
        await checkins.put(fresh);
        rec.files = fresh.files;
      }
    }
  }
  if (dirty.length) {
    const payload = dirty.map(({ dirty: _d, ...r }) => r);
    await call('upsert', { checkins: payload });
    for (const sent of dirty) {
      const fresh = await checkins.get(sent.date);
      // only clear the flag if nothing changed while we were sending
      if (fresh && fresh.updatedAt === sent.updatedAt) { fresh.dirty = false; await checkins.put(fresh); }
      else again = true;
    }
  }
}

export async function pull() {
  const r = await call('pull');
  let changedDates = [];
  for (const remote of r.checkins || []) {
    if (!remote || !remote.date) continue;
    const local = await checkins.get(remote.date);
    if (local && local.dirty) continue;
    if (local && local.updatedAt && remote.updatedAt && local.updatedAt >= remote.updatedAt) continue;
    await checkins.put({ ...normalizeRecord(remote), dirty: false });
    changedDates.push(remote.date);
  }
  const cfg = getConfig();
  if (r.config && (!cfg.updatedAt || (r.config.updatedAt && r.config.updatedAt > cfg.updatedAt)) && !(await kv.get('configDirty'))) {
    await saveConfig(r.config, { fromRemote: true });
  }
  settings.lastPull = new Date().toISOString();
  await kv.set('sync', settings);
  return changedDates;
}

export async function syncNow({ withPull = false } = {}) {
  if (!isConfigured()) { setStatus('off'); return; }
  if (!navigator.onLine) { setStatus('pending'); return; }
  if (running) { again = true; return; }
  running = true;
  setStatus('syncing');
  let pulled = [];
  try {
    do {
      again = false;
      await push();
    } while (again);
    if (withPull) pulled = await pull();
    settings.lastSync = new Date().toISOString();
    await kv.set('sync', settings);
    setStatus('ok');
  } catch (e) {
    setStatus('error', e.message || String(e));
  } finally {
    running = false;
  }
  return pulled;
}

export const scheduleSync = debounce(() => syncNow(), 1500);

// pull at most every 10 minutes when coming back to the app
export function pullIsStale() {
  return !settings.lastPull || Date.now() - Date.parse(settings.lastPull) > 10 * 60 * 1000;
}

window.addEventListener('online', () => scheduleSync());
