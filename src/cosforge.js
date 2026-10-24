// CosForge: design and model cosplay costumes in a window of its own. A mannequin is built from
// the wearer's measurements, costume parts (helmets, chest plates, pauldrons, bracers, greaves,
// shields...) come from themed templates and are shaped, sculpted and fitted on the body. Parts can
// then be cut into printable pieces with snaps, pegs, slide joints or magnet cups, exported as STL,
// 3MF or OBJ, or added to the JumpStart 3D design for editing in the other modes.
import * as THREE from "three";
import { store, nextSeq, IDENTITY } from "./store.js";
import { el, uid, makeZip } from "./util.js";
import { nextName } from "./ops.js";
import { packMesh, toB64, fromB64, contentId, simplify, readMeshFile, MESH_LIMIT } from "./meshimport.js";
import { stlFile, objFile, threeMFFile } from "./archland.js";
import { MEASURES, PRESETS, POSES, makeBody, bodyGroup, bodyDistance, bodyAxisPoint } from "./cosbody.js";
import { THEMES, SLOTS, REGIONS, TEMPLATES, tplById, generatePart, ADDONS, ADDON_NAMES, SCULPT_RES, ref, formD, cageUV } from "./cosparts.js";
import { TL, displayGeometry, transformSolid, mirrorX, merge, weld, bounds, EMBLEMS, solidVolume, surfaceAt } from "./cosmesh.js";
import { applyCuts, addJoints, autoCuts, fitBed, JOINTS, MAGNETS, PRINTERS, defaultJoint, centroid } from "./coscut.js";

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const clone = (o) => JSON.parse(JSON.stringify(o));
const VIEW_RES = { fast: 6, normal: 4, fine: 3 };
const EXPORT_RES = { normal: 3, fine: 2.5 };
const STEPS = [
  ["body", "Body", "Your measurements"], ["parts", "Parts", "Pick costume parts"], ["shape", "Shape", "Edit the template's settings"], ["form", "Form", "Push and pull a control cage, like a form tool"],
  ["fit", "Fit", "Size and place on the body"], ["sculpt", "Sculpt", "Push, pull and emboss"], ["cut", "Cut & Join", "Split for the printer"], ["export", "Export", "Save or send to your design"],
];
const PLA = 1.24; // g/cm³

// ----------------------------------------------------------------------------- the UI's controls
const DEF = {
  helmet: { face: "open", lens: false, depth: 112, back: 18, brow: 70, faceW: 120, faceH: 40, round: 0, tall: 1, gap: 12 },
  mask: { style: "half", gap: 4 }, crown: { style: "points", points: 7, pointH: 18, top: 62, bottom: 74, gap: 3 },
  chest: { bottom: "straight", vd: 50, side: 100, drop: 40, top: 0.985, neck: 72, arm: 70, gap: 14 },
  back: { bottom: "straight", vd: 50, side: 100, drop: 40, top: 0.985, neck: 50, arm: 70, gap: 14 },
  belt: { height: 60, dz: -30, open: 24, buckle: 0, gap: 8 },
  tasset: { plates: 3, len: 200, cover: 200, flare: 0.25, split: 14, band: 0, dz: 20, gap: 10 },
  pauldron: { shape: "round", size: 1, width: 1, drop: 1, tilt: 32, reach: 105, gap: 10 },
  limb: { from: 0.1, to: 0.9, cover: 300, point: 0, flareTop: 0, flareBot: 0, bottomPoints: 0, gap: 6 },
  boot: { from: 0.72, to: 1, cover: 300, extend: 45, flareTop: 0, flareBot: 28, point: 0, bottomPoints: 0, gap: 6 },
  gorget: { from: 0, to: 1, cover: 330, point: 0, flareTop: 0, flareBot: 0, bottomPoints: 0, spread: 1, gap: 8 },
  handplate: { gap: 4 }, knee: { size: 1, wings: 1, fan: 0, gap: 8 }, toe: { gap: 8 }, shield: { shape: "round", size: 500, curve: 700, gap: 10 },
};
const LIMB = ["upperarm", "bracer", "thigh", "greave"];
const defOf = (slot) => (LIMB.includes(slot) ? { ...DEF.limb, ...(slot === "thigh" ? { from: 0.25, to: 0.88, cover: 200 } : slot === "greave" ? { from: 0.06, to: 0.9, cover: 240 } : slot === "upperarm" ? { from: 0.35, to: 0.9 } : {}) } : DEF[slot] || {});
const GAP = ["gap", "Gap to the body", "rng", 0, 40, 0.5, "mm"];
const LIMB_CTRL = [["from", "Starts at", "rng", 0, 0.9, 0.01, ""], ["to", "Ends at", "rng", 0.1, 1, 0.01, ""], ["cover", "Wraps around", "rng", 60, 360, 1, "°"], ["point", "Point at the top", "rng", 0, 90, 1, "mm"], ["flareTop", "Flare at the top", "rng", 0, 40, 0.5, "mm"], ["flareBot", "Flare at the bottom", "rng", 0, 50, 0.5, "mm"], ["bottomPoints", "Points along the bottom", "rng", 0, 30, 1, "mm"], GAP];
const SHAPE_CTRL = {
  helmet: [["face", "Face opening", "sel", [["open", "Open face"], ["visor", "Eye visor"], ["bigvisor", "Full visor"], ["tvisor", "T visor"], ["slit", "Eye slit"], ["cowl", "Cowl (eyes and mouth)"], ["closed", "Closed"]]], ["lens", "Separate visor lens", "chk"], ["depth", "Comes down to", "rng", 70, 145, 1, "°"], ["back", "Neck guard", "rng", 0, 60, 1, "°"], ["brow", "Brow line", "rng", 50, 88, 1, "°"], ["faceW", "Opening width", "rng", 40, 200, 1, "mm"], ["faceH", "Opening height", "rng", 10, 140, 1, "mm"], ["round", "Rounder", "rng", 0, 1, 0.05, ""], ["tall", "Taller", "rng", 0.9, 1.3, 0.01, "×"], GAP],
  mask: [["style", "Style", "sel", [["domino", "Domino (eyes)"], ["half", "Half face"], ["lower", "Lower face"], ["full", "Full face"]]], GAP],
  crown: [["style", "Top edge", "sel", [["points", "Points"], ["round", "Waves"], ["flat", "Plain band"]]], ["points", "Points", "rng", 3, 18, 1, ""], ["pointH", "Point height", "rng", 0, 45, 1, "mm"], ["top", "Top line", "rng", 45, 74, 1, "°"], ["bottom", "Bottom line", "rng", 60, 90, 1, "°"], GAP],
  chest: [["bottom", "Bottom edge", "sel", [["straight", "Straight"], ["v", "V point"], ["round", "Rounded"], ["arch", "Arched"], ["points", "Points"]]], ["vd", "Bottom shape depth", "rng", 0, 140, 1, "mm"], ["side", "Wraps around", "rng", 40, 170, 1, "°"], ["drop", "Below the waist", "rng", -100, 180, 1, "mm"], ["top", "Top edge", "rng", 0.85, 1, 0.005, ""], ["neck", "Neck opening", "rng", 20, 140, 1, "mm"], ["arm", "Arm openings", "rng", 20, 140, 1, "mm"], GAP],
  belt: [["height", "Height", "rng", 20, 140, 1, "mm"], ["dz", "Up or down", "rng", -200, 120, 1, "mm"], ["open", "Gap at the back", "rng", 0, 160, 1, "°"], ["buckle", "Buckle plate", "rng", 0, 160, 1, "mm"], GAP],
  tasset: [["plates", "Plates", "rng", 1, 8, 1, ""], ["len", "Length", "rng", 60, 420, 1, "mm"], ["cover", "Wraps around", "rng", 60, 360, 1, "°"], ["flare", "Flare out", "rng", 0, 0.7, 0.01, ""], ["split", "Gap between plates", "rng", 0, 60, 1, "mm"], ["band", "Top band", "rng", 0, 80, 1, "mm"], ["dz", "Up or down", "rng", -120, 150, 1, "mm"], GAP],
  pauldron: [["shape", "Shape", "sel", [["round", "Round"], ["shield", "Shield"], ["tower", "Tall plate"], ["spiky", "Spiky top"]]], ["size", "Size", "rng", 0.6, 1.8, 0.01, "×"], ["width", "Width", "rng", 0.5, 1.8, 0.01, "×"], ["drop", "Down the arm", "rng", 0.5, 1.8, 0.01, "×"], ["tilt", "Tilt outward", "rng", 0, 75, 1, "°"], ["reach", "Coverage", "rng", 60, 150, 1, "°"], GAP],
  boot: [...LIMB_CTRL.slice(0, 3), ["extend", "Down over the foot", "rng", 0, 80, 1, "mm"], ...LIMB_CTRL.slice(4)],
  handplate: [GAP], toe: [GAP],
  knee: [["size", "Size", "rng", 0.6, 1.8, 0.01, "×"], ["wings", "Side wings", "chk"], ["fan", "Top fan", "chk"], GAP],
  shield: [["shape", "Shape", "sel", [["round", "Round"], ["kite", "Kite"], ["heater", "Heater"], ["hex", "Hexagon"], ["tower", "Tower"]]], ["size", "Size", "rng", 200, 900, 5, "mm"], ["curve", "Curve (bigger is flatter)", "rng", 250, 2500, 10, "mm"], GAP],
};
SHAPE_CTRL.back = SHAPE_CTRL.chest;
SHAPE_CTRL.gorget = [["spread", "Down the shoulders", "rng", 0.3, 2.5, 0.05, "×"], ...LIMB_CTRL];
for (const s of LIMB) SHAPE_CTRL[s] = LIMB_CTRL;
const DECO_CTRL = [
  ["thick", "Thickness", "rng", 1, 6, 0.1, "mm", 2.5],
  ["edge", "Edge", "sel", [["none", "Plain"], ["roll", "Rolled"], ["trim", "Raised trim"], ["flare", "Flared out"], ["bevel", "Thin bevel"]], "none"],
  ["edgeSize", "Edge width", "rng", 1, 20, 0.5, "mm", 6], ["edgeH", "Edge height", "rng", 0.3, 6, 0.1, "mm", 2],
  ["ridge", "Centre ridge", "rng", 0, 12, 0.1, "mm", 0], ["ridgeW", "Ridge width", "rng", 2, 40, 0.5, "mm", 10], ["ridgeSharp", "Sharp ridge", "chk", false],
  ["ridgeDir", "Ridge runs", "sel", [["v", "Along the part"], ["h", "Across the part"]], "v"],
  ["lines", "Panel lines", "sel", [["none", "None"], ["inset", "Inset from edge"], ["panels", "Panels"], ["grid", "Grid"], ["hbands", "Bands across"], ["vbands", "Bands along"], ["chevron", "Chevrons"]], "none"],
  ["lineGap", "Line spacing", "rng", 3, 60, 0.5, "mm", 14], ["lineDepth", "Line depth", "rng", 0.2, 3, 0.1, "mm", 1],
  ["tex", "Texture", "sel", [["none", "None"], ["hex", "Hex plates"], ["scales", "Dragon scales"], ["lames", "Overlapping plates"], ["ribs", "Ribs"], ["quilt", "Quilted"], ["hammered", "Hammered"]], "none"],
  ["texSize", "Texture size", "rng", 5, 80, 0.5, "mm", 20], ["texDepth", "Texture depth", "rng", 0.2, 5, 0.1, "mm", 1.5],
  ["muscle", "Muscles", "rng", 0, 1.6, 0.05, "", 0, (s) => s === "chest" || s === "back"],
  ["emblem", "Emblem", "sel", EMBLEMS.map((e) => [e, e === "none" ? "None" : e.charAt(0).toUpperCase() + e.slice(1)]), "none"],
  ["emblemSize", "Emblem size", "rng", 6, 200, 1, "mm", 30], ["emblemH", "Emblem height", "rng", 0.4, 8, 0.1, "mm", 2.5],
  ["emblemX", "Emblem across", "rng", -200, 200, 1, "mm", 0], ["emblemDY", "Emblem up or down", "rng", -200, 200, 1, "mm", 0],
  ["glow", "Light lines (accent colour)", "chk", false], ["emblemGlow", "Glowing emblem", "chk", false],
  ["rivets", "Rivets", "chk", false], ["rivetInset", "Rivets from the edge", "rng", 3, 40, 0.5, "mm", 9], ["rivetGap", "Rivet spacing", "rng", 8, 80, 1, "mm", 26], ["rivetSize", "Rivet size", "rng", 1, 6, 0.1, "mm", 2.6],
];
const ADDON_CTRL = {
  _: [["x", "Across", "rng", -250, 250, 1, "mm"], ["y", "Along", "rng", -50, 600, 1, "mm"], ["size", "Size", "rng", 2, 160, 0.5, "mm"], ["mirror", "Mirror to the other side", "chk"], ["count", "How many in a row", "rng", 1, 12, 1, ""], ["step", "Row spacing", "rng", 5, 120, 1, "mm"], ["rowAcross", "Row runs across", "chk"]],
  horn: [["len", "Length", "rng", 10, 400, 1, "mm"], ["curl", "Curl", "rng", -180, 180, 1, "°"], ["tilt", "Lean", "rng", -90, 90, 1, "°"], ["ang", "Lean direction", "rng", -180, 180, 1, "°"]],
  spike: [["len", "Length", "rng", 5, 200, 1, "mm"], ["tilt", "Lean", "rng", -90, 90, 1, "°"], ["ang", "Lean direction", "rng", -180, 180, 1, "°"]],
  fin: [["len", "Length", "rng", 10, 500, 1, "mm"], ["h", "Height", "rng", 3, 200, 1, "mm"], ["w", "Thickness", "rng", 1, 20, 0.5, "mm"], ["profile", "Profile", "sel", [["blade", "Blade"], ["shark", "Shark fin"], ["mohawk", "Mohawk"], ["rounded", "Rounded"], ["ear", "Pointed"]]], ["across", "Runs across", "chk"], ["path", "Over the top of the head", "chk", "sagittal"]],
  ear: [["len", "Width", "rng", 10, 150, 1, "mm"], ["h", "Height", "rng", 5, 150, 1, "mm"], ["w", "Thickness", "rng", 1, 15, 0.5, "mm"], ["across", "Runs across", "chk"]],
  plate: [["shape", "Shape", "sel", [["wing", "Wing"], ["crescent", "Crescent"], ["flame", "Flame"], ["star", "Star"], ["diamond", "Diamond"], ["bolt", "Bolt"], ["crest", "Crest"], ["sun", "Sun"]]], ["rot", "Turn", "rng", -180, 180, 1, "°"], ["w", "Thickness", "rng", 1, 12, 0.5, "mm"], ["lift", "Lift off the surface", "rng", -3, 20, 0.5, "mm"], ["accent", "Accent colour", "chk"]],
  antenna: [["len", "Length", "rng", 10, 300, 1, "mm"]],
  box: [["w", "Width", "rng", 5, 200, 1, "mm"], ["len", "Height", "rng", 5, 200, 1, "mm"], ["h", "Depth", "rng", 3, 120, 1, "mm"]],
};
const ADDON_DEF = { horn: { size: 15, len: 120, curl: 60, tilt: 30, ang: -90, mirror: true }, spike: { size: 8, len: 30 }, fin: { len: 120, h: 30, w: 4, profile: "blade" }, ear: { len: 46, h: 50, w: 4, mirror: true }, plate: { size: 50, shape: "wing", w: 3, mirror: true }, gem: { size: 10 }, antenna: { len: 60 }, goggles: { size: 22, mirror: true }, thruster: { size: 16, mirror: true }, gauge: { size: 18 }, boss: { size: 55 }, box: { size: 22 } };

export function initCosForge(app) {
  let ui = null;
  const toast = (m, k) => app.toast && app.toast(m, k);

  // ----------------------------------------------------------------------------- state
  function blank() {
    return { v: 1, units: "cm", preset: "broad", meas: { ...PRESETS[0].m }, pose: 42, detail: "normal", exportDetail: "fine", printer: "256", parts: [], theme: "all", region: "all", bodyView: "solid", joint: defaultJoint(), orient: "worn", exportWhat: "all", exportFmt: "stl", withBody: false };
  }
  function serialize(st) {
    const o = { ...st, parts: st.parts.map((p) => { const q = { ...p }; delete q._sv; q.sculpt = {}; for (const k of ["bulge", "emboss"]) if (p.sculpt && p.sculpt[k]) q.sculpt[k] = toB64(new Uint8Array(p.sculpt[k].buffer.slice(0))); return q; }) };
    return JSON.stringify(o);
  }
  function deserialize(json) {
    const o = typeof json === "string" ? JSON.parse(json) : json;
    const st = { ...blank(), ...o };
    st.parts = (o.parts || []).map((p) => { const q = { ...p, sculpt: {} }; for (const k of ["bulge", "emboss"]) if (p.sculpt && p.sculpt[k]) { const u8 = fromB64(p.sculpt[k]); q.sculpt[k] = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4).slice(); } q._sv = 0; return q; });
    return st;
  }

  // ----------------------------------------------------------------------------- building parts
  function fitMatrix(inst, anchor) {
    const f = inst.fit || {}, o = f.off || [0, 0, 0], r = f.rot || [0, 0, 0], s = f.scl || [1, 1, 1];
    const T = new THREE.Matrix4().makeTranslation(anchor.x + o[0], anchor.y + o[1], anchor.z + o[2]);
    const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rad(r[0]), rad(r[1]), rad(r[2]), "XYZ"));
    const S = new THREE.Matrix4().makeScale(s[0], s[1], s[2]);
    const Tm = new THREE.Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z);
    return T.multiply(R).multiply(S).multiply(Tm);
  }
  // cuts are kept in the part's own space (before Fit), so moving a part moves its cuts with it
  function planeToWorld(c, F) {
    const A = new THREE.Matrix3().setFromMatrix4(F), Ai = A.clone().invert().transpose();
    const n = V3(...c.n).applyMatrix3(Ai), t = V3().setFromMatrixPosition(F);
    const l = n.length();
    return { n: n.clone().divideScalar(l), d: (c.d + n.dot(t)) / l, seed: c.seed ? V3(...c.seed).applyMatrix4(F) : null, joint: c.joint };
  }
  function planeToLocal(n, d, seed, F) {
    const A = new THREE.Matrix3().setFromMatrix4(F), t = V3().setFromMatrixPosition(F);
    const nl = n.clone().applyMatrix3(A.clone().transpose()), l = nl.length();
    return { n: nl.divideScalar(l).toArray(), d: (d - n.dot(t)) / l, seed: seed ? seed.clone().applyMatrix4(F.clone().invert()).toArray() : null };
  }
  const genCache = new Map(), pieceCache = new Map();
  function genKey(inst, res) { return JSON.stringify([inst.slot, inst.shape, inst.deco, inst.addons, inst.form, inst.import && inst.import.id, inst._sv, inst.id, res, ui.bodyKey]); }
  function importedSolid(inst) {
    const u8 = fromB64(inst.import.data);
    const nv = new Uint32Array(u8.buffer.slice(0, 8));
    const V = new Float32Array(u8.buffer.slice(8, 8 + nv[0] * 12)), I = new Uint32Array(u8.buffer.slice(8 + nv[0] * 12, 8 + nv[0] * 12 + nv[1] * 12));
    // which faces look at the body: the inside of an imported shell
    const tl = new Float32Array(I.length / 3), c = V3(), a = V3(), b = V3(), d = V3();
    for (let t = 0; t < I.length / 3; t++) {
      a.fromArray(V, I[t * 3] * 3); b.fromArray(V, I[t * 3 + 1] * 3); d.fromArray(V, I[t * 3 + 2] * 3);
      c.copy(a).add(b).add(d).multiplyScalar(1 / 3);
      const n = b.clone().sub(a).cross(d.clone().sub(a));
      const ax = bodyAxisPoint(ui.B, c);
      tl[t] = ax && n.dot(ax.sub(c)) > 0 ? TL.IN : TL.OUT;
    }
    return { pos: V, idx: I, tl };
  }
  function generate(inst, res) {
    const k = genKey(inst, res);
    let g = genCache.get(k);
    if (g) return g;
    if (inst.import) {
      const solid = importedSolid(inst);
      g = { solid, extra: [], desc: null, ctx: { L: 200, W: 100 } };
    } else g = generatePart(inst, ui.B, res);
    g.anchor = bounds(g.solid).getCenter(V3());
    genCache.set(k, g);
    if (genCache.size > 60) genCache.delete(genCache.keys().next().value);
    return g;
  }
  // pieces of one part in world space: [{ name, side, mesh, lens }]
  function build(inst, res) {
    const k = genKey(inst, res) + JSON.stringify([inst.fit, inst.cuts, inst.side]);
    let r = pieceCache.get(k);
    if (r) return r;
    const g = generate(inst, res);
    const F = fitMatrix(inst, g.anchor);
    const solid = transformSolid(g.solid, F);
    const cuts = (inst.cuts || []).map((c) => planeToWorld(c, F));
    const cut = applyCuts(solid, cuts);
    const j = addJoints(cut.pieces, cut.seams, cuts);
    let pieces = j.pieces.map((m, i) => ({ name: j.pieces.length > 1 ? `${inst.name} ${i + 1}` : inst.name, mesh: m, lens: false }));
    for (const ex of g.extra) for (const m of applyCuts(transformSolid(ex.solid, F), cuts).pieces) pieces.push({ name: `${inst.name} ${ex.name}`, mesh: m, lens: true });
    const sided = SLOTS[inst.slot] && SLOTS[inst.slot].sided;
    let out = [];
    if (!sided || inst.side === "C") out = pieces.map((p) => ({ ...p, side: "C" }));
    else {
      if (inst.side !== "R") out.push(...pieces.map((p) => ({ ...p, side: "L", name: p.name + " (left)" })));
      if (inst.side !== "L") out.push(...pieces.map((p) => ({ ...p, side: "R", name: p.name + " (right)", mesh: mirrorX(p.mesh) })));
    }
    r = { pieces: out, F, g, joints: j.joints, seams: cut.seams.length };
    pieceCache.set(k, r);
    if (pieceCache.size > 40) pieceCache.delete(pieceCache.keys().next().value);
    return r;
  }

  // ----------------------------------------------------------------------------- open / close
  function open() {
    if (ui) return;
    const st = store.doc.cosforge ? safeLoad(store.doc.cosforge) : blank();
    buildUI(st);
  }
  function safeLoad(j) { try { return deserialize(j); } catch (e) { return blank(); } }
  function close() {
    if (!ui) return;
    saveToDesign();
    cancelAnimationFrame(ui.raf);
    removeEventListener("keydown", ui.onKey, true);
    ui.ro.disconnect();
    ui.renderer.dispose();
    ui.root.remove();
    document.body.classList.remove("s3d-on");
    ui = null;
    genCache.clear(); pieceCache.clear();
    app.vp && app.vp.request && app.vp.request();
  }
  function saveToDesign() {
    if (!ui) return;
    const json = serialize(ui.st);
    if (json === ui.savedJson) return;
    ui.savedJson = json;
    store.update((doc) => { doc.cosforge = json; }, "CosForge costume");
  }

  // ----------------------------------------------------------------------------- the window
  function buildUI(st) {
    const root = el("div", { class: "cf", id: "cosforge", role: "dialog", "aria-label": "CosForge" });
    const stepNav = el("nav", { class: "cf-steps", "aria-label": "Steps" });
    const side = el("aside", { class: "cf-side", id: "cf-side" });
    const outfit = el("aside", { class: "cf-outfit", id: "cf-outfit" });
    const canvas = el("canvas", { class: "cf-canvas", id: "cf-canvas" });
    const hud = el("div", { class: "cf-hud", id: "cf-hud" });
    const busy = el("div", { class: "cf-busy", id: "cf-busy", hidden: true }, el("span", { class: "cam-spin" }), el("span", { class: "cf-busy-t" }, "Building…"));
    const vbar = el("div", { class: "cf-vbar" },
      ...[["front", "Front"], ["side", "Side"], ["back", "Back"], ["iso", "3D"]].map(([v, l]) => el("button", { class: "cf-vb", id: "cf-view-" + v, title: l + " view", onclick: () => viewFrom(v) }, l)),
      el("button", { class: "cf-vb", id: "cf-fitall", title: "Fit the whole body in the view", onclick: () => frameAll() }, "⤢"),
      el("button", { class: "cf-vb", id: "cf-fitsel", title: "Zoom to the selected part", onclick: () => frameSel() }, "◎"),
      el("span", { class: "cf-vsep" }),
      segBtns([["solid", "Body"], ["ghost", "Ghost"], ["hide", "No body"]], st.bodyView, (v) => { st.bodyView = v; applyBodyView(); }, "cf-bodyview"),
      el("label", { class: "cf-chk cf-vchk", title: "Pull the pieces apart to see the cuts" }, el("input", { type: "checkbox", id: "cf-explode", onchange: (e) => { ui.explode = e.target.checked; refreshScene(); } }), "Explode"));
    const view = el("div", { class: "cf-view" }, canvas, vbar, hud, busy);
    const bar = el("header", { class: "cf-bar" },
      el("div", { class: "cf-brand" }, el("b", {}, "Cos", el("span", {}, "Forge")), el("small", {}, "Cosplay costume designer")),
      stepNav, el("div", { class: "cf-sp" }),
      el("div", { class: "cf-tools" },
        el("button", { class: "ibtn cf-tb", id: "cf-undo", title: "Undo (Ctrl+Z)", onclick: () => undo() }, "↶"),
        el("button", { class: "ibtn cf-tb", id: "cf-redo", title: "Redo (Ctrl+Y)", onclick: () => redo() }, "↷"),
      ),
      el("button", { class: "btn primary cf-back", id: "cf-back", title: "Close CosForge. Your costume is kept with this design.", onclick: () => close() }, "← Back to JumpStart 3D"));
    root.append(bar, el("div", { class: "cf-main" }, side, view, outfit));
    document.body.append(root);
    document.body.classList.add("s3d-on");

    // three.js
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 10, 50000);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6258, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(-1500, -2500, 3500); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(2000, 2500, 1500); scene.add(rim);
    const head = new THREE.DirectionalLight(0xffffff, 0.6); camera.add(head); scene.add(camera);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(900, 64), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 1, transparent: true, opacity: 0.35 }));
    floor.position.z = -0.5; scene.add(floor);
    const grid = new THREE.PolarGridHelper(900, 8, 6, 64, 0x7c8590, 0x7c8590); grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9bfb4, roughness: 0.85, metalness: 0 });
    const partMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12 });
    const selMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12, emissive: new THREE.Color(0x2a4f8f), emissiveIntensity: 0.35 });
    const lensMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.6 });
    const partsGroup = new THREE.Group(); scene.add(partsGroup);
    const helpers = new THREE.Group(); scene.add(helpers);
    const controls = makeOrbit(camera, canvas);

    ui = { root, st, side, outfit, stepNav, canvas, hud, busy, renderer, scene, camera, controls, bodyMat, partMat, selMat, lensMat, partsGroup, helpers, step: "body", sel: null, explode: false, undo: [], redo: [], raf: 0, dirty: true, savedJson: store.doc.cosforge || null, built: new Map(), meshes: [], sculpt: { tool: "bulge", radius: 30, strength: 1, mirror: true }, cut: { axis: "z", tiltA: 0, tiltB: 0, pos: null, only: false }, form: { sel: new Set(), mode: "point", sym: true, soft: 0, step: 2, rotAxis: "z", show: true } };
    ui.savedJson = store.doc.cosforge ? serialize(st) : null;
    rebuildBody();
    renderSteps();
    renderOutfit();
    showStep(st.parts.length ? "parts" : "body");
    viewFrom("iso", true);
    // render loop (only when something changed)
    const loop = () => { ui.raf = requestAnimationFrame(loop); if (controls.update() || ui.dirty) { ui.dirty = false; renderer.render(scene, camera); } };
    ui.raf = requestAnimationFrame(loop);
    controls.onChange = () => { ui.dirty = true; };
    ui.ro = new ResizeObserver(() => resize());
    ui.ro.observe(view);
    resize();
    setupPointer();
    ui.onKey = (e) => {
      if (!ui) return;
      const t = e.target;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (e.key === "Escape" && !typing && ui.step === "form" && ui.form.sel.size) { e.preventDefault(); e.stopPropagation(); ui.form.sel.clear(); drawCage(); return; }
      if (e.key === "Escape" && !typing) { const m = ui.root.querySelector(".s3d-modal-back"); if (m) m.remove(); else close(); e.preventDefault(); e.stopPropagation(); return; }
      if ((e.ctrlKey || e.metaKey) && !typing && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && !typing && (e.key === "y" || e.key === "Y")) { e.preventDefault(); e.stopPropagation(); redo(); return; }
      if (!typing && ui.step === "form" && ui.form.sel.size && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); e.stopPropagation(); nudgeNormal((e.key === "ArrowUp" ? 1 : -1) * ui.form.step * (e.shiftKey ? 5 : 1)); return; }
      if (!typing && ui.step === "form" && e.key === "Escape" && ui.form.sel.size) { e.preventDefault(); e.stopPropagation(); ui.form.sel.clear(); drawCage(); return; }
      if (!typing && (e.key === "Delete" || e.key === "Backspace") && ui.sel) { e.preventDefault(); e.stopPropagation(); removePart(ui.sel); return; }
      if (!typing) e.stopPropagation();
    };
    addEventListener("keydown", ui.onKey, true);
    refreshScene();
  }
  function resize() {
    if (!ui) return;
    const r = ui.canvas.parentElement.getBoundingClientRect();
    ui.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    ui.camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
    ui.camera.updateProjectionMatrix();
    ui.dirty = true;
  }

  // ----------------------------------------------------------------------------- history
  function snapshot(label) {
    ui.undo.push({ json: serialize(ui.st), label, sel: ui.sel });
    if (ui.undo.length > 50) ui.undo.shift();
    ui.redo = [];
  }
  function restore(s) {
    const keep = { theme: ui.st.theme, region: ui.st.region, bodyView: ui.st.bodyView };
    ui.st = { ...deserialize(s.json), ...keep };
    ui.st.parts.forEach((p) => { p._sv = (p._sv || 0) + Math.random(); });
    ui.sel = ui.st.parts.some((p) => p.id === s.sel) ? s.sel : null;
    rebuildBody(); renderOutfit(); showStep(ui.step); refreshScene();
  }
  function undo() { const s = ui.undo.pop(); if (!s) { toast("Nothing to undo."); return; } ui.redo.push({ json: serialize(ui.st), label: s.label, sel: ui.sel }); restore(s); toast("Undid: " + s.label); }
  function redo() { const s = ui.redo.pop(); if (!s) { toast("Nothing to redo."); return; } ui.undo.push({ json: serialize(ui.st), label: s.label, sel: ui.sel }); restore(s); toast("Redid: " + s.label); }
  // a burst of slider changes makes one undo step
  let burst = null;
  function change(label, fn, { body = false, now = false } = {}) {
    if (!burst || burst.label !== label || Date.now() - burst.t > 1200) snapshot(label);
    burst = { label, t: Date.now() };
    fn();
    if (body) rebuildBody();
    renderOutfit();
    schedule(now ? 0 : 90);
  }

  // ----------------------------------------------------------------------------- body
  function rebuildBody() {
    const st = ui.st;
    ui.B = makeBody(st.meas, st.pose);
    ui.bodyKey = JSON.stringify([st.meas, st.pose]);
    if (ui.bodyMesh) { ui.scene.remove(ui.bodyMesh); ui.bodyMesh.traverse((o) => o.geometry && o.geometry.dispose()); }
    ui.bodyMesh = bodyGroup(ui.B, ui.bodyMat);
    ui.scene.add(ui.bodyMesh);
    applyBodyView();
  }
  function applyBodyView() {
    const v = ui.st.bodyView;
    ui.bodyMesh.visible = v !== "hide";
    ui.bodyMat.transparent = v === "ghost"; ui.bodyMat.opacity = v === "ghost" ? 0.28 : 1; ui.bodyMat.depthWrite = v !== "ghost";
    ui.bodyMat.needsUpdate = true;
    ui.root.querySelectorAll("#cf-bodyview button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
    ui.dirty = true;
  }

  // ----------------------------------------------------------------------------- scene
  let timer = 0, pendingT = false;
  const timer_pending = () => pendingT;
  function schedule(ms = 90) { clearTimeout(timer); pendingT = true; timer = setTimeout(() => { pendingT = false; refreshScene(); }, ms); }
  function setBusy(t) { if (!ui) return; ui.busy.hidden = !t; if (t) ui.busy.querySelector(".cf-busy-t").textContent = t; }
  // rebuild what changed, one part at a time so the window stays responsive
  function refreshScene(opts = {}) {
    if (!ui) return;
    const st = ui.st, res = opts.res || VIEW_RES[st.detail] || 4;
    const want = st.parts.filter((p) => !p.hidden);
    const todo = want.filter((p) => !pieceCache.has(genKey(p, res) + JSON.stringify([p.fit, p.cuts, p.side])));
    const run = () => {
      if (!ui) return;
      const p = todo.shift();
      if (p) {
        setBusy("Building " + p.name + "…");
        setTimeout(() => { if (!ui) return; try { build(p, res); } catch (e) { console.error(e); p._err = String(e && e.message || e); } run(); }, todo.length || opts.res ? 0 : 16);
        return;
      }
      setBusy(null);
      drawParts(want, res);
      if (opts.done) opts.done();
    };
    if (!todo.length) { drawParts(want, res); if (opts.done) opts.done(); return; }
    run();
  }
  function drawParts(list, res) {
    const g = ui.partsGroup;
    for (const m of ui.meshes) { g.remove(m); m.geometry.dispose(); }
    ui.meshes = [];
    const ctrAll = V3();
    for (const p of list) {
      let r;
      try { r = build(p, res); } catch (e) { continue; }
      const all = r.pieces;
      const c0 = V3(); let n0 = 0;
      for (const pc of all) { const c = centroid(pc.mesh); c0.add(c); n0++; }
      if (n0) c0.divideScalar(n0);
      ctrAll.add(c0);
      const tint = ui.fitTint ? fitTinter(p.deco && p.deco.thick || 2.5) : null;
      all.forEach((pc, i) => {
        const geo = displayGeometry(pc.mesh, p.color, p.accent || p.color, "#f0b23c", tint);
        const mesh = new THREE.Mesh(geo, pc.lens ? ui.lensMat : p.id === ui.sel ? ui.selMat : ui.partMat);
        mesh.userData = { part: p.id, piece: i, side: pc.side };
        if (ui.explode && all.length > 1) {
          const c = centroid(pc.mesh), dir = c.clone().sub(c0);
          if (dir.lengthSq() < 1) dir.set(0, -1, 0);
          mesh.position.copy(dir.normalize().multiplyScalar(45));
        }
        g.add(mesh); ui.meshes.push(mesh);
      });
    }
    updateHud();
    renderOutfit();
    if (ui.step === "cut") { drawCutPlane(); renderPieceList(); }
    if (ui.step === "form") drawCage();
    if (ui.step === "fit" && ui.fitTint) renderFitReport();
    ui.dirty = true;
  }
  // just one part, quickly (while sculpting)
  function drawPartOnly(p, res) {
    const r = build(p, res), g = ui.partsGroup;
    ui.meshes = ui.meshes.filter((m) => { if (m.userData.part !== p.id) return true; g.remove(m); m.geometry.dispose(); return false; });
    r.pieces.forEach((pc, i) => {
      const mesh = new THREE.Mesh(displayGeometry(pc.mesh, p.color, p.accent || p.color), pc.lens ? ui.lensMat : p.id === ui.sel ? ui.selMat : ui.partMat);
      mesh.userData = { part: p.id, piece: i, side: pc.side };
      g.add(mesh); ui.meshes.push(mesh);
    });
    if (ui.step === "form") drawCage(res);
    ui.dirty = true;
  }
  function fitTinter(thick) {
    const B = ui.B, p = V3();
    return (t, m) => {
      const tag = m.tl[t];
      if (tag !== TL.IN && tag !== TL.JOINT && tag !== TL.OUT) return null;
      const I = m.idx, P = m.pos;
      p.set((P[I[t * 3] * 3] + P[I[t * 3 + 1] * 3] + P[I[t * 3 + 2] * 3]) / 3, (P[I[t * 3] * 3 + 1] + P[I[t * 3 + 1] * 3 + 1] + P[I[t * 3 + 2] * 3 + 1]) / 3, (P[I[t * 3] * 3 + 2] + P[I[t * 3 + 1] * 3 + 2] + P[I[t * 3 + 2] * 3 + 2]) / 3);
      const d = bodyDistance(B, p) - (tag === TL.OUT ? thick : 0);
      return d < 0 ? "#e5322d" : d < 4 ? "#f39b1f" : "#3fb46b";
    };
  }
  function updateHud() {
    const st = ui.st, sel = selPart();
    let pieces = 0, vol = 0;
    for (const p of st.parts) { if (p.hidden) continue; const r = pieceCache.get(genKey(p, VIEW_RES[st.detail] || 4) + JSON.stringify([p.fit, p.cuts, p.side])); if (!r) continue; pieces += r.pieces.length; for (const pc of r.pieces) vol += Math.abs(solidVolume(pc.mesh)); }
    ui.totals = { pieces, grams: (vol / 1000) * PLA };
    ui.hud.textContent = "";
    ui.hud.append(el("span", {}, `${st.parts.length} part${st.parts.length === 1 ? "" : "s"} · ${pieces} piece${pieces === 1 ? "" : "s"} · about ${Math.round(ui.totals.grams)} g of PLA`));
    if (sel) ui.hud.append(el("span", { class: "cf-hud-sel" }, "Selected: " + sel.name));
  }
  function selPart() { return ui.st.parts.find((p) => p.id === ui.sel) || null; }
  function select(id) {
    ui.sel = id;
    for (const m of ui.meshes) if (!(m.material === ui.lensMat)) m.material = m.userData.part === id ? ui.selMat : ui.partMat;
    renderOutfit(); updateHud();
    if (ui.form) ui.form.sel.clear();
    if (["shape", "form", "fit", "sculpt", "cut"].includes(ui.step)) showStep(ui.step);
    ui.dirty = true;
  }

  // ----------------------------------------------------------------------------- camera
  function viewFrom(v, instant) {
    const H = ui.B.H, t = V3(0, 0, H * 0.52), d = H * 1.75;
    const dir = v === "front" ? V3(0, -1, 0.05) : v === "back" ? V3(0, 1, 0.05) : v === "side" ? V3(1, 0, 0.05) : V3(0.55, -1, 0.35);
    ui.controls.target.copy(t);
    ui.camera.position.copy(t).addScaledVector(dir.normalize(), d);
    ui.camera.lookAt(t);
    ui.dirty = true;
    void instant;
  }
  function frameAll() { viewFrom("iso"); }
  function frameSel() {
    const box = new THREE.Box3();
    for (const m of ui.meshes) if (m.userData.part === ui.sel) box.expandByObject(m);
    if (box.isEmpty()) { toast("Select a part first."); return; }
    frameBox(box);
  }
  function frameBox(box) {
    const c = box.getCenter(V3()), r = box.getSize(V3()).length() / 2 || 300;
    const dir = ui.camera.position.clone().sub(ui.controls.target).normalize();
    ui.controls.target.copy(c);
    ui.camera.position.copy(c).addScaledVector(dir, (r / Math.tan(rad(ui.camera.fov / 2))) * 1.15);
    ui.dirty = true;
  }

  // ----------------------------------------------------------------------------- steps
  function renderSteps() {
    ui.stepNav.textContent = "";
    STEPS.forEach(([id, name, tip], i) => ui.stepNav.append(el("button", { class: "cf-step", id: "cf-step-" + id, "data-step": id, title: tip, "aria-pressed": String(ui.step === id), onclick: () => showStep(id) }, el("i", {}, String(i + 1)), name)));
  }
  function showStep(id) {
    ui.step = id;
    ui.stepNav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.step === id)));
    const s = ui.side;
    s.textContent = "";
    ui.helpers.clear();
    if (id !== "fit" && ui.fitTint) { ui.fitTint = false; schedule(0); }
    ({ body: panelBody, parts: panelParts, shape: panelShape, form: panelForm, fit: panelFit, sculpt: panelSculpt, cut: panelCut, export: panelExport })[id]();
    ui.dirty = true;
  }
  const H = (t, sub) => el("div", { class: "cf-h" }, el("h3", {}, t), sub ? el("p", {}, sub) : null);
  const needPart = () => { ui.side.append(el("p", { class: "cf-empty" }, ui.st.parts.length ? "Pick a part: click it on the body or in the Outfit list." : "Add a part first: go to Parts and pick a template.")); };

  // --- 1 Body
  function panelBody() {
    const st = ui.st, s = ui.side;
    s.append(H("Your body", "Enter the wearer's measurements. The mannequin and every part follow them, so the costume fits."));
    s.append(el("div", { class: "cf-chips", id: "cf-presets" }, ...PRESETS.map((p) => el("button", { class: "cf-chip", "aria-pressed": String(st.preset === p.id), id: "cf-preset-" + p.id, onclick: () => { change("Body preset", () => { st.preset = p.id; st.meas = { ...p.m }; }, { body: true, now: true }); showStep("body"); } }, p.name))));
    s.append(el("div", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Units"), segBtns([["cm", "cm"], ["in", "inches"]], st.units, (v) => { st.units = v; showStep("body"); }, "cf-units")));
    const k = st.units === "in" ? 25.4 : 10;
    let grp = null;
    for (const m of MEASURES) {
      if (m.grp !== grp) { grp = m.grp; s.append(el("div", { class: "cf-sub" }, grp)); }
      const inp = el("input", { type: "number", class: "num cf-num", id: "cf-m-" + m.k, step: st.units === "in" ? "0.25" : "0.5", min: "1", value: String(Math.round((st.meas[m.k] / k) * 100) / 100), title: m.tip });
      inp.addEventListener("change", () => { const v = parseFloat(inp.value); if (!(v > 0)) return; change("Measurement", () => { st.meas[m.k] = v * k; st.preset = "custom"; }, { body: true }); });
      s.append(el("label", { class: "cf-row", title: m.tip }, el("span", { class: "cf-lbl" }, m.name), inp, el("span", { class: "cf-unit" }, st.units)));
    }
    s.append(el("div", { class: "cf-sub" }, "Pose"));
    s.append(el("div", { class: "cf-chips" }, ...POSES.map((p) => el("button", { class: "cf-chip", id: "cf-pose-" + p.id, "aria-pressed": String(Math.abs(st.pose - p.deg) < 1), onclick: () => { change("Pose", () => { st.pose = p.deg; }, { body: true, now: true }); showStep("body"); } }, p.name))));
    s.append(rng("Arms out", st.pose, 0, 90, 1, "°", (v) => change("Pose", () => { st.pose = v; }, { body: true }), "cf-pose"));
    s.append(el("p", { class: "cf-tip" }, "Tip: measure over the clothes you'll wear under the costume. Each part has a Gap setting for padding."));
  }

  // --- 2 Parts
  function panelParts() {
    const st = ui.st, s = ui.side;
    s.append(H("Costume parts", "Click a template to put it on the body. Arm and leg parts come as a left and right pair."));
    s.append(el("div", { class: "cf-chips", id: "cf-themes" }, ...[["all", "All"], ...THEMES.map((t) => [t.id, t.name])].map(([id, n]) => el("button", { class: "cf-chip", id: "cf-theme-" + id, "aria-pressed": String(st.theme === id), onclick: () => { st.theme = id; showStep("parts"); } }, n))));
    s.append(el("div", { class: "cf-chips", id: "cf-regions" }, ...[["all", "Everywhere"], ...REGIONS.map((r) => [r, r])].map(([id, n]) => el("button", { class: "cf-chip small", id: "cf-region-" + id, "aria-pressed": String(st.region === id), onclick: () => { st.region = id; showStep("parts"); } }, n))));
    if (st.theme !== "all" && st.theme !== "basic") s.append(el("button", { class: "btn primary cf-wide", id: "cf-addset", onclick: () => addSet(st.theme) }, "Add the whole " + THEMES.find((t) => t.id === st.theme).name + " set"));
    const list = TEMPLATES.filter((t) => (st.theme === "all" || t.theme === st.theme) && (st.region === "all" || SLOTS[t.slot].region === st.region));
    const grid = el("div", { class: "cf-cards", id: "cf-cards" });
    for (const t of list) {
      const cv = el("canvas", { width: 112, height: 112, class: "cf-thumb" });
      const card = el("button", { class: "cf-card", id: "cf-tpl-" + t.id, title: "Add " + t.name, onclick: () => addPart(t) }, cv, el("b", {}, t.name), el("small", {}, SLOTS[t.slot].name + " · " + THEMES.find((x) => x.id === t.theme).name));
      grid.append(card);
      thumb(t, cv);
    }
    s.append(grid);
    s.append(el("div", { class: "cf-sub" }, "Your own parts"));
    const file = el("input", { type: "file", accept: ".stl,.3mf", id: "cf-import-file", style: { display: "none" }, onchange: async (e) => { const f = e.target.files[0]; if (f) await importFile(f.name, new Uint8Array(await f.arrayBuffer())); e.target.value = ""; } });
    s.append(file, el("div", { class: "cf-btnrow" },
      el("button", { class: "btn", id: "cf-import", title: "Bring in an STL or 3MF part (a prop, or a part from another app) to fit, cut and add joints to", onclick: () => file.click() }, "Import STL / 3MF…"),
      el("button", { class: "btn", id: "cf-fromdesign", title: "Use the objects selected in your JumpStart 3D design", onclick: () => importFromDesign() }, "From my design")));
  }
  function newInst(t) {
    const sd = SLOTS[t.slot];
    return { id: uid("cp"), tpl: t.id, slot: t.slot, name: t.name, color: t.color, accent: t.accent, side: sd.sided ? sd.one || "both" : "C", shape: clone(t.shape), deco: clone(t.deco), addons: clone(t.addons), ...(t.form ? { form: clone(t.form) } : {}), fit: { off: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] }, sculpt: {}, cuts: [], _sv: 0 };
  }
  function addPart(t) {
    const inst = newInst(t);
    change("Add " + t.name, () => { ui.st.parts.push(inst); }, { now: true });
    ui.sel = inst.id;
    renderOutfit();
    toast(`Added ${t.name}. Shape, Fit and Sculpt it, then Cut & Join for printing.`);
  }
  function addSet(theme) {
    const bySlot = new Map();
    for (const t of TEMPLATES) if (t.theme === theme && t.set && !bySlot.has(t.slot)) bySlot.set(t.slot, t);
    const list = [...bySlot.values()];
    change("Add set", () => { for (const t of list) ui.st.parts.push(newInst(t)); }, { now: true });
    ui.sel = ui.st.parts[ui.st.parts.length - 1].id;
    toast(`Added ${list.length} parts. They take a moment to build.`);
  }
  // little pictures of the templates (made lazily, in the main renderer)
  const thumbs = new Map();
  let thumbQ = [], thumbBusy = false;
  function thumb(t, cv) {
    if (thumbs.has(t.id)) { cv.getContext("2d").putImageData(thumbs.get(t.id), 0, 0); return; }
    thumbQ.push([t, cv]);
    if (!thumbBusy) { thumbBusy = true; setTimeout(nextThumb, 60); }
  }
  function nextThumb() {
    if (!ui || !thumbQ.length) { thumbBusy = false; return; }
    const [t, cv] = thumbQ.shift();
    if (!cv.isConnected) { setTimeout(nextThumb, 0); return; }
    try {
      const inst = newInst(t), g = generatePart(inst, ui.B, 8);
      const geo = displayGeometry(g.solid, t.color, t.accent);
      const scn = new THREE.Scene();
      scn.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.2));
      const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-1, -2, 2); scn.add(dl);
      const m = new THREE.Mesh(geo, ui.partMat); scn.add(m);
      const box = new THREE.Box3().setFromObject(m), c = box.getCenter(V3()), r = box.getSize(V3()).length() / 2;
      const cam = new THREE.PerspectiveCamera(30, 1, 1, 10000); cam.up.set(0, 0, 1);
      const dir = SLOTS[t.slot].region === "Arms" || t.slot === "shield" ? V3(1, -0.9, 0.4) : t.slot === "back" ? V3(0.4, 1, 0.3) : V3(0.45, -1, 0.3);
      cam.position.copy(c).addScaledVector(dir.normalize(), r / Math.tan(rad(15)) * 1.05); cam.lookAt(c);
      const rt = new THREE.WebGLRenderTarget(112, 112, { samples: 4 });
      ui.renderer.setRenderTarget(rt); ui.renderer.setClearColor(0x000000, 0); ui.renderer.clear(); ui.renderer.render(scn, cam);
      const px = new Uint8Array(112 * 112 * 4); ui.renderer.readRenderTargetPixels(rt, 0, 0, 112, 112, px);
      ui.renderer.setRenderTarget(null); rt.dispose(); geo.dispose();
      const img = new ImageData(112, 112);
      // the render target holds linear colour: brighten to screen (sRGB) values
      const G = new Uint8Array(256); for (let i = 0; i < 256; i++) G[i] = Math.round(255 * Math.pow(i / 255, 1 / 2.2));
      for (let y = 0; y < 112; y++) for (let x = 0; x < 112; x++) { const a = ((111 - y) * 112 + x) * 4, b = (y * 112 + x) * 4; img.data[b] = G[px[a]]; img.data[b + 1] = G[px[a + 1]]; img.data[b + 2] = G[px[a + 2]]; img.data[b + 3] = px[a + 3]; }
      thumbs.set(t.id, img);
      cv.getContext("2d").putImageData(img, 0, 0);
      ui.dirty = true;
    } catch (e) { /* no picture */ }
    setTimeout(nextThumb, 10);
  }
  async function importFile(name, bytes) {
    let r;
    try { r = await readMeshFile(bytes); } catch (e) { toast("Couldn't read that file: " + (e.message || e), "err"); return; }
    let mesh = r.mesh;
    addImported(name.replace(/\.[^.]+$/, ""), mesh, true);
  }
  function addImported(name, mesh, place) {
    // place it in front of the chest if it came from somewhere else
    const b = new THREE.Box3(); for (let i = 0; i < mesh.V.length; i += 3) b.expandByPoint(V3(mesh.V[i], mesh.V[i + 1], mesh.V[i + 2]));
    const c = b.getCenter(V3());
    let V = mesh.V;
    if (place) {
      const tgt = V3(0, -ui.B.head.b * 2.4, ui.B.z.chest);
      V = new Float32Array(mesh.V.length);
      for (let i = 0; i < V.length; i += 3) { V[i] = mesh.V[i] - c.x + tgt.x; V[i + 1] = mesh.V[i + 1] - c.y + tgt.y; V[i + 2] = mesh.V[i + 2] - c.z + tgt.z; }
    }
    const bytes = packMesh({ V, I: mesh.I });
    const inst = { id: uid("cp"), tpl: "custom", slot: "custom", name: name || "Imported part", color: "#b8c0cc", accent: "#b8c0cc", side: "C", shape: {}, deco: {}, addons: [], fit: { off: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] }, sculpt: {}, cuts: [], import: { id: contentId(bytes), data: toB64(bytes) }, _sv: 0 };
    change("Import part", () => ui.st.parts.push(inst), { now: true });
    ui.sel = inst.id;
    toast("Imported " + inst.name + ". Use Fit to move and size it, then Cut & Join.");
  }
  function importFromDesign() {
    const ids = (app.sel || []).filter((id) => { const v = app.scene.views.get(id); return v && v.data && v.mesh; });
    if (!ids.length) { toast("Select one or more objects in your design first, then come back here.", "err"); return; }
    for (const id of ids) {
      const v = app.scene.views.get(id), b = store.doc.bodies.find((x) => x.id === id);
      v.mesh.updateMatrixWorld(true);
      const M = v.mesh.matrixWorld, P = v.data.vertices, T = v.data.triangles;
      const V = new Float32Array(P.length), p = V3();
      for (let i = 0; i < P.length; i += 3) { p.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); V[i] = p.x; V[i + 1] = p.y; V[i + 2] = p.z; }
      const I = new Uint32Array(T);
      if (M.determinant() < 0) for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
      addImported((b && b.name) || "Design part", { V, I }, true);
    }
  }

  // --- 3 Shape
  function panelShape() {
    const p = selPart(), s = ui.side;
    if (!p) return needPart();
    s.append(H(p.name, (SLOTS[p.slot] ? SLOTS[p.slot].name : "Imported part") + ". Change the form; it stays fitted to the body."));
    s.append(el("label", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Name"), el("input", { class: "cf-text", id: "cf-name", value: p.name, onchange: (e) => change("Rename", () => { p.name = e.target.value.trim() || p.name; }, { now: true }) })));
    s.append(el("div", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Colours"),
      el("input", { type: "color", id: "cf-color", value: p.color, title: "Main colour", oninput: (e) => change("Colour", () => { p.color = e.target.value; }) }),
      el("input", { type: "color", id: "cf-accent", value: p.accent || p.color, title: "Accent colour (gems, lens, trims on 3MF)", oninput: (e) => change("Colour", () => { p.accent = e.target.value; }) })));
    if (SLOTS[p.slot] && SLOTS[p.slot].sided) s.append(el("div", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Sides"), segBtns([["both", "Both"], ["L", "Left"], ["R", "Right"]], p.side, (v) => change("Sides", () => { p.side = v; }, { now: true }), "cf-sides")));
    if (p.import) { s.append(el("p", { class: "cf-tip" }, "Imported parts keep their own shape. Use Fit to place them, and Cut & Join to split them for printing.")); return; }
    const det = (title, open, kids) => el("details", { class: "cf-det", open: open || null }, el("summary", {}, title), ...kids);
    const sh = { ...defOf(p.slot), ...p.shape };
    s.append(det("Form", true, (SHAPE_CTRL[p.slot] || []).map((c) => ctrl(c, sh[c[0]], (v) => change("Shape", () => { p.shape[c[0]] = v; }), "cf-s-" + c[0]))));
    const D = p.deco;
    s.append(det("Surface details", true, DECO_CTRL.filter((c) => !c[8] || c[8](p.slot)).map((c) => ctrl(c, D[c[0]] ?? c[7], (v) => change("Details", () => { D[c[0]] = v; }), "cf-d-" + c[0]))));
    // add-ons
    const g = generate(p, VIEW_RES[ui.st.detail] || 4), ctx = g.ctx || {};
    const box = el("div", { class: "cf-addons", id: "cf-addons" });
    (p.addons || []).forEach((a, i) => {
      const rows = [...ADDON_CTRL._, ...(ADDON_CTRL[a.k] || [])].filter((c) => !(c[0] === "path" && p.slot !== "helmet"));
      box.append(el("div", { class: "cf-addon" },
        el("div", { class: "cf-addon-h" }, el("b", {}, ADDON_NAMES[a.k] || a.k), el("label", { class: "cf-chk" }, el("input", { type: "checkbox", checked: !a.off || null, onchange: (e) => change("Add-on", () => { a.off = !e.target.checked; }) }), "On"), el("button", { class: "ibtn cf-x", title: "Remove", onclick: () => { change("Remove add-on", () => p.addons.splice(i, 1), { now: true }); showStep("shape"); } }, "✕")),
        ...rows.map((c) => {
          let val = a[c[0]];
          if (c[0] === "x" || c[0] === "y") val = ref(val ?? 0, ctx);
          if (c[0] === "path") val = a.path === "sagittal";
          val = val ?? (ADDON_DEF[a.k] || {})[c[0]] ?? (c[2] === "chk" ? false : c[2] === "sel" ? c[3][0][0] : c[3]);
          return ctrl(c, val, (v) => change("Add-on", () => { a[c[0]] = c[0] === "path" ? (v ? "sagittal" : undefined) : v; }), "cf-a" + i + "-" + c[0]);
        })));
    });
    const addSel = el("select", { class: "cf-sel", id: "cf-addon-new" }, el("option", { value: "" }, "Add a horn, fin, gem…"), ...ADDONS.map((k) => el("option", { value: k }, ADDON_NAMES[k])));
    addSel.onchange = () => { const k = addSel.value; if (!k) return; change("Add-on", () => { (p.addons = p.addons || []).push({ k, x: (ADDON_DEF[k] || {}).mirror ? Math.round((ctx.W || 100) * 0.3) : 0, y: Math.round((ctx.mid ?? ctx.L / 2) || 50), ...(ADDON_DEF[k] || {}) }); }, { now: true }); showStep("shape"); };
    s.append(det("Add-ons", (p.addons || []).length > 0, [box, addSel]));
    s.append(el("div", { class: "cf-btnrow" }, el("button", { class: "btn", id: "cf-reset-form", title: "Put the form back the way the template had it (keeps fit, sculpting and cuts)", onclick: () => { const t = tplById(p.tpl); if (!t) return; change("Reset form", () => { p.shape = clone(t.shape); p.deco = clone(t.deco); p.addons = clone(t.addons); if (t.form) p.form = clone(t.form); else delete p.form; }, { now: true }); showStep("shape"); } }, "Reset to template")));
  }

  // --- 4 Fit
  function panelFit() {
    const p = selPart(), s = ui.side;
    if (!p) return needPart();
    s.append(H("Fit " + p.name, "Move, turn and size the part on the body. Changing your measurements re-fits it automatically."));
    const f = p.fit;
    if (!p.import) {
      const sh = { ...defOf(p.slot), ...p.shape };
      s.append(rng("Gap to the body", sh.gap ?? 8, 0, 40, 0.5, "mm", (v) => change("Fit", () => { p.shape.gap = v; }), "cf-f-gap"));
      s.append(rng("Thickness", p.deco.thick ?? 2.5, 1, 6, 0.1, "mm", (v) => change("Fit", () => { p.deco.thick = v; }), "cf-f-thick"));
    }
    const lim = p.import ? 800 : 150;
    s.append(el("div", { class: "cf-sub" }, "Move"));
    ["Left / right", "Front / back", "Down / up"].forEach((l, i) => s.append(rng(l, f.off[i], -lim, lim, 0.5, "mm", (v) => change("Move", () => { f.off[i] = v; }), "cf-f-off" + i)));
    s.append(el("div", { class: "cf-sub" }, "Turn"));
    ["Tip forward", "Roll", "Turn"].forEach((l, i) => s.append(rng(l, f.rot[i], -180, 180, 0.5, "°", (v) => change("Turn", () => { f.rot[i] = v; }), "cf-f-rot" + i)));
    s.append(el("div", { class: "cf-sub" }, "Size"));
    const lock = el("input", { type: "checkbox", id: "cf-f-lock", checked: f.lock !== false || null, onchange: (e) => { f.lock = e.target.checked; } });
    s.append(el("label", { class: "cf-chk" }, lock, "Keep proportions"));
    ["Width", "Depth", "Height"].forEach((l, i) => s.append(rng(l, f.scl[i], 0.3, 3, 0.01, "×", (v) => change("Size", () => { if (f.lock !== false) { const k = v / (f.scl[i] || 1); f.scl = f.scl.map((x) => x * k); } else f.scl[i] = v; showStepSoon(); }), "cf-f-scl" + i)));
    s.append(el("div", { class: "cf-btnrow" },
      el("button", { class: "btn", id: "cf-f-reset", onclick: () => { change("Reset fit", () => { p.fit = { off: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] }; }, { now: true }); showStep("fit"); } }, "Reset fit"),
      el("button", { class: "btn" + (ui.fitTint ? " primary" : ""), id: "cf-fitcheck", title: "Colour the inside of every part: green fits, orange is tight, red pushes into the body", onclick: () => { ui.fitTint = !ui.fitTint; pieceCacheTintReset(); showStep("fit"); refreshScene({ done: () => ui.fitTint && renderFitReport() }); } }, ui.fitTint ? "Hide fit check" : "Check the fit")));
    s.append(el("div", { id: "cf-fitreport" }));
    if (ui.fitTint) renderFitReport();
  }
  let stepSoon = 0;
  function showStepSoon() { clearTimeout(stepSoon); stepSoon = setTimeout(() => ui && showStep(ui.step), 400); }
  function pieceCacheTintReset() { /* tint is applied when drawing; nothing cached */ }
  function renderFitReport() {
    const box = ui.side.querySelector("#cf-fitreport");
    if (!box) return;
    box.textContent = "";
    const B = ui.B, res = VIEW_RES[ui.st.detail] || 4, p0 = V3();
    const rows = [];
    for (const p of ui.st.parts) {
      if (p.hidden) continue;
      let r; try { r = build(p, res); } catch (e) { continue; }
      let n = 0, inside = 0, tight = 0, minD = Infinity;
      for (const pc of r.pieces) {
        if (pc.side === "R" || pc.lens) continue;
        const m = pc.mesh, I = m.idx, P = m.pos;
        const step = Math.max(1, Math.floor(I.length / 3 / 2500));
        for (let t = 0; t < I.length / 3; t += step) {
          if (m.tl[t] !== TL.IN) continue;
          p0.set((P[I[t * 3] * 3] + P[I[t * 3 + 1] * 3] + P[I[t * 3 + 2] * 3]) / 3, (P[I[t * 3] * 3 + 1] + P[I[t * 3 + 1] * 3 + 1] + P[I[t * 3 + 2] * 3 + 1]) / 3, (P[I[t * 3] * 3 + 2] + P[I[t * 3 + 1] * 3 + 2] + P[I[t * 3 + 2] * 3 + 2]) / 3);
          const d = bodyDistance(B, p0); n++; if (d < 0) inside++; else if (d < 4) tight++; minD = Math.min(minD, d);
        }
      }
      if (!n) continue;
      let msg, cls;
      if (inside / n > 0.01) { msg = `${Math.round((inside / n) * 100)}% pushes into the body. Raise the Gap or move it out.`; cls = "bad"; }
      else if (tight / n > 0.05) { msg = "Fits, tight in places (orange). Fine over thin clothes."; cls = "warn"; }
      else { msg = `Fits, with ${Math.max(0, Math.round(minD))} mm or more of room.`; cls = "good"; }
      rows.push(el("div", { class: "cf-fitrow " + cls }, el("b", {}, p.name), el("span", {}, msg)));
      // can a head get through the bottom of a helmet?
      if (p.slot === "helmet" && r.g.desc) {
        const d = r.g.desc, sh = { ...defOf("helmet"), ...p.shape }, v = (rad(sh.depth) - d.th0) / (d.th1 - d.th0);
        const a = d.point(0.25, v, V3()), b = d.point(0.75, v, V3()), c = d.point(0.5, v, V3()), e = d.point(0, v, V3());
        const sideW = a.distanceTo(b), depthW = c.distanceTo(e), hw = B.head.a * 2, hd = B.head.b * 2;
        if (sideW < hw + 4 || depthW < hd + 4) rows.push(el("div", { class: "cf-fitrow warn" }, el("b", {}, p.name), el("span", {}, `The bottom opening (${Math.round(sideW)} × ${Math.round(depthW)} mm) is smaller than the head (${Math.round(hw)} × ${Math.round(hd)} mm). Cut it into a front and a back half in Cut & Join, with joints, so it can go on.`)));
      }
    }
    box.append(el("div", { class: "cf-sub" }, "Fit check"), ...(rows.length ? rows : [el("p", { class: "cf-tip" }, "Nothing to check yet.")]));
  }

  // --- 5 Sculpt
  function panelSculpt() {
    const p = selPart(), s = ui.side;
    if (!p) return needPart();
    s.append(H("Sculpt " + p.name, "Drag on the part to shape it. Drag on empty space to turn the view. The left and right of a pair change together."));
    if (p.import) { s.append(el("p", { class: "cf-tip" }, "Imported parts can't be sculpted here. Add them to your design and use Chisel mode, or sculpt a template part.")); return; }
    const sc = ui.sculpt;
    const tools = [["bulge", "Bulge out", "Push the form outward (the whole shell moves)"], ["dent", "Push in", "Push the form inward"], ["emboss", "Emboss", "Raise the outside surface (thicker)"], ["engrave", "Engrave", "Carve into the outside surface"], ["smooth", "Smooth", "Even out bumps"], ["erase", "Erase", "Take sculpting away"]];
    s.append(el("div", { class: "cf-chips", id: "cf-sc-tools" }, ...tools.map(([id, n, tip]) => el("button", { class: "cf-chip", id: "cf-sc-" + id, title: tip, "aria-pressed": String(sc.tool === id), onclick: () => { sc.tool = id; showStep("sculpt"); } }, n))));
    s.append(rng("Brush size", sc.radius, 5, 150, 1, "mm", (v) => { sc.radius = v; }, "cf-sc-radius"));
    s.append(rng("Strength", sc.strength, 0.1, 4, 0.1, "", (v) => { sc.strength = v; }, "cf-sc-strength"));
    if (!(SLOTS[p.slot] && SLOTS[p.slot].sided)) s.append(el("label", { class: "cf-chk" }, el("input", { type: "checkbox", id: "cf-sc-mirror", checked: sc.mirror || null, onchange: (e) => { sc.mirror = e.target.checked; } }), "Mirror left and right"));
    s.append(el("div", { class: "cf-btnrow" }, el("button", { class: "btn", id: "cf-sc-clear", onclick: () => { change("Clear sculpting", () => { p.sculpt = {}; p._sv = (p._sv || 0) + 1; }, { now: true }); } }, "Clear sculpting")));
    s.append(el("p", { class: "cf-tip" }, "Bulge and Push in reshape the form (good for muscles, dents and flares). Emboss and Engrave add or carve surface detail."));
  }

  // --- Form: a control cage over the part (like Fusion 360's Form tool)
  const FRES = () => VIEW_RES[ui.st.detail] || 4;
  function formClosed(p) { const g = generate(p, FRES()); return !!(g.desc && g.desc.closedU); }
  function ensureForm(p) {
    if (p.form) return p.form;
    const cl = formClosed(p), nu = cl ? 12 : 7, nv = 6;
    p.form = { nu, nv, sharp: false, d: new Array(nu * nv * 3).fill(0) };
    return p.form;
  }
  function resampleForm(p, nu, nv) {
    const f = ensureForm(p), cl = formClosed(p), d = new Array(nu * nv * 3).fill(0), o = [0, 0, 0];
    if (f.d.some((x) => x)) for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const [u, v] = cageUV({ nu, nv }, cl, i, j); formD(f, u, v, cl, o); d[(j * nu + i) * 3] = o[0]; d[(j * nu + i) * 3 + 1] = o[1]; d[(j * nu + i) * 3 + 2] = o[2]; }
    p.form = { nu, nv, sharp: f.sharp, d };
    ui.form.sel.clear();
  }
  const mirrorIdx = (f, cl, k) => { const i = k % f.nu, j = Math.floor(k / f.nu); const i2 = cl ? (f.nu - i) % f.nu : f.nu - 1 - i; return j * f.nu + i2; };
  const symOn = (p) => ui.form.sym && !(SLOTS[p.slot] && SLOTS[p.slot].sided) && !p.import;
  // where each cage point is: local (part space) and on screen (world), with normals
  function cageInfo(p, res) {
    const r = build(p, res || FRES()), g = r.g, f = ensureForm(p), cl = !!g.desc.closedU;
    const th = (p.deco && p.deco.thick) || 2.5, P = V3(), N = V3();
    const nodes = [];
    for (let j = 0; j < f.nv; j++) for (let i = 0; i < f.nu; i++) {
      const [u, v] = cageUV(f, cl, i, j);
      surfaceAt(g.desc, u, v, P, N);
      const local = P.clone().addScaledVector(N, th + 0.8), base = g.desc.basePoint(u, v, V3());
      nodes.push({ i, j, u, v, local, n: N.clone(), base, world: local.clone().applyMatrix4(r.F) });
    }
    return { r, g, f, cl, nodes };
  }
  function drawCage(res) {
    if (!ui || ui.step !== "form") return;
    ui.helpers.clear();
    const p = selPart();
    if (!p || p.import || !ui.form.show) return;
    let ci;
    try { ci = cageInfo(p, res); } catch (e) { return; }
    ui.cage = ci;
    const { f, cl, nodes } = ci, sel = ui.form.sel;
    const lp = [];
    for (let j = 0; j < f.nv; j++) for (let i = 0; i < f.nu; i++) {
      const a = nodes[j * f.nu + i];
      if (i < f.nu - 1 || cl) { const b = nodes[j * f.nu + ((i + 1) % f.nu)]; lp.push(a.world.x, a.world.y, a.world.z, b.world.x, b.world.y, b.world.z); }
      if (j < f.nv - 1) { const b = nodes[(j + 1) * f.nu + i]; lp.push(a.world.x, a.world.y, a.world.z, b.world.x, b.world.y, b.world.z); }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2f6fe0, transparent: true, opacity: 0.85, depthTest: false }));
    lines.renderOrder = 10;
    const pp = [], pc = [], c1 = new THREE.Color(0xffffff), c2 = new THREE.Color(0xff7a1a);
    for (const [k, nd] of nodes.entries()) { pp.push(nd.world.x, nd.world.y, nd.world.z); const c = sel.has(k) ? c2 : c1; pc.push(c.r, c.g, c.b); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute("position", new THREE.Float32BufferAttribute(pp, 3)); pg.setAttribute("color", new THREE.Float32BufferAttribute(pc, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    pts.renderOrder = 11;
    const ring = new THREE.Points(pg, new THREE.PointsMaterial({ size: 12, sizeAttenuation: false, color: 0x1b3d80, depthTest: false }));
    ring.renderOrder = 10;
    ui.helpers.add(lines, ring, pts);
    if (sel.size) drawGizmo(ci);
    const info = ui.side.querySelector("#cf-form-info");
    if (info) info.textContent = sel.size ? `${sel.size} point${sel.size === 1 ? "" : "s"} selected` + (symOn(p) ? " (mirrored)" : "") : "Click points on the cage to select them.";
    ui.dirty = true;
  }
  function selCentroid(ci) { const c = V3(); let n = 0; for (const k of ui.form.sel) { c.add(ci.nodes[k].world); n++; } return n ? c.divideScalar(n) : c; }
  function selNormalWorld(ci) { const nn = V3(); for (const k of ui.form.sel) nn.add(ci.nodes[k].n); const A = new THREE.Matrix3().setFromMatrix4(ci.r.F).invert().transpose(); return nn.applyMatrix3(A).normalize(); }
  function drawGizmo(ci) {
    const c = selCentroid(ci), size = ui.camera.position.distanceTo(c) * 0.09;
    const g = new THREE.Group(); g.position.copy(c); g.name = "gizmo";
    const arrow = (dir, color, axis, len = 1) => {
      const m = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.035, size * 0.035, size * len, 8), m);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(size * 0.11, size * 0.28, 14), m);
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize());
      shaft.quaternion.copy(q); shaft.position.copy(dir).multiplyScalar(size * len / 2);
      tip.quaternion.copy(q); tip.position.copy(dir).multiplyScalar(size * len + size * 0.12);
      for (const o of [shaft, tip]) { o.renderOrder = 20; o.userData = { gizmo: axis, dir: dir.clone().normalize() }; g.add(o); }
    };
    arrow(V3(1, 0, 0), 0xe5322d, "x"); arrow(V3(0, 1, 0), 0x2fae4e, "y"); arrow(V3(0, 0, 1), 0x2f6fe0, "z");
    const nw = selNormalWorld(ci);
    if (nw.lengthSq() > 0.5) arrow(nw, 0xf2b31b, "n", 1.45);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(size * 0.13, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    ball.renderOrder = 21; ball.userData = { gizmo: "free" }; g.add(ball);
    ui.helpers.add(g);
  }
  // weights: 1 for selected points, fading over `soft` cage steps around them
  function weights(f, cl, set) {
    const w = new Float32Array(f.nu * f.nv), soft = ui.form.soft;
    for (const k of set) w[k] = 1;
    if (soft > 0) for (let k = 0; k < w.length; k++) {
      if (w[k] === 1) continue;
      const i = k % f.nu, j = Math.floor(k / f.nu);
      let best = Infinity;
      for (const s2 of set) { const i2 = s2 % f.nu, j2 = Math.floor(s2 / f.nu); let di = Math.abs(i - i2); if (cl) di = Math.min(di, f.nu - di); best = Math.min(best, Math.hypot(di, j - j2)); }
      if (best <= soft) w[k] = Math.max(w[k], (1 - best / (soft + 1)) ** 2);
    }
    return w;
  }
  // move the selection: fn(node) -> a local move for that point (before weights); mirrored when symmetry is on
  function deform(p, ci, fn) {
    const f = p.form, cl = ci.cl, sym = symOn(p);
    // with symmetry, a point and its mirror image are one handle
    const set = sym ? new Set([...ui.form.sel].filter((k) => { const m = mirrorIdx(f, cl, k); return m === k || !ui.form.sel.has(m) || k < m; })) : ui.form.sel;
    const w = weights(f, cl, set);
    const msel = sym ? new Set([...set].map((k) => mirrorIdx(f, cl, k))) : null, wm = sym ? weights(f, cl, msel) : null;
    const moves = new Map();
    for (const k of set) moves.set(k, fn(ci.nodes[k]));
    // soft points follow the move of the nearest selected point
    const nearest = (k, from) => { let best = null, bd = Infinity; const i = k % f.nu, j = Math.floor(k / f.nu); for (const s2 of from) { const i2 = s2 % f.nu, j2 = Math.floor(s2 / f.nu); let di = Math.abs(i - i2); if (cl) di = Math.min(di, f.nu - di); const dd = Math.hypot(di, j - j2); if (dd < bd) { bd = dd; best = s2; } } return best; };
    for (let k = 0; k < w.length; k++) {
      if (w[k] > 0) { const m = moves.get(k) || moves.get(nearest(k, set)); f.d[k * 3] += m.x * w[k]; f.d[k * 3 + 1] += m.y * w[k]; f.d[k * 3 + 2] += m.z * w[k]; }
      if (sym && wm[k] > 0) {
        const src = msel.has(k) ? mirrorIdx(f, cl, k) : mirrorIdx(f, cl, nearest(k, msel));
        const m = moves.get(src) || moves.get(nearest(src, set));
        if (!m) continue;
        const onPlane = mirrorIdx(f, cl, k) === k;
        if (onPlane && w[k] > 0) { f.d[k * 3] -= m.x * w[k]; continue; } // points on the middle line don't move sideways
        f.d[k * 3] += -m.x * wm[k]; f.d[k * 3 + 1] += m.y * wm[k]; f.d[k * 3 + 2] += m.z * wm[k];
      }
    }
    for (let k = 0; k < f.d.length; k++) f.d[k] = Math.round(f.d[k] * 1000) / 1000;
  }
  const toLocalDir = (ci, wv) => wv.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(ci.r.F).invert());
  function formEdit(label, fn, fast) {
    const p = selPart(); if (!p || p.import) return;
    if (!ui.form.sel.size && !/Reset all|Smooth|Crease|density/i.test(label)) { toast("Select some cage points first.", "err"); return; }
    const ci = ui.cage && ui.cage.f === p.form ? ui.cage : cageInfo(p);
    change(label, () => fn(p, ci), { now: !fast });
    if (fast) { try { drawPartOnly(p, Math.max(FRES(), 6)); } catch (e) { /* skip */ } }
  }
  const nudgeNormal = (mm) => formEdit("Form: push and pull", (p, ci) => deform(p, ci, (nd) => nd.n.clone().multiplyScalar(mm)));
  const nudgeAxis = (axis, mm) => formEdit("Form: move", (p, ci) => { const wv = V3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0).multiplyScalar(mm); const lv = toLocalDir(ci, wv); deform(p, ci, () => lv); });
  function selLocalCentroid(ci) { const c = V3(); let n = 0; for (const k of ui.form.sel) { const nd = ci.nodes[k]; c.add(nd.base.clone().add(V3(ci.f.d[k * 3], ci.f.d[k * 3 + 1], ci.f.d[k * 3 + 2]))); n++; } return n ? c.divideScalar(n) : c; }
  const posOf = (ci, nd) => { const k = nd.j * ci.f.nu + nd.i; return nd.base.clone().add(V3(ci.f.d[k * 3], ci.f.d[k * 3 + 1], ci.f.d[k * 3 + 2])); };
  const scaleSel = (s) => formEdit("Form: scale", (p, ci) => { const c = selLocalCentroid(ci); deform(p, ci, (nd) => { const q = posOf(ci, nd); return q.clone().sub(c).multiplyScalar(s - 1); }); });
  const rotateSel = (deg) => formEdit("Form: rotate", (p, ci) => { const c = selLocalCentroid(ci), a = ui.form.rotAxis, ax = toLocalDir(ci, V3(a === "x" ? 1 : 0, a === "y" ? 1 : 0, a === "z" ? 1 : 0)).normalize(); deform(p, ci, (nd) => { const q = posOf(ci, nd); return q.clone().sub(c).applyAxisAngle(ax, rad(deg)).add(c).sub(q); }); });
  const flattenSel = () => formEdit("Form: flatten", (p, ci) => { const c = selLocalCentroid(ci), n = V3(); for (const k of ui.form.sel) n.add(ci.nodes[k].n); n.normalize(); deform(p, ci, (nd) => { const q = posOf(ci, nd); return n.clone().multiplyScalar(-q.clone().sub(c).dot(n)); }); });
  const smoothSel = () => formEdit("Form: smooth", (p, ci) => {
    const f = p.form, cl = ci.cl, set = ui.form.sel.size ? ui.form.sel : new Set(f.d.map((_, k) => k).filter((k) => k < f.nu * f.nv)), src = f.d.slice();
    for (const k of set) { const i = k % f.nu, j = Math.floor(k / f.nu); const nb = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].filter(([a, b]) => b >= 0 && b < f.nv && (cl || (a >= 0 && a < f.nu))).map(([a, b]) => b * f.nu + ((a + f.nu) % f.nu)); for (let c = 0; c < 3; c++) { const avg = nb.reduce((s2, q) => s2 + src[q * 3 + c], 0) / nb.length; f.d[k * 3 + c] = (src[k * 3 + c] + avg) / 2; } }
  });
  const resetSel = () => formEdit("Form: reset points", (p, ci) => { const f = p.form, sym = symOn(p); for (const k of ui.form.sel) { for (const q of sym ? [k, mirrorIdx(f, ci.cl, k)] : [k]) f.d.fill(0, q * 3, q * 3 + 3); } });
  function panelForm() {
    const p = selPart(), s = ui.side, fo = ui.form;
    if (!p) return needPart();
    s.append(H("Form " + p.name, "Like a form tool in CAD: drag the cage's control points to reshape the whole part smoothly. The outline, details and add-ons follow."));
    if (p.import) { s.append(el("p", { class: "cf-tip" }, "Imported parts keep their own shape here. Add them to your design to edit them in the other modes.")); return; }
    const f = ensureForm(p);
    s.append(el("p", { class: "cf-tip", id: "cf-form-info" }, ""));
    s.append(el("div", { class: "cf-sub" }, "Select"));
    s.append(el("div", { class: "cf-chips", id: "cf-form-mode" }, ...[["point", "Point", "Click single points"], ["edge", "Edge", "Click a cage edge: its two points"], ["face", "Face", "Click a cage face (on the part): its four corners"], ["row", "Row", "Click a point: the whole row across"], ["col", "Column", "Click a point: the whole column along"]].map(([id, n, tip]) => el("button", { class: "cf-chip", id: "cf-fm-" + id, title: tip, "aria-pressed": String(fo.mode === id), onclick: () => { fo.mode = id; showStep("form"); } }, n))));
    s.append(el("div", { class: "cf-btnrow" },
      el("button", { class: "btn", id: "cf-fm-all", onclick: () => { for (let k = 0; k < f.nu * f.nv; k++) fo.sel.add(k); drawCage(); } }, "Select all"),
      el("button", { class: "btn", id: "cf-fm-grow", title: "Add the points next to the selection", onclick: () => { const add = []; for (const k of fo.sel) { const i = k % f.nu, j = Math.floor(k / f.nu); for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) if (b >= 0 && b < f.nv && (formClosed(p) || (a >= 0 && a < f.nu))) add.push(b * f.nu + ((a + f.nu) % f.nu)); } add.forEach((k) => fo.sel.add(k)); drawCage(); } }, "Grow"),
      el("button", { class: "btn", id: "cf-fm-none", onclick: () => { fo.sel.clear(); drawCage(); } }, "Clear")));
    s.append(el("p", { class: "cf-tip" }, "Shift-click adds to the selection. Drag the arrows to move the points (yellow pushes and pulls along the surface), or the white ball to move them freely."));
    if (!(SLOTS[p.slot] && SLOTS[p.slot].sided)) s.append(el("label", { class: "cf-chk" }, el("input", { type: "checkbox", id: "cf-fm-sym", checked: fo.sym || null, onchange: (e) => { fo.sym = e.target.checked; drawCage(); } }), "Symmetry (left and right change together)"));
    else s.append(el("p", { class: "cf-tip" }, "This part comes as a pair: the other side follows automatically."));
    s.append(rng("Soft selection", fo.soft, 0, 4, 0.5, "pts", (v) => { fo.soft = v; }, "cf-fm-soft"));
    s.append(el("div", { class: "cf-sub" }, "Edit form"));
    s.append(rng("Step", fo.step, 0.5, 30, 0.5, "mm", (v) => { fo.step = v; }, "cf-fm-step"));
    const b = (id, label, title, fn) => el("button", { class: "btn", id, title, onclick: fn }, label);
    s.append(el("div", { class: "cf-btnrow" }, b("cf-fm-out", "Pull out", "Move the points outward, along the surface (↑ key)", () => nudgeNormal(fo.step)), b("cf-fm-in", "Push in", "Move the points inward (↓ key)", () => nudgeNormal(-fo.step))));
    s.append(el("div", { class: "cf-btnrow" }, ...["x", "y", "z"].flatMap((a) => [b("cf-fm-" + a + "m", a.toUpperCase() + " −", "Move along " + a.toUpperCase(), () => nudgeAxis(a, -fo.step)), b("cf-fm-" + a + "p", a.toUpperCase() + " +", "Move along " + a.toUpperCase(), () => nudgeAxis(a, fo.step))])));
    s.append(el("div", { class: "cf-btnrow" }, b("cf-fm-sdown", "Scale −", "Pull the points together", () => scaleSel(0.9)), b("cf-fm-sup", "Scale +", "Spread the points apart", () => scaleSel(1.1))));
    s.append(el("div", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Rotate about"), segBtns([["x", "X"], ["y", "Y"], ["z", "Z"]], fo.rotAxis, (v) => { fo.rotAxis = v; }, "cf-fm-rax"), b("cf-fm-rm", "↺ 10°", "Rotate the points", () => rotateSel(10)), b("cf-fm-rp", "↻ 10°", "Rotate the points", () => rotateSel(-10))));
    s.append(el("div", { class: "cf-btnrow" }, b("cf-fm-flat", "Flatten", "Line the points up on a flat plane", () => flattenSel()), b("cf-fm-smooth", "Make smooth", "Even out the points (all points when none are selected)", () => smoothSel()), b("cf-fm-reset", "Reset points", "Put the selected points back", () => resetSel())));
    s.append(el("div", { class: "cf-sub" }, "Cage"));
    s.append(el("div", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Surface"), segBtns([["smooth", "Smooth"], ["crease", "Creased"]], f.sharp ? "crease" : "smooth", (v) => formEdit("Form: crease", (q) => { q.form.sharp = v === "crease"; }), "cf-fm-sharp")));
    s.append(el("div", { class: "cf-row" }, el("span", { class: "cf-lbl" }, `Points ${f.nu} × ${f.nv}`),
      b("cf-fm-less", "Fewer", "A simpler cage (keeps the shape as far as it can)", () => { const cl = formClosed(p); formEdit("Form: density", (q) => resampleForm(q, Math.max(cl ? 6 : 3, f.nu - (cl ? 2 : 1)), Math.max(3, f.nv - 1))); showStep("form"); }),
      b("cf-fm-more", "More", "Add points for finer control", () => { const cl = formClosed(p); formEdit("Form: density", (q) => resampleForm(q, Math.min(cl ? 40 : 25, f.nu + (cl ? 2 : 1)), Math.min(20, f.nv + 1))); showStep("form"); }),
      b("cf-fm-sub", "Subdivide", "Double the points", () => { const cl = formClosed(p); formEdit("Form: density", (q) => resampleForm(q, Math.min(cl ? 40 : 25, cl ? f.nu * 2 : f.nu * 2 - 1), Math.min(20, f.nv * 2 - 1))); showStep("form"); })));
    s.append(el("label", { class: "cf-chk" }, el("input", { type: "checkbox", id: "cf-fm-show", checked: fo.show || null, onchange: (e) => { fo.show = e.target.checked; drawCage(); } }), "Show the cage"));
    s.append(el("div", { class: "cf-btnrow" }, b("cf-fm-resetall", "Reset all form edits", "Back to the template's form", () => { formEdit("Form: Reset all", (q) => { q.form.d.fill(0); }); })));
    drawCage();
  }
  // picking cage points
  function formPick(e, hitPart) {
    const ci = ui.cage, p = selPart();
    if (!ci || !p) return false;
    const fo = ui.form, f = ci.f, r = ui.canvas.getBoundingClientRect();
    const scr = (w) => { const v = w.clone().project(ui.camera); return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]; };
    const S2 = ci.nodes.map((nd) => scr(nd.world));
    const near = (pts) => { let bi = -1, bd = 14; pts.forEach((q, k) => { const d = Math.hypot(q[0] - e.clientX, q[1] - e.clientY); if (d < bd) { bd = d; bi = k; } }); return bi; };
    let picked = [];
    if (fo.mode === "point" || fo.mode === "row" || fo.mode === "col") {
      const k = near(S2);
      if (k >= 0) { const i = k % f.nu, j = Math.floor(k / f.nu); picked = fo.mode === "point" ? [k] : fo.mode === "row" ? [...Array(f.nu).keys()].map((a) => j * f.nu + a) : [...Array(f.nv).keys()].map((b2) => b2 * f.nu + i); }
    } else if (fo.mode === "edge") {
      let best = null, bd = 10;
      const seg = (a, b2) => { const A = S2[a], Bq = S2[b2], dx = Bq[0] - A[0], dy = Bq[1] - A[1], t = Math.max(0, Math.min(1, ((e.clientX - A[0]) * dx + (e.clientY - A[1]) * dy) / (dx * dx + dy * dy || 1))); const d = Math.hypot(A[0] + dx * t - e.clientX, A[1] + dy * t - e.clientY); if (d < bd) { bd = d; best = [a, b2]; } };
      for (let j = 0; j < f.nv; j++) for (let i = 0; i < f.nu; i++) { const k = j * f.nu + i; if (i < f.nu - 1 || ci.cl) seg(k, j * f.nu + ((i + 1) % f.nu)); if (j < f.nv - 1) seg(k, k + f.nu); }
      if (best) picked = best;
    } else if (fo.mode === "face" && hitPart && hitPart.object.userData.part === p.id) {
      let w = hitPart.point.clone().sub(hitPart.object.position);
      if (hitPart.object.userData.side === "R") w.x = -w.x;
      const uv = nearestUV(ci.g, w.applyMatrix4(ci.r.F.clone().invert()));
      if (uv) { const x = ci.cl ? uv[0] * f.nu : uv[0] * (f.nu - 1), y = uv[1] * (f.nv - 1); const i = Math.min(ci.cl ? f.nu - 1 : f.nu - 2, Math.floor(x)), j = Math.min(f.nv - 2, Math.floor(y)); picked = [j * f.nu + i, j * f.nu + ((i + 1) % f.nu), (j + 1) * f.nu + i, (j + 1) * f.nu + ((i + 1) % f.nu)]; }
    }
    if (!picked.length) return false;
    if (!e.shiftKey) fo.sel.clear();
    const allIn = picked.every((k) => fo.sel.has(k));
    for (const k of picked) { if (e.shiftKey && allIn) fo.sel.delete(k); else fo.sel.add(k); }
    drawCage();
    return true;
  }

  // --- 6 Cut & Join
  function panelCut() {
    const p = selPart(), s = ui.side, st = ui.st;
    s.append(H("Cut & Join", "Split parts into pieces that fit your printer. Joints are added on the inside, along each cut."));
    s.append(el("label", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Printer"), el("select", { class: "cf-sel", id: "cf-printer", onchange: (e) => { st.printer = e.target.value; showStep("cut"); refreshScene(); } }, ...PRINTERS.map((q) => el("option", { value: q.id, selected: st.printer === q.id || null }, q.name)))));
    const J = st.joint;
    const jointRows = () => [
      el("label", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Joint"), el("select", { class: "cf-sel", id: "cf-joint", onchange: (e) => { J.type = e.target.value; showStep("cut"); } }, ...JOINTS.map((j) => el("option", { value: j.id, selected: J.type === j.id || null }, j.name)))),
      J.type === "magnet" ? el("label", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Magnets"), el("select", { class: "cf-sel", id: "cf-magnet", onchange: (e) => { J.magnet = e.target.value; } }, ...Object.keys(MAGNETS).map((m) => el("option", { value: m, selected: J.magnet === m || null }, m.replace("x", " × ") + " mm discs")))) : null,
      J.type !== "none" ? rng("Joint size", J.size, 0.6, 2, 0.05, "×", (v) => { J.size = v; }, "cf-j-size") : null,
      J.type !== "none" ? rng("Joint spacing", J.spacing, 25, 200, 1, "mm", (v) => { J.spacing = v; }, "cf-j-spacing") : null,
      J.type !== "none" && J.type !== "magnet" ? rng("Clearance", J.clear, 0.1, 0.8, 0.05, "mm", (v) => { J.clear = v; }, "cf-j-clear") : null,
      J.type !== "none" ? el("label", { class: "cf-chk" }, el("input", { type: "checkbox", id: "cf-j-flip", checked: J.flip || null, onchange: (e) => { J.flip = e.target.checked; } }), "Swap which side gets the tab") : null,
    ];
    s.append(el("div", { class: "cf-sub" }, "Joints for new cuts"), ...jointRows().filter(Boolean));
    s.append(el("p", { class: "cf-tip" }, { none: "No joint: glue the pieces, or add your own.", peg: "A tab with a hole on one piece and a peg on the other. Press together, then glue.", snap: "A flexible clip that clicks into a loop. Can come apart again.", slide: "A dovetail tongue that slides into a socket from the outside. Locks sideways.", magnet: "Two cups that hold disc magnets, so pieces snap together and come apart." }[J.type]));
    if (!p) { needPart(); return; }
    s.append(el("div", { class: "cf-sub" }, "Cut " + p.name));
    const c = ui.cut;
    s.append(el("div", { class: "cf-chips", id: "cf-cut-axis" }, ...[["z", "Level"], ["x", "Side to side"], ["y", "Front to back"]].map(([a, n]) => el("button", { class: "cf-chip", id: "cf-cut-" + a, "aria-pressed": String(c.axis === a), title: { z: "A flat cut across (top and bottom pieces)", x: "A cut that splits left from right", y: "A cut that splits front from back" }[a], onclick: () => { c.axis = a; c.pos = null; showStep("cut"); } }, n))));
    const r = build(p, VIEW_RES[st.detail] || 4), box = new THREE.Box3();
    for (const pc of r.pieces) if (pc.side !== "R") box.union(bounds(pc.mesh));
    const n = cutNormal();
    const lo = Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => n.dot(V3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z))));
    const hi = Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => n.dot(V3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z))));
    if (c.pos === null || c.pos < lo || c.pos > hi) c.pos = Math.round((lo + hi) / 2);
    ui.cutRange = [lo, hi];
    s.append(rng("Position", c.pos, Math.floor(lo), Math.ceil(hi), 0.5, "mm", (v) => { c.pos = v; drawCutPlane(); }, "cf-cut-pos"));
    s.append(rng("Tilt", c.tiltA, -60, 60, 1, "°", (v) => { c.tiltA = v; drawCutPlane(); }, "cf-cut-tilta"));
    s.append(rng("Twist", c.tiltB, -60, 60, 1, "°", (v) => { c.tiltB = v; drawCutPlane(); }, "cf-cut-tiltb"));
    s.append(el("label", { class: "cf-chk", title: "Only cut the piece nearest the middle of the plane, not every piece it passes through" }, el("input", { type: "checkbox", id: "cf-cut-only", checked: c.only || null, onchange: (e) => { c.only = e.target.checked; } }), "Only the piece I click (or nearest)"));
    s.append(el("p", { class: "cf-tip" }, "Click on the part to move the cut there."));
    s.append(el("div", { class: "cf-btnrow" },
      el("button", { class: "btn primary", id: "cf-cut-go", onclick: () => doCut() }, "Cut"),
      el("button", { class: "btn", id: "cf-cut-auto", title: "Cut this part until every piece fits the printer", onclick: () => doAuto([p]) }, "Auto-cut to fit"),
      el("button", { class: "btn", id: "cf-cut-autoall", title: "Auto-cut every part in the outfit", onclick: () => doAuto(st.parts.filter((q) => !q.hidden)) }, "Auto-cut all")));
    if (p.cuts.length) {
      s.append(el("div", { class: "cf-sub" }, "Cuts on " + p.name));
      p.cuts.forEach((cc, i) => s.append(el("div", { class: "cf-cutrow" }, el("span", {}, `Cut ${i + 1}: ${cutLabel(cc)}`),
        el("select", { class: "cf-sel small", title: "Joint for this cut", onchange: (e) => change("Joint", () => { cc.joint = { ...(cc.joint || defaultJoint()), type: e.target.value }; }, { now: true }) }, ...JOINTS.map((j) => el("option", { value: j.id, selected: (cc.joint || {}).type === j.id || null }, j.name))),
        el("button", { class: "ibtn cf-x", title: "Remove this cut", onclick: () => { change("Remove cut", () => p.cuts.splice(i, 1), { now: true }); showStep("cut"); } }, "✕"))));
      s.append(el("button", { class: "btn", id: "cf-cut-clear", onclick: () => { change("Remove cuts", () => { p.cuts = []; }, { now: true }); showStep("cut"); } }, "Remove all cuts"));
    }
    s.append(el("div", { id: "cf-pieces" }));
    renderPieceList();
    drawCutPlane();
  }
  function cutLabel(cc) { const n = V3(...cc.n); const ax = Math.abs(n.z) > 0.9 ? "level" : Math.abs(n.x) > 0.9 ? "side to side" : Math.abs(n.y) > 0.9 ? "front to back" : "angled"; return ax + ((cc.joint && cc.joint.type !== "none") ? ", " + (JOINTS.find((j) => j.id === cc.joint.type) || {}).name.toLowerCase() : ", no joint"); }
  function cutNormal() {
    const c = ui.cut, n = c.axis === "x" ? V3(1, 0, 0) : c.axis === "y" ? V3(0, 1, 0) : V3(0, 0, 1);
    const a1 = c.axis === "z" ? V3(1, 0, 0) : V3(0, 0, 1), a2 = new THREE.Vector3().crossVectors(n, a1).normalize();
    n.applyAxisAngle(a2, rad(c.tiltA)).applyAxisAngle(a1, rad(c.tiltB));
    return n.normalize();
  }
  function drawCutPlane() {
    if (!ui || ui.step !== "cut") return;
    ui.helpers.clear();
    const p = selPart(); if (!p) return;
    const r = build(p, VIEW_RES[ui.st.detail] || 4), box = new THREE.Box3();
    for (const pc of r.pieces) if (pc.side !== "R") box.union(bounds(pc.mesh));
    const n = cutNormal(), c = box.getCenter(V3()), size = box.getSize(V3()).length() * 0.75 + 40;
    const at = c.clone().addScaledVector(n, (ui.cut.pos ?? n.dot(c)) - n.dot(c));
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    pl.position.copy(at); pl.quaternion.setFromUnitVectors(V3(0, 0, 1), n); pl.renderOrder = 5;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(pl.geometry), new THREE.LineBasicMaterial({ color: 0xff7a1a }));
    edge.position.copy(at); edge.quaternion.copy(pl.quaternion);
    ui.helpers.add(pl, edge);
    ui.dirty = true;
  }
  function doCut(seedPt) {
    const p = selPart(); if (!p) return;
    const res = VIEW_RES[ui.st.detail] || 4, r = build(p, res);
    const n = cutNormal(), d = ui.cut.pos;
    let seed = null;
    if (ui.cut.only) {
      if (seedPt || ui.cutSeed) seed = seedPt || ui.cutSeed;
      else { const box = new THREE.Box3(); for (const pc of r.pieces) if (pc.side !== "R") box.union(bounds(pc.mesh)); const c = box.getCenter(V3()); seed = c.addScaledVector(n, d - n.dot(c)); }
    }
    const loc = planeToLocal(n, d, seed, r.F);
    const before = r.pieces.length;
    change("Cut", () => { p.cuts.push({ ...loc, joint: { ...ui.st.joint } }); }, { now: true });
    const r2 = build(p, res);
    if (r2.pieces.length === before) { toast("That cut doesn't pass through " + p.name + ". Move it with Position.", "err"); ui.undo.pop(); p.cuts.pop(); refreshScene(); return; }
    toast(`Cut ${p.name}: ${r2.pieces.length} pieces${r2.joints.length ? `, ${r2.joints.length} joints` : ""}.`);
    showStep("cut");
  }
  function doAuto(list) {
    const bed = (PRINTERS.find((q) => q.id === ui.st.printer) || PRINTERS[0]).bed;
    setBusy("Working out the cuts…");
    setTimeout(() => {
      if (!ui) return;
      let added = 0, bad = 0;
      snapshot("Auto-cut");
      for (const p of list) {
        const r = build(p, VIEW_RES[ui.st.detail] || 4);
        const left = r.pieces.filter((pc) => pc.side !== "R" && !pc.lens).map((pc) => pc.mesh);
        const a = autoCuts(left, bed);
        for (const c of a.cuts) { p.cuts.push({ ...planeToLocal(c.n, c.d, c.seed, r.F), joint: { ...ui.st.joint } }); added++; }
        if (!a.fits) bad++;
      }
      setBusy(null);
      if (!added) { ui.undo.pop(); toast(bad ? "Some pieces still don't fit, even cut. Try a bigger printer or a smaller part." : "Every piece already fits your printer."); return; }
      toast(`Added ${added} cut${added === 1 ? "" : "s"}${bad ? ". Some pieces still don't fit." : ". Every piece now fits."}`);
      refreshScene({ done: () => showStep("cut") });
    }, 30);
  }
  function renderPieceList() {
    const box = ui.side.querySelector("#cf-pieces");
    if (!box) return;
    box.textContent = "";
    const p = selPart(); if (!p) return;
    const bed = (PRINTERS.find((q) => q.id === ui.st.printer) || PRINTERS[0]).bed;
    const r = build(p, VIEW_RES[ui.st.detail] || 4);
    const rows = r.pieces.filter((pc) => pc.side !== "R").map((pc) => { const f = fitBed(pc.mesh, bed); return el("div", { class: "cf-piece " + (f.fits ? "good" : "bad") }, el("span", {}, pc.name.replace(" (left)", "")), el("small", {}, f.ext.map((v) => Math.round(v)).join(" × ") + " mm"), el("b", {}, f.fits ? "✓ fits" : "✗ too big")); });
    box.append(el("div", { class: "cf-sub" }, `Pieces (${r.pieces.length}${SLOTS[p.slot] && SLOTS[p.slot].sided && p.side === "both" ? ", counting both sides" : ""})`), ...rows);
  }

  // --- 7 Export
  function panelExport() {
    const st = ui.st, s = ui.side;
    s.append(H("Export", "Save the pieces for your slicer, or add them to your JumpStart 3D design to keep editing in the other modes."));
    s.append(el("div", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "What"), segBtns([["sel", "Selected part"], ["all", "Whole outfit"]], st.exportWhat, (v) => { st.exportWhat = v; }, "cf-x-what")));
    s.append(el("div", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Format"), segBtns([["stl", "STL"], ["3mf", "3MF"], ["obj", "OBJ"]], st.exportFmt, (v) => { st.exportFmt = v; }, "cf-x-fmt")));
    s.append(el("div", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Lay out"), segBtns([["worn", "As worn"], ["bed", "Ready to print"]], st.orient, (v) => { st.orient = v; }, "cf-x-orient")));
    s.append(el("div", { class: "cf-row" }, el("span", { class: "cf-lbl" }, "Detail"), segBtns([["normal", "Normal"], ["fine", "Fine"]], st.exportDetail, (v) => { st.exportDetail = v; }, "cf-x-detail")));
    s.append(el("label", { class: "cf-chk" }, el("input", { type: "checkbox", id: "cf-x-body", checked: st.withBody || null, onchange: (e) => { st.withBody = e.target.checked; } }), "Include the body (mannequin)"));
    s.append(el("p", { class: "cf-tip" }, "STL saves one file per piece (in a .zip when there are several). 3MF keeps the colours and puts every piece in one file. Ready to print lays each piece down so it fits your printer."));
    s.append(el("div", { class: "cf-btnrow" },
      el("button", { class: "btn primary", id: "cf-x-go", onclick: () => doExport() }, "Export"),
      el("button", { class: "btn", id: "cf-x-design", title: "Add the pieces to your JumpStart 3D design as objects you can edit in Beginner, Advanced or Chisel mode", onclick: () => addToDesign() }, "Add to my design")));
    s.append(el("div", { class: "cf-sub" }, "Costume file"));
    const file = el("input", { type: "file", accept: ".json,.cosforge", id: "cf-open-file", style: { display: "none" }, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { const st2 = deserialize(await f.text()); snapshot("Open costume"); ui.st = st2; ui.sel = null; rebuildBody(); renderOutfit(); showStep("parts"); refreshScene(); toast("Opened " + f.name); } catch (err) { toast("That isn't a CosForge costume file.", "err"); } e.target.value = ""; } });
    s.append(file, el("div", { class: "cf-btnrow" },
      el("button", { class: "btn", id: "cf-save-file", title: "Save the whole costume (body, parts, sculpting, cuts) to open later or share", onclick: () => saveCostume() }, "Save costume file"),
      el("button", { class: "btn", id: "cf-open", onclick: () => file.click() }, "Open costume file…")));
    s.append(el("p", { class: "cf-tip" }, "The costume is also kept with this design, so it's here next time you open CosForge."));
  }
  function exportPieces(res) {
    const st = ui.st, list = st.exportWhat === "sel" && selPart() ? [selPart()] : st.parts.filter((p) => !p.hidden);
    const out = [];
    for (const p of list) { const r = build(p, res); for (const pc of r.pieces) out.push({ ...pc, color: pc.lens ? p.accent || p.color : p.color, accent: p.accent || p.color, part: p }); }
    return out;
  }
  function bodySolid() {
    const g = bodyGroup(ui.B, ui.bodyMat), list = [];
    g.updateMatrixWorld(true);
    g.traverse((o) => { if (!o.isMesh) return; const geo = o.geometry.index ? o.geometry : o.geometry; const P = geo.attributes.position.array, I = geo.index ? geo.index.array : [...Array(P.length / 3).keys()]; const M = o.matrixWorld, pos = new Float32Array(P.length), p = V3(); for (let i = 0; i < P.length; i += 3) { p.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); pos[i] = p.x; pos[i + 1] = p.y; pos[i + 2] = p.z; } list.push({ pos, idx: new Uint32Array(I), tl: new Float32Array(I.length / 3) }); o.geometry.dispose(); });
    return merge(list);
  }
  const soup = (m) => { const I = m.idx, P = m.pos, out = new Float32Array(I.length * 3); for (let k = 0; k < I.length; k++) { out[k * 3] = P[I[k] * 3]; out[k * 3 + 1] = P[I[k] * 3 + 1]; out[k * 3 + 2] = P[I[k] * 3 + 2]; } return out; };
  // lay pieces out: stand each on the bed (optionally turned to fit), side by side
  function layout(pieces, orient) {
    const bed = (PRINTERS.find((q) => q.id === ui.st.printer) || PRINTERS[0]).bed;
    let x = 0, y = 0, rowH = 0;
    const rowW = Math.max(bed[0] * 2.2, 700);
    return pieces.map((pc) => {
      let m = pc.mesh;
      if (orient === "bed") { const f = fitBed(m, bed); m = transformSolid(m, f.R); }
      const b = bounds(m), sz = b.getSize(V3());
      if (x > 0 && x + sz.x > rowW) { x = 0; y += rowH + 15; rowH = 0; }
      const T = new THREE.Matrix4().makeTranslation(x - b.min.x, y - b.min.y, -b.min.z);
      x += sz.x + 15; rowH = Math.max(rowH, sz.y);
      return { ...pc, mesh: transformSolid(m, T) };
    });
  }
  const fileName = (t) => t.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() || "piece";
  function doExport() {
    const st = ui.st;
    if (!st.parts.length) { toast("Add a part first.", "err"); return; }
    setBusy("Making the files…");
    setTimeout(async () => {
      try {
        const res = EXPORT_RES[st.exportDetail] || 3;
        let pieces = exportPieces(res);
        if (st.withBody) pieces.push({ name: "Body", mesh: bodySolid(), color: "#c9bfb4", accent: "#c9bfb4" });
        if (!pieces.length) { toast("Nothing to export.", "err"); return; }
        const title = st.exportWhat === "sel" && selPart() ? selPart().name : "Costume";
        const parts = (list) => list.map((pc) => ({ name: pc.name, color: pc.color, pos: soup(pc.mesh), tcol: tagColors(pc) }));
        let bytes, name;
        if (st.exportFmt === "stl") {
          if (pieces.length === 1) { const [pc] = layout(pieces, st.orient); bytes = stlFile(parts([pc]), 1, [0, 0, 0]); name = fileName(pc.name) + ".stl"; }
          else {
            const files = [];
            const used = new Set();
            for (const pc of pieces) { const [q] = layout([pc], st.orient); let n = fileName(q.name); while (used.has(n)) n += "_"; used.add(n); files.push({ name: n + ".stl", data: stlFile(parts([q]), 1, [0, 0, 0]) }); }
            bytes = new Uint8Array(await makeZip(files).arrayBuffer()); name = fileName(title) + " (" + pieces.length + " STL files).zip";
          }
        } else if (st.exportFmt === "3mf") { bytes = await threeMFFile(parts(layout(pieces, st.orient)), 1, [0, 0, 0], title); name = fileName(title) + ".3mf"; }
        else { bytes = objFile(parts(layout(pieces, st.orient)), 1, [0, 0, 0], title); name = fileName(title) + ".obj"; }
        ui.lastExport = { fmt: st.exportFmt, pieces: pieces.length, size: bytes.length, name };
        if (app.projects && app.projects.saveModel) await app.projects.saveModel(name, bytes);
        app.onExport && app.onExport(st.exportFmt);
        toast(`Saved ${pieces.length} piece${pieces.length === 1 ? "" : "s"} as ${name}.`);
      } catch (e) { console.error(e); toast("Couldn't export: " + (e.message || e), "err"); }
      finally { setBusy(null); }
    }, 30);
  }
  // per-triangle colours for 3MF/OBJ: accents (gems, lens) and joints keep their own colour
  function tagColors(pc) {
    const tl = pc.mesh.tl, out = new Array(tl.length);
    let any = false;
    for (let t = 0; t < tl.length; t++) { if (tl[t] === TL.ACCENT) { out[t] = pc.accent; any = true; } else out[t] = pc.color; }
    return any ? out : null;
  }
  function addToDesign() {
    const st = ui.st;
    if (!st.parts.length) { toast("Add a part first.", "err"); return; }
    setBusy("Adding to your design…");
    setTimeout(() => {
      try {
        const res = EXPORT_RES.normal;
        const pieces = exportPieces(res);
        if (st.withBody) pieces.push({ name: "Body", mesh: bodySolid(), color: "#c9bfb4" });
        const ids = [];
        let simplified = 0;
        store.update((doc) => {
          doc.assets = doc.assets || {};
          for (const pc of pieces) {
            let mesh = { V: pc.mesh.pos, I: pc.mesh.idx };
            if (mesh.I.length / 3 > MESH_LIMIT) { const s2 = simplify(mesh, MESH_LIMIT); if (s2 && s2.mesh) { mesh = s2.mesh; simplified++; } }
            const bytes = packMesh(mesh), id = contentId(bytes);
            if (!doc.assets[id]) doc.assets[id] = { kind: "mesh", name: pc.name, data: toB64(bytes) };
            const b = { id: uid("b"), name: nextName(doc, pc.name), seq: nextSeq(doc), color: pc.color, hole: false, hidden: false, m: IDENTITY.slice(), node: { t: "mesh", asset: id, keepPos: true, mods: [] }, cosforge: true };
            doc.bodies.push(b); ids.push(b.id);
          }
          doc.cosforge = serialize(st);
        }, "Add CosForge pieces");
        ui.savedJson = serialize(st);
        setBusy(null);
        close();
        app.select && app.select(ids);
        // show them once the design has built them
        const t0 = Date.now();
        const iv = setInterval(() => {
          const ready = ids.every((id) => (app.scene.views.get(id) || {}).data || app.scene.errors.has(id));
          if (ready || Date.now() - t0 > 90000) { clearInterval(iv); app.fit && app.fit(); }
        }, 400);
        toast(`Added ${ids.length} piece${ids.length === 1 ? "" : "s"} to your design${simplified ? " (big pieces were simplified for editing; Export keeps full detail)" : ""}.`);
      } catch (e) { console.error(e); setBusy(null); toast("Couldn't add to the design: " + (e.message || e), "err"); }
    }, 30);
  }
  async function saveCostume() {
    const bytes = new TextEncoder().encode(serialize(ui.st));
    if (app.projects && app.projects.saveModel) await app.projects.saveModel("Costume.cosforge.json", bytes);
  }

  // ----------------------------------------------------------------------------- outfit list
  function renderOutfit() {
    if (!ui) return;
    const o = ui.outfit, st = ui.st;
    o.textContent = "";
    o.append(el("div", { class: "cf-h" }, el("h3", {}, "Outfit"), el("p", {}, st.parts.length ? "Click a part to select it." : "No parts yet.")));
    for (const p of st.parts) {
      const r = pieceCache.get(genKey(p, VIEW_RES[st.detail] || 4) + JSON.stringify([p.fit, p.cuts, p.side]));
      const n = r ? r.pieces.length : "…";
      o.append(el("div", { class: "cf-item" + (p.id === ui.sel ? " on" : "") + (p.hidden ? " off" : ""), id: "cf-item-" + p.id },
        el("span", { class: "cf-dot", style: { background: p.color } }),
        el("button", { class: "cf-item-name", onclick: () => select(p.id), title: "Select " + p.name }, p.name, el("small", {}, (p.side === "both" ? "pair · " : p.side === "L" ? "left · " : p.side === "R" ? "right · " : "") + n + " piece" + (n === 1 ? "" : "s"))),
        el("button", { class: "ibtn cf-x", title: p.hidden ? "Show" : "Hide", onclick: () => { p.hidden = !p.hidden; refreshScene(); } }, p.hidden ? "○" : "●"),
        el("button", { class: "ibtn cf-x", title: "Duplicate", onclick: () => { const q = deserialize(serialize({ ...blank(), parts: [p] })).parts[0]; q.id = uid("cp"); q.name = p.name + " copy"; change("Duplicate", () => st.parts.push(q), { now: true }); ui.sel = q.id; } }, "⧉"),
        el("button", { class: "ibtn cf-x", title: "Remove", onclick: () => removePart(p.id) }, "✕")));
    }
    if (ui.totals) o.append(el("p", { class: "cf-tip", id: "cf-totals" }, `${ui.totals.pieces} pieces · about ${Math.round(ui.totals.grams)} g of PLA (${(ui.totals.grams / 1000).toFixed(2)} kg)`));
  }
  function removePart(id) {
    const p = ui.st.parts.find((q) => q.id === id); if (!p) return;
    change("Remove " + p.name, () => { ui.st.parts = ui.st.parts.filter((q) => q.id !== id); }, { now: true });
    if (ui.sel === id) ui.sel = null;
    renderOutfit(); showStep(ui.step);
  }

  // ----------------------------------------------------------------------------- pointer: pick, sculpt, place cuts
  function setupPointer() {
    const cv = ui.canvas, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = null, stroke = null;
    const hit = (e) => {
      const r = cv.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, ui.camera);
      const h = ray.intersectObjects(ui.meshes, false)[0];
      return h || null;
    };
    let gdrag = null;
    const gizmoHit = (e) => { const g = ui.helpers.getObjectByName("gizmo"); if (!g) return null; const r = cv.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, ui.camera); const hs = ray.intersectObjects(g.children, false); const h = hs.find((q) => q.object.userData.gizmo === "free") || hs[0]; return h ? { h, g } : null; };
    // along an arrow: closest point to the mouse ray; an arrow pointing at the viewer moves with the mouse's up/down
    const pxSize = (C) => (ui.camera.position.distanceTo(C) * Math.tan(rad(ui.camera.fov / 2)) * 2) / (cv.clientHeight || 1);
    const axisParam = (e, C, A) => {
      const r0 = cv.getBoundingClientRect(), a = C.clone().project(ui.camera), b2 = C.clone().add(A.clone().multiplyScalar(pxSize(C) * 100)).project(ui.camera);
      const sx = (b2.x - a.x) * r0.width / 2, sy = -(b2.y - a.y) * r0.height / 2, sl = Math.hypot(sx, sy);
      if (sl < 25) return -(e.clientY - r0.top) * pxSize(C);
      // the mouse position along the arrow's direction on screen, in mm
      const mx = e.clientX - (r0.left + (a.x + 1) / 2 * r0.width), my = e.clientY - (r0.top + (1 - a.y) / 2 * r0.height);
      return ((mx * sx + my * sy) / sl) * (100 / sl) * pxSize(C);
    };
    const axisParamOld = (e, C, A) => { const r = cv.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, ui.camera); const o = ray.ray.origin, d = ray.ray.direction, w0 = C.clone().sub(o), b = A.dot(d), d1 = A.dot(w0), e1 = d.dot(w0), den = 1 - b * b; return den < 1e-6 ? 0 : (b * e1 - d1) / den; };
    const planeHit = (e, C) => { const r = cv.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, ui.camera); const n = ui.camera.getWorldDirection(V3()); const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, C); return ray.ray.intersectPlane(pl, V3()); };
    cv.addEventListener("pointerdown", (e) => {
      if (!ui) return;
      down = { x: e.clientX, y: e.clientY };
      if (ui.step === "form" && e.button === 0 && ui.form.sel.size) {
        const gh = gizmoHit(e), p = selPart();
        if (gh && p) {
          const ax = gh.h.object.userData.gizmo, C = gh.g.position.clone();
          snapshot("Form: drag");
          gdrag = { p, ax, C, A: ax === "free" ? null : gh.h.object.userData.dir.clone(), t0: ax === "free" ? 0 : axisParam(e, C, gh.h.object.userData.dir), last: ax === "free" ? planeHit(e, C) : null, applied: 0 };
          ui.controls.enabled = false;
          cv.setPointerCapture(e.pointerId);
          e.stopImmediatePropagation();
          return;
        }
      }
      if (ui.step === "sculpt" && e.button === 0 && !e.shiftKey) {
        const h = hit(e), p = selPart();
        if (h && p && !p.import && h.object.userData.part === p.id) {
          ui.controls.enabled = false;
          snapshot("Sculpt");
          stroke = { p, last: null };
          dab(p, h);
          cv.setPointerCapture(e.pointerId);
          e.stopImmediatePropagation();
        }
      }
    }, true);
    cv.addEventListener("pointermove", (e) => {
      if (!ui) return;
      if (gdrag) {
        const ci = ui.cage; if (!ci) return;
        let wv;
        if (gdrag.A) { const t = axisParam(e, gdrag.C, gdrag.A) - gdrag.t0; wv = gdrag.A.clone().multiplyScalar(t - gdrag.applied); gdrag.applied = t; }
        else { const q = planeHit(e, gdrag.C); if (!q || !gdrag.last) return; wv = q.clone().sub(gdrag.last); gdrag.last = q; }
        if (wv.lengthSq() < 1e-8) return;
        const p = gdrag.p;
        if (gdrag.ax === "n") { const mm = wv.dot(gdrag.A); deform(p, ci, (nd) => nd.n.clone().multiplyScalar(mm)); }
        else { const lv = toLocalDir(ci, wv); deform(p, ci, () => lv); }
        burst = { label: "Form: drag", t: Date.now() };
        if (!ui.dragT) ui.dragT = requestAnimationFrame(() => { ui.dragT = 0; if (!ui) return; try { drawPartOnly(p, Math.max(FRES(), 6)); } catch (err) { /* skip */ } });
        e.stopImmediatePropagation();
        return;
      }
      if (!stroke) return;
      const h = hit(e);
      if (h && h.object.userData.part === stroke.p.id) dab(stroke.p, h);
      e.stopImmediatePropagation();
    }, true);
    const up = (e) => {
      if (!ui) return;
      if (stroke) { stroke = null; ui.controls.enabled = true; refreshScene(); return; }
      if (gdrag) { gdrag = null; ui.controls.enabled = true; down = null; refreshScene(); return; }
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const h = hit(e);
      if (ui.step === "form" && selPart()) {
        if (formPick(e, h)) return;
        if (h && h.object.userData.part !== ui.sel) { select(h.object.userData.part); return; }
        if (!e.shiftKey && ui.form.sel.size) { ui.form.sel.clear(); drawCage(); }
        return;
      }
      if (ui.step === "cut" && h && selPart() && h.object.userData.part === ui.sel) {
        const pt = h.point.clone().sub(h.object.position);
        if (h.object.userData.side === "R") pt.x = -pt.x;
        ui.cut.pos = Math.round(cutNormal().dot(pt) * 2) / 2;
        const inp = ui.side.querySelector("#cf-cut-pos"); if (inp) { inp.value = ui.cut.pos; const nb = inp.parentElement.querySelector("input[type=number]"); if (nb) nb.value = ui.cut.pos; }
        ui.cutSeed = pt;
        drawCutPlane();
        return;
      }
      if (h) select(h.object.userData.part);
      else if (ui.step !== "sculpt" && ui.step !== "cut") select(null);
    };
    cv.addEventListener("pointerup", up, true);
  }
  // one dab of the sculpting brush
  function dab(p, h) {
    const r = pieceCache.get(genKey(p, VIEW_RES[ui.st.detail] || 4) + JSON.stringify([p.fit, p.cuts, p.side])) || build(p, VIEW_RES[ui.st.detail] || 4);
    const g = r.g, desc = g.desc;
    if (!desc) return;
    let w = h.point.clone().sub(h.object.position);
    if (h.object.userData.side === "R") w.x = -w.x;
    const local = w.applyMatrix4(r.F.clone().invert());
    const uv = nearestUV(g, local);
    if (!uv) return;
    const [W, Hh] = SCULPT_RES;
    if (!g.mapXY) { g.mapXY = new Float32Array(W * Hh * 2); for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) { const [x, y] = desc.xy(i / (desc.closedU ? W : W - 1), j / (Hh - 1)); g.mapXY[(j * W + i) * 2] = x; g.mapXY[(j * W + i) * 2 + 1] = y; } }
    const [xc, yc] = desc.xy(uv[0], uv[1]);
    const sc = ui.sculpt, R = sc.radius, kind = sc.tool;
    const key = kind === "emboss" || kind === "engrave" ? "emboss" : "bulge";
    const maps = kind === "smooth" || kind === "erase" ? ["bulge", "emboss"] : [key];
    for (const mk of maps) if (!p.sculpt[mk]) p.sculpt[mk] = new Float32Array(W * Hh);
    const mirror = sc.mirror && !(SLOTS[p.slot] && SLOTS[p.slot].sided);
    const wrap = desc.closedU ? Math.abs(desc.xy(1e-6, uv[1])[0]) * 2 : 0;
    const sign = kind === "dent" || kind === "engrave" ? -1 : 1, amt = 1.2 * sc.strength;
    for (const mk of maps) {
      const M = p.sculpt[mk], src = kind === "smooth" ? M.slice() : null;
      for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
        const k = j * W + i, x = g.mapXY[k * 2], y = g.mapXY[k * 2 + 1];
        let dx = Math.abs(x - xc); if (wrap) dx = Math.min(dx, wrap - dx);
        let d = Math.hypot(dx, y - yc);
        if (mirror) { let dx2 = Math.abs(x + xc); if (wrap) dx2 = Math.min(dx2, wrap - dx2); d = Math.min(d, Math.hypot(dx2, y - yc)); }
        if (d >= R) continue;
        const f = (1 - (d / R) ** 2) ** 2;
        if (kind === "smooth") { let s = 0, c = 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { let ii = i + a; const jj = j + b; if (desc.closedU) ii = (ii + W) % W; if (ii < 0 || jj < 0 || ii >= W || jj >= Hh) continue; s += src[jj * W + ii]; c++; } M[k] += ((s / c) - M[k]) * f * 0.6; }
        else if (kind === "erase") M[k] *= 1 - f * 0.4;
        else M[k] = Math.max(mk === "emboss" ? -((p.deco.thick ?? 2.5) - 0.8) : -40, Math.min(mk === "emboss" ? 15 : 60, M[k] + sign * amt * f));
      }
    }
    p._sv = (p._sv || 0) + 1;
    // a quick, rough rebuild while dragging; the full one when the stroke ends
    if (!ui.dabT) ui.dabT = requestAnimationFrame(() => { ui.dabT = 0; if (!ui) return; try { drawPartOnly(p, Math.max(VIEW_RES[ui.st.detail] || 4, 5)); } catch (e) { /* ignore */ } });
  }
  function nearestUV(g, local) {
    const m = g.shellRender; if (!m) return null;
    if (!g.uvHash) {
      const cell = 8, hsh = new Map(), P = m.pos;
      for (let t = 0; t < m.idx.length / 3; t++) {
        if (m.tl[t] !== TL.OUT) continue;
        for (let e = 0; e < 3; e++) { const v = m.idx[t * 3 + e], key = Math.floor(P[v * 3] / cell) + "," + Math.floor(P[v * 3 + 1] / cell) + "," + Math.floor(P[v * 3 + 2] / cell); let l = hsh.get(key); if (!l) hsh.set(key, (l = [])); l.push(v); }
      }
      g.uvHash = { cell, hsh };
    }
    const { cell, hsh } = g.uvHash, P = m.pos;
    const cx = Math.floor(local.x / cell), cy = Math.floor(local.y / cell), cz = Math.floor(local.z / cell);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 3 && best < 0; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      const l = hsh.get(cx + a + "," + (cy + b) + "," + (cz + c)); if (!l) continue;
      for (const v of l) { const d = (P[v * 3] - local.x) ** 2 + (P[v * 3 + 1] - local.y) ** 2 + (P[v * 3 + 2] - local.z) ** 2; if (d < bd) { bd = d; best = v; } }
    }
    return best >= 0 ? [m.uv[best * 2], m.uv[best * 2 + 1]] : null;
  }

  // ----------------------------------------------------------------------------- small controls
  function segBtns(opts, val, on, id) {
    const w = el("div", { class: "cf-seg", id, role: "group" });
    for (const [v, l] of opts) w.append(el("button", { "data-v": v, "aria-pressed": String(v === val), onclick: () => { w.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v))); on(v); } }, l));
    return w;
  }
  function rng(label, val, min, max, step, unit, on, id) {
    const r = el("input", { type: "range", min, max, step, value: val, id, "aria-label": label });
    const n = el("input", { type: "number", class: "num cf-num", min, max, step, value: Math.round(val * 1000) / 1000, "aria-label": label + " value" });
    r.oninput = () => { n.value = r.value; on(parseFloat(r.value)); };
    n.onchange = () => { const v = parseFloat(n.value); if (!isFinite(v)) return; r.value = v; on(v); };
    return el("label", { class: "cf-rng" }, el("span", { class: "cf-lbl" }, label), r, n, el("span", { class: "cf-unit" }, unit || ""));
  }
  function ctrl(c, val, on, id) {
    const [, label, type] = c;
    if (type === "rng") return rng(label, val ?? c[3], c[3], c[4], c[5], c[6], on, id);
    if (type === "chk") return el("label", { class: "cf-chk" }, el("input", { type: "checkbox", id, checked: val ? true : null, onchange: (e) => on(e.target.checked ? (typeof val === "number" || c[0] === "wings" || c[0] === "fan" ? 1 : true) : (c[0] === "wings" || c[0] === "fan" ? 0 : false)) }), label);
    if (type === "sel") return el("label", { class: "cf-row" }, el("span", { class: "cf-lbl" }, label), el("select", { class: "cf-sel", id, onchange: (e) => on(e.target.value) }, ...c[3].map(([v, l]) => el("option", { value: v, selected: v === val || null }, l))));
    return null;
  }

  // ----------------------------------------------------------------------------- orbit (Z up)
  function makeOrbit(camera, dom) {
    const o = { target: V3(), enabled: true, onChange: null };
    const sph = new THREE.Spherical();
    let drag = null, pend = { th: 0, ph: 0, zoom: 1, pan: V3() };
    const pointers = new Map();
    o.update = () => {
      if (!pend.th && !pend.ph && pend.zoom === 1 && !pend.pan.lengthSq()) return false;
      const off = camera.position.clone().sub(o.target);
      // Z-up spherical: theta around Z, phi from Z
      const r = off.length(), th = Math.atan2(off.y, off.x), ph = Math.acos(Math.max(-1, Math.min(1, off.z / (r || 1))));
      const nth = th + pend.th, nph = Math.max(0.02, Math.min(Math.PI - 0.02, ph + pend.ph)), nr = Math.max(40, Math.min(30000, r * pend.zoom));
      o.target.add(pend.pan);
      camera.position.set(o.target.x + nr * Math.sin(nph) * Math.cos(nth), o.target.y + nr * Math.sin(nph) * Math.sin(nth), o.target.z + nr * Math.cos(nph));
      camera.lookAt(o.target);
      pend = { th: 0, ph: 0, zoom: 1, pan: V3() };
      return true;
    };
    void sph;
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    dom.addEventListener("pointerdown", (e) => {
      if (!o.enabled) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      drag = { mode: pointers.size > 1 || e.button === 2 || e.button === 1 || e.shiftKey ? "pan" : "rot", x: e.clientX, y: e.clientY, dist: pointers.size > 1 ? pinch() : 0 };
      dom.setPointerCapture(e.pointerId);
    });
    const pinch = () => { const v = [...pointers.values()]; return v.length > 1 ? Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]) : 0; };
    dom.addEventListener("pointermove", (e) => {
      if (!drag || !o.enabled || !pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      const h = dom.clientHeight || 1;
      if (pointers.size > 1) { const d = pinch(); if (drag.dist && d) pend.zoom *= drag.dist / d; drag.dist = d; }
      if (drag.mode === "rot" && pointers.size === 1) { pend.th -= (2 * Math.PI * dx) / h; pend.ph -= (Math.PI * dy) / h; }
      else {
        const dist = camera.position.distanceTo(o.target) * Math.tan(rad(camera.fov / 2)) * 2 / h;
        const X = V3().setFromMatrixColumn(camera.matrix, 0), Y = V3().setFromMatrixColumn(camera.matrix, 1);
        pend.pan.addScaledVector(X, -dx * dist).addScaledVector(Y, dy * dist);
      }
      o.onChange && o.onChange();
    });
    const end = (e) => { pointers.delete(e.pointerId); if (!pointers.size) drag = null; };
    dom.addEventListener("pointerup", end); dom.addEventListener("pointercancel", end);
    dom.addEventListener("wheel", (e) => { e.preventDefault(); pend.zoom *= Math.pow(1.0015, e.deltaY); o.onChange && o.onChange(); }, { passive: false });
    return o;
  }

  return {
    open, close, get isOpen() { return !!ui; },
    // for tests
    _t: () => ui && { st: ui.st, B: ui.B, sel: ui.sel, build: (p, res) => build(p, res || VIEW_RES[ui.st.detail]), addPart: (id) => addPart(tplById(id)), addSet, select, showStep, doCut, doAuto, setCut: (o) => Object.assign(ui.cut, o), refresh: (o) => refreshScene(o), meshes: ui.meshes, totals: ui.totals, lastExport: ui.lastExport, doExport, addToDesign, undo, redo, change, cutNormal, camera: ui.camera, controls: ui.controls, sculpt: ui.sculpt, busy: () => !ui.busy.hidden, ready: () => !timer_pending() && ui.busy.hidden && ui.st.parts.filter((p) => !p.hidden).every((p) => pieceCache.has(genKey(p, VIEW_RES[ui.st.detail] || 4) + JSON.stringify([p.fit, p.cuts, p.side]))), serialize: () => serialize(ui.st), form: ui.form, cage: () => ui.cage, formPickAt: (k) => { ui.form.sel.add(k); drawCage(); }, nudgeNormal, nudgeAxis, scaleSel, rotateSel, flattenSel, smoothSel, resetSel },
  };
}
