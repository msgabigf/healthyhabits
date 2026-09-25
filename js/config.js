// Generic defaults only. Your real gyms, classes and weekly plan live in your
// data (phone + Google Sheet), never in this file — the repo stays public-safe.

import { kv } from './store.js';

// Fixed category ids, in the order their colors were validated for
// color-blind separation (see css/app.css --c-*).
export const CATEGORY_IDS = ['forca', 'pilates', 'cardio', 'minimo', 'recreativo'];

export const DEFAULT_CONFIG = {
  name: '',
  categories: {
    forca:      { label: 'Força',      target: 3, activities: ['Musculação'] },
    pilates:    { label: 'Pilates',    target: 1, activities: ['Pilates'] },
    cardio:     { label: 'Cardio',     target: 1, activities: ['Corrida', 'Bike'] },
    minimo:     { label: 'Mínimo',     target: 0, activities: ['Alongamento em casa (10 min)'] },
    recreativo: { label: 'Recreativo', target: 1, activities: ['Caminhada'] },
  },
  // weekly plan, keyed by JS weekday (0 = domingo)
  plan: { 0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} },
  sleepHours: 7,
  updatedAt: null,
};

let current = null;
const listeners = new Set();

function normalize(cfg) {
  const out = structuredClone(DEFAULT_CONFIG);
  if (!cfg || typeof cfg !== 'object') return out;
  if (typeof cfg.name === 'string') out.name = cfg.name;
  if (cfg.categories) {
    for (const id of CATEGORY_IDS) {
      const c = cfg.categories[id];
      if (!c) continue;
      if (typeof c.label === 'string' && c.label.trim()) out.categories[id].label = c.label.trim();
      if (Number.isFinite(c.target)) out.categories[id].target = Math.max(0, Math.min(7, c.target));
      if (Array.isArray(c.activities)) out.categories[id].activities = c.activities.filter(a => typeof a === 'string' && a.trim());
    }
  }
  if (cfg.plan) {
    for (let d = 0; d < 7; d++) {
      const p = cfg.plan[d] || {};
      out.plan[d] = { title: (p.title || '').trim(), detail: (p.detail || '').trim() };
    }
  }
  if (Number.isFinite(cfg.sleepHours)) out.sleepHours = cfg.sleepHours;
  out.updatedAt = cfg.updatedAt || null;
  return out;
}

export async function loadConfig() {
  current = normalize(await kv.get('config'));
  return current;
}

export function getConfig() { return current; }

// local edit: bumps updatedAt and flags it for sync
export async function saveConfig(next, { fromRemote = false } = {}) {
  current = normalize(next);
  if (!fromRemote) current.updatedAt = new Date().toISOString();
  await kv.set('config', current);
  await kv.set('configDirty', !fromRemote);
  listeners.forEach(fn => fn(current));
  return current;
}

export function onConfigChange(fn) { listeners.add(fn); }

export function isConfigured(cfg = current) {
  return Object.values(cfg.plan).some(p => p.title);
}
