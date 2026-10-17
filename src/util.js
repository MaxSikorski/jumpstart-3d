// Small shared helpers: ids, expression parsing for numeric fields, zip, colors.

let idCounter = 0;
export function uid(prefix = "x") {
  idCounter = (idCounter + 1) % 1e6;
  return prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6) + idCounter.toString(36);
}

export const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
// ---- Apple devices. iPadOS Safari says it is a Mac, so a Mac with a touch screen is an iPad.
const NAV = typeof navigator !== "undefined" ? navigator : { userAgent: "", platform: "", maxTouchPoints: 0 };
export const IS_IOS = /iP(hone|ad|od)/.test(NAV.platform || "") || /iP(hone|ad|od)/.test(NAV.userAgent || "") || (/Mac/.test(NAV.platform || NAV.userAgent || "") && NAV.maxTouchPoints > 1);
export const IS_IPHONE = IS_IOS && /iPhone|iPod/.test(NAV.userAgent || "");
export const IS_MAC = !IS_IOS && /Mac/.test(NAV.platform || NAV.userAgent || "");
export const IS_SAFARI = /Safari\//.test(NAV.userAgent || "") && !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|Edg\/|EdgiOS\//.test(NAV.userAgent || "");
// the key name for shortcuts: ⌘ on a Mac or iPad keyboard, Ctrl elsewhere
export const MOD_KEY = IS_MAC || IS_IOS ? "⌘" : "Ctrl";
// iPhone and iPad grey out files whose type they don't know (STL, 3MF, STEP, DXF...), so file
// pickers there take any file and the app checks the name after picking
export function fileAccept(accept) {
  if (!IS_IOS || !accept) return accept;
  return accept.split(",").every((a) => /^(image|video)\//.test(a.trim()) || /^\.(png|jpe?g|gif|webp|bmp|svg|mp4|mov|json)$/i.test(a.trim())) ? accept : "";
}
// Mac / iPad keyboards: show ⌘ for Ctrl and ⌥ for Alt in the labels and tooltips the app writes
export function macKeys(t) { return t.replace(/\bCtrl\b/g, "⌘").replace(/\bAlt\b/g, "⌥"); }
export function watchMacLabels(root) {
  if (!(IS_MAC || IS_IOS) || typeof MutationObserver === "undefined") return;
  const fix = (n) => {
    if (n.nodeType === 3) { if (/\bCtrl\b|\bAlt\b/.test(n.data) && !(n.parentNode && /^(TEXTAREA|SCRIPT|STYLE)$/.test(n.parentNode.nodeName))) n.data = macKeys(n.data); return; }
    if (n.nodeType !== 1) return;
    const t = n.getAttribute("title"); if (t && /\bCtrl\b|\bAlt\b/.test(t)) n.setAttribute("title", macKeys(t));
    const a = n.getAttribute("aria-label"); if (a && /\bCtrl\b/.test(a)) n.setAttribute("aria-label", macKeys(a));
    if (n.nodeName === "SCRIPT" || n.nodeName === "STYLE" || n.nodeName === "TEXTAREA") return;
    for (let c = n.firstChild; c; c = c.nextSibling) fix(c);
  };
  fix(root);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(fix);
      else if (m.type === "characterData" || m.type === "attributes") fix(m.target);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["title", "aria-label"] });
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const round = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
export function fmt(v, dp = 2) {
  if (v == null || !isFinite(v)) return "–";
  const s = (Math.round(v * 10 ** dp) / 10 ** dp).toFixed(dp);
  // drop trailing zeros after the decimal point only (never from a whole number like 280)
  return (s.includes(".") ? s.replace(/\.?0+$/, "") : s) || "0";
}

// Parses "12", "10+2.5", "1in", "3/4 in", "2*(5+1)", "25mm", "2cm" -> millimetres.
export function parseLength(str, defaultUnit = "mm") {
  if (typeof str === "number") return str;
  let s = String(str).trim().toLowerCase();
  if (!s) return NaN;
  s = s.replace(/,/g, ".").replace(/(\d)\s*"/g, "$1in");
  let i = 0;
  const peek = () => s[i];
  const ws = () => { while (s[i] === " ") i++; };
  function num() {
    ws();
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
    if (!m) throw new Error("bad");
    i += m[0].length;
    let v = parseFloat(m[0]);
    ws();
    const u = /^(mm|cm|m(?![a-z])|in|ft|°|deg)/.exec(s.slice(i));
    if (u) {
      i += u[0].length;
      v *= { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, "°": 1, deg: 1 }[u[0]];
    } else if (defaultUnit === "in") v *= 25.4;
    return v;
  }
  function factor() {
    ws();
    if (peek() === "(") { i++; const v = expr(); ws(); if (peek() !== ")") throw new Error("bad"); i++; return v; }
    if (peek() === "-") { i++; return -factor(); }
    if (peek() === "+") { i++; return factor(); }
    return num();
  }
  function term() {
    let v = factor();
    for (;;) { ws(); const c = peek(); if (c === "*") { i++; v *= factor(); } else if (c === "/") { i++; v /= factor(); } else return v; }
  }
  function expr() {
    let v = term();
    for (;;) { ws(); const c = peek(); if (c === "+") { i++; v += term(); } else if (c === "-") { i++; v -= term(); } else return v; }
  }
  try {
    const v = expr();
    ws();
    if (i !== s.length) return NaN;
    return v;
  } catch (e) {
    return NaN;
  }
}

export function debounce(fn, ms) {
  let t = null;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  return f;
}

// --------------------------------------------------------- colors
export const PALETTE = ["#e4572e", "#f3a712", "#29a35a", "#2b7bb9", "#7b4fa8", "#d14d8b", "#1aa6a6", "#8c6d46", "#5a6b7c", "#c9cfd6"];
let paletteIdx = 0;
export function nextColor() { return PALETTE[paletteIdx++ % PALETTE.length]; }

// --------------------------------------------------------- zip (store only)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function makeZip(files) {
  // files: [{name, data: Uint8Array}]
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const csize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    // aria states need real "true"/"false" values (the CSS styles pressed buttons by them)
    if (k.startsWith("aria-") && typeof v === "boolean") { e.setAttribute(k, String(v)); continue; }
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
