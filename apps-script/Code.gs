/**
 * Rotina — sync endpoint that lives inside YOUR Google Sheet.
 *
 * Setup (once, ~5 min — full steps in README.md):
 *   1. Create a new Google Sheet → Extensions → Apps Script → paste this file.
 *   2. Run `setup` once and accept the permissions. The log prints your secret code.
 *   3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *   4. Paste the web app URL + secret code into the app (Ajustes → Google Sheet).
 *   (Updating this file later: paste the new version, Save, then
 *    Deploy → Manage deployments → edit → Version: New version → Deploy.
 *    The URL stays the same. Run `setup` again if the notes say so.)
 *
 * "Anyone" only means the URL is reachable; every request must carry the
 * secret code, and the script only ever touches this one Sheet + one folder.
 */

const CHECKINS = 'Checkins';
const CONFIG = 'Config';
const HEALTH = 'Saúde';
const FOLDER_PROP = 'FOLDER_ID';
const FOLDER_NAME = 'Rotina — anexos';

const HEADERS = [
  'data', 'dia', 'atividades', 'categorias', 'nota do treino', 'energia (1-5)',
  'alimentação', 'dormiu', 'acordou', 'horas de sono', 'anexos', 'atualizado em', 'json',
];
const HEALTH_HEADERS = ['data', 'calorias (kcal)', 'proteína (g)', 'carboidratos (g)', 'gordura (g)', 'água (ml)', 'recebido em'];
const HEALTH_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'water'];
const FOOD = { 'consistente': 'no plano', 'mais-ou-menos': 'mais ou menos', 'fugiu': 'fugiu do plano' };

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CHECKINS) || ss.insertSheet(CHECKINS);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  // keep dates and times as plain text so Sheets doesn't reformat them
  sh.getRange('A:L').setNumberFormat('@');
  sh.hideColumns(HEADERS.length); // raw json column, used by the app
  const hs = ss.getSheetByName(HEALTH) || ss.insertSheet(HEALTH);
  hs.getRange(1, 1, 1, HEALTH_HEADERS.length).setValues([HEALTH_HEADERS]).setFontWeight('bold');
  hs.setFrozenRows(1);
  hs.getRange('A:A').setNumberFormat('@');
  const cfg = ss.getSheetByName(CONFIG) || ss.insertSheet(CONFIG);
  cfg.getRange('A1:B1').setValues([['config (json — edite pelo app)', 'atualizado em']]).setFontWeight('bold');
  const first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Página1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
  folder_();
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    props.setProperty('TOKEN', token);
  }
  Logger.log('Seu código secreto: ' + token);
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad request' }); }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || req.token !== token) return out_({ ok: false, error: 'unauthorized' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    switch (req.action) {
      case 'ping': return out_({ ok: true, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() });
      case 'upsert': return out_({ ok: true, count: upsert_(req.checkins || []) });
      case 'upload': return out_(Object.assign({ ok: true }, upload_(req)));
      case 'pull': return out_({ ok: true, checkins: readAll_(), config: readConfig_(), health: readHealth_() });
      case 'health': return out_(Object.assign({ ok: true }, health_(req)));
      case 'saveConfig': writeConfig_(req.config); return out_({ ok: true });
      default: return out_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return out_({ ok: true, app: 'rotina' });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CHECKINS);
  if (!sh) throw new Error('Rode a função setup primeiro.');
  return sh;
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(FOLDER_PROP);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  const f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty(FOLDER_PROP, f.getId());
  return f;
}

function sleepHours_(bed, wake) {
  if (!bed || !wake) return '';
  const b = bed.split(':').map(Number), w = wake.split(':').map(Number);
  let m = (w[0] * 60 + w[1]) - (b[0] * 60 + b[1]);
  if (m < 0) m += 1440;
  return String(Math.round(m / 6) / 10);
}

function row_(r) {
  const acts = r.activities || [];
  return [
    r.date, r.weekday || '',
    acts.map(a => a.l).join(' + '),
    acts.map(a => a.c).join(', '),
    r.movNote || '',
    r.energy ? String(r.energy) : '',
    FOOD[r.foodTag] || '',
    r.sleepTime || '', r.wakeTime || '',
    sleepHours_(r.sleepTime, r.wakeTime),
    (r.files || []).map(f => f.driveUrl).filter(String).join('\n'),
    r.updatedAt || '',
    JSON.stringify(r),
  ];
}

function upsert_(list) {
  const sh = sheet_();
  const last = sh.getLastRow();
  const dates = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(v => String(v[0])) : [];
  const updatedCol = HEADERS.indexOf('atualizado em') + 1;
  list.forEach(r => {
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return;
    const i = dates.indexOf(r.date);
    if (i >= 0) {
      const existing = String(sh.getRange(i + 2, updatedCol).getValue());
      if (existing && r.updatedAt && existing > r.updatedAt) return; // sheet has newer
      sh.getRange(i + 2, 1, 1, HEADERS.length).setValues([row_(r)]);
    } else {
      sh.appendRow(row_(r));
      dates.push(r.date);
    }
  });
  // keep newest day on top
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).sort({ column: 1, ascending: false });
  return list.length;
}

function readAll_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, HEADERS.length, last - 1, 1).getValues()
    .map(v => { try { return JSON.parse(v[0]); } catch (e) { return null; } })
    .filter(Boolean);
}

function upload_(req) {
  const blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.type || 'application/octet-stream', (req.date || '') + ' ' + (req.name || 'anexo'));
  const file = folder_().createFile(blob);
  return { id: file.getId(), url: file.getUrl() };
}

function readConfig_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG);
  if (!sh) return null;
  const v = sh.getRange('A2').getValue();
  try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

function writeConfig_(cfg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG) || ss.insertSheet(CONFIG);
  sh.getRange('A2:B2').setValues([[JSON.stringify(cfg, null, 1), (cfg && cfg.updatedAt) || '']]);
}

// ---- Apple Health (Lifesum etc.) via the iPhone Shortcut ----

// Shortcuts sends each nutrient as a list of sample values joined by new lines,
// in the phone's number format ("12,5", "1.234"). Sum them.
function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  let sum = 0, any = false;
  String(v).split(/[\n;]+/).forEach(part => {
    const m = part.match(/-?\d[\d.,]*/);
    if (!m) return;
    let t = m[0];
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = parseFloat(t);
    if (!isNaN(n)) { sum += n; any = true; }
  });
  return any ? Math.round(sum * 10) / 10 : null;
}

function health_(req) {
  const tz = Session.getScriptTimeZone();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.date || '') ? req.date : Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const data = req.data || {};
  const vals = HEALTH_KEYS.map(k => num_(data[k]));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(HEALTH);
  if (!sh) throw new Error('Rode a função setup de novo (aba Saúde).');
  const row = [date].concat(vals.map(v => v === null ? '' : v)).concat([new Date().toISOString()]);
  const last = sh.getLastRow();
  const dates = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(v => String(v[0])) : [];
  const i = dates.indexOf(date);
  if (i >= 0) sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, HEALTH_HEADERS.length).sort({ column: 1, ascending: false });
  const out = { date: date };
  HEALTH_KEYS.forEach((k, j) => { out[k] = vals[j]; });
  return out;
}

function readHealth_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HEALTH);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, Math.min(sh.getLastRow() - 1, 400), HEALTH_HEADERS.length).getValues().map(r => {
    const o = { date: String(r[0]) };
    HEALTH_KEYS.forEach((k, j) => { o[k] = r[j + 1] === '' ? null : Number(r[j + 1]); });
    return o;
  });
}
