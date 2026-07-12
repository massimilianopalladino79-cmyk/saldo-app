// format.js — utilità di formattazione (it-IT) e metadati categorie
// Nessuna dipendenza esterna.

export const CATEGORIES = [
  'Vendite', 'Incassi vari', 'Stipendi', 'Affitto', 'Utenze',
  'Fornitori', 'Marketing', 'Trasporti', 'Tasse/Contributi',
  'Investimenti', 'Altro',
];

// Colore + icona per ogni categoria (usati in liste e grafici)
export const CATEGORY_META = {
  'Vendite':          { color: '#34C759', icon: '🛒' },
  'Incassi vari':     { color: '#30D158', icon: '💰' },
  'Stipendi':         { color: '#FF9F0A', icon: '👥' },
  'Affitto':          { color: '#FF375F', icon: '🏠' },
  'Utenze':           { color: '#5E5CE6', icon: '💡' },
  'Fornitori':        { color: '#64D2FF', icon: '📦' },
  'Marketing':        { color: '#BF5AF2', icon: '📣' },
  'Trasporti':        { color: '#FFD60A', icon: '🚚' },
  'Tasse/Contributi': { color: '#FF453A', icon: '🏛️' },
  'Investimenti':     { color: '#0A84FF', icon: '📈' },
  'Altro':            { color: '#8E8E93', icon: '🔖' },
};

export function catMeta(cat) {
  if (CATEGORY_META[cat]) return CATEGORY_META[cat];
  // categoria libera (non nella lista fissa): colore stabile derivato dal nome
  return { color: hashColor(cat || 'Altro'), icon: '🏷️' };
}

// colore HSL deterministico e leggibile a partire da una stringa
function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 68% 55%)`;
}

const MONTHS_SHORT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

export function fmtCurrency(n, currency = 'EUR') {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(v);
  } catch {
    return '€ ' + v.toFixed(2);
  }
}

// Versione compatta per gli assi dei grafici: 1.234 -> "1,2k"
export function fmtShort(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace('.', ',') + 'M';
  if (abs >= 1_000)     return sign + (abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace('.', ',') + 'k';
  return sign + Math.round(abs);
}

// ISO 'YYYY-MM-DD' -> "12 lug 2026"
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_SHORT[m - 1].toLowerCase()} ${y}`;
}

// 'YYYY-MM' -> "Lug 2025"
export function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

// 'YYYY-MM' -> "Lug" (compatto per assi)
export function fmtMonthShort(ym) {
  if (!ym) return '';
  const [, m] = ym.split('-').map(Number);
  return MONTHS_SHORT[(m || 1) - 1];
}

export function monthKey(iso) {
  return (iso || '').slice(0, 7); // 'YYYY-MM'
}

export function todayISO() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Parsing tollerante di importi digitati "1.234,56" o "1234.56"
export function parseAmount(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  let s = String(str).trim().replace(/\s|€/g, '');
  if (s.includes(',') && s.includes('.')) {
    // formato italiano: punto = migliaia, virgola = decimali
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

// id univoco senza dipendenze (evita Date.now-only per ridurre collisioni)
let _seq = 0;
export function newId() {
  _seq = (_seq + 1) % 100000;
  return 'm' + Date.now().toString(36) + '-' + _seq.toString(36);
}
