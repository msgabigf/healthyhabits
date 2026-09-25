import { state, update } from './state.js';
import { getConfig } from './config.js';
import { kv } from './store.js';
import { $, minutesBetween, fmtDuration, addDays, WEEKDAYS, weekday } from './util.js';

const DURATIONS = [6, 6.5, 7, 7.5, 8];
const WIND_DOWN = 30; // minutes to fall asleep
const SCREENS_OFF = 30; // extra minutes before that

let calc = { commit: '', dur: 7 };

export async function initSleep() {
  calc = { ...calc, dur: getConfig().sleepHours || 7, ...(await kv.get('bedCalc') || {}) };
  $('#sleepTime').addEventListener('input', (e) => { update({ sleepTime: e.target.value }); renderSleepResult(); });
  $('#wakeTime').addEventListener('input', (e) => { update({ wakeTime: e.target.value }); renderSleepResult(); });

  const seg = $('#durSeg');
  seg.innerHTML = DURATIONS.map(d => `<button type="button" role="radio" data-v="${d}">${fmtDuration(d * 60)}</button>`).join('');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    calc.dur = Number(b.dataset.v);
    saveCalc();
    renderCalc();
  });
  $('#commitTime').addEventListener('input', (e) => { calc.commit = e.target.value; saveCalc(); renderCalc(); });
  $('#commitTime').value = calc.commit;
  renderCalc();
}

function saveCalc() { kv.set('bedCalc', calc).catch(() => {}); }

export function renderSleep() {
  const prev = addDays(state.date, -1);
  $('#nightLabel').textContent = `${WEEKDAYS[weekday(prev)].slice(0, 3)} → ${WEEKDAYS[weekday(state.date)].slice(0, 3)}`;
  $('#sleepTime').value = state.rec.sleepTime || '';
  $('#wakeTime').value = state.rec.wakeTime || '';
  renderSleepResult();
}

function renderSleepResult() {
  const el = $('#sleepResult');
  const mins = minutesBetween(state.rec.sleepTime, state.rec.wakeTime);
  if (mins == null) {
    el.innerHTML = '<p class="empty-note">preenche os dois horários pra ver quanto dormiu</p>';
    return;
  }
  const goal = (getConfig().sleepHours || 7) * 60;
  const max = 10 * 60;
  const diff = mins - goal;
  const verdict = Math.abs(diff) < 15 ? 'na meta' : diff > 0 ? `${fmtDuration(diff)} a mais` : `${fmtDuration(-diff)} a menos`;
  el.innerHTML = `
    <div class="big">${fmtDuration(mins)}<small>${verdict}</small></div>
    <div class="sleep-meter" role="img" aria-label="${fmtDuration(mins)} de ${fmtDuration(goal)}">
      <div class="fill" style="width:${Math.min(100, mins / max * 100)}%"></div>
      <div class="goal" style="left:${goal / max * 100}%"></div>
    </div>
    <div class="sleep-meter-labels"><span>0h</span><span>meta ${fmtDuration(goal)}</span><span>10h</span></div>`;
}

function renderCalc() {
  document.querySelectorAll('#durSeg button').forEach(b => {
    const on = Number(b.dataset.v) === calc.dur;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  const box = $('#bedtime');
  if (!calc.commit) { box.hidden = true; return; }
  const [h, m] = calc.commit.split(':').map(Number);
  const wake = h * 60 + m;
  const fmt = (t) => { t = ((t % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const bed = wake - calc.dur * 60 - WIND_DOWN;
  $('#bedAt').textContent = fmt(bed);
  $('#screensOff').textContent = fmt(bed - SCREENS_OFF);
  box.hidden = false;
}
