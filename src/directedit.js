// jumpstart-3d: direct edit. Point at a finished sketch's shape and it lights up: a click opens Extrude on it, a drag pulls it up or
// down at once (down into a body cuts), a double-click still opens the sketch. The two modes' idle handlers call in here; the Extrude
// panel itself (advanced.js, extrudeCmd) does the real work, so there is one Extrude path.
const DRAG_PX = 4; // a press must move this far before it counts as a drag
const HINT = "Click to extrude this shape, or drag it up or down. Double-click to edit the sketch.";

export function initDirectEdit(app, { vp, scene }) {
  let lit = null, press = null; // lit: the shape mesh that is highlighted; press: a press on a shape that has not become a drag yet
  const on = () => (app.mode === "beginner" || (app.mode === "advanced" && app.advanced.workspace === "design")) && !app.simLock && !app.command && !app.sketcher.active && scene.showSketches;

  // the shape under the pointer, unless a body face is nearer than it (a shape hidden behind a body is never taken)
  function regionAt(e) {
    if (!on() || e.shiftKey || e.ctrlKey || e.metaKey) return null;
    const hits = vp.pick(e, scene.regionMeshes());
    if (!hits.length) return null;
    hits.sort((p, q) => (Math.abs(p.distance - q.distance) > 1e-4 ? p.distance - q.distance : p.object.userData.region.region.area - q.object.userData.region.region.area));
    const face = scene.pickFace(e);
    if (face && hits[0].distance > face.distance + 0.05) return null;
    const r = hits[0].object.userData.region;
    return { ...r, key: r.sketch + ":" + r.index, mesh: hits[0].object };
  }
  function unlight() {
    if (!lit) return;
    lit = null;
    scene.highlightRegions(new Set(), null);
    app.status();
  }
  return {
    regionAt,
    // true when a shape is under the pointer (the caller then skips its own body hover)
    hover(e) {
      const hit = regionAt(e);
      if (!hit) { unlight(); return false; }
      vp.canvas.style.cursor = "pointer";
      if (hit.mesh !== lit) { lit = hit.mesh; scene.highlightRegions(new Set(), hit.key); app.status(); }
      return true;
    },
    leave: unlight,
    // true when it took the press
    down(e) {
      const hit = regionAt(e);
      if (!hit) return false;
      press = { hit, e0: e, x0: e.clientX, y0: e.clientY };
      return true;
    },
    // true once the press became a drag and Extrude took over; the viewport then sends the rest of the drag to Extrude's handler
    move(e) {
      if (!press || Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < DRAG_PX) return false;
      const { hit, e0 } = press;
      press = null;
      lit = null;
      app.advanced.extrude({ region: hit, drag: e0 });
      if (app.command) vp.handler.move(e);
      return true;
    },
    up() {
      if (!press) return;
      const { hit } = press;
      press = null;
      lit = null;
      app.advanced.extrude({ region: hit, clicked: true });
    },
    hint: () => (lit && on() ? HINT : ""),
  };
}
