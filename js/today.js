import { state, update, flush, replaceRecord } from './state.js';
import { getConfig, saveConfig, CATEGORY_IDS } from './config.js';
import { attachFiles, removeFile, fileBlob } from './data.js';
import { getHealth, isConfigured, requestPullOnReturn } from './sync.js';
import { $, esc, toast, weekday } from './util.js';

export const HEALTH_SHORTCUT = 'Rotina Saúde';

const CHECK = '<svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
const ENERGY_WORDS = ['', 'zerada', 'baixa', 'ok', 'boa', 'a mil'];

// hand-drawn apples: whole / bitten / core
const APPLE_BODY = 'M21 13c-3-2.5-9-3-12 1.5s-2 13 2.5 17.5 7.5 3 9.5 2c2 1 5 2.5 9.5-2s5.5-13 2.5-17.5-9-4-12-1.5z';
const APPLE_TOP = '<path d="M21 13c0-3 1-5.5 3-7"/><path d="M23.5 8.5c2-3 6-3.5 8-2.5-1 3-5 4.5-8 2.5z"/>';
const FOOD = [
  { v: 'consistente', label: 'no plano',
    svg: `<svg viewBox="0 0 42 42" aria-hidden="true"><path class="flesh" d="${APPLE_BODY}"/><path d="${APPLE_BODY}"/>${APPLE_TOP}</svg>` },
  { v: 'mais-ou-menos', label: 'mais ou menos',
    svg: `<svg viewBox="0 0 42 42" aria-hidden="true"><defs><mask id="bite"><rect width="42" height="42" fill="#fff"/><circle cx="34.5" cy="21" r="5.5" fill="#000"/><circle cx="33" cy="27.5" r="4" fill="#000"/></mask></defs><g mask="url(#bite)"><path class="flesh" d="${APPLE_BODY}"/><path d="${APPLE_BODY}"/></g>${APPLE_TOP}</svg>` },
  { v: 'fugiu', label: 'fugi do plano',
    svg: '<svg viewBox="0 0 42 42" aria-hidden="true"><path class="flesh" d="M14 12c4 2 10 2 14 0-1 4-4.5 6-4.5 10s3.5 6.5 4.5 11c-4-2-10-2-14 0 1-4.5 4.5-7 4.5-11S15 16 14 12z"/><path d="M14 12c4 2 10 2 14 0-1 4-4.5 6-4.5 10s3.5 6.5 4.5 11c-4-2-10-2-14 0 1-4.5 4.5-7 4.5-11S15 16 14 12z"/><path d="M21 11.5c0-2 .8-4 2-5.5"/><path d="M19.5 20.5l1 .8M21.5 23l1-.6"/></svg>' },
];

let objectUrls = [];

export function initToday() {
  $('#addActForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#customLabel');
    const label = input.value.trim().replace(/\s+/g, ' ');
    if (!label) return;
    const c = $('#customCat').value;
    const cfg = getConfig();
    // save it in your list so it's there tomorrow too
    if (!cfg.categories[c].activities.includes(label)) {
      const next = structuredClone(cfg);
      next.categories[c].activities.push(label);
      await saveConfig(next);
    }
    if (!state.rec.activities.some(a => a.c === c && a.l === label)) {
      update({ activities: [...state.rec.activities, { l: label, c }] });
    }
    input.value = '';
    input.blur();
    renderActivities();
  });

  $('#actGroups').addEventListener('click', (e) => {
    const btn = e.target.closest('.tag');
    if (!btn) return;
    const a = { l: btn.dataset.l, c: btn.dataset.c };
    const on = state.rec.activities.some(x => x.c === a.c && x.l === a.l);
    const activities = on ? state.rec.activities.filter(x => !(x.c === a.c && x.l === a.l)) : [...state.rec.activities, a];
    update({ activities });
    btn.classList.toggle('on', !on);
    btn.setAttribute('aria-pressed', String(!on));
  });

  $('#movNote').addEventListener('input', (e) => update({ movNote: e.target.value }));
  $('#movNote').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

  const suns = $('#suns');
  suns.innerHTML = [1, 2, 3, 4, 5].map(v => {
    const s = 26 + v * 4, r = 5 + v * 0.9, c = s / 2;
    const rays = Array.from({ length: 8 }, (_, i) => {
      const ang = (Math.PI / 4) * i, r1 = r + 3.5, r2 = r + 3.5 + 1.5 + v * 0.55;
      return `M${(c + Math.cos(ang) * r1).toFixed(1)} ${(c + Math.sin(ang) * r1).toFixed(1)}L${(c + Math.cos(ang) * r2).toFixed(1)} ${(c + Math.sin(ang) * r2).toFixed(1)}`;
    }).join('');
    return `<button type="button" class="sun-btn" role="radio" data-v="${v}" aria-label="Energia ${v}: ${ENERGY_WORDS[v]}">
      <svg width="${s + 12}" height="${s + 12}" viewBox="-6 -6 ${s + 12} ${s + 12}"><path class="rays" d="${rays}"/><circle class="core" cx="${c}" cy="${c}" r="${r}"/></svg>
    </button>`;
  }).join('');
  suns.addEventListener('click', (e) => {
    const b = e.target.closest('.sun-btn');
    if (!b) return;
    const v = Number(b.dataset.v);
    update({ energy: state.rec.energy === v ? null : v });
    renderEnergy();
  });

  const food = $('#food');
  food.innerHTML = FOOD.map(f => `<button type="button" class="food-opt" role="radio" data-v="${f.v}">${f.svg}<span>${f.label}</span></button>`).join('');
  food.addEventListener('click', (e) => {
    const b = e.target.closest('.food-opt');
    if (!b) return;
    update({ foodTag: state.rec.foodTag === b.dataset.v ? null : b.dataset.v });
    renderFood();
  });

  $('#nutrition').addEventListener('click', (e) => {
    if (!e.target.closest('[data-run-shortcut]')) return;
    // opens the Shortcuts app; when you come back, the app pulls the new numbers
    requestPullOnReturn();
    location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(HEALTH_SHORTCUT);
  });

  $('#attachments').addEventListener('click', async (e) => {
    const x = e.target.closest('.x');
    if (x) {
      const meta = state.rec.files.find(f => f.id === x.dataset.id);
      if (!meta || !confirm(`Remover "${meta.name}"?`)) return;
      await flush();
      replaceRecord(await removeFile(state.rec, meta.id));
      renderFiles();
      return;
    }
    if (e.target.closest('.add-photo')) { $('#fileInput').click(); return; }
    const p = e.target.closest('.polaroid');
    if (p) openFile(state.rec.files.find(f => f.id === p.dataset.id));
  });

  $('#fileInput').addEventListener('change', async (e) => {
    const list = [...e.target.files];
    e.target.value = '';
    if (!list.length) return;
    toast(list.length > 1 ? `guardando ${list.length} arquivos…` : 'guardando…', { ms: 0 });
    try {
      await flush();
      replaceRecord(await attachFiles(state.rec, list));
      renderFiles();
      toast('anexado ✓');
    } catch (err) {
      toast('Não consegui guardar esse arquivo.');
    }
  });
}

export function renderToday() {
  renderPlan();
  renderActivities();
  $('#movNote').value = state.rec.movNote || '';
  renderEnergy();
  renderFood();
  renderNutrition();
  renderFiles();
}

export function renderPlan() {
  const cfg = getConfig();
  const p = cfg.plan[weekday(state.date)] || {};
  const note = $('#planNote');
  $('#planLabel').textContent = state.followsToday ? 'plano de hoje' : 'plano do dia';
  if (p.title) {
    note.classList.remove('is-empty');
    $('#planTitle').textContent = p.title;
    $('#planDetail').textContent = p.detail || '';
  } else {
    note.classList.add('is-empty');
    $('#planTitle').textContent = 'dia livre — faz o que der vontade';
    $('#planDetail').innerHTML = Object.values(cfg.plan).some(x => x.title) ? '' :
      '<button type="button" class="linkish" data-open-settings>montar meu plano da semana</button>';
  }
}

function renderActivities() {
  const cfg = getConfig();
  const sel = state.rec.activities;
  $('#customCat').innerHTML = CATEGORY_IDS.map(id => `<option value="${id}">${esc(cfg.categories[id].label)}</option>`).join('');
  $('#actGroups').innerHTML = CATEGORY_IDS.map(id => {
    const list = [...cfg.categories[id].activities];
    sel.filter(a => a.c === id && !list.includes(a.l)).forEach(a => list.push(a.l));
    if (!list.length) return '';
    return `<div class="cat" style="--c:var(--c-${id})">
      <div class="cat-label"><i></i>${esc(cfg.categories[id].label)}</div>
      <div class="tags">${list.map(l => {
        const on = sel.some(a => a.c === id && a.l === l);
        return `<button type="button" class="tag${on ? ' on' : ''}" style="--c:var(--c-${id})" data-c="${id}" data-l="${esc(l)}" aria-pressed="${on}">${CHECK}${esc(l)}</button>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

function renderEnergy() {
  const v = state.rec.energy || 0;
  document.querySelectorAll('.sun-btn').forEach(b => {
    const n = Number(b.dataset.v);
    b.classList.toggle('on', n <= v);
    b.setAttribute('aria-checked', String(n === v));
  });
  $('#energyWord').textContent = v ? ENERGY_WORDS[v] : '';
}

function renderFood() {
  document.querySelectorAll('.food-opt').forEach(b => {
    const on = b.dataset.v === state.rec.foodTag;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
}

const fmtNum = (n, d = 0) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d });

export async function renderNutrition() {
  const el = $('#nutrition');
  const date = state.date;
  const h = await getHealth(date);
  if (date !== state.date) return; // day changed while loading
  const has = h && ['kcal', 'protein', 'carbs', 'fat', 'water'].some(k => h[k] != null);
  if (!has && !isConfigured()) { el.hidden = true; return; }
  el.hidden = false;
  const refresh = state.followsToday && isConfigured()
    ? '<button type="button" class="nutri-refresh" data-run-shortcut>atualizar</button>' : '';
  if (!has) {
    el.innerHTML = `<div class="nutri-head"><span>Lifesum · Apple Saúde</span>${refresh}</div>
      <p class="nutri-empty">sem números pra esse dia</p>`;
    return;
  }
  const macro = (label, v) => v == null ? '' : `<span class="macro"><b>${fmtNum(v)}</b> g ${label}</span>`;
  el.innerHTML = `<div class="nutri-head"><span>Lifesum · Apple Saúde</span>${refresh}</div>
    <div class="nutri-kcal">${h.kcal != null ? `${fmtNum(h.kcal)}<small>kcal</small>` : '—'}</div>
    <div class="macros">${macro('proteína', h.protein)}${macro('carbo', h.carbs)}${macro('gordura', h.fat)}${h.water != null ? `<span class="macro"><b>${fmtNum(h.water / 1000, 1)}</b> L água</span>` : ''}</div>`;
}

async function renderFiles() {
  objectUrls.forEach(u => URL.revokeObjectURL(u));
  objectUrls = [];
  const el = $('#attachments');
  const items = await Promise.all(state.rec.files.map(async (f, i) => {
    const blob = await fileBlob(f.id);
    let inner;
    if (blob && f.type.startsWith('image/')) {
      const u = URL.createObjectURL(blob);
      objectUrls.push(u);
      inner = `<div class="ph" style="background-image:url('${u}')"></div>`;
    } else {
      inner = `<div class="ph">${f.type === 'application/pdf' ? 'PDF' : blob ? 'arquivo' : 'no Drive'}</div>`;
    }
    const r = [-2.5, 1.8, -1, 2.4][i % 4];
    return `<div class="polaroid" style="--r:${r}deg" data-id="${f.id}" role="button" tabindex="0" aria-label="Abrir ${esc(f.name)}">
      ${inner}<div class="cap">${esc(f.name)}</div>
      <button type="button" class="x" data-id="${f.id}" aria-label="Remover ${esc(f.name)}">×</button>
    </div>`;
  }));
  el.innerHTML = items.join('') + `<button type="button" class="add-photo">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6"/></svg>
    anexar print ou PDF</button>`;
}

async function openFile(meta) {
  if (!meta) return;
  const blob = await fileBlob(meta.id);
  if (!blob) {
    if (meta.driveUrl) window.open(meta.driveUrl, '_blank', 'noopener');
    else toast('Esse arquivo não está neste celular.');
    return;
  }
  const file = new File([blob], meta.name, { type: meta.type });
  const viewer = $('#viewer');
  if (meta.type.startsWith('image/')) {
    const u = URL.createObjectURL(blob);
    viewer.innerHTML = `<button type="button" class="v-share">compartilhar</button><button type="button" class="v-close" aria-label="Fechar">×</button><img src="${u}" alt="${esc(meta.name)}">`;
    viewer.hidden = false;
    const close = () => { viewer.hidden = true; viewer.innerHTML = ''; URL.revokeObjectURL(u); };
    viewer.querySelector('.v-close').onclick = close;
    viewer.querySelector('img').onclick = close;
    viewer.querySelector('.v-share').onclick = () => shareFile(file);
  } else {
    shareFile(file);
  }
}

async function shareFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch (e) { /* cancelled */ }
  } else {
    const u = URL.createObjectURL(file);
    window.open(u, '_blank');
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }
}
