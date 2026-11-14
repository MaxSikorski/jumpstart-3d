// Accessible names for icon-only controls: a button that shows only a tooltip (a title) and no text, aria-label or
// aria-labelledby (Undo, Redo, the view buttons, ...) gets its tooltip as aria-label, at start and when added later; a
// top-bar button whose text sits only in a .lbl span (hidden by CSS on narrow screens) gets that short text instead of
// falling back to its long tooltip. J.Siwek's markup stays as it is; a name someone else sets is never touched.
const SEL = 'button, [role="button"], select, input:not([type="hidden"])';
const MARK = "data-a11y-tip"; // marks a name we added, so we can refresh or withdraw it
const WORD = /[\p{L}\p{N}]/u; // a name needs a letter or digit; a glyph like "▶" or "×" is not one
const meaningful = (t) => WORD.test(t || "");

// What the element itself says, ignoring any name we added: its text, its <label>s, or a placeholder.
function ownName(el) {
  if (el.tagName === "INPUT" || el.tagName === "SELECT") {
    if ([...(el.labels || [])].some((l) => meaningful(l.textContent))) return true;
    return el.tagName === "INPUT" && meaningful(el.getAttribute("placeholder"));
  }
  return meaningful(el.textContent);
}

function name(el) {
  if (!el || el.nodeType !== 1) return;
  const mark = el.getAttribute(MARK), current = el.getAttribute("aria-label");
  if (mark !== null && current !== mark) { el.removeAttribute(MARK); return; }
  const ours = mark !== null;
  if (!ours && ((current || "").trim() || el.hasAttribute("aria-labelledby"))) return;
  let wanted = null;
  const labels = [...el.querySelectorAll(".lbl")];
  if (labels.length) {
    const text = labels.map((label) => label.textContent).join(" ").trim().replace(/\s+/g, " ");
    const copy = el.cloneNode(true); copy.querySelectorAll(".lbl").forEach((label) => label.remove());
    if (meaningful(text) && !meaningful(copy.textContent)) wanted = text;
  }
  if (wanted === null && !ownName(el)) wanted = (el.getAttribute("title") || "").trim() || null;
  if (wanted !== null) {
    if (current !== wanted) el.setAttribute("aria-label", wanted);
    if (mark !== wanted) el.setAttribute(MARK, wanted);
  } else if (ours) { el.removeAttribute("aria-label"); el.removeAttribute(MARK); }
}

export function initA11yNames(root = document.body) {
  if (!root) return;
  root.querySelectorAll(SEL).forEach(name);
  // One observer, cheap: the app touches the DOM a lot, so we only look at titles and at added or changed controls.
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") { if (m.target.matches(SEL)) name(m.target); continue; }
      const host = m.target.closest(SEL); // text changed inside a control, e.g. a button label
      if (host) name(host);
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches(SEL)) name(n);
        n.querySelectorAll(SEL).forEach(name);
      }
    }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
}
