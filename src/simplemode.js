import { ICON } from "./icons.js";

const TOOLS = {
  sketch: ["Sketch", "sketch"], import: ["Import", "import"], hole: ["Hole", "holeToggle"], group: ["Group", "group"], align: ["Align", "align"], fillet: ["Round edges", "fillet", "Fillet"], measure: ["Measure", "measure"],
  sketch3d: ["3D Sketch", "spline"], extrude: ["Extrude", "extrude"], facebox: ["Box on face", "rect"], pattern: ["Pattern", "pattern"], mirror: ["Mirror", "mirror"], shell: ["Hollow", "shell", "Shell"],
  dup: ["Duplicate", "duplicate"], del: ["Delete", "del"], copy: ["Copy", "copy"], paste: ["Paste", "paste"], ungroup: ["Ungroup", "ungroup"], solid: ["Solid", "box"], lock: ["Lock", "lock"], multi: ["Multi-select", "select"],
  drop: ["Lay flat", "drop", "Drop"], printsim: ["Print check", "printsim", "3D Print Sim"], texture: ["Texture", "texture"], facepat: ["Face pattern", "facePattern"], fillopen: ["Fill openings", "fillOpen"],
  fastener: ["Fasteners", "thread"], gear: ["Gear", "gear"], nameplate: ["Name plate", "tag"], knurl: ["Knurled knob", "knurl"], spring: ["Coil spring", "spring"], hinge: ["Hinge", "hinge"], bins: ["Box Maker", "box"], neon: ["Neon Sign", "neon"], cosforge: ["CosForge", "cosforge"]
};
const PARTS = ["fastener", "gear", "nameplate", "knurl", "spring", "hinge"];
const MAKERS = ["bins", "neon", "cosforge"];

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
      if (b.dataset.for === "bb-multi") b.setAttribute("aria-pressed", original.getAttribute("aria-pressed"));
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
  rail.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }); // the app's own key handler must not also see them (it submits an open tool)
  rail.addEventListener("click", activate);shapes.addEventListener("click", activate); more.addEventListener("click", activate);
  footer.onclick = () => app.setFace("original"); find.addEventListener("input", filter);
  work.addEventListener("keydown", (e) => {
    const panel = !more.hidden ? more : !shapes.hidden ? shapes : null; if (!panel) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === "Tab") { setTimeout(() => { if (!panel.contains(document.activeElement) && document.activeElement !== (panel === more ? moreButton : shapeButton)) close(); }, 0); return; }
    if (e.key === "/" && panel === more && e.target !== find) { e.preventDefault(); find.focus(); return; }
    const buttons = [...panel.querySelectorAll("button")].filter((b) => b.getClientRects().length && !b.disabled);
    if (e.key === "Enter" && e.target === find) { e.preventDefault(); e.stopPropagation(); buttons.find((b) => b.dataset.for)?.click(); return; }
    if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); const i = buttons.indexOf(document.activeElement), step = ["ArrowDown", "ArrowRight"].includes(e.key) ? 1 : -1; buttons[(i + step + buttons.length) % buttons.length]?.focus(); }
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  });
  window.addEventListener("pointerdown", (e) => { if (!rail.contains(e.target) && !shapes.contains(e.target) && !more.contains(e.target)) close(); });
  function proxyFor(id) {
    const proxies = [...work.querySelectorAll('button[data-for]')].filter((b) => b.dataset.for === id);
    const visible = proxies.find((b) => b.getClientRects().length); if (visible) return visible;
    if (!moreButton.getClientRects().length) return null;
    return proxies.some((b) => b.closest("#simple-more")) ? moreButton : proxies.some((b) => b.closest("#simple-shapes")) ? shapeButton : null;
  }
  sync(); return { sync, proxyFor, close };
}

// jumpstart-3d: Simple | Original switch, its More menu and the first-visit card.
let hadPrefs = false;
try { hadPrefs = localStorage.getItem("workplane.ui.v1") !== null; } catch (e) { /* storage may be unavailable */ }

const CSS = `
#simple-rail, .simple-panel { display: none; }
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
.faceswitch button:focus-visible, #face-more:focus-visible, #menu-face-more button:focus-visible, .try-simple button:focus-visible { outline: 2px solid #ffd66b; outline-offset: 2px; }
.face-more-wrap { display: none; position: relative; }
.menu .face-look { display: flex; align-items: center; gap: 6px; padding: 2px 4px 6px 0; border-bottom: 1px solid var(--line-2); margin-bottom: 4px; }
.menu .face-look .menu-head { flex: 1; padding-top: 2px; }
.menu .face-look button { width: auto; padding: 5px 12px; border: 1px solid var(--line); border-radius: 999px; font-weight: 600; }
.menu .face-look button[aria-checked="true"] { background: #ffd66b; border-color: #ffd66b; color: #1b1407; }
.menu .face-look button[aria-checked="true"]::after { content: none; }
:root[data-ui="contrast"] .menu .face-look button[aria-checked="true"] { background: var(--accent); border-color: var(--accent); color: #000; }
#menu-face-more { min-width: 250px; max-width: calc(100vw - 24px); }
#menu-face-more .face-phone, #menu-face-more [hidden] { display: none; }
html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) :is(#btn-autosave, #btn-theme, #btn-chat, #btn-about, #btn-keys, #btn-full, #btn-projects, #mode-chisel, #mode-arch) { display: none; }
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
  html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar :is(#btn-tutorials, #btn-export) .lbl { display: inline; }
}
@media (min-width: 861px) {
  html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar #btn-save .lbl { display: inline; }
}
@media (max-width: 1100px) { .faceswitch button { padding: 4px 9px; font-size: 12px; } }
/* The full (Original) top bar has no room for the switch between phone and 1440 px wide: Settings › Look has it there. From 1440 px the Simple half fits, both halves from 2000 px */
@media (min-width: 561px) and (max-width: 1439px) { html:not([data-face="simple"]) .faceswitch-row, html[data-face="simple"] #app:is([data-mode="chisel"], [data-mode="arch"]) .faceswitch-row { display: none; } }
@media (min-width: 1440px) and (max-width: 1999px) {
  html:not([data-face="simple"]) .faceswitch button[aria-pressed="true"], html[data-face="simple"] #app:is([data-mode="chisel"], [data-mode="arch"]) .faceswitch button[aria-pressed="true"] { display: none; }
  html:not([data-face="simple"]) .faceswitch, html[data-face="simple"] #app:is([data-mode="chisel"], [data-mode="arch"]) .faceswitch { padding: 2px; }
  html:not([data-face="simple"]) .faceswitch button, html[data-face="simple"] #app:is([data-mode="chisel"], [data-mode="arch"]) .faceswitch button { padding: 4px 9px; font-size: 12px; color: #ffd66b; }
  html:not([data-face="simple"]) .topbar, html[data-face="simple"] #app:is([data-mode="chisel"], [data-mode="arch"]) .topbar { gap: 8px; }
}
@media (max-width: 560px) {
  .faceswitch-row { order: 99; flex-basis: 100%; display: flex; justify-content: center; padding-bottom: 4px; }
  /* a phone in Original keeps all of J.Siwek's view: Simple is offered in the Open/Export menu instead */
  html:not([data-face="simple"]) .faceswitch-row, html[data-face="simple"] #app:is([data-mode="chisel"], [data-mode="arch"]) .faceswitch-row { display: none; }
  html:not([data-face="simple"]) #menu-export #face-menu-export { display: flex; }
}
#menu-export #face-menu-export { display: none; }
/* Simple below 640 px: Learn and Beginner / Advanced move into More */
@media (max-width: 640px) {
  #menu-face-more button.face-phone { display: flex; }
  #menu-face-more hr.face-phone { display: block; }
  html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) :is(#btn-tutorials, .modeswitch) { display: none; }
  html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar :is(.brand, #btn-redo) { display: inline-flex; }
}
.try-simple { position: absolute; left: 14px; top: 14px; z-index: 30; max-width: min(320px, calc(100% - 28px)); padding: 12px 32px 12px 14px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-left: 4px solid #ffd66b; border-radius: 10px; box-shadow: 0 10px 30px rgba(20,30,45,.18); font: 13px/1.45 var(--f-ui); }
.try-simple p { margin: 0 0 10px; }
@media (max-width: 560px) {
  .try-simple { left: 8px; top: 8px; max-width: calc(100% - 120px); padding: 7px 26px 7px 10px; font-size: 12px; }
  .try-simple p { margin: 0 0 6px; }
  .try-simple .ts-more, .try-simple .ts-no { display: none; }
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
  const row = document.createElement("div");
  row.className = "faceswitch-row";
  row.innerHTML = `<div class="faceswitch" role="group" aria-label="App look"><button id="face-simple" aria-pressed="false" title="Simple: fewer buttons in the top bar; the rest is under ⋯ More">Simple</button><button id="face-original" aria-pressed="true" title="Original: JumpStart 3D as J.Siwek ships it, every button on the bar">Original</button></div>`;
  document.querySelector("header.topbar .modeswitch").before(row);
  const wrap = document.createElement("div");
  wrap.className = "face-more-wrap";
  wrap.innerHTML = `<button class="tb-btn" id="face-more" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-face-more" title="More: designs, AI, settings, other studios" aria-label="More"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button><div class="menu" id="menu-face-more" role="menu" aria-label="More" hidden>
    <button class="face-phone" role="menuitem" data-for="btn-tutorials">Learn</button><button class="face-phone" role="menuitem" data-for="mode-beginner">Beginner</button><button class="face-phone" role="menuitem" data-for="mode-advanced">Advanced</button><hr class="face-phone">
    <button role="menuitem" data-for="btn-projects">Designs <small>your saved designs</small></button><button role="menuitem" data-for="btn-autosave">Autosave</button><button role="menuitem" data-for="btn-chat">AI chat</button><button role="menuitem" data-for="btn-theme">Settings: theme, layout, printer…</button><button role="menuitem" data-for="btn-keys">Keyboard shortcuts</button><button role="menuitem" data-for="btn-full">Full screen</button><button role="menuitem" data-for="btn-about">About JumpStart 3D</button><hr><div class="menu-head">Other studios</div><button role="menuitem" data-for="mode-chisel">Chisel <small>sculpt like clay</small></button><button role="menuitem" data-for="mode-arch">Architect <small>floor plans and buildings</small></button></div>`;
  $("btn-export").closest(".menu-wrap").before(wrap);
  // Look: Simple or Original, also in the Settings menu, for a full top bar with no room for the switch
  $("menu-theme").insertAdjacentHTML("afterbegin", `<div class="face-look" role="group" aria-label="Look"><span class="menu-head">Look</span><button id="face-menu-simple" role="menuitemradio" aria-checked="false" title="Simple: fewer buttons in the top bar; the rest is under ⋯ More">Simple</button><button id="face-menu-original" role="menuitemradio" aria-checked="false" title="Original: every button on the bar">Original</button></div>`);
  $("btn-tutorials-menu").nextElementSibling.after(Object.assign(document.createElement("button"), { id: "face-menu-export", innerHTML: "Try Simple <small>fewer, bigger buttons</small>", title: "Simple: fewer buttons in the top bar; the rest is under ⋯ More", onclick: () => { $("menu-export").hidden = true; setFace("simple"); } }));
  for (const name of ["simple", "original"]) $("face-menu-" + name).addEventListener("click", () => { $("menu-theme").hidden = true; setFace(name); });
  const more = $("face-more"), menu = $("menu-face-more");
  const labels = [[document.querySelector("#btn-tutorials .lbl"), "Learn"], [document.querySelector("#btn-export .lbl"), "Print / Export"]].map(([el, simple]) => ({ el, simple, original: el.textContent }));
  const caret = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  caret.setAttribute("class", "face-caret"); caret.setAttribute("viewBox", "0 0 24 24"); caret.setAttribute("fill", "none"); caret.setAttribute("stroke", "currentColor"); caret.setAttribute("stroke-width", "2"); caret.setAttribute("aria-hidden", "true");
  caret.innerHTML = '<path d="m6 9 6 6 6-6"/>';
  const close = () => { menu.hidden = true; more.setAttribute("aria-expanded", "false"); };
  const items = () => [...menu.querySelectorAll('button[role="menuitem"]')].filter((b) => b.getClientRects().length);
  function open() {
    menu.querySelector('[data-for="btn-autosave"]').textContent = $("btn-autosave").textContent;
    menu.querySelector('[data-for="btn-full"]').hidden = $("btn-full").hidden;
    menu.hidden = false; more.setAttribute("aria-expanded", "true");
  }
  more.addEventListener("click", (e) => { if (menu.hidden) { open(); if (e.detail === 0) items()[0]?.focus(); } else close(); });
  menu.addEventListener("click", (e) => { const item = e.target.closest("button[data-for]"); if (item) { close(); $(item.dataset.for).click(); } });
  more.addEventListener("keydown", (e) => {
    if (menu.hidden) return;
    if (e.key === "Tab") close();
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); more.focus(); }
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); more.focus(); return; }
    if (e.key === "Tab") { close(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation(); const all = items(), at = all.indexOf(document.activeElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;
    all[next]?.focus();
  });
  window.addEventListener("pointerdown", (e) => { if (!wrap.contains(e.target)) close(); });
  // Enter and Space press our buttons; the app's own key handler must not also see them (it submits an open tool)
  for (const el of [row, wrap]) el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); });
  let stored = null;
  try { stored = localStorage.getItem("jumpstart.face"); } catch (e) { /* storage may be unavailable */ }
  const url = new URL(location.href), hasParam = url.searchParams.has("face"), param = url.searchParams.get("face");
  let face;
  let card = null, lessonInOriginal = false;
  function apply(name) {
    face = name; document.documentElement.dataset.face = face;
    for (const name of ["simple", "original"]) { $("face-" + name).setAttribute("aria-pressed", face === name); $("face-menu-" + name).setAttribute("aria-checked", face === name); }
    for (const label of labels) label.el.textContent = face === "simple" ? label.simple : label.original;
    if (face === "simple") $("btn-export").append(caret); else caret.remove();
  }
  // lesson: a temporary switch for a lesson, not stored, so a reload mid-lesson still opens in the stored look
  function setFace(name, quiet, lesson) {
    if (name !== "simple" && name !== "original") return;
    apply(name);
    if (!lesson) { lessonInOriginal = false; try { localStorage.setItem("jumpstart.face", face); } catch (e) { /* storage may be unavailable */ } }
    close(); plate.close(); if (card) { card.remove(); card = null; }
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    if (!quiet) app.toast(face === "simple" ? "Simple: a calmer top bar. Designs, AI, settings, Chisel and Architect are under ⋯ More. Switch back any time." : "Original: JumpStart 3D's full top bar, every button where J.Siwek put it.");
  }
  Object.defineProperty(app, "face", { get: () => face });
  app.setFace = setFace;
  row.addEventListener("click", (e) => { const button = e.target.closest("button"); if (button) setFace(button.id === "face-simple" ? "simple" : "original"); });
  if (param === "simple" || param === "original") {
    setFace(param, true); url.searchParams.delete("face"); history.replaceState(history.state, "", url.href);
  } else apply(stored === "simple" ? "simple" : "original");
  app.trySimpleShown = stored === null && !hadPrefs && !hasParam;
  if (app.trySimpleShown) {
    card = document.createElement("aside"); card.className = "try-simple"; card.id = "try-simple"; card.setAttribute("role", "region"); card.setAttribute("aria-label", "Try Simple");
    card.innerHTML = '<p><b>New here?</b> Try <b>Simple</b>: fewer, bigger buttons.<span class="ts-more"> You can switch back any time.</span></p><div><button id="try-simple-yes" class="ts-yes">Try Simple</button><button id="try-simple-no" class="ts-no">Not now</button></div><button id="try-simple-close" class="ts-x" aria-label="Close">×</button>';
    card.addEventListener("click", (e) => {
      if (e.target.id === "try-simple-yes") setFace("simple"); else if (e.target.id === "try-simple-no" || e.target.id === "try-simple-close") setFace("original", true); else return;
      [$("face-simple"), $("face-original"), $("btn-theme"), $("btn-export")].find((b) => b.getClientRects().length)?.focus(); // the card is gone: focus goes to the switch (or Settings, which has Look, or Open/Export on a phone), not to the page
    });
    $("viewport").append(card);
  }
  // A lesson whose steps point at top-bar buttons that Simple moved into More runs in Original, and Simple comes back when it ends (tutorials.js calls these)
  const MOVED = ["btn-autosave", "btn-theme", "btn-chat", "btn-about", "btn-keys", "btn-full", "btn-projects", "mode-chisel", "mode-arch"], MOVED_NARROW = ["btn-tutorials", "mode-beginner", "mode-advanced"];
  const narrow = matchMedia("(max-width: 640px)");
  const moved = (q) => (narrow.matches ? [...MOVED, ...MOVED_NARROW] : MOVED).some((id) => new RegExp("#" + id + "(?![\\w-])").test(q));
  const needsOriginal = (tut) => tut.steps.some((st) => { const parts = ((st.show && st.show.sel) || "").split(",").map((q) => q.trim()).filter(Boolean); return parts.length && parts.every(moved); });
  app.onLessonStart = (tut) => {
    if (face !== "simple" || !needsOriginal(tut)) return;
    setFace("original", true, true); lessonInOriginal = true;
    app.toast("This lesson uses buttons from the full top bar, so it runs in Original. Simple comes back when the lesson ends.");
  };
  app.onLessonEnd = () => { if (lessonInOriginal) setFace("simple", true); };
  app.simple = { ...plate, set: app.setFace, get face() { return face; } };
  return app.simple;
}
