import * as THREE from "three";
import { PRINTERS, plateDims, getPlatePref, onPlatePref } from "./printerpresets.js";
import { startJob } from "./overhang.js";
import { startPlateJob, fitsPlate, flatness, verdict } from "./printcheck.js";
import { ICON } from "./icons.js";
import { showSimpleAbout } from "./simpleabout.js";

const TOOLS = {
  sketch: ["Sketch", "sketch"], import: ["Import", "import"], hole: ["Hole", "holeToggle"], group: ["Group", "group"], align: ["Align", "align"], fillet: ["Round edges", "fillet", "Fillet"], measure: ["Measure", "measure"],
  sketch3d: ["3D Sketch", "spline"], extrude: ["Extrude", "extrude"], facebox: ["Box on face", "rect"], pattern: ["Pattern", "pattern"], mirror: ["Mirror", "mirror"], shell: ["Hollow", "shell", "Shell"],
  dup: ["Duplicate", "duplicate"], del: ["Delete", "del"], copy: ["Copy", "copy"], paste: ["Paste", "paste"], ungroup: ["Ungroup", "ungroup"], solid: ["Solid", "box"], lock: ["Lock", "lock"], multi: ["Multi-select", "select"],
  drop: ["Lay flat", "drop", "Drop"], printsim: ["Print check", "printsim", "3D Print Sim"], texture: ["Texture", "texture"], facepat: ["Face pattern", "facePattern"], fillopen: ["Fill openings", "fillOpen"],
  fastener: ["Fasteners", "thread"], gear: ["Gear", "gear"], nameplate: ["Name plate", "tag"], knurl: ["Knurled knob", "knurl"], spring: ["Coil spring", "spring"], hinge: ["Hinge", "hinge"], bins: ["Box Maker", "box"], neon: ["Neon Sign", "neon"], cosforge: ["CosForge", "cosforge"]
};
const PARTS = ["fastener", "gear", "nameplate", "knurl", "spring", "hinge"];
const MAKERS = ["bins", "neon", "cosforge"];
TOOLS.layerscape = ["Layerscape", "layerscape"]; MAKERS.push("layerscape"); // J.Siwek 2.9.8.9.x: his new Beginner maker

function initPlate(app) {
  const $ = (id) => document.getElementById(id);
  const work = document.querySelector("main.work");
  const rail = document.createElement("nav"); rail.id = "simple-rail"; rail.setAttribute("aria-label", "Simple tools");
  const shapes = document.createElement("div"); shapes.id = "simple-shapes"; shapes.className = "simple-panel"; shapes.hidden = true;
  const more = document.createElement("div"); more.id = "simple-more"; more.className = "simple-panel"; more.hidden = true; more.setAttribute("role", "dialog"); more.setAttribute("aria-label", "More tools");
  work.prepend(rail, shapes, more);
  function proxy(key, id) {
    const b = document.createElement("button"), [label, icon] = TOOLS[key];
    b.type = "button"; b.dataset.for = "bb-" + key; if (id) b.id = id;
    b.innerHTML = (ICON[icon] || "") + `<span>${label}</span>`;
    return b;
  }
  function special(id, label, icon) {
    const b = document.createElement("button"); b.type = "button"; b.id = id; b.innerHTML = (ICON[icon] || "") + `<span>${label}</span>`; b.title = label; return b;
  }
  const shapeButton = special("sr-shapes", "Shapes", "box"), move = special("sr-move", "Move", "select"), moreButton = special("sr-more", "More", "more");
  moreButton.querySelector("span").insertAdjacentHTML("beforebegin", '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>');
  for (const [b, panel] of [[shapeButton, shapes], [moreButton, more]]) { b.setAttribute("aria-haspopup", "dialog"); b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", panel.id); }
  rail.append(shapeButton, proxy("sketch", "sr-sketch"), proxy("import", "sr-import"), move, proxy("hole", "sr-hole"), proxy("group", "sr-group"), proxy("align", "sr-align"), proxy("fillet", "sr-fillet"), proxy("measure", "sr-measure"), moreButton);
  $("sr-fillet").querySelector("span").textContent = "Round";
  function group(parent, title, keys, className = "") {
    const section = document.createElement("section"); section.className = className;
    const heading = document.createElement("h3"); heading.textContent = title; section.append(heading);
    const grid = document.createElement("div"); grid.className = "simple-grid"; for (const key of keys) grid.append(proxy(key)); section.append(grid); parent.append(section); return section;
  }
  shapes.innerHTML = '<h2>Shapes and parts</h2><p>Basic shapes and holes are in the strip at the bottom</p><div class="simple-grid"><button type="button" data-dock="objects">Shapes</button><button type="button" data-dock="holes">Holes</button></div>';
  group(shapes, "Parts", PARTS); group(shapes, "Makers", MAKERS);
  more.innerHTML = '<input id="simple-find" type="search" placeholder="Find a tool" aria-label="Find a tool"><p id="simple-empty" hidden>No tool by that name</p>';
  group(more, "Arrange", ["align", "fillet", "measure"], "simple-arrange");
  group(more, "Shape it", ["sketch3d", "extrude", "facebox", "pattern", "mirror", "shell"]);
  group(more, "Edit", ["dup", "del", "copy", "paste", "ungroup", "solid", "lock", "multi"]);
  group(more, "Print", ["drop", "printsim"]); group(more, "Surfaces", ["texture", "facepat", "fillopen"]); group(more, "Parts and makers", [...PARTS, ...MAKERS]);
  const other = group(more, "Other", []); other.hidden = true;
  const appGroup = group(more, "App", []);
  for (const [id, label, phone] of [["btn-projects", "Designs"], ["btn-autosave", "Autosave"], ["btn-chat", "AI chat"], ["btn-keys", "Keyboard shortcuts"], ["btn-full", "Full screen"], ["mode-chisel", "Chisel"], ["mode-arch", "Architect"], ["btn-about", "Original app info"], ["btn-tutorials", "Learn", true], ["mode-beginner", "Beginner", true], ["mode-advanced", "Advanced", true]]) {
    const b = document.createElement("button"); b.type = "button"; b.dataset.for = id; b.textContent = label; if (phone) b.className = "face-phone"; appGroup.querySelector(".simple-grid").append(b);
  }
  // J.Siwek 2.9.8.x tools that live in Original's menus. activate() clicks the element named by data-for, so each one gets a hidden runner.
  const runners = document.createElement("div"); runners.hidden = true; document.body.append(runners);
  const workshop = group(more, "Workshop", []).querySelector(".simple-grid");
  for (const [id, label, icon, title, run] of [
    ["simple-run-rib", "Rib", "rib", "Reinforce: straight ribs or corner gussets standing on a flat face", () => app.advanced.rib()],
    ["simple-run-keyhole", "Keyhole slot", "keyhole", "Cut keyhole slots in a face so the part hangs on screws", () => app.advanced.keyhole()],
    ["simple-run-jigs", "Jig Maker", "jig", "Woodworking jigs: miter box, dowel and pocket-hole jigs, squares, drill guides and joint jigs", () => app.advanced.jigs()],
    ["simple-run-helmet", "Helmet Maker", "helmet", "Build a sci-fi helmet sized to your head (opens in its own window)", () => app.cosforge.open({ mode: "helmet" })],
    ["simple-run-litho", "Colour lithophane", "image", "Turn a photo into a full-colour lithophane printed with white, cyan, magenta and yellow filament", () => app.colorLitho.open()],
    ["exp-laser-svg", "Laser cut file", "layerscape", "Flat parts (like a 3 mm acrylic panel) as a laser file: the outline and holes to cut, recesses to engrave"],
  ]) {
    if (run) { const r = document.createElement("button"); r.type = "button"; r.id = id; r.onclick = run; runners.append(r); }
    const b = document.createElement("button"); b.type = "button"; b.dataset.for = id; b.title = title; b.innerHTML = (ICON[icon] || "") + `<span>${label}</span>`; workshop.append(b);
  }
  const footer = document.createElement("button"); footer.id = "simple-original"; footer.type = "button"; footer.textContent = "Switch to Original →"; more.append(footer);
  const find = $("simple-find");
  function filter() {
    const q = find.value.trim().toLowerCase(); more.classList.toggle("searching", !!q); let count = 0;
    for (const section of more.querySelectorAll("section")) {
      let found = 0;
      for (const b of section.querySelectorAll("button[data-for]")) { b.hidden = !$(b.dataset.for) || !(`${b.textContent} ${b.title}`.toLowerCase().includes(q)); if (!b.hidden) found++; }
      section.hidden = !found; if (!section.classList.contains("simple-arrange") || q || matchMedia("(max-width: 640px)").matches) count += found;
    }
    $("simple-empty").hidden = !!count;
  }
  function sync() {
    for (const original of document.querySelectorAll('#ribbon .bbar button[id^="bb-"]')) {
      const key = original.id.slice(3);
      if (!TOOLS[key]) { TOOLS[key] = [original.getAttribute("aria-label") || original.textContent.trim(), ""]; other.querySelector(".simple-grid").append(proxy(key)); }
    }
    for (const b of work.querySelectorAll('button[data-for^="bb-"]')) {
      const original = $(b.dataset.for); b.hidden = !original;
      if (!original) continue;
      b.disabled = original.disabled; b.classList.toggle("dim", original.classList.contains("dim"));
      if (b.dataset.for === "bb-multi" && original.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", original.getAttribute("aria-pressed"));
      const old = TOOLS[b.dataset.for.slice(3)]?.[2]; b.title = old ? `${TOOLS[b.dataset.for.slice(3)][0]} (${old}): ${original.title}` : original.title;
    }
    // Hole has a useful action even without a selection.
    $("sr-hole").disabled = false;
    filter();
  }
  function close(focus = false) {
    const was = !shapes.hidden ? shapeButton : !more.hidden ? moreButton : null;
    shapes.hidden = more.hidden = true; shapeButton.setAttribute("aria-expanded", "false"); moreButton.setAttribute("aria-expanded", "false");
    if (focus && was) was.focus();
  }
  function toggle(panel, button) { const opening = panel.hidden; close(); if (opening) { sync(); panel.hidden = false; if (panel === more && !matchMedia("(max-width: 640px)").matches) { panel.style.bottom = (work.clientHeight - rail.offsetTop - rail.offsetHeight) + "px"; panel.style.maxHeight = rail.offsetHeight + "px"; } else { panel.style.bottom = ""; panel.style.maxHeight = ""; } button.setAttribute("aria-expanded", "true"); } }
  shapeButton.onclick = () => toggle(shapes, shapeButton); moreButton.onclick = () => toggle(more, moreButton);
  move.onclick = () => { if (app.sel.length) { $("insp-pos0")?.focus(); app.toast("Drag the shape on the plate, or type where it goes here."); } else app.toast("Pick a shape first, then drag it on the plate."); };
  function activate(e) {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.dock) { $("dock-" + b.dataset.dock)?.click(); close(); return; }
    if (!b.dataset.for) return;
    if (b.id === "sr-hole" && !app.sel.length) { $("dock-holes")?.click(); app.toast("Drag a hole shape onto a solid, then Group them to cut it."); return; }
    close(); $(b.dataset.for)?.click(); sync();
  }
  function toolKeys(e) { if (e.key !== "Enter" && e.key !== " ") return; if (app.command) e.preventDefault(); else e.stopPropagation(); }
  rail.addEventListener("keydown", toolKeys);
  rail.addEventListener("click", activate);shapes.addEventListener("click", activate); more.addEventListener("click", activate);
  footer.onclick = () => app.setFace("original"); find.addEventListener("input", filter);
  work.addEventListener("keydown", (e) => {
    const panel = !more.hidden ? more : !shapes.hidden ? shapes : null; if (!panel) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === "Tab") { setTimeout(() => { if (!panel.contains(document.activeElement) && document.activeElement !== (panel === more ? moreButton : shapeButton)) close(); }, 0); return; }
    if (e.key === "/" && panel === more && e.target !== find) { e.preventDefault(); find.focus(); return; }
    const buttons = [...panel.querySelectorAll("button")].filter((b) => b.getClientRects().length && !b.disabled);
    if (e.key === "Enter" && e.target === find) { e.preventDefault(); e.stopPropagation(); buttons.find((b) => b.dataset.for)?.click(); return; }
    if (e.target === find && ["ArrowLeft", "ArrowRight", "ArrowUp"].includes(e.key)) return;
    if (e.target === find && e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); buttons.find(b => b.dataset.for)?.focus(); return; }
    if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); const i = buttons.indexOf(document.activeElement), step = ["ArrowDown", "ArrowRight"].includes(e.key) ? 1 : -1; buttons[(i + step + buttons.length) % buttons.length]?.focus(); }
    if (e.key === "Enter" || e.key === " ") toolKeys(e);
  });
  window.addEventListener("pointerdown", (e) => { if (!rail.contains(e.target) && !shapes.contains(e.target) && !more.contains(e.target)) close(); });
  function proxyFor(id) {
    const proxies = [...work.querySelectorAll('button[data-for]')].filter((b) => b.dataset.for === id);
    const visible = proxies.find((b) => b.getClientRects().length); if (visible) return visible;
    if (!moreButton.getClientRects().length) return null;
    return proxies.some((b) => b.closest("#simple-more")) ? moreButton : proxies.some((b) => b.closest("#simple-shapes")) ? shapeButton : null;
  }
  const panel = document.createElement("aside"); panel.id = "simple-panel"; panel.setAttribute("aria-label", "Selected shape");
  panel.innerHTML = '<button id="simple-sheet-handle" aria-expanded="false" aria-label="Expand selected shape panel">━━</button><div class="simple-panel-scroll"><div id="simple-inspector-slot"></div><div id="simple-plate-empty"><h2>The plate</h2><p>Pick a shape on the plate, or drag one in from the strip below.</p></div><div id="simple-actions"><div id="simple-multi" class="simple-grid"></div><h3>Quick fixes</h3><div id="simple-fixes" class="simple-grid"></div></div></div><div class="simple-print-footer"><div id="simple-ready" role="status" data-state="empty">Add a shape to check it.</div><button id="simple-print">Export STL for printing</button><button id="simple-export-more">Send to slicer (3MF) · more formats</button></div>';
  work.append(panel);
  for (const key of ["group", "align", "ungroup"]) $("simple-multi").append(proxy(key));
  for (const key of ["drop", "dup", "mirror", "shell", "fillet", "del", "fillopen"]) $("simple-fixes").append(proxy(key));
  panel.addEventListener("click", activate);
  $("simple-actions").addEventListener("keydown", toolKeys);
  panel.querySelector(".simple-print-footer").addEventListener("keydown", toolKeys);
  $("simple-print").onclick = () => { if ($("menu-export").hidden) $("btn-export").click(); document.querySelector('#menu-export button[data-act="stl"]')?.click(); };
  $("simple-export-more").onclick = () => $("btn-export").click();
  $("simple-sheet-handle").onclick = () => { const expanded = panel.classList.toggle("expanded"); $("simple-sheet-handle").setAttribute("aria-expanded", expanded); };
  const inspector = $("inspector"), oldParent = inspector.parentNode, placeholder = document.createComment("inspector position");
  oldParent.insertBefore(placeholder, inspector.nextSibling);
  const label = document.createElement("button"); label.id = "simple-plate-label"; label.onclick = () => app.plateView.open(); $("viewport").append(label);
  const ready = $("simple-ready"); let timer, generation = 0;
  function plateName() { const choice = getPlatePref().printer; return choice === "none" ? "No plate boundary" : choice === "generic" ? "256 × 256 mm" : (PRINTERS[choice]?.name || "256 × 256 mm"); }
  function updateLabel() { const name = plateName(); label.textContent = getPlatePref().printer === "none" ? name : "Plate · " + name; }
  function layout() {
    const active = document.documentElement.dataset.face === "simple" && app.mode === "beginner";
    if (active && inspector.parentNode !== $("simple-inspector-slot")) $("simple-inspector-slot").append(inspector);
    else if (!active && inspector.parentNode !== oldParent) oldParent.insertBefore(inspector, placeholder);
    const selected = app.selected(); panel.classList.toggle("has-selection", !!selected.length);
    $("simple-plate-empty").hidden = !!selected.length; $("simple-actions").hidden = !selected.length;
    $("simple-multi").hidden = selected.length < 2;
    const ungroup = $("simple-multi").querySelector('[data-for="bb-ungroup"]'); ungroup.hidden = selected.length < 2 || $("bb-ungroup")?.disabled;
    $("simple-fixes").querySelector('[data-for="bb-fillopen"]').hidden = !selected.some(b => b.node.t === "mesh" || b.node.t === "step");
    if (!selected.length) { panel.classList.remove("expanded"); $("simple-sheet-handle").setAttribute("aria-expanded", "false"); }
  }
  const cache = new WeakMap();
  function setText(state, text) {
    ready.dataset.state = state; ready.setAttribute("aria-busy", "false"); delete ready.dataset.verdict;
    if (ready.textContent !== text || ready.children.length) ready.textContent = text;
  }
  function schedule() {
    generation++; clearTimeout(timer);
    if (document.documentElement.dataset.face !== "simple" || app.mode !== "beginner") { ready.setAttribute("aria-busy", "false"); return; }
    ready.setAttribute("aria-busy", "true");
    if (ready.dataset.state === "empty") { ready.dataset.state = "checking"; ready.textContent = "Checking…"; }
    const g = generation; timer = setTimeout(() => check(g), 250);
  }
  function check(g) {
    const selected = new Set(app.sel), views = [...app.scene.views].filter(([id,v]) => (!selected.size || selected.has(id)) && v.data && v.mesh && v.body && !v.body.hole && !v.body.cmdPreview && !v.body.cutPreview && !v.pending && v.group.visible && !app.scene.state.ghost.has(id));
    if (!views.length) { setText("empty", "Add a shape to check it."); return; }
    const pref = getPlatePref(), dims = plateDims(pref.printer); let minZ = Infinity, contact = 0, fit = true, area = 0, large = false, index = 0, current = null;
    const matrix = new THREE.Matrix4(), local = new THREE.Matrix4();
    function finish() {
      const flat = flatness(minZ, contact), state = verdict({ flat: flat?.type, fit: fit === true, overhang: large ? "large" : area > 0 });
      const heading = state === "ready" ? "✓ Ready to print" : state === "warn" ? "Check before printing" : "Not ready yet";
      const lines = [];
      const line = (text, action, buttonText) => lines.push({ text, action, buttonText });
      if (state === "ready") line(`Sits flat, ${dims ? `fits the ${plateName()} plate` : "no printer picked"}, 0 overhangs.`);
      else {
        if (flat) line(flat.type === "point" ? "Touches the plate only at a point or edge" : `${flat.type === "float" ? "Floats" : "Goes"} ${Number(flat.value.toFixed(2))} mm ${flat.type === "float" ? "above" : "below"} the plate`, flat.type === "float" && selected.size ? "bb-drop" : null, "Lay flat");
        if (fit !== true) line(fit === "size" ? `Too big for the ${plateName()} plate` : "Reaches past the plate edge");
        if (!dims) line("No printer picked");
        if (large) line("Too detailed to check here — use Print check", "bb-printsim", "Details"); else if (area > 0) line(`${Math.round(area)} mm² leans more than ${pref.angle}° — may need supports`, "bb-printsim", "Details");
      }
      const signature = JSON.stringify([heading, lines]);
      if (ready.dataset.verdict !== signature) {
        ready.replaceChildren(); const h = document.createElement("strong"); h.textContent = heading; ready.append(h);
        for (const item of lines) { const p = document.createElement("p"); p.textContent = item.text; if (item.action) { const b = document.createElement("button"); b.textContent = item.buttonText; b.onclick = () => $(item.action)?.click(); p.append(" ", b); } ready.append(p); }
        ready.dataset.verdict = signature;
      }
      ready.dataset.state = state; ready.setAttribute("aria-busy", "false");
    }
    function step() {
      if (g !== generation) return;
      const deadline = performance.now() + 8;
      while (performance.now() < deadline) {
        if (!current) {
          if (index >= views.length) { finish(); return; }
          const v = views[index++][1], geo = v.mesh.geometry, pos = geo.getAttribute("position").array, indices = geo.getIndex()?.array;
          if (!indices) continue;
          local.compose(v.mesh.position, v.mesh.quaternion, v.mesh.scale); const m = matrix.multiplyMatrices(v.group.matrix, local).elements.slice();
          const signature = v.key + ":" + m.join(","), saved = cache.get(geo);
          current = { geo, pos, indices, m, signature, saved: saved?.signature === signature && saved.pos === pos && saved.indices === indices ? saved : null };
          if (!current.saved) current.plate = startPlateJob(pos, indices, m);
        }
        const c = current;
        if (c.plate) { if (!c.plate.step(Math.max(0, deadline - performance.now()))) break; c.saved = { signature: c.signature, pos: c.pos, indices: c.indices, plate: c.plate.result() }; c.plate = null; cache.set(c.geo, c.saved); }
        if (!c.applied) { const p = c.saved.plate, f = fitsPlate(p.bounds, dims); minZ = Math.min(minZ, p.minZ); contact += p.contactArea; if (!f.ok && (fit === true || f.why === "size")) fit = f.why; c.applied = true; }
        if (c.indices.length / 3 > 300000) { large = true; current = null; continue; }
        if (c.saved.angle === pref.angle) { area += c.saved.area; current = null; continue; }
        if (!c.overhang) c.overhang = startJob(c.pos, c.indices, c.m, pref.angle);
        if (!c.overhang.step(Math.max(0, deadline - performance.now()))) break;
        c.saved.angle = pref.angle; c.saved.area = c.overhang.area; area += c.saved.area; current = null;
      }
      setTimeout(step, 0);
    }
    setTimeout(step, 0);
  }
  const refresh = app.refreshUI; app.refreshUI = function (...args) { const result = refresh.apply(this, args); const active = document.documentElement.dataset.face === "simple" && app.mode === "beginner"; if (active) { sync(); layout(); schedule(); } else if (inspector.parentNode !== oldParent) { layout(); schedule(); } return result; };
  const sceneRefresh = app.onSceneRefresh; app.onSceneRefresh = function (...args) { sceneRefresh?.apply(this, args); if (document.documentElement.dataset.face === "simple" && app.mode === "beginner") { layout(); schedule(); } };
  onPlatePref(() => { updateLabel(); schedule(); }); updateLabel();

  sync(); return { sync, proxyFor, close, layout, schedule };
}

function initCollapse(app, plate) {
  const root = document.documentElement, $ = id => document.getElementById(id);
  const parts = ["rail", "panel", "top", "bottom"], names = { rail: "tools", panel: "shape panel", top: "top bar", bottom: "shape strip" };
  const targets = { rail: "simple-rail", panel: "simple-panel", top: "simple-topbar", bottom: "shapes" };
  document.querySelector("header.topbar").id = targets.top;
  let hidden = [], before = null, syncing = false, active = false, originalTucked = false;
  try { const saved = JSON.parse(localStorage.getItem("jumpstart.simple.hide")); if (Array.isArray(saved)) hidden = saved.filter(x => parts.includes(x)); const b = JSON.parse(localStorage.getItem("jumpstart.simple.hide.before")); if (Array.isArray(b)) before = b.filter(x => parts.includes(x)); } catch (e) { /* storage may be unavailable */ }
  const buttons = {};
  for (const part of parts) {
    const b = document.createElement("button"); b.type = "button"; b.id = "simple-collapse-" + part; b.className = "simple-collapse"; b.setAttribute("aria-controls", targets[part]);
    $("viewport").append(b); buttons[part] = b;
    b.onclick = () => { before = null; setHidden(hidden.includes(part) ? hidden.filter(x => x !== part) : [...hidden, part]); };
  }
  const whole = document.createElement("button"); whole.id = "simple-whole-plate"; whole.type = "button"; whole.title = "Show the whole plate (hide every panel)"; whole.setAttribute("aria-label", whole.title); whole.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5M4 4l6 6m10-6-6 6m6 10-6-6M4 20l6-6"/></svg>'; $("nav-fit").after(whole);
  function toggleDock() { let old; try { old = localStorage.getItem("jumpstart.shapesTucked"); } catch (e) {} $("shapes-tab").click(); try { if (old === null) localStorage.removeItem("jumpstart.shapesTucked"); else if (old !== undefined) localStorage.setItem("jumpstart.shapesTucked", old); } catch (e) {} }
  function save() { try { localStorage.setItem("jumpstart.simple.hide", JSON.stringify(hidden)); if (before) localStorage.setItem("jumpstart.simple.hide.before", JSON.stringify(before)); else localStorage.removeItem("jumpstart.simple.hide.before"); } catch (e) { /* storage may be unavailable */ } }
  function draw() {
    root.dataset.simpleHide = hidden.join(" ");
    for (const part of parts) { const closed = hidden.includes(part), b = buttons[part]; b.setAttribute("aria-expanded", String(!closed)); b.setAttribute("aria-label", (closed ? "Show the " : "Hide the ") + names[part]); b.title = b.getAttribute("aria-label"); b.textContent = part === "rail" ? (closed ? "›" : "‹") : part === "panel" ? (closed ? "‹" : "›") : part === "top" ? (closed ? "⌄" : "⌃") : (closed ? "⌃" : "⌄"); }
    buttons.panel.classList.toggle("selected", !!app.sel.length); whole.setAttribute("aria-pressed", String(before !== null));
  }
  function setHidden(next, refit = true) {
    hidden = parts.filter(x => next.includes(x));
    syncing = true; if (active && $("shapes").classList.contains("tucked") !== hidden.includes("bottom")) toggleDock(); syncing = false;
    if (hidden.includes("rail")) plate.close(); draw(); save();
    if (refit && app.face === "simple") requestAnimationFrame(() => { window.dispatchEvent(new Event("resize")); requestAnimationFrame(() => { const d = plateDims(getPlatePref().printer) || { w: 256, d: 256, h: null }, vpEl = $("viewport"), k = Math.max(1, 0.6 * vpEl.clientHeight / Math.max(1, vpEl.clientWidth)); app.vp.setView("home", new THREE.Box3(new THREE.Vector3(-d.w * k / 2, -d.d * k / 2, 0), new THREE.Vector3(d.w * k / 2, d.d * k / 2, Math.min(d.h ?? 40, 40)))); /* a tall, narrow view (a phone) is limited by its width */ }); }); // frame the whole printer plate, not just the shapes
  }
  whole.onclick = () => { if (before !== null) { const restore = before; before = null; setHidden(restore); } else { before = hidden.slice(); setHidden(parts); } };
  // Keep the original dock control authoritative, including clicks made by Beginner tools.
  new MutationObserver(() => { if (syncing || app.face !== "simple" || app.mode !== "beginner") return; const tucked = $("shapes").classList.contains("tucked"); if (tucked !== hidden.includes("bottom")) { before = null; setHidden(tucked ? [...hidden, "bottom"] : hidden.filter(x => x !== "bottom")); } }).observe($("shapes"), { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("keydown", e => { if (app.face !== "simple" || !["beginner", "advanced"].includes(app.mode) || !e.shiftKey || !e.altKey || e.ctrlKey || e.metaKey || e.code !== "KeyP" || e.target.closest("input, textarea, select, [contenteditable=true]")) return; e.preventDefault(); e.stopImmediatePropagation(); whole.click(); }, true);
  const layout = plate.layout; plate.layout = (...args) => { const r = layout(...args); draw(); return r; };
  const refresh = app.refreshUI; app.refreshUI = function (...args) { const r = refresh.apply(this, args); draw(); return r; };
  draw();
  return { activate(on) { if (on === active) return; syncing = true; if (on) originalTucked = $("shapes").classList.contains("tucked"); active = on; const wanted = on ? hidden.includes("bottom") : originalTucked; if ($("shapes").classList.contains("tucked") !== wanted) toggleDock(); syncing = false; draw(); }, reveal(el) { if (!el || app.face !== "simple") return; const part = el.closest("#simple-rail, #simple-shapes, #simple-more, #ribbon") ? "rail" : el.closest("#simple-panel, #inspector") ? "panel" : el.closest(".topbar") ? "top" : el.closest("#shapes") ? "bottom" : null; if (part && hidden.includes(part)) { before = null; setHidden(hidden.filter(x => x !== part)); } }, revealBottom() { if (hidden.includes("bottom")) { before = null; setHidden(hidden.filter(x => x !== "bottom")); } } };
}

// jumpstart-3d: Simple | Original switch, its More menu and the first-visit card.

const CSS = `

.simple-collapse, #simple-whole-plate { display: none; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) #simple-whole-plate { display: grid; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .simple-collapse { display: grid; place-items: center; position: absolute; z-index: 38; width: 32px; height: 32px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--ink); font-size: 23px; cursor: pointer; }
#simple-collapse-rail { left: 0; top: 40%; } #simple-collapse-panel { right: 0; bottom: 12px; }
#simple-collapse-top { top: 0; left: 50%; transform: translateX(-50%); } #simple-collapse-bottom { bottom: 0; left: 8px; }
#simple-collapse-panel.selected::after { content: ""; position: absolute; right: 3px; top: 3px; width: 7px; height: 7px; background: var(--accent); border-radius: 50%; }
html[data-face="simple"] #app[data-mode="advanced"] :is(#simple-collapse-rail, #simple-collapse-panel) { display: none; }
html[data-face="simple"][data-simple-hide~="top"] #app:is([data-mode="beginner"], [data-mode="advanced"]) > .topbar { display: none; }
html[data-face="simple"][data-simple-hide~="bottom"] #app:is([data-mode="beginner"], [data-mode="advanced"]) > .status { display: none; }
html[data-face="simple"] #app[data-mode="beginner"] #shapes { transition: none; }
html[data-face="simple"] #app[data-mode="beginner"] #shapes-tab { display: none !important; }
html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="beginner"] #simple-rail, html[data-face="simple"][data-simple-hide~="panel"] #app[data-mode="beginner"] #simple-panel { display: none !important; }
html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="beginner"] .work { grid-template-columns: 0 minmax(0, 1fr) var(--simple-panel-w, 280px); }
html[data-face="simple"][data-simple-hide~="panel"] #app[data-mode="beginner"] .work { grid-template-columns: 80px minmax(0, 1fr) 0; }
html[data-face="simple"][data-simple-hide~="rail"][data-simple-hide~="panel"] #app[data-mode="beginner"] .work { grid-template-columns: 0 minmax(0, 1fr) 0; }
:root.touch-ui .simple-collapse { min-width: 44px; min-height: 44px; }
@media (max-width: 640px) {
 html[data-face="simple"] #app[data-mode="beginner"] .work { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
 html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="beginner"] .work { grid-template-rows: minmax(0, 1fr) auto 0; }
 html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="beginner"] #simple-panel { bottom: 0; max-height: 100%; }
 html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .simple-collapse { width: 44px; height: 44px; }
 #simple-collapse-rail { left: 56px; top: auto; bottom: 0; }
 #simple-collapse-panel { right: 0; top: auto; bottom: 8px; }
}

#simple-panel, #simple-plate-label { display: none; }
html[data-face="simple"] #app[data-mode="beginner"] .work { grid-template-columns: 80px minmax(0, 1fr) 280px; }
html[data-face="simple"] #app[data-mode="beginner"] #simple-panel { display: flex; grid-column: 3; grid-row: 1; flex-direction: column; min-width: 0; min-height: 0; background: var(--panel); color: var(--ink); border-left: 1px solid var(--line); }
#simple-panel .simple-panel-scroll { overflow-y: auto; min-height: 0; flex: 1; }
#simple-panel #inspector { position: static; width: 100%; max-height: none; border: 0; border-radius: 0; box-shadow: none; }
#simple-panel #inspector .body { overflow: visible; }
#simple-panel .solidhole button { min-height: 44px; }
#simple-panel :is(#simple-actions, #simple-plate-empty) { margin: 12px; }
#simple-panel #simple-ready { margin-bottom: 6px; font-size: 13px; }
#simple-panel [hidden] { display: none !important; }
#simple-panel h2 { font-size: 16px; } #simple-panel h3 { font-size: 14px; }
#simple-panel p { font-size: 13px; }
#simple-panel .simple-grid button { min-width: 0; min-height: 44px; display: flex; align-items: center; gap: 6px; padding: 6px; color: var(--ink); background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
#simple-panel .simple-grid button:disabled { opacity: .45; }
#simple-panel .simple-grid svg { width: 20px; height: 20px; flex: none; }
#simple-ready { padding: 10px; border: 2px solid var(--line); border-radius: 8px; }
#simple-ready[data-state="ready"] { border-color: #278351; background: color-mix(in srgb, var(--panel) 90%, #278351); } #simple-ready[data-state="warn"] { border-color: #b27600; background: color-mix(in srgb, var(--panel) 90%, #b27600); } #simple-ready[data-state="fail"] { border-color: var(--danger); background: color-mix(in srgb, var(--panel) 90%, var(--danger)); }
#simple-ready p { margin: 7px 0 0; } #simple-ready button { color: var(--accent); background: transparent; border: 0; text-decoration: underline; cursor: pointer; }
.simple-print-footer { padding: 10px; border-top: 1px solid var(--line); display: grid; gap: 4px; }
.simple-print-footer button { min-height: 44px; cursor: pointer; border-radius: 6px; font-weight: 600; }
#simple-print { color: white; background: var(--accent-2); border: 0; } #simple-export-more { color: var(--ink); background: transparent; border: 0; }
#simple-sheet-handle { display: none; }
html[data-face="simple"] #app[data-mode="beginner"] #simple-plate-label { display: block; position: absolute; top: 14px; left: 14px; z-index: 6; padding: 8px 12px; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 999px; cursor: pointer; }
#viewport:has(.try-simple) #simple-plate-label { display: none !important; }
@media (min-width: 641px) and (max-width: 1100px) { html[data-face="simple"] #app[data-mode="beginner"] .work { --simple-panel-w: 236px; grid-template-columns: 80px minmax(0, 1fr) 236px; } }
@media (max-width: 640px) {
 html[data-face="simple"] #app[data-mode="beginner"] .work { grid-template-columns: 0 minmax(0, 1fr) 0; }
 html[data-face="simple"] #app[data-mode="beginner"] #simple-panel { display: none; position: absolute; z-index: 35; grid-column: 1 / -1; grid-row: 1; left: 0; right: 0; bottom: 58px; height: 40vh; max-height: calc(100% - 58px); border: 1px solid var(--line); border-radius: 12px 12px 0 0; }
 html[data-face="simple"] #app[data-mode="beginner"] #simple-panel.has-selection { display: flex; }
 html[data-face="simple"] #app[data-mode="beginner"] #simple-panel.expanded { height: 80vh; }
 #simple-sheet-handle { display: block; flex: none; min-height: 44px; border: 0; background: transparent; color: var(--ink-2); cursor: pointer; }
 #simple-panel:not(.expanded) .simple-print-footer { display: none; }
}

#simple-rail, .simple-panel { display: none; }
/* Advanced keeps its own tools, with More available for app actions. */
html[data-face="simple"] #app[data-mode="advanced"] #simple-rail { display: flex; position: absolute; z-index: 40; left: 0; bottom: 8px; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-rail button:not(#sr-more) { display: none; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-more:not([hidden]) { display: block; position: absolute; z-index: 41; left: 55px; bottom: 8px; width: min(380px, calc(100% - 55px)); max-height: 70%; overflow: auto; box-sizing: border-box; padding: 14px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; }
@media (max-width: 640px) { html[data-face="simple"] #app[data-mode="advanced"] #simple-more:not([hidden]) { left: 0; bottom: 55px; width: 100%; } }
html[data-face="simple"] #app[data-mode="beginner"] { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; }
html[data-face="simple"] #app[data-mode="beginner"] > .topbar { grid-column: 1; grid-row: 1; }
html[data-face="simple"] #app[data-mode="beginner"] > .work { grid-column: 1; grid-row: 2; }
html[data-face="simple"] #app[data-mode="beginner"] > .status { grid-column: 1; grid-row: 3; }
html[data-face="simple"] #app[data-mode="beginner"] #ribbon { display: none; }
html[data-face="simple"] #app[data-mode="beginner"] #simple-rail { display: flex; grid-column: 1; grid-row: 1; width: 80px; min-height: 0; box-sizing: border-box; flex-direction: column; overflow-y: auto; background: var(--panel); border-right: 1px solid var(--line); }
#simple-rail button, .simple-panel button { font: 600 12px/1.2 var(--f-ui); color: var(--ink); background: transparent; border: 1px solid transparent; border-radius: 7px; cursor: pointer; }
#simple-rail button { flex: 1 0 44px; min-height: 44px; padding: 4px 2px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 3px; }
#simple-rail button svg, .simple-panel button svg { width: 22px; height: 22px; flex: none; }
#simple-rail #sr-more { margin-top: auto; flex-grow: 0; }
#simple-rail button:hover, .simple-panel button:hover { background: var(--accent-soft); color: var(--accent); }
#simple-rail button:disabled, .simple-panel button:disabled, #simple-rail button.dim, .simple-panel button.dim { opacity: .45; }
#simple-rail button:focus-visible, .simple-panel button:focus-visible, #simple-find:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
html[data-face="simple"] #app[data-mode="beginner"] .simple-panel:not([hidden]) { display: block; position: absolute; left: 80px; z-index: 40; width: min(380px, calc(100% - 80px)); box-sizing: border-box; max-height: 100%; overflow: auto; padding: 14px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 0 10px 10px 0; box-shadow: 0 8px 24px #0003; }
#simple-shapes { top: 0; } #simple-more { bottom: 0; }
.simple-panel h2 { font-size: 16px; margin: 0 0 8px; } .simple-panel p { color: var(--ink-2); font-size: 13px; }
.simple-panel h3 { font-size: 12px; color: var(--ink-2); margin: 15px 0 6px; }
.simple-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.simple-panel .simple-grid button { display: flex; align-items: center; text-align: left; gap: 8px; min-height: 44px; padding: 6px; }
.simple-panel [hidden], #simple-rail [hidden] { display: none !important; }
#simple-find { box-sizing: border-box; width: 100%; min-height: 44px; padding: 8px; color: var(--ink); background: var(--panel-2); border: 1px solid var(--line); border-radius: 7px; }
#simple-original { min-height: 44px; margin-top: 12px; color: var(--accent); }
#simple-more:not(.searching) .simple-arrange { display: none; }
@media (max-width: 640px) {
  html[data-face="simple"] #app[data-mode="beginner"] .work { grid-template-rows: minmax(0, 1fr) auto 58px; }
  html[data-face="simple"] #app[data-mode="beginner"] #simple-rail { grid-column: 1 / -1; grid-row: 3; width: 100%; flex-direction: row; overflow: hidden; border-right: 0; border-top: 1px solid var(--line); }
  #simple-rail button { flex: 1 1 0; min-width: 0; font-size: 10px; }
  #simple-rail #sr-more { margin: 0; flex: 1 1 0; }
  #simple-rail :is(#sr-align, #sr-fillet, #sr-measure) { display: none; }
  html[data-face="simple"] #app[data-mode="beginner"] .simple-panel:not([hidden]) { left: 0; right: 0; top: auto; bottom: 58px; width: 100%; max-height: min(70vh, calc(100% - 58px)); border-radius: 10px 10px 0 0; }
  #simple-more:not(.searching) .simple-arrange { display: block; }
}

.faceswitch-row { display: contents; }
.faceswitch { display: inline-flex; flex: none; gap: 2px; padding: 3px; border-radius: 999px; background: #0f151c; }
.faceswitch button { border: 0; border-radius: 999px; background: transparent; color: #aeb9c6; padding: 5px 13px; font: 600 13px/1 var(--f-ui); cursor: pointer; }
.faceswitch button[aria-pressed="true"] { background: #ffd66b; color: #1b1407; }
:root[data-ui="contrast"] .faceswitch button[aria-pressed="true"] { background: var(--accent); color: #000; }
.faceswitch button:focus-visible, #face-more:focus-visible, .try-simple button:focus-visible { outline: 2px solid #ffd66b; outline-offset: 2px; }
.face-more-wrap { display: none; position: relative; }
#btn-theme .lbl, #face-more .lbl { display: none; }
.menu .face-look { display: flex; align-items: center; gap: 6px; padding: 2px 4px 6px 0; border-bottom: 1px solid var(--line-2); margin-bottom: 4px; }
.menu .face-look .menu-head { flex: 1; padding-top: 2px; }
.menu .face-look button { width: auto; padding: 5px 12px; border: 1px solid var(--line); border-radius: 999px; font-weight: 600; }
.menu .face-look button[aria-checked="true"] { background: #ffd66b; border-color: #ffd66b; color: #1b1407; }
.menu .face-look button[aria-checked="true"]::after { content: none; }
:root[data-ui="contrast"] .menu .face-look button[aria-checked="true"] { background: var(--accent); border-color: var(--accent); color: #000; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) :is(#btn-autosave, #btn-chat, #btn-about, #btn-keys, #btn-full, #btn-projects, #mode-chisel, #mode-arch) { display: none; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .face-more-wrap { display: block; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar .brand { display: flex; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar :is(#btn-undo, #btn-redo) { display: inline-flex; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar .menu-wrap:has(#btn-theme) { display: block; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) #menu-theme { position: fixed; right: 12px; top: calc(var(--topbar-h, 46px) + 6px); max-height: calc(100dvh - var(--topbar-h, 46px) - 20px); }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) #btn-export { background: var(--accent-2); color: #fff; border-radius: 6px; padding: 6px 12px; font-weight: 600; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) #btn-export:hover { background: var(--accent); }
html[data-ui="contrast"][data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) #btn-export { background: var(--accent); color: #000; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) #btn-export .face-caret { width: 12px; height: 12px; }
@media (min-width: 761px) {
  html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar :is(#btn-tutorials, #btn-export, #btn-theme, #face-more) .lbl { display: inline; }
}
@media (min-width: 861px) {
  html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar #btn-save .lbl { display: inline; }
}
@media (max-width: 1100px) { .faceswitch button { padding: 4px 9px; font-size: 12px; } }
html:not([data-face="simple"]) .faceswitch button, html[data-face="simple"] #app:is([data-mode="chisel"], [data-mode="arch"]) .faceswitch button { padding: 4px 9px; font-size: 12px; }
@media (min-width: 561px) and (max-width: 1480px) { html:not([data-face="simple"]) .topbar, html[data-face="simple"] #app:is([data-mode="chisel"], [data-mode="arch"]) .topbar { gap: 4px; } }
@media (min-width: 561px) and (max-width: 1100px) { html:not([data-face="simple"]) .faceswitch button { padding: 4px 6px; } }
@media (max-width: 560px) { .faceswitch-row { order: 99; flex-basis: 100%; display: flex; justify-content: center; padding-bottom: 4px; } }
#simple-more .face-phone { display: none; }
html[data-face="simple"] #menu-theme .simple-layout-note { display: block; }
.simple-layout-note { display: none; }
.face-workspace { display: none; }
@media (max-width: 1439px) {
  html:not([data-face="simple"]) #menu-theme .face-workspace { display: block; }
  html:not([data-face="simple"]) .topbar :is(#btn-autosave, #btn-keys) { display: none; }
}
#menu-theme .face-workspace #cz-full { display: none; }
@media (min-width: 871px) and (max-width: 1119px) {
  html:not([data-face="simple"]) .topbar #btn-full { display: none; }
  html:not([data-face="simple"]) #menu-theme .face-workspace #cz-full:not([hidden]) { display: block; }
  html:not([data-face="simple"]) .faceswitch #face-original { display: none; }
  html:not([data-face="simple"]) .faceswitch #face-simple { color: #ffd66b; }
}
/* narrow tablets in Original: the pill takes its own short row, as on phones */
@media (min-width: 561px) and (max-width: 870px) {
  html:not([data-face="simple"]) .faceswitch-row { order: 99; flex-basis: 100%; display: flex; justify-content: center; padding-bottom: 4px; }
  html:not([data-face="simple"]) .faceswitch #face-original { display: inline-block; }
}
html[data-face="simple"] #menu-theme :is([data-layout], .layout-note) { display: none; }
@media (max-width: 640px) {
  #simple-more .face-phone:not([hidden]) { display: flex; }
  html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) :is(#btn-tutorials, .modeswitch) { display: none; }
  html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar :is(.brand, #btn-redo) { display: inline-flex; }
  html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar :is(#btn-theme, #face-more) { min-width: 44px; min-height: 44px; justify-content: center; }
}
.try-simple { position: absolute; left: 14px; top: 14px; z-index: 30; max-width: min(320px, calc(100% - 28px)); padding: 12px 32px 12px 14px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-left: 4px solid #ffd66b; border-radius: 10px; box-shadow: 0 10px 30px rgba(20,30,45,.18); font: 13px/1.45 var(--f-ui); }
.try-simple p { margin: 0 0 10px; }
@media (max-width: 560px) {
  .try-simple { left: 8px; top: 8px; max-width: calc(100% - 120px); padding: 7px 26px 7px 10px; font-size: 12px; }
  .try-simple p { margin: 0 0 6px; }
  .try-simple button { padding: 5px 9px; font-size: 12px; }
}
.try-simple button { font: 600 13px/1 var(--f-ui); cursor: pointer; border: 0; border-radius: 6px; padding: 7px 10px; }
.try-simple .ts-yes { background: #ffd66b; color: #1b1407; }
.try-simple .ts-no { background: transparent; color: var(--ink); }
.try-simple .ts-x { position: absolute; top: 5px; right: 5px; padding: 4px 7px; background: transparent; color: var(--ink-2); font-size: 18px; }
`;

export function initSimpleMode(app) {
  if (!document.getElementById("simplemode-css")) {
    const style = document.createElement("style");
    style.id = "simplemode-css"; style.textContent = CSS; document.head.append(style);
  }
  const $ = (id) => document.getElementById(id);
  const plate = initPlate(app);
  const collapse = initCollapse(app, plate);
  const row = document.createElement("div");
  row.className = "faceswitch-row";
  row.innerHTML = `<div class="faceswitch" role="group" aria-label="App look"><button id="face-simple" aria-pressed="false" title="Simple: big tools on the left, your shape and a print check on the right; every other tool under More">Simple</button><button id="face-original" aria-pressed="true" title="Original: JumpStart 3D as J.Siwek ships it, every button on the bar">Original</button></div>`;
  document.querySelector("header.topbar .modeswitch").before(row);
  const wrap = document.createElement("div"); wrap.className = "face-more-wrap";
  wrap.innerHTML = '<button class="tb-btn" id="face-more" title="About this build" aria-label="About this build"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg><span class="lbl">About</span></button>';
  $("btn-export").closest(".menu-wrap").before(wrap);
  const themeWrap = $("btn-theme").closest(".menu-wrap"), themePlace = document.createComment("Customize position"); themeWrap.before(themePlace);
  const themeLabel = document.createElement("span"); themeLabel.className = "lbl"; themeLabel.textContent = "Customize"; $("btn-theme").append(themeLabel);
  $("menu-theme").querySelector(".menu-head").insertAdjacentHTML("afterend", `<div class="face-look" role="group" aria-label="Look"><span class="menu-head">Look</span><button id="face-menu-simple" role="menuitemradio" aria-checked="false">Simple</button><button id="face-menu-original" role="menuitemradio" aria-checked="false">Original</button></div>`);
  // Original below 1440 px: the Simple | Original pill takes the room of Autosave and Keyboard shortcuts, which move into Customize
  const workspace = document.createElement("div"); workspace.className = "face-workspace";
  workspace.innerHTML = '<div class="menu-head">Workspace</div><button role="menuitem" id="cz-autosave" data-for="btn-autosave"></button><button role="menuitem" id="cz-keys" data-for="btn-keys">Keyboard shortcuts</button><button role="menuitem" id="cz-full" data-for="btn-full">Full screen</button><hr>';
  $("menu-theme").querySelector(".face-look").after(workspace);
  workspace.addEventListener("click", (e) => { const b = e.target.closest("[data-for]"); if (b) { $("menu-theme").hidden = true; $(b.dataset.for).click(); } });
  $("btn-theme").addEventListener("click", () => { $("cz-autosave").textContent = $("btn-autosave").textContent; $("cz-full").hidden = $("btn-full").hidden; });
  const layoutNote = $("menu-theme").querySelector('[data-layout="tablet"]').nextElementSibling; layoutNote.classList.add("layout-note");
  const simpleNote = document.createElement("div"); simpleNote.className = "menu-note simple-layout-note"; simpleNote.textContent = "Layouts change Original's tool bars. Simple has its own."; layoutNote.after(simpleNote);
  $("face-more").onclick = () => showSimpleAbout(app, $("face-more"));
  for (const name of ["simple", "original"]) $("face-menu-" + name).addEventListener("click", () => { $("menu-theme").hidden = true; setFace(name); });
  const labels = [[document.querySelector("#btn-tutorials .lbl"), "Learn"], [document.querySelector("#btn-export .lbl"), "Print / Export"]].map(([el, simple]) => ({ el, simple, original: el.textContent }));
  const caret = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  caret.setAttribute("class", "face-caret"); caret.setAttribute("viewBox", "0 0 24 24"); caret.setAttribute("fill", "none"); caret.setAttribute("stroke", "currentColor"); caret.setAttribute("stroke-width", "2"); caret.setAttribute("aria-hidden", "true");
  caret.innerHTML = '<path d="m6 9 6 6 6-6"/>';
  // Enter and Space press our buttons; the app's own key handler must not also see them (it submits an open tool)
  for (const el of [row, wrap]) el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); });
  let stored = null;
  try { stored = localStorage.getItem("jumpstart.face"); } catch (e) { /* storage may be unavailable */ }
  const url = new URL(location.href), hasParam = url.searchParams.has("face"), param = url.searchParams.get("face");
  let face;
  let card = null, lessonInOriginal = false;
  function apply(name) {
    face = name; document.documentElement.dataset.face = face; if (name === "simple") $("btn-tutorials").after(themeWrap); else themePlace.after(themeWrap); collapse.activate(face === "simple"); plate.layout(); plate.schedule();
    for (const name of ["simple", "original"]) { $("face-" + name).setAttribute("aria-pressed", face === name); $("face-menu-" + name).setAttribute("aria-checked", face === name); }
    for (const label of labels) label.el.textContent = face === "simple" ? label.simple : label.original;
    if (face === "simple") $("btn-export").append(caret); else caret.remove();
  }
  // lesson: a temporary switch for a lesson, not stored, so a reload mid-lesson still opens in the stored look
  function setFace(name, quiet, lesson) {
    if (name !== "simple" && name !== "original") return;
    apply(name);
    if (!lesson) { lessonInOriginal = false; try { localStorage.setItem("jumpstart.face", face); } catch (e) { /* storage may be unavailable */ } }
    plate.close(); if (card) { card.remove(); card = null; }
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    if (!quiet) app.toast(face === "simple" ? "Simple: the main tools on the left, your shape on the right. Everything else is under More. Switch back any time." : "Original: JumpStart 3D's full top bar, every button where J.Siwek put it.");
  }
  Object.defineProperty(app, "face", { get: () => face });
  app.setFace = setFace;
  row.addEventListener("click", (e) => { const button = e.target.closest("button"); if (button) setFace(button.id === "face-simple" ? "simple" : "original"); });
  if (param === "simple" || param === "original") {
    setFace(param, true); url.searchParams.delete("face"); history.replaceState(history.state, "", url.href);
  } else apply(stored === "original" ? "original" : "simple");
  app.trySimpleShown = stored === null && !hasParam;
  if (app.trySimpleShown) {
    card = document.createElement("aside"); card.className = "try-simple"; card.id = "try-simple"; card.setAttribute("role", "region"); card.setAttribute("aria-label", "Choose app look");
    card.innerHTML = '<p><b>Prefer the full toolbar?</b> You\'re in Simple: big tools on the left, your shape on the right.</p><div><button id="face-card-original" class="ts-yes">Switch to Original</button><button id="face-card-keep" class="ts-no">Keep Simple</button></div><button id="try-simple-close" class="ts-x" aria-label="Close">×</button>';
    card.addEventListener("click", (e) => {
      if (e.target.id === "face-card-original") setFace("original"); else if (e.target.id === "face-card-keep" || e.target.id === "try-simple-close") setFace("simple", true); else return;
      [$("face-simple"), $("face-original"), $("btn-theme"), $("btn-export")].find((b) => b.getClientRects().length)?.focus(); // Return focus to a visible top-bar control.
    });
    $("viewport").append(card);
  }
  // A lesson whose steps point at top-bar buttons that Simple moved into More runs in Original, and Simple comes back when it ends (tutorials.js calls these)
  const MOVED = ["btn-autosave", "btn-chat", "btn-about", "btn-keys", "btn-full", "btn-projects", "mode-chisel", "mode-arch"], MOVED_NARROW = ["btn-tutorials", "mode-beginner", "mode-advanced"];
  const narrow = matchMedia("(max-width: 640px)");
  const moved = (q) => (narrow.matches ? [...MOVED, ...MOVED_NARROW] : MOVED).some((id) => new RegExp("#" + id + "(?![\\w-])").test(q));
  const needsOriginal = (tut) => tut.steps.some((st) => { const parts = ((st.show && st.show.sel) || "").split(",").map((q) => q.trim()).filter(Boolean); return parts.length && parts.every(moved); });
  app.onLessonStart = (tut) => {
    if (face !== "simple" || !needsOriginal(tut)) return;
    setFace("original", true, true); lessonInOriginal = true;
    app.toast("This lesson uses buttons from the full top bar, so it runs in Original. Simple comes back when the lesson ends.");
  };
  app.onLessonEnd = () => { if (lessonInOriginal) setFace("simple", true); };
  app.simple = { ...plate, ...collapse, set: app.setFace, get face() { return face; } };
  return app.simple;
}
