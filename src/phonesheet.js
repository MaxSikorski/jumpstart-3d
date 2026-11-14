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
    const vp = app.vp, work = panel.closest(".work"), rail = document.getElementById("simple-rail");
    const railTop = rail.getClientRects().length && rail.getBoundingClientRect().height ? rail.getBoundingClientRect().top : work.getBoundingClientRect().bottom;
    const max = Math.max(0, 0.6 * (railTop - work.getBoundingClientRect().top));
    vp.updateCamera(); vp.camera.updateMatrixWorld(true); // project with the camera as it is now, not as last drawn
    const Vector = vp.view.target.constructor, canvasTop = vp.canvas.getBoundingClientRect().top;
    const cam = vp.camera, forward = cam.getWorldDirection(new Vector()), tan = Math.tan((cam.fov || 0) * Math.PI / 360);
    // each corner: its screen y and the world size of one pixel at its depth (a sideways move of the view keeps every depth)
    const corners = [];
    for (const body of app.selected()) {
      const box = app.scene.bodyTightBox(body.id);
      if (!box) continue;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const corner = new Vector(x, y, z), point = vp.project(corner), depth = corner.clone().sub(cam.position).dot(forward);
        if (point[2] < 1 && depth > 0) corners.push({ y: canvasTop + point[1], px: cam.isOrthographicCamera ? vp.pixelSize() : (2 * depth * tan) / vp.h });
      }
    }
    const lowest = corners.length ? Math.max(...corners.map((c) => c.y)) : null;
    const height = lowest === null ? max : Math.max(Math.min(220, max), Math.min(railTop - lowest - 12, max));
    panel.style.setProperty("--sheet-open-h", `${height}px`);
    if (!pan || !corners.length) return;
    // the sheet needs its minimum height and would cover the shape: move the view up just enough (world units), never past the top edge
    const floor = railTop - height - 12, ceiling = canvasTop + 8;
    const need = Math.max(...corners.map((c) => (c.y - floor) * c.px)), room = Math.min(...corners.map((c) => (c.y - ceiling) * c.px));
    const move = Math.min(need, room);
    if (!(move > 0)) return;
    const up = new Vector().setFromMatrixColumn(cam.matrixWorld, 1);
    vp.animateTo({ target: vp.view.target.clone().addScaledVector(up, -move) }, 250);
  }
  // Only resize recalculates an open sheet; geometry changes must not jump while typing.
  const phone = matchMedia("(max-width: 640px)");
  window.addEventListener("resize", () => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!panel.classList.contains("expanded")) return; if (phone.matches) openHeight(false); else setExpanded(false);
  })));
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
  // after a pull, the click that may follow is ignored; Safari can send it late, so the flag is cleared by the next press, not a timer
  handle.addEventListener("pointerdown", (event) => { startY = event.clientY; moved = false; swallow = false; handle.setPointerCapture(event.pointerId); });
  handle.addEventListener("keydown", () => { swallow = false; });
  handle.addEventListener("pointermove", (event) => { if (startY !== null && Math.abs(event.clientY - startY) >= 24) moved = true; });
  handle.addEventListener("pointerup", (event) => {
    if (startY !== null && (moved || Math.abs(event.clientY - startY) >= 24)) {
      setExpanded(event.clientY < startY); swallow = true;
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
    const changed = next.length !== ids.length || next.some((id, i) => id !== ids[i]);
    const off = document.documentElement.dataset.face !== "simple" || !phone.matches; // a face switch or a wide window closes it
    if (changed || (off && panel.classList.contains("expanded"))) setExpanded(false);
    ids = next; label();
  } };
}
