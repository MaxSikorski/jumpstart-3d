// Escape and the dialog in front (Grok review, 2026-11-13): while a dialog or menu is open, Escape closes the one in front and nothing else.
// Each dialog listens for Escape on itself, so an Escape pressed while the focus was outside it (after a click on its text, say) went to the
// app's key handler, which ignores keys while a dialog is open: the dialog stayed. An open menu let Escape through to the design (it cleared the selection).
// Full-window studios (3D Sketch, Lathe, Chip Carving, Voxel, Bricks, CAM, Stained Glass, CosForge) are not layers here: they keep their own Escape, which closes their own dialogs first.
const MENUS = [["menu-theme", "btn-theme"], ["menu-export", "btn-export"], ["snap-menu", "snap-more"]]; // menu, the button that opens it
const PANELS = ["simple-more", "simple-shapes"]; // Simple's tool panels: they close themselves on an Escape from inside
const shown = (node) => !!node && node.isConnected && !node.hidden && node.getClientRects().length > 0;

// the dialog in front (the last open backdrop: a newer dialog opens over an older one), else an open menu or Simple panel
function frontLayer() {
  const dialogs = [...document.querySelectorAll(".modal-back")].filter(shown);
  if (dialogs.length) return dialogs[dialogs.length - 1];
  const open = [...MENUS.map(([menu]) => menu), ...PANELS].map((id) => document.getElementById(id)).filter(shown);
  return open.find((node) => node.contains(document.activeElement)) || open[0] || null;
}
// what the layer's own Escape code did not do: its Close button, else a Cancel / Close button, else a click on its backdrop; a menu closes as a click outside it does
function shut(layer) {
  if (layer.classList.contains("modal-back")) {
    const x = layer.querySelector('header [aria-label="Close"]') || [...layer.querySelectorAll("button")].find((b) => /^(Cancel|Close)$/.test(b.textContent.trim()));
    if (x) x.click(); else layer.click();
    return;
  }
  layer.hidden = true;
  const pair = MENUS.find(([menu]) => menu === layer.id), button = pair && document.getElementById(pair[1]);
  if (!button) return;
  if (button.hasAttribute("aria-expanded")) button.setAttribute("aria-expanded", "false");
  button.focus();
}

// Returns the check app.js's key handler runs first: true when an Escape belongs to an open layer (and was dealt with), so it goes no further.
// A layer whose own code calls preventDefault() on the Escape has answered it (a field cleared, a step back) and is left open.
export function initEscapeKey(app) {
  let resent = false;
  // an Escape from outside the layer in front is sent again from inside it, so the layer's own Escape code runs as if it had the focus
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || resent) return;
    const layer = frontLayer();
    if (!layer) {
      // the 3D Print Sim closes as its X does, also from its number boxes and layer slider (they keep their keys from the app)
      if (app && app.simLock && app.command) { e.preventDefault(); e.stopImmediatePropagation(); app.command.cancel(); }
      return;
    }
    // Let the layer handle Escape, then close it if it is still in front, did not answer it, and the focus has not moved.
    if (layer.contains(e.target)) {
      const focus = document.activeElement;
      setTimeout(() => { if (!e.defaultPrevented && frontLayer() === layer && document.activeElement === focus) shut(layer); }, 0);
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    const again = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
    resent = true;
    try { layer.dispatchEvent(again); } finally { resent = false; }
    if (!again.defaultPrevented && frontLayer() === layer) shut(layer);
  }, true);
  // an Escape that came out of a layer unanswered: close the layer (a resent one is dealt with by the listener above)
  return (e) => {
    if (e.key !== "Escape") return false;
    if (resent) return true; // a resent Escape never reaches the design, even after the layer's own code closed the layer without stopping it
    const layer = frontLayer();
    if (!layer) return false;
    if (!e.defaultPrevented) shut(layer);
    return true;
  };
}
