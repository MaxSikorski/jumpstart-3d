import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, runRecipe } from './measure.mjs';

const names = ['top', 'front', 'right'];
const mod = (n, m) => ((n % m) + m) % m;

export function parseDXF(text) {
  const lines = String(text).split(/\r?\n/), pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1].trim()]);
  const out = { TOP: [], FRONT: [], RIGHT: [] };
  let poly = null;
  for (let i = 0; i < pairs.length;) {
    if (pairs[i][0] !== 0) { i++; continue; }
    const type = pairs[i++][1], fields = [];
    while (i < pairs.length && pairs[i][0] !== 0) fields.push(pairs[i++]);
    const get = (code, fallback) => fields.find(([c]) => c === code)?.[1] ?? fallback;
    const num = (code) => Number(get(code, NaN));
    const layer = get(8, '').toUpperCase();
    if (type === 'VERTEX' && poly) { poly.curve.pts.push([num(10), num(20)]); continue; }
    if (type === 'SEQEND') { poly = null; continue; }
    poly = null;
    if (!out[layer]) continue;
    let curve;
    if (type === 'LINE') curve = { t: 'line', a: [num(10), num(20)], b: [num(11), num(21)] };
    else if (type === 'CIRCLE') curve = { t: 'circle', c: [num(10), num(20)], r: num(40) };
    else if (type === 'ARC') curve = { t: 'arc', c: [num(10), num(20)], r: num(40), a0: num(50), a1: num(51) };
    else if (type === 'POLYLINE') {
      curve = { t: 'poly', pts: [], closed: (Number(get(70, 0)) & 1) !== 0 };
      poly = { curve };
    } else if (type === 'LWPOLYLINE') {
      const pts = [];
      for (const [code, value] of fields) {
        if (code === 10) pts.push([Number(value), NaN]);
        if (code === 20 && pts.length) pts[pts.length - 1][1] = Number(value);
      }
      curve = { t: 'poly', pts, closed: (Number(get(70, 0)) & 1) !== 0 };
    }
    if (curve) out[layer].push(curve);
  }
  return out;
}

export function relative(curves) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = ([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const c of curves) {
    if (c.t === 'line') { add(c.a); add(c.b); }
    else if (c.t === 'poly') c.pts.forEach(add);
    else if (c.t === 'circle') { add([c.c[0] - c.r, c.c[1] - c.r]); add([c.c[0] + c.r, c.c[1] + c.r]); }
    else if (c.t === 'arc') {
      const sweep = mod(c.a1 - c.a0, 360) || 360;
      for (const a of [c.a0, c.a1, ...[0, 90, 180, 270].filter(a => mod(a - c.a0, 360) <= sweep)]) {
        const rad = a * Math.PI / 180;
        add([c.c[0] + c.r * Math.cos(rad), c.c[1] + c.r * Math.sin(rad)]);
      }
    }
  }
  if (!Number.isFinite(x0)) return { curves: [], size: [0, 0] };
  const p = ([x, y]) => [x - x0, y - y0];
  return { curves: curves.map(c => c.t === 'line' ? { ...c, a: p(c.a), b: p(c.b) } : c.t === 'poly' ? { ...c, pts: c.pts.map(p) } : { ...c, c: p(c.c) }), size: [x1 - x0, y1 - y0] };
}

export function validateDrawing(d) {
  const fail = reason => { throw new Error(`drawing: ${reason}`); };
  const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  if (!d || typeof d !== 'object') fail('must be an object');
  if (typeof d.title !== 'string' || !d.title.trim()) fail('title must be non-empty');
  if (!['mm', 'in'].includes(d.units)) fail('units must be mm or in');
  if (!['first', 'third'].includes(d.projection)) fail('projection must be first or third');
  if (!Array.isArray(d.views) || !d.views.length || d.views.some(v => !names.includes(v)) || new Set(d.views).size !== d.views.length) fail('views must be a non-empty list of distinct top, front or right');
  if (!Array.isArray(d.notes) || d.notes.some(n => typeof n !== 'string')) fail('notes must be an array of strings');
  if (!Array.isArray(d.dims)) fail('dims must be an array');
  for (const [i, dim] of d.dims.entries()) {
    const bad = reason => fail(`dim ${i + 1}: ${reason}`);
    if (!dim || typeof dim !== 'object') bad('must be an object');
    if (!d.views.includes(dim.view)) bad('view must be in views');
    if (dim.type === 'linear') {
      if (!['x', 'y'].includes(dim.along)) bad('along must be x or y');
      if (!point(dim.from) || !point(dim.to)) bad('from and to must be points');
      if (!Number.isFinite(dim.at)) bad('at must be a number');
      if (typeof dim.text !== 'string') bad('text must be a string');
    } else if (dim.type === 'leader') {
      if (!point(dim.point) || !point(dim.to)) bad('point and to must be points');
      if (dim.r !== undefined && !(Number.isFinite(dim.r) && dim.r > 0)) bad('r must be positive');
      if (typeof dim.text !== 'string') bad('text must be a string');
    } else if (dim.type === 'centre') {
      if (!point(dim.point)) bad('point must be a point');
      if (!(Number.isFinite(dim.r) && dim.r > 0)) bad('r must be positive');
    } else bad('unknown type');
  }
}

function bounds(view, dims, scale) {
  let [x0, y0, x1, y1] = [0, 0, ...view.size];
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const h = 30 / scale;
  for (const d of dims) {
    if (d.type === 'linear') {
      const w = d.text.length * 0.6 * h, mid = d.along === 'x' ? (d.from[0] + d.to[0]) / 2 : (d.from[1] + d.to[1]) / 2;
      if (d.along === 'x') { add(d.from[0], d.at - 3); add(d.to[0], d.at - 3); add(d.from[0], d.at + 3); add(d.to[0], d.at + 3); add(mid - w / 2, d.at); add(mid + w / 2, d.at + h * 1.3); }
      else { add(d.at - 3, d.from[1]); add(d.at - 3, d.to[1]); add(d.at + 3, d.from[1]); add(d.at + 3, d.to[1]); add(d.at - h * 1.3, mid - w / 2); add(d.at, mid + w / 2); }
      add(...d.from); add(...d.to);
    } else if (d.type === 'leader') {
      const w = d.text.length * 0.6 * h, sign = d.to[0] >= d.point[0] ? 1 : -1;
      add(...d.point); add(...d.to); add(d.to[0] + sign * (5 + w), d.to[1] + h);
    } else { add(d.point[0] - d.r * 1.2, d.point[1] - d.r * 1.2); add(d.point[0] + d.r * 1.2, d.point[1] + d.r * 1.2); }
  }
  return [x0, y0, x1, y1];
}

export function layout(views, drawing, pxPerMm) {
  const b = Object.fromEntries(drawing.views.map(v => [v, bounds(views[v], drawing.dims.filter(d => d.view === v), pxPerMm)]));
  const place = Object.fromEntries(drawing.views.map(v => [v, [0, 0]]));
  const gap = 80 / pxPerMm; // 80 pixels between neighbours, whatever the part's size
  if (b.right && (b.front || b.top)) {
    const column = [b.front, b.top].filter(Boolean);
    place.right[0] = drawing.projection === 'third' ? Math.max(...column.map(v => v[2])) - b.right[0] + gap : Math.min(...column.map(v => v[0])) - b.right[2] - gap;
  }
  if (b.top && (b.front || b.right)) {
    const row = [b.front, b.right].filter(Boolean);
    place.top[1] = drawing.projection === 'third' ? Math.max(...row.map(v => v[3])) - b.top[1] + gap : Math.min(...row.map(v => v[1])) - b.top[3] - gap;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of drawing.views) { const [x, y] = place[v], [a, c, d, e] = b[v]; x0 = Math.min(x0, x + a); y0 = Math.min(y0, y + c); x1 = Math.max(x1, x + d); y1 = Math.max(y1, y + e); }
  for (const p of Object.values(place)) { p[0] -= x0; p[1] -= y0; }
  return { place, width: x1 - x0, height: y1 - y0 };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function drawingSVG(drawing, views, opts = {}) {
  validateDrawing(drawing);
  const width = opts.width ?? 2000;
  let scale = 1, sheet;
  for (let i = 0; i < 50; i++) { sheet = layout(views, drawing, scale); const next = (width - 80) / sheet.width; if (Math.abs(next - scale) < 1e-8) break; scale = next; }
  sheet = layout(views, drawing, scale);
  const blockLines = [drawing.title, ...drawing.notes, `UNITS: ${drawing.units === 'mm' ? 'MM' : 'INCH'}`, `${drawing.projection.toUpperCase()} ANGLE PROJECTION`, 'Drawn for the JumpStart 3D drawing bench'];
  const height = Math.ceil(80 + sheet.height * scale + 35 + blockLines.length * 38 + 20);
  const X = x => 40 + x * scale, Y = y => 40 + (sheet.height - y) * scale;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`, `<rect width="100%" height="100%" fill="white"/>`, `<g fill="none" stroke="black" stroke-width="3">`];
  const line = (a, b) => `<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}"/>`;
  for (const v of drawing.views) {
    const [dx, dy] = sheet.place[v], p = q => [q[0] + dx, q[1] + dy];
    for (const c of views[v].curves) {
      if (c.t === 'line') out.push(line(p(c.a), p(c.b)));
      else if (c.t === 'circle') out.push(`<circle cx="${X(dx + c.c[0])}" cy="${Y(dy + c.c[1])}" r="${c.r * scale}"/>`);
      else if (c.t === 'poly') out.push(`<${c.closed ? 'polygon' : 'polyline'} points="${c.pts.map(q => `${X(dx + q[0])},${Y(dy + q[1])}`).join(' ')}"/>`);
      else if (c.t === 'arc') {
        const sweep = mod(c.a1 - c.a0, 360) || 360, pt = a => p([c.c[0] + c.r * Math.cos(a * Math.PI / 180), c.c[1] + c.r * Math.sin(a * Math.PI / 180)]);
        const a = pt(c.a0), z = pt(c.a1);
        if (sweep === 360) out.push(`<circle cx="${X(dx + c.c[0])}" cy="${Y(dy + c.c[1])}" r="${c.r * scale}"/>`);
        else out.push(`<path d="M ${X(a[0])} ${Y(a[1])} A ${c.r * scale} ${c.r * scale} 0 ${sweep > 180 ? 1 : 0} 0 ${X(z[0])} ${Y(z[1])}"/>`);
      }
    }
  }
  out.push('</g><g stroke="black" stroke-width="1.5" fill="none">');
  const text = [];
  const arrow = (tip, toward) => {
    const x = X(tip[0]), y = Y(tip[1]), vx = X(toward[0]) - x, vy = Y(toward[1]) - y, len = Math.hypot(vx, vy) || 1, ux = vx / len, uy = vy / len;
    out.push(`<path fill="black" stroke="none" d="M ${x} ${y} L ${x + 18 * ux - 5 * uy} ${y + 18 * uy + 5 * ux} L ${x + 18 * ux + 5 * uy} ${y + 18 * uy - 5 * ux} Z"/>`);
  };
  for (const d of drawing.dims) {
    const [dx, dy] = sheet.place[d.view], p = q => [q[0] + dx, q[1] + dy];
    if (d.type === 'linear') {
      const a = p(d.from), b = p(d.to), horizontal = d.along === 'x', at = d.at + (horizontal ? dy : dx);
      const u = horizontal ? [a[0], at] : [at, a[1]], v = horizontal ? [b[0], at] : [at, b[1]];
      for (const [start, end] of [[a, u], [b, v]]) {
        const delta = horizontal ? end[1] - start[1] : end[0] - start[0], sign = Math.sign(delta) || 1;
        const from = [...start], to = [...end], axis = horizontal ? 1 : 0; from[axis] += sign * 2 / scale; to[axis] += sign * 3; out.push(line(from, to));
      }
      out.push(line(u, v)); arrow(u, v); arrow(v, u);
      const mx = (X(u[0]) + X(v[0])) / 2, my = (Y(u[1]) + Y(v[1])) / 2;
      text.push(horizontal ? `<text x="${mx}" y="${my - 7}" text-anchor="middle">${esc(d.text)}</text>` : `<text x="${mx - 7}" y="${my}" text-anchor="middle" transform="rotate(-90 ${mx - 7} ${my})">${esc(d.text)}</text>`);
    } else if (d.type === 'leader') {
      const c = p(d.point), end = p(d.to), dist = Math.hypot(end[0] - c[0], end[1] - c[1]) || 1, start = [c[0] + (d.r || 0) * (end[0] - c[0]) / dist, c[1] + (d.r || 0) * (end[1] - c[1]) / dist], sign = end[0] >= c[0] ? 1 : -1, shoulder = [end[0] + sign * 5, end[1]];
      out.push(line(start, end), line(end, shoulder)); arrow(start, end);
      text.push(`<text x="${X(shoulder[0]) + sign * 5}" y="${Y(shoulder[1]) - 5}" text-anchor="${sign > 0 ? 'start' : 'end'}">${esc(d.text)}</text>`);
    } else {
      const [x, y] = p(d.point), r = d.r * 1.2; out.push(line([x - r, y], [x + r, y]), line([x, y - r], [x, y + r]));
    }
  }
  out.push('</g>', `<g fill="black" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="30">`, ...text);
  const by = 40 + sheet.height * scale + 55;
  blockLines.forEach((s, i) => out.push(`<text x="40" y="${by + i * 38}" font-size="${i > 0 && i <= drawing.notes.length ? 26 : 30}">${esc(s)}</text>`));
  out.push('</g></svg>');
  return out.join('');
}

export async function drawCase(call, dir, { png }) {
  const data = JSON.parse(await readFile(path.join(dir, 'case.json'), 'utf8'));
  validateDrawing(data.drawing);
  const recipe = JSON.parse(await readFile(path.join(dir, 'truth.recipe.json'), 'utf8'));
  await call('newDesign', ['advanced']);
  await runRecipe(call, recipe);
  const dxf = await call('drawing', [{ views: data.drawing.views }]);
  const parsed = parseDXF(Buffer.from(dxf).toString('utf8'));
  const views = Object.fromEntries(data.drawing.views.map(v => [v, relative(parsed[v.toUpperCase()])]));
  for (const v of data.drawing.views) if (!views[v].curves.length) throw new Error(`drawing: ${v} view is empty`);
  const svg = drawingSVG(data.drawing, views), height = Number(svg.match(/ height="(\d+)"/)[1]);
  const file = path.join(dir, 'drawing.png');
  await writeFile(file, await png(svg));
  return { file, width: 2000, height };
}

async function main(args) {
  let id, app;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] !== '--case' && args[i] !== '--app') || !args[i + 1] || args[i + 1].startsWith('--')) throw Object.assign(new Error('usage: draw.mjs [--case <id>] [--app <url|file|dir>]'), { usage: true });
    if (args[i] === '--case') { if (id) throw Object.assign(new Error('duplicate --case'), { usage: true }); id = args[++i]; }
    else { if (app) throw Object.assign(new Error('duplicate --app'), { usage: true }); app = args[++i]; }
  }
  if (id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw Object.assign(new Error('invalid case id'), { usage: true });
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cases');
  const ids = id ? [id] : (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
  for (const name of ids) validateDrawing(JSON.parse(await readFile(path.join(root, name, 'case.json'), 'utf8')).drawing);
  let session, browser;
  try {
    session = await openApp(app);
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 2000, height: 1000 }, deviceScaleFactor: 1 });
    const png = async svg => { await page.setContent(`<!doctype html><body style="margin:0;background:#fff">${svg}</body>`); return page.locator('svg').screenshot({ omitBackground: false }); };
    for (const name of ids) { const result = await drawCase(session.call, path.join(root, name), { png }); console.log(`${name}: drawing.png ${result.width} x ${result.height}`); }
  } finally { try { await session?.close(); } finally { await browser?.close(); } }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(e => { console.error(e.message || String(e)); process.exitCode = e.usage ? 2 : 1; });
