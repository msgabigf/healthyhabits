// The day being viewed/edited, shared by Hoje and Sono.

import { getRecord, saveRecord } from './data.js';
import { scheduleSync } from './sync.js';
import { todayISO } from './util.js';

export const state = {
  date: todayISO(),
  rec: null,
  // true while the user is looking at "today" — used to roll over at midnight
  followsToday: true,
};

const listeners = new Set();
export function onDayChange(fn) { listeners.add(fn); }
function emit() { listeners.forEach(fn => fn(state)); }

let pending = null;
let timer = null;

// write any in-flight edit now (before switching days, attaching, or backgrounding)
export async function flush() {
  clearTimeout(timer);
  timer = null;
  if (!pending) return;
  const rec = pending;
  pending = null;
  await saveRecord(rec);
  scheduleSync();
}

// every edit goes through here: update in memory right away, write shortly after
export function update(patch) {
  state.rec = { ...state.rec, ...patch };
  pending = state.rec;
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}

export async function openDay(date) {
  await flush();
  state.date = date;
  state.followsToday = date === todayISO();
  state.rec = await getRecord(date);
  emit();
}

export async function reloadDay() {
  if (pending) return; // don't clobber an edit that hasn't been written yet
  state.rec = await getRecord(state.date);
  emit();
}

export function replaceRecord(rec) {
  state.rec = rec;
  scheduleSync();
}

// If the app sat in memory overnight, jump to the new day.
export async function checkRollover() {
  const t = todayISO();
  if (state.followsToday && state.date !== t) {
    await openDay(t);
    return true;
  }
  return false;
}
