import { requestPersistence, checkins, kv } from './store.js';
import { loadConfig, getConfig, onConfigChange, CATEGORY_IDS } from './config.js';
import { loadSyncSettings, onSyncStatus, syncNow, isConfigured, pullIsStale } from './sync.js';
import { state, openDay, reloadDay, flush, checkRollover, onDayChange } from './state.js';
import { onRecordsChange, normalizeRecord, hasContent } from './data.js';
import { initToday, renderToday, renderPlan } from './today.js';
import { initSleep, renderSleep } from './sleep.js';
import { initDiary, renderDiary } from './diary.js';
import { initSettings, renderSettings, applyTheme } from './settings.js';
import { daysSinceBackup, exportBackup } from './backup.js';
import { $, $$, todayISO, addDays, weekStart, fmtLong, parseISO, WEEKDAYS, WEEKDAYS_SHORT, toast } from './util.js';

const VERSION = '1.0.0';
const DAY_PANELS = ['hoje', 'sono'];
let current = 'hoje';
const scrollPos = {};

// ---------- tabs ----------

function show(panel, { keepScroll = true } = {}) {
  scrollPos[current] = window.scrollY;
  current = panel;
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + panel));
  $$('.tab').forEach(t => {
    const on = t.dataset.panel === panel;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  $('#dayhead').hidden = !DAY_PANELS.includes(panel);
  if (panel === 'diario') renderDiary();
  if (panel === 'ajustes') renderSettings();
  window.scrollTo(0, keepScroll ? (scrollPos[panel] || 0) : 0);
  if (panel !== 'ajustes') { try { localStorage.setItem('rotina.tab', panel); } catch (e) { /* private mode */ } }
}

// ---------- day header ----------

async function renderHeader() {
  const cfg = getConfig();
  $('#greet').textContent = cfg.name ? `oi, ${cfg.name.toLowerCase()}` : 'rotina';
  const today = todayISO();
  const d = state.date;
  $('#dayName').textContent = d === today ? WEEKDAYS[parseISO(d).getDay()] : d === addDays(today, -1) ? 'ontem' : WEEKDAYS[parseISO(d).getDay()];
  $('#dayDate').textContent = d === today ? `hoje, ${fmtLong(d)}` : fmtLong(d);
  $('#backToday').hidden = d === today;

  const start = weekStart(d);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const recs = await checkins.range(days[0], days[6]);
  const byDate = new Map(recs.map(r => [r.date, normalizeRecord(r)]));
  const isCurrentWeek = days.includes(today);
  $('#weekStrip').innerHTML =
    `<button type="button" class="wk-arrow" data-week="-7" aria-label="Semana anterior"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>`
    + days.map(day => {
      const r = byDate.get(day);
      const cats = r ? CATEGORY_IDS.filter(id => r.activities.some(a => a.c === id)) : [];
      const dots = cats.slice(0, 3).map(id => `<i style="background:var(--c-${id})"></i>`).join('')
        || (r && hasContent(r) ? '<i style="background:var(--ink-3)"></i>' : '');
      const wd = parseISO(day).getDay();
      return `<button type="button" role="tab" class="day${day === today ? ' is-today' : ''}${day === d ? ' is-selected' : ''}" data-date="${day}" ${day > today ? 'disabled' : ''} aria-selected="${day === d}" aria-label="${WEEKDAYS[wd]} ${parseISO(day).getDate()}">
        <span class="d-letter">${WEEKDAYS_SHORT[wd]}</span><span class="d-num">${parseISO(day).getDate()}</span><span class="d-dots">${dots}</span>
      </button>`;
    }).join('')
    + `<button type="button" class="wk-arrow" data-week="7" aria-label="Próxima semana" ${isCurrentWeek ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>`;
}

function renderDay() {
  renderHeader();
  renderToday();
  renderSleep();
}

// ---------- sync pill ----------

const PILL = { off: 'salvo', pending: 'salvo no celular', syncing: 'sincronizando', ok: 'sincronizado', error: 'erro na planilha' };

// ---------- boot ----------

async function boot() {
  let theme = 'auto';
  try { theme = (await kv.get('theme')) || 'auto'; } catch (e) { /* ignore */ }
  applyTheme(theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => applyTheme((await kv.get('theme')) || 'auto'));

  await loadConfig();
  await loadSyncSettings();
  requestPersistence();

  initToday();
  await initSleep();
  initDiary({ pickDay: async (date) => { await openDay(date); show('hoje', { keepScroll: false }); } });
  initSettings({ onImported: async () => { await reloadDay(); renderDay(); if (current === 'diario') renderDiary(); } });

  onDayChange(renderDay);
  onRecordsChange(() => renderHeader());
  onConfigChange(() => { renderPlan(); renderHeader(); if (current === 'hoje') renderToday(); });
  onSyncStatus((s) => {
    const pill = $('#syncPill');
    pill.dataset.s = s;
    pill.querySelector('span').textContent = PILL[s] || 'salvo';
  });

  $('#tabbar').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    // tapping the active tab scrolls to top, like iOS
    if (t.dataset.panel === current) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    show(t.dataset.panel);
  });
  $('#weekStrip').addEventListener('click', async (e) => {
    const day = e.target.closest('.day');
    if (day && !day.disabled) { await openDay(day.dataset.date); return; }
    const arrow = e.target.closest('.wk-arrow');
    if (arrow && !arrow.disabled) {
      let target = addDays(state.date, Number(arrow.dataset.week));
      if (target > todayISO()) target = todayISO();
      await openDay(target);
    }
  });
  $('#backToday').addEventListener('click', () => openDay(todayISO()));
  $('#openSettings').addEventListener('click', () => show('ajustes', { keepScroll: false }));
  $('#syncPill').addEventListener('click', () => show('ajustes', { keepScroll: false }));
  $('#closeSettings').addEventListener('click', () => show(DAY_PANELS.includes(lastTab()) || lastTab() === 'diario' ? lastTab() : 'hoje'));
  document.addEventListener('click', (e) => { if (e.target.closest('[data-open-settings]')) show('ajustes', { keepScroll: false }); });

  // the app can live in memory for days: save when leaving, catch up when back
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { flush(); return; }
    if (await checkRollover()) toast('bom dia ☀ novo dia aberto');
    if (isConfigured() && pullIsStale()) {
      const pulled = await syncNow({ withPull: true });
      if (pulled && pulled.includes(state.date)) await reloadDay();
      else renderHeader();
    }
    swRegistration && swRegistration.update().catch(() => {});
  });
  window.addEventListener('pagehide', () => flush());

  $('#version').textContent = `Rotina ${VERSION}`;

  await openDay(todayISO());
  show(lastTab());

  if (isConfigured()) {
    const pulled = await syncNow({ withPull: true });
    if (pulled && pulled.includes(state.date)) await reloadDay();
    else renderHeader();
  }
  nudgeBackup();
}

function lastTab() {
  try { const t = localStorage.getItem('rotina.tab'); if (['hoje', 'diario', 'sono'].includes(t)) return t; } catch (e) { /* ignore */ }
  return 'hoje';
}

// Without the Sheet, the phone is the only copy — remind weekly.
async function nudgeBackup() {
  if (isConfigured()) return;
  const n = (await checkins.all()).length;
  const days = await daysSinceBackup();
  if (n >= 5 && (days === null || days >= 7)) {
    setTimeout(() => toast(days === null ? 'seus dados estão só neste celular' : `último backup há ${days} dias`, {
      action: 'fazer backup', onAction: () => exportBackup().catch(() => {}), ms: 8000,
    }), 1500);
  }
}

// ---------- service worker (offline + updates) ----------

let swRegistration = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    swRegistration = reg;
    const offer = (w) => toast('versão nova disponível', {
      action: 'atualizar', ms: 0,
      onAction: async () => { await flush(); w.postMessage('skipWaiting'); },
    });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

boot().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', `<p style="padding:40px 20px;font-family:sans-serif">Algo deu errado ao abrir o app: ${String(err.message || err)}</p>`);
});
