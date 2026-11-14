// Phones and touch screens: long menus scroll inside the window with a fade while more is below, and Save, Undo, Redo,
// the view buttons, the view-cube arrows and the status-bar controls are 44 px targets (the cube arrows sit around the
// cube without overlapping, inside the window).
const MENUS = "#menu-export, #menu-theme, #simple-more";
const CSS = `
:is(#menu-export, #menu-theme, #simple-more).more-below::after { content: ""; display: block; position: sticky; bottom: -5px; height: 40px; margin-top: -40px; pointer-events: none; background: linear-gradient(to bottom, color-mix(in srgb, var(--panel) 0%, transparent), var(--panel)); }
#simple-more.more-below::after { bottom: -14px; }
:root #menu-theme { max-height: calc(100vh - 46px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 20px); max-height: calc(100dvh - 46px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 20px); }
/* J.Siwek's stylesheet sits in <body>, after this one: every rule starts with :root so it wins by specificity, not by order */
@media (pointer: coarse) {
 :root .topbar :is(#btn-save, #btn-undo, #btn-redo) { min-height: 44px; justify-content: center; }
 /* 44 px wide as well in Simple; Original's phone bar has no room for that (Export would wrap onto a new row) */
 html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) .topbar :is(#btn-save, #btn-undo, #btn-redo) { min-width: 44px; }
 :root .viewport { --cube: 96px; --nav-top: calc(40px + var(--cube) + 42px); }
 :root :is(.viewcube, .cube-arrows) { top: 40px; right: 40px; }
 :root :is(.cube-arrow, .cube-roll) { width: 44px; height: 44px; box-sizing: border-box; }
 :root .cube-arrow { font-size: 13px; line-height: 44px; }
 :root .cube-roll { padding: 9px; }
 :root .cube-arrow.l { left: -36px; top: calc((var(--cube) - 44px) / 2) !important; }
 :root .cube-arrow.r { right: -36px; top: calc((var(--cube) - 44px) / 2) !important; }
 :root .cube-arrow.u { top: -36px; left: calc((var(--cube) - 44px) / 2) !important; }
 :root .cube-arrow.d { bottom: -36px; left: calc((var(--cube) - 44px) / 2) !important; }
 :root .cube-roll.ccw { left: -36px; top: -36px; }
 :root .cube-roll.cw { right: -36px; top: -36px; }
 /* the view buttons fill a column under the cube; on a short screen they wrap into a second column to the left instead of running under the bottom edge */
 :root .navbtns { display: grid; grid-auto-flow: column; grid-template-rows: repeat(auto-fill, 44px); gap: 2px; direction: rtl; top: var(--nav-top); max-height: calc(100% - var(--nav-top) - 8px); }
 :root .navbtns > * { direction: ltr; }
 :root .navbtns button { min-width: 44px; min-height: 44px; }
}
/* status-bar controls are 44 px on a touch tablet (its bar is already 56 px tall) and in Simple on a phone, where the bar grows to fit them;
   Original keeps its compact 28 px phone bar, like its top bar (Architect's panels are laid out against it) */
@media (pointer: coarse) and (min-width: 601px) {
 :root .status :is(#unit-toggle, #snap-toggle, #snap-more, select, .busy-btn) { min-height: 44px; }
 :root .status .busy-btn { min-width: 44px; height: auto; }
}
@media (pointer: coarse) and (max-width: 600px) {
 html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) > .status { height: auto; min-height: 28px; }
 html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) > .status :is(#unit-toggle, #snap-toggle, #snap-more, select, .busy-btn) { min-height: 44px; }
 html[data-face="simple"] #app:is([data-mode="beginner"], [data-mode="advanced"]) > .status .busy-btn { min-width: 44px; height: auto; }
}
@media (pointer: coarse) and (max-width: 860px) { :root .viewport { --cube: 72px; } }
/* a phone's small lesson panel (left: 8 px) stops short of the cube and its arrows: 40 + 72 + 36 px from the right edge, plus gaps */
@media (pointer: coarse) and (max-width: 699px) { :root .tut-panel.mini { width: calc(100vw - 170px); } }
/* Simple on a touch tablet: the view sits between the 80 px rail and the shape panel, the lesson panel starts 10 px into it */
@media (pointer: coarse) and (min-width: 641px) and (max-width: 860px) { html[data-face="simple"]:has(#app[data-mode="beginner"]) .tut-panel.mini { max-width: calc(100vw - 236px - 90px - 148px - 8px); } }
@media (pointer: coarse) and (min-width: 861px) and (max-width: 1100px) { html[data-face="simple"]:has(#app[data-mode="beginner"]) .tut-panel.mini { max-width: calc(100vw - 236px - 90px - 172px - 8px); } }
/* Simple on a phone: keep them clear of the collapsed shape sheet at the foot of the view */
@media (pointer: coarse) and (max-width: 640px) { html[data-face="simple"] .work:has(> #simple-panel.has-selection:not(.expanded)) .navbtns { max-height: calc(100% - var(--nav-top) - 64px); } }
`;

export function initPhoneFit() {
  if (document.getElementById("phonefit-css")) return;
  const style = document.createElement("style");
  style.id = "phonefit-css"; style.textContent = CSS; document.head.append(style);
  const menus = [...document.querySelectorAll(MENUS)];
  const probe = document.createElement("div");
  probe.style.cssText = "position: fixed; visibility: hidden; pointer-events: none; padding-bottom: env(safe-area-inset-bottom, 0px)";
  document.body.append(probe);
  const update = (menu) => menu.classList.toggle("more-below", menu.scrollHeight - menu.clientHeight - menu.scrollTop > 2);
  const phone = matchMedia("(max-width: 640px)");
  const visibleBottom = () => (window.visualViewport ? visualViewport.height + visualViewport.offsetTop : innerHeight);
  const cap = (menu) => {
    if (!menu.getClientRects().length) return;
    if (menu.id === "simple-more") {
      if (!phone.matches) { update(menu); return; } // wider, Simple places it beside the rail with its own inline sizes
      // on a phone it is anchored at its foot above the tool strip: when a keyboard covers that foot (typing in Find a tool), lift it above the keyboard
      menu.style.bottom = ""; menu.style.maxHeight = "";
      const r = menu.getBoundingClientRect(), bottom = visibleBottom() - 4;
      if (r.bottom > bottom + 0.5) {
        const top = menu.offsetParent ? menu.offsetParent.getBoundingClientRect().top : 0;
        menu.style.bottom = `${parseFloat(getComputedStyle(menu).bottom) + r.bottom - bottom}px`;
        menu.style.maxHeight = `${Math.max(0, Math.floor(bottom - top - 8))}px`;
      }
    } else if (menu.matches("#menu-export, #menu-theme")) {
      const css = getComputedStyle(menu), inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
      const bottom = visibleBottom();
      const extra = [css.paddingTop, css.paddingBottom, css.borderTopWidth, css.borderBottomWidth].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
      menu.style.maxHeight = `${Math.max(0, Math.floor(bottom - menu.getBoundingClientRect().top - inset - 8 - extra))}px`;
    }
    update(menu);
  };
  const refresh = () => requestAnimationFrame(() => menus.forEach(cap));
  // the top bar is watched too: when it wraps or unwraps, a menu below it moves without changing size
  const observer = new ResizeObserver((entries) => requestAnimationFrame(() => entries.forEach(({ target }) => (target.matches(MENUS) ? cap(target) : menus.forEach(cap)))));
  menus.forEach((menu) => observer.observe(menu));
  // a menu that opens is capped at once: its last cap may be from another window size or bar layout
  const opened = new MutationObserver((records) => records.forEach(({ target }) => cap(target)));
  menus.forEach((menu) => opened.observe(menu, { attributes: true, attributeFilter: ["hidden"] }));
  const topbar = document.querySelector(".topbar"); if (topbar) observer.observe(topbar);
  document.addEventListener("scroll", (event) => { if (event.target.matches?.(MENUS)) update(event.target); }, true);
  document.addEventListener("input", refresh, true);
  window.addEventListener("resize", refresh);
  window.visualViewport?.addEventListener("resize", refresh);
  refresh();
}
