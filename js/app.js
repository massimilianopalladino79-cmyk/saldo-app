// app.js — controller principale (viste, navigazione, interazioni)
import * as store from './store.js';
import * as charts from './charts.js';
import * as io from './xlsx-io.js';
import {
  fmtCurrency, fmtShort, fmtDate, fmtMonth, fmtMonthShort,
  todayISO, monthKey, parseAmount, CATEGORIES, catMeta, personColor,
} from './format.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const money = (n) => fmtCurrency(n, store.getSettings().valuta);

const ui = {
  tab: 'dashboard',
  filt: { q: '', cat: 'all', type: 'all', person: 'all' },
  ana: { type: 'out', month: 'all', dim: 'cat' },
};

// ---------------- bootstrap ----------------
store.load();
applyTheme(store.getSettings().tema);
render();
wireChrome();
store.onChange(() => render());
registerSW();

// ---------------- chrome (tabbar + fab) ----------------
function wireChrome() {
  document.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(); }));
  $('#fab').addEventListener('click', () => openMovementSheet(null));
}

function render() {
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('on', b.dataset.tab === ui.tab));
  const map = { dashboard: renderDashboard, movimenti: renderMovimenti, analisi: renderAnalisi, impostazioni: renderImpostazioni };
  (map[ui.tab] || renderDashboard)();
  view.scrollTop = 0;
  window.scrollTo(0, 0);
}

// ---------------- DASHBOARD ----------------
function renderDashboard() {
  const bal = store.currentBalance();
  const months = store.monthlySummary();
  const curKey = monthKey(todayISO());
  const cur = months.find((m) => m.ym === curKey) || { entrate: 0, uscite: 0, netto: 0 };
  const balSeries = store.balanceByMonth();
  const last6 = months.slice(-6);
  const sparkIn = last6.map((m) => m.entrate);
  const sparkOut = last6.map((m) => m.uscite);

  const deltaCls = cur.netto >= 0 ? '' : 'neg';
  const deltaTxt = `${cur.netto >= 0 ? '▲' : '▼'} ${money(Math.abs(cur.netto))} questo mese`;

  const areaPts = balSeries.map((r) => ({ label: fmtMonthShort(r.ym), value: r.balance }));
  const barsData = last6.map((m) => ({ label: fmtMonthShort(m.ym), a: m.entrate, b: m.uscite }));
  const recent = store.withRunningBalance().slice(-4).reverse();

  const hasData = store.getState().movements.length > 0;

  view.innerHTML = `
    <div class="page-head"><div>
      <h1 class="page-title">Ciao 👋</h1>
      <div class="page-sub">Il tuo saldo, in tempo reale</div>
    </div></div>

    <div class="hero">
      <div class="lbl">Saldo attuale</div>
      <div class="amount">${money(bal)}</div>
      ${hasData ? `<span class="delta ${deltaCls}">${deltaTxt}</span>` : `<span class="delta">Aggiungi il primo movimento</span>`}
    </div>

    <div class="kpi-row">
      <div class="kpi">
        <div class="k-lbl"><span class="dot" style="background:var(--green)"></span>Entrate mese</div>
        <div class="k-val pos">${money(cur.entrate)}</div>
        ${charts.sparkline(sparkIn.length > 1 ? sparkIn : [0, 0], 'var(--green)')}
      </div>
      <div class="kpi">
        <div class="k-lbl"><span class="dot" style="background:var(--red)"></span>Uscite mese</div>
        <div class="k-val neg">${money(cur.uscite)}</div>
        ${charts.sparkline(sparkOut.length > 1 ? sparkOut : [0, 0], 'var(--red)')}
      </div>
    </div>

    <div class="card">
      <div class="card-t"><h3>Andamento saldo</h3><span class="muted">${months.length} mesi</span></div>
      ${charts.areaChart(areaPts, { color: '#7C5CFF', fmtY: fmtShort })}
    </div>

    <div class="card">
      <div class="card-t"><h3>Entrate vs Uscite</h3><span class="muted">ultimi ${barsData.length || 0} mesi</span></div>
      ${charts.groupedBars(barsData, { fmtY: fmtShort })}
      <div class="legend">
        <span class="li"><span class="sw" style="background:var(--green)"></span>Entrate</span>
        <span class="li"><span class="sw" style="background:var(--red)"></span>Uscite</span>
      </div>
    </div>

    <div class="card">
      <div class="card-t"><h3>Movimenti recenti</h3>
        <span class="muted" data-goto="movimenti" style="cursor:pointer">Vedi tutti ›</span></div>
      <div class="mlist">${recent.length ? recent.map(rowHTML).join('') : emptyInline('Nessun movimento ancora')}</div>
    </div>
  `;
  wireCommon();
}

// ---------------- MOVIMENTI ----------------
function renderMovimenti() {
  const all = store.withRunningBalance();
  const f = ui.filt;
  const filtered = all.filter((m) => {
    if (f.type !== 'all' && m.type !== f.type) return false;
    if (f.cat !== 'all' && m.category !== f.cat) return false;
    if (f.person !== 'all' && m.person !== f.person) return false;
    if (f.q && !(`${m.description} ${m.category} ${m.note} ${m.person}`.toLowerCase().includes(f.q.toLowerCase()))) return false;
    return true;
  });

  // raggruppa per mese (recente in alto)
  const groups = new Map();
  for (const m of filtered) {
    const k = monthKey(m.date) || '—';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const keys = [...groups.keys()].sort((a, b) => (a < b ? 1 : -1));

  const usedCats = [...new Set(all.map((m) => m.category))];
  const usedPeople = [...new Set(all.filter((m) => m.person).map((m) => m.person))];
  const chip = (val, lbl) => `<button class="chip ${f.cat === val ? 'on' : ''}" data-cat="${escapeAttr(val)}">${lbl}</button>`;
  const pchip = (val, lbl) => `<button class="chip ${f.person === val ? 'on' : ''}" data-fperson="${escapeAttr(val)}">${lbl}</button>`;

  const ft = store.totals(filtered);
  const filterActive = f.type !== 'all' || f.cat !== 'all' || f.person !== 'all' || !!f.q;
  const personTag = f.person !== 'all' ? ` · <span class="who">👤 ${escapeHtml(f.person)}</span>` : '';
  const summaryHTML = filterActive ? `<div class="filtsum">
      <div class="fs-top">
        <span><b>${filtered.length}</b> ${filtered.length === 1 ? 'voce' : 'voci'}${personTag}</span>
        <span class="fs-net ${ft.netto >= 0 ? 'pos' : 'neg'}">${ft.netto >= 0 ? '+' : '−'} ${money(Math.abs(ft.netto))}</span>
      </div>
      ${ft.entrate && ft.uscite ? `<div class="fs-sub">
        <span class="pos">Entrate +${money(ft.entrate)}</span>
        <span class="neg">Uscite −${money(ft.uscite)}</span></div>` : ''}
    </div>` : '';

  view.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Movimenti</h1>
      <div class="page-sub">${filtered.length} voci · saldo ${money(store.currentBalance())}</div></div></div>

    <div class="field" style="margin-bottom:10px">
      <input id="search" type="search" placeholder="Cerca descrizione, categoria…" value="${escapeAttr(f.q)}">
    </div>
    <div class="seg" style="margin-bottom:10px">
      ${['all', 'in', 'out'].map((t) => `<button data-type="${t}" class="${f.type === t ? 'on' : ''}">${{ all: 'Tutti', in: 'Entrate', out: 'Uscite' }[t]}</button>`).join('')}
    </div>
    <div class="chips">
      ${chip('all', 'Tutte')}
      ${usedCats.map((c) => chip(c, `${catMeta(c).icon} ${c}`)).join('')}
    </div>
    ${usedPeople.length ? `<div class="chips" style="margin-top:2px">
      ${pchip('all', '👤 Tutti')}
      ${usedPeople.map((pp) => pchip(pp, `👤 ${escapeHtml(pp)}`)).join('')}
    </div>` : ''}
    ${summaryHTML}

    ${keys.length ? keys.map((k) => {
      const items = groups.get(k);
      const net = items.reduce((a, m) => a + (m.type === 'in' ? m.amount : -m.amount), 0);
      return `<div class="mgroup-h"><span>${k === '—' ? 'Senza data' : fmtMonth(k)}</span>
        <span class="sum ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${money(net)}</span></div>
        <div class="mlist">${items.slice().reverse().map(rowHTML).join('')}</div>`;
    }).join('') : emptyState('🔍', 'Nessun risultato', 'Prova a cambiare filtri o aggiungi un movimento.')}
  `;

  const s = $('#search');
  s.addEventListener('input', () => { f.q = s.value; });
  s.addEventListener('search', () => renderMovimenti());
  s.addEventListener('blur', () => renderMovimenti());
  view.querySelectorAll('[data-type]').forEach((b) =>
    b.addEventListener('click', () => { f.type = b.dataset.type; renderMovimenti(); }));
  view.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => { f.cat = b.dataset.cat; renderMovimenti(); }));
  view.querySelectorAll('[data-fperson]').forEach((b) =>
    b.addEventListener('click', () => { f.person = b.dataset.fperson; renderMovimenti(); }));
  wireCommon();
}

function rowHTML(m) {
  const cm = catMeta(m.category);
  const sign = m.type === 'in' ? '+' : '−';
  const cls = m.type === 'in' ? 'pos' : 'neg';
  return `<div class="mrow" data-edit="${m.id}">
    <div class="ic" style="background:${cm.color}22;color:${cm.color}">${cm.icon}</div>
    <div class="mid">
      <div class="desc">${escapeHtml(m.description || m.category)}</div>
      <div class="meta">${escapeHtml(m.category)} · ${fmtDate(m.date)}${m.person ? ` · <span class="who">👤 ${escapeHtml(m.person)}</span>` : ''}</div>
    </div>
    <div style="text-align:right">
      <div class="amt ${cls}">${sign} ${money(m.amount)}</div>
      ${m.balance != null ? `<div class="bal">${money(m.balance)}</div>` : ''}
    </div>
  </div>`;
}

// ---------------- ANALISI ----------------
function renderAnalisi() {
  const months = store.monthlySummary();
  const a = ui.ana;
  const ym = a.month === 'all' ? null : a.month;
  const monthOpts = ['all', ...store.availableMonths()];

  // dimensione: categoria oppure persona ("Chi la usa")
  const items = a.dim === 'person'
    ? store.personTotals(a.type, ym).map((r) => ({ key: r.person, label: r.person, total: r.total, color: personColor(r.person), icon: '👤' }))
    : store.categoryTotals(a.type, ym).map((r) => ({ key: r.category, label: r.category, total: r.total, color: catMeta(r.category).color, icon: catMeta(r.category).icon }));
  const tot = items.reduce((s, c) => s + c.total, 0);
  const slices = items.map((c) => ({ label: c.label, value: c.total, color: c.color }));

  const barsData = months.map((m) => ({ label: fmtMonthShort(m.ym), a: m.entrate, b: m.uscite }));
  const monthChips = monthOpts.map((mo) =>
    `<button class="chip ${a.month === mo ? 'on' : ''}" data-anamonth="${mo}">${mo === 'all' ? 'Tutto' : fmtMonth(mo)}</button>`).join('');

  view.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Analisi</h1>
      <div class="page-sub">Dove vanno i tuoi soldi</div></div></div>

    <div class="card">
      <div class="card-t"><h3>Entrate vs Uscite</h3><span class="muted">per mese</span></div>
      ${charts.groupedBars(barsData, { fmtY: fmtShort })}
      <div class="legend">
        <span class="li"><span class="sw" style="background:var(--green)"></span>Entrate</span>
        <span class="li"><span class="sw" style="background:var(--red)"></span>Uscite</span>
      </div>
    </div>

    <div class="card">
      <div class="card-t"><h3>Ripartizione</h3>
        <div class="seg">
          <button data-anatype="out" class="${a.type === 'out' ? 'on' : ''}">Uscite</button>
          <button data-anatype="in" class="${a.type === 'in' ? 'on' : ''}">Entrate</button>
        </div>
      </div>
      <div class="seg" style="width:100%;display:flex;margin-bottom:10px">
        <button data-anadim="cat" class="${a.dim === 'cat' ? 'on' : ''}" style="flex:1">Per categoria</button>
        <button data-anadim="person" class="${a.dim === 'person' ? 'on' : ''}" style="flex:1">Per persona</button>
      </div>
      <div class="chips" style="margin-bottom:8px">${monthChips}</div>
      ${charts.donut(slices, { centerLabel: a.type === 'out' ? 'Uscite' : 'Entrate', centerValue: fmtShort(tot) })}
      <div style="margin-top:14px">
        ${items.length ? items.map((c) => {
          const pct = tot ? (c.total / tot) * 100 : 0;
          return `<div class="catbar">
            <div class="top"><span>${c.icon} ${escapeHtml(c.label)}</span>
              <span>${money(c.total)} · ${pct.toFixed(0)}%</span></div>
            <div class="track"><div class="fill" style="width:${pct.toFixed(1)}%;background:${c.color}"></div></div>
          </div>`;
        }).join('') : `<div class="empty" style="padding:26px"><p>${a.dim === 'person' ? 'Nessun movimento con persona per questo periodo' : 'Nessun dato per questo periodo'}</p></div>`}
      </div>
    </div>

    ${personTimeCardHTML()}
  `;
  view.querySelectorAll('[data-anatype]').forEach((b) =>
    b.addEventListener('click', () => { a.type = b.dataset.anatype; renderAnalisi(); }));
  view.querySelectorAll('[data-anadim]').forEach((b) =>
    b.addEventListener('click', () => { a.dim = b.dataset.anadim; renderAnalisi(); }));
  view.querySelectorAll('[data-anamonth]').forEach((b) =>
    b.addEventListener('click', () => { a.month = b.dataset.anamonth; renderAnalisi(); }));
  wireCommon();
}

// Card "Quanto ho dato a ciascuno nel tempo" (uscite attribuite a una persona)
function personTimeCardHTML() {
  const ot = store.personOverTime('out');
  if (!ot.people.length) {
    return `<div class="card">
      <div class="card-t"><h3>Dato a ciascuno · nel tempo</h3></div>
      <div class="empty" style="padding:22px"><p>Attribuisci le spese a una persona (campo "Chi la usa") per vedere qui l'andamento nel tempo.</p></div>
    </div>`;
  }
  const top = ot.people.slice(0, 8);
  const labels = ot.months.map(fmtMonthShort);
  const series = top.map((pp) => ({ name: pp.person, color: personColor(pp.person), points: pp.cumulative }));
  return `<div class="card">
    <div class="card-t"><h3>Dato a ciascuno · nel tempo</h3><span class="muted">cumulato</span></div>
    ${charts.multiLine(series, { labels, fmtY: fmtShort })}
    <div class="legend">
      ${top.map((pp) => `<span class="li"><span class="sw" style="background:${personColor(pp.person)}"></span>${escapeHtml(pp.person)}</span>`).join('')}
    </div>
    <div style="margin-top:12px">
      ${ot.people.map((pp) => `<div class="ptl-row">
        <span class="ptl-name">👤 ${escapeHtml(pp.person)}</span>
        <span class="ptl-spark">${charts.sparkline(pp.monthly.length > 1 ? pp.monthly : [0, 0], personColor(pp.person))}</span>
        <span class="ptl-tot">${money(pp.total)}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

// ---------------- IMPOSTAZIONI ----------------
function renderImpostazioni() {
  const s = store.getSettings();
  const n = store.getState().movements.length;
  const tema = s.tema || 'auto';

  view.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Impostazioni</h1>
      <div class="page-sub">${n} movimenti · ${s.valuta}</div></div></div>

    <div class="card">
      <div class="card-t"><h3>Conto</h3></div>
      <div class="field"><label>Saldo iniziale</label>
        <input id="set-saldo" inputmode="decimal" value="${s.saldoIniziale}"></div>
      <div class="field"><label>Valuta</label>
        <select id="set-valuta">
          ${['EUR', 'USD', 'GBP', 'CHF'].map((c) => `<option ${c === s.valuta ? 'selected' : ''}>${c}</option>`).join('')}
        </select></div>
      <button class="btn btn-primary" id="save-conto">Salva</button>
    </div>

    <div class="card">
      <div class="card-t"><h3>Aspetto</h3></div>
      <div class="seg" style="width:100%;display:flex">
        ${['auto', 'light', 'dark'].map((t) => `<button data-tema="${t}" class="${tema === t ? 'on' : ''}" style="flex:1">${{ auto: 'Auto', light: 'Chiaro', dark: 'Scuro' }[t]}</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-t"><h3>Persone · Chi la usa</h3><span class="muted">${(s.people || []).length}</span></div>
      <div class="peoplepick" id="set-people">
        ${(s.people || []).map((p) => `<span class="pchip" style="color:${personColor(p)}">👤 ${escapeHtml(p)}<button class="prm" data-rmperson="${escapeAttr(p)}" aria-label="Rimuovi">×</button></span>`).join('')}
        <button type="button" class="pchip add" id="set-padd">＋ Nuovo</button>
      </div>
      <div class="page-sub" style="margin-top:8px">Usate quando inserisci una spesa per indicare a chi è destinata.</div>
    </div>

    <div class="card">
      <div class="card-t"><h3>Excel & dati</h3></div>
      <div class="setlist">
        <div class="setrow" id="do-import"><div class="s-ic">📥</div>
          <div class="s-main"><div class="s-t">Importa da Excel</div><div class="s-d">Carica il file .xlsx del template</div></div>
          <div class="chev">›</div></div>
        <div class="setrow" id="do-export"><div class="s-ic">📤</div>
          <div class="s-main"><div class="s-t">Esporta in Excel</div><div class="s-d">Stesso formato del template</div></div>
          <div class="chev">›</div></div>
        <div class="setrow" id="do-csv"><div class="s-ic">📄</div>
          <div class="s-main"><div class="s-t">Esporta CSV</div><div class="s-d">Per fogli di calcolo generici</div></div>
          <div class="chev">›</div></div>
      </div>
      <input type="file" id="file-input" class="hidden-file" accept=".xlsx,.xls">
    </div>

    <div class="card">
      <button class="btn btn-danger" id="do-reset">Elimina tutti i dati</button>
    </div>
    <div class="page-sub" style="text-align:center">Saldo · PWA offline · v1.0</div>
  `;

  $('#save-conto').addEventListener('click', () => {
    store.setSetting('saldoIniziale', parseAmount($('#set-saldo').value));
    store.setSetting('valuta', $('#set-valuta').value);
    toast('Impostazioni salvate', 'ok');
  });
  view.querySelectorAll('[data-tema]').forEach((b) =>
    b.addEventListener('click', () => { store.setSetting('tema', b.dataset.tema); applyTheme(b.dataset.tema); renderImpostazioni(); }));

  $('#set-padd').addEventListener('click', () => {
    const name = (window.prompt('Nuova persona:') || '').trim();
    if (name) store.addPerson(name); // emette change -> ri-render automatico
  });
  view.querySelectorAll('[data-rmperson]').forEach((b) =>
    b.addEventListener('click', () => store.removePerson(b.dataset.rmperson)));

  const fileInput = $('#file-input');
  $('#do-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const { movements, settings } = await io.importXlsx(file);
      openConfirm(`Importare ${movements.length} movimenti?`,
        'I dati attuali verranno sostituiti.', () => {
          store.replaceAll({ movements, settings });
          toast(`Importati ${movements.length} movimenti`, 'ok');
        });
    } catch (e) {
      toast('Import fallito: ' + e.message, 'err');
    } finally { fileInput.value = ''; }
  });
  $('#do-export').addEventListener('click', () => { try { io.exportXlsx(); toast('Excel esportato', 'ok'); } catch (e) { toast('Errore export: ' + e.message, 'err'); } });
  $('#do-csv').addEventListener('click', () => { try { io.exportCsv(); toast('CSV esportato', 'ok'); } catch (e) { toast('Errore: ' + e.message, 'err'); } });
  $('#do-reset').addEventListener('click', () =>
    openConfirm('Eliminare tutti i dati?', 'Operazione non reversibile.', () => { store.clearAll(); toast('Dati eliminati', 'ok'); }, true));
}

// ---------------- comune ----------------
function wireCommon() {
  view.querySelectorAll('[data-edit]').forEach((el) =>
    el.addEventListener('click', () => openMovementSheet(store.getMovement(el.dataset.edit))));
  view.querySelectorAll('[data-goto]').forEach((el) =>
    el.addEventListener('click', () => { ui.tab = el.dataset.goto; render(); }));
}

// ---------------- sheet aggiungi/modifica ----------------
function openMovementSheet(mov) {
  const edit = !!mov;
  const m = mov || { type: 'out', amount: '', description: '', category: 'Altro', date: todayISO(), note: '', person: '' };
  let type = m.type;
  let person = m.person || '';

  const html = `
    <h2>${edit ? 'Modifica movimento' : 'Nuovo movimento'}</h2>
    <div class="typeswitch">
      <button data-t="in" class="in ${type === 'in' ? 'on' : ''}">＋ Entrata</button>
      <button data-t="out" class="out ${type === 'out' ? 'on' : ''}">－ Uscita</button>
    </div>
    <div class="field amount"><label>Importo</label>
      <input id="f-amount" inputmode="decimal" placeholder="0,00" value="${m.amount === '' ? '' : m.amount}"></div>
    <div class="field"><label>Descrizione</label>
      <input id="f-desc" placeholder="Es. Fattura cliente" value="${escapeAttr(m.description)}"></div>
    <div class="grid2">
      <div class="field"><label>Categoria</label>
        <select id="f-cat">${CATEGORIES.map((c) => `<option ${c === m.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Data</label>
        <input id="f-date" type="date" value="${m.date}"></div>
    </div>
    <div class="field"><label>Chi la usa</label>
      <div class="peoplepick" id="f-people"></div></div>
    <div class="field"><label>Note (facoltative)</label>
      <textarea id="f-note" placeholder="Aggiungi una nota…">${escapeHtml(m.note)}</textarea></div>
    <button class="btn btn-primary" id="f-save">${edit ? 'Salva modifiche' : 'Aggiungi movimento'}</button>
    ${edit ? `<div class="btn-row"><button class="btn btn-danger" id="f-del">Elimina</button></div>` : ''}
  `;
  const { sheet, close } = openSheet(html);

  sheet.querySelectorAll('[data-t]').forEach((b) =>
    b.addEventListener('click', () => {
      type = b.dataset.t;
      sheet.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x.dataset.t === type));
    }));

  // selettore "Chi la usa"
  const peopleBox = $('#f-people', sheet);
  function renderPeople() {
    const people = store.getPeople();
    const chip = (val, label, extra = '') =>
      `<button type="button" class="pchip ${person === val ? 'on' : ''} ${extra}" data-person="${escapeAttr(val)}"
        ${person === val && val ? `style="background:${personColor(val)}"` : ''}>${label}</button>`;
    peopleBox.innerHTML =
      chip('', 'Nessuno') +
      people.map((p) => chip(p, `👤 ${escapeHtml(p)}`)).join('') +
      `<button type="button" class="pchip add" id="p-add">＋ Nuovo</button>`;
    peopleBox.querySelectorAll('[data-person]').forEach((b) =>
      b.addEventListener('click', () => { person = b.dataset.person; renderPeople(); }));
    $('#p-add', peopleBox).addEventListener('click', () => {
      const name = (window.prompt('Nome della persona a cui è destinata la spesa:') || '').trim();
      if (name) { store.addPerson(name); person = name; renderPeople(); }
    });
  }
  renderPeople();

  $('#f-save', sheet).addEventListener('click', () => {
    const amount = parseAmount($('#f-amount', sheet).value);
    if (!amount) { toast('Inserisci un importo', 'err'); return; }
    const data = {
      type,
      amount,
      description: $('#f-desc', sheet).value.trim(),
      category: $('#f-cat', sheet).value,
      date: $('#f-date', sheet).value || todayISO(),
      note: $('#f-note', sheet).value,
      person,
    };
    if (edit) { store.updateMovement(m.id, data); toast('Movimento aggiornato', 'ok'); }
    else { store.addMovement(data); toast('Movimento aggiunto', 'ok'); }
    close();
  });

  if (edit) $('#f-del', sheet).addEventListener('click', () =>
    openConfirm('Eliminare questo movimento?', '', () => { store.deleteMovement(m.id); close(); toast('Eliminato', 'ok'); }, true));

  setTimeout(() => $('#f-amount', sheet)?.focus(), 250);
}

// ---------------- modal primitives ----------------
function openSheet(innerHTML) {
  const root = $('#modal-root');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet"><div class="grab"></div>${innerHTML}</div>`;
  root.appendChild(scrim);
  const sheet = scrim.querySelector('.sheet');
  requestAnimationFrame(() => scrim.classList.add('show'));
  const close = () => { scrim.classList.remove('show'); setTimeout(() => scrim.remove(), 340); };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  return { scrim, sheet, close };
}

function openConfirm(title, msg, onOk, danger = false) {
  const html = `<h2>${escapeHtml(title)}</h2>
    ${msg ? `<p class="page-sub" style="margin:-8px 0 18px">${escapeHtml(msg)}</p>` : ''}
    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="c-ok">Conferma</button>
    <div class="btn-row"><button class="btn btn-ghost" id="c-no">Annulla</button></div>`;
  const { sheet, close } = openSheet(html);
  $('#c-ok', sheet).addEventListener('click', () => { close(); onOk(); });
  $('#c-no', sheet).addEventListener('click', close);
}

// ---------------- toast ----------------
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toast-root').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// ---------------- theme ----------------
function applyTheme(tema) {
  const root = document.documentElement;
  if (tema === 'light' || tema === 'dark') root.setAttribute('data-theme', tema);
  else root.removeAttribute('data-theme');
}

// ---------------- helpers ----------------
function emptyState(icon, title, msg) {
  return `<div class="empty"><div class="big">${icon}</div><h4>${title}</h4><p>${msg}</p></div>`;
}
function emptyInline(msg) { return `<div class="empty" style="padding:24px"><p>${msg}</p></div>`; }
function escapeHtml(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

// ---------------- service worker ----------------
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () =>
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW non registrato:', e)));
  }
}
