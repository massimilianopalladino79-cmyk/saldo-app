// charts.js — grafici Syncfusion Essential JS 2 (Charts), bundle locale in vendor/.
// Le funzioni restituiscono un segnaposto HTML; il grafico viene montato subito dopo
// che il segnaposto è stato inserito nel DOM (microtask / frame successivo).
import * as sf from '../vendor/syncfusion-charts.min.js';
import { SF_LICENSE } from './sf-license.js';

if (SF_LICENSE) sf.registerLicense(SF_LICENSE);
sf.Chart.Inject(sf.SplineAreaSeries, sf.SplineSeries, sf.ColumnSeries, sf.Category, sf.Tooltip);
sf.AccumulationChart.Inject(sf.PieSeries, sf.AccumulationTooltip);
sf.Sparkline.Inject(sf.SparklineTooltip);

let _uid = 0;
const uid = (p) => `${p}${++_uid}`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------- montaggio ----------------
const pending = new Map(); // id segnaposto -> () => istanza Syncfusion
const live = new Set();
let scheduled = false;

function placeholder(cls, factory, inner = '') {
  const id = uid('sfc');
  pending.set(id, { factory, tries: 0 });
  if (!scheduled) { scheduled = true; queueMicrotask(flush); }
  return `<div class="${cls}" id="${id}">${inner}</div>`;
}

function flush() {
  scheduled = false;
  // libera i grafici rimossi dal DOM (listener di resize ecc.)
  for (const inst of live) {
    if (!inst.element || !inst.element.isConnected) { try { inst.destroy(); } catch {} live.delete(inst); }
  }
  let retry = false;
  for (const [id, job] of pending) {
    const el = document.getElementById(id);
    if (!el) {
      if (++job.tries < 5) retry = true; else pending.delete(id);
      continue;
    }
    pending.delete(id);
    const host = el.querySelector('.sf-host') || el;
    const inst = job.factory();
    inst.appendTo(host);
    live.add(inst);
  }
  if (retry) requestAnimationFrame(flush);
}

// ---------------- tema ----------------
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function color(c) {
  const m = /^var\((--[\w-]+)\)$/.exec(String(c || '').trim());
  return m ? cssVar(m[1]) : c;
}
function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return !window.matchMedia('(prefers-color-scheme: light)').matches;
}
function theme() {
  return {
    sfTheme: isDark() ? 'Material3Dark' : 'Material3',
    txt: cssVar('--txt'), txt3: cssVar('--txt3'), grid: cssVar('--grid'), font: cssVar('--font'),
  };
}

function axes(t, fmtY) {
  const label = { color: t.txt3, size: '11px', fontWeight: '600', fontFamily: t.font };
  return {
    primaryXAxis: {
      valueType: 'Category', labelStyle: label, labelIntersectAction: 'Hide', edgeLabelPlacement: 'Shift',
      majorGridLines: { width: 0 }, majorTickLines: { width: 0 }, lineStyle: { width: 0 },
    },
    primaryYAxis: {
      labelStyle: label, majorGridLines: { width: 1, color: t.grid }, majorTickLines: { width: 0 },
      lineStyle: { width: 0 }, rangePadding: 'Round',
    },
    axisLabelRender: fmtY ? (args) => { if (args.axis.name === 'primaryYAxis') args.text = fmtY(args.value); } : undefined,
  };
}

function baseChart(t, fmtY, extra) {
  return {
    ...axes(t, fmtY),
    theme: t.sfTheme, background: 'transparent', height: '240px', width: '100%',
    chartArea: { border: { width: 0 } },
    margin: { left: 4, right: 4, top: 10, bottom: 4 },
    legendSettings: { visible: false },
    tooltip: { enable: true, header: '', enableAnimation: false, textStyle: { fontFamily: t.font, fontWeight: '600' } },
    ...extra,
  };
}

/**
 * Grafico ad area (saldo progressivo).
 * points: [{ label, value }]
 */
export function areaChart(points, opts = {}) {
  if (!points || points.length === 0) return emptyChart(680, 260, 'Nessun dato');
  const fmtTip = opts.fmtTip || opts.fmtY || ((v) => Math.round(v));
  const data = points.map((p) => ({ x: p.label, y: p.value }));
  const allPositive = points.every((p) => p.value >= 0);
  return placeholder('sf-chart', () => {
    const t = theme();
    const c = color(opts.color || '#7C5CFF');
    const cfg = baseChart(t, opts.fmtY, {
      series: [
        { type: 'SplineArea', dataSource: data, xName: 'x', yName: 'y', fill: c, opacity: 0.28,
          border: { width: 0 }, enableTooltip: false },
        { type: 'Spline', dataSource: data, xName: 'x', yName: 'y', fill: c, width: 3,
          marker: { visible: false } },
      ],
      tooltipRender: (args) => { args.text = `<b>${esc(args.point.x)}</b>: ${esc(fmtTip(args.point.y))}`; },
    });
    if (allPositive) cfg.primaryYAxis.minimum = 0; // mostra lo zero se tutto positivo
    return new sf.Chart(cfg);
  });
}

/**
 * Grafico a colonne raggruppate (entrate vs uscite per mese).
 * data: [{ label, a, b }]  a=entrate, b=uscite
 */
export function groupedBars(data, opts = {}) {
  if (!data || data.length === 0) return emptyChart(680, 260, 'Nessun dato');
  const fmtTip = opts.fmtTip || opts.fmtY || ((v) => Math.round(v));
  const rows = data.map((d) => ({ x: d.label, a: d.a, b: d.b }));
  const radius = { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 };
  return placeholder('sf-chart', () => {
    const t = theme();
    return new sf.Chart(baseChart(t, opts.fmtY, {
      series: [
        { type: 'Column', name: 'Entrate', dataSource: rows, xName: 'x', yName: 'a',
          fill: color(opts.colorA || 'var(--green)'), cornerRadius: radius, columnWidth: 0.6, columnSpacing: 0.15 },
        { type: 'Column', name: 'Uscite', dataSource: rows, xName: 'x', yName: 'b',
          fill: color(opts.colorB || 'var(--red)'), cornerRadius: radius, columnWidth: 0.6, columnSpacing: 0.15 },
      ],
      tooltipRender: (args) => {
        args.text = `<b>${esc(args.point.x)}</b> · ${esc(args.series.name)}: ${esc(fmtTip(args.point.y))}`;
      },
    }));
  });
}

/**
 * Donut chart. slices: [{ label, value, color }]
 */
export function donut(slices, opts = {}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return emptyChart(240, 240, 'Nessun dato');
  const fmtTip = opts.fmtTip || ((v) => Math.round(v));
  const data = slices.map((s) => ({ x: s.label, y: s.value, color: color(s.color) }));
  const center = `<div class="donut-center">
      <div class="donut-label">${esc(opts.centerLabel || '')}</div>
      <div class="donut-value">${esc(opts.centerValue || '')}</div>
    </div><div class="sf-host"></div>`;
  return placeholder('sf-donut', () => {
    const t = theme();
    return new sf.AccumulationChart({
      theme: t.sfTheme, background: 'transparent', height: '230px', width: '100%',
      legendSettings: { visible: false }, enableSmartLabels: false,
      tooltip: { enable: true, header: '', enableAnimation: false, textStyle: { fontFamily: t.font, fontWeight: '600' } },
      series: [{ type: 'Pie', dataSource: data, xName: 'x', yName: 'y', pointColorMapping: 'color',
        innerRadius: '66%', radius: '100%', border: { width: 2, color: 'transparent' },
        dataLabel: { visible: false } }],
      tooltipRender: (args) => {
        const pct = total ? (args.point.y / total) * 100 : 0;
        args.text = `<b>${esc(args.point.x)}</b>: ${esc(fmtTip(args.point.y))} · ${pct.toFixed(0)}%`;
      },
    });
  }, center);
}

/**
 * Grafico multi-linea (una linea per persona nel tempo).
 * series: [{ name, color, points:[Number] }] allineate a opts.labels
 */
export function multiLine(series, opts = {}) {
  const labels = opts.labels || [];
  if (!series || !series.length || labels.length < 1) return emptyChart(680, 260, 'Nessun dato');
  const fmtTip = opts.fmtTip || opts.fmtY || ((v) => Math.round(v));
  return placeholder('sf-chart', () => {
    const t = theme();
    return new sf.Chart(baseChart(t, opts.fmtY, {
      series: series.map((s) => ({
        type: 'Spline', name: s.name, fill: color(s.color), width: 2.5,
        dataSource: s.points.map((v, i) => ({ x: labels[i], y: v })), xName: 'x', yName: 'y',
        marker: { visible: false },
      })),
      tooltipRender: (args) => {
        args.text = `<b>${esc(args.series.name)}</b> · ${esc(args.point.x)}: ${esc(fmtTip(args.point.y))}`;
      },
    }));
  });
}

// Mini sparkline per le card KPI. values: [Number]
export function sparkline(values, c = '#7C5CFF') {
  if (!values || values.length < 2) return '<div class="spark"></div>';
  const data = values.map((v, i) => ({ x: i, y: v }));
  return placeholder('spark', () => {
    const col = color(c);
    return new sf.Sparkline({
      type: 'Area', dataSource: data, xName: 'x', yName: 'y', valueType: 'Numeric',
      fill: col, opacity: 0.3, lineWidth: 2, border: { color: col, width: 2 },
      height: '34px', width: '100%', containerArea: { background: 'transparent', border: { width: 0 } },
      padding: { left: 0, right: 0, top: 3, bottom: 0 },
    });
  });
}

function emptyChart(W, H, msg) {
  return `<svg viewBox="0 0 ${W} ${H}" class="chart chart-empty" role="img">
    <text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="ch-empty">${esc(msg)}</text>
  </svg>`;
}
