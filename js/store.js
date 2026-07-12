// store.js — livello dati.
// Movimenti + impostazioni condivise: Firestore (cloud, in tempo reale).
// Preferenze locali del dispositivo (tema, colore, PIN): localStorage.
import { monthKey } from './format.js';
import { SEED } from './seed.js';
import {
  db, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, getDocs, writeBatch,
} from './firebase.js';

const DEFAULT_PEOPLE = ['Cecio', 'Gaia', 'Max', 'Evelyn'];
const LOCAL_KEY = 'saldoapp:local';
const LOCAL_KEYS = new Set(['tema', 'accent', 'pin', 'pinLen']); // preferenze per dispositivo

function cloudDefaults() {
  return { saldoIniziale: 0, valuta: 'EUR', people: [...DEFAULT_PEOPLE], budget: 0, dataVersion: 2 };
}
function localDefaults() {
  return { tema: 'auto', accent: '#7C5CFF', pin: '', pinLen: 0 };
}

let state = {
  cloud: cloudDefaults(),
  local: localDefaults(),
  movements: [],
};
let cloudEmpty = true;         // true finché non esiste settings/main
const listeners = new Set();

// ---- preferenze locali ----
export function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) state.local = { ...localDefaults(), ...JSON.parse(raw) };
  } catch (e) { console.error('Errore preferenze locali:', e); }
  return state.local;
}
function persistLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state.local)); } catch (e) { console.error(e); }
}
export function getLocal() { return state.local; }

// ---- osservabilità ----
export function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { listeners.forEach((cb) => cb(state)); }

// ---- accessi ----
// getSettings(): impostazioni condivise (cloud) + preferenze locali unite.
export function getSettings() { return { ...state.cloud, ...state.local }; }
export function getState() { return { movements: state.movements, settings: getSettings() }; }
export function cloudIsEmpty() { return cloudEmpty; }

// ---- realtime cloud ----
export function initCloud() {
  return new Promise((resolve) => {
    let gotS = false, gotM = false;
    const done = () => { if (gotS && gotM) resolve(); };
    onSnapshot(doc(db, 'settings', 'main'), (snap) => {
      if (snap.exists()) { cloudEmpty = false; state.cloud = { ...cloudDefaults(), ...snap.data() }; }
      else { cloudEmpty = true; state.cloud = cloudDefaults(); }
      gotS = true; emit(); done();
    }, (err) => { console.error('settings snapshot:', err); gotS = true; done(); });

    onSnapshot(collection(db, 'movements'), (snap) => {
      state.movements = snap.docs.map((d) => ({ ...normalize(d.data()), id: d.id }));
      gotM = true; emit(); done();
    }, (err) => { console.error('movements snapshot:', err); gotM = true; done(); });
  });
}

// ---- impostazioni ----
// setSetting: preferenza locale -> localStorage; impostazione condivisa -> Firestore (solo admin).
export async function setSetting(key, value) {
  if (LOCAL_KEYS.has(key)) {
    state.local[key] = value; persistLocal(); emit(); return;
  }
  state.cloud[key] = value; emit(); // ottimistico
  try { await setDoc(doc(db, 'settings', 'main'), { [key]: value }, { merge: true }); }
  catch (e) { console.error('setSetting cloud (permesso negato?):', e); }
}

// ---- CRUD movimenti (Firestore) ----
export async function addMovement(m) {
  return addDoc(collection(db, 'movements'), cleanMov(m));
}
export async function updateMovement(id, patch) {
  const cur = getMovement(id) || {};
  return updateDoc(doc(db, 'movements', id), cleanMov({ ...cur, ...patch }));
}
export async function deleteMovement(id) {
  return deleteDoc(doc(db, 'movements', id));
}
export function getMovement(id) {
  return state.movements.find((x) => x.id === id) || null;
}

// Import Excel (admin): sostituisce tutti i movimenti + impostazioni condivise.
export async function replaceAll({ movements, settings }) {
  await wipeAndWrite(movements || [], settings || null);
}
// Reset (admin): svuota i movimenti (mantiene le impostazioni).
export async function clearAll() {
  const existing = await getDocs(collection(db, 'movements'));
  const batch = writeBatch(db);
  existing.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// Migrazione una-tantum: carica nel cloud i dati locali del vecchio storage (o il seed).
export async function migrateLocalToCloud() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem('saldoapp:v1') || 'null'); } catch { /* ignore */ }
  const movements = (local && Array.isArray(local.movements) && local.movements.length)
    ? local.movements : (SEED && SEED.movements) || [];
  const settings = (local && local.settings) ? local.settings : (SEED && SEED.settings) || {};
  await wipeAndWrite(movements, settings);
}

async function wipeAndWrite(movements, settings) {
  const existing = await getDocs(collection(db, 'movements'));
  const batch = writeBatch(db);
  existing.forEach((d) => batch.delete(d.ref));
  for (const m of movements) batch.set(doc(collection(db, 'movements')), cleanMov(m));
  const s = settings || {};
  batch.set(doc(db, 'settings', 'main'), {
    saldoIniziale: Number(s.saldoIniziale) || 0,
    valuta: s.valuta || 'EUR',
    people: Array.isArray(s.people) && s.people.length ? s.people : [...DEFAULT_PEOPLE],
    budget: Number(s.budget) || 0,
    dataVersion: 2,
  }, { merge: true });
  await batch.commit();
}

function cleanMov(m) {
  const n = normalize(m);
  delete n.id;
  return n;
}
function normalize(m) {
  const type = m.type === 'out' ? 'out' : 'in';
  return {
    id: m.id,
    date: (m.date || '').slice(0, 10),
    description: (m.description || '').toString().trim(),
    category: m.category || 'Altro',
    type,
    amount: Math.abs(Number(m.amount) || 0),
    note: (m.note || '').toString(),
    person: (m.person || '').toString().trim(),
  };
}

// ---- persone ("Chi spende") — impostazione condivisa (solo admin scrive) ----
export function getPeople() {
  return Array.isArray(state.cloud.people) ? state.cloud.people : [];
}
export async function addPerson(name) {
  name = (name || '').toString().trim();
  if (!name) return null;
  const people = getPeople();
  if (people.includes(name)) return name;
  await setSetting('people', [...people, name]);
  return name;
}
export async function removePerson(name) {
  await setSetting('people', getPeople().filter((p) => p !== name));
}
// Assegna "Chi spende" = categoria per i movimenti la cui categoria è un nome persona.
export async function assignPersonFromCategory(names) {
  const list = Array.isArray(names) && names.length ? names : getPeople();
  const set = new Set(list);
  const batch = writeBatch(db);
  let n = 0;
  for (const m of state.movements) {
    if (!m.person && set.has(m.category)) { batch.update(doc(db, 'movements', m.id), { person: m.category }); n++; }
  }
  if (n) await batch.commit();
  return n;
}

// ================= calcoli (invariati) =================
export function getMovementsSorted() {
  return state.movements
    .map((m, idx) => ({ m, idx }))
    .sort((a, b) => {
      if (a.m.date < b.m.date) return -1;
      if (a.m.date > b.m.date) return 1;
      return a.idx - b.idx;
    })
    .map((x) => x.m);
}

export function withRunningBalance() {
  let bal = Number(state.cloud.saldoIniziale) || 0;
  return getMovementsSorted().map((m) => {
    bal += m.type === 'in' ? m.amount : -m.amount;
    return { ...m, balance: bal };
  });
}

export function currentBalance() {
  const start = Number(state.cloud.saldoIniziale) || 0;
  return state.movements.reduce((acc, m) => acc + (m.type === 'in' ? m.amount : -m.amount), start);
}

export function totals(movements = state.movements) {
  let entrate = 0, uscite = 0;
  for (const m of movements) { if (m.type === 'in') entrate += m.amount; else uscite += m.amount; }
  return { entrate, uscite, netto: entrate - uscite };
}

export function monthlySummary() {
  const map = new Map();
  for (const m of state.movements) {
    const k = monthKey(m.date);
    if (!k) continue;
    if (!map.has(k)) map.set(k, { ym: k, entrate: 0, uscite: 0 });
    const row = map.get(k);
    if (m.type === 'in') row.entrate += m.amount; else row.uscite += m.amount;
  }
  return [...map.values()].map((r) => ({ ...r, netto: r.entrate - r.uscite })).sort((a, b) => (a.ym < b.ym ? -1 : 1));
}

export function balanceByMonth() {
  const months = monthlySummary();
  let bal = Number(state.cloud.saldoIniziale) || 0;
  return months.map((r) => { bal += r.netto; return { ym: r.ym, balance: bal }; });
}

export function matchPeriod(dateISO, period) {
  if (!period) return true;
  if (typeof period === 'string') return monthKey(dateISO) === period;
  const d = dateISO || '';
  if (period.from && d < period.from) return false;
  if (period.to && d > period.to) return false;
  return true;
}

export function categoryTotals(type, period = null) {
  const map = new Map();
  for (const m of state.movements) {
    if (m.type !== type) continue;
    if (!matchPeriod(m.date, period)) continue;
    map.set(m.category, (map.get(m.category) || 0) + m.amount);
  }
  return [...map.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

export function personTotals(type, period = null) {
  const map = new Map();
  for (const m of state.movements) {
    if (m.type !== type || !m.person) continue;
    if (!matchPeriod(m.date, period)) continue;
    map.set(m.person, (map.get(m.person) || 0) + m.amount);
  }
  return [...map.entries()].map(([person, total]) => ({ person, total })).sort((a, b) => b.total - a.total);
}

export function availableMonths() { return monthlySummary().map((r) => r.ym); }

export function personOverTime(type = 'out') {
  const months = monthlySummary().map((r) => r.ym);
  const idx = new Map(months.map((m, i) => [m, i]));
  const map = new Map();
  for (const m of state.movements) {
    if (m.type !== type || !m.person) continue;
    const k = monthKey(m.date);
    if (!idx.has(k)) continue;
    if (!map.has(m.person)) map.set(m.person, new Array(months.length).fill(0));
    map.get(m.person)[idx.get(k)] += m.amount;
  }
  const people = [...map.entries()].map(([person, monthly]) => {
    let run = 0; const cumulative = monthly.map((v) => (run += v));
    return { person, monthly, cumulative, total: run };
  }).sort((a, b) => b.total - a.total);
  return { months, people };
}
