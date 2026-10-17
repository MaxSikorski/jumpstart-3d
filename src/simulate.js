// Simulate workspace: joints, motion studies with collision checks, stress tests and a
// 3D-print strength check. Joint motion only moves bodies on screen (a "pose"); the
// design keeps its positions unless you apply the pose.
import * as THREE from "three";
import { store, findBody, nextSeq } from "./store.js";
import { el, fmt, uid } from "./util.js";
import { M4, arr } from "./ops.js";
import { MATERIALS, FILAMENTS, voxelize, buildModel, nearestNode, samplePoints, solve, printFailure, heat } from "./fea.js";

export function initSimulate(app, X) {
  const { vp, scene, openCmd, closeCmd, commit, schedulePreview, pickBaseFace, baseOf, drawLine, drawFace, drawDot, clearOv, row, seg, pickbox, sliderRow } = X;
  const V3 = (a) => new THREE.Vector3(...a);
  const r3 = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(6)));
  const bodies = () => store.doc.bodies.filter((b) => !b.hole && !b.hidden);

  // ================================================================ joints
  const JOINT_TYPES = [["revolute", "Revolute"], ["slider", "Slider"], ["cylindrical", "Cylindrical"], ["rigid", "Rigid"]];
  const values = new Map(); // joint id -> {a: angle°, s: slide mm}
  const val = (j) => values.get(j.id) || { a: 0, s: 0 };
  // motion of one joint, in world (design) coordinates
  function jointMatrix(j, v) {
    const o = V3(j.o), d = V3(j.d).normalize();
    const M = new THREE.Matrix4();
    if (j.type === "revolute" || j.type === "cylindrical") {
      M.makeTranslation(o.x, o.y, o.z).multiply(new THREE.Matrix4().makeRotationAxis(d, (v.a * Math.PI) / 180)).multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
    }
    if (j.type === "slider" || j.type === "cylindrical") M.premultiply(new THREE.Matrix4().makeTranslation(d.x * v.s, d.y * v.s, d.z * v.s));
    return M;
  }
  // pose of every jointed body: its parent's pose, then its own joint's motion
  function computePose(doc, vals = values) {
    const joints = doc.joints || [];
    const byBody = new Map(joints.map((j) => [j.body, j]));
    const out = new Map(), visiting = new Set();
    const poseOf = (id) => {
      if (out.has(id)) return out.get(id);
      const j = byBody.get(id);
      if (!j || visiting.has(id)) return null;
      visiting.add(id);
      const parent = j.parent ? poseOf(j.parent) : null;
      const M = jointMatrix(j, vals.get(j.id) || { a: 0, s: 0 });
      if (parent) M.premultiply(parent);
      out.set(id, M);
      visiting.delete(id);
      return M;
    };
    for (const j of joints) poseOf(j.body);
    return out;
  }
  function showPose(vals = values) {
    scene.state.pose = computePose(store.view, vals);
    scene.refresh();
  }
  function resetPose() { values.clear(); scene.state.pose = new Map(); scene.state.collide = new Set(); scene.refresh(); }
  // make the current pose the design position
  function applyPose() {
    const pose = computePose(store.doc);
    if (!pose.size) { app.toast("Nothing has moved yet."); return; }
    store.update((doc) => {
      for (const [id, M] of pose) { const b = findBody(doc, id); if (b) b.m = arr(M4(b.m).premultiply(M)); }
      for (const j of doc.joints || []) {
        // joints move with their parents' pose
        const pm = j.parent ? pose.get(j.parent) : null;
        if (pm) { j.o = r3(V3(j.o).applyMatrix4(pm)); j.d = r3(V3(j.d).transformDirection(pm)); }
      }
    }, "Apply joint positions");
    values.clear(); scene.state.pose = new Map(); scene.refresh();
  }
  // joint origin and axis from a picked face: round faces give their own axis
  function axisFromFace(f) {
    const m = f.base.m;
    const c = V3(f.info.c).applyMatrix4(m);
    if (f.info.t === "CYLINDRE" && f.info.ax) {
      const d = V3(f.info.ax).transformDirection(m).normalize();
      const o0 = V3(f.info.o).applyMatrix4(m);
      const o = o0.clone().addScaledVector(d, c.clone().sub(o0).dot(d));
      return { o: r3(o), d: r3(d), label: `round face (Ø${fmt(2 * f.info.r, 2)})` };
    }
    const n = f.info.t === "PLANE" && f.info.n ? V3(f.info.n).transformDirection(m).normalize() : f.normal.clone().normalize();
    return { o: r3(f.info.t === "PLANE" ? c : f.point), d: r3(n), label: f.info.t === "PLANE" ? "flat face" : "face" };
  }
  function jointCmd(editing = null) {
    const old = editing && (store.doc.joints || []).find((j) => j.id === editing);
    const st = old ? { ...JSON.parse(JSON.stringify(old)), axisLabel: "saved axis", test: 0 } : { type: "revolute", body: app.sel.length === 1 ? app.sel[0] : null, parent: null, o: null, d: null, limited: false, min: -90, max: 90, axisLabel: "", test: 0 };
    let hover = null;
    const unit = () => (st.type === "slider" ? "mm" : "°");
    const def = {
      title: (editing ? "Edit " : "") + "Joint",
      valid: () => !!st.body && (st.type === "rigid" || !!st.o),
      canOk: () => def.valid(),
      apply(doc) {
        doc.joints = doc.joints || [];
        const data = { type: st.type, body: st.body, parent: st.parent || null, o: st.o || [0, 0, 0], d: st.d || [0, 0, 1], limited: !!st.limited, min: st.min, max: st.max };
        if (old) { Object.assign(doc.joints.find((j) => j.id === old.id), data); return; }
        doc.joints = doc.joints.filter((j) => j.body !== st.body); // one joint drives a body
        let n = 1; const names = new Set(doc.joints.map((j) => j.name)); while (names.has("Joint " + n)) n++;
        doc.joints.push({ id: uid("j"), name: "Joint " + n, seq: nextSeq(doc), ...data });
      },
      ok() { commit(def, editing ? "Edit joint" : "Joint"); preview(0); },
      onDelete: old ? () => { closeCmd(false); store.update((doc) => { doc.joints = doc.joints.filter((j) => j.id !== old.id); }, "Delete joint"); resetPose(); } : null,
      hint: () => !st.body ? "Click the body that moves." : st.type !== "rigid" && !st.o ? "Click a face for the joint: a round face turns about its own axis, a flat face about its normal." : "Drag Test motion to try it, then OK.",
      build(body) {
        const b = st.body && findBody(store.doc, st.body);
        body.append(row("Moving", pickbox(!st.body, b ? el("b", {}, b.name) : "Click a body", b && !old ? () => { st.body = null; st.o = null; refresh(); } : null)));
        const parent = el("select", { class: "num", id: "jt-parent", "aria-label": "Attached to" }, el("option", { value: "" }, "Ground (fixed)"), ...bodies().filter((x) => x.id !== st.body).map((x) => el("option", { value: x.id, selected: st.parent === x.id }, x.name)));
        parent.onchange = () => { st.parent = parent.value || null; };
        body.append(row("Attached to", parent, "jt-parent"));
        body.append(row("Type", seg(JOINT_TYPES, st.type, (v) => { st.type = v; refresh(); }, "jt-type")));
        if (st.type !== "rigid") {
          body.append(row("Axis", pickbox(!!st.body && !st.o, st.o ? el("b", {}, st.axisLabel || "axis") : "Click a face", st.o ? () => { st.o = null; refresh(); } : null)));
          body.append(row("…along", seg([["face", "Face"], ["X", "X"], ["Y", "Y"], ["Z", "Z"]], st.axisPick || "face", (v) => {
            st.axisPick = v;
            if (v !== "face") { st.d = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[v]; if (!st.o) { const bb = scene.bodyTightBox(st.body); st.o = bb ? r3(bb.getCenter(new THREE.Vector3())) : [0, 0, 0]; st.axisLabel = v + " axis through the body"; } }
            refresh();
          }, "jt-axis")));
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "jt-lim", checked: st.limited, onchange: (e) => { st.limited = e.target.checked; refresh(); } }), "Limits"));
          if (st.limited) {
            const r3el = el("div", { class: "row3" });
            r3el.append(el("label", {}, "Min " + unit(), app.numField({ value: st.min, id: "jt-min", onCommit: (v) => { st.min = v; refresh(); } })));
            r3el.append(el("label", {}, "Max " + unit(), app.numField({ value: st.max, id: "jt-max", onCommit: (v) => { st.max = v; refresh(); } })));
            r3el.append(el("span"));
            body.append(r3el);
          }
          const [lo, hi] = range({ type: st.type, limited: st.limited, min: st.min, max: st.max });
          body.append(sliderRow("Test motion", "jt-test", st.test, lo, hi, st.type === "slider" ? 0.5 : 1, unit(), (v) => { st.test = v; preview(v); }));
        }
      },
      start() { refresh(); },
      cleanup() { resetPose(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole);
          hover = f;
          draw();
          vp.canvas.style.cursor = f ? "pointer" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole);
          if (!f) return true;
          if (!st.body) { st.body = f.body; refresh(); return true; }
          if (st.type !== "rigid" && f.info && f.info.c) {
            const ax = axisFromFace(f);
            st.o = ax.o; st.d = ax.d; st.axisLabel = ax.label; st.axisPick = "face";
            refresh();
          }
          return true;
        },
      },
    };
    function preview(v) {
      if (!st.body || !st.o) return;
      const tmp = { id: "__test", type: st.type, body: st.body, parent: st.parent, o: st.o, d: st.d };
      const M = jointMatrix(tmp, { a: st.type === "slider" ? 0 : v, s: st.type === "slider" ? v : st.type === "cylindrical" ? 0 : 0 });
      scene.state.pose = new Map([[st.body, M]]);
      scene.refresh();
    }
    function draw() {
      clearOv();
      if (hover && hover.info) drawFace(hover.base, hover.face, 0xe8a317);
      if (st.o && st.d) {
        const o = V3(st.o), d = V3(st.d).normalize(), bb = scene.bodyTightBox(st.body), L = bb ? bb.getSize(new THREE.Vector3()).length() * 0.6 + 5 : 30;
        drawLine([o.clone().addScaledVector(d, -L), o.clone().addScaledVector(d, L)], 0x1f4fa8);
        drawDot(o, 0x1f4fa8, 11);
      }
    }
    function refresh() { def.render(); draw(); }
    openCmd(def);
  }
  function range(j) {
    if (j.limited) return [Math.min(j.min, j.max), Math.max(j.min, j.max)];
    return j.type === "slider" ? [-50, 50] : [-180, 180];
  }

  // ================================================================ drive joints
  function driveCmd() {
    const joints = (store.doc.joints || []).filter((j) => j.type !== "rigid");
    if (!joints.length) { app.toast("Add a joint first (Joint)."); return; }
    let anim = null;
    const def = {
      title: "Drive joints",
      okLabel: "Done",
      keepSelection: true,
      ok() { stop(); closeCmd(false); },
      hint: () => "Drag a slider to move its joint. The design itself doesn't change unless you apply the positions.",
      build(body) {
        for (const j of joints) {
          const b = findBody(store.doc, j.body);
          const v = val(j);
          const [lo, hi] = range(j);
          body.append(el("div", { class: "subhead" }, `${j.name} · ${b ? b.name : "?"} · ${j.type}`));
          if (j.type !== "slider") body.append(sliderRow("Angle", "dr-a-" + j.id, v.a, lo === -50 ? -180 : lo, hi === 50 ? 180 : hi, 1, "°", (x) => { values.set(j.id, { ...val(j), a: x }); showPose(); }));
          if (j.type === "slider" || j.type === "cylindrical") body.append(sliderRow("Slide", "dr-s-" + j.id, v.s, j.type === "slider" ? lo : -50, j.type === "slider" ? hi : 50, 0.5, "mm", (x) => { values.set(j.id, { ...val(j), s: x }); showPose(); }));
        }
        body.append(el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" } },
          el("button", { class: "btn", id: "dr-anim", onclick: () => (anim ? stop() : play()) }, anim ? "Stop" : "Animate all"),
          el("button", { class: "btn", id: "dr-reset", onclick: () => { stop(); resetPose(); def.render(); } }, "Reset"),
          el("button", { class: "btn", id: "dr-apply", onclick: () => { stop(); applyPose(); def.render(); } }, "Apply positions")));
      },
      cleanup() { stop(); },
    };
    function play() {
      const t0 = performance.now();
      const step = () => {
        const t = (performance.now() - t0) / 1000;
        for (const j of joints) {
          const [lo, hi] = range(j);
          const k = 0.5 - 0.5 * Math.cos(t * 1.4);
          values.set(j.id, j.type === "slider" ? { a: 0, s: lo + (hi - lo) * k } : { a: lo + (hi - lo) * k, s: j.type === "cylindrical" ? -20 + 40 * k : 0 });
        }
        showPose();
        anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
      def.render();
    }
    function stop() { if (anim) { cancelAnimationFrame(anim); anim = null; def.render && def.render(); } }
    openCmd(def);
  }

  // ================================================================ collisions
  // sample points just inside each body's surface; a point inside another body = contact
  const sampleCache = new Map();
  function bodySamples(id) {
    const base = baseOf(id);
    if (!base) return null;
    let s = sampleCache.get(base.data);
    if (!s) {
      const V = base.data.vertices, N = base.data.normals, n = V.length / 3, step = Math.max(1, Math.floor(n / 160)), pts = [];
      const bb = base.data.bbox, inset = Math.max(0.02, Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) * 0.004);
      for (let i = 0; i < n; i += step) pts.push(new THREE.Vector3(V[i * 3] - N[i * 3] * inset, V[i * 3 + 1] - N[i * 3 + 1] * inset, V[i * 3 + 2] - N[i * 3 + 2] * inset));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(V, 3));
      g.setIndex(new THREE.BufferAttribute(base.data.triangles, 1));
      g.computeBoundingBox(); g.computeBoundingSphere();
      s = { pts, g };
      sampleCache.set(base.data, s);
      if (sampleCache.size > 30) sampleCache.delete(sampleCache.keys().next().value);
    }
    return { ...s, m: base.m };
  }
  const rc = new THREE.Raycaster();
  const rayMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  function inside(mesh, p) {
    rc.set(p, new THREE.Vector3(0.5773, 0.5774, 0.5772));
    return rc.intersectObject(mesh, false).length % 2 === 1;
  }
  // pairs of bodies that overlap in a pose
  function collisions(pose) {
    const ids = bodies().map((b) => b.id);
    const items = ids.map((id) => {
      const s = bodySamples(id);
      if (!s) return null;
      const M = s.m.clone();
      const P = pose.get(id);
      if (P) M.premultiply(P);
      const mesh = new THREE.Mesh(s.g, rayMat);
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(M); mesh.matrixWorld.copy(M);
      const box = s.g.boundingBox.clone().applyMatrix4(M);
      return { id, s, M, mesh, box };
    }).filter(Boolean);
    const hits = [];
    for (let i = 0; i < items.length; i++) for (let k = i + 1; k < items.length; k++) {
      const A = items[i], B = items[k];
      if (!pose.has(A.id) && !pose.has(B.id)) continue; // only moving parts can newly collide
      if (!A.box.intersectsBox(B.box)) continue;
      let hit = false;
      for (const [P, Q] of [[A, B], [B, A]]) {
        for (const p of P.s.pts) { const w = p.clone().applyMatrix4(P.M); if (Q.box.containsPoint(w) && inside(Q.mesh, w)) { hit = true; break; } }
        if (hit) break;
      }
      if (hit) hits.push([A.id, B.id]);
    }
    return hits;
  }

  // ================================================================ motion study
  function motionCmd() {
    const joints = (store.doc.joints || []).filter((j) => j.type !== "rigid");
    if (!joints.length) { app.toast("Add a joint first (Joint)."); return; }
    const st = { driver: joints[0].id, from: null, to: null, secs: 3, mode: "pingpong", links: {}, check: true, t: 0, playing: false, log: [] };
    const drv = () => joints.find((j) => j.id === st.driver);
    const resetRange = () => { const [lo, hi] = range(drv()); st.from = drv().type === "slider" ? lo : lo === -180 ? 0 : lo; st.to = drv().type === "slider" ? hi : hi === 180 ? 360 : hi; };
    resetRange();
    let raf = null, lastCheck = 0;
    const def = {
      title: "Motion study",
      okLabel: "Done",
      keepSelection: true,
      ok() { stop(); closeCmd(false); },
      hint: () => "Play the motion. Linked joints follow the driver by their ratio (gears, belts). Collisions turn red.",
      build(body) {
        const sel = el("select", { class: "num", id: "ms-driver", "aria-label": "Driving joint" }, ...joints.map((j) => el("option", { value: j.id, selected: j.id === st.driver }, `${j.name} (${j.type})`)));
        sel.onchange = () => { st.driver = sel.value; resetRange(); def.render(); };
        body.append(row("Driver", sel, "ms-driver"));
        const unit = drv().type === "slider" ? "mm" : "°";
        const r3el = el("div", { class: "row3" });
        r3el.append(el("label", {}, "From " + unit, app.numField({ value: st.from, id: "ms-from", onCommit: (v) => { st.from = v; } })));
        r3el.append(el("label", {}, "To " + unit, app.numField({ value: st.to, id: "ms-to", onCommit: (v) => { st.to = v; } })));
        r3el.append(el("label", {}, "Seconds", app.numField({ value: st.secs, id: "ms-secs", min: 0.2, onCommit: (v) => { st.secs = v; } })));
        body.append(r3el);
        body.append(row("Play", seg([["once", "Once"], ["loop", "Loop"], ["pingpong", "Back & forth"]], st.mode, (v) => { st.mode = v; def.render(); }, "ms-mode")));
        const others = joints.filter((j) => j.id !== st.driver);
        if (others.length) {
          body.append(el("div", { class: "subhead" }, "Linked joints (ratio × driver)"));
          for (const j of others) body.append(row(j.name, app.numField({ value: st.links[j.id] ?? 0, id: "ms-l-" + j.id, onCommit: (v) => { st.links[j.id] = v; } }), "ms-l-" + j.id));
        }
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ms-check", checked: st.check, onchange: (e) => { st.check = e.target.checked; if (!st.check) { scene.state.collide = new Set(); scene.refresh(); } } }), "Check for collisions"));
        body.append(sliderRow("Time", "ms-t", Math.round(st.t * 1000) / 10, 0, 100, 0.5, "%", (v) => { stop(); st.t = v / 100; frame(true); }));
        body.append(el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" } },
          el("button", { class: "btn primary", id: "ms-play", onclick: () => (st.playing ? stop() : play()) }, st.playing ? "Pause" : "Play"),
          el("button", { class: "btn", id: "ms-scan", onclick: () => scan() }, "Find collisions"),
          el("button", { class: "btn", onclick: () => { stop(); st.t = 0; resetPose(); st.log = []; def.render(); } }, "Reset")));
        body.append(el("div", { class: "hint", id: "ms-log", style: { padding: 0, whiteSpace: "pre-line" } }, st.log.length ? st.log.join("\n") : "No collisions found yet."));
      },
      cleanup() { stop(); resetPose(); },
    };
    function valueAt(t) { return st.from + (st.to - st.from) * t; }
    function setAt(t) {
      const v = valueAt(t), d = drv();
      const vals = new Map(values);
      vals.set(d.id, d.type === "slider" ? { a: 0, s: v } : { a: v, s: 0 });
      for (const j of joints) if (j.id !== d.id && st.links[j.id]) vals.set(j.id, j.type === "slider" ? { a: 0, s: v * st.links[j.id] } : { a: v * st.links[j.id], s: 0 });
      return vals;
    }
    function frame(force) {
      const vals = setAt(st.t);
      for (const [k, v] of vals) values.set(k, v);
      const pose = computePose(store.view, vals);
      scene.state.pose = pose;
      if (st.check && (force || performance.now() - lastCheck > 120)) {
        lastCheck = performance.now();
        const hits = collisions(pose);
        scene.state.collide = new Set(hits.flat());
        if (hits.length) {
          const names = hits.map(([a, b]) => `${findBody(store.doc, a)?.name} ↔ ${findBody(store.doc, b)?.name}`).join(", ");
          const line = `Collision at ${fmt(valueAt(st.t), 1)}${drv().type === "slider" ? " mm" : "°"}: ${names}`;
          if (!st.log.includes(line) && st.log.length < 8) { st.log.push(line); const lg = document.getElementById("ms-log"); if (lg) lg.textContent = st.log.join("\n"); }
        }
      }
      scene.refresh();
      const ts = document.getElementById("ms-t-range"); if (ts) ts.value = st.t * 100;
      const tn = document.getElementById("ms-t"); if (tn && document.activeElement !== tn) tn.value = fmt(st.t * 100, 1);
    }
    function play() {
      st.playing = true;
      let last = performance.now(), dir = 1;
      if (st.t >= 1 && st.mode === "once") st.t = 0;
      const step = (now) => {
        const dt = (now - last) / 1000; last = now;
        st.t += (dir * dt) / Math.max(0.2, st.secs);
        if (st.t > 1) { if (st.mode === "loop") st.t = 0; else if (st.mode === "pingpong") { st.t = 1; dir = -1; } else { st.t = 1; frame(true); stop(); return; } }
        if (st.t < 0) { st.t = 0; dir = 1; }
        frame(false);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      const b = document.getElementById("ms-play"); if (b) b.textContent = "Pause";
    }
    function stop() { st.playing = false; if (raf) cancelAnimationFrame(raf); raf = null; const b = document.getElementById("ms-play"); if (b) b.textContent = "Play"; }
    // step through the whole range and list where parts run into each other
    function scan() {
      stop();
      const N = 72, spans = [];
      let cur = null;
      for (let i = 0; i <= N; i++) {
        const t = i / N, hits = collisions(computePose(store.view, setAt(t)));
        const key = hits.map((h) => h.join("|")).sort().join(",");
        if (hits.length && (!cur || cur.key !== key)) { cur = { key, from: valueAt(t), to: valueAt(t), hits }; spans.push(cur); }
        else if (hits.length) cur.to = valueAt(t);
        else cur = null;
      }
      const u = drv().type === "slider" ? " mm" : "°";
      st.log = spans.length ? spans.map((s) => `${fmt(s.from, 1)}${u} → ${fmt(s.to, 1)}${u}: ${s.hits.map(([a, b]) => `${findBody(store.doc, a)?.name} ↔ ${findBody(store.doc, b)?.name}`).join(", ")}`) : ["No collisions over the whole range."];
      def.render();
    }
    openCmd(def);
    frame(true);
  }

  // ================================================================ stress & print strength
  const DETAIL = { coarse: 2500, medium: 6000, fine: 14000 };
  const DIRS = { normal: "Into the face", out: "Out of the face", "+x": "+X", "-x": "−X", "+y": "+Y", "-y": "−Y", "+z": "+Z", "-z": "−Z" };
  const ORIENT = { z: { label: "Z up (as modeled)", b: [0, 0, 1] }, x: { label: "X up (tipped onto its side)", b: [1, 0, 0] }, y: { label: "Y up (tipped forward)", b: [0, 1, 0] } };
  const simGroup = new THREE.Group();
  vp.world.add(simGroup);
  let legend = null;
  function clearResults() {
    for (const c of [...simGroup.children]) { simGroup.remove(c); c.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); }); }
    scene.state.simHide = new Set();
    scene.refresh();
    if (legend) { legend.remove(); legend = null; }
    vp.request();
  }
  function faceTris(base, face) {
    const [s, c] = base.data.faceGroups[face];
    const V = base.data.vertices, T = base.data.triangles, out = [];
    const P = (i) => V3([V[i * 3], V[i * 3 + 1], V[i * 3 + 2]]).applyMatrix4(base.m).toArray();
    for (let t = s; t < s + c; t += 3) out.push([P(T[t]), P(T[t + 1]), P(T[t + 2])]);
    return out;
  }
  function analysisCmd(mode) {
    const print = mode === "print";
    const st = { body: app.sel.length === 1 ? app.sel[0] : null, target: "fixed", fixed: [], loads: [], loadType: "force", dir: "normal", mag: 100, material: "aluminum", filament: "pla", infill: 20, walls: 3, orient: "z", detail: "medium", res: null, running: false, defScale: 1, showDef: true };
    let model = null, hover = null;
    const def = {
      title: print ? "3D print strength" : "Stress test",
      okLabel: "Done",
      keepSelection: true,
      wide: true,
      ok() { cancel(); closeCmd(false); },
      hint: () => !st.body ? "Click a face of the body to test." : st.target === "fixed" ? "Click the faces that are held still (bolted, glued, resting)." : "Click the faces the force or pressure acts on.",
      build(body) {
        const b = st.body && findBody(store.doc, st.body);
        body.append(row("Body", pickbox(false, b ? el("b", {}, b.name) : "Click a face of a body", b ? () => { st.body = null; st.fixed = []; st.loads = []; reset(); } : null)));
        body.append(row("Held still", pickbox(st.target === "fixed", st.fixed.length ? el("span", {}, el("b", {}, st.fixed.length), " face" + (st.fixed.length > 1 ? "s" : "")) : "Click faces", st.fixed.length ? () => { st.fixed = []; reset(); } : null, () => { st.target = "fixed"; def.render(); })));
        body.append(row("Loaded", pickbox(st.target === "load", st.loads.length ? el("span", {}, el("b", {}, st.loads.length), " face" + (st.loads.length > 1 ? "s" : "")) : "Click faces", st.loads.length ? () => { st.loads = []; reset(); } : null, () => { st.target = "load"; def.render(); })));
        body.append(row("Load", seg([["force", "Force (N)"], ["pressure", "Pressure (MPa)"]], st.loadType, (v) => { st.loadType = v; reset(); }, "an-ltype")));
        const dsel = el("select", { class: "num", id: "an-dir", "aria-label": "Direction" }, ...Object.entries(DIRS).map(([k, l]) => el("option", { value: k, selected: k === st.dir }, l)));
        dsel.onchange = () => { st.dir = dsel.value; reset(); };
        body.append(row("Direction", dsel, "an-dir"));
        body.append(row(st.loadType === "force" ? "Force (N)" : "Pressure (MPa)", app.numField({ value: st.mag, id: "an-mag", min: 0, step: st.loadType === "force" ? 10 : 0.1, onCommit: (v) => { st.mag = v; if (st.res) evaluate(); } }), "an-mag"));
        if (print) {
          const fsel = el("select", { class: "num", id: "an-fil", "aria-label": "Filament" }, ...Object.entries(FILAMENTS).map(([k, m]) => el("option", { value: k, selected: k === st.filament }, m.name)));
          fsel.onchange = () => { st.filament = fsel.value; if (st.res) evaluate(); else def.render(); };
          body.append(row("Filament", fsel, "an-fil"));
          body.append(sliderRow("Infill", "an-infill", st.infill, 0, 100, 5, "%", (v) => { st.infill = v; if (st.res) evaluateSoon(); }));
          body.append(row("Walls", app.numField({ value: st.walls, id: "an-walls", min: 1, max: 12, step: 1, onCommit: (v) => { st.walls = Math.round(v); if (st.res) evaluate(); } }), "an-walls"));
          body.append(row("Print orientation", seg(Object.entries(ORIENT).map(([k, o]) => [k, o.label.split(" (")[0]]), st.orient, (v) => { st.orient = v; if (st.res) evaluate(); else { def.render(); drawSetup(); } }, "an-orient")));
        } else {
          const msel = el("select", { class: "num", id: "an-mat", "aria-label": "Material" }, ...Object.entries(MATERIALS).map(([k, m]) => el("option", { value: k, selected: k === st.material }, m.name)));
          msel.onchange = () => { st.material = msel.value; if (st.res) evaluate(); };
          body.append(row("Material", msel, "an-mat"));
        }
        body.append(row("Mesh", seg([["coarse", "Coarse"], ["medium", "Medium"], ["fine", "Fine"]], st.detail, (v) => { st.detail = v; reset(); }, "an-detail")));
        body.append(el("button", { class: "btn primary", id: "an-run", disabled: st.running || !st.fixed.length || !st.loads.length, onclick: () => run(), style: { width: "100%", marginTop: "4px" } }, st.running ? "Solving…" : st.res ? "Run again" : "Run simulation"));
        body.append(el("div", { class: "hint", id: "an-status", style: { padding: 0 } }, st.running ? "Building the mesh…" : !st.fixed.length || !st.loads.length ? "Pick faces that are held still and faces that carry the load." : ""));
        if (st.res) body.append(resultsBlock());
      },
      cleanup() { cancel(); clearResults(); clearOv(); },
      handler: {
        hover(e) { const f = pickBaseFace(e, (b) => !b.hole && (!st.body || b.id === st.body)); hover = f && f.info ? f : null; drawSetup(); vp.canvas.style.cursor = hover ? "pointer" : "default"; },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && (!st.body || b.id === st.body));
          if (!f || !f.info) return true;
          if (!st.body) st.body = f.body;
          const list = st.target === "fixed" ? st.fixed : st.loads, other = st.target === "fixed" ? st.loads : st.fixed;
          if (other.some((x) => x.face === f.face)) { app.toast(st.target === "fixed" ? "That face already carries the load." : "That face is already held still. Pick a different face for the load."); return true; }
          const i = list.findIndex((x) => x.face === f.face);
          if (i >= 0) list.splice(i, 1); else list.push({ face: f.face, base: f.base, info: f.info });
          // first pick the supports, then the loads
          if (st.target === "fixed" && list.length === 1 && !st.loads.length) st.target = "load";
          reset();
          return true;
        },
      },
    };
    function reset() { st.res = null; model = null; clearResults(); def.render(); drawSetup(); }
    function cancel() { if (model) model.cancel = true; }
    function drawSetup() {
      clearOv();
      for (const f of st.fixed) drawFace(f.base, f.face, 0x2f8a4c);
      for (const f of st.loads) {
        drawFace(f.base, f.face, 0xd9534f);
        // a few load arrows
        const tris = faceTris(f.base, f.face).slice(0, 400);
        const pts = samplePoints(tris, 0.02).slice(0, 6);
        for (const s of pts) {
          const d = loadDir(s.n), p = V3(s.p), L = Math.max(4, (scene.bodyTightBox(st.body)?.getSize(new THREE.Vector3()).length() || 40) * 0.12);
          drawLine([p.clone().addScaledVector(d, -L), p], 0xd9534f);
        }
      }
      if (hover) drawFace(hover.base, hover.face, 0xe8a317);
      if (print && st.body) {
        // build direction arrow (layers stack along it)
        const bb = scene.bodyTightBox(st.body);
        if (bb) { const c = bb.getCenter(new THREE.Vector3()), b = V3(ORIENT[st.orient].b), L = bb.getSize(new THREE.Vector3()).length() * 0.6; drawLine([c.clone().addScaledVector(b, -L * 0.2), c.clone().addScaledVector(b, L)], 0x7b4fa8); drawDot(c.clone().addScaledVector(b, L), 0x7b4fa8, 12); }
      }
    }
    function loadDir(n) {
      const N = V3(n).normalize();
      return { normal: N.clone().negate(), out: N, "+x": V3([1, 0, 0]), "-x": V3([-1, 0, 0]), "+y": V3([0, 1, 0]), "-y": V3([0, -1, 0]), "+z": V3([0, 0, 1]), "-z": V3([0, 0, -1]) }[st.dir];
    }
    async function run() {
      const base = baseOf(st.body);
      if (!base) return;
      st.running = true; st.res = null; clearResults(); def.render();
      const status = () => document.getElementById("an-status");
      try {
        // the body in world space
        const V = base.data.vertices, n = V.length / 3, pos = new Float32Array(V.length), tmp = new THREE.Vector3();
        for (let i = 0; i < n; i++) { tmp.set(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]).applyMatrix4(base.m); pos[i * 3] = tmp.x; pos[i * 3 + 1] = tmp.y; pos[i * 3 + 2] = tmp.z; }
        await new Promise((r) => setTimeout(r, 20));
        const vox = voxelize(pos, base.data.triangles, DETAIL[st.detail]);
        model = buildModel(vox);
        if (model.nE < 8) throw new Error("This body is too thin for the mesh. Try Fine.");
        const fixed = new Uint8Array(model.nN * 3), f = new Float64Array(model.nN * 3);
        const dens = 4 / Math.min(...model.hs) ** 2;
        for (const fc of st.fixed) for (const s of samplePoints(faceTris(fc.base, fc.face), dens)) { const id = nearestNode(model, s.p); if (id >= 0) for (let c = 0; c < 3; c++) fixed[id * 3 + c] = 1; }
        let area = 0;
        const loadPts = [];
        for (const fc of st.loads) for (const s of samplePoints(faceTris(fc.base, fc.face), dens)) { loadPts.push(s); area += s.w; }
        // solve for a unit load; results scale with the load you type
        const unitTotal = st.loadType === "force" ? 1 : area; // 1 N total, or 1 MPa over the area
        for (const s of loadPts) {
          const id = nearestNode(model, s.p);
          if (id < 0) continue;
          const d = loadDir(s.n), w = (s.w / area) * unitTotal;
          f[id * 3] += d.x * w; f[id * 3 + 1] += d.y * w; f[id * 3 + 2] += d.z * w;
        }
        if (!fixed.some((x) => x)) throw new Error("The held-still faces didn't reach the mesh. Try Fine.");
        const nu = print ? 0.35 : MATERIALS[st.material].nu;
        const sol = await solve(model, fixed, f, nu, (it, res) => { const s = status(); if (s) s.textContent = `Solving… step ${it} (accuracy ${res.toExponential(1)})`; });
        st.res = { sol, model, area, vol: vox.vol, surf: surfaceArea(pos, base.data.triangles) };
        st.running = false;
        evaluate();
      } catch (e) {
        st.running = false;
        if (e.message !== "cancelled") app.toast(e.message || "The simulation failed.", "err");
        def.render();
      }
    }
    function surfaceArea(pos, tri) {
      let a = 0;
      for (let t = 0; t < tri.length; t += 3) {
        const A = tri[t] * 3, B = tri[t + 1] * 3, C = tri[t + 2] * 3;
        const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2], vx = pos[C] - pos[A], vy = pos[C + 1] - pos[A + 1], vz = pos[C + 2] - pos[A + 2];
        a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      }
      return a;
    }
    // printed parts: walls are solid, the inside is partly filled
    function solidFraction() {
      const r = st.res, shell = Math.min(1, (r.surf * st.walls * 0.45) / Math.max(r.vol, 1e-9));
      return shell + (1 - shell) * (st.infill / 100);
    }
    function printSF(b, fil, k) {
      const S = st.res.sol.nodeS, nN = st.res.model.nN, scale = st.mag;
      let worst = 0, at = -1, mode = "";
      for (let i = 0; i < nN; i++) {
        const s = Array.from(S.subarray(i * 6, i * 6 + 6), (x) => x * scale);
        const r = printFailure(s, b, fil.xy * k, fil.z * k);
        if (r.fi > worst) { worst = r.fi; at = i; mode = r.mode; }
      }
      return { sf: worst > 0 ? 1 / worst : Infinity, at, mode, worst };
    }
    let soonT = 0;
    function evaluateSoon() { clearTimeout(soonT); soonT = setTimeout(evaluate, 150); }
    function evaluate() {
      const r = st.res;
      if (!r) return;
      const { sol, model } = r;
      const scale = st.mag;
      let vmMax = 0, vmAt = 0;
      for (let i = 0; i < model.nN; i++) if (sol.nodeVM[i] > vmMax) { vmMax = sol.nodeVM[i]; vmAt = i; }
      vmMax *= scale;
      let E, value, label, sf, worstAt = vmAt, mode = "", extra = {};
      if (print) {
        const fil = FILAMENTS[st.filament], k = solidFraction();
        E = fil.E * k;
        const p = printSF(ORIENT[st.orient].b, fil, k);
        sf = p.sf; worstAt = p.at; mode = p.mode;
        extra.k = k;
        extra.orients = Object.entries(ORIENT).map(([key, o]) => ({ key, label: o.label, sf: printSF(o.b, fil, k).sf }));
        extra.filaments = Object.entries(FILAMENTS).map(([key, m]) => ({ key, name: m.name, sf: printSF(ORIENT[st.orient].b, m, k).sf, flexible: m.flexible }));
        extra.mass = r.vol * k * fil.rho / 1000;
        label = "Failure index (1 = breaks)";
        value = (i) => { const s = Array.from(sol.nodeS.subarray(i * 6, i * 6 + 6), (x) => x * scale); return printFailure(s, ORIENT[st.orient].b, fil.xy * k, fil.z * k).fi; };
      } else {
        const mat = MATERIALS[st.material];
        E = mat.E; sf = mat.yield / Math.max(vmMax, 1e-12);
        extra.mass = (r.vol * mat.rho) / 1000;
        label = "Von Mises stress (MPa)";
        value = (i) => sol.nodeVM[i] * scale;
      }
      let dMax = 0;
      for (let i = 0; i < model.nN; i++) dMax = Math.max(dMax, Math.hypot(sol.u[i * 3], sol.u[i * 3 + 1], sol.u[i * 3 + 2]));
      dMax = (dMax * scale) / E;
      st.out = { vmMax, sf, dMax, E, mode, worstAt, extra, label };
      showResults(value, print ? 1 : vmMax, E, label);
      def.render();
    }
    function resultsBlock() {
      const o = st.out;
      if (!o) return el("div");
      const verdict = o.sf < 1 ? ["Breaks", "bad"] : o.sf < 2 ? ["Marginal", "warn"] : ["OK", "good"];
      const wrap = el("div", { class: "simres" });
      wrap.append(el("div", { class: "simtiles" },
        el("div", { class: "simtile " + verdict[1] }, el("span", {}, "Safety factor"), el("b", { id: "an-sf" }, o.sf === Infinity ? "∞" : o.sf > 1000 ? "> 1000" : fmt(o.sf, 2)), el("i", {}, verdict[0])),
        el("div", { class: "simtile" }, el("span", {}, "Max stress"), el("b", {}, fmt(o.vmMax, 2) + " MPa")),
        el("div", { class: "simtile" }, el("span", {}, "Max bend"), el("b", {}, fmt(o.dMax, 3) + " mm")),
        el("div", { class: "simtile" }, el("span", {}, "Mass"), el("b", {}, fmt(o.extra.mass, 1) + " g"))));
      if (print) {
        wrap.append(el("div", { class: "hint", style: { padding: 0 } }, `Weakest spot: ${o.mode}. About ${Math.round(o.extra.k * 100)}% solid with ${st.walls} walls and ${st.infill}% infill.`));
        const best = o.extra.orients.reduce((a, b) => (b.sf > a.sf ? b : a));
        const t1 = el("table", { class: "simtable" }, el("tr", {}, el("th", {}, "Orientation"), el("th", {}, "Safety")),
          ...o.extra.orients.map((x) => el("tr", { class: x.key === st.orient ? "cur" : "" }, el("td", {}, x.label + (x === best ? " ★" : "")), el("td", {}, fmt(x.sf, 2)))));
        wrap.append(t1);
        const t2 = el("table", { class: "simtable" }, el("tr", {}, el("th", {}, "Filament (this orientation)"), el("th", {}, "Safety")),
          ...o.extra.filaments.slice().sort((a, b) => b.sf - a.sf).map((x) => el("tr", { class: x.key === st.filament ? "cur" : "" }, el("td", {}, x.name + (x.flexible ? " (bends a lot)" : "")), el("td", {}, fmt(x.sf, 2)))));
        wrap.append(t2);
        if (best.key !== st.orient) wrap.append(el("div", { class: "hint", style: { padding: 0 } }, `Printing ${best.label.split(" (")[0]} would be about ${fmt(best.sf / Math.max(o.sf, 1e-9), 1)}× stronger.`));
      }
      wrap.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "an-def", checked: st.showDef, onchange: (e) => { st.showDef = e.target.checked; evaluate(); } }), "Show exaggerated bending"));
      wrap.append(el("div", { class: "hint", style: { padding: 0 } }, "A quick linear estimate on a voxel mesh with typical material values. Check critical parts with real testing."));
      return wrap;
    }
    // colored copy of the body (bent if asked), the undeformed outline, the weakest spot
    function showResults(value, vmax, E, label) {
      clearResults();
      const base = baseOf(st.body);
      const { sol, model } = st.res;
      const nodeVal = new Float64Array(model.nN);
      for (let i = 0; i < model.nN; i++) nodeVal[i] = value(i);
      const V = base.data.vertices, n = V.length / 3;
      const pos = new Float32Array(V.length), col = new Float32Array(V.length), tmp = new THREE.Vector3();
      let dMax = 0;
      for (let i = 0; i < model.nN; i++) dMax = Math.max(dMax, Math.hypot(sol.u[i * 3], sol.u[i * 3 + 1], sol.u[i * 3 + 2]));
      const bb = scene.bodyTightBox(st.body), size = bb ? bb.getSize(new THREE.Vector3()).length() : 50;
      // exaggerate small bending so it shows; big bending is shown at true size
      const k = st.showDef && dMax > 0 ? Math.max((size * 0.06) / dMax, st.mag / E) : 0;
      for (let i = 0; i < n; i++) {
        tmp.set(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]).applyMatrix4(base.m);
        const id = nearestNode(model, tmp.toArray());
        const v = id >= 0 ? nodeVal[id] : 0;
        const c = heat(vmax > 0 ? v / vmax : 0);
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        if (id >= 0 && k) tmp.add(new THREE.Vector3(sol.u[id * 3] * k, sol.u[id * 3 + 1] * k, sol.u[id * 3 + 2] * k));
        pos[i * 3] = tmp.x; pos[i * 3 + 1] = tmp.y; pos[i * 3 + 2] = tmp.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setIndex(new THREE.BufferAttribute(base.data.triangles, 1));
      g.computeVertexNormals();
      simGroup.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide })));
      // undeformed outline
      const L = base.data.lines, lp = [];
      for (const [s, c] of base.data.edgeGroups) for (let i = s; i < s + c - 1; i++) {
        lp.push(V3([L[i * 3], L[i * 3 + 1], L[i * 3 + 2]]).applyMatrix4(base.m), V3([L[i * 3 + 3], L[i * 3 + 4], L[i * 3 + 5]]).applyMatrix4(base.m));
      }
      if (k) simGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lp), new THREE.LineBasicMaterial({ color: 0x6b7785, transparent: true, opacity: 0.5 })));
      // weakest spot
      const w = st.out ? st.out.worstAt : -1;
      if (w >= 0) {
        const p = V3(Array.from(model.coords.subarray(w * 3, w * 3 + 3)));
        const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.6, size * 0.012), 16, 12), new THREE.MeshBasicMaterial({ color: 0xff2d55, depthTest: false }));
        m.position.copy(p); m.renderOrder = 15;
        simGroup.add(m);
      }
      scene.state.simHide = new Set([st.body]);
      scene.refresh();
      // legend
      legend = el("div", { class: "simlegend" }, el("div", { class: "t" }, label),
        el("div", { class: "bar" }), el("div", { class: "ends" }, el("span", {}, "0"), el("span", {}, print ? "1+" : fmt(vmax, 1))),
        k ? el("div", { class: "t2" }, (k * E) / Math.max(st.mag, 1e-9) < 1.5 ? "Bending shown at true size" : `Bending shown ×${fmt((k * E) / Math.max(st.mag, 1e-9), 0)} (exaggerated)`) : null);
      document.getElementById("viewport").append(legend);
      vp.request();
    }
    openCmd(def);
    drawSetup();
  }

  return { jointCmd, driveCmd, motionCmd, stressCmd: () => analysisCmd("stress"), printCmd: () => analysisCmd("print"), resetPose, applyPose, hasPose: () => scene.state.pose.size > 0 };
}
