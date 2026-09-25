import { checkins, kv } from './store.js';
import { getConfig, CATEGORY_IDS } from './config.js';
import { hasContent, normalizeRecord } from './data.js';
import { $, esc, todayISO, iso, addDays, weekStart, parseISO, fmtShort, fmtDuration, minutesBetween, MONTHS, WEEKDAYS, weekday } from './util.js';

const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
let calMonth = null; // Date, first of month
let onPickDay = () => {};
let hideTip = () => {};

export function initDiary({ pickDay }) {
  onPickDay = pickDay;
  document.addEventListener('scroll', () => hideTip(), { passive: true });
  $('#calPrev').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() - 1); renderDiary(); });
  $('#calNext').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() + 1); renderDiary(); });
  $('#cal').addEventListener('click', (e) => {
    const b = e.target.closest('.cal-day');
    if (b && !b.disabled) onPickDay(b.dataset.date);
  });
  $('#recentList').addEventListener('click', (e) => {
    const b = e.target.closest('.day-row');
    if (b) onPickDay(b.dataset.date);
  });
}

function cats(rec) {
  const set = new Set(rec.activities.map(a => a.c));
  return CATEGORY_IDS.filter(id => set.has(id));
}

export async function renderDiary() {
  const today = todayISO();
  if (!calMonth) { const t = parseISO(today); calMonth = new Date(t.getFullYear(), t.getMonth(), 1); }
  const all = (await checkins.all()).map(normalizeRecord).filter(hasContent);
  const byDate = new Map(all.map(r => [r.date, r]));

  renderTally(byDate, today);
  renderCalendar(byDate, today);
  renderCharts(byDate, today);
  renderRecent(all, (await kv.get('health')) || {});
  $('#diarioSub').textContent = all.length
    ? `${all.length} ${all.length === 1 ? 'dia registrado' : 'dias registrados'}`
    : 'seus dias vão aparecendo aqui';
}

function renderTally(byDate, today) {
  const cfg = getConfig();
  const start = weekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  $('#weekRange').textContent = `${fmtShort(days[0])} – ${fmtShort(days[6])}`;
  // counts days with that category (two força classes in a day = 1 day)
  const count = Object.fromEntries(CATEGORY_IDS.map(id => [id, 0]));
  days.forEach(d => { const r = byDate.get(d); if (r) cats(r).forEach(c => count[c]++); });

  const rows = CATEGORY_IDS.filter(id => cfg.categories[id].target > 0 || count[id] > 0).map(id => {
    const target = cfg.categories[id].target, n = count[id];
    const boxes = Array.from({ length: Math.max(target, n) }, (_, i) =>
      `<span class="box${i < n ? ' done' : ''}${i >= target ? ' extra' : ''}">${i < n ? CHECK : ''}</span>`).join('');
    return `<div class="tally" style="--c:var(--c-${id})">
      <div class="tally-name"><i></i>${esc(cfg.categories[id].label)}</div>
      <div class="tally-count">${n}${target ? ` de ${target}` : ''}</div>
      <div class="tally-boxes" aria-hidden="true">${boxes}</div>
    </div>`;
  });
  $('#weekTally').innerHTML = rows.join('') || '<p class="tally-none">Defina metas em Ajustes.</p>';
}

function renderCalendar(byDate, today) {
  const cfg = getConfig();
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $('#calTitle').textContent = MONTHS[m] + (y !== parseISO(today).getFullYear() ? ` ${y}` : '');
  const first = iso(new Date(y, m, 1));
  const offset = (weekday(first) + 6) % 7;
  const nDays = new Date(y, m + 1, 0).getDate();
  const head = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(l => `<div class="dow">${l}</div>`).join('');
  const blanks = '<div></div>'.repeat(offset);
  const cells = Array.from({ length: nDays }, (_, i) => {
    const d = iso(new Date(y, m, i + 1));
    const r = byDate.get(d);
    const future = d > today;
    const c = r ? cats(r) : [];
    const label = `${i + 1} de ${MONTHS[m]}` + (c.length ? ': ' + c.map(id => cfg.categories[id].label).join(', ') : r ? ': registrado' : '');
    return `<button type="button" class="cal-day${r ? ' has' : ''}${d === today ? ' today' : ''}${future ? ' future' : ''}" data-date="${d}" ${future ? 'disabled' : ''} aria-label="${esc(label)}">
      ${i + 1}
      <span class="dots">${c.map(id => `<i style="--c:var(--c-${id})"></i>`).join('')}</span>
      ${r && r.sleepTime && r.wakeTime ? '<span class="moon"></span>' : ''}
    </button>`;
  }).join('');
  $('#cal').innerHTML = head + blanks + cells;
  const t = parseISO(today);
  $('#calNext').disabled = y > t.getFullYear() || (y === t.getFullYear() && m >= t.getMonth());
  $('#calLegend').innerHTML = CATEGORY_IDS.map(id => `<span><i style="--c:var(--c-${id})"></i>${esc(cfg.categories[id].label)}</span>`).join('')
    + '<span><i style="--c:var(--c-sleep);opacity:.7;width:6px;height:6px"></i>sono anotado</span>';
}

// ---- mini charts: same 14-day x axis, one measure each (no dual axis) ----

const W = 320, PADL = 22, PADR = 6;

function xAxis(days) {
  const step = (W - PADL - PADR) / days.length;
  return { step, x: (i) => PADL + i * step + step / 2 };
}

function renderCharts(byDate, today) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const recs = days.map(d => byDate.get(d));
  const goal = (getConfig().sleepHours || 7) * 60;
  const { step, x } = xAxis(days);
  const xLabels = (H) => days.map((d, i) => (i % 3 === 1 || i === 13)
    ? `<text class="axis-label" x="${x(i)}" y="${H - 2}" text-anchor="middle">${parseISO(d).getDate()}</text>` : '').join('');

  // sleep bars
  const sleep = recs.map(r => r ? minutesBetween(r.sleepTime, r.wakeTime) : null);
  const sv = sleep.filter(v => v != null);
  const sEl = $('#sleepChart');
  if (!sv.length) {
    sEl.innerHTML = '<div class="mc-title"><span>sono</span></div><div class="empty">nenhuma noite anotada ainda</div>';
  } else {
    const H = 110, top = 8, base = H - 16, max = 10 * 60;
    const y = (v) => base - (v / max) * (base - top);
    const bw = Math.min(14, step - 4);
    const bars = sleep.map((v, i) => {
      if (v == null) return '';
      const x0 = x(i) - bw / 2, y0 = y(v), r = Math.min(4, (base - y0) / 2);
      return `<path class="bar" d="M${x0} ${base}V${y0 + r}q0 -${r} ${r} -${r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${base}z"/>`;
    }).join('');
    const grid = [0, 5, 10].map(h => `<line class="grid" x1="${PADL}" x2="${W - PADR}" y1="${y(h * 60)}" y2="${y(h * 60)}"/><text class="axis-label" x="${PADL - 5}" y="${y(h * 60) + 3}" text-anchor="end">${h}h</text>`).join('');
    const avg = Math.round(sv.reduce((a, b) => a + b, 0) / sv.length);
    sEl.innerHTML = `<div class="mc-title"><span>sono · média <b>${fmtDuration(avg)}</b></span><span>--- meta ${fmtDuration(goal)}</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas de sono nos últimos 14 dias, média ${fmtDuration(avg)}">
        ${grid}<line class="target" x1="${PADL}" x2="${W - PADR}" y1="${y(goal)}" y2="${y(goal)}"/>
        ${bars}${xLabels(H)}${hits(days, x, step, top, base)}
      </svg>`;
    wireTooltip(sEl, days, x, (i) => sleep[i] == null ? null : fmtDuration(sleep[i]) + ' de sono');
  }

  // energy line
  const energy = recs.map(r => r && r.energy ? r.energy : null);
  const ev = energy.filter(v => v != null);
  const eEl = $('#energyChart');
  if (!ev.length) {
    eEl.innerHTML = '<div class="mc-title"><span>energia</span></div><div class="empty">nenhuma energia anotada ainda</div>';
  } else {
    const H = 96, top = 8, base = H - 18;
    const y = (v) => base - ((v - 1) / 4) * (base - top);
    const grid = [1, 3, 5].map(v => `<line class="grid" x1="${PADL}" x2="${W - PADR}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${PADL - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('');
    // break the line across days without a value
    let d = '', pen = false;
    energy.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i)} ${y(v)}`; pen = true; });
    const dots = energy.map((v, i) => v == null ? '' : `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="4"/>`).join('');
    const avg = (ev.reduce((a, b) => a + b, 0) / ev.length).toFixed(1).replace('.', ',');
    eEl.innerHTML = `<div class="mc-title"><span>energia · média <b>${avg}</b></span><span>1 a 5</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Energia nos últimos 14 dias, média ${avg}">
        ${grid}<path class="line" d="${d}"/>${dots}${xLabels(H)}${hits(days, x, step, top, base)}
      </svg>`;
    wireTooltip(eEl, days, x, (i) => energy[i] == null ? null : 'energia ' + energy[i]);
  }
}

function hits(days, x, step, top, base) {
  return days.map((d, i) => `<rect class="hl" data-i="${i}" x="${x(i) - step / 2}" y="${top - 4}" width="${step}" height="${base - top + 4}" style="opacity:0"/>`
    + `<rect class="hit" data-i="${i}" x="${x(i) - step / 2}" y="0" width="${step}" height="${base + 14}"/>`).join('');
}

function wireTooltip(el, days, x, text) {
  const svg = el.querySelector('svg');
  let tip = null, hl = null;
  const hide = () => { tip && tip.remove(); tip = null; if (hl) hl.style.opacity = 0; hl = null; };
  const show = (i) => {
    const t = text(i);
    hideTip();
    hideTip = hide;
    if (!t) return;
    hl = svg.querySelector(`.hl[data-i="${i}"]`);
    if (hl) hl.style.opacity = '';
    tip = document.createElement('div');
    tip.className = 'tip';
    const d = days[i];
    tip.textContent = `${WEEKDAYS[weekday(d)].slice(0, 3)} ${fmtShort(d)} · ${t}`;
    const scale = svg.getBoundingClientRect().width / W;
    const left = Math.max(60, Math.min(svg.getBoundingClientRect().width - 60, x(i) * scale));
    tip.style.left = left + 'px';
    tip.style.top = '-6px';
    el.appendChild(tip);
  };
  svg.addEventListener('pointerdown', (e) => { const r = e.target.closest('.hit'); if (r) show(Number(r.dataset.i)); });
  svg.addEventListener('pointermove', (e) => {
    const r = document.elementFromPoint(e.clientX, e.clientY);
    if (r && r.classList && r.classList.contains('hit') && svg.contains(r)) show(Number(r.dataset.i));
  });
  svg.addEventListener('pointerleave', hide);
}

function renderRecent(all, health) {
  const cfg = getConfig();
  const recent = [...all].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  if (!recent.length) {
    $('#recentList').innerHTML = '<p class="empty-note">Nenhum dia registrado ainda — começa pela aba hoje.</p>';
    return;
  }
  $('#recentList').innerHTML = recent.map(r => {
    const d = parseISO(r.date);
    const acts = r.activities.map(a => `<span><i style="--c:var(--c-${CATEGORY_IDS.includes(a.c) ? a.c : 'forca'})"></i>${esc(a.l)}</span>`).join('')
      || '<span style="color:var(--ink-3)">sem movimento</span>';
    const meta = [];
    const sm = minutesBetween(r.sleepTime, r.wakeTime);
    if (sm != null) meta.push(`dormiu ${fmtDuration(sm)}`);
    if (r.energy) meta.push(`energia ${r.energy}`);
    if (r.foodTag) meta.push({ 'consistente': 'comida no plano', 'mais-ou-menos': 'comida mais ou menos', 'fugiu': 'comida fugiu do plano' }[r.foodTag] || '');
    const h = health[r.date];
    if (h && h.kcal != null) meta.push(`${Math.round(h.kcal).toLocaleString('pt-BR')} kcal`);
    if (r.files.length) meta.push(`${r.files.length} anexo${r.files.length > 1 ? 's' : ''}`);
    if (r.movNote) meta.push(`“${esc(r.movNote)}”`);
    return `<button type="button" class="day-row" data-date="${r.date}">
      <div class="dr-date"><b>${d.getDate()}</b><span>${WEEKDAYS[d.getDay()].slice(0, 3)}</span></div>
      <div class="dr-main"><div class="dr-acts">${acts}</div><div class="dr-meta">${meta.join(' · ')}</div></div>
    </button>`;
  }).join('');
}
