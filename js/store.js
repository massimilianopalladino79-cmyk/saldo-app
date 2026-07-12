// store.js — livello dati: movimenti, saldo progressivo, riepiloghi.
// Persistenza su localStorage (offline, stabile). Pattern osservabile.

import { monthKey, newId } from './format.js';
import { SEED } from './seed.js';

const KEY = 'saldoapp:v1';
const SEED_FLAG = 'saldoapp:seeded';

const DATA_VERSION = 1;
// Date dedotte (regola: data del movimento precedente nel file) per i 5 movimenti
// che nell'Excel erano senza data. Chiavi = ID stabili del seed.
const DATE_FIX = { x1: '2026-02-28', x3: '2026-03-10', x16: '2026-04-18', x17: '2026-04-18', x24: '2026-05-09' };
const DEFAULT_PEOPLE = ['Cecio', 'Gaia', 'Max', 'Evelyn'];

const DEFAULT_STATE = {
  // niente dataVersion qui: i dati già presenti (senza versione) devono risultare v0
  // così la migrazione parte. La versione viene impostata da migrate()/seed.
  settings: { saldoIniziale: 0, valuta: 'EUR', tema: 'auto', people: [...DEFAULT_PEOPLE], accent: '#7C5CFF', budget: 0, pin: '', pinLen: 0 },
  movements: [], // { id, date:'YYYY-MM-DD', description, category, type:'in'|'out', amount:Number, note, person }
};

let state = structuredClone(DEFAULT_STATE);
const listeners = new Set();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = {
        settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
        movements: Array.isArray(parsed.movements) ? parsed.movements : [],
      };
    } else if (!localStorage.getItem(SEED_FLAG) && SEED && Array.isArray(SEED.movements) && SEED.movements.length) {
      // primo avvio in assoluto: precarica i dati importati dall'Excel (una volta sola)
      state = {
        settings: { ...DEFAULT_STATE.settings, ...(SEED.settings || {}) },
        movements: SEED.movements.map((m) => ({ ...m, id: m.id || newId() })),
      };
      localStorage.setItem(SEED_FLAG, '1');
      persist();
    }
  } catch (e) {
    console.error('Errore lettura dati locali, riparto da stato vuoto:', e);
    state = structuredClone(DEFAULT_STATE);
  }
  if (migrate()) persist(); // aggiorna dati già presenti sul dispositivo
  return state;
}

// Migrazioni idempotenti sui dati esistenti (installazioni già attive).
function migrate() {
  const from = state.settings.dataVersion || 0;
  if (from >= DATA_VERSION) return false;
  if (from < 1) {
    for (const m of state.movements) {
      if (m.category === 'Francy') m.category = 'Cecio';        // rinomina persona
      if (!m.date && DATE_FIX[m.id]) m.date = DATE_FIX[m.id];   // date dedotte
      if (m.person == null) m.person = '';                      // nuovo campo
    }
    if (!Array.isArray(state.settings.people) || !state.settings.people.length) {
      state.settings.people = [...DEFAULT_PEOPLE];
    }
  }
  state.settings.dataVersion = DATA_VERSION;
  return true;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Errore salvataggio dati locali:', e);
    throw e;
  }
}

export function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { persist(); listeners.forEach((cb) => cb(state)); }

// ---- accessi ----
export function getState() { return state; }
export function getSettings() { return state.settings; }

export function setSetting(key, value) {
  state.settings[key] = value;
  emit();
}

// ---- CRUD movimenti ----
export function addMovement(m) {
  const mov = normalize(m);
  mov.id = newId();
  state.movements.push(mov);
  emit();
  return mov;
}

export function updateMovement(id, patch) {
  const i = state.movements.findIndex((x) => x.id === id);
  if (i === -1) return null;
  state.movements[i] = normalize({ ...state.movements[i], ...patch, id });
  emit();
  return state.movements[i];
}

export function deleteMovement(id) {
  const before = state.movements.length;
  state.movements = state.movements.filter((x) => x.id !== id);
  if (state.movements.length !== before) emit();
}

export function getMovement(id) {
  return state.movements.find((x) => x.id === id) || null;
}

// Sostituzione completa (usata dall'import Excel)
export function replaceAll({ movements, settings }) {
  state.movements = (movements || []).map(normalize).map((m) => ({ ...m, id: m.id || newId() }));
  if (settings) state.settings = { ...state.settings, ...settings };
  emit();
}

export function clearAll() {
  state.movements = [];
  emit();
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

// ---- persone ("Chi la usa" / a chi è destinata la spesa) ----
export function getPeople() {
  return Array.isArray(state.settings.people) ? state.settings.people : [];
}
export function addPerson(name) {
  name = (name || '').toString().trim();
  if (!name) return null;
  if (!Array.isArray(state.settings.people)) state.settings.people = [];
  if (!state.settings.people.includes(name)) { state.settings.people.push(name); emit(); }
  return name;
}
export function removePerson(name) {
  if (!Array.isArray(state.settings.people)) return;
  state.settings.people = state.settings.people.filter((p) => p !== name);
  emit();
}

// Totali per persona di un dato tipo ('in'|'out'), opz. filtrati per mese
export function personTotals(type, period = null) {
  const map = new Map();
  for (const m of state.movements) {
    if (m.type !== type || !m.person) continue;
    if (!matchPeriod(m.date, period)) continue;
    map.set(m.person, (map.get(m.person) || 0) + m.amount);
  }
  return [...map.entries()].map(([person, total]) => ({ person, total })).sort((a, b) => b.total - a.total);
}

// ---- ordinamento & saldo progressivo ----
// Ordina per data crescente; a parità di data mantiene l'ordine d'inserimento.
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

// Movimenti con saldo progressivo (dal più vecchio al più recente)
export function withRunningBalance() {
  let bal = Number(state.settings.saldoIniziale) || 0;
  return getMovementsSorted().map((m) => {
    bal += m.type === 'in' ? m.amount : -m.amount;
    return { ...m, balance: bal };
  });
}

export function currentBalance() {
  const start = Number(state.settings.saldoIniziale) || 0;
  return state.movements.reduce(
    (acc, m) => acc + (m.type === 'in' ? m.amount : -m.amount),
    start
  );
}

export function totals(movements = state.movements) {
  let entrate = 0, uscite = 0;
  for (const m of movements) {
    if (m.type === 'in') entrate += m.amount; else uscite += m.amount;
  }
  return { entrate, uscite, netto: entrate - uscite };
}

// Riepilogo per mese, ordinato cronologicamente
export function monthlySummary() {
  const map = new Map();
  for (const m of state.movements) {
    const k = monthKey(m.date);
    if (!k) continue;
    if (!map.has(k)) map.set(k, { ym: k, entrate: 0, uscite: 0 });
    const row = map.get(k);
    if (m.type === 'in') row.entrate += m.amount; else row.uscite += m.amount;
  }
  return [...map.values()]
    .map((r) => ({ ...r, netto: r.entrate - r.uscite }))
    .sort((a, b) => (a.ym < b.ym ? -1 : 1));
}

// Serie del saldo progressivo aggregata a fine mese (per il grafico ad area)
export function balanceByMonth() {
  const months = monthlySummary();
  let bal = Number(state.settings.saldoIniziale) || 0;
  return months.map((r) => {
    bal += r.netto;
    return { ym: r.ym, balance: bal };
  });
}

// period: null (tutto) | 'YYYY-MM' (un mese) | { from:'YYYY-MM-DD', to:'YYYY-MM-DD' }
export function matchPeriod(dateISO, period) {
  if (!period) return true;
  if (typeof period === 'string') return monthKey(dateISO) === period;
  const d = dateISO || '';
  if (period.from && d < period.from) return false;
  if (period.to && d > period.to) return false;
  return true;
}

// Totali per categoria di un dato tipo ('in'|'out'), opzionalmente filtrati per periodo
export function categoryTotals(type, period = null) {
  const map = new Map();
  for (const m of state.movements) {
    if (m.type !== type) continue;
    if (!matchPeriod(m.date, period)) continue;
    map.set(m.category, (map.get(m.category) || 0) + m.amount);
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

// Elenco dei mesi presenti nei dati (per i selettori periodo)
export function availableMonths() {
  return monthlySummary().map((r) => r.ym);
}

// "Quanto ho dato a ciascuno nel tempo": per ogni persona, importi per mese
// (monthly) e cumulato (cumulative), sull'asse di tutti i mesi presenti.
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
    let run = 0;
    const cumulative = monthly.map((v) => (run += v));
    return { person, monthly, cumulative, total: run };
  }).sort((a, b) => b.total - a.total);
  return { months, people };
}
