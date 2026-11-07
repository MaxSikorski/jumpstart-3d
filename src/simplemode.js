// jumpstart-3d: Simple | Original switch, its More menu and the first-visit card.
let hadPrefs = false;
try { hadPrefs = localStorage.getItem("workplane.ui.v1") !== null; } catch (e) { /* storage may be unavailable */ }

const CSS = `
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
    close(); if (card) { card.remove(); card = null; }
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
  return { set: app.setFace, get face() { return face; } };
}
