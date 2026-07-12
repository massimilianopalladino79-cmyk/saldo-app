// charts.js — grafici SVG fatti a mano (nessuna dipendenza).
// Ogni funzione restituisce una stringa SVG responsive (viewBox).

let _uid = 0;
const uid = (p) => `${p}${++_uid}`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Path liscio (Catmull-Rom -> Bézier) per curve premium
function smoothPath(pts) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function niceBounds(min, max) {
  if (min === max) { const p = Math.abs(min) || 1; return [min - p * 0.5, max + p * 0.5]; }
  const pad = (max - min) * 0.12;
  return [min - pad, max + pad];
}

/**
 * Grafico ad area (saldo progressivo).
 * points: [{ label, value }]
 */
export function areaChart(points, opts = {}) {
  const W = 680, H = 260;
  const padL = 8, padR = 8, padT = 18, padB = 30;
  const color = opts.color || '#7C5CFF';
  const gid = uid('agrad'), lid = uid('lgrad'), clip = uid('aclip');

  if (!points || points.length === 0) {
    return emptyChart(W, H, 'Nessun dato');
  }

  const vals = points.map((p) => p.value);
  let [lo, hi] = niceBounds(Math.min(...vals), Math.max(...vals));
  if (lo > 0) lo = 0; // mostra lo zero se tutto positivo
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = points.length;
  const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => padT + ih - ((v - lo) / (hi - lo || 1)) * ih;

  const linePts = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const line = smoothPath(linePts);
  const area = `${line} L${x(n - 1)},${padT + ih} L${x(0)},${padT + ih} Z`;

  // griglia orizzontale + etichette y
  let grid = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = lo + (i / ticks) * (hi - lo);
    const yy = y(v);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" class="ch-grid"/>`;
    grid += `<text x="${W - padR}" y="${(yy - 4).toFixed(1)}" class="ch-ylabel" text-anchor="end">${esc(opts.fmtY ? opts.fmtY(v) : Math.round(v))}</text>`;
  }

  // etichette x (max ~6)
  let xlab = '';
  const step = Math.max(1, Math.ceil(n / 6));
  for (let i = 0; i < n; i += step) {
    xlab += `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ch-xlabel" text-anchor="middle">${esc(points[i].label)}</text>`;
  }

  const last = linePts[n - 1];
  const dots = points.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="9" fill="transparent" class="ch-hit" data-i="${i}"/>`
  ).join('');

  return `
  <svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none" role="img">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity="0.42"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${lid}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${color}"/>
        <stop offset="1" stop-color="#22D3EE"/>
      </linearGradient>
      <clipPath id="${clip}"><rect x="0" y="0" width="${W}" height="${padT + ih}"/></clipPath>
    </defs>
    <g>${grid}</g>
    <path d="${area}" fill="url(#${gid})" clip-path="url(#${clip})"/>
    <path d="${line}" fill="none" stroke="url(#${lid})" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="ch-line"/>
    <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="5.5" fill="#fff"/>
    <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="9" fill="${color}" fill-opacity="0.25"/>
    <g>${xlab}</g>
    <g>${dots}</g>
  </svg>`;
}

/**
 * Grafico a barre raggruppate (entrate vs uscite per mese).
 * data: [{ label, a, b }]  a=entrate, b=uscite
 */
export function groupedBars(data, opts = {}) {
  const W = 680, H = 260;
  const padL = 8, padR = 8, padT = 16, padB = 30;
  const cA = opts.colorA || '#30D158', cB = opts.colorB || '#FF453A';
  if (!data || data.length === 0) return emptyChart(W, H, 'Nessun dato');

  const maxV = Math.max(1, ...data.map((d) => Math.max(d.a, d.b)));
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = data.length;
  const groupW = iw / n;
  const barW = Math.min(18, groupW * 0.32);
  const gap = 4;
  const y = (v) => padT + ih - (v / maxV) * ih;

  let grid = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (i / ticks) * maxV;
    const yy = y(v);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" class="ch-grid"/>`;
    grid += `<text x="${W - padR}" y="${(yy - 4).toFixed(1)}" class="ch-ylabel" text-anchor="end">${esc(opts.fmtY ? opts.fmtY(v) : Math.round(v))}</text>`;
  }

  let bars = '', xlab = '';
  const base = padT + ih;
  data.forEach((d, i) => {
    const cx = padL + i * groupW + groupW / 2;
    const x1 = cx - barW - gap / 2;
    const x2 = cx + gap / 2;
    const hA = base - y(d.a), hB = base - y(d.b);
    const r = Math.min(barW / 2, 6);
    bars += roundedTopRect(x1, y(d.a), barW, hA, r, cA);
    bars += roundedTopRect(x2, y(d.b), barW, hB, r, cB);
    xlab += `<text x="${cx.toFixed(1)}" y="${H - 8}" class="ch-xlabel" text-anchor="middle">${esc(d.label)}</text>`;
  });

  return `
  <svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none" role="img">
    <g>${grid}</g>
    <g>${bars}</g>
    <g>${xlab}</g>
  </svg>`;
}

function roundedTopRect(x, y, w, h, r, fill) {
  if (h <= 0.5) return '';
  const rr = Math.min(r, h);
  return `<path d="M${x},${(y + h).toFixed(1)} L${x},${(y + rr).toFixed(1)} Q${x},${y.toFixed(1)} ${(x + rr).toFixed(1)},${y.toFixed(1)} L${(x + w - rr).toFixed(1)},${y.toFixed(1)} Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + rr).toFixed(1)} L${(x + w).toFixed(1)},${(y + h).toFixed(1)} Z" fill="${fill}"/>`;
}

/**
 * Donut chart. slices: [{ label, value, color }]
 */
export function donut(slices, opts = {}) {
  const S = 240, cx = S / 2, cy = S / 2;
  const rOuter = 104, rInner = 68;
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return emptyChart(S, S, 'Nessun dato');

  let a0 = -Math.PI / 2;
  let arcs = '';
  slices.forEach((s) => {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    arcs += ring(cx, cy, rOuter, rInner, a0, a1, s.color);
    a0 = a1;
  });

  const centerTop = esc(opts.centerLabel || '');
  const centerMain = esc(opts.centerValue || '');

  return `
  <svg viewBox="0 0 ${S} ${S}" class="chart-donut" role="img">
    <g>${arcs}</g>
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" class="donut-label">${centerTop}</text>
    <text x="${cx}" y="${cy + 18}" text-anchor="middle" class="donut-value">${centerMain}</text>
  </svg>`;
}

function ring(cx, cy, rO, rI, a0, a1, fill) {
  // gestisce anche il caso fetta unica (~360°)
  const full = a1 - a0 >= Math.PI * 2 - 0.001;
  if (full) a1 = a0 + Math.PI * 2 - 0.0001;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0o = cx + rO * Math.cos(a0), y0o = cy + rO * Math.sin(a0);
  const x1o = cx + rO * Math.cos(a1), y1o = cy + rO * Math.sin(a1);
  const x0i = cx + rI * Math.cos(a1), y0i = cy + rI * Math.sin(a1);
  const x1i = cx + rI * Math.cos(a0), y1i = cy + rI * Math.sin(a0);
  return `<path d="M${x0o.toFixed(2)},${y0o.toFixed(2)} A${rO},${rO} 0 ${large} 1 ${x1o.toFixed(2)},${y1o.toFixed(2)} L${x0i.toFixed(2)},${y0i.toFixed(2)} A${rI},${rI} 0 ${large} 0 ${x1i.toFixed(2)},${y1i.toFixed(2)} Z" fill="${fill}"/>`;
}

/**
 * Grafico multi-linea (una linea per persona nel tempo).
 * series: [{ name, color, points:[Number] }] allineate a opts.labels
 */
export function multiLine(series, opts = {}) {
  const W = 680, H = 260;
  const padL = 8, padR = 8, padT = 18, padB = 30;
  const labels = opts.labels || [];
  if (!series || !series.length || labels.length < 1) return emptyChart(W, H, 'Nessun dato');

  const all = series.flatMap((s) => s.points);
  const hi = Math.max(1, ...all), lo = 0;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = labels.length;
  const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => padT + ih - ((v - lo) / (hi - lo || 1)) * ih;

  let grid = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = lo + (i / ticks) * (hi - lo);
    const yy = y(v);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" class="ch-grid"/>`;
    grid += `<text x="${W - padR}" y="${(yy - 4).toFixed(1)}" class="ch-ylabel" text-anchor="end">${esc(opts.fmtY ? opts.fmtY(v) : Math.round(v))}</text>`;
  }

  let lines = '';
  for (const s of series) {
    const pts = s.points.map((v, i) => ({ x: x(i), y: y(v) }));
    const d = smoothPath(pts);
    lines += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    const last = pts[pts.length - 1];
    if (last) lines += `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.5" fill="${s.color}"/>`;
  }

  let xlab = '';
  const step = Math.max(1, Math.ceil(n / 6));
  for (let i = 0; i < n; i += step) {
    xlab += `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ch-xlabel" text-anchor="middle">${esc(labels[i])}</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none" role="img">
    <g>${grid}</g><g>${lines}</g><g>${xlab}</g></svg>`;
}

// Mini sparkline per le card KPI. values: [Number]
export function sparkline(values, color = '#7C5CFF') {
  const W = 120, H = 36, pad = 3;
  if (!values || values.length < 2) return `<svg viewBox="0 0 ${W} ${H}" class="spark"></svg>`;
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (i) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v) => pad + (H - pad * 2) - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
  const d = smoothPath(pts);
  const gid = uid('spk');
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${d} L${x(values.length - 1)},${H} L${x(0)},${H} Z" fill="url(#${gid})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

function emptyChart(W, H, msg) {
  return `<svg viewBox="0 0 ${W} ${H}" class="chart chart-empty" role="img">
    <text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="ch-empty">${esc(msg)}</text>
  </svg>`;
}
