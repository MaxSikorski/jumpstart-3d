// jumpstart-3d: fill openings. The panel for the Fill openings feature: click a flat face, see every opening in it outlined, click an
// opening to keep it open, press Fill. The result is ONE `fillopen` feature on the body (src/fillopen.js builds it: it rebuilds the
// part's faces without the openings, no boolean), so it shows in the timeline, edits in this same panel and undoes in one step.
// The panel never measures anything itself: after each preview build it reads the kernel's report from the built mesh
// (mesh.fillReports[mod id]) and draws that. Modelled on src/holepattern.js; the plain-number helpers are in src/fillpick.js so
// Node tests can import them.
import * as THREE from "three";
import { store, findBody, nextSeq } from "./store.js";
import { uid, el } from "./util.js";
import { withUnit } from "./units.js";
import { openingAt, keepIndex, keepEntry, fillReportFor } from "./fillpick.js";

export { openingAt };

const COLORS = { fill: 0x1f4fa8, keep: 0x8a8f98, refused: 0xc0392b };
const FACE_BLUE = 0x2f66c8;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const noun = (n) => (n === 1 ? "opening" : "openings");

export function initFillOpenings(app, { openCmd, commit, schedulePreview, deleteFeature, pickbox, pickBaseFace, baseOf, drawFace, ov, clearOv }) {
  function cmd(editing = null) {
    const vp = app.vp;
    const st = { pick: null, keep: [], report: null, reportKey: null, error: null, plane: null, shown: null };
    let original = null;
    if (editing) {
      const b = findBody(store.doc, editing.body), mods = b ? b.node.mods || [] : [], i = mods.findIndex((x) => x.id === editing.mod);
      if (i < 0) return;
      // a resize after the fill moved the stored plane and the kept openings with it; the editor would show the wrong ones
      if (mods.slice(i + 1).some((x) => x.t === "scale")) { app.toast("This body was resized after Fill openings. Remove the fill and add it again to change it."); return; }
      // the saved plane and keeps are held from the start, also while the committed mesh is still building
      st.plane = { o: mods[i].plane.o.slice(), n: mods[i].plane.n.slice() };
      st.keep = (mods[i].keep || []).map((k) => ({ c: k.c.slice(), a: k.a }));
      st.pick = { body: editing.body, face: undefined };
      original = JSON.stringify({ plane: st.plane, keep: st.keep });
    }
    const modId = editing ? editing.mod : uid("f");
    let hover = null, hoverKey = null, timer = 0;
    const materials = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, new THREE.LineBasicMaterial({ color: c, depthTest: false })]));
    const pickable = (b) => !b.hole && !b.locked && (!editing || b.id === editing.body);
    const flat = (f) => f && f.info && f.info.t === "PLANE" && f.info.n;

    // a face of the body lying in the stored plane (so the edited feature can show its face again), or -1
    function faceInPlane(base, plane) {
      const n = plane.n;
      let best = -1, bestArea = -1;
      base.data.faceInfo.forEach((fi, i) => {
        if (fi.t !== "PLANE" || !fi.n || !fi.c) return;
        const dn = fi.n[0] * n[0] + fi.n[1] * n[1] + fi.n[2] * n[2];
        const dd = (fi.c[0] - plane.o[0]) * n[0] + (fi.c[1] - plane.o[1]) * n[1] + (fi.c[2] - plane.o[2]) * n[2];
        const size = base.data.faceGroups[i] ? base.data.faceGroups[i][1] : 0;
        if (dn > 1 - 1e-5 && Math.abs(dd) < 0.01 && size > bestArea) { best = i; bestArea = size; }
      });
      return best;
    }
    const dirty = () => !editing || JSON.stringify({ plane: st.plane, keep: st.keep }) !== original;
    const key = () => JSON.stringify([st.plane, st.keep]);
    // the report on screen is for the plane and keeps the dialog holds right now (not for the one before the last click)
    const fresh = () => !!st.report && st.reportKey === key() && !st.error;

    // what the previewed body says about the feature as the dialog holds it now: { report } once built, { error } if it failed, or null while it builds
    function current() {
      if (!st.pick) return null;
      const b = store.view.bodies.find((x) => x.id === st.pick.body);
      // right after a click the preview still shows the feature as it was before
      const m = b && (b.node.mods || []).find((x) => x.id === modId);
      if (!m || JSON.stringify([m.plane, m.keep]) !== key()) return null;
      const res = b._key && app.kernel.get(b._key);
      if (!res) return null;
      if (!res.ok) return { report: null, error: res.error || "This couldn't be built." };
      return { report: fillReportFor(res.mesh, b.node, modId), error: null };
    }
    // the report changes after every preview build (also a cached one, which sends no build result), so the dialog looks every 150 ms
    function look() {
      if (app.command !== def) return;
      const cur = current();
      if (!cur) return;
      let changed = false;
      if (cur.report && cur.report !== st.shown) { st.shown = cur.report; st.report = cur.report; st.reportKey = key(); drawBase(); changed = true; }
      if (cur.report && st.reportKey !== key() && cur.report === st.shown) { st.reportKey = key(); changed = true; } // back to an earlier choice whose build was kept
      if (cur.error !== st.error) { st.error = cur.error; changed = true; }
      if (changed) notes();
    }

    function depthText(r) {
      const f = r.openings.filter((o) => o.state === "fill"), d = f.map((o) => o.depth);
      if (!d.length) return "";
      const hi = Math.max(...d), lo = Math.min(...d);
      // the kernel says per opening whether the fill reaches the far side; a blind pocket is only filled up to the face
      return (hi - lo > 0.01 ? `up to ${withUnit(hi)} deep` : `${withUnit(hi)} deep`) + (f.every((o) => o.through === true) ? " (right through to the other side)" : "");
    }
    function noteLines() {
      if (!st.pick) return [];
      const r = st.report, out = [], why = [];
      if (st.error) why.push(st.error);
      if (!r) {
        out.push(el("div", { id: "fo-total", style: { fontWeight: "600" } }, st.error ? "Can't fill openings here." : "Looking for openings…"));
      } else if (!r.openings.length) {
        out.push(el("div", { id: "fo-total", style: { fontWeight: "600" } }, "No openings in this face."));
      } else {
        const refused = r.openings.filter((o) => o.state === "refused");
        out.push(el("div", { id: "fo-total", style: { fontWeight: "600" } }, `Filling ${r.filled} of ${r.openings.length} ${noun(r.openings.length)}` + (r.filled ? ", " + depthText(r) : "")));
        out.push(el("div", { style: { display: "flex", gap: "6px", margin: "6px 0" } },
          el("button", { class: "btn", id: "fo-all", onclick: () => setKeep([]) }, "Fill all"),
          el("button", { class: "btn", id: "fo-none", onclick: () => setKeep(r.openings.filter((o) => o.state !== "refused").map(keepEntry)) }, "Keep all open")));
        if (refused.length) why.push(`${refused.length} ${noun(refused.length)} can't be filled: ${[...new Set(refused.map((o) => o.why || "this one is too complicated"))].join("; ")}`);
      }
      if (why.length) out.push(el("div", { id: "fo-why", class: "err-msg" }, why.join(" ")));
      return out;
    }
    function notes() {
      const box = document.getElementById("fo-note");
      if (box) box.replaceChildren(...noteLines());
      def.refreshOk && def.refreshOk();
    }

    // The overlay in three layers, so a mouse move redraws only the hover face and a click on an opening redraws nothing until the report changes.
    const layers = { face: [], lines: [], hover: [] };
    function drop(name) { for (const c of layers[name]) { ov.remove(c); c.geometry && c.geometry.dispose(); } layers[name] = []; }
    function put(name, make) { const n = ov.children.length; make(); layers[name] = ov.children.slice(n); }
    // the picked face and one set of outlines per state, rebuilt only when the pick or the report changes
    function drawBase() {
      drop("face"); drop("lines");
      const base = st.pick && baseOf(st.pick.body);
      if (base) {
        if (st.pick.face === undefined) st.pick.face = faceInPlane(base, st.plane);
        if (st.pick.face >= 0 && base.data.faceGroups[st.pick.face]) put("face", () => drawFace(base, st.pick.face, FACE_BLUE));
        if (st.report) put("lines", () => {
          const seg = { fill: [], keep: [], refused: [] }, v = new THREE.Vector3();
          for (const o of st.report.openings) {
            const list = seg[o.state] || seg.fill;
            for (const loop of o.loops || []) {
              for (let i = 0; i < loop.length; i++) {
                for (const p of [loop[i], loop[(i + 1) % loop.length]]) list.push(...v.set(p[0], p[1], p[2]).applyMatrix4(base.m).toArray());
              }
            }
          }
          for (const [state, pts] of Object.entries(seg)) {
            if (!pts.length) continue;
            const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3)), materials[state]);
            lines.renderOrder = 13;
            ov.add(lines);
          }
        });
      }
      vp.request();
    }
    function drawHover(force = false) {
      const k = hover && (!st.pick || hover.face !== st.pick.face || hover.body !== st.pick.body) ? hover.body + ":" + hover.face : null;
      if (!force && k === hoverKey) return;
      hoverKey = k;
      drop("hover");
      if (k) put("hover", () => drawFace(hover.base, hover.face, 0xe8a317));
      vp.request();
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      drawBase();
      drawHover(true);
      def.refreshOk && def.refreshOk();
      schedulePreview(def);
    }
    // a changed choice of kept openings: the outlines stay as they are until the rebuilt report arrives, and Fill waits for it
    function setKeep(list) { st.keep = list; def.refreshOk && def.refreshOk(); schedulePreview(def); }

    function pickFace(f) {
      const inv = f.base.m.clone().invert();
      st.pick = { body: f.body, face: f.face };
      st.plane = { o: f.point.clone().applyMatrix4(inv).toArray().map(r4), n: f.info.n.map(r4) };
      st.keep = [];
      st.report = null;
      st.reportKey = null;
      st.error = null;
      st.shown = null;
    }
    // a click on the face (and body) that is already picked, whichever of its pieces
    function samePlane(f) {
      if (!st.pick || !st.plane || f.body !== st.pick.body) return false;
      const n = st.plane.n, fn = f.info.n;
      if (fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] <= 1 - 1e-5) return false;
      const p = f.point.clone().applyMatrix4(f.base.m.clone().invert()).toArray();
      return Math.abs((p[0] - st.plane.o[0]) * n[0] + (p[1] - st.plane.o[1]) * n[1] + (p[2] - st.plane.o[2]) * n[2]) < 0.01;
    }

    const def = {
      title: (editing ? "Edit " : "") + "Fill openings",
      okLabel: "Fill",
      // the preview needs only the pick: the report that says whether anything can be filled comes out of the preview build
      valid: () => !!st.pick && !!st.plane,
      canOk: () => def.valid() && fresh() && dirty() && (!!editing || st.report.filled > 0),
      apply(doc) {
        const b = findBody(doc, st.pick.body);
        if (!b) return;
        const props = { plane: { o: st.plane.o.slice(), n: st.plane.n.slice() }, keep: st.keep.map((k) => ({ c: k.c.slice(), a: k.a })) };
        b.node.mods = b.node.mods || [];
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); if (m) Object.assign(m, props); return; }
        b.node.mods.push({ id: modId, seq: nextSeq(doc), t: "fillopen", ...props });
      },
      ok() { if (fresh()) commit(def, `Fill openings (${st.report.filled})`); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => (st.pick ? "Click inside an opening to keep it open. Notches in the outer edge aren't filled." : "Click a flat face with openings in it."),
      build(body) {
        const name = st.pick && ((findBody(store.doc, st.pick.body) || {}).name || "Body");
        body.append(pickbox(true, st.pick ? el("span", {}, el("b", {}, name), " · flat face") : "Click a flat face with openings in it.", st.pick && !editing ? () => { st.pick = null; st.plane = null; st.keep = []; st.report = null; st.reportKey = null; st.error = null; st.shown = null; refresh(); } : null));
        body.append(el("div", { id: "fo-note" }, ...noteLines()));
        if (st.pick) body.append(el("div", { id: "fo-hint", class: "hint", style: { padding: 0 } }, "Click inside an opening to keep it open. Notches in the outer edge aren't filled."));
      },
      start() { timer = setInterval(look, 150); refresh(); },
      cleanup() { clearInterval(timer); for (const m of Object.values(materials)) m.dispose(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, pickable);
          hover = flat(f) ? f : null;
          drawHover();
          vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          // with a face already picked, a click that lands inside one of its openings toggles that opening. The ray is cut against the
          // picked plane (not the body), because the committed body still has the opening's walls and floor where the click lands.
          if (st.pick && st.report && st.plane) {
            const base = baseOf(st.pick.body);
            if (base) {
              const ray = vp.ray(e).clone().applyMatrix4(base.m.clone().invert());
              const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...st.plane.n), new THREE.Vector3(...st.plane.o));
              const hit = ray.intersectPlane(plane, new THREE.Vector3());
              const i = hit ? openingAt(st.report, hit.toArray(), st.plane.n) : -1;
              if (i >= 0) {
                const o = st.report.openings[i];
                if (o.state === "refused") { app.toast(o.why || "This opening can't be filled.", "err"); return true; }
                const k = keepIndex(st.keep, o);
                if (k >= 0) st.keep.splice(k, 1); else st.keep.push(keepEntry(o));
                setKeep(st.keep);
                return true;
              }
            }
          }
          const f = pickBaseFace(e, pickable);
          if (!f) return true;
          if (!flat(f)) { app.toast("Pick a flat face."); return true; }
          if (samePlane(f)) return true; // the face already picked, between its openings: nothing changes, the kept openings stay
          pickFace(f);
          refresh();
          return true;
        },
      },
    };
    openCmd(def);
  }
  return { cmd };
}
