import { getConfig, saveConfig, CATEGORY_IDS } from './config.js';
import { getSyncSettings, saveSyncSettings, testConnection, syncNow, onSyncStatus, isConfigured } from './sync.js';
import { exportBackup, importBackup, lastBackupText } from './backup.js';
import { kv } from './store.js';
import { $, esc, toast, debounce, WEEKDAYS } from './util.js';

const PLAN_ORDER = [1, 2, 3, 4, 5, 6, 0]; // segunda first

let afterImport = () => {};

export function initSettings({ onImported }) {
  afterImport = onImported;

  $('#cfgName').addEventListener('input', debounce(async (e) => {
    const next = structuredClone(getConfig());
    next.name = e.target.value.trim();
    await saveConfig(next);
    syncNow();
  }, 500));

  $('#cfgPlan').addEventListener('input', debounce(async (e) => {
    const row = e.target.closest('.plan-row');
    if (!row) return;
    const d = Number(row.dataset.d);
    const next = structuredClone(getConfig());
    next.plan[d] = { title: row.querySelector('.title').value.trim(), detail: row.querySelector('.detail').value.trim() };
    await saveConfig(next);
    syncNow();
  }, 500));

  $('#cfgCats').addEventListener('click', async (e) => {
    const cat = e.target.closest('.cfg-cat');
    if (!cat) return;
    const id = cat.dataset.id;
    const next = structuredClone(getConfig());
    const c = next.categories[id];
    if (e.target.closest('[data-step]')) {
      c.target = Math.max(0, Math.min(7, c.target + Number(e.target.closest('[data-step]').dataset.step)));
    } else if (e.target.closest('[data-remove]')) {
      c.activities.splice(Number(e.target.closest('[data-remove]').dataset.remove), 1);
    } else if (e.target.closest('[data-add]')) {
      const input = cat.querySelector('input');
      const v = input.value.trim().replace(/\s+/g, ' ');
      if (!v || c.activities.includes(v)) return;
      c.activities.push(v);
    } else return;
    await saveConfig(next);
    renderCats();
    syncNow();
  });
  $('#cfgCats').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.cfg-add input')) {
      e.preventDefault();
      e.target.closest('.cfg-cat').querySelector('[data-add]').click();
    }
  });

  $('#syncConnect').addEventListener('click', async () => {
    const url = $('#syncUrl').value.trim();
    const token = $('#syncToken').value.trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
      $('#syncDetail').textContent = 'O link precisa começar com https://script.google.com/ e terminar em /exec.';
      return;
    }
    await saveSyncSettings({ url, token });
    $('#syncDetail').textContent = 'testando…';
    try {
      const sheetUrl = await testConnection();
      await saveSyncSettings({ sheetUrl });
      $('#syncDetail').innerHTML = 'conectado ✓ — enviando seus dias…';
      const pulled = await syncNow({ withPull: true });
      afterImport(pulled);
      renderSyncDetail();
    } catch (err) {
      $('#syncDetail').textContent = 'Não conectou: ' + err.message;
    }
  });

  $('#syncPull').addEventListener('click', async () => {
    if (!isConfigured()) { toast('Conecte a planilha primeiro.'); return; }
    const pulled = await syncNow({ withPull: true });
    afterImport(pulled);
    toast(pulled && pulled.length ? `${pulled.length} dia(s) atualizados da planilha` : 'tudo em dia ✓');
  });

  onSyncStatus((st, err) => { syncState = { s: st, err }; renderSyncDetail(); });

  $('#exportBtn').addEventListener('click', async () => {
    try {
      await exportBackup();
      renderBackupNote();
    } catch (err) {
      toast('Não consegui exportar: ' + err.message);
    }
  });
  $('#importBtn').addEventListener('click', () => $('#importInput').click());
  $('#importInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const res = await importBackup(JSON.parse(await f.text()));
      toast(`importado: ${res.days} dia(s)${res.config ? ' + plano' : ''}`);
      afterImport();
      renderSettings();
    } catch (err) {
      toast('Arquivo não reconhecido.');
    }
  });
  $('#pasteCfgBtn').addEventListener('click', async () => {
    try {
      const obj = JSON.parse($('#pasteCfg').value);
      const res = await importBackup(obj.config || obj.plan || obj.categories ? { config: obj.config || obj } : obj);
      $('#pasteCfg').value = '';
      toast(res.config ? 'plano aplicado ✓' : `importado: ${res.days} dia(s)`);
      afterImport();
      renderSettings();
    } catch (err) {
      toast('Não entendi esse texto — confira se copiou tudo.');
    }
  });

  $('#themeSeg').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    await kv.set('theme', b.dataset.v);
    applyTheme(b.dataset.v);
    renderTheme(b.dataset.v);
  });
}

export function applyTheme(v) {
  if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v;
  else delete document.documentElement.dataset.theme;
  const dark = v === 'dark' || (v !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? '#14201A' : '#F7F1E6'; });
}

async function renderTheme(v) {
  v = v || (await kv.get('theme')) || 'auto';
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}

export function renderSettings() {
  const cfg = getConfig();
  if (document.activeElement !== $('#cfgName')) $('#cfgName').value = cfg.name || '';
  $('#cfgPlan').innerHTML = PLAN_ORDER.map(d => `<div class="plan-row" data-d="${d}">
    <span class="pr-day">${WEEKDAYS[d].slice(0, 3)}</span>
    <input type="text" class="title" placeholder="ex: Força" value="${esc(cfg.plan[d].title || '')}" aria-label="Plano de ${WEEKDAYS[d]}">
    <input type="text" class="detail" placeholder="onde / horário" value="${esc(cfg.plan[d].detail || '')}" aria-label="Detalhe de ${WEEKDAYS[d]}">
  </div>`).join('');
  renderCats();
  const s = getSyncSettings();
  $('#syncUrl').value = s.url || '';
  $('#syncToken').value = s.token || '';
  renderSyncDetail();
  renderBackupNote();
  renderTheme();
}

function renderCats() {
  const cfg = getConfig();
  $('#cfgCats').innerHTML = CATEGORY_IDS.map(id => {
    const c = cfg.categories[id];
    return `<div class="cfg-cat" data-id="${id}" style="--c:var(--c-${id})">
      <div class="cfg-cat-head"><i></i><b>${esc(c.label)}</b>
        <div class="stepper"><button type="button" data-step="-1" aria-label="Diminuir meta">−</button><output>${c.target ? `${c.target}× sem` : 'sem meta'}</output><button type="button" data-step="1" aria-label="Aumentar meta">+</button></div>
      </div>
      <div class="cfg-tags">${c.activities.map((a, i) => `<span class="cfg-tag">${esc(a)}<button type="button" data-remove="${i}" aria-label="Remover ${esc(a)}">×</button></span>`).join('')}</div>
      <div class="cfg-add"><input type="text" placeholder="nova atividade" enterkeyhint="done"><button type="button" data-add>adicionar</button></div>
    </div>`;
  }).join('');
}

let syncState = { s: 'off', err: '' };

function renderSyncDetail() {
  const s = getSyncSettings();
  const el = $('#syncDetail');
  if (!isConfigured()) { el.textContent = 'não conectado — seus dados estão só neste celular'; return; }
  if (syncState.s === 'error') { el.textContent = 'erro ao sincronizar: ' + syncState.err; return; }
  const when = s.lastSync ? new Date(s.lastSync).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ainda não';
  el.innerHTML = `última sincronização: ${esc(when)}${s.sheetUrl ? ` · <a href="${esc(s.sheetUrl)}" target="_blank" rel="noopener">abrir planilha</a>` : ''}`;
}

async function renderBackupNote() {
  $('#backupNote').textContent = 'Um arquivo com tudo (dias, plano e anexos). Salve no iCloud Drive pelo menu de compartilhar. ' + await lastBackupText();
}
