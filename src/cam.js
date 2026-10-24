// CAM Studio (Advanced → Simulate → CAM): plan how a CNC router, mill or laser cuts the design,
// watch a simulation of the cutting, and save or send the G-code. Basic mode is a few choices with
// sensible numbers worked out for you; Pro mode shows every operation and setting. The engine is
// in camcore.js (open methods, written for JumpStart 3D).
import * as THREE from "three";
import { store, findBody } from "./store.js";
import { el } from "./util.js";
import { isInch } from "./units.js";
import { ICON } from "./icons.js";
import { MACHINES, MATERIALS, TOOLS, POSTS, feedsSpeeds, buildProgram, programStats, toGcode, StockSim, RotarySim, workOrigin, moveLen } from "./camcore.js";

const IN = 25.4;
const MAT_COL = { pine: "#e3c08f", oak: "#c49a6c", ply: "#dcbc8c", mdf: "#b98f63", acrylic: "#cfe6f2", hdpe: "#f1f1ec", foam: "#e9e2c2", wax: "#4c8fd6", alu: "#c3c8cf", brass: "#d5b14e", card: "#c9a678" };
const OP_COL = { rrough: 0xe8a317, rfinish: 0x1f8f5a, rough: 0xe8a317, face: 0x9a7cc7, finish: 0x1f8f5a, cutout: 0x2f6fd0, lasercut: 0xd9534f, engrave: 0x8a4f2f };
const OP_NAMES = { rrough: "Rotary roughing", rfinish: "Rotary finishing", rough: "Roughing", face: "Facing", finish: "Finishing", cutout: "Cutout", lasercut: "Laser cut", engrave: "Laser engrave" };
const QUALITY = { draft: { res: 0.5, so: 0.2, tol: 0.05, name: "Draft (fast)" }, normal: { res: 0.3, so: 0.12, tol: 0.03, name: "Normal" }, fine: { res: 0.2, so: 0.07, tol: 0.015, name: "Fine (slow, smooth)" } };
const LS = "jumpstart3d.cam.";

export function initCam(app) {
  let ui = null;
  const pref = (k, d) => { try { const v = JSON.parse(localStorage.getItem(LS + k)); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };
  // your own machines and bits, kept on this device
  const lib = () => pref("lib", { machines: [], tools: [] });
  const machines = () => [...MACHINES, ...lib().machines];
  const tools = () => [...TOOLS, ...lib().tools];
  const len = (mm, dp = 2) => (isInch() ? +(mm / IN).toFixed(dp + 1) + '"' : +mm.toFixed(dp) + " mm");
  const fmtTime = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h} h ${m} min` : m ? `${m} min ${x} s` : `${x} s`; };

  // ------------------------------------------------------------ the model
  function trisOf(id) {
    const v = app.scene.views.get(id);
    if (!v || !v.data || !v.mesh) return null;
    v.mesh.updateMatrixWorld(true);
    const M = v.mesh.matrixWorld, P = v.data.vertices, T = v.data.triangles, out = new Float32Array(T.length * 3), p = new THREE.Vector3();
    for (let i = 0; i < T.length; i++) { const k = T[i] * 3; p.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(M); out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; }
    return out;
  }
  function modelTris(ids) {
    const parts = ids.map(trisOf).filter(Boolean), n = parts.reduce((a, t) => a + t.length, 0), out = new Float32Array(n);
    let o = 0; for (const t of parts) { out.set(t, o); o += t.length; }
    return out;
  }
  function triBox(t) { const b = new THREE.Box3(); for (let i = 0; i < t.length; i += 3) b.expandByPoint(new THREE.Vector3(t[i], t[i + 1], t[i + 2])); return b; }

  // ------------------------------------------------------------ settings
  function defaults() {
    const inch = isInch();
    return {
      level: pref("level", "basic"), machine: pref("machine", "mhobby"), material: pref("material", "pine"), tool: pref("tool", inch ? "f14" : "f6"), finishTool: pref("finishTool", inch ? "b18" : "b3"),
      job: "both", axes: "3", raxis: "x", rdia: null, quality: "normal", tabs: true, margin: 5, extraTop: 1, thick: null, origin: "fl-top", post: null, units: null, ops: null, speed: 20, show: { paths: true, model: false, stock: true },
    };
  }
  const mach = () => machines().find((m) => m.id === ui.s.machine) || MACHINES[1];
  const mat = () => MATERIALS.find((m) => m.id === ui.s.material) || MATERIALS[0];
  const toolById = (id) => tools().find((t) => t.id === id) || TOOLS[0];
  // ---- 4th axis: the model turned so the rotary axis runs along X, the axis through its middle
  const isRot = () => ui.s.axes === "4" && mach().kind !== "laser";
  function rotModel() {
    const key = ui.s.raxis;
    if (ui.rot && ui.rot.key === key) return ui.rot;
    const src = ui.tris, t = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) { if (key === "y") { t[i] = src[i + 1]; t[i + 1] = -src[i]; } else { t[i] = src[i]; t[i + 1] = src[i + 1]; } t[i + 2] = src[i + 2]; }
    const b = triBox(t), yc = (b.min.y + b.max.y) / 2, zc = (b.min.z + b.max.z) / 2;
    let rMax = 0; for (let i = 0; i < t.length; i += 3) rMax = Math.max(rMax, Math.hypot(t[i + 1] - yc, t[i + 2] - zc));
    ui.rot = { key, tris: t, yc, zc, rMax, x0: b.min.x, x1: b.max.x };
    return ui.rot;
  }
  const rotDia = () => ui.s.rdia || Math.ceil((rotModel().rMax + (ui.s.extraTop || 1)) * 2);
  // the operations Basic makes from a few choices (Pro starts from these too)
  function basicOps() {
    const s = ui.s, M = mach(), m = mat(), q = QUALITY[s.quality];
    if (isRot()) {
      let rt = toolById(s.tool); if (rt.type === "laser") rt = toolById("f6");
      const ft = s.finishTool ? toolById(s.finishTool) : rt;
      return [{ type: "rrough", name: "Rotary roughing", tool: rt, ...feedsSpeeds(rt, m, M), leave: ft.id === rt.id ? 0.2 : 0.5 }, { type: "rfinish", name: "Rotary finishing", tool: ft, ...feedsSpeeds(ft, m, M), stepover: q.so * (ft.type === "flat" ? 1.6 : 1), tol: q.tol }];
    }
    if (M.kind === "laser") {
      const t = toolById("laser"), fs = feedsSpeeds(t, m, M), ops = [];
      if (s.job !== "cutout") ops.push({ type: "engrave", name: "Laser engrave", tool: t, rpm: M.rpmMax, feed: fs.engraveFeed, plunge: 600, power: fs.engrave, line: Math.max(0.1, q.res) });
      if (s.job !== "carve") ops.push({ type: "lasercut", name: "Laser cut", tool: t, rpm: M.rpmMax, feed: fs.feed, plunge: 600, power: fs.power, passes: Math.max(1, Math.ceil(ui.stockH() / 3)) });
      return ops;
    }
    let rt = toolById(s.tool); if (rt.type === "laser") rt = toolById("f6");
    const ft = s.finishTool ? toolById(s.finishTool) : rt, ops = [];
    if (s.job !== "cutout") {
      const f1 = feedsSpeeds(rt, m, M), f2 = feedsSpeeds(ft, m, M);
      ops.push({ type: "rough", name: "Roughing", tool: rt, ...f1, leave: ft.id === rt.id ? 0.2 : 0.5, angle: 0 });
      ops.push({ type: "finish", name: "Finishing", tool: ft, ...f2, stepover: q.so * (ft.type === "flat" ? 1.6 : 1), angle: 0, tol: q.tol });
    }
    if (s.job !== "carve") {
      const ct = rt.type === "flat" ? rt : toolById(isInch() ? "f18" : "f3"), fc = feedsSpeeds(ct, m, M);
      ops.push({ type: "cutout", name: "Cutout", tool: ct, ...fc, direction: "climb", tabs: s.tabs ? { count: 4, width: Math.max(4, ct.d), height: Math.min(3, ui.stockH() * 0.3) } : null });
    }
    return ops;
  }
  // number the bits in the order they are used
  function numberTools(ops) { const ids = []; for (const o of ops) { if (!ids.includes(o.tool.id)) ids.push(o.tool.id); o.toolNo = ids.indexOf(o.tool.id) + 1; } return ops; }
  function makeJob() {
    const s = ui.s, b = ui.box, q = QUALITY[s.quality];
    if (isRot()) {
      const r = rotModel(), Rr = rotDia() / 2, ops = numberTools((s.level === "pro" && s.ops && s.ops.every((o) => o.type[0] === "r" && o.type !== "rough") ? s.ops : basicOps()).map((o) => ({ ...o })));
      return { rotary: { yc: r.yc, zc: r.zc, R: Rr, mx0: r.x0, mx1: r.x1, core: 0 }, stock: { x0: r.x0 - s.margin, x1: r.x1 + s.margin, y0: r.yc - Rr, y1: r.yc + Rr, zTop: r.zc + Rr, zBot: r.zc - Rr }, clearZ: r.zc + Rr + 5, floor: r.zc, res: s.level === "pro" && s.res ? s.res : q.res, origin: s.origin === "r-mid" ? "r-mid" : "r-left", ops };
    }
    const top = b.max.z + (s.extraTop || 0), thick = s.thick || (b.max.z - b.min.z + (s.extraTop || 0));
    const stock = { x0: b.min.x - s.margin, y0: b.min.y - s.margin, x1: b.max.x + s.margin, y1: b.max.y + s.margin, zTop: top, zBot: top - thick };
    const ops = numberTools((s.level === "pro" && s.ops ? s.ops : basicOps()).map((o) => ({ ...o })));
    const laser = mach().kind === "laser";
    // area outside the part is cut down to just above the bottom (a thin skin), so only the cutout goes through
    return { stock, clearZ: top + (laser ? 0 : 5), floor: Math.max(stock.zBot + (ops.some((o) => o.type === "cutout") ? 0.5 : 0), Math.min(b.min.z, top)), res: s.level === "pro" && s.res ? s.res : q.res, origin: s.origin, ops };
  }

  // ------------------------------------------------------------ opening and closing
  function open() {
    if (ui) return;
    const ok = (b) => b && !b.hole && !b.hidden && app.scene.views.get(b.id) && app.scene.views.get(b.id).data;
    let ids = (app.sel || []).filter((id) => ok(findBody(store.doc, id)));
    if (!ids.length) ids = store.doc.bodies.filter(ok).map((b) => b.id);
    if (!ids.length) { app.toast("Make or import an object first: CAM Studio plans how a CNC machine cuts it.", "err"); return; }
    const tris = modelTris(ids);
    const s = Object.assign(defaults(), (store.doc.cam && store.doc.cam.s) || {});
    buildUI(s, ids, tris);
  }
  function close() {
    if (!ui) return;
    stopPlay();
    cancelAnimationFrame(ui.raf);
    removeEventListener("keydown", ui.onKey, true);
    ui.ro.disconnect();
    ui.renderer.dispose();
    ui.root.remove();
    document.body.classList.remove("s3d-on");
    // remember the setup with the design
    try { store.doc.cam = { s: { ...ui.s, ops: ui.s.ops ? ui.s.ops.map((o) => ({ ...o })) : null } }; app.projects && app.projects.changed && app.projects.changed(); } catch (e) {}
    if (ui.serial) ui.serial.close();
    ui = null;
    app.vp.request();
  }

  // ------------------------------------------------------------ the window
  function buildUI(s, ids, tris) {
    const root = el("div", { class: "s3d cam", id: "cam", role: "dialog", "aria-label": "CAM Studio" });
    const bar = el("div", { class: "s3d-bar" });
    const panes = el("div", { class: "s3d-panes bk-panes" });
    const canvas = el("canvas", { class: "s3d-canvas", id: "cam-canvas" });
    const side = el("aside", { class: "bk-side cam-side", id: "cam-side" });
    const play = el("div", { class: "cam-play", id: "cam-play" });
    const view3 = el("div", { class: "bk-view" }, canvas, play);
    panes.append(side, view3);
    root.append(bar, panes);
    document.body.append(root);
    document.body.classList.add("s3d-on");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue("--vp-bg").trim() || "#e9edf3");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8796, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25); sun.position.set(-1.2, -1.8, 2.6); scene.add(sun);
    const cam = new THREE.PerspectiveCamera(35, 1, 1, 50000); cam.up.set(0, 0, 1);
    const groups = { bed: new THREE.Group(), stock: new THREE.Group(), model: new THREE.Group(), paths: new THREE.Group(), tool: new THREE.Group() };
    for (const g of Object.values(groups)) scene.add(g);
    const box = triBox(tris);
    ui = { s, ids, tris, box, root, bar, side, play, canvas, view3, renderer, scene, cam, groups, view: { az: -Math.PI / 2.6, el: 0.75, dist: 300, target: new THREE.Vector3() }, raf: 0, dirty: true, pointers: new Map(), prog: null, sim: null, playing: false, t: 0 };
    ui.stockH = () => (s.thick || box.max.z - box.min.z + (s.extraTop || 0));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    ui.view.target.copy(c); ui.view.dist = Math.max(80, Math.max(size.x, size.y, size.z) * 2.4);
    // the model, see-through
    const mg = new THREE.BufferGeometry(); mg.setAttribute("position", new THREE.BufferAttribute(tris, 3)); mg.computeVertexNormals();
    const mm = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ color: 0x5a93db, transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.6 }));
    groups.model.add(mm);
    renderBar(); renderSide(); renderPlay();
    const ro = new ResizeObserver(() => resize()); ro.observe(view3); ui.ro = ro;
    resize(); bindPointers();
    ui.onKey = (e) => {
      if (!ui) return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== "Escape") return;
      if (e.key === "Escape") { const m = document.querySelector(".cam-modal-back"); if (m) m.remove(); else close(); }
      else if (e.key === " ") { togglePlay(); }
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    addEventListener("keydown", ui.onKey, true);
    loop();
    generate();
  }
  function resize() {
    if (!ui) return;
    const r = ui.view3.getBoundingClientRect();
    ui.renderer.setSize(r.width, r.height, false);
    ui.canvas.style.width = r.width + "px"; ui.canvas.style.height = r.height + "px";
    ui.w = r.width; ui.h = r.height;
    ui.cam.aspect = r.width / Math.max(1, r.height); ui.cam.updateProjectionMatrix();
    ui.dirty = true;
  }
  function loop() {
    if (!ui) return;
    ui.raf = requestAnimationFrame(loop);
    stepPlay();
    if (!ui.dirty) return;
    ui.dirty = false;
    const v = ui.view, dir = new THREE.Vector3(Math.cos(v.el) * Math.cos(v.az), Math.cos(v.el) * Math.sin(v.az), Math.sin(v.el));
    ui.cam.position.copy(v.target).addScaledVector(dir, v.dist); ui.cam.lookAt(v.target);
    ui.cam.near = Math.max(0.5, v.dist / 300); ui.cam.far = v.dist * 50; ui.cam.updateProjectionMatrix();
    ui.renderer.render(ui.scene, ui.cam);
  }
  function bindPointers() {
    const c = ui.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => { try { c.setPointerCapture(e.pointerId); } catch (err) {} ui.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }); });
    c.addEventListener("pointermove", (e) => {
      const p = ui.pointers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      const all = [...ui.pointers.values()];
      if (all.length >= 2) { const [a, b] = all, sp = Math.hypot(a.x - b.x, a.y - b.y); if (ui.sp0) ui.view.dist = Math.max(10, Math.min(20000, ui.view.dist * (ui.sp0 / Math.max(1, sp)))); ui.sp0 = sp; }
      else if (p.b === 2 || p.b === 1 || p.shift) {
        const k = (2 * ui.view.dist * Math.tan((ui.cam.fov * Math.PI) / 360)) / ui.h;
        const right = new THREE.Vector3().setFromMatrixColumn(ui.cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(ui.cam.matrixWorld, 1);
        ui.view.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      } else { ui.view.az -= dx * 0.008; ui.view.el = Math.max(-1.5, Math.min(1.55, ui.view.el + dy * 0.008)); }
      ui.dirty = true;
    });
    const up = (e) => { ui.pointers.delete(e.pointerId); if (ui.pointers.size < 2) ui.sp0 = 0; };
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", (e) => { e.preventDefault(); ui.view.dist = Math.max(10, Math.min(20000, ui.view.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))); ui.dirty = true; }, { passive: false });
  }

  // ------------------------------------------------------------ top bar
  const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, label ? el("small", {}, label) : null, ...kids);
  const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id }, ...items.map(([v, l, t]) => el("button", { "aria-pressed": String(cur === v), "data-v": v, title: t || "", onclick: () => on(v) }, l)));
  const sel = (id, items, cur, on, label) => { const e = el("select", { class: "num", id, "aria-label": label || id }, ...items.map(([v, l]) => el("option", { value: v, selected: v === cur }, l))); e.onchange = () => on(e.value); return e; };
  function set(k, v, regen = true) { ui.s[k] = v; if (k === "axes" || k === "raxis") { ui.s.ops = ui.s.level === "pro" ? null : ui.s.ops; if (k === "axes") ui.s.origin = v === "4" ? "r-left" : "fl-top"; ui.fitView = true; } if (["machine", "material", "tool", "finishTool", "level"].includes(k)) setPref(k, v); if (k === "machine" || k === "material" || k === "level") { if (k !== "level" || v === "pro") ui.s.ops = ui.s.level === "pro" && k !== "level" ? null : ui.s.ops; } renderBar(); renderSide(); if (regen) generate(); }
  function renderBar() {
    const s = ui.s, b = ui.bar;
    b.replaceChildren(
      el("div", { class: "s3d-title" }, el("b", {}, "CAM Studio"), el("small", { class: "bk-dim" }, "Cutting simulator")),
      grp("Mode", seg("cam-level", [["basic", "Basic", "A few choices; the numbers are worked out for you"], ["pro", "Pro", "Every operation and setting"]], s.level, (v) => { if (v === "pro" && !s.ops) s.ops = basicOps(); set("level", v); })),
      grp("Machine", sel("cam-machine", machines().map((m) => [m.id, m.name]), s.machine, (v) => set("machine", v), "Machine")),
      grp("Material", sel("cam-material", MATERIALS.filter((m) => mach().kind !== "laser" || m.laser).map((m) => [m.id, m.name]), s.material, (v) => set("material", v), "Material")),
      el("span", { class: "s3d-sp" }),
      grp("", el("button", { class: "btn", id: "cam-export", onclick: () => exportDialog() }, "Save G-code"), el("button", { class: "btn", id: "cam-send", onclick: () => sendDialog() }, "Send to machine"), el("button", { class: "btn", id: "cam-close", onclick: () => close() }, "Close")),
    );
  }

  // ------------------------------------------------------------ side panel
  function renderSide() {
    const s = ui.s, sd = ui.side, M = mach(), laser = M.kind === "laser";
    sd.replaceChildren();
    if (s.level === "basic") {
      sd.append(el("h3", {}, "Set up the cut"));
      sd.append(el("p", { class: "bk-dim" }, `${ui.ids.length} object${ui.ids.length > 1 ? "s" : ""} · ${len(ui.box.max.x - ui.box.min.x)} × ${len(ui.box.max.y - ui.box.min.y)} × ${len(ui.box.max.z - ui.box.min.z)}`));
      if (!laser) axesUI(sd);
      if (isRot()) { rotaryUI(sd); }
      else sd.append(el("small", {}, "1 · What to make"));
      if (!isRot()) sd.append(seg("cam-job", laser ? [["carve", "Engrave"], ["cutout", "Cut out"], ["both", "Both"]] : [["carve", "Carve the top"], ["cutout", "Cut out the shape"], ["both", "Both"]], s.job, (v) => set("job", v)));
      if (!laser) {
        sd.append(el("small", {}, "2 · Bits"));
        const mills = tools().filter((t) => t.type !== "laser");
        if (s.job !== "cutout" || true) sd.append(row(s.job === "cutout" ? "Bit" : "Roughing bit", sel("cam-tool", mills.filter((t) => t.type === "flat" || t.type === "bull").map((t) => [t.id, t.name]), s.tool, (v) => set("tool", v), "Bit")));
        if (s.job !== "cutout" || isRot()) sd.append(row("Finishing bit", sel("cam-ftool", mills.map((t) => [t.id, t.name]), s.finishTool, (v) => set("finishTool", v), "Finishing bit")));
      }
      sd.append(el("small", {}, laser ? "2 · Quality" : "3 · Quality"));
      sd.append(seg("cam-quality", Object.entries(QUALITY).map(([k, q]) => [k, q.name.split(" ")[0], q.name]), s.quality, (v) => set("quality", v)));
      sd.append(el("small", {}, laser ? "3 · Stock" : "4 · Stock"));
      if (!isRot()) sd.append(row("Thickness", lenInput(ui.stockH(), (v) => set("thick", Math.max(0.5, v)), "cam-thick")));
      if (!laser && s.job !== "carve" && !isRot()) sd.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "cam-tabs", checked: s.tabs, onchange: (e) => set("tabs", e.target.checked) }), "Tabs hold the part in place (cut them off after)"));
      // the numbers Basic chose
      const ops = numberTools(basicOps());
      const t = el("table", { class: "bk-parts cam-fs" }, el("tr", {}, el("th", {}, "Step"), el("th", {}, "Bit"), el("th", {}, laser ? "Power" : "RPM"), el("th", {}, "Feed")));
      for (const o of ops) t.append(el("tr", {}, el("td", {}, o.name), el("td", {}, o.tool.name.replace(/ \(.*\)/, "")), el("td", { class: "n" }, laser ? Math.round((o.power || 0) * 100) + "%" : String(o.rpm)), el("td", { class: "n" }, isInch() ? (o.feed / IN).toFixed(0) + " in/min" : o.feed + " mm/min")));
      sd.append(el("small", {}, "Feeds and speeds (worked out for you)"), t);
    } else proSide(sd);
    // results
    const r = ui.result;
    sd.append(el("small", {}, "Result"));
    if (!r) sd.append(el("p", { class: "bk-dim", id: "cam-stats" }, "Working…"));
    else {
      sd.append(el("p", { class: "bk-dim", id: "cam-stats" }, `About ${fmtTime(r.stats.seconds)} on the machine · ${(r.stats.cut / 1000).toFixed(1)} m of cutting · ${r.lines.toLocaleString()} lines of G-code`));
      const M2 = mach(), st = r.job.stock, fits = r.job.rotary ? true : st.x1 - st.x0 <= M2.x && st.y1 - st.y0 <= M2.y && st.zTop - st.zBot <= M2.z;
      const warn = [...r.prog.warnings];
      if (r.job.rotary) {
        if (!M2.rotary) warn.push("This machine has no rotary (4th) axis. Pick one that has (they say 4th axis or rotary), or add your own machine with a rotary axis in Pro.");
        else { if (r.job.rotary.R * 2 > M2.rotary.maxD) warn.push(`The stock (${len(r.job.rotary.R * 2, 0)} across) is bigger than this rotary axis takes (${len(M2.rotary.maxD, 0)}).`); if (st.x1 - st.x0 > M2.rotary.maxL) warn.push(`The stock is longer (${len(st.x1 - st.x0, 0)}) than fits between the chuck and the tailstock (${len(M2.rotary.maxL, 0)}).`); }
        if ((r.post || "") === "grbl") warn.push("Standard GRBL 1.1 has no A axis. Use grblHAL / FluidNC, LinuxCNC or Mach3 G-code (G-code for, in Pro).");
      }
      if (!fits) warn.push(`The stock (${len(st.x1 - st.x0, 0)} × ${len(st.y1 - st.y0, 0)}) is bigger than this machine's work area (${len(M2.x, 0)} × ${len(M2.y, 0)}).`);
      if (ui.sim && ui.done) { if (ui.sim.rapidHits) warn.push(`${ui.sim.rapidHits} rapid move${ui.sim.rapidHits > 1 ? "s" : ""} would hit material.`); if (ui.sim.tooDeep) warn.push("Some cuts are deeper than the bit's cutting length."); }
      for (const w of warn) sd.append(el("p", { class: "bk-warn" }, w));
      if (!warn.length && ui.done) sd.append(el("p", { class: "cam-ok" }, "✓ Simulated: no crashes found."));
    }
    sd.append(el("p", { class: "hint", style: { padding: 0 } }, "Always check the simulation, secure the work and the bit, set the zero point on the machine where the job says, and stay with the machine while it cuts. Wear eye and ear protection."));
    sd.append(el("details", { class: "cam-about" }, el("summary", {}, "About this simulator"), el("p", { class: "bk-dim" }, "Written for JumpStart 3D (MIT) with openly published methods: drop-cutter toolpaths on a height map (the approach of the open-source OpenCAMLib), a height-field material removal simulation (as in the open-source CAMotics), and G-code for the open-source controllers GRBL, LinuxCNC and Marlin, plus Mach3. It plans 3-axis cuts from the top.")));
  }
  const row = (label, ctl) => el("div", { class: "row" }, el("label", {}, label), ctl);
  function axesUI(sd) {
    sd.append(el("small", {}, "Setup"));
    sd.append(seg("cam-axes", [["3", "3 axis (flat stock)", "Cut from the top of a flat block or board"], ["4", "4th axis (rotary)", "The stock is a round bar that turns (A axis) so the tool reaches all the way around: cylinders, handles, figures"]], ui.s.axes, (v) => set("axes", v)));
    if (isRot() && !mach().rotary) {
      const first = machines().find((m) => m.rotary);
      sd.append(el("p", { class: "bk-warn" }, "This machine has no rotary (4th) axis.", first ? el("button", { class: "btn", id: "cam-use4", style: { marginLeft: "6px" }, onclick: () => set("machine", first.id) }, "Use " + first.name) : null));
    }
  }
  function rotaryUI(sd) {
    const r = rotModel();
    sd.append(el("p", { class: "bk-dim" }, "The stock is a round bar held between a chuck and a tailstock. It turns (A axis) while the bit cuts from above, so the part is carved all the way around. The ends stay uncut to hold it: cut them off afterwards."));
    sd.append(row("Turns along", seg("cam-raxis", [["x", "X"], ["y", "Y"]], ui.s.raxis, (v) => { ui.rot = null; set("raxis", v); })));
    sd.append(row("Bar diameter", lenInput(rotDia(), (v) => set("rdia", Math.max(r.rMax * 2, v)), "cam-rdia")));
    sd.append(row("Extra at each end", lenInput(ui.s.margin, (v) => set("margin", Math.max(0, v)), "cam-rmargin")));
    sd.append(el("p", { class: "bk-dim", id: "cam-rinfo" }, `The model reaches ${len(r.rMax)} from the axis and is ${len(r.x1 - r.x0)} long.`));
  }
  function lenInput(mm, on, id) {
    const i = el("input", { class: "num", id, value: isInch() ? +(mm / IN).toFixed(3) : +mm.toFixed(2) });
    const go = () => { const v = parseFloat(i.value); if (isFinite(v)) on(isInch() ? v * IN : v); };
    i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") go(); });
    i.addEventListener("change", go);
    return el("span", { class: "cam-len" }, i, el("em", {}, isInch() ? "in" : "mm"));
  }
  function numInput(v, on, id, step = 1) {
    const i = el("input", { class: "num", id, value: v, inputmode: "decimal" });
    const go = () => { const x = parseFloat(i.value); if (isFinite(x)) on(x); };
    i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") go(); });
    i.addEventListener("change", go);
    void step;
    return i;
  }
  // ------------------------------------------------------------ Pro
  function proSide(sd) {
    const s = ui.s, M = mach(), laser = M.kind === "laser";
    if (!s.ops) s.ops = basicOps();
    sd.append(el("h3", {}, "Job"));
    if (!laser) axesUI(sd);
    if (isRot()) rotaryUI(sd);
    const r3 = el("div", { class: "cam-grid" });
    if (!isRot()) r3.append(el("label", {}, "Thickness", lenInput(ui.stockH(), (v) => set("thick", Math.max(0.5, v)), "cam-thick")));
    r3.append(el("label", {}, "Margin", lenInput(s.margin, (v) => set("margin", Math.max(0, v)), "cam-margin")));
    r3.append(el("label", {}, "Above the model", lenInput(s.extraTop, (v) => set("extraTop", Math.max(0, v)), "cam-top")));
    sd.append(r3);
    sd.append(row("Zero (origin)", isRot() ? sel("cam-origin", [["r-left", "Left end of the stock, on the axis"], ["r-mid", "Middle of the stock, on the axis"]], s.origin === "r-mid" ? "r-mid" : "r-left", (v) => set("origin", v), "Origin") : sel("cam-origin", [["fl-top", "Front-left corner, top"], ["c-top", "Center, top"], ["fl-bottom", "Front-left corner, bottom"]], s.origin, (v) => set("origin", v), "Origin")));
    sd.append(row("Accuracy", sel("cam-res", [["", "From quality"], ["1", "1 mm (quick look)"], ["0.5", "0.5 mm"], ["0.3", "0.3 mm"], ["0.2", "0.2 mm"], ["0.1", "0.1 mm (slow)"]], s.res ? String(s.res) : "", (v) => set("res", v ? +v : null), "Accuracy")));
    sd.append(row("G-code for", sel("cam-post", Object.entries(POSTS).map(([k, p]) => [k, p.name]), s.post || M.post, (v) => set("post", v, false), "Post processor")));
    sd.append(row("G-code units", sel("cam-units", [["", "Machine's (" + (M.units === "in" ? "inches" : "mm") + ")"], ["mm", "Millimetres (G21)"], ["in", "Inches (G20)"]], s.units || "", (v) => set("units", v || null, false), "Units")));
    // operations
    sd.append(el("h3", {}, "Operations"));
    const list = el("div", { class: "cam-ops", id: "cam-ops" });
    s.ops.forEach((o, i) => list.append(opCard(o, i)));
    sd.append(list);
    const addSel = sel("cam-addop", [["", "+ Add an operation…"], ...(laser ? [["engrave", "Laser engrave"], ["lasercut", "Laser cut"]] : isRot() ? [["rrough", "Rotary roughing"], ["rfinish", "Rotary finishing"]] : [["face", "Facing (flatten the top)"], ["rough", "Roughing"], ["finish", "Finishing"], ["cutout", "Cutout (profile)"]])], "", (v) => { if (!v) return; s.ops.push(newOp(v)); renderSide(); generate(); }, "Add operation");
    sd.append(addSel);
    sd.append(el("div", { class: "cam-row2" }, el("button", { class: "btn", onclick: () => { s.ops = basicOps(); renderSide(); generate(); } }, "Start again from Basic"), el("button", { class: "btn", id: "cam-regen", onclick: () => generate() }, "Make toolpaths")));
    // libraries
    sd.append(el("h3", {}, "Your machines and bits"));
    sd.append(el("div", { class: "cam-row2" }, el("button", { class: "btn", id: "cam-newmach", onclick: () => machineDialog() }, "+ Machine"), el("button", { class: "btn", id: "cam-newtool", onclick: () => toolDialog() }, "+ Bit")));
    const L = lib();
    if (L.machines.length || L.tools.length) sd.append(el("p", { class: "bk-dim" }, [...L.machines.map((m) => m.name), ...L.tools.map((t) => t.name)].join(" · ")));
    sd.append(el("details", { class: "cam-gcode" }, el("summary", {}, "G-code"), el("textarea", { class: "num", id: "cam-gtext", readonly: true, rows: 12, spellcheck: "false" }, ui.result ? ui.result.gcode.split("\n").slice(0, 4000).join("\n") + (ui.result.lines > 4000 ? "\n(… the full file has " + ui.result.lines + " lines)" : "") : "")));
  }
  function newOp(type) {
    const M = mach(), m = mat();
    const t = type === "engrave" || type === "lasercut" ? toolById("laser") : type === "finish" || type === "rfinish" ? toolById(ui.s.finishTool) : toolById(ui.s.tool);
    const fs = feedsSpeeds(t, m, M);
    const o = { type, name: OP_NAMES[type], tool: t, ...fs };
    if (type === "rough") Object.assign(o, { leave: 0.5, angle: 0 });
    if (type === "rrough") Object.assign(o, { leave: 0.5 });
    if (type === "rfinish") Object.assign(o, { tol: 0.03 });
    if (type === "finish") Object.assign(o, { angle: 0, tol: 0.03, onlyModel: true });
    if (type === "face") Object.assign(o, { depth: 1, stepover: 0.7 });
    if (type === "cutout") Object.assign(o, { direction: "climb", tabs: { count: 4, width: Math.max(4, t.d), height: 2 } });
    if (type === "engrave") Object.assign(o, { power: fs.engrave, feed: fs.engraveFeed, line: 0.2 });
    if (type === "lasercut") Object.assign(o, { power: fs.power, passes: 2 });
    return o;
  }
  function opCard(o, i) {
    const s = ui.s, M = mach(), laser = o.tool.type === "laser";
    const upd = (k, v) => { o[k] = v; generate(); };
    const card = el("details", { class: "cam-op", open: i === s.openOp }, el("summary", {}, el("span", { class: "cam-dot", style: { background: "#" + (OP_COL[o.type] || 0x888888).toString(16).padStart(6, "0") } }), el("b", {}, `${i + 1}. ${o.name}`), el("span", { class: "bk-dim" }, " · " + o.tool.name)));
    card.addEventListener("toggle", () => { if (card.open) s.openOp = i; });
    const body = el("div", { class: "cam-opbody" });
    if (!laser) body.append(row("Bit", sel("cam-op-tool-" + i, tools().filter((t) => t.type !== "laser").map((t) => [t.id, t.name]), o.tool.id, (v) => { const t = toolById(v); Object.assign(o, feedsSpeeds(t, mat(), M), { tool: t }); renderSide(); generate(); }, "Bit")));
    const g = el("div", { class: "cam-grid" });
    const F = (label, k, scale = 1, unit = "") => g.append(el("label", {}, label + (unit ? ` (${unit})` : ""), numInput(+((o[k] ?? 0) * scale).toFixed(3), (v) => upd(k, v / scale), `cam-op-${k}-${i}`)));
    const fu = isInch() ? "in/min" : "mm/min", lu = isInch() ? "in" : "mm", lk = isInch() ? 1 / IN : 1;
    if (laser) { F("Power", "power", 100, "%"); F("Speed", "feed", lk, fu); if (o.type === "lasercut") F("Passes", "passes"); else F("Line spacing", "line", lk, lu); }
    else {
      F("Spindle", "rpm", 1, "RPM"); F("Feed", "feed", lk, fu); F("Plunge", "plunge", lk, fu);
      if (o.type !== "finish" && o.type !== "rfinish") F("Pass depth", "stepdown", lk, lu);
      if (o.type !== "cutout") F("Stepover", "stepover", 100, "% of bit");
      if (o.type === "rough" || o.type === "rrough") F("Leave", "leave", lk, lu);
      if (o.type === "face") F("Depth", "depth", lk, lu);
      if (o.type === "finish" || o.type === "rfinish") F("Tolerance", "tol", lk, lu);
    }
    body.append(g);
    if (o.type === "rough" || o.type === "finish" || o.type === "face") body.append(row("Direction", seg("cam-op-ang-" + i, [[0, "Along X"], [90, "Along Y"], ...(o.type === "finish" ? [["both", "Both"]] : [])], o.angle ?? 0, (v) => { o.angle = v; renderSide(); generate(); })));
    if (o.type === "cutout") {
      body.append(row("Milling", seg("cam-op-dir-" + i, [["climb", "Climb"], ["conventional", "Conventional"]], o.direction || "climb", (v) => { o.direction = v; renderSide(); generate(); })));
      const tg = el("div", { class: "cam-grid" });
      const tabs = o.tabs || { count: 0, width: 5, height: 2 };
      tg.append(el("label", {}, "Tabs", numInput(tabs.count, (v) => { o.tabs = { ...tabs, count: Math.max(0, Math.round(v)) }; generate(); }, "cam-op-tabs-" + i)));
      tg.append(el("label", {}, `Tab width (${lu})`, numInput(+(tabs.width * lk).toFixed(3), (v) => { o.tabs = { ...tabs, width: v / lk }; generate(); }, "cam-op-tabw-" + i)));
      tg.append(el("label", {}, `Tab height (${lu})`, numInput(+(tabs.height * lk).toFixed(3), (v) => { o.tabs = { ...tabs, height: v / lk }; generate(); }, "cam-op-tabh-" + i)));
      body.append(tg);
    }
    body.append(el("div", { class: "cam-row2" },
      el("button", { class: "btn", disabled: i === 0, onclick: () => { s.ops.splice(i - 1, 0, s.ops.splice(i, 1)[0]); renderSide(); generate(); } }, "↑"),
      el("button", { class: "btn", disabled: i === s.ops.length - 1, onclick: () => { s.ops.splice(i + 1, 0, s.ops.splice(i, 1)[0]); renderSide(); generate(); } }, "↓"),
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: o.enabled !== false, onchange: (e) => upd("enabled", e.target.checked) }), "On"),
      el("button", { class: "btn", onclick: () => { s.ops.splice(i, 1); renderSide(); generate(); } }, "Remove")));
    card.append(body);
    return card;
  }
  function modal(title, ...kids) {
    const back = el("div", { class: "s3d-modal-back cam-modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
    const m = el("div", { class: "s3d-modal cam-modal", role: "dialog", "aria-label": title }, el("header", {}, el("h3", {}, title), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })), ...kids);
    back.append(m); ui.root.append(back);
    return back;
  }
  function machineDialog() {
    const M = { ...mach(), id: "c" + Date.now().toString(36), name: "My machine" };
    const f = (label, k, unitMm) => el("label", {}, label, numInput(unitMm && isInch() ? +(M[k] / IN).toFixed(3) : M[k], (v) => { M[k] = unitMm && isInch() ? v * IN : v; }, "cm-" + k));
    const name = el("input", { class: "num", id: "cm-name", value: M.name }); name.addEventListener("keydown", (e) => e.stopPropagation());
    const back = modal("New machine profile",
      el("div", { class: "cam-mbody" },
        row("Name", name),
        row("Type", sel("cm-kind", [["mill", "CNC router or mill"], ["laser", "Laser"]], M.kind, (v) => { M.kind = v; }, "Type")),
        el("div", { class: "cam-grid" }, f("Work area X" + (isInch() ? " (in)" : " (mm)"), "x", true), f("Y", "y", true), f("Z", "z", true), f("Max spindle RPM (laser: max S)", "rpmMax"), f("Min RPM", "rpmMin"), f("Max feed (mm/min)", "feedMax"), f("Rapid (mm/min)", "rapid")),
        row("Controller", sel("cm-post", Object.entries(POSTS).map(([k, p]) => [k, p.name + " · " + p.note]), M.post, (v) => { M.post = v; }, "Controller")),
        row("Units", sel("cm-units", [["mm", "Millimetres"], ["in", "Inches"]], M.units, (v) => { M.units = v; }, "Units")),
        el("div", { class: "cam-row2" }, el("button", { class: "btn primary", id: "cm-save", onclick: () => { M.name = name.value || "My machine"; const L = lib(); L.machines.push(M); setPref("lib", L); back.remove(); set("machine", M.id); } }, "Save machine"))));
  }
  function toolDialog() {
    const T = { id: "t" + Date.now().toString(36), name: "My bit", type: "flat", d: isInch() ? 6.35 : 6, flutes: 2, len: 20, angle: 90, cr: 1, tip: 0.2 };
    const name = el("input", { class: "num", id: "ct-name", value: T.name }); name.addEventListener("keydown", (e) => e.stopPropagation());
    const f = (label, k, mm) => el("label", {}, label, numInput(mm && isInch() ? +(T[k] / IN).toFixed(4) : T[k], (v) => { T[k] = mm && isInch() ? v * IN : v; }, "ct-" + k));
    const back = modal("New bit",
      el("div", { class: "cam-mbody" },
        row("Name", name),
        row("Shape", sel("ct-type", [["flat", "Flat end mill"], ["ball", "Ball nose"], ["bull", "Bull nose (corner radius)"], ["vee", "V-bit / engraving"], ["drill", "Drill"]], T.type, (v) => { T.type = v; }, "Shape")),
        el("div", { class: "cam-grid" }, f("Diameter" + (isInch() ? " (in)" : " (mm)"), "d", true), f("Flutes", "flutes"), f("Cutting length", "len", true), f("V angle (°)", "angle"), f("Corner radius", "cr", true), f("Tip width", "tip", true)),
        el("div", { class: "cam-row2" }, el("button", { class: "btn primary", id: "ct-save", onclick: () => { T.name = name.value || "My bit"; const L = lib(); L.tools.push(T); setPref("lib", L); back.remove(); renderSide(); } }, "Save bit"))));
  }

  // ------------------------------------------------------------ making toolpaths
  let genTimer = 0;
  function generate() {
    clearTimeout(genTimer);
    genTimer = setTimeout(() => {
      if (!ui) return;
      stopPlay();
      const job = makeJob();
      let prog;
      if (ui.s.level === "pro" && !ui.s.ops) ui.s.ops = basicOps();
      try { prog = buildProgram(job, job.rotary ? rotModel().tris : ui.tris); } catch (e) { app.toast("Couldn't make the toolpaths: " + e.message, "err"); return; }
      const M = mach(), post = ui.s.post || M.post;
      const gcode = toGcode(prog, job, M, { post, units: ui.s.units || M.units, title: store.doc.name || "JumpStart 3D job" });
      ui.result = { job, prog, stats: programStats(prog, M), gcode, lines: gcode.split("\n").length - 1, post };
      // the moves in order, with their times, for playback
      const segs = []; let prev = null, t = 0;
      for (const { op, moves } of prog.ops) for (const m of moves) {
        if (prev) { const d = moveLen(prev, m, prog.rotary), dt = m.g === 0 ? (d / (M.rapid || 3000)) * 60 : (d / Math.max(1, m.f || 100)) * 60; segs.push({ a: prev, b: m, op, t0: t, t1: t + dt }); t += dt; }
        prev = m;
      }
      ui.segs = segs; ui.total = t;
      setupRotary(job);
      resetSim();
      drawPaths(); drawBed();
      renderSide(); renderPlay();
      // quick look at the finished result: run the whole simulation now
      runTo(ui.total);
      ui.done = true;
      renderSide();
    }, 120);
  }
  function resetSim() {
    const r = ui.result;
    ui.sim = r.job.rotary ? new RotarySim(r.job, Math.max(0.3, r.job.res)) : new StockSim(r.job, r.job.res);
    ui.si = 0; ui.t = 0; ui.done = false;
    buildStockMesh();
  }
  function runTo(t) {
    if (t < ui.t) resetSim();
    const sim = ui.sim, segs = ui.segs;
    while (ui.si < segs.length && segs[ui.si].t1 <= t) { const s = segs[ui.si]; sim.move(s.a, s.b, s.op.tool, s.b.g, s.b.s); ui.si++; }
    let pos = ui.si < segs.length ? segs[ui.si].a : segs.length ? segs[segs.length - 1].b : null;
    if (ui.si < segs.length) {
      const s = segs[ui.si], f = (t - s.t0) / Math.max(1e-9, s.t1 - s.t0);
      if (f > 0) { pos = { x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f, z: s.a.z + (s.b.z - s.a.z) * f, g: s.b.g, s: s.b.s, ...(s.b.a !== undefined ? { a: (s.a.a || 0) + (s.b.a - (s.a.a || 0)) * f } : {}) }; sim.move(s.a, pos, s.op.tool, s.b.g, s.b.s); ui.segs[ui.si] = { ...s, a: pos, t0: t }; }
    }
    ui.t = t;
    updateStockMesh();
    // the tool steps out of the way when the job is finished
    placeTool(pos, ui.si < segs.length ? segs[ui.si].op.tool : null);
    if (ui.t >= ui.total - 1e-9) { ui.done = true; }
    updatePlay();
    ui.dirty = true;
  }
  // ------------------------------------------------------------ playback
  function togglePlay() { if (ui.playing) stopPlay(); else { if (ui.t >= ui.total - 1e-6) { rebuildSegs(); resetSim(); } ui.playing = true; ui.last = performance.now(); renderPlay(); } }
  function stopPlay() { if (ui) { ui.playing = false; } }
  function rebuildSegs() { /* the partial-move bookkeeping changes segments: rebuild them */ const r = ui.result; const M = mach(); const segs = []; let prev = null, t = 0; for (const { op, moves } of r.prog.ops) for (const m of moves) { if (prev) { const d = Math.hypot(m.x - prev.x, m.y - prev.y, m.z - prev.z), dt = m.g === 0 ? (d / (M.rapid || 3000)) * 60 : (d / Math.max(1, m.f || 100)) * 60; segs.push({ a: prev, b: m, op, t0: t, t1: t + dt }); t += dt; } prev = m; } ui.segs = segs; ui.total = t; }
  function stepPlay() {
    if (!ui || !ui.playing || !ui.segs) return;
    const now = performance.now(), dt = Math.min(0.1, (now - ui.last) / 1000); ui.last = now;
    const t = Math.min(ui.total, ui.t + dt * ui.s.speed);
    runTo(t);
    if (t >= ui.total) { ui.playing = false; renderPlay(); renderSide(); }
  }
  function renderPlay() {
    const p = ui.play;
    p.replaceChildren(
      el("button", { class: "btn", id: "cam-restart", title: "Back to the start", onclick: () => { stopPlay(); rebuildSegs(); resetSim(); runTo(0); renderPlay(); } }, "⏮"),
      el("button", { class: "btn primary", id: "cam-playbtn", title: "Play / pause (Space)", onclick: () => togglePlay() }, ui.playing ? "⏸ Pause" : "▶ Play"),
      el("button", { class: "btn", id: "cam-end", title: "Jump to the end (the finished part)", onclick: () => { stopPlay(); runTo(ui.total); renderPlay(); renderSide(); } }, "⏭"),
      el("input", { type: "range", id: "cam-scrub", min: 0, max: 1000, value: ui.total ? Math.round((ui.t / ui.total) * 1000) : 0, "aria-label": "Position in the job", oninput: (e) => { stopPlay(); const t = (+e.target.value / 1000) * ui.total; if (t < ui.t) { rebuildSegs(); resetSim(); } runTo(t); } }),
      el("span", { class: "cam-time", id: "cam-time" }, ""),
      el("label", { class: "cam-speed" }, "Speed ", sel("cam-speedsel", [[1, "1×"], [5, "5×"], [20, "20×"], [60, "60×"], [200, "200×"], [1000, "1000×"]].map(([v, l]) => [String(v), l]), String(ui.s.speed), (v) => { ui.s.speed = +v; }, "Speed")),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "cam-showpaths", checked: ui.s.show.paths, onchange: (e) => { ui.s.show.paths = e.target.checked; ui.groups.paths.visible = e.target.checked; ui.dirty = true; } }), "Toolpaths"),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "cam-showmodel", checked: ui.s.show.model, onchange: (e) => { ui.s.show.model = e.target.checked; ui.groups.model.visible = e.target.checked && !ui.rotG; if (ui.rotG) { const rm = ui.rotG.getObjectByName("rmodel"); if (rm) rm.visible = e.target.checked; } ui.dirty = true; } }), "Model"));
    ui.groups.paths.visible = ui.s.show.paths; ui.groups.model.visible = ui.s.show.model && !ui.rotG;
    if (ui.rotG) { const rm = ui.rotG.getObjectByName("rmodel"); if (rm) rm.visible = ui.s.show.model; }
    updatePlay();
  }
  function updatePlay() {
    const t = ui.play.querySelector("#cam-time"), sc = ui.play.querySelector("#cam-scrub");
    if (t) t.textContent = `${fmtTime(ui.t || 0)} / ${fmtTime(ui.total || 0)}` + (ui.si < (ui.segs || []).length ? " · " + ui.segs[ui.si].op.name : "");
    if (sc && document.activeElement !== sc) sc.value = ui.total ? Math.round((ui.t / ui.total) * 1000) : 0;
  }

  // ------------------------------------------------------------ 3D: stock, paths, tool, bed
  function buildStockMesh() {
    if (ui.sim && ui.sim.rotary) { buildRotStock(); return; }
    const g = ui.groups.stock; for (const c of [...g.children]) { g.remove(c); c.geometry.dispose(); c.material.dispose(); }
    const sim = ui.sim, stride = Math.max(1, Math.ceil(Math.max(sim.nx, sim.ny) / 360));
    const nx = Math.floor((sim.nx - 1) / stride) + 1, ny = Math.floor((sim.ny - 1) / stride) + 1;
    // the top: a grid; the sides: four strips down to the bottom
    const nTop = nx * ny, nSide = 2 * (2 * nx + 2 * ny);
    const pos = new Float32Array((nTop + nSide) * 3), col = new Float32Array((nTop + nSide) * 3), idx = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; idx.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx); }
    let o = nTop;
    const strip = (cells) => { const base = o; for (const c of cells) { o += 2; } for (let k = 0; k + 1 < cells.length; k++) { const a = base + k * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); } return { base, cells }; };
    const edge = (fn, n) => Array.from({ length: n }, (_, k) => fn(k));
    ui.sides = [
      strip(edge((k) => [k, 0], nx)), strip(edge((k) => [nx - 1, k], ny)), strip(edge((k) => [nx - 1 - k, ny - 1], nx)), strip(edge((k) => [0, ny - 1 - k], ny)),
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    g.add(m);
    ui.stock = { mesh: m, geo, nx, ny, stride, base: new THREE.Color(MAT_COL[ui.s.material] || "#d9c3a0") };
    updateStockMesh(true);
  }
  function updateStockMesh() {
    if (ui.sim && ui.sim.rotary) { updateRotStock(); return; }
    const sim = ui.sim, S = ui.stock; if (!S) return;
    const { nx, ny, stride, geo } = S, pos = geo.attributes.position.array, col = geo.attributes.color.array;
    const base = S.base, cut = base.clone().multiplyScalar(0.86).lerp(new THREE.Color(1, 1, 1), 0.08), burn = new THREE.Color(0.18, 0.11, 0.06);
    const zb = Math.max(sim.zBot - 1, sim.zBot - 1);
    const at = (i, j) => { const ii = Math.min(sim.nx - 1, i * stride), jj = Math.min(sim.ny - 1, j * stride); return ii + jj * sim.nx; };
    const tmp = new THREE.Color();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = at(i, j), k = (j * nx + i) * 3, z = sim.h[c];
      pos[k] = sim.x0 + Math.min(sim.nx - 1, i * stride) * sim.res; pos[k + 1] = sim.y0 + Math.min(sim.ny - 1, j * stride) * sim.res; pos[k + 2] = Math.max(z, zb);
      const through = z < sim.zBot - 0.05;
      if (sim.burn[c]) tmp.copy(base).lerp(burn, Math.min(1, sim.burn[c] / 160)); else tmp.copy(z < sim.zTop - 1e-3 ? cut : base);
      if (through) tmp.setRGB(0.55, 0.58, 0.62);
      col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
    }
    // sides follow the top's edge
    for (const s of ui.sides) s.cells.forEach(([i, j], n) => {
      const top = (j * nx + i) * 3, a = (s.base + n * 2) * 3;
      pos[a] = pos[top]; pos[a + 1] = pos[top + 1]; pos[a + 2] = pos[top + 2];
      pos[a + 3] = pos[top]; pos[a + 4] = pos[top + 1]; pos[a + 5] = sim.zBot;
      for (const q of [a, a + 3]) { col[q] = base.r * 0.9; col[q + 1] = base.g * 0.9; col[q + 2] = base.b * 0.9; }
    });
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    // normals are costly on big grids: refresh them a few times a second
    const now = performance.now();
    if (!ui.nt || now - ui.nt > 180 || !ui.playing) { geo.computeVertexNormals(); ui.nt = now; }
    geo.computeBoundingSphere();
  }
  function drawPaths() {
    const g = ui.groups.paths; for (const c of [...g.children]) { g.remove(c); c.geometry.dispose(); c.material.dispose(); }
    if (ui.result.job.rotary) { drawRotPaths(); return; }
    const rapid = [];
    for (const { op, moves } of ui.result.prog.ops) {
      const cut = [];
      for (let i = 1; i < moves.length; i++) { const a = moves[i - 1], b = moves[i]; (b.g === 0 ? rapid : cut).push(a.x, a.y, a.z, b.x, b.y, b.z); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(cut, 3));
      g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: OP_COL[op.type] || 0x2f6fd0, transparent: true, opacity: 0.4, depthWrite: false })));
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(rapid, 3));
    const rl = new THREE.LineSegments(rg, new THREE.LineDashedMaterial({ color: 0xd9534f, dashSize: 2, gapSize: 2, transparent: true, opacity: 0.6 })); rl.computeLineDistances();
    g.add(rl);
    ui.dirty = true;
  }
  function drawBed() {
    const g = ui.groups.bed; for (const c of [...g.children]) { g.remove(c); c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); }
    if (ui.result.job.rotary) { drawRotBed(); return; }
    const M = mach(), job = ui.result.job, O = workOrigin(job), st = job.stock;
    // the machine's work area (from the work zero), the spoilboard under the stock and the zero point
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(M.x, M.y), new THREE.MeshStandardMaterial({ color: 0x8f969e, roughness: 1, transparent: true, opacity: 0.35, depthWrite: false }));
    bed.position.set(st.x0 + M.x / 2, st.y0 + M.y / 2, st.zBot - 0.2); g.add(bed);
    const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(M.x, M.y, M.z)); const box = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x56657a, transparent: true, opacity: 0.35 }));
    box.position.set(st.x0 + M.x / 2, st.y0 + M.y / 2, st.zBot + M.z / 2); g.add(box);
    const L = Math.max(10, Math.min(st.x1 - st.x0, st.y1 - st.y0) * 0.25);
    for (const [d, c] of [[[1, 0, 0], 0xd9534f], [[0, 1, 0], 0x3f9b52], [[0, 0, 1], 0x2f6fd0]]) { const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...O), new THREE.Vector3(O[0] + d[0] * L, O[1] + d[1] * L, O[2] + d[2] * L)]); const l = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: c, depthTest: false })); l.renderOrder = 10; g.add(l); }
    ui.dirty = true;
  }
  function placeTool(p, tool) {
    const g = ui.groups.tool;
    if (!tool || !p) { g.visible = false; return; }
    if (ui.toolKey !== tool.id) {
      for (const c of [...g.children]) { g.remove(c); c.geometry.dispose(); c.material.dispose(); }
      ui.toolKey = tool.id;
      const steel = new THREE.MeshStandardMaterial({ color: 0xb8bec6, metalness: 0.7, roughness: 0.3 }), gold = new THREE.MeshStandardMaterial({ color: 0xc9a23a, metalness: 0.6, roughness: 0.35 });
      if (tool.type === "laser") {
        const head = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 20), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6 })); head.position.z = 30; g.add(head);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 20, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a2a })); beam.position.z = 10; g.add(beam);
      } else {
        const R = tool.d / 2, L = Math.max(4, tool.len || tool.d * 3);
        let tip;
        if (tool.type === "ball") { tip = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).rotateX(-Math.PI / 2), gold); tip.position.z = R; g.add(tip); const f = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L - R, 20).rotateX(Math.PI / 2), gold); f.position.z = R + (L - R) / 2; g.add(f); }
        else if (tool.type === "vee" || tool.type === "drill") { const h = Math.min(L, R / Math.tan(((tool.angle || 90) * Math.PI) / 360)); const cone = new THREE.Mesh(new THREE.CylinderGeometry(R, (tool.tip || 0.1) / 2, h, 20).rotateX(Math.PI / 2), gold); cone.position.z = h / 2; g.add(cone); }
        else { const f = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 20).rotateX(Math.PI / 2), gold); f.position.z = L / 2; g.add(f); }
        const shank = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(R, 1.6), Math.max(R, 1.6), 20, 16).rotateX(Math.PI / 2), steel); shank.position.z = L + 10; g.add(shank);
        const collet = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(R, 1.6) + 6, Math.max(R, 1.6) + 3, 18, 20).rotateX(Math.PI / 2), steel); collet.position.z = L + 20 + 9; g.add(collet);
      }
    }
    g.visible = true; g.position.set(p.x, p.y, p.z);
    // on the 4th axis the part turns under the tool
    if (ui.rotG && p.a !== undefined) { ui.rotG.rotation.x = (p.a * Math.PI) / 180; }
  }
  // ------------------------------------------------------------ 4th axis: the turning part
  // everything that turns with the part (the model, the stock, the toolpaths) sits in one group on
  // the axis; group rotation = A, so the side being cut faces up
  function setupRotary(job) {
    const sc = ui.scene;
    if (ui.rotG) { sc.add(ui.groups.stock); sc.add(ui.groups.paths); sc.remove(ui.rotG); ui.rotG.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); ui.rotG = null; }
    ui.groups.stock.visible = ui.groups.paths.visible = true;
    if (!job.rotary) { ui.groups.model.visible = ui.s.show.model; ui.groups.stock.position.set(0, 0, 0); ui.groups.paths.position.set(0, 0, 0); if (ui.fitView) { ui.fitView = false; const c = ui.box.getCenter(new THREE.Vector3()), sz = ui.box.getSize(new THREE.Vector3()); ui.view.target.copy(c); ui.view.dist = Math.max(80, Math.max(sz.x, sz.y, sz.z) * 2.4); } return; }
    const R = job.rotary, G = new THREE.Group(); G.position.set(0, R.yc, R.zc); ui.rotG = G; sc.add(G);
    const r = rotModel(), rel = new Float32Array(r.tris.length);
    for (let i = 0; i < rel.length; i += 3) { rel[i] = r.tris[i]; rel[i + 1] = r.tris[i + 1] - R.yc; rel[i + 2] = r.tris[i + 2] - R.zc; }
    const mg = new THREE.BufferGeometry(); mg.setAttribute("position", new THREE.BufferAttribute(rel, 3)); mg.computeVertexNormals();
    const mm = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ color: 0x5a93db, transparent: true, opacity: 0.35, depthWrite: false })); mm.name = "rmodel"; mm.visible = ui.s.show.model; G.add(mm);
    ui.groups.model.visible = false;
    // the stock and paths groups move into the turning group
    G.add(ui.groups.stock); G.add(ui.groups.paths);
    if (ui.fitView !== false) { ui.view.target.set((R.mx0 + R.mx1) / 2, R.yc, R.zc); ui.view.dist = Math.max(80, Math.max(R.mx1 - R.mx0 + 40, R.R * 4) * 1.9); ui.fitView = false; }
  }
  function buildRotStock() {
    const g = ui.groups.stock; for (const c of [...g.children]) { g.remove(c); c.geometry.dispose(); c.material.dispose(); }
    const sim = ui.sim, sx = Math.max(1, Math.ceil(sim.nx / 400)), sa = Math.max(1, Math.ceil(sim.na / 360));
    const nx = Math.floor((sim.nx - 1) / sx) + 1, na = Math.floor(sim.na / sa);
    const pos = new Float32Array((nx * na + 2) * 3), col = new Float32Array((nx * na + 2) * 3), idx = [];
    for (let i = 0; i < nx - 1; i++) for (let j = 0; j < na; j++) { const a = i * na + j, b = i * na + ((j + 1) % na), c = (i + 1) * na + ((j + 1) % na), d = (i + 1) * na + j; idx.push(a, d, c, a, c, b); }
    const e0 = nx * na, e1 = e0 + 1; // the two end centers
    for (let j = 0; j < na; j++) { const j2 = (j + 1) % na; idx.push(e0, j2, j, e1, (nx - 1) * na + j, (nx - 1) * na + j2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    g.add(m);
    ui.stock = { mesh: m, geo, nx, na, sx, sa, base: new THREE.Color(MAT_COL[ui.s.material] || "#d9c3a0") };
    updateRotStock();
  }
  function updateRotStock() {
    const sim = ui.sim, S = ui.stock; if (!S) return;
    const { nx, na, sx, sa, geo, base } = S, pos = geo.attributes.position.array, col = geo.attributes.color.array, cut = base.clone().multiplyScalar(0.86).lerp(new THREE.Color(1, 1, 1), 0.08);
    const da = (2 * Math.PI) / sim.na;
    for (let i = 0; i < nx; i++) for (let j = 0; j < na; j++) {
      const ii = Math.min(sim.nx - 1, i * sx), jj = j * sa, rho = sim.rho[ii * sim.na + jj], a = jj * da, k = (i * na + j) * 3;
      pos[k] = sim.x0 + ii * sim.res; pos[k + 1] = rho * Math.sin(a); pos[k + 2] = rho * Math.cos(a);
      const c = rho < sim.R - 1e-3 ? cut : base; col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    const e0 = nx * na * 3; pos[e0] = sim.x0; pos[e0 + 1] = 0; pos[e0 + 2] = 0; pos[e0 + 3] = sim.x0 + (sim.nx - 1) * sim.res; pos[e0 + 4] = 0; pos[e0 + 5] = 0;
    for (const q of [e0, e0 + 3]) { col[q] = base.r * 0.9; col[q + 1] = base.g * 0.9; col[q + 2] = base.b * 0.9; }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    const now = performance.now();
    if (!ui.nt || now - ui.nt > 180 || !ui.playing) { geo.computeVertexNormals(); ui.nt = now; }
    geo.computeBoundingSphere();
  }
  // toolpaths drawn on the part (where the tool tip touches it at each angle)
  function drawRotPaths() {
    const g = ui.groups.paths, R = ui.result.job.rotary, rapid = [];
    const P = (m) => { const a = ((m.a || 0) * Math.PI) / 180, r = m.z - R.zc; return [m.x, r * Math.sin(a), r * Math.cos(a)]; };
    for (const { op, moves } of ui.result.prog.ops) {
      const cut = [];
      for (let i = 1; i < moves.length; i++) { const a = moves[i - 1], b = moves[i], L = b.g === 0 ? rapid : cut; const n = Math.max(1, Math.ceil(Math.abs((b.a || 0) - (a.a || 0)) / 3)); for (let k = 0; k < n; k++) { const f0 = k / n, f1 = (k + 1) / n, lerp = (f) => ({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, a: (a.a || 0) + ((b.a || 0) - (a.a || 0)) * f }); L.push(...P(lerp(f0)), ...P(lerp(f1))); } }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(cut, 3));
      g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: OP_COL[op.type] || 0x2f6fd0, transparent: true, opacity: 0.35, depthWrite: false })));
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(rapid, 3));
    g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xd9534f, transparent: true, opacity: 0.25, depthWrite: false })));
    ui.dirty = true;
  }
  // the chuck, the tailstock and the axis line
  function drawRotBed() {
    const g = ui.groups.bed, job = ui.result.job, R = job.rotary, st = job.stock, steel = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 0.6, roughness: 0.4 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6 });
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(R.R * 1.5 + 6, R.R * 1.5 + 6, 22, 32).rotateZ(Math.PI / 2), steel); ch.position.set(st.x0 - 11, R.yc, R.zc); g.add(ch);
    const motor = new THREE.Mesh(new THREE.BoxGeometry(40, R.R * 3 + 20, R.R * 3 + 20), dark); motor.position.set(st.x0 - 42, R.yc, R.zc); g.add(motor);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2, jaw = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 10), dark); jaw.position.set(st.x0 + 4, R.yc + Math.sin(a) * (R.R + 3), R.zc + Math.cos(a) * (R.R + 3)); jaw.rotation.x = -a; g.add(jaw); }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(R.R * 0.35 + 3, 18, 24).rotateZ(Math.PI / 2), steel); tail.position.set(st.x1 + 9, R.yc, R.zc); g.add(tail);
    const tb = new THREE.Mesh(new THREE.BoxGeometry(30, R.R * 2 + 10, R.R * 2 + 16), dark); tb.position.set(st.x1 + 33, R.yc, R.zc - 3); g.add(tb);
    const ax = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(st.x0 - 60, R.yc, R.zc), new THREE.Vector3(st.x1 + 60, R.yc, R.zc)]), new THREE.LineDashedMaterial({ color: 0xd9534f, dashSize: 3, gapSize: 2 })); ax.computeLineDistances(); g.add(ax);
    ui.dirty = true;
  }

  // ------------------------------------------------------------ saving and sending
  function fileName() { const r = ui.result, p = POSTS[r.post]; return ((store.doc.name || "job").replace(/[\\/:*?"<>|]+/g, "").trim() || "job") + "." + p.ext; }
  async function exportDialog() {
    if (!ui.result) return;
    const r = ui.result, p = POSTS[r.post];
    const back = modal("Save G-code",
      el("div", { class: "cam-mbody" },
        el("p", {}, `${fileName()} · ${r.lines.toLocaleString()} lines · about ${fmtTime(r.stats.seconds)} · for ${p.name} (${p.note}).`),
        el("p", { class: "bk-dim" }, `Zero the machine at the ${r.job.origin === "c-top" ? "center of the top of the stock" : r.job.origin === "fl-bottom" ? "front-left corner of the stock, Z on the bed" : "front-left corner of the top of the stock"}. Bits used: ${[...new Set(r.prog.ops.map((o) => "T" + o.op.toolNo + " " + o.op.tool.name))].join(", ")}.`),
        r.prog.ops.length > 1 && new Set(r.prog.ops.map((o) => o.op.toolNo)).size > 1 && r.post !== "linuxcnc" && r.post !== "mach3" ? el("p", { class: "bk-warn" }, "This job changes bits: the file pauses (M0) at each change. Swap the bit, set Z zero again, then resume.") : null,
        el("div", { class: "cam-row2" }, el("button", { class: "btn primary", id: "cam-save-go", onclick: async () => { await app.projects.saveModel(fileName(), new TextEncoder().encode(r.gcode)); app.onExport && app.onExport(p.ext); back.remove(); } }, "Save " + fileName()))));
  }
  function sendDialog() {
    if (!ui.result) return;
    const r = ui.result, P = POSTS[r.post];
    const log = el("pre", { class: "cam-log", id: "cam-log" });
    const say = (t) => { log.textContent += t + "\n"; log.scrollTop = log.scrollHeight; };
    const prog = el("progress", { id: "cam-sendprog", max: 100, value: 0 });
    const supported = typeof navigator !== "undefined" && "serial" in navigator;
    const S = ui.serial || (ui.serial = serialLink(say));
    const btn = (id, label, fn, cls = "btn") => el("button", { class: cls, id, onclick: fn }, label);
    const checks = ["The bit (or laser) is the right one and is tight", "The stock is clamped down", "The machine's zero is set where this job says", "Eye and ear protection on; I'm staying with the machine"].map((t, i) => el("label", { class: "check" }, el("input", { type: "checkbox", class: "cam-safe", id: "cam-safe-" + i }), t));
    const ready = () => [...back.querySelectorAll(".cam-safe")].every((c) => c.checked);
    if (!P.stream) {
      const b2 = modal("Send to machine", el("div", { class: "cam-mbody" },
        el("p", {}, `${P.name} machines load programs from a file: save the G-code, then open it in ${P.name} on the machine's computer (a USB stick or network folder works).`),
        el("div", { class: "cam-row2" }, el("button", { class: "btn primary", onclick: () => { b2.remove(); exportDialog(); } }, "Save G-code…"))));
      return;
    }
    const back = modal("Send to machine",
      el("div", { class: "cam-mbody" },
        !P.stream ? el("p", { class: "bk-warn" }, `${P.name} machines load programs from a file: use Save G-code and open it in the machine's software.`) : null,
        !supported ? el("p", { class: "bk-warn" }, "Sending over USB needs Chrome or Edge on a computer (Web Serial). You can always Save G-code and send it with your machine's own program (for GRBL: UGS, Candle or CNCjs).") : null,
        el("p", { class: "bk-dim" }, `Streams the G-code line by line to a ${P.name} controller over USB and waits for each "ok".`),
        el("div", { class: "cam-row2" }, sel("cam-baud", [["115200", "115200 baud (GRBL)"], ["250000", "250000 baud (Marlin)"], ["57600", "57600"]], r.post === "marlin" ? "250000" : "115200", () => {}, "Baud"), btn("cam-connect", "Connect", async () => { const bd = +back.querySelector("#cam-baud").value; await S.open(bd); })),
        el("div", { class: "cam-row2" }, btn("cam-unlock", "Unlock ($X)", () => S.send("$X")), btn("cam-home", "Home ($H)", () => S.send("$H")), btn("cam-zero", "Set zero here", () => S.send("G10 L20 P1 X0 Y0 Z0"))),
        el("small", {}, "Before you start"), ...checks,
        el("div", { class: "cam-row2" },
          btn("cam-start", "Start job", () => { if (!ready()) { app.toast("Tick the safety checklist first."); return; } S.stream(r.gcode, (k, n) => { prog.value = Math.round((k / n) * 100); }); }, "btn primary"),
          btn("cam-hold", "Pause", () => S.realtime("!")), btn("cam-resume", "Resume", () => S.realtime("~")), btn("cam-stop", "Stop", () => S.stop())),
        prog, log));
    if (!supported || !P.stream) for (const id of ["cam-connect", "cam-unlock", "cam-home", "cam-zero", "cam-start", "cam-hold", "cam-resume", "cam-stop"]) { const b = back.querySelector("#" + id); if (b) b.disabled = true; }
    if (r.post !== "grbl") for (const id of ["cam-unlock", "cam-home", "cam-zero"]) { const b = back.querySelector("#" + id); if (b) b.disabled = true; }
  }
  // a USB serial link (Web Serial): send a line, wait for "ok" (or "error"), like GRBL senders do
  function serialLink(say) {
    let port = null, writer = null, reader = null, buf = "", waiting = null, stopFlag = false;
    const enc = new TextEncoder();
    async function readLoop() {
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value);
          let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; say("< " + line); if (waiting && (/^ok/.test(line) || /^error/.test(line) || /^ALARM/.test(line))) { const w = waiting; waiting = null; w(line); } }
        }
      } catch (e) { say("(connection closed)"); }
    }
    const write = async (t) => { if (!writer) throw new Error("not connected"); await writer.write(enc.encode(t)); };
    return {
      async open(baud) {
        try { port = await navigator.serial.requestPort(); await port.open({ baudRate: baud }); writer = port.writable.getWriter(); reader = port.readable.getReader(); say("Connected at " + baud + " baud."); readLoop(); }
        catch (e) { say("Couldn't connect: " + e.message); }
      },
      async send(line) { try { say("> " + line); await write(line + "\n"); } catch (e) { say("Not connected."); } },
      async realtime(ch) { try { await write(ch); say("> " + (ch === "!" ? "pause" : ch === "~" ? "resume" : "stop")); } catch (e) { say("Not connected."); } },
      async stop() { stopFlag = true; try { await write("\x18"); say("> stop (reset)"); } catch (e) { say("Not connected."); } },
      async stream(text, onProg) {
        const lines = text.split("\n").map((l) => l.replace(/\(.*?\)/g, "").replace(/;.*$/, "").trim()).filter((l) => l && l !== "%");
        stopFlag = false; say(`Sending ${lines.length} lines…`);
        for (let k = 0; k < lines.length; k++) {
          if (stopFlag) { say("Stopped."); return; }
          try { await write(lines[k] + "\n"); } catch (e) { say("Not connected."); return; }
          const resp = await new Promise((res) => { waiting = res; });
          if (/^error|^ALARM/.test(resp)) { say(`Stopped at line ${k + 1}: ${lines[k]} → ${resp}`); return; }
          if (k % 20 === 0 || k === lines.length - 1) onProg(k + 1, lines.length);
        }
        say("Job sent.");
      },
      async close() { try { stopFlag = true; if (reader) { await reader.cancel(); reader.releaseLock(); } if (writer) writer.releaseLock(); if (port) await port.close(); } catch (e) {} },
    };
  }

  return { open, close, get isOpen() { return !!ui; }, _ui: () => ui };
}
