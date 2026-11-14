// Simple's selected-shape sheet on a phone: a new selection opens it collapsed to one handle row (name and size, as the
// status bar shows it); a tap or an upward pull opens it above the tool strip, sized (and the view nudged) so the shape
// stays in view, with the size fields showing; a tap or a pull down closes it.
export function initPhoneSheet(app, panel) {
  const handle = panel.querySelector("#simple-sheet-handle");
  handle.removeAttribute("aria-label");
  handle.innerHTML = '<span class="sheet-grip" aria-hidden="true"></span><span class="sheet-name"></span><span class="sheet-size"></span>';
  const name = handle.querySelector(".sheet-name"), size = handle.querySelector(".sheet-size");
  const selinfo = document.getElementById("selinfo");
  let ids = [], startY = null, moved = false, swallow = false;
  function label() {
    const selected = app.selected();
    name.textContent = selected.length === 1 ? selected[0].name : selected.length ? `${selected.length} shapes` : "";
    size.textContent = selected.length === 1 ? selinfo.textContent : "";
  }
  new MutationObserver(label).observe(selinfo, { childList: true, characterData: true, subtree: true });
  function openHeight(pan) {
    const work = panel.closest(".work"), rail = document.getElementById("simple-rail");
    const railTop = rail.getClientRects().length && rail.getBoundingClientRect().height ? rail.getBoundingClientRect().top : work.getBoundingClientRect().bottom;
    const max = Math.max(0, 0.6 * (railTop - work.getBoundingClientRect().top));
    const Vector = app.vp.view.target.constructor, canvasTop = app.vp.canvas.getBoundingClientRect().top;
    let lowest = -Infinity, highest = Infinity;
    for (const body of app.selected()) {
      const box = app.scene.bodyTightBox(body.id);
      if (!box) continue;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const point = app.vp.project(new Vector(x, y, z));
        if (point[2] < 1) {
          lowest = Math.max(lowest, canvasTop + point[1]);
          highest = Math.min(highest, canvasTop + point[1]);
        }
      }
    }
    const height = lowest === -Infinity ? max : Math.max(Math.min(220, max), Math.min(railTop - lowest - 12, max));
    panel.style.setProperty("--sheet-open-h", `${height}px`);
    if (pan && lowest !== -Infinity) {
      const up = Math.min(lowest + 12 - (railTop - height), highest - (canvasTop + 8));
      if (up > 1) {
        const vp = app.vp, from = vp.view.target.clone();
        vp.panBy(0, -up);
        const to = vp.view.target.clone();
        vp.view.target.copy(from);
        vp.animateTo({ target: to }, 250);
      }
    }
  }
  // Only resize recalculates an open sheet; geometry changes must not jump while typing.
  window.addEventListener("resize", () => { if (panel.classList.contains("expanded")) openHeight(false); });
  function setExpanded(expanded) {
    if (expanded) openHeight(true);
    panel.classList.toggle("expanded", expanded);
    handle.setAttribute("aria-expanded", String(expanded));
    if (!expanded) { panel.scrollTop = 0; return; }
    requestAnimationFrame(() => {
      if (!panel.classList.contains("expanded")) return;
      const field = panel.querySelector("#insp-w, #insp-s0, #insp-s");
      const row = field?.closest(".row3") || field?.parentElement;
      const target = row?.previousElementSibling?.classList.contains("subhead") ? row.previousElementSibling : row;
      if (target) panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - handle.getBoundingClientRect().height;
    });
  }
  handle.addEventListener("pointerdown", (event) => { startY = event.clientY; moved = false; handle.setPointerCapture(event.pointerId); });
  handle.addEventListener("pointermove", (event) => { if (startY !== null && Math.abs(event.clientY - startY) >= 24) moved = true; });
  handle.addEventListener("pointerup", (event) => {
    if (startY !== null && (moved || Math.abs(event.clientY - startY) >= 24)) {
      setExpanded(event.clientY < startY); swallow = true;
      setTimeout(() => { swallow = false; }, 0);
    }
    startY = null;
  });
  handle.addEventListener("pointercancel", () => { startY = null; });
  handle.addEventListener("click", (event) => {
    if (swallow) { swallow = false; event.preventDefault(); return; }
    setExpanded(!panel.classList.contains("expanded"));
  });
  return { sync(selected) {
    const next = selected.map((body) => body.id);
    if (next.length !== ids.length || next.some((id, i) => id !== ids[i])) setExpanded(false);
    ids = next; label();
  } };
}
