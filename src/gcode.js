// G-code for the 3D Print Sim: turns the sliced toolpaths (walls, infill, skins) and support
// columns into a G-code file a printer can run, the way a slicer like Orca Slicer writes it:
// a start block for the printer's firmware (Marlin, Klipper, Prusa or Bambu style), relative
// extrusion, a skirt or brim on the first layer, retraction and Z hop on travel moves, cooling,
// feature comments (;TYPE:Outer wall …) and layer comments so slicer previews show the lines,
// progress (M73) and tool changes (T0, T1 …) for multi-filament prints.

import { Moves, timeMoves, featureMotion, motionFor, MOTION, COOLING, SPEED_PRESETS } from "./motion.js";
export { SPEED_PRESETS, motionFor, MOTION, COOLING };
export const KINDS = ["outer", "inner", "sparse", "solid", "top", "bottom", "bridge"];
const TYPE_NAME = { outer: "Outer wall", inner: "Inner wall", sparse: "Sparse infill", solid: "Internal solid infill", top: "Top surface", bottom: "Bottom surface", bridge: "Bridge", support: "Support", skirt: "Skirt", brim: "Brim" };
// nozzle / bed temperatures (°C), fan (%), for each filament
export const FIL_TEMPS = {
  pla: [210, 60, 100], plaplus: [215, 60, 100], petg: [240, 80, 40], abs: [250, 100, 15], asa: [255, 100, 20], nylon: [260, 80, 20],
  pc: [270, 110, 10], cfpla: [220, 60, 100], cfnylon: [275, 80, 20], peek: [400, 130, 0], tpu: [225, 45, 60],
};
export const FLAVORS = [["marlin", "Marlin"], ["klipper", "Klipper"], ["prusa", "Prusa"], ["bambu", "Bambu Lab"]];
export function flavorFor(printer) {
  const b = (printer && printer.brand) || "";
  if (b === "Bambu Lab") return "bambu";
  if (b === "Prusa") return "prusa";
  if (b === "Voron" || /K1|K2|Adventurer|AD5X|Creator/.test(printer.name || "")) return "klipper";
  return "marlin";
}

const f3 = (x) => (Math.round(x * 1000) / 1000).toString();
const f5 = (x) => (Math.round(x * 100000) / 100000).toString();
const INFILL = new Set(["sparse", "solid", "top", "bottom", "bridge"]);

// S: the slice (lines in order, layerEnd, lkind, lslot, nL, lh), sup: support columns
// [{x, y, z0, z1}] with spacing sp, o: settings (o.motion: a profile from motion.js),
// opt.estimate: work out the times only (no text)
export function makeGcode(S, sup, o, opt = {}) {
  const est = !!opt.estimate;
  const out = [];
  const W = est ? () => {} : (s) => out.push(s);
  const lh = S.lh, LW = o.lineWidth || 0.42, fil = o.filamentDia || 1.75;
  const eArea = Math.PI * (fil / 2) ** 2;
  const ePerMM = (LW * lh) / eArea;
  const ox = o.bed.w / 2, oy = o.bed.d / 2; // the sim's plate is centred on 0, 0
  const mult = (SPEED_PRESETS.find((p) => p[0] === o.speed) || SPEED_PRESETS[1])[2];
  const prof = o.motion || motionFor(o.printerKey, null);
  const maxV = (o.maxFlow || 18) / (LW * lh); // mm/s the hot end can melt
  const [coolT, coolMin] = o.cooling || COOLING[o.filamentKey] || [4, 20];
  const motion = (kind, k) => { const [v, a] = featureMotion(prof, kind, k, mult); return [Math.max(5, Math.min(v, maxV)), a]; };
  const travelV = Math.min(prof.mach.v, prof.travel * Math.min(1.4, mult)), travelA = Math.min(prof.mach.travel, (prof.acc.travel || prof.acc.def) * Math.min(1, mult));
  const retract = o.retract ?? 0.8, hop = o.zhop ? 0.4 : 0, retractV = 40;
  const [tn, tb, fan] = [o.nozzleTemp, o.bedTemp, o.fan];
  // per layer: the moves, then their times, then the text
  const M = new Moves(1 << 15);
  const ops = []; // per layer: numbers are moves (index into M), strings are other G-code lines
  let x = 0, y = 0, z = 0, e = 0, retracted = false, curType = "", tool = -1, lastKind = "";
  let filUsed = 0;
  const mv = (nx, ny, nz, de, f, a, trav) => { e += de; ops.push(M.push(nx, ny, nz, e, f, a, trav)); x = nx; y = ny; z = nz; if (de > 0) filUsed += de; };
  const doRetract = () => { if (retract > 0 && !retracted) { mv(x, y, z, -retract, retractV, 0, true); retracted = true; if (hop) mv(x, y, z + hop, 0, prof.mach.z, 500, true); } };
  const unRetract = () => { if (retracted) { if (hop) mv(x, y, z - hop, 0, prof.mach.z, 500, true); mv(x, y, z, retract, retractV, 0, true); retracted = false; } };
  const travel = (nx, ny, nextKind) => {
    const d = Math.hypot(nx - x, ny - y);
    if (d < 0.01) return;
    // like Orca's "reduce infill retraction": moving from infill to infill inside the part
    // doesn't need a retraction
    const inInfill = INFILL.has(lastKind) && INFILL.has(nextKind) && d < 15;
    if (d > 1 && !inInfill) doRetract();
    mv(nx, ny, z, 0, travelV, travelA, true);
    unRetract();
  };
  const type = (k) => { if (k !== curType) { ops.push(";TYPE:" + TYPE_NAME[k]); curType = k; } };
  const extrude = (x0, y0, x1, y1, kind, k, flow = 1) => {
    if (Math.hypot(x0 - x, y0 - y) > 0.02) travel(x0, y0, kind);
    type(kind);
    const d = Math.hypot(x1 - x0, y1 - y0); if (d < 0.005) return;
    const [v, a] = motion(kind, k);
    mv(x1, y1, z, d * ePerMM * flow * (k === 0 ? 1.05 : 1), v, a, false);
    lastKind = kind;
  };
  // text for a move: only what changed, with the speed (F, mm/min) and acceleration (M204)
  let tx = 0, ty = 0, tz = 0, tF = 0, tA = 0;
  const writeOps = () => {
    const d = M.d;
    for (const op of ops) {
      if (typeof op === "string") { W(op); continue; }
      const q = op * 7, dx = d[q] - tx, dy = d[q + 1] - ty, dz = d[q + 2] - tz, de = d[q + 3] - (q >= 7 ? d[q - 4] : d[q + 3]);
      const f = Math.round(d[q + 4] * 60), a = Math.round(d[q + 5]), trav = d[q + 6] > 0;
      const xy = Math.abs(dx) > 5e-4 || Math.abs(dy) > 5e-4;
      if (xy && a && a !== tA) { W(`M204 S${a}`); tA = a; }
      let s = trav && xy && !Math.abs(dz) ? "G0" : "G1";
      if (xy) s += ` X${f3(d[q] + ox)} Y${f3(d[q + 1] + oy)}`;
      if (Math.abs(dz) > 5e-5) s += ` Z${f3(d[q + 2])}`;
      if (Math.abs(de) > 1e-6) s += ` E${f5(de)}`;
      if (f !== tF) { s += ` F${f}`; tF = f; }
      W(s);
      tx = d[q]; ty = d[q + 1]; tz = d[q + 2];
    }
  };
  // ---- header
  W("; generated by JumpStart 3D (3D Print Sim)");
  W(`; printer: ${o.printerName}`);
  W(`; filament: ${o.filamentName}, nozzle ${tn} °C, bed ${tb} °C`);
  W(`; layer height: ${lh} mm, walls: ${o.walls}, infill: ${o.infill}%, top ${o.topN} / bottom ${o.botN} layers`);
  W(`; supports: ${o.supports}, speed: ${o.speed}, G-code flavor: ${o.flavor}`);
  W(`; speeds and accelerations: ${prof.name} (Orca Slicer profile)`);
  W("; estimated printing time (not counting warm-up): @@TIME@@");
  W("; filament used [mm]: @@FIL@@");
  W("; filament used [g]: @@GRAMS@@");
  W(";HEADER_BLOCK_END");
  // ---- start
  const startBlock = {
    marlin: [`M140 S${tb}`, `M104 S${tn}`, "G28 ; home", `M190 S${tb}`, `M109 S${tn}`, "G90", "M83 ; relative extrusion", "G92 E0", "G1 Z2 F900", "G1 X5 Y20 F6000", "G1 Z0.3 F900", "G1 X5 Y120 E10 F1500 ; purge line", "G1 X5.5 Y120 F3000", "G1 X5.5 Y20 E10 F1500", "G92 E0", "G1 Z2 F900"],
    klipper: [`; uses your printer's start macro (most Klipper printers call it PRINT_START or START_PRINT)`, `M140 S${tb}`, `M104 S${tn}`, `START_PRINT EXTRUDER_TEMP=${tn} BED_TEMP=${tb}`, `M190 S${tb}`, `M109 S${tn}`, "G90", "M83", "G92 E0", "G1 Z2 F900", "G1 X5 Y20 F6000", "G1 Z0.3 F900", "G1 X5 Y120 E10 F1500 ; purge line", "G92 E0", "G1 Z2 F900"],
    prusa: [`M140 S${tb}`, `M104 S${Math.min(tn, 170)} ; preheat for probing`, "G28 ; home", `M190 S${tb}`, "G29 ; mesh bed levelling", `M109 S${tn}`, "G90", "M83", "G92 E0", "G1 Z0.3 F720", "G1 X5 Y-3 F4000", "G1 X60 E9 F1000 ; purge line", "G1 X100 E12.5 F1000", "G92 E0", "G1 Z2 F900"],
    bambu: ["; Bambu Lab: open this file in Bambu Studio or Orca Slicer to send it, or print it from the SD card", `M140 S${tb}`, `M104 S${tn}`, "G28 ; home", `M190 S${tb}`, `M109 S${tn}`, "G90", "M83", "G92 E0", "G1 Z2 F900", "G1 X18 Y1 F6000", "G1 Z0.3 F900", "G1 X120 Y1 E12 F1800 ; purge line", "G1 X120 Y1.5 F3000", "G1 X18 Y1.5 E12 F1800", "G92 E0", "G1 Z2 F900"],
  }[o.flavor] || [];
  for (const s of startBlock) W(s);
  W(`M201 X${prof.mach.acc} Y${prof.mach.acc} ; acceleration limits`);
  W("M107 ; fan off for the first layer");
  // the head is at the purge line's end, 2 mm up
  x = (o.flavor === "bambu" ? 18 : 5.5) - ox; y = (o.flavor === "bambu" ? 1.5 : 20) - oy; z = 2;
  tx = x; ty = y; tz = z;
  // ---- layers
  const nL = S.nL, ends = S.layerEnd, L = S.lines, K = S.lkind, SL = S.lslot;
  let li = 0;
  const totalLines = L.length / 6;
  // first-layer outline (for the skirt / brim): the convex hull of the first layer's lines
  const hull = (() => {
    const end0 = (ends[0] || 0) / 2, P = [];
    for (let i = 0; i < end0; i++) P.push([L[i * 6], L[i * 6 + 1]], [L[i * 6 + 3], L[i * 6 + 4]]);
    if (P.length < 3) return null;
    P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o2, a, b) => (a[0] - o2[0]) * (b[1] - o2[1]) - (a[1] - o2[1]) * (b[0] - o2[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  })();
  const loopAround = (H, d) => {
    // the hull pushed out by d (corners rounded)
    const c = H.reduce((a, p) => [a[0] + p[0] / H.length, a[1] + p[1] / H.length], [0, 0]), out2 = [];
    for (let i = 0; i < H.length; i++) {
      const a = H[(i + H.length - 1) % H.length], b = H[i], cc = H[(i + 1) % H.length];
      const n1 = norm2([b[1] - a[1], a[0] - b[0]]), n2 = norm2([cc[1] - b[1], b[0] - cc[0]]);
      // outward: away from the middle
      const s = (b[0] - c[0]) * (n1[0] + n2[0]) + (b[1] - c[1]) * (n1[1] + n2[1]) < 0 ? -1 : 1;
      const a1 = Math.atan2(s * n1[1], s * n1[0]); let a2 = Math.atan2(s * n2[1], s * n2[0]);
      let da = a2 - a1; da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
      const steps = Math.max(1, Math.ceil(Math.abs(da) / 0.3));
      for (let k = 0; k <= steps; k++) { const an = a1 + (da * k) / steps; out2.push([b[0] + d * Math.cos(an), b[1] + d * Math.sin(an)]); }
    }
    return out2;
  };
  const supByLayer = (k, zz) => {
    if (!sup || !sup.cols || !sup.cols.length) return [];
    // rows of support columns active at this height become zig-zag lines
    const rows = new Map(), sp = sup.sp || 2;
    for (const c of sup.cols) if (c.z0 < zz && c.z1 >= zz - 1e-6) { const key = Math.round(c.y / sp); if (!rows.has(key)) rows.set(key, []); rows.get(key).push(c.x); }
    const segs = [];
    let flip = false;
    for (const key of [...rows.keys()].sort((a, b) => a - b)) {
      const xs = rows.get(key).sort((a, b) => a - b), yy = key * sp;
      let s0 = xs[0], prev = xs[0];
      const runs = [];
      for (let i = 1; i <= xs.length; i++) { if (i === xs.length || xs[i] - prev > sp * 1.5) { runs.push([s0 - sp * 0.45, prev + sp * 0.45]); if (i < xs.length) s0 = xs[i]; } if (i < xs.length) prev = xs[i]; }
      for (const [a, b] of runs) segs.push(flip ? [b, yy, a, yy] : [a, yy, b, yy]);
      flip = !flip;
    }
    return segs;
  };
  const layerT = new Float64Array(nL);
  let t = 0, slowed = 0;
  for (let k = 0; k < nL; k++) {
    const zz = +((k + 1) * lh).toFixed(4);
    // each layer's moves start again at index 1; move 0 is where the head is
    M.n = 0; ops.length = 0; M.push(x, y, z, e, travelV, travelA, true);
    ops.push(";LAYER_CHANGE", `;Z:${f3(zz)}`, `;HEIGHT:${lh}`);
    if (k > 0) doRetract();
    mv(x, y, zz + (retracted && hop ? hop : 0), 0, prof.mach.z, 500, true);
    unRetract();
    ops.push(`M73 P${Math.round((li / Math.max(1, totalLines)) * 100)} R@@R${k}@@`);
    if (k === 1 && fan > 0) ops.push(`M106 S${Math.round((fan / 100) * 255)}`);
    lastKind = "";
    if (k === 0 && hull) {
      if (o.brim > 0) { const n = Math.max(1, Math.round(o.brim / LW)); for (let r = n; r >= 1; r--) { const lp = loopAround(hull, r * LW); for (let i = 0; i < lp.length; i++) { const a = lp[i], b = lp[(i + 1) % lp.length]; extrude(a[0], a[1], b[0], b[1], "brim", 0); } } }
      for (let s = 0; s < (o.skirt || 0); s++) { const lp = loopAround(hull, (o.brim || 0) + 4 + s * LW); for (let i = 0; i < lp.length; i++) { const a = lp[i], b = lp[(i + 1) % lp.length]; extrude(a[0], a[1], b[0], b[1], "skirt", 0); } }
    }
    for (const [a0, b0, a1, b1] of supByLayer(k, zz)) extrude(a0, b0, a1, b1, "support", k, 0.85);
    // the model's lines: kept in order, but each run of the same feature is walked nearest-first
    // (and lines flipped) so the nozzle doesn't travel back and forth across the part
    const end = (ends[k] || 0) / 2;
    let i = li;
    while (i < end) {
      const kind = KINDS[K[i]], slot = SL ? SL[i] : 0;
      let j = i; while (j < end && K[j] === K[i] && (SL ? SL[j] : 0) === slot) j++;
      if (SL && slot !== tool) { if (tool >= 0 || slot > 0) { doRetract(); ops.push(`T${slot} ; filament F${slot + 1}`); } tool = slot; }
      const idx = []; for (let q = i; q < j; q++) idx.push(q);
      const walls = kind === "outer" || kind === "inner";
      if (!walls && idx.length > 1) {
        // nearest first, using a coarse grid so big layers stay quick
        const used = new Uint8Array(idx.length), G = new Map(), gs = 4;
        const gk = (px, py) => Math.floor(px / gs) + "," + Math.floor(py / gs);
        idx.forEach((q, n) => { const m = q * 6; for (const [px, py] of [[L[m], L[m + 1]], [L[m + 3], L[m + 4]]]) { const kk = gk(px, py); if (!G.has(kk)) G.set(kk, []); G.get(kk).push(n); } });
        let cx = x, cy = y, left = idx.length;
        while (left) {
          let best = -1, bd = Infinity, fl = false;
          const gx = Math.floor(cx / gs), gy = Math.floor(cy / gs);
          for (let r = 0; r < 64 && best < 0; r++) {
            for (let ix = gx - r; ix <= gx + r; ix++) for (let iy = gy - r; iy <= gy + r; iy++) {
              if (r && ix > gx - r && ix < gx + r && iy > gy - r && iy < gy + r) continue;
              const cell = G.get(ix + "," + iy); if (!cell) continue;
              for (const n of cell) {
                if (used[n]) continue;
                const m = idx[n] * 6, d0 = (L[m] - cx) ** 2 + (L[m + 1] - cy) ** 2, d1 = (L[m + 3] - cx) ** 2 + (L[m + 4] - cy) ** 2;
                if (d0 < bd) { bd = d0; best = n; fl = false; }
                if (d1 < bd) { bd = d1; best = n; fl = true; }
              }
            }
          }
          if (best < 0) { for (let n = 0; n < idx.length; n++) if (!used[n]) { best = n; break; } }
          used[best] = 1; left--;
          const m = idx[best] * 6;
          if (fl) { extrude(L[m + 3], L[m + 4], L[m], L[m + 1], kind, k); cx = L[m]; cy = L[m + 1]; }
          else { extrude(L[m], L[m + 1], L[m + 3], L[m + 4], kind, k); cx = L[m + 3]; cy = L[m + 4]; }
        }
      } else for (const q of idx) { const m = q * 6; extrude(L[m], L[m + 1], L[m + 3], L[m + 4], kind, k); }
      i = j;
    }
    li = end;
    // time the layer; slow it down for cooling if it would print faster than the filament allows
    const per = new Float64Array(M.n);
    let lt = timeMoves(M, 1, M.n, prof, per.subarray(1));
    if (coolT > 0 && lt < coolT && k > 0) {
      let te = 0; for (let q = 1; q < M.n; q++) if (!M.d[q * 7 + 6] && M.d[q * 7 + 3] > M.d[q * 7 - 4]) te += per[q];
      const want = te + (coolT - lt);
      if (te > 0.01) {
        const s = te / want;
        for (let q = 1; q < M.n; q++) { const o2 = q * 7; if (!M.d[o2 + 6] && M.d[o2 + 3] > M.d[o2 - 4]) M.d[o2 + 4] = Math.max(Math.min(coolMin, M.d[o2 + 4]), M.d[o2 + 4] * s); }
        lt = timeMoves(M, 1, M.n, prof, null); slowed++;
      }
    }
    t += lt; layerT[k] = lt;
    if (!est) { writeOps(); out.push("@@LAYER_TIME@@" + k + "|" + t); }
  }
  if (est) return { secs: t, layerT, filamentMM: filUsed, grams: (filUsed * eArea * (o.density || 1.24)) / 1000, layers: nL, slowed, profile: prof.name };
  // ---- end
  const top = z;
  for (const s of [`G1 E-${f3(retract || 0.8)} F2400`, `G1 Z${f3(Math.min(top + 10, (o.bed.h || 250) - 1))} F720`, `G0 X${f3(Math.min(10, o.bed.w))} Y${f3(o.bed.d - 10)} F${Math.round(travelV * 60)} ; present the plate`, "M104 S0", "M140 S0", "M107", "M84 ; motors off", "M73 P100 R0"]) W(s);
  // fill in the time and the filament
  const grams = (filUsed * eArea * (o.density || 1.24)) / 1000;
  const hms = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60); return (h ? h + "h " : "") + m + "m " + sec + "s"; };
  const times = new Map();
  const lines = [];
  for (const s of out) { if (s.startsWith("@@LAYER_TIME@@")) { const [kk, tt] = s.slice(14).split("|"); times.set(+kk, +tt); } else lines.push(s); }
  let text = lines.join("\n") + "\n";
  text = text.replace("@@TIME@@", hms(t)).replace("@@FIL@@", f3(filUsed)).replace("@@GRAMS@@", grams.toFixed(2));
  text = text.replace(/@@R(\d+)@@/g, (m0, kk) => { const at = kk > 0 ? times.get(+kk - 1) || 0 : 0; return String(Math.max(0, Math.round((t - at) / 60))); });
  return { text, secs: t, layerT, filamentMM: filUsed, grams, layers: nL, slowed, profile: prof.name };
}
function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
