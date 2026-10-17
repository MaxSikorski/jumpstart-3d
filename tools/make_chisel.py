import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
# Builds src/chisel.html from the Chisel Sculpt app: runs inside JumpStart 3D as the
# third mode, "Chisel". The sculpting itself is unchanged; this adds a bridge so
# sculpts live in the JumpStart 3D design (as mesh bodies) and bodies of the design can be
# brought in to sculpt.
src = open(ROOT + '/tools/chisel-source.html').read()
s = src
def R(a, b, count=1):
    global s
    assert a in s, a[:100]
    s = s.replace(a, b, count)

# its own copy of three.js (bundled, no network)
three = open(ROOT + '/tools/three-global.min.js').read().replace('</script', '<\\/script')
R('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', '<script>' + three + '</script>')
# no web fonts (works offline; falls back to the system fonts)
for line in ['<link rel="preconnect" href="https://fonts.googleapis.com">\n', '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n']:
    R(line, '')
import re
s = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com/css2[^"]*">\n', '', s, count=1)
R('<title>Chisel Sculpt</title>', '<title>Chisel · JumpStart 3D</title>')
# matcaps are sRGB pictures (three.js r169 manages color)
R('    m.tex = new THREE.CanvasTexture(cv);', '    m.tex = new THREE.CanvasTexture(cv); m.tex.colorSpace = THREE.SRGBColorSpace;')

# every change to an object's mesh, mask or paint bumps its version (what needs saving)
R('  o.pos = pos; o.idx = idx; o.adj = null; o.dirty = true;', '  o.pos = pos; o.idx = idx; o.adj = null; o.dirty = true; o.rev = (o.rev || 0) + 1;')
R('function markGeo(o) { geoDirty.add(o); req(); }', 'function markGeo(o) { geoDirty.add(o); o.rev = (o.rev || 0) + 1; req(); }')
R('  c.needsUpdate = true; req();\n}', '  c.needsUpdate = true; o.rev = (o.rev || 0) + 1; req();\n}')

# ---- bodies of the design shown in Chisel as they are ("design" objects, o.ref = body id).
# They don't change the design until touched: the first sculpt stroke evens out their mesh,
# and any change (sculpt, cut, move) makes them a sculpt that replaces the body when saved.
# undo snapshots carry what an object is
R("      return { id: o.id, name: o.name, snap: o.snap, p: o.mesh.position.toArray(),",
  "      return { id: o.id, name: o.name, snap: o.snap, ref: o.ref || null, refSnap: o.refSnap || null, refDisp: o.refDisp || null, refM: o.refM || null, refKey: o.refKey || null, p: o.mesh.position.toArray(),")
R("    o.snap = s.snap; o.dirty = false; o.name = s.name;",
  "    o.snap = s.snap; o.dirty = false; o.name = s.name;\n    if (!o.jsId) { o.ref = s.ref; o.refSnap = s.refSnap; o.refM = s.refM; o.refKey = s.refKey; o.refDisp = s.refDisp; if (s.ref) refGone.delete(s.ref); if (o.ref && o.snap === o.refSnap) refShow(o); }")
# a design object that leaves Chisel (joined into another, sliced away...) leaves the design too
R("function removeObj(o) {\n", "let refGone = new Set(), refQuiet = false;\nfunction removeObj(o) {\n  if (o.ref && !refQuiet) refGone.add(o.ref);\n")
# deleting a design object only hides it here (it stays in the design)
R("function deleteSel() { if (!sel) return;",
  "function deleteSel() { if (!sel) return; if (sel.ref) { pushUndo(); sel.visible = false; sel.mesh.visible = false; refreshAll(); req(); toast(sel.name + ' hidden here (it stays in your design; delete it in Beginner or Advanced)'); return; }")
# the object list marks design objects
R('<span class="nm">${esc(o.name)}</span><span class="tc">',
  '<span class="nm">${esc(o.name)}</span>${o.ref ? (refTouched(o) ? \'<span class="dtag cv" title="Becomes a sculpt in your design when saved">sculpt</span>\' : \'<span class="dtag" title="A body of your design: sculpt, cut or move it to turn it into a sculpt">design</span>\') : \'\'}<span class="tc">')
# first sculpt stroke on a design object: even out its mesh first (the stroke then goes on)
R("  if (hit && SCULPT.has(t)) { const prev = sel;",
  "  if (hit && SCULPT.has(t) && refRaw(hit.obj)) { prepThenStroke(hit, e, p); return; }\n  if (hit && SCULPT.has(t)) { const prev = sel;")
R("  pushUndo(); o.dirty = true;\n  let inv = !!b.inv !== !!S.invert; if (e.altKey) inv = !inv;",
  "  if (!e.noUndo) pushUndo(); o.dirty = true;\n  let inv = !!b.inv !== !!S.invert; if (e.altKey || e.button === 5) inv = !inv; // a pen's eraser end carves")
R("  if (a.type === 'stroke') endStroke();", "  if (a.type === 'stroke') endStroke();\n  if (a.type === 'prep') a.up = true;")

# ---- pen pressure (Wacom, Apple Pencil, Surface Pen, pressure screens): size and strength
R("lazy: 0, autoSmooth: 0, frontOnly: true,", "lazy: 0, autoSmooth: 0, frontOnly: true, penSize: true, penStrength: true,")
R("  stroke = { o, b, ctx, mats, strokeType, last: hit.local.clone(),",
  "  ctx.sBase = ctx.s;\n  stroke = { o, b, ctx, mats, strokeType, pen: e.pointerType === 'pen', pr: e.pressure, last: hit.local.clone(),")
R("function dab(c, U, step) {\n  const st = stroke, ctx = st.ctx;",
  "function dab(c, U, step) {\n  const st = stroke, ctx = st.ctx;\n  if (st.pen) { const k = penK(st.prNow ?? st.pr); ctx.s = ctx.sBase * k.s; ctx.rL = ctx.rL0 * k.r; }")
R("  for (let k = 1; k <= n; k++) dab(st.last.clone().lerp(hit.local, k / n), U, dist / n);",
  "  const p0 = st.prLast ?? st.pr, p1 = st.pr;\n  for (let k = 1; k <= n; k++) { st.prNow = p0 + (p1 - p0) * k / n; dab(st.last.clone().lerp(hit.local, k / n), U, dist / n); }\n  st.prLast = p1; st.prNow = null;")
R("  if (action.type === 'stroke' && stroke) { moveStroke(p.x, p.y);",
  "  if (action.type === 'prep') { action.pressure = e.pressure; return; }\n  if (action.type === 'stroke' && stroke && stroke.pen) { penSeen(); stroke.pr = e.pressure; }\n  if (action.type === 'stroke' && stroke) { moveStroke(p.x, p.y);")
R("      h += check('bFront', 'frontOnly', 'Front faces only (no poke-through)') + '</div>';",
  "      h += check('bFront', 'frontOnly', 'Front faces only (no poke-through)') + '</div>';\n      if (!['grab', 'twist', 'snake'].includes(b.op) && S.bs[b.id].stroke !== 'drag') h += `<div class=\"sub\"><div class=\"sub-h\">Pen pressure${S.penOn ? ' <span class=\"dtag cv\">pen found</span>' : ''}</div>${check('bPenSize', 'penSize', 'Pressing harder makes it bigger')}${check('bPenStr', 'penStrength', 'Pressing harder makes it stronger')}<p class=\"hint\">For a stylus: Wacom, Apple Pencil, Surface Pen, pressure screens. A mouse or finger stays as set above.</p></div>`;")

R("    busy('Subdividing', () => {\n      pushUndo();", "    busy('Subdividing', () => {\n      pushUndo(); refPrep(o);")
R("    pushUndo(); o.dirty = true; const { off, adj } = ensureAdj(o)", "    pushUndo(); refPrep(o); o.dirty = true; const { off, adj } = ensureAdj(o)")
# helpers for both
R("let stroke = null;\nfunction startStroke(", r"""let stroke = null;
// pen pressure (0..1) to brush size and strength factors; a light touch still leaves a mark
function penK(p) {
  p = Math.max(0.02, Math.min(1, p || 0));
  return { r: S.penSize ? 0.25 + 0.75 * p : 1, s: S.penStrength ? 0.1 + 0.9 * Math.pow(p, 1.2) : 1 };
}
function penSeen() { if (!S.penOn) { S.penOn = true; renderToolSec(); } }
// a design object still exactly as it came from the design (geometry), and touched at all
const refRaw = o => !!o.ref && o.snap === o.refSnap && !o.dirty;
function refTouched(o) {
  if (!o.ref) return false;
  if (!refRaw(o)) return true;
  o.mesh.updateMatrixWorld(true);
  const a = o.mesh.matrixWorld.elements;
  return a.some((v, i) => Math.abs(v - o.refM[i]) > 1e-6 * (1 + Math.abs(v)));
}
// a design object drawn as the design draws it
function refShow(o) {
  const d = o.refDisp; if (!d) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  g.setIndex(new THREE.BufferAttribute(d.idx, 1));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(d.pos.length).fill(1), 3));
  g.computeVertexNormals();
  const old = o.mesh.geometry; o.mesh.geometry = g; o.wire.geometry = g; if (old) old.dispose(); req();
}
// a design object's mesh evened out for sculpting (part of the step that touches it)
function refPrep(o) {
  if (!refRaw(o)) return;
  const b = Core.bboxOf(o.pos), ext = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * objScale(o);
  const m = Core.remesh(Core.toTris(o.pos, o.idx), Math.max(60, Math.min(160, Math.round(S.remeshRes * Math.max(0.6, Math.min(1.4, ext / 1.8))))));
  if (m.idx.length) setGeometry(o, m.pos, m.idx);
  else setGeometry(o, o.pos.slice(), o.idx);
  o.snap = { pos: o.pos.slice(), idx: o.idx, mask: o.mask.slice(), paint: o.paint.slice() }; o.dirty = false;
}
// even out a design object's mesh for sculpting, then run the stroke the pen / mouse started
function prepThenStroke(hit, e, p) {
  const o = hit.obj; select(o);
  const ev = { ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, button: e.button, pointerType: e.pointerType, pressure: e.pressure, noUndo: true };
  const act = action = { type: 'prep', pressure: e.pressure };
  $('#busyText').textContent = 'Preparing ' + o.name + ' for sculpting'; $('#busy').hidden = false;
  setTimeout(() => {
    try {
      pushUndo();
      refPrep(o);
      toast(o.name + ' is ready to sculpt: it becomes a sculpt in your design when saved');
    } catch (err) { console.error(err); toast('Could not prepare ' + o.name, true); }
    $('#busy').hidden = true; refreshAll(); req();
    // still pressing: the stroke starts where the pointer is now
    if (action === act && !act.up && lastPtr) {
      const h = pick(lastPtr.x, lastPtr.y);
      if (h && h.obj === o) { ev.pressure = act.pressure; action = { type: 'stroke' }; startStroke(h, ev, lastPtr.x, lastPtr.y); return; }
    }
    if (action === act) action = null;
  }, 30);
}
function startStroke(""")
R("</style>", ".dtag{flex:none;font:600 9.5px var(--mono);text-transform:uppercase;letter-spacing:.04em;padding:1px 5px;border-radius:4px;border:1px solid var(--line-2);color:var(--muted);margin:0 6px 0 4px}\n.dtag.cv{border-color:var(--accent);color:var(--accent)}\n</style>")

# ---- the same light / dark / high-contrast themes as Beginner and Advanced (JumpStart 3D's
# colors), following the theme picked there
R(".btn[aria-pressed=\"true\"]{background:var(--accent-soft);border-color:rgba(214,164,78,.45);color:var(--accent)}", ".btn[aria-pressed=\"true\"]{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}")
R(".obj.sel{background:var(--accent-soft);border-color:rgba(214,164,78,.4)}", ".obj.sel{background:var(--accent-soft);border-color:var(--accent-line)}")
R("background:rgba(15,17,20,.62);border:1px solid var(--line);color:var(--muted);backdrop-filter:blur(6px)}", "background:var(--pill-bg);border:1px solid var(--line);color:var(--muted);backdrop-filter:blur(6px)}")
R("#busy{position:absolute;inset:0;display:grid;place-items:center;background:rgba(10,11,13,.35);z-index:5}", "#busy{position:absolute;inset:0;display:grid;place-items:center;background:var(--scrim);z-index:5}")
R(".tool.cut[aria-pressed=\"true\"]{background:var(--cut);color:#1c0b07}", ".tool.cut[aria-pressed=\"true\"]{background:var(--cut);color:var(--on-cut)}")
R(".action.danger{background:var(--cut);color:#1c0b07;border-color:var(--cut)}", ".action.danger{background:var(--cut);color:var(--on-cut);border-color:var(--cut)}")
R("#toast.err{border-color:var(--cut);color:#ffd6cd}", "#toast.err{border-color:var(--cut);color:var(--cut)}")
R("</style>", """/* JumpStart 3D themes (data-ui set from the main app) */
:root{--accent-line:rgba(214,164,78,.45);--pill-bg:rgba(15,17,20,.62);--scrim:rgba(10,11,13,.35);--on-cut:#1c0b07;--focus:var(--accent)}
:root[data-ui="light"]{
  --bg:#eef1f4;--view-a:#f4f6f8;--view-b:#dde2e7;--panel:#ffffff;--panel-2:#f2f4f7;--line:#d8dde3;--line-2:#c7ced6;
  --text:#18202a;--muted:#485361;--faint:#7c8794;--accent:#1f4fa8;--accent-ink:#ffffff;--accent-soft:#e4ecfa;--accent-line:#9db8e6;
  --cut:#b8352a;--cut-soft:rgba(184,53,42,.12);--ok:#2f8a4c;--on-cut:#ffffff;--pill-bg:rgba(255,255,255,.85);--scrim:rgba(18,24,32,.25);--focus:#2d63c8;color-scheme:light}
:root[data-ui="dark"]{
  --bg:#12161b;--view-a:#252d36;--view-b:#12161b;--panel:#1a2027;--panel-2:#212830;--line:#333c47;--line-2:#3e4854;
  --text:#e6ebf1;--muted:#b4bec9;--faint:#8a96a3;--accent:#6d9cf2;--accent-ink:#0c1014;--accent-soft:#1f2d46;--accent-line:#3f5a85;
  --cut:#ff8a7a;--cut-soft:rgba(255,138,122,.14);--ok:#5fc27f;--on-cut:#0c1014;--pill-bg:rgba(18,22,27,.75);--scrim:rgba(0,0,0,.45);--focus:#86aef6;color-scheme:dark}
:root[data-ui="contrast"]{
  --bg:#000;--view-a:#000;--view-b:#000;--panel:#000;--panel-2:#0d0d0d;--line:#fff;--line-2:#8c8c8c;
  --text:#fff;--muted:#fff;--faint:#e6e6e6;--accent:#ffd400;--accent-ink:#000;--accent-soft:#3a3000;--accent-line:#ffd400;
  --cut:#ff6e6e;--cut-soft:rgba(255,110,110,.18);--ok:#4dff88;--on-cut:#000;--pill-bg:#000;--scrim:rgba(0,0,0,.7);--focus:#00e5ff;color-scheme:dark}
:root[data-ui] :focus-visible{outline-color:var(--focus)!important}
:root[data-ui="contrast"] :focus-visible{outline:3px solid var(--focus)!important;outline-offset:2px}
:root[data-ui="contrast"] #top{border-bottom:2px solid #fff}
:root[data-ui="contrast"] #tools{border-right:2px solid #fff}
:root[data-ui="contrast"] #panel{border-left:2px solid #fff}
:root[data-ui="contrast"] #status{border-top:2px solid #fff}
:root[data-ui="contrast"] .btn,:root[data-ui="contrast"] .chip,:root[data-ui="contrast"] .seg,:root[data-ui="contrast"] input,:root[data-ui="contrast"] select{border-width:2px}
:root[data-ui="contrast"] .tool:not([aria-pressed="true"]){color:#fff}
</style>""")
# colors drawn by script (grid, brush ring, overlays, falloff curve) follow the theme
R("const ringMat = new THREE.LineBasicMaterial({ color: 0xd6a44e,", "const TH = { accent: '#d6a44e', accentA: 'rgba(214,164,78,.8)', accentF: 'rgba(214,164,78,.15)', cut: '#e3664f', cutF: 'rgba(227,102,79,.16)' };\nconst ringMat = new THREE.LineBasicMaterial({ color: 0xd6a44e,")
R("    octx.strokeStyle = 'rgba(214,164,78,.8)'; octx.lineWidth = 1.2; octx.setLineDash([3, 3]);\n    octx.beginPath(); octx.moveTo(L.x", "    octx.strokeStyle = TH.accentA; octx.lineWidth = 1.2; octx.setLineDash([3, 3]);\n    octx.beginPath(); octx.moveTo(L.x")
R("octx.fillStyle = '#d6a44e'; octx.fill();", "octx.fillStyle = TH.accent; octx.fill();")
R("    octx.strokeStyle = 'rgba(214,164,78,.8)'; octx.lineWidth = 1.2; octx.setLineDash([3, 3]);\n    octx.beginPath(); octx.moveTo(stroke.x0", "    octx.strokeStyle = TH.accentA; octx.lineWidth = 1.2; octx.setLineDash([3, 3]);\n    octx.beginPath(); octx.moveTo(stroke.x0")
R("remove ? 'rgba(227,102,79,.16)'", "remove ? TH.cutF")
R("remove ? '#e3664f'", "remove ? TH.cut")
R("c.strokeStyle = '#d6a44e';", "c.strokeStyle = TH.accent;")
R("c.fillStyle = 'rgba(214,164,78,.15)';", "c.fillStyle = TH.accentF;")

# ---- Easy mode (for kids and first-time sculptors): a few big, labeled tools, size and strength
# only. Pro is the full Chisel, unchanged. JumpStart 3D switches between them (S.easy).
R("const brushById = id => BRUSHES.find(b => b.id === id);", r"""const brushById = id => BRUSHES.find(b => b.id === id);
const EASY = [
  { id: 'e-add', tool: 'standard', inv: false, name: 'Build up', icon: IC.draw, hint: 'Drag across your model to add clay and make it bigger.' },
  { id: 'e-dig', tool: 'standard', inv: true, name: 'Dig in', icon: '<path d="M3 7h14"/><path d="M5.5 7c1 5 8 5 9 0"/><path d="M10 13.5v3"/>', hint: 'Drag across your model to scoop clay away.' },
  { id: 'e-smooth', tool: 'smooth', name: 'Smooth', icon: IC.smooth, hint: 'Rub over bumps to make the surface smooth.' },
  { id: 'e-flat', tool: 'flatten', name: 'Flatten', icon: IC.flatten, hint: 'Press areas flat, like with a spatula.' },
  { id: 'e-pull', tool: 'move', name: 'Pull', icon: IC.grab, hint: 'Grab a spot and pull it out (or push it in), like soft clay.' },
  { id: 'e-paint', tool: 'paint', name: 'Paint', icon: IC.paint, hint: 'Pick a color, then paint on your model.' },
  { id: 'e-move', tool: 'xform', name: 'Move', icon: OTHER_TOOLS.find(t => t.id === 'xform').icon, hint: 'Drag a model to move it around.' },
  { id: 'e-sketch', tool: 'sketch', name: 'Sketch', icon: '<path d="M4 16l2.6-.7 8.6-8.6-1.9-1.9-8.6 8.6z"/><path d="M12.4 5.7l1.9 1.9"/><path d="M3 18.5h14" opacity=".5"/>', hint: 'Draw a rectangle, circle or polygon on a plane, then pull it up into 3D.' },
  { id: 'e-combine', tool: 'combine', name: 'Combine', icon: '<circle cx="7.5" cy="10" r="5"/><circle cx="12.5" cy="10" r="5"/>', hint: 'Join two models, or cut one out of the other.' },
];
const EASY_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#f06292', '#8d6e63', '#ffffff', '#263238'];
const easyCur = () => EASY.find(e => e.tool === S.tool && (e.inv === undefined || e.inv === !!S.invert)) || null;
function setLevel(level) {
  const easy = level === 'easy';
  S.easy = easy; document.body.classList.toggle('easy', easy);
  if (easy && !easyCur()) { const e = EASY.find(x => x.tool === S.tool) || EASY[0]; S.invert = !!e.inv; S.tool = e.tool; }
  setTool(S.tool); refreshAll(); resize(); req();
}
function pickEasy(id) { const e = EASY.find(x => x.id === id); if (!e) return; if (e.inv !== undefined) S.invert = e.inv; setTool(e.tool); }
function renderEasyTools() {
  const cur = easyCur();
  $('#tools').innerHTML = '<div class="rail-label">Tools</div>' + EASY.map(e => `<button class="tool etool${e.tool === 'xform' ? ' emove' : ''}" data-easy="${e.id}" aria-pressed="${cur === e}" title="${e.name}: ${e.hint}"><svg viewBox="0 0 20 20">${e.icon}</svg><span>${e.name}</span></button>`).join('');
  $$('#tools [data-easy]').forEach(b => b.addEventListener('click', () => pickEasy(b.dataset.easy)));
}
function renderEasyToolSec() {
  const e = easyCur() || EASY[0], sec = $('#toolSec');
  let h = `<h2><span class="dot"></span>${e.name}</h2><p class="hint ehint">${e.hint}</p>`;
  if (e.tool !== 'xform') {
    h += slider('bRadius', 'Size', 'radius', 10, 220, 1, 'px') + slider('bStrength', 'Strength', 'bs.' + e.tool + '.strength', 0.05, 1, 0.01, '%');
    if (e.tool === 'paint') h += `<div class="sub-h">Color</div><div class="ecolors">${EASY_COLORS.map(c => `<button class="ecol" data-c="${c}" style="background:${c}" aria-label="Color ${c}" aria-pressed="${S.paintColor.toLowerCase() === c}"></button>`).join('')}<label class="ecol more" title="Any color"><input type="color" id="paintColor" value="${S.paintColor}">+</label></div>`;
    h += `<button class="etoggle" id="eSym" aria-pressed="${S.symX}"><svg viewBox="0 0 20 20"><path d="M10 2v16" stroke-dasharray="2 2"/><path d="M7 6L3 10l4 4M13 6l4 4-4 4"/></svg><span><b>Mirror</b> ${S.symX ? 'on: both sides change together' : 'off'}</span></button>`;
  }
  if (e.tool === 'xform') h += CAD.snapRow();
  h += `<p class="hint etips"><b>Look around:</b> drag empty space to turn · scroll or pinch to zoom · right-drag to slide. <b>Oops?</b> Undo is at the top.</p>`;
  sec.innerHTML = h; bind(sec); CAD.wireSnap(sec);
  $$('.ecol[data-c]', sec).forEach(b => b.addEventListener('click', () => { S.paintColor = b.dataset.c; renderToolSec(); }));
  const pc = $('#paintColor', sec); if (pc) pc.addEventListener('input', () => { S.paintColor = pc.value; $$('.ecol[data-c]', sec).forEach(b => b.setAttribute('aria-pressed', 'false')); });
  const sy = $('#eSym', sec); if (sy) sy.addEventListener('click', () => toggle('symX'));
}
function renderEasyObjSec() {
  const sec = $('#objSec');
  if (!sel) { sec.innerHTML = '<h2>Model</h2><p class="empty">Click a model to choose it.</p>'; return; }
  const o = sel;
  sec.innerHTML = `<h2>${esc(o.name)}</h2><div class="sub-h">Clay look</div><div class="swatches" role="group" aria-label="Clay look">${MATCAPS.map((m, i) => `<button class="sw" data-mc="${i}" title="${m.name}" aria-label="${m.name}" aria-pressed="${i === o.matcap}" style="background-image:url(${m.url})"></button>`).join('')}</div>`;
  $$('.sw', sec).forEach(b => b.addEventListener('click', () => { pushUndo(); setMatcap(o, +b.dataset.mc); renderObjSec(); }));
}""")
R("function renderTools() {\n", "function renderTools() {\n  if (S.easy) { renderEasyTools(); return; }\n")
R("function renderToolSec() {\n", "function renderToolSec() {\n  if (S.easy) { renderEasyToolSec(); return; }\n")
R("function renderObjSec() {\n", "function renderObjSec() {\n  if (S.easy) { renderEasyObjSec(); return; }\n")
R("function renderHud() {\n", "function renderHud() {\n  if (S.easy) { const e = easyCur(); $('#hud').innerHTML = (e ? `<span class=\"pill on\"><b>${e.name}</b></span>` : '') + (S.symX ? '<span class=\"pill on\"><b>Mirror</b></span>' : ''); return; }\n")
R("function refreshStatus() {\n  const t = toolById(S.tool); $('#stTool').textContent = t.name; $('#stHint').textContent = t.hint;",
  "function refreshStatus() {\n  const t = toolById(S.tool), et = S.easy && easyCur(); $('#stTool').textContent = et ? et.name : t.name; $('#stHint').textContent = et ? et.hint : t.hint;")
# Easy: no pro shortcuts or Ctrl-masking (no way to see or clear a mask there)
R("  const t = TOOLS.find(t => t.key === k); if (t) setTool(t.id);", "  const t = TOOLS.find(t => t.key === k); if (t && !S.easy) setTool(t.id);")
R("  if (e.ctrlKey || e.metaKey) b = brushById('mask');", "  if ((e.ctrlKey || e.metaKey) && !S.easy) b = brushById('mask');")
R("</style>", """/* Easy mode */
@media (min-width:821px){body.easy #app{grid-template-columns:86px minmax(0,1fr) 300px}}
body.easy #symBtn,body.easy #wireBtn,body.easy #flatBtn,body.easy #gridBtn,body.easy #brushSec,body.easy #boolSec,body.easy #detailSeg,body.easy #detailNote{display:none!important}
body.easy #symBtn+.btn{margin-left:0}
body.easy #tools{gap:6px;padding-top:10px}
body.easy .tool.etool{width:72px;height:62px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border-radius:10px;color:var(--text)}
body.easy .tool.etool svg{width:24px;height:24px}
body.easy .tool.etool span{font:600 12px/1 var(--sans)}
body.easy .tool.etool[aria-pressed="true"]{color:var(--accent-ink);background:var(--accent)}
body.easy .tool.emove{margin-top:8px}
body.easy #panel{font-size:14px}
body.easy #toolSec h2{font-size:15px}
body.easy .ehint{font-size:13.5px;color:var(--text)}
body.easy .row{grid-template-columns:70px minmax(0,1fr) 48px;margin:10px 0}
body.easy .row span{font-weight:600}
body.easy input[type=range]{height:24px}
.ecolors{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;margin:6px 0 10px}
.ecol{appearance:none;aspect-ratio:1;border-radius:50%;border:2px solid var(--line-2);cursor:pointer;padding:0;position:relative;display:grid;place-items:center;font:600 16px var(--sans);color:var(--muted);background:var(--panel-2)}
.ecol[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent)}
.ecol.more input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.etoggle{appearance:none;display:flex;align-items:center;gap:10px;width:100%;margin:8px 0;padding:10px 12px;border-radius:10px;border:1px solid var(--line-2);background:var(--panel-2);color:var(--text);cursor:pointer;text-align:left;font:13.5px var(--sans)}
.etoggle svg{width:22px;height:22px;flex:none;fill:none;stroke:currentColor;stroke-width:1.6}
.etoggle[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft)}
.etips{margin-top:12px;font-size:12.5px}
@media (max-width:820px){body.easy #app{grid-template-rows:46px minmax(0,1fr) 74px 26px}body.easy .tool.etool{width:64px;height:60px;flex:none}body.easy .tool.emove{margin-top:0;margin-left:6px}}
</style>""")

# ---- marquee (window) selection, like Beginner and Advanced: with Select & move, drag across
# empty space: to the right selects objects fully inside, to the left (dashed) anything it
# touches; Shift / Ctrl adds. Several objects can be selected, moved, duplicated and deleted.
R("  { id: 'xform', g: 'edit', name: 'Move object', key: 'm', hint: 'Drag an object to move it across the view. Rotation and scale are in the Object panel.',",
  "  { id: 'xform', g: 'edit', name: 'Select & move', key: 'm', hint: 'Click to select (Shift adds), drag to move. Drag across empty space to select: right = fully inside, left = touching. Right-drag orbits.',")
R("function select(o) { sel = o; ghostKey = ''; updateSlicePreview(); }",
  r"""let selSet = new Set();
function select(o) { sel = o; selSet = new Set(o ? [o] : []); ghostKey = ''; updateSlicePreview(); }
const selList = () => { const L = objects.filter(o => selSet.has(o)); if (sel && !L.includes(sel)) L.push(sel); return L; };
function selectMany(list, add) {
  const L = add ? [...new Set([...selList(), ...list])] : list;
  selSet = new Set(L); sel = L.includes(sel) ? sel : L[L.length - 1] || null; ghostKey = ''; updateSlicePreview();
}
function toggleSel(o) {
  if (selSet.has(o) && selSet.size > 1) { selSet.delete(o); if (sel === o) sel = [...selSet].pop(); }
  else if (!selSet.has(o)) { selSet.add(o); sel = o; }
  ghostKey = ''; updateSlicePreview();
}
// selected (and about-to-be-selected) objects get a tint while selecting and moving
function updateTints(pre) {
  const on = S.tool === 'xform' || S.tool === 'combine', tint = new THREE.Color('#ffffff').lerp(new THREE.Color(TH.accent), 0.4), pt = new THREE.Color('#ffffff').lerp(new THREE.Color(TH.accent), 0.22);
  for (const o of objects) {
    const c = !on ? null : S.tool === 'combine' ? (o === CAD.cb.a ? tint : o === CAD.cb.b ? new THREE.Color('#ffffff').lerp(new THREE.Color(TH.cut), 0.45) : null) : selSet.has(o) || o === sel ? tint : pre && pre.has(o) ? pt : null;
    o.mesh.material.color.copy(c || new THREE.Color(0xffffff));
  }
  req();
}
// an object's bounds on screen (from up to a few thousand of its points)
function screenRectOf(o) {
  o.mesh.updateMatrixWorld(true);
  const P = o.pos, n = P.length / 3, step = Math.max(1, Math.floor(n / 3000)), v = new V3(), r = glc.getBoundingClientRect();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i += step) {
    v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(o.mesh.matrixWorld).project(camera);
    if (v.z > 1) continue;
    const x = (v.x + 1) / 2 * r.width, y = (1 - v.y) / 2 * r.height;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return isFinite(x0) ? [x0, y0, x1, y1] : null;
}
function rubberHits(a) {
  const [rx, ry, rw, rh] = a.rect, hits = [];
  if (!a.rects) { a.rects = new Map(); for (const o of objects) if (o.visible) { const r = screenRectOf(o); if (r) a.rects.set(o, r); } }
  for (const [o, [x0, y0, x1, y1]] of a.rects) {
    const touches = x1 >= rx && x0 <= rx + rw && y1 >= ry && y0 <= ry + rh;
    const inside = x0 >= rx && x1 <= rx + rw && y0 >= ry && y1 <= ry + rh;
    if (a.crossing ? touches : inside) hits.push(o);
  }
  return hits;
}""")
R("""  if (hit && t === 'xform') {
    select(hit.obj); pushUndo();
    const nrm = new V3(); camera.getWorldDirection(nrm);
    action = { type: 'move', o: hit.obj, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, hit.point), W0: hit.point.clone(), P0: hit.obj.mesh.position.clone() };
    refreshAll(); return;
  }""", """  if (hit && t === 'xform') {
    if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSel(hit.obj); action = { type: 'click' }; refreshAll(); return; }
    if (!selSet.has(hit.obj)) select(hit.obj); else sel = hit.obj;
    pushUndo();
    const nrm = new V3(); camera.getWorldDirection(nrm); const list = selList();
    action = { type: 'move', list, P0s: list.map(o => o.mesh.position.clone()), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, hit.point), W0: hit.point.clone() };
    refreshAll(); return;
  }
  // drag across empty space: a selection window (a finger still orbits)
  if (!hit && t === 'xform' && e.pointerType !== 'touch') { action = { type: 'rubber', x0: p.x, y0: p.y, add: e.shiftKey || e.ctrlKey || e.metaKey, rect: null }; return; }""")
R("""    const W1 = new V3(); if (worldRay(p.x, p.y).intersectPlane(action.plane, W1)) { action.o.mesh.position.copy(action.P0).add(W1.sub(action.W0)); req(); refreshObjPanelValues(); }""",
  """    const W1 = new V3(); if (worldRay(p.x, p.y).intersectPlane(action.plane, W1)) { const d = W1.sub(action.W0); action.list.forEach((o, i) => o.mesh.position.copy(action.P0s[i]).add(d)); req(); refreshObjPanelValues(); }""")
R("""  if (action.type === 'draw2d') { if (action.shape === 'lasso')""", """  if (action.type === 'rubber') {
    const a = action, x = p.x, y = p.y;
    a.rect = [Math.min(x, a.x0), Math.min(y, a.y0), Math.abs(x - a.x0), Math.abs(y - a.y0)];
    const rb = $('#rubber');
    if (a.rect[2] + a.rect[3] < 4) { rb.hidden = true; return; }
    a.crossing = x < a.x0;
    rb.hidden = false; rb.classList.toggle('crossing', a.crossing);
    Object.assign(rb.style, { left: a.rect[0] + 'px', top: a.rect[1] + 'px', width: a.rect[2] + 'px', height: a.rect[3] + 'px' });
    updateTints(new Set(rubberHits(a)));
    return;
  }
  if (action.type === 'draw2d') { if (action.shape === 'lasso')""")
R("""  if (a.type === 'move') updateSlicePreview();""", """  if (a.type === 'move') updateSlicePreview();
  if (a.type === 'rubber') {
    $('#rubber').hidden = true;
    if (!a.rect || a.rect[2] + a.rect[3] < 4) { if (!a.add) select(null); }
    else selectMany(rubberHits(a), a.add);
    refreshAll();
    const n = selList().length; if (n > 1) toast(n + ' objects selected');
  }""")
R("""    <div id="hud"></div>""", """    <div id="hud"></div>
    <div id="rubber" hidden></div>""")
R("""  select(objects.find(x => x.id === +row.dataset.id)); refreshAll();""", """  const ro = objects.find(x => x.id === +row.dataset.id);
  if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSel(ro); else select(ro);
  refreshAll();""")
R("""<div class="obj${o === sel ? ' sel' : ''}""", """<div class="obj${o === sel || selSet.has(o) ? ' sel' : ''}""")
R("""function refreshAll() { refreshObjects();""", """function refreshAll() { updateTints(); refreshObjects();""")
R("""  renderTools(); renderToolSec(); renderBrushSec(); updateSlicePreview(); renderHud(); refreshStatus(); queueHover();""",
  """  renderTools(); renderToolSec(); renderBrushSec(); updateSlicePreview(); renderHud(); refreshStatus(); queueHover(); updateTints();""")
# Esc drops the selection while selecting
R("""  if (k === 'f') { frameAll(); return; }""", """  if (k === 'f') { frameAll(); return; }
  if (k === 'escape' && S.tool === 'xform') { select(null); refreshAll(); return; }""")
R("</style>", """#rubber{position:absolute;border:1.5px solid var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent);pointer-events:none;z-index:3}
#rubber.crossing{border-style:dashed;border-color:var(--ok);background:color-mix(in srgb,var(--ok) 8%,transparent)}
#rubber[hidden]{display:none}
</style>""")
# Delete / Duplicate act on every selected object
i = s.index("function deleteSel() {")
j = s.index("\n", i)
s = s[:i] + r"""function deleteSel() {
  const L = selList(); if (!L.length) return;
  pushUndo(); let gone = 0, hid = 0;
  for (const o of L) { if (o.ref) { o.visible = false; o.mesh.visible = false; hid++; } else { removeObj(o); gone++; } }
  select(objects.includes(sel) ? sel : null); refreshAll(); req();
  toast((gone ? (gone === 1 ? L.find(o => !o.ref).name + ' deleted' : gone + ' objects deleted') : '') + (gone && hid ? ' · ' : '') + (hid ? (hid === 1 ? 'hidden here (stays in your design)' : hid + ' design bodies hidden here (they stay in your design)') : ''));
}""" + s[j:]
R("""  if (!sel) return; pushUndo(); const o = sel;
  const n = createObj(uniqueName(o.name.replace(/ \\d+$/, '')), o.pos.slice(), o.idx, o.matcap, undefined, o.mask.slice(), o.paint.slice());
  n.mesh.position.copy(o.mesh.position).add(new V3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(0.4)); n.mesh.rotation.copy(o.mesh.rotation); n.mesh.scale.copy(o.mesh.scale);
  select(n); refreshAll(); toast('Duplicated');""", """  const L = selList(); if (!L.length) return; pushUndo(); const made = [];
  for (const o of L) {
    const n = createObj(uniqueName(o.name.replace(/ \\d+$/, '')), o.pos.slice(), o.idx, o.matcap, undefined, o.mask.slice(), o.paint.slice());
    n.mesh.position.copy(o.mesh.position).add(new V3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(0.4)); n.mesh.rotation.copy(o.mesh.rotation); n.mesh.scale.copy(o.mesh.scale);
    made.push(n);
  }
  selectMany(made); refreshAll(); toast(made.length > 1 ? made.length + ' objects duplicated' : 'Duplicated');""")
R("""  { id: 'e-move', tool: 'xform', name: 'Move', icon: OTHER_TOOLS.find(t => t.id === 'xform').icon, hint: 'Drag a model to move it around.' },""",
  """  { id: 'e-move', tool: 'xform', name: 'Move', icon: OTHER_TOOLS.find(t => t.id === 'xform').icon, hint: 'Drag a model to move it. The black arrow on top lifts it up or down (or Ctrl + arrow keys). Drag a box on empty space to pick several.' },""")

# ---- JumpStart 3D tools in Chisel (tools/chisel_cad.js): Beginner's Move, Advanced's sketch +
# extrude, Easy mode's Combine
R("  { id: 'hole', g: 'cut',", """  { id: 'sketch', g: 'edit', name: 'Sketch', hint: 'Pick a plane or a flat face, draw rectangles, circles and polygons, then extrude them (E), like Advanced.', icon: '<path d="M4 16l2.6-.7 8.6-8.6-1.9-1.9-8.6 8.6z"/><path d="M12.4 5.7l1.9 1.9"/><path d="M3 18.5h14" opacity=".5"/>' },
  { id: 'combine', g: 'easy', name: 'Combine', hint: 'Click two models, then join them, cut one out of the other, or keep the overlap.', icon: '<circle cx="7.5" cy="10" r="5"/><circle cx="12.5" cy="10" r="5"/>' },
  { id: 'hole', g: 'cut',""")
R("function setTool(id) {\n  S.tool = id; hideHover();", "function setTool(id) {\n  const prevT = S.tool; S.tool = id; hideHover(); CAD.onTool(prevT, id);")
R("function renderToolSec() {\n  if (S.easy)", "function renderToolSec() {\n  if (S.tool === 'sketch' || S.tool === 'combine') { CAD.renderSec(); return; }\n  if (S.easy)")
R("""  { id: 'e-move', tool: 'xform',""", """  { id: 'e-move', tool: 'xform',""")
# pointer routing
R("""    if (stroke) endStroke();
    const [a, b] = [...pointers.values()];""", """    if (stroke) endStroke();
    if (action && action.type === 'cad') CAD.up();
    const [a, b] = [...pointers.values()];""")
R("""  if (e.button === 2 || e.button === 1) { action = { type: (e.button === 1 || e.shiftKey || e.ctrlKey) ? 'pan' : 'orbit', x: p.x, y: p.y }; return; }""",
  """  if (e.button === 2 || e.button === 1) { action = { type: (e.button === 1 || e.shiftKey || e.ctrlKey) ? 'pan' : 'orbit', x: p.x, y: p.y }; return; }
  if (CAD.down(p, e)) { action = { type: 'cad' }; return; }""")
R("""  if (!action) { queueHover(); return; }""", """  if (action && action.type === 'cad') { CAD.move(p, e); return; }
  if (!action) { if (CAD.hover(p, e)) return; queueHover(); return; }""")
R("""  if (a.type === 'stroke') endStroke();""", """  if (a.type === 'stroke') endStroke();
  if (a.type === 'cad') CAD.up(e);""")
R("""  if (e.target.closest && e.target.closest('input,select,textarea')) return;\n""", """  if (e.target.closest && e.target.closest('input,select,textarea')) return;\n  if (CAD.key(e)) return;\n""")
R("""  if (needsRender) { needsRender = false; renderer.render(scene, camera); }""", """  if (needsRender) { needsRender = false; CAD.frame(); renderer.render(scene, camera); }""")
# new shapes sit on the workplane (like Beginner)
R("""    o.mesh.position.copy(cam.target);\n""", """    o.mesh.position.copy(cam.target); { const b = worldBox(o); o.mesh.position.y += -1 - b.min.y; }\n""")
# undo steps that live in the design (an extrude made in Chisel): undo / redo them there
R("""function undo() { if (!undoStack.length) return; redoStack.push""", """function hostStep(dir, m) {
  const from = dir === 'undo' ? undoStack : redoStack, to = dir === 'undo' ? redoStack : undoStack;
  from.pop(); updateUndoBtns();
  Promise.resolve(host && host.designStep ? host.designStep(dir, m.host) : false).then((ok) => {
    if (ok) { to.push(m); toast(dir === 'undo' ? 'Undone' : 'Redone'); }
    else toast('That step was saved into your design: ' + dir + ' it in Beginner or Advanced', true);
    updateUndoBtns();
  });
}
function undo() { if (!undoStack.length) return; if (undoStack[undoStack.length - 1].host) { hostStep('undo', undoStack[undoStack.length - 1]); return; } redoStack.push""")
R("""function redo() { if (!redoStack.length) return; undoStack.push""", """function redo() { if (!redoStack.length) return; if (redoStack[redoStack.length - 1].host) { hostStep('redo', redoStack[redoStack.length - 1]); return; } undoStack.push""")
R("</style>", """#cadLayer{position:absolute;inset:0;pointer-events:none;z-index:4;overflow:hidden}
.clab{position:absolute;left:0;top:0;font:500 11.5px var(--mono);padding:3px 6px;border-radius:5px;background:var(--panel);border:1px solid var(--line-2);color:var(--text);white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.clab[hidden]{display:none}
.clab.pltag{color:#fff;border:0;font:600 11.5px var(--sans);padding:3px 9px;border-radius:99px}
.clab.ang,.clab.ext{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
.cdim{position:absolute;left:0;top:0;width:76px;pointer-events:auto;font:600 12.5px var(--mono);padding:4px 6px;border-radius:6px;border:2px solid var(--accent);background:var(--panel);color:var(--text);text-align:center}
.cinp{position:absolute;left:0;top:0;pointer-events:auto;display:flex;gap:6px;padding:5px 6px;border-radius:8px;background:var(--panel);border:1px solid var(--line-2);box-shadow:0 4px 14px rgba(0,0,0,.2)}
.cinp label{display:flex;flex-direction:column;gap:2px;font:600 9.5px var(--sans);text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.cinp input{width:64px;font:600 12.5px var(--mono);padding:3px 5px;border-radius:5px;border:1px solid var(--line-2);background:var(--panel-2);color:var(--text)}
.cinp input:focus{border-color:var(--accent);outline:none}
.cad-tools{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0}
.cadt{appearance:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding:9px 4px;border-radius:9px;border:1px solid var(--line-2);background:var(--panel-2);color:var(--text);cursor:pointer;font:600 12px var(--sans)}
.cadt svg{width:24px;height:24px}
.cadt[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.cad-pl{display:grid;gap:6px;margin:8px 0}
.cad-pl .action{display:flex;align-items:center;gap:8px;justify-content:flex-start}
.cad-pl i{width:12px;height:12px;border-radius:3px;flex:none}
.cad-foot{margin-top:10px}
.action.primary-act{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);display:inline-flex;align-items:center;justify-content:center;gap:6px}
.action.primary-act svg{width:16px;height:16px}
.action[disabled]{opacity:.45;cursor:default}
.cad-snap .cad-snap-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0}
.cad-snap label{display:inline-flex;align-items:center;gap:5px;cursor:pointer}
.cad-snap input[type=checkbox]{accent-color:var(--accent);width:15px;height:15px}
.cad-snap select{width:auto;flex:none;min-width:84px;padding:3px 6px;border-radius:6px;border:1px solid var(--line-2);background:var(--panel-2);color:var(--text)}
.cad-dist input{font:600 13px var(--mono);padding:4px 6px;border-radius:6px;border:1px solid var(--line-2);background:var(--panel-2);color:var(--text);width:100%}
.cad-op{margin-top:4px}
.cb-slot{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:9px;border:1.5px dashed var(--line-2);margin:6px 0;color:var(--muted)}
.cb-slot b{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--panel-2);color:var(--text);flex:none}
.cb-slot span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-slot.on{border-style:solid;border-color:var(--accent);color:var(--text);background:var(--accent-soft)}
.cb-slot.on b{background:var(--accent);color:var(--accent-ink)}
.cb-slot .mini,.cb-swap{border:1px solid var(--line-2);background:var(--panel);border-radius:6px;padding:2px 7px;cursor:pointer;color:var(--text)}
.cb-swap{display:inline-flex;align-items:center;gap:4px;margin:0 0 0 30px;font-size:12px}
.cb-swap svg{width:14px;height:14px}
.cb-acts{display:grid;gap:6px;margin-top:10px}
.cb-acts .etoggle{margin:0}
.etoggle[disabled]{opacity:.45;cursor:default}
</style>""")

R("""    h += `<p class="hint">Drag empty space to orbit. Right-drag also orbits, <kbd>Shift</kbd>+drag pans, scroll zooms.</p>`;""",
  """    h += t.id === 'xform' ? `<p class="hint">Like Beginner: drag a handle to resize, rotate, or lift with the black arrow; press <kbd>Tab</kbd> to type sizes. Arrow keys slide it, <kbd>Ctrl</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> raise or lower it; after a rotation arc, arrow keys turn 1°. Right-drag orbits, middle-drag pans, scroll zooms.</p>` + CAD.snapRow() : `<p class="hint">Drag empty space to orbit. Right-drag also orbits, <kbd>Shift</kbd>+drag pans, scroll zooms.</p>`;""")
R("""    h += `<button class="action danger" id="sliceGo" ${sel ? '' : 'disabled'}>${S.slice.split ? 'Split' : 'Slice'} ${sel ? esc(sel.name) : ''}</button>`;
  }
  sec.innerHTML = h;""", """    h += `<button class="action danger" id="sliceGo" ${sel ? '' : 'disabled'}>${S.slice.split ? 'Split' : 'Slice'} ${sel ? esc(sel.name) : ''}</button>`;
  }
  sec.innerHTML = h; if (t.id === 'xform') CAD.wireSnap(sec);""")
# save into the design without leaving Chisel
R('    <div class="spacer"></div>\n    <button class="btn" id="frameBtn"', '    <div class="spacer"></div>\n    <button class="btn" id="js3dSave" hidden title="Save your sculpts into the design now (also happens when you switch to Beginner or Advanced)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h8l2 2v10H3z"/><path d="M5 2v4h6V2M5 14v-4h6v4"/></svg><span class="hide-sm">Save to design</span></button>\n    <button class="btn" id="frameBtn"')
# a "From your design" section in the panel
R('''    <section class="sec" id="objSec"></section>''', '''    <section class="sec" id="js3dSec" hidden></section>
    <section class="sec" id="objSec"></section>''')

# exports are in millimetres, Z up (what slicers and CAD expect), as STL or OBJ
R("function buildSTL(list) {\n  const tris = list.map(worldTris),", "function buildSTL(list) {\n  const tris = list.map((o) => Core.transformTris(worldTris(o), C2J.elements)),")
R("    o.mesh.updateMatrixWorld(true); const m = o.mesh.matrixWorld.elements, P = o.pos, C = hasPaint(o) ? o.paint : null;",
  "    o.mesh.updateMatrixWorld(true); const m = C2J.clone().multiply(o.mesh.matrixWorld).elements, P = o.pos, C = hasPaint(o) ? o.paint : null;")
R("const head = 'Chisel Sculpt export';", "const head = 'JumpStart 3D Chisel export (mm)';")
R("const out = ['# Chisel Sculpt export']; let base = 1;", "const out = ['# JumpStart 3D Chisel export (mm, Z up)']; let base = 1;")
R('<button class="btn" id="exportBtn" title="Export visible objects as STL + OBJ (zip)">', '<button class="btn" id="exportBtn" title="Export the visible objects as STL or OBJ (millimetres)">')
old_export = s[s.index("$('#exportBtn').addEventListener('click', async () => {"):s.index("/* ================= loop ================= */")]
s = s.replace(old_export, '''$('#exportBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  let m = $('#expMenu');
  if (m) { m.remove(); return; }
  m = document.createElement('div'); m.id = 'expMenu'; m.className = 'expmenu';
  m.innerHTML = '<button data-f="stl">STL <em>for 3D printing</em></button><button data-f="obj">OBJ <em>keeps painted colors</em></button><label><input type="checkbox" id="expSel"> Selected objects only</label>';
  document.body.append(m);
  const r = $('#exportBtn').getBoundingClientRect(); m.style.left = r.left + 'px'; m.style.top = (r.bottom + 4) + 'px';
  m.addEventListener('click', async (ev) => {
    const f = ev.target.closest('button') && ev.target.closest('button').dataset.f;
    if (!f) return;
    const list = $('#expSel').checked && sel ? selList() : objects.filter(o => o.visible);
    m.remove();
    if (!list.length) { toast('Nothing visible to export', true); return; }
    const base = (list.length === 1 ? list[0].name : 'sculpt').replace(/[^\\w\\- ]+/g, '').trim().replace(/\\s+/g, '-') || 'sculpt';
    const bytes = f === 'stl' ? buildSTL(list) : buildOBJ(list);
    await saveBytes(base + '.' + f, bytes);
  });
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
});
async function saveBytes(name, bytes) {
  if (host && host.save) { try { await host.save(name, bytes); toast('Saved ' + name); } catch (err) { toast('Could not save the file', true); } return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

/* ================= JumpStart 3D bridge ================= */
// Chisel works in its own units with Y up; the design is in millimetres with Z up.
// One Chisel unit is 20 mm, and Chisel's floor (y = -1) is the workplane (z = 0).
const host = (() => { try { return parent !== window && parent.__JS3D_CHISEL__ ? parent.__JS3D_CHISEL__ : null; } catch (e) { return null; } })();
const MM = 20;
const C2J = new THREE.Matrix4().set(MM, 0, 0, 0, 0, 0, -MM, 0, 0, MM, 0, MM, 0, 0, 0, 1);
const J2C = C2J.clone().invert();
function setMatrix(o, el) {
  const m = new THREE.Matrix4().fromArray(el), p = new V3(), q = new THREE.Quaternion(), sc = new V3();
  m.decompose(p, q, sc);
  o.mesh.position.copy(p); o.mesh.quaternion.copy(q); o.mesh.scale.copy(sc); o.mesh.updateMatrixWorld(true);
}
// bodies of the design brought in to sculpt: a copy (the design keeps the body) or convert
function renderDesignSec() {
  const sec = $('#js3dSec');
  if (!host) { sec.hidden = true; return; }
  const list = host.bodies();
  sec.hidden = false;
  sec.innerHTML = `<h2><span class="dot"></span>From your design<em>${list.length || ''}</em></h2>` +
    (list.length ? `<p class="hint" style="margin:0 0 6px">Your design's bodies are already in the scene (marked <span class="dtag">design</span>). Sculpt, cut or move one and it becomes a sculpt in your design (undo in Beginner or Advanced brings the original back). To keep the original as it is, sculpt a <b>Copy</b> instead.</p>
    <div class="objs">${list.map(b => `<div class="obj jsb"><span class="nm">${esc(b.name)}</span><button class="mini" data-copy="${b.id}" title="Sculpt a copy placed beside it; the original stays in your design">Copy</button></div>`).join('')}</div>
    <label class="check" for="jsRemesh"><input type="checkbox" id="jsRemesh" ${S.jsRemesh !== false ? 'checked' : ''}>Even out the copy's triangles for sculpting (remesh)</label>`
      : '<p class="empty">Bodies you make in Beginner or Advanced show up in the scene here, ready to sculpt.</p>');
  const rm = $('#jsRemesh', sec); if (rm) rm.onchange = () => { S.jsRemesh = rm.checked; };
  sec.onclick = (e) => {
    const c = e.target.closest('[data-copy],[data-conv]'); if (!c) return;
    const id = c.dataset.copy || c.dataset.conv, convert = !!c.dataset.conv;
    const b = list.find(x => x.id === id); if (!b) return;
    if (convert && !confirm('Convert "' + b.name + '" into a sculpt? It is replaced in your design (undo in Beginner or Advanced brings it back).')) return;
    busy((convert ? 'Converting ' : 'Copying ') + b.name, () => {
      const T = host.bodyTris(id); if (!T || !T.length) { toast('That body is not ready yet', true); return; }
      const C = Core.transformTris(T, J2C.elements);
      const bb = Core.bboxOf(C), cx = (bb[0] + bb[3]) / 2, cy = (bb[1] + bb[4]) / 2, cz = (bb[2] + bb[5]) / 2;
      for (let i = 0; i < C.length; i += 3) { C[i] -= cx; C[i + 1] -= cy; C[i + 2] -= cz; }
      const ext = Math.max(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]);
      const m = S.jsRemesh !== false ? Core.remesh(C, Math.max(60, Math.min(160, Math.round(S.remeshRes * Math.max(0.6, Math.min(1.4, ext / 1.8)))))) : Core.cleanMesh(C);
      if (!m.idx.length) { toast('Could not turn that body into a mesh', true); return; }
      pushUndo();
      const o = createObj(uniqueName(convert ? b.name : b.name + ' copy'), m.pos, m.idx, objects.length % MATCAPS.length);
      // a copy goes beside the original (which stays in the design); a converted body stays put
      o.mesh.position.set(convert ? cx : cx + (bb[3] - bb[0]) + 0.3, cy, cz);
      if (convert) host.removeBody(id);
      select(o); refreshAll(); renderDesignSec(); frameAll(o);
      toast((convert ? 'Converted ' : 'Copied ') + b.name + (convert ? '' : ' (placed beside the original)') + ' · ' + fmt(triCount(o)) + ' triangles');
    });
  };
}
if (host) { const sv = $('#js3dSave'); sv.hidden = false; sv.onclick = async () => { const ch = await host.sync(); toast(ch ? 'Saved into the design' : 'Already saved'); }; }
@@CAD_MODULE@@
// JumpStart 3D's theme: page colors come from CSS; the 3D view's colors are set here
const GRID = { light: ['#8b9aaa', '#c3cbd4'], dark: ['#5a6774', '#2f3741'], contrast: ['#b3b3b3', '#4d4d4d'] };
function applyTheme(name) {
  if (!GRID[name]) name = 'dark';
  document.documentElement.dataset.ui = name;
  const cs = getComputedStyle(document.documentElement), v = (k) => cs.getPropertyValue(k).trim();
  const acc = new THREE.Color(v('--accent')), cut = new THREE.Color(v('--cut'));
  const rgba = (c, a) => { const h = c.getHexString(); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };
  Object.assign(TH, { accent: '#' + acc.getHexString(), accentA: rgba(acc, 0.85), accentF: rgba(acc, 0.15), cut: '#' + cut.getHexString(), cutF: rgba(cut, 0.16) });
  ringMat.color.copy(acc); ringMat2.color.copy(acc);
  for (const m of [ghost.material, ghostWire.material, slicePlane.material, sliceEdge.material]) m.color.copy(cut);
  const [c1, c2] = GRID[name].map((h) => new THREE.Color(h)), col = grid.geometry.attributes.color, lines = col.count / 4, mid = (lines - 1) / 2;
  for (let i = 0; i < lines; i++) { const c = i === mid ? c1 : c2; for (let k = 0; k < 4; k++) col.setXYZ(i * 4 + k, c.r, c.g, c.b); }
  col.needsUpdate = true; grid.material.opacity = name === 'contrast' ? 1 : 0.75;
  wireMat.color.set(name === 'contrast' ? 0x000000 : 0x0a0c0f); wireMat.opacity = name === 'contrast' ? 0.45 : 0.2;
  try { CAD.theme(host && host.themeColors ? host.themeColors() : null); } catch (e) { console.error(e); }
  try { renderToolSec(); drawOverlay(); } catch (e) {}
  req();
}
if (host && host.theme) applyTheme(host.theme());
window.__chisel = {
  setTheme: (name) => applyTheme(name),
  setPerf: (name) => PERF.set(name),
  setLevel: (level) => setLevel(level),
  snapChanged: () => CAD.snapChanged(),
  level: () => (S.easy ? 'easy' : 'pro'),
  // what Chisel has: per object its design body, versions and matrix
  state: () => objects.filter(o => !o.ref || o.jsId).map(o => ({ cid: o.id, jsId: o.jsId || null, rev: o.rev || 0, syncRev: o.syncRev ?? -1 })),
  // the design's sculpts: add / update / remove to match (geometry only when sent)
  load(list, opts = {}) {
    const keep = new Set(list.map(e => e.jsId));
    refQuiet = true;
    // another design was opened: nothing unsaved from the old one stays
    for (const o of [...objects]) if ((o.jsId || opts.fresh) && !keep.has(o.jsId)) removeObj(o);
    if (opts.fresh) refGone.clear();
    // the design's other bodies, as they are: gone ones leave, changed ones are redone
    const ids = new Set(opts.refIds || []);
    for (const o of [...objects]) if (o.ref && !o.jsId && !ids.has(o.ref) && !refTouched(o)) removeObj(o);
    for (const r of opts.refs || []) {
      const C = Core.transformTris(new Float32Array(r.pos), J2C.elements), I = new Uint32Array(r.idx);
      const bb = Core.bboxOf(C), cx = (bb[0] + bb[3]) / 2, cy = (bb[1] + bb[4]) / 2, cz = (bb[2] + bb[5]) / 2;
      for (let i = 0; i < C.length; i += 3) { C[i] -= cx; C[i + 1] -= cy; C[i + 2] -= cz; }
      // welded for every tool; drawn as the design draws it (crisp edges) until touched
      const m = Core.cleanMesh(Core.toTris(C, I));
      if (!m.idx.length) continue;
      let o = objects.find(x => x.ref === r.ref && !x.jsId);
      if (o && refTouched(o)) continue;
      if (o) setGeometry(o, m.pos, m.idx);
      else { o = createObj(uniqueName(r.name), m.pos, m.idx, 0); o.ref = r.ref; }
      o.mesh.position.set(cx, cy, cz); o.mesh.quaternion.identity(); o.mesh.scale.set(1, 1, 1); o.mesh.updateMatrixWorld(true);
      o.snap = o.refSnap = { pos: o.pos.slice(), idx: o.idx, mask: o.mask.slice(), paint: o.paint.slice() }; o.dirty = false;
      o.refM = Array.from(o.mesh.matrixWorld.elements); o.refKey = r.key; o.refDisp = { pos: C, idx: I }; refShow(o);
    }
    refQuiet = false;
    for (const e of list) {
      let o = objects.find(x => x.jsId === e.jsId);
      if (e.pos) {
        // typed arrays from the host page belong to its window: three.js here needs its own
        const pos = new Float32Array(e.pos), idx = new Uint32Array(e.idx), paint = e.paint ? new Float32Array(e.paint) : null;
        if (!o) { o = createObj(uniqueName(e.name || 'Sculpt'), pos, idx, e.matcap || 0, undefined, null, paint); o.jsId = e.jsId; }
        else setGeometry(o, pos, idx, null, paint);
      }
      if (!o) continue;
      if (e.name) o.name = e.name;
      setMatrix(o, e.matrix);
      o.rev = o.syncRev = e.rev;
      o.cm = e.matrix.slice();
    }
    if (!opts.keepUndo) { undoStack = []; redoStack = []; }
    updateUndoBtns();
    if (!objects.includes(sel)) sel = objects[0] || null;
    refreshAll(); req();
  },
  // everything to save into the design (mesh data only where it changed)
  collect() {
    return objects.filter(o => !o.ref || refTouched(o)).map(o => {
      o.mesh.updateMatrixWorld(true);
      const changed = !o.jsId || o.rev !== o.syncRev;
      return { cid: o.id, jsId: o.jsId || null, ref: o.jsId ? null : o.ref || null, name: o.name, rev: o.rev || 0, matcap: o.matcap, color: MATCAPS[o.matcap] ? MATCAPS[o.matcap].c : [0.7, 0.6, 0.5], visible: o.visible,
        matrix: Array.from(o.mesh.matrixWorld.elements), C2J: Array.from(C2J.elements),
        pos: changed ? o.pos : null, idx: changed ? o.idx : null, paint: changed && hasPaint(o) ? o.paint : null };
    });
  },
  // after saving: which design body each object now belongs to
  linked(list) { for (const e of list) { const o = objects.find(x => x.id === e.cid); if (o) { o.jsId = e.jsId; o.syncRev = e.rev; o.ref = o.refSnap = o.refM = null; } } refGone.clear(); refreshAll(); },
  // the design objects here (and what they were made from), and the ones that left
  refState: () => objects.filter(o => o.ref && !o.jsId).map(o => ({ ref: o.ref, key: o.refKey, touched: refTouched(o) })),
  refGone: () => [...refGone],
  shown() { resize(); renderDesignSec(); refreshAll(); req(); },
  undo: () => undo(), redo: () => redo(),
  _dbg: (src) => eval(src), // for automated tests
  dirty: () => refGone.size > 0 || objects.some(o => o.ref && !o.jsId ? refTouched(o) : (!o.jsId || o.rev !== o.syncRev)),
};

''')
# panel / menu styles
R('</style>', '''.expmenu{position:fixed;z-index:50;display:flex;flex-direction:column;gap:2px;padding:6px;background:var(--panel);border:1px solid var(--line-2);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.4);min-width:220px}
.expmenu button{display:flex;justify-content:space-between;gap:12px;border:0;background:transparent;padding:8px 10px;border-radius:6px;cursor:pointer;text-align:left;font-weight:600}
.expmenu button:hover{background:var(--panel-2)}
.expmenu em{font-style:normal;font-weight:400;color:var(--muted)}
.expmenu label{display:flex;gap:6px;align-items:center;padding:6px 10px 2px;color:var(--muted)}
.obj.jsb{gap:4px;display:flex;align-items:center}
.obj.jsb .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.obj.jsb .mini{flex:none;border:1px solid var(--line-2);background:var(--panel-2);border-radius:5px;padding:2px 6px;cursor:pointer;font-size:11.5px}
.obj.jsb .mini:hover{border-color:var(--accent);color:var(--accent)}
.obj.jsb .mini.warn:hover{border-color:var(--cut);color:var(--cut)}
</style>''', 1)

# ---- characters (people, heads, animals, aliens) and textures
R('''      <div class="shapes" id="shapes"></div>''', '''      <div class="shapes" id="shapes"></div>
      <div class="sub-h chars-h">Characters</div>
      <div class="shapes chars" id="charShapes"></div>''')
R('''    <section class="sec" id="boolSec"></section>''', '''    <section class="sec" id="boolSec"></section>
    <section class="sec" id="texSec"></section>''')
R('''      const pc = ctx.pc, PT = o.paint;
      for (let j = 0; j < m; j++) { const i = SI[j] * 3, f = Math.min(1, SW[j] * s * 0.9); for (let q = 0; q < 3; q++) PT[i + q] += (pc[q] - PT[i + q]) * f; }''', '''      const pc = ctx.pc, PT = o.paint, useTex = TEX.brush;
      for (let j = 0; j < m; j++) { const i = SI[j] * 3, f = Math.min(1, SW[j] * s * 0.9), c = useTex ? TEX.colorAt(o, SI[j]) : pc; for (let q = 0; q < 3; q++) PT[i + q] += (c[q] - PT[i + q]) * f; }''')
R('''function refreshAll() { updateTints();''', '''function refreshAll() { if (typeof TEX !== 'undefined' && TEX._sel !== sel) { TEX._sel = sel; TEX.renderSec(); } updateTints();''')
R('</style>', '''.chars-h{margin:10px 0 6px;font:600 10.5px/1 var(--cond);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.tex-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin:6px 0 8px}
.tex-sw{display:flex;flex-direction:column;align-items:center;gap:2px;padding:3px;border:1px solid var(--line-2);border-radius:7px;background:var(--panel-2);cursor:pointer;min-width:0}
.tex-sw img{width:100%;aspect-ratio:1;border-radius:4px;display:block}
.tex-sw span{font-size:10.5px;color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tex-sw[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.tex-add .plus{width:100%;aspect-ratio:1;display:grid;place-items:center;font-size:22px;color:var(--muted);border:1px dashed var(--line-2);border-radius:4px}
</style>''', 1)
# start empty: the design's sculpts are loaded by JumpStart 3D (no demo objects)
old_boot = s[s.index('(function initScene() {'):s.index('})();\n</script>\n</body></html>')]
s = s.replace(old_boot, '''(function initScene() {
  select(null);
  resize(); frameAll(); updateCam();
  renderChars(); TEX._sel = undefined;
  refreshAll(); renderHud(); loop();
  if (host && host.level) setLevel(host.level());
  if (host && host.ready) host.ready();
})();
''')
s = s.replace('@@CAD_MODULE@@', open(ROOT + '/tools/chisel_cad.js').read() + '\n@@CAD_CUBE@@\n' + open(ROOT + '/tools/chisel_chars.js').read())
# ---- the view cube, copied from JumpStart 3D (class + styles), so it is exactly the same
vpsrc = open(ROOT + '/src/viewport.js').read()
i0 = vpsrc.index('export class ViewCube {'); i1 = vpsrc.index('\n}\n', i0) + 3
cube_cls = vpsrc[i0:i1].replace('export class ViewCube', 'class ViewCube')
s = s.replace('@@CAD_CUBE@@', open(ROOT + '/tools/chisel_cube.js').read().replace('@@VIEWCUBE_CLASS@@', cube_cls))
hcss = open(ROOT + '/src/index.html').read()
cube_css = '\n'.join(l for l in hcss.split('\n') if l.startswith(('.viewcube', '.cube-arrow', '.cube-roll', '@media (pointer: coarse) { .cube-')))
assert cube_css.count('\n') >= 8, cube_css
R('</style>', '#view{--ink-3:var(--muted);--ink-2:var(--text)}\n' + cube_css + '''
.panel-tab{position:absolute;right:0;top:50%;transform:translateY(-50%);z-index:7;width:20px;height:64px;padding:0;display:flex;align-items:center;justify-content:center;border:1px solid var(--line-2);border-right:0;border-radius:8px 0 0 8px;background:var(--panel);color:var(--text);box-shadow:-2px 0 8px rgba(0,0,0,.12);cursor:pointer}
.panel-tab:hover{color:var(--accent);background:var(--accent-soft)}
.panel-tab:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.panel-tab svg{width:14px;height:14px;transition:transform .2s ease}
.panel-tab.closed svg{transform:rotate(180deg)}
@media (min-width:821px){#app{transition:grid-template-columns .2s ease}#panel{overflow-x:hidden}body.tucked #app{grid-template-columns:58px minmax(0,1fr) 0}body.easy.tucked #app{grid-template-columns:86px minmax(0,1fr) 0}body.tucked #panel{border-left-width:0;overflow:hidden}}
@media (max-width:820px){.panel-tab{display:none!important}}
@media (prefers-reduced-motion:reduce){#app,.panel-tab svg{transition:none}}
@media (max-width:860px){.viewcube{width:72px;height:72px}.cube-arrows{width:72px;height:72px}.cube-arrow.l,.cube-arrow.r{top:22px!important}.cube-arrow.u,.cube-arrow.d{left:22px!important}}
</style>''', 1)
# the camera can turn around its line of sight (the cube's curved arrows), and dragging to
# orbit follows the turned picture
R("  camera.lookAt(t); camera.updateMatrixWorld(); req();", "  camera.lookAt(t); if (cam.roll) camera.rotateZ(cam.roll); camera.updateMatrixWorld(); req();")
R("  if (action.type === 'orbit') { cam.th -= (p.x - action.x) * 0.008; cam.ph = Math.max(0.05, Math.min(Math.PI - 0.05, cam.ph - (p.y - action.y) * 0.008));",
  "  if (action.type === 'orbit') { CUBE.stop(); const rr = cam.roll || 0, ddx = p.x - action.x, ddy = p.y - action.y, ox = ddx * Math.cos(rr) + ddy * Math.sin(rr), oy = -ddx * Math.sin(rr) + ddy * Math.cos(rr); cam.th -= ox * 0.008; cam.ph = Math.max(0.05, Math.min(Math.PI - 0.05, cam.ph - oy * 0.008));")
R("  if (needsRender) { needsRender = false; CAD.frame(); renderer.render(scene, camera); }", "  if (needsRender) { needsRender = false; CAD.frame(); CUBE.frame(); renderer.render(scene, camera); }")
open(ROOT + '/src/chisel.html', 'w').write(s)
print('chisel.html', len(s))

# ================= Puppet Animator, MP4 export, History =================
s = s.replace(open(ROOT + '/tools/chisel_chars.js').read(), open(ROOT + '/tools/chisel_chars.js').read() + '\n' + open(ROOT + '/tools/chisel_mp4.js').read() + '\n' + open(ROOT + '/tools/chisel_puppet.js').read(), 1)
R("CAD.frame(); CUBE.frame();", "CAD.frame(); CUBE.frame(); PUP.frame();")
# pointer: in the animator, joints and characters are picked; anything else turns the view
R("""  if (CAD.down(p, e)) { action = { type: 'cad' }; return; }""", """  if (PUP.on) { if (PUP.down(p, e)) action = { type: 'pup' }; else action = { type: e.shiftKey ? 'pan' : 'orbit', x: p.x, y: p.y }; return; }
  if (CAD.down(p, e)) { action = { type: 'cad' }; return; }""")
R("""  if (action && action.type === 'cad') { CAD.move(p, e); return; }
  if (!action) { if (CAD.hover(p, e)) return; queueHover(); return; }""", """  if (action && action.type === 'pup') { PUP.move(p, e); return; }
  if (action && action.type === 'cad') { CAD.move(p, e); return; }
  if (!action) { if (PUP.on) { PUP.hover(p); return; } if (CAD.hover(p, e)) return; queueHover(); return; }""")
R("""  if (a.type === 'cad') CAD.up(e);""", """  if (a.type === 'cad') CAD.up(e);
  if (a.type === 'pup') PUP.up(e);""")
R("""  if (CAD.key(e)) return;\n""", """  if (PUP.key(e)) return;\n  if (CAD.key(e)) return;\n""")
# undo steps remember when and with what (for History), and the skeleton / animation
R("function pushUndo() { undoStack.push(snapshot());", "function pushUndo() { const _s = snapshot(); _s.at = Date.now(); _s.tool = S.tool; undoStack.push(_s);")
R("function updateUndoBtns() { $('#undoBtn').disabled = !undoStack.length; $('#redoBtn').disabled = !redoStack.length; }",
  "function updateUndoBtns() { $('#undoBtn').disabled = !undoStack.length; $('#redoBtn').disabled = !redoStack.length; try { HIST.render(); } catch (e) {} }")
R("      return { id: o.id, name: o.name, snap: o.snap, ref: o.ref || null,", "      return { id: o.id, name: o.name, snap: o.snap, pup: PUP.data(o), ref: o.ref || null,")
R("    o.snap = s.snap; o.dirty = false; o.name = s.name;\n", "    o.snap = s.snap; o.dirty = false; o.name = s.name;\n    if ('pup' in s && JSON.stringify(PUP.data(o)) !== JSON.stringify(s.pup)) { if (s.pup) PUP.adopt(o, s.pup); else { o.skel = null; o.anim = null; } o.pose = null; o.pupRev = (o.pupRev || 0) + 1; if (PUP.on) { PUP.seek(PUP.P.t); PUP.renderPanel(); } }\n")
# saved with the sculpt in the design
R("pos: changed ? o.pos : null, idx: changed ? o.idx : null, paint: changed && hasPaint(o) ? o.paint : null };",
  "pos: changed ? o.pos : null, idx: changed ? o.idx : null, paint: changed && hasPaint(o) ? o.paint : null, pup: PUP.data(o) };")
R("  linked(list) { for (const e of list) { const o = objects.find(x => x.id === e.cid); if (o) { o.jsId = e.jsId; o.syncRev = e.rev;",
  "  linked(list) { for (const e of list) { const o = objects.find(x => x.id === e.cid); if (o) { o.jsId = e.jsId; o.syncRev = e.rev; o.pupSync = o.pupRev || 0;")
R("  dirty: () => refGone.size > 0 || objects.some(o => o.ref && !o.jsId ? refTouched(o) : (!o.jsId || o.rev !== o.syncRev)),",
  "  dirty: () => refGone.size > 0 || objects.some(o => (o.pupRev || 0) !== (o.pupSync || 0)) || objects.some(o => o.ref && !o.jsId ? refTouched(o) : (!o.jsId || o.rev !== o.syncRev)),")
R("""      setMatrix(o, e.matrix);
      o.rev = o.syncRev = e.rev;""", """      setMatrix(o, e.matrix);
      o.rev = o.syncRev = e.rev;
      // its skeleton and animation (unless changed here and not saved yet)
      if ('pup' in e && (o.pupRev || 0) === (o.pupSync || 0)) { if (e.pup) PUP.adopt(o, JSON.parse(JSON.stringify(e.pup))); else { o.skel = null; o.anim = null; } o.pupRev = o.pupSync = 0; }""")
R('</style>', '''#pupSec{display:none}
body.puppet #pupSec{display:block}
body.puppet #panel>.sec:not(#pupSec){display:none!important}
body.puppet #tools>*{opacity:.35;pointer-events:none}
body.puppet #hud{display:none}
#pupFrame{position:absolute;pointer-events:none;border:2px solid rgba(255,255,255,.85);box-shadow:0 0 0 9999px rgba(0,0,0,.38);border-radius:2px;z-index:2}
#ptl{position:absolute;left:10px;right:10px;bottom:10px;z-index:5;background:var(--panel);border:1px solid var(--line-2);border-radius:10px;padding:8px 10px;box-shadow:0 8px 24px rgba(0,0,0,.25)}
#ptl[hidden]{display:none}
.ptl-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ptl-row .btn{padding:4px 9px}
.ptl-time{font:500 12px var(--mono);min-width:96px;color:var(--muted)}
.ptl-track{position:relative;margin-top:8px;height:44px;border:1px solid var(--line-2);border-radius:6px;background:var(--panel-2);cursor:pointer;touch-action:none}
.ptl-track i{position:absolute;top:0;bottom:0;border-left:1px solid var(--line);font:500 9.5px var(--mono);color:var(--faint);padding-left:2px;font-style:normal}
.ptl-track i.big{border-left-color:var(--line-2)}
.ptl-key{position:absolute;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;background:var(--accent);transform:rotate(45deg);border:1px solid var(--panel);cursor:grab}
.ptl-key.on{background:#ffc23d;box-shadow:0 0 0 2px var(--cut)}
.ptl-row .btn:disabled{opacity:.4}
.ptl-head{position:absolute;top:-4px;bottom:-4px;width:2px;margin-left:-1px;background:var(--cut);text-decoration:none;pointer-events:none}
.ptl-len{display:flex;align-items:center;gap:4px;white-space:nowrap}
.ptl-len select{margin-left:4px}
.ptl-sp{flex:1}
.ptl-row .ptl-play{min-width:44px;font-weight:700}
.ptl-row .ptl-addkey{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.ptl-help{margin-top:6px;font-size:11.5px;color:var(--muted)}
.ptl-key{width:14px !important;height:14px !important;margin:-7px 0 0 -7px !important}
.ptl-head::before{content:"";position:absolute;top:-2px;left:-5px;border:6px solid transparent;border-top-color:var(--cut)}
body.puppet #toast{bottom:150px}
.pm-row{display:flex;align-items:center;gap:6px;margin:4px 0}
.pm-row>span{width:46px;font-size:12px;color:var(--muted)}
.pm-row label{display:flex;align-items:center;gap:3px;font-size:11px;color:var(--muted);flex:1;min-width:0}
.pm-row input{width:100%;min-width:0;padding:3px 4px}
.pup-lib{display:flex;flex-wrap:wrap;gap:5px;margin:4px 0 8px}
.pup-my{display:inline-flex;align-items:center;gap:2px}
.pup-tools{margin:4px 0}
.pup-prog{height:6px;border-radius:3px;background:var(--panel-2);overflow:hidden;margin-top:6px}
.pup-prog i{display:block;height:100%;width:0;background:var(--accent)}
#hist{position:absolute;left:12px;bottom:12px;z-index:4;display:flex;align-items:center;gap:6px;background:var(--pill-bg,rgba(15,17,20,.62));border:1px solid var(--line-2);border-radius:999px;padding:3px 10px 3px 4px;max-width:calc(100% - 180px);overflow-x:auto}
#hist[hidden]{display:none}
.hist-t{border:0;background:var(--panel-2);border-radius:999px;padding:3px 9px;font:600 10.5px var(--cond);letter-spacing:.1em;text-transform:uppercase;color:var(--text);cursor:pointer}
.hist-n{font:500 11px var(--mono);color:var(--muted)}
.hist-dots{display:flex;align-items:center;gap:4px}
.hd{width:10px;height:10px;border-radius:50%;border:0;padding:0;cursor:pointer}
.hd.past{background:var(--accent)}
.hd.future{background:var(--line-2)}
.hd.now{width:4px;height:16px;border-radius:2px;background:var(--cut)}
#pupBtn[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink)}
</style>''', 1)
# ================= Safari: Mac trackpad, iPad and iPhone =================
R("let action = null; const pointers = new Map();", """// Apple devices (iPadOS Safari says it is a Mac: a Mac with a touch screen is an iPad)
const APPLE = (() => { const n = navigator, id = n.platform || n.userAgent || '', ios = /iP(hone|ad|od)/.test(id) || /iP(hone|ad|od)/.test(n.userAgent || '') || (/Mac/.test(id) && n.maxTouchPoints > 1); return { ios, mac: !ios && /Mac/.test(id), gest: null }; })();
if (APPLE.ios) document.documentElement.classList.add('ios');
if (APPLE.ios) document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
// iPhone / iPad grey out STL and OBJ files when a picker asks for them by name: take any file there
setTimeout(() => { if (APPLE.ios) { const f = document.getElementById('importFile'); if (f) f.removeAttribute('accept'); } }, 0);
// Mac / iPad keyboards: show the command key in labels and tooltips
(function macLabels() {
  if (!(APPLE.mac || APPLE.ios) || typeof MutationObserver === 'undefined') return;
  const RX = /\\bCtrl\\b|\\bAlt\\b/, conv = (t) => t.replace(/\\bCtrl\\b/g, '\\u2318').replace(/\\bAlt\\b/g, '\\u2325');
  const fix = (n) => {
    if (n.nodeType === 3) { if (RX.test(n.data) && !(n.parentNode && /^(TEXTAREA|SCRIPT|STYLE)$/.test(n.parentNode.nodeName))) n.data = conv(n.data); return; }
    if (n.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.nodeName)) return;
    const t = n.getAttribute('title'); if (t && RX.test(t)) n.setAttribute('title', conv(t));
    for (let c = n.firstChild; c; c = c.nextSibling) fix(c);
  };
  const go = () => { fix(document.body); new MutationObserver((l) => { for (const m of l) { if (m.type === 'childList') m.addedNodes.forEach(fix); else fix(m.target); } }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] }); };
  if (document.body) go(); else addEventListener('DOMContentLoaded', go);
})();
let action = null; const pointers = new Map();""")
# Mac: Control-click is a right-click (turns the view; with Shift it moves it)
R("""  hideHover();
  if (e.button === 2 || e.button === 1) {""", """  hideHover();
  if (APPLE.mac && e.button === 0 && e.ctrlKey && !e.metaKey) { action = { type: e.shiftKey ? 'pan' : 'orbit', x: p.x, y: p.y }; return; }
  if (e.button === 2 || e.button === 1) {""")
# trackpad pinch: Ctrl + wheel (Chrome, Firefox) at a useful speed, gesture events (Safari)
R("""glc.addEventListener('wheel', e => { e.preventDefault(); cam.r = Math.max(0.3, Math.min(80, cam.r * Math.exp(e.deltaY * 0.0012))); updateCam(); queueHover(); }, { passive: false });""",
  """glc.addEventListener('wheel', e => { e.preventDefault(); if (APPLE.gest) return; cam.r = Math.max(0.3, Math.min(80, cam.r * Math.exp(e.deltaY * (e.ctrlKey && e.deltaMode === 0 ? 0.0075 : 0.0012)))); updateCam(); queueHover(); }, { passive: false });
glc.addEventListener('gesturestart', e => { e.preventDefault(); APPLE.gest = { s: e.scale || 1 }; });
glc.addEventListener('gesturechange', e => { e.preventDefault(); if (!APPLE.gest || pointers.size) return; const sc = e.scale || 1; cam.r = Math.max(0.3, Math.min(80, cam.r * APPLE.gest.s / sc)); APPLE.gest.s = sc; updateCam(); queueHover(); });
glc.addEventListener('gestureend', e => { e.preventDefault(); setTimeout(() => { APPLE.gest = null; }, 60); });""")
# Safari's CSS prefixes and fallbacks
R("</style>", """html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{-webkit-tap-highlight-color:transparent}
.btn,.tool,.seg button,.action,.chip,.obj .eye,.sw,.bru,.toggles button,.ecol,.etoggle,.cadt{-webkit-appearance:none}
.pill,#hist{-webkit-backdrop-filter:blur(6px)}
#gl,canvas,.tool,.bru,.chip,.btn,#hist,#ptl{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
button,.btn,.tool,.bru,.chip,label,select{touch-action:manipulation}
@supports not (background:color-mix(in srgb,red 50%,blue)){#rubber{background:rgba(80,140,255,.08)}#rubber.crossing{background:rgba(60,180,110,.08)}}
@media (max-width:820px){#top{overflow-x:auto;scrollbar-width:none}#top::-webkit-scrollbar{display:none}#top .btn,#top .tb,#top .brand{flex-shrink:0}#top .btn{padding:0 8px}#panelToggle{position:sticky;right:0;background:var(--panel);box-shadow:-10px 0 10px var(--panel)}}
html.ios input[type=number],html.ios input[type=text],html.ios input[type=search],html.ios select,html.ios textarea{font-size:16px}
</style>""")
open(ROOT + '/src/chisel.html', 'w').write(s)
print('chisel.html (puppet)', len(s))
