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
 :root .topbar :is(#btn-save, #btn-undo, #btn-redo) { min-width: 44px; min-height: 44px; justify-content: center; }
 :root .viewport { --cube: 96px; }
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
 :root .navbtns { gap: 2px; top: calc(40px + var(--cube) + 42px); }
 :root .navbtns button { min-width: 44px; min-height: 44px; }
 :root :is(#unit-toggle, #snap-toggle, #snap-more, .status select) { min-height: 44px; }
 :root .status .busy-btn { min-height: 44px; min-width: 44px; height: auto; }
 :root .status { height: auto; min-height: 28px; }
}
@media (pointer: coarse) and (max-width: 860px) { :root .viewport { --cube: 72px; } }
`;

export function initPhoneFit() {
  if (document.getElementById("phonefit-css")) return;
  const style = document.createElement("style");
  style.id = "phonefit-css"; style.textContent = CSS; document.head.append(style);
  const menus = [...document.querySelectorAll(MENUS)];
  const update = (menu) => menu.classList.toggle("more-below", menu.scrollHeight - menu.clientHeight - menu.scrollTop > 2);
  const refresh = () => requestAnimationFrame(() => menus.filter((menu) => menu.getClientRects().length).forEach(update));
  const observer = new ResizeObserver((entries) => entries.forEach(({ target }) => update(target)));
  menus.forEach((menu) => observer.observe(menu));
  document.addEventListener("scroll", (event) => { if (event.target.matches?.(MENUS)) update(event.target); }, true);
  document.addEventListener("input", refresh, true);
  window.addEventListener("resize", refresh);
  refresh();
}
