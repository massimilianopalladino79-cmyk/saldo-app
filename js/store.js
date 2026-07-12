// store.js — livello dati: movimenti, saldo progressivo, riepiloghi.
// Persistenza su localStorage (offline, stabile). Pattern osservabile.

import { monthKey, newId } from './format.js';
import { SEED } from './seed.js';

const KEY = 'saldoapp:v1';
const SEED_FLAG = 'saldoapp:seeded';

const DEFAULT_STATE = {
  settings: { saldoIniziale: 0, valuta: 'EUR', tema: 'auto' },
  movements: [], // { id, date:'YYYY-MM-DD', description, category, type:'in'|'out', amount:Number, note }
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
  return state;
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
  };
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

// Totali per categoria di un dato tipo ('in'|'out'), opzionalmente filtrati per mese
export function categoryTotals(type, ym = null) {
  const map = new Map();
  for (const m of state.movements) {
    if (m.type !== type) continue;
    if (ym && monthKey(m.date) !== ym) continue;
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
