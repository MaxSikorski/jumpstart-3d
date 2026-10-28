// jumpstart-3d: direct edit. Point at a finished sketch's shape and it lights up: a click opens Extrude on it, a drag pulls it up or
// down at once (down into a body cuts), a double-click still opens the sketch. The two modes' idle handlers call in here; the Extrude
// panel itself (advanced.js, extrudeCmd) does the real work, so there is one Extrude path.
import * as THREE from "three";
const DRAG_PX = 4; // a press must move this far before it counts as a drag
const HINT = "Click to extrude this shape, or drag it up or down. Double-click to edit the sketch.";

// ---- which bodies a sketch shape pulled down really cuts: rays from points inside the shape, against the bodies as they are saved
// (never the preview, which already shows the cut and would flip the answer back and forth)
const solids = new WeakMap(); // a saved body's mesh data -> a THREE.Mesh to cast rays at
function solidOf(data) {
  let m = solids.get(data);
  if (!m) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.vertices, 3));
    g.setIndex(new THREE.BufferAttribute(data.triangles, 1));
    g.computeBoundingBox();
    m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.matrixAutoUpdate = false;
    solids.set(data, m);
  }
  return m;
}
// points inside a region (plane coordinates): a grid, the label point, and a point just inside each corner
function insidePoints(r, pointIn) {
  const xs = r.poly.map((q) => q[0]), ys = r.poly.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), out = [];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) out.push([x0 + ((i + 0.5) / 8) * (x1 - x0), y0 + ((j + 0.5) / 8) * (y1 - y0)]);
  out.push(r.pt);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, step = Math.max(1, Math.floor(r.poly.length / 24));
  for (let i = 0; i < r.poly.length; i += step) out.push([r.poly[i][0] + (cx - r.poly[i][0]) * 0.02, r.poly[i][1] + (cy - r.poly[i][1]) * 0.02]);
  return out.filter((q) => pointIn(r, q));
}
const caster = new THREE.Raycaster();
let lastCut = { key: "", ids: [] };
// ids of the bodies the extruded shape (regions, on the plane M with normal n, pulled by dist < 0) really passes into: a ray from a point just
// inside the tool meets the body, or starts inside it. A body that only touches the plane, or whose box merely overlaps, is not one.
export function cutTargets(app, { regions, M, n, dist, pointIn, bodies }) {
  const dir = n.clone().multiplyScalar(Math.sign(dist) || -1), len = Math.abs(dist) - 0.02;
  const cands = bodies.map((b) => ({ b, res: b._key && app.kernel.get(b._key) })).filter((c) => c.res && c.res.ok && c.res.mesh);
  const key = [dist, M.elements.join(), n.toArray().join(), regions.map((r) => r.key + ":" + r.pt).join("|"), cands.map((c) => c.b.id + c.b._key + c.b.m.join()).join("|")].join("#");
  if (key === lastCut.key) return lastCut.ids;
  const pts = regions.flatMap((r) => insidePoints(r, pointIn).map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M).addScaledVector(dir, 0.01)));
  const wobble = dir.clone().add(new THREE.Vector3(0.0123, 0.0071, 0.0049)).normalize(); // off the axis, so a ray never runs along an edge between two triangles
  const ids = [];
  for (const { b, res } of cands) {
    const mesh = solidOf(res.mesh);
    mesh.matrixWorld.fromArray(b.m);
    const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const hit = pts.some((p) => {
      if (box.containsPoint(p)) {
        caster.set(p, wobble); caster.far = Infinity;
        if (caster.intersectObject(mesh, false).length % 2) return true; // the start is inside the body
      }
      if (len <= 0) return false;
      caster.set(p, dir); caster.far = len;
      return caster.ray.intersectsBox(box) && caster.intersectObject(mesh, false).length > 0;
    });
    if (hit) ids.push(b.id);
  }
  lastCut = { key, ids };
  return ids;
}

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
    cutTargets,
    // true when a shape is under the pointer (the caller then skips its own body hover)
    hover(e) {
      const hit = regionAt(e);
      if (!hit) { unlight(); return false; }
      vp.canvas.style.cursor = "pointer";
      if (hit.mesh !== lit) { lit = hit.mesh; scene.highlightRegions(new Set(), hit.key); app.status(); }
      return true;
    },
    leave: unlight,
    // drop a press and the highlight (an interrupted gesture, a mode switch)
    cancel() { press = null; unlight(); },
    // true when it took the press
    down(e) {
      press = null; // only the press this call makes counts
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
    up(e) {
      if (!press) return;
      const { hit, x0, y0 } = press;
      press = null;
      lit = null;
      if ((e && e.type === "pointercancel") || !on() || !scene.regionMeshes().some((m) => m.userData.region.sketch === hit.sketch)) return; // an interrupted touch, or the shape is gone
      app.advanced.extrude({ region: hit, clicked: { x: x0, y: y0, t: e && e.timeStamp ? e.timeStamp : performance.now() } });
    },
    hint: () => (lit && on() && scene.regionMeshes().includes(lit) ? HINT : ""),
  };
}
