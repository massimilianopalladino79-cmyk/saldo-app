// xlsx-io.js — Import/Export .xlsx nel formato IDENTICO al template.
// Usa SheetJS (globale window.XLSX, caricato in index.html).

import { withRunningBalance, monthlySummary, totals, getSettings, currentBalance, getState } from './store.js';
import { CATEGORIES } from './format.js';

const XLSX = () => window.XLSX;

// ---------- helpers date ----------
function isoToDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
}
// Excel serial (sistema 1900) -> 'YYYY-MM-DD' con matematica UTC (niente errori fuso)
function serialToISO(serial) {
  const utcDays = Math.round(serial - 25569);
  const d = new Date(utcDays * 86400 * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function anyToISO(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return serialToISO(v);
  if (v instanceof Date) {
    const p = (x) => String(x).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).trim();
  // gg/mm/aaaa
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m; if (y.length === 2) y = '20' + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // aaaa-mm-gg
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return '';
}
function toNum(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^\d,.\-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// ========================= EXPORT =========================
export function buildWorkbook() {
  const X = XLSX();
  const s = getSettings();
  const rows = withRunningBalance();

  // --- Foglio Movimenti ---
  const aoa = [];
  aoa.push(['Saldo progressivo – Entrate/Uscite']);            // R1
  aoa.push([]);                                                 // R2
  aoa.push(['Saldo iniziale', Number(s.saldoIniziale) || 0, null, 'Valuta', s.valuta || 'EUR']); // R3
  aoa.push([]);                                                 // R4
  // colonne A–G identiche al template; H "Persona" aggiunta per non perdere il dato
  aoa.push(['Data', 'Descrizione', 'Categoria', 'Entrate', 'Uscite', 'Saldo progressivo', 'Note', 'Persona']); // R5
  const firstDataRow = aoa.length + 1; // 1-based
  for (const m of rows) {
    aoa.push([
      m.date ? isoToDate(m.date) : '',
      m.description || '',
      m.category || '',
      m.type === 'in' ? m.amount : null,
      m.type === 'out' ? m.amount : null,
      m.balance,
      m.note || '',
      m.person || '',
    ]);
  }
  const lastDataRow = firstDataRow + rows.length - 1;
  // riga totali
  const t = totals();
  aoa.push([]);
  aoa.push(['Totali', null, null, t.entrate, t.uscite, currentBalance(), '', '']);

  const ws = X.utils.aoa_to_sheet(aoa, { cellDates: true });
  ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 24 }, { wch: 14 }];

  // formati numero (supportati anche in community): date + valuta
  const money = '#,##0.00';
  for (let r = firstDataRow; r <= lastDataRow; r++) {
    setZ(X, ws, `A${r}`, 'dd/mm/yyyy');
    ['D', 'E', 'F'].forEach((c) => setZ(X, ws, `${c}${r}`, money));
  }
  const totRow = lastDataRow + 2;
  ['D', 'E', 'F'].forEach((c) => setZ(X, ws, `${c}${totRow}`, money));
  setZ(X, ws, 'B3', money);

  // --- Foglio Riepilogo ---
  const months = monthlySummary();
  const rAoa = [];
  rAoa.push(['Riepilogo mensile']);
  rAoa.push([]);
  rAoa.push(['Mese (AAAA-MM)', 'Entrate', 'Uscite', 'Netto']);
  const rFirst = rAoa.length + 1;
  for (const m of months) rAoa.push([m.ym, m.entrate, m.uscite, m.netto]);
  const rLast = rFirst + months.length - 1;
  rAoa.push([]);
  rAoa.push(['Totale', t.entrate, t.uscite, t.netto]);
  rAoa.push(['SALDO', currentBalance()]);
  const wsR = X.utils.aoa_to_sheet(rAoa);
  wsR['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const money2 = '#,##0.00';
  for (let r = rFirst; r <= rLast + 3; r++) ['B', 'C', 'D'].forEach((c) => setZ(X, wsR, `${c}${r}`, money2));

  // --- Foglio Liste (categorie) nascosto ---
  const wsL = X.utils.aoa_to_sheet([['Categorie'], ...CATEGORIES.map((c) => [c])]);

  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Movimenti');
  X.utils.book_append_sheet(wb, wsL, 'Liste');
  X.utils.book_append_sheet(wb, wsR, 'Riepilogo');
  // nascondi il foglio Liste come nel template
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 0 }] };
  return wb;
}

function setZ(X, ws, addr, z) {
  if (ws[addr]) ws[addr].z = z;
}

export function exportXlsx(filename) {
  const X = XLSX();
  const wb = buildWorkbook();
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename || defaultName('xlsx'));
}

export function exportCsv(filename) {
  const rows = withRunningBalance();
  const head = ['Data', 'Descrizione', 'Categoria', 'Entrate', 'Uscite', 'Saldo progressivo', 'Note', 'Persona'];
  const lines = [head.join(';')];
  for (const m of rows) {
    lines.push([
      m.date,
      csv(m.description), csv(m.category),
      m.type === 'in' ? m.amount.toFixed(2).replace('.', ',') : '',
      m.type === 'out' ? m.amount.toFixed(2).replace('.', ',') : '',
      m.balance.toFixed(2).replace('.', ','),
      csv(m.note), csv(m.person),
    ].join(';'));
  }
  const bom = '﻿';
  downloadBlob(new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename || defaultName('csv'));
}
function csv(s) { s = (s || '').toString(); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

function defaultName(ext) {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `Saldo_progressivo_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

// ========================= IMPORT =========================
export async function importXlsx(file) {
  const X = XLSX();
  const buf = await file.arrayBuffer();
  const wb = X.read(buf, { type: 'array' });
  const wsName = wb.SheetNames.includes('Movimenti') ? 'Movimenti' : wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  const aoa = X.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });

  // saldo iniziale + valuta (cerca le etichette, non posizioni fisse)
  let saldoIniziale = 0, valuta = 'EUR';
  for (const row of aoa) {
    if (!row) continue;
    for (let i = 0; i < row.length; i++) {
      const cell = (row[i] ?? '').toString().trim().toLowerCase();
      if (cell === 'saldo iniziale') saldoIniziale = toNum(row[i + 1]);
      if (cell === 'valuta' && row[i + 1]) valuta = String(row[i + 1]).trim();
    }
  }

  // trova riga intestazione tabella
  let hi = -1, col = {};
  for (let r = 0; r < Math.min(aoa.length, 15); r++) {
    const row = (aoa[r] || []).map((c) => (c ?? '').toString().trim().toLowerCase());
    if (row.includes('data') && row.includes('descrizione')) {
      hi = r;
      col.data = row.indexOf('data');
      col.desc = row.indexOf('descrizione');
      col.cat = row.indexOf('categoria');
      col.entrate = row.indexOf('entrate');
      col.uscite = row.indexOf('uscite');
      col.note = row.indexOf('note');
      col.person = row.indexOf('persona');
      break;
    }
  }
  if (hi === -1) throw new Error('Formato non riconosciuto: manca la tabella con colonne "Data" e "Descrizione".');

  const movements = [];
  for (let r = hi + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    // Marcatori di fine tabella: cercali in TUTTE le colonne (nel file reale
    // "Totali" sta nella colonna Categoria, non nella Data). NON usare "saldo":
    // l'utente lo usa come descrizione di un movimento reale (saldo iniziale).
    const markers = [col.data, col.desc, col.cat].filter((i) => i >= 0)
      .map((i) => (row[i] ?? '').toString().trim().toLowerCase());
    if (markers.some((c) => c === 'totali' || c === 'totale' || c.startsWith('istruzioni'))) break;
    const date = anyToISO(row[col.data]);
    const entrate = col.entrate >= 0 ? toNum(row[col.entrate]) : 0;
    const uscite = col.uscite >= 0 ? toNum(row[col.uscite]) : 0;
    const desc = col.desc >= 0 ? (row[col.desc] ?? '').toString().trim() : '';
    if (!date && !desc && !entrate && !uscite) continue; // riga vuota
    if (!entrate && !uscite) continue;                   // niente importo -> salta
    movements.push({
      date,
      description: desc,
      category: col.cat >= 0 ? (row[col.cat] ?? '').toString().trim() || 'Altro' : 'Altro',
      type: entrate >= uscite && entrate > 0 ? 'in' : 'out',
      amount: entrate > 0 ? entrate : uscite,
      note: col.note >= 0 ? (row[col.note] ?? '').toString() : '',
      person: col.person >= 0 ? (row[col.person] ?? '').toString().trim() : '',
    });
  }

  return { movements, settings: { saldoIniziale, valuta } };
}
