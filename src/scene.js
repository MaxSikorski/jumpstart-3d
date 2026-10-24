// Keeps three.js objects in sync with the document and kernel results.
import * as THREE from "three";
import { theme } from "./theme.js";
import { thickLines } from "./thickline.js";
import { fromB64 } from "./meshimport.js";
import { resolveNode, bodyKey, regionsFor, sketchTexts } from "./store.js";
import { textContours } from "./textgeo.js";
import { resolveSketch, sampleCurve } from "./regions.js";
import { applyTextures, matchTextureFaces } from "./texture.js";
import { lookOf } from "./appearance.js";

// textured meshes are expensive to make: keep the last few
const texCache = new Map();
export function texturedMesh(key, mesh, textures) {
  const k = key + "|" + JSON.stringify(textures);
  let out = texCache.get(k);
  if (out) { texCache.delete(k); texCache.set(k, out); return out; }
  try { out = applyTextures(mesh, textures); }
  catch (e) { console.warn("texture failed", e); out = mesh; }
  texCache.set(k, out);
  while (texCache.size > 8) texCache.delete(texCache.keys().next().value);
  return out;
}
export const textureSig = (b) => (!b.hole && b.textures && b.textures.length ? JSON.stringify(b.textures) : "");

const ACCENT = new THREE.Color("#1f4fa8");
const HOVER = new THREE.Color("#e8a317");
const SEL_BLUE = new THREE.Color("#2f6fe8"), SEL_TOOL = new THREE.Color("#f08a24");

// fill geometry for a profile (text profiles carry their own letter shapes)
export function regionGeometry(r) {
  const V = (p) => new THREE.Vector2(p[0], p[1]);
  const mk = (outer, holes) => {
    const s = new THREE.Shape(outer.map(V));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(V)));
    return s;
  };
  const shapes = r.shapes ? r.shapes.map((s) => mk(s.outer, s.holes)) : [mk(r.poly, r.holePolys)];
  return new THREE.ShapeGeometry(shapes);
}
// closed outline polylines of every text in a sketch
export function textOutlines(sk) {
  const out = [];
  for (const t of sketchTexts(sk)) for (const c of textContours(t.spec)) out.push({ id: t.id, pts: [...c, c[0]] });
  return out;
}

// a sketch's reference picture, as a see-through plane in sketch coordinates
const imgTex = new Map();
export function sketchImageMesh(im, onLoad) {
  let tex = imgTex.get(im.src);
  if (!tex) {
    tex = new THREE.TextureLoader().load(im.src, () => onLoad && onLoad());
    tex.colorSpace = THREE.SRGBColorSpace;
    imgTex.set(im.src, tex);
    if (imgTex.size > 12) imgTex.delete(imgTex.keys().next().value);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(im.w, im.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: im.opacity ?? 0.6, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2 }));
  m.position.set(im.cx || 0, im.cy || 0, 0);
  m.rotation.z = ((im.rot || 0) * Math.PI) / 180;
  m.renderOrder = 1;
  m.userData.sketchImage = true;
  return m;
}

export function planeMatrix(pl) {
  const o = new THREE.Vector3(...pl.o), x = new THREE.Vector3(...pl.x).normalize(), n = new THREE.Vector3(...pl.n).normalize();
  const y = new THREE.Vector3().crossVectors(n, x).normalize();
  return new THREE.Matrix4().makeBasis(x, y, n).setPosition(o);
}

// a node's trailing Scale feature, and everything before it
function scaleOf(n) {
  const ms = n.mods || [], l = ms[ms.length - 1];
  const isS = l && l.t === "scale";
  return { k: isS ? l.k : [1, 1, 1], o: isS ? l.o : [0, 0, 0], pre: JSON.stringify({ ...n, mods: isS ? ms.slice(0, -1) : ms }) };
}

class BodyView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.mesh = null;
    this.edges = null;
    this.data = null;
    this.key = null;
  }
  setData(data, body, style) {
    this.data = data;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.edges) { this.group.remove(this.edges); this.edges.geometry.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.vertices, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    g.setIndex(new THREE.BufferAttribute(data.triangles, 1));
    data.faceGroups.forEach(([s, c]) => g.addGroup(s, c, 0));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.mats = this.makeMats(body, style);
    this.dataVer = (this.dataVer || 0) + 1; this.apSig = null; this.faceMat = null;
    this.mesh = new THREE.Mesh(g, this.mats);
    this.mesh.userData.bodyView = this;
    this.group.add(this.mesh);
    const eg = new THREE.BufferGeometry();
    // edge polylines -> segments
    const L = data.lines;
    eg.setAttribute("position", new THREE.BufferAttribute(L, 3));
    const idx = [];
    for (const [s, c] of data.edgeGroups) for (let i = s; i < s + c - 1; i++) idx.push(i, i + 1);
    eg.setIndex(idx);
    this.edgeIdx = idx;
    this.edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: theme.c.edge, transparent: true, opacity: theme.c.edgeOpacity }));
    this.edges.renderOrder = 2;
    this.group.add(this.edges);
    this.applyStyle(body, style);
  }
  makeMats(body, style) {
    const base = new THREE.MeshStandardMaterial({ color: body.color || "#a7b0ba", roughness: 0.62, metalness: 0.04, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
    const hover = base.clone(); hover.color = HOVER.clone(); hover.emissive = new THREE.Color("#5a3a00"); hover.emissiveIntensity = 0.25;
    const sel = base.clone(); sel.color = new THREE.Color("#5b8be0"); sel.emissive = new THREE.Color("#0c2a66"); sel.emissiveIntensity = 0.35;
    return [base, hover, sel];
  }
  applyStyle(body, style) {
    if (!this.mesh) return;
    const [base, hover, sel] = this.mats;
    const hole = body.hole;
    const color = style.mono ? "#b4bcc5" : body.color || "#a7b0ba";
    const cut = !!body.cutPreview; // the volume an extrude is about to cut away
    base.color.set(cut ? "#e5484d" : hole ? "#8f99a3" : style.collide ? "#e5484d" : color);
    const ghost = hole || style.ghost || cut;
    // (for the Projector: the color without any highlight, and whether this is a see-through preview)
    this.plainColor = base.color.clone(); this.ghost = ghost || !!style.collide;
    for (const m of [base, hover, sel]) {
      m.transparent = ghost;
      m.opacity = cut ? 0.5 : hole ? 0.32 : style.ghost ? 0.25 : 1;
      m.depthWrite = !ghost;
      m.needsUpdate = true;
    }
    const em = this.edges.material;
    // selected bodies take on a strong blue tint (tool bodies of a Combine: orange) so it's
    // obvious at a glance what is selected
    const pick = style.tool ? SEL_TOOL : style.selected ? SEL_BLUE : null;
    this.tinted = false;
    if (pick && !cut && !style.collide) { base.color.lerp(pick, hole ? 0.4 : 0.55); this.tinted = true; }
    if (style.tool) { em.color.set("#d9480f"); em.opacity = 1; base.emissive = new THREE.Color("#6a2400"); base.emissiveIntensity = 0.35; }
    else if (style.selected) { em.color.set(theme.c.accent); em.opacity = 1; base.emissive = new THREE.Color("#0e3a99"); base.emissiveIntensity = 0.4; }
    else if (style.hovered) { em.color.set(theme.c.hover); em.opacity = 1; base.emissive = new THREE.Color("#3b2a00"); base.emissiveIntensity = 0.12; }
    else if (cut) { em.color.set("#c81e1e"); em.opacity = 1; base.emissive = new THREE.Color("#5a0000"); base.emissiveIntensity = 0.35; }
    else if (style.collide) { em.color.set("#ff2d2d"); em.opacity = 1; base.emissive = new THREE.Color("#5a0000"); base.emissiveIntensity = 0.3; }
    else { em.color.set(hole ? "#4c5662" : theme.c.edge); em.opacity = theme.name === "contrast" ? 1 : style.edgesStrong ? 0.7 : 0.38; base.emissiveIntensity = 0; }
    if (body.locked && !style.selected && !style.hovered) { em.color.set(theme.name === "light" ? "#7c8794" : "#9aa6b2"); em.opacity = 0.9; }
    this.mesh.renderOrder = ghost ? 3 : 0;
    this.mesh.castShadow = this.mesh.receiveShadow = !ghost;
    this.applyAppearance(ghost || cut || style.collide ? null : style.appearance, base);
  }
  // colors and simulated materials (Advanced mode): the whole body and/or single faces
  applyAppearance(ap, base) {
    const env = ap && this.scene.vp.studioEnv ? this.scene.vp.studioEnv() : null;
    const setLook = (m, a) => {
      const L = lookOf(a);
      m.color.set(L.color);
      m.metalness = L.metal; m.roughness = L.rough;
      m.envMap = env; m.envMapIntensity = L.metal > 0.5 ? 1.9 : 0.6;
      if (L.opacity < 1) { m.transparent = true; m.opacity = L.opacity; m.depthWrite = false; }
      m.needsUpdate = true;
    };
    if (ap && ap.body) { setLook(base, ap.body); this.tinted = false; }
    else if (base.metalness !== 0.04 || base.envMap) { base.metalness = 0.04; base.roughness = 0.62; base.envMap = null; base.needsUpdate = true; }
    const faces = ap && ap.faces && ap.faces.length ? ap.faces : null;
    const sig = faces ? JSON.stringify(faces) + "|" + this.dataVer : "";
    if (sig !== this.apSig) {
      this.apSig = sig;
      for (const m of this.mats.splice(3)) m.dispose(); // drop old face materials
      this.faceMat = null;
      if (faces) {
        this.faceMat = new Map();
        for (const f of faces) {
          const idx = matchTextureFaces(this.data, [f]);
          if (!idx.length) continue;
          const m = this.mats[0].clone();
          setLook(m, f);
          m.userData.look = f;
          this.mats.push(m);
          for (const i of idx) this.faceMat.set(i, this.mats.length - 1);
        }
      }
      this.mesh.material = this.mats;
    }
    // face materials follow the body's highlight
    for (let i = 3; i < this.mats.length; i++) { const m = this.mats[i]; m.emissive.copy(base.emissive); m.emissiveIntensity = base.emissiveIntensity; if (m.envMap !== env) { m.envMap = env; m.needsUpdate = true; } }
  }
  setFaceStates(states) {
    // states: Map(faceIndex -> 1 hover | 2 selected)
    if (!this.mesh) return;
    const groups = this.mesh.geometry.groups;
    groups.forEach((g, i) => (g.materialIndex = states.get(i) || (this.faceMat && this.faceMat.get(i)) || 0));
  }
  dispose() {
    if (this.mesh) this.mesh.geometry.dispose();
    if (this.edges) this.edges.geometry.dispose();
  }
}

export class SceneSync {
  constructor(vp, kernel) {
    this.vp = vp;
    this.kernel = kernel;
    this.views = new Map(); // bodyId -> BodyView
    this.sketchViews = new Map();
    this.errors = new Map(); // bodyId -> message
    this.root = new THREE.Group();
    vp.world.add(this.root);
    this.sketchRoot = new THREE.Group();
    vp.world.add(this.sketchRoot);
    this.edgeHi = new THREE.Group();
    vp.world.add(this.edgeHi);
    this.state = { selected: new Set(), hovered: null, faces: new Map(), edges: [], hoverEdge: null, ghost: new Set(), pre: new Set(), tools: new Set(), hideSketch: null, mode: "advanced", pose: new Map(), simHide: new Set(), collide: new Set() };
    // construction planes
    this.planeRoot = new THREE.Group();
    vp.world.add(this.planeRoot);
    this.showSketches = true;
  }

  // body id -> {key, node}
  sync(doc) {
    this.doc = doc;
    // imported models' files go to the geometry worker before anything that uses them
    // (sculpt data is only for Chisel; the kernel builds the sculpt's preview mesh)
    for (const [id, a] of Object.entries(doc.assets || {})) if (a.kind !== "sculpt" && !this.kernel.hasAsset(id)) this.kernel.addAsset(id, a.kind, fromB64(a.data));
    const want = [];
    const keys = new Set();
    for (const b of doc.bodies) {
      let resolved, key;
      try {
        resolved = resolveNode(b.node, doc);
        key = bodyKey(resolved) + (this.kernel.quality > 1 ? "@q" + this.kernel.quality : "");
      } catch (e) {
        this.errors.set(b.id, "Couldn't read this body's sketch");
        continue;
      }
      b._key = key;
      keys.add(key);
      if (!this.kernel.has(key)) want.push({ id: b.id, key, node: resolved });
    }
    this.kernel.prune(keys);
    this.kernel.request(want);
    this.refresh();
    this.syncSketches(doc);
    this.syncPlanes(doc);
  }

  refresh() {
    const doc = this.doc;
    if (!doc) return;
    const seen = new Set();
    for (const b of doc.bodies) {
      seen.add(b.id);
      let v = this.views.get(b.id);
      if (!v) { v = new BodyView(this); this.views.set(b.id, v); this.root.add(v.group); }
      const res = b._key && this.kernel.get(b._key);
      if (res) {
        if (res.ok) {
          this.errors.delete(b.id);
          const tsig = textureSig(b);
          if (v.key !== b._key || v.tsig !== tsig) {
            v.setData(tsig ? texturedMesh(b._key, res.mesh, b.textures) : res.mesh, b, this.styleFor(b));
            v.key = b._key; v.tsig = tsig; v.shownNode = JSON.parse(JSON.stringify(b.node));
          }
        } else this.errors.set(b.id, res.error);
      }
      v.body = b;
      v.pending = !res;
      v.group.matrix.fromArray(b.m);
      // joint simulations move bodies without changing the design
      const pose = this.state.pose.get(b.id);
      if (pose) v.group.matrix.premultiply(pose);
      v.group.matrixWorldNeedsUpdate = true;
      v.group.visible = !b.hidden && !this.state.simHide.has(b.id);
      if (v.mesh) {
        // while a resized primitive rebuilds, stretch the old mesh so the drag feels immediate
        let k = [1, 1, 1], off = [0, 0, 0];
        const s0 = v.shownNode;
        if (v.key !== b._key && b.node.t === "prim" && s0 && s0.t === "prim" && s0.kind === b.node.kind && !(b.node.mods || []).length) {
          const p0 = s0.p, p = b.node.p;
          k = [p.w / p0.w || 1, p.d / p0.d || 1, b.node.kind === "torus" ? 1 : p.h / p0.h || 1];
        } else if (v.key !== b._key && s0) {
          // a Scale feature being dragged: stretch what is shown until the kernel catches up
          const a = scaleOf(s0), c = scaleOf(b.node);
          if (a.pre === c.pre) { k = c.k.map((x, i) => x / a.k[i]); off = c.o.map((x, i) => x - k[i] * a.o[i]); }
        }
        v.mesh.scale.set(...k);
        v.edges.scale.set(...k);
        v.mesh.position.set(...off);
        v.edges.position.set(...off);
      }
      v.applyStyle(b, this.styleFor(b));
      v.setFaceStates(this.state.faces.get(b.id) || new Map());
      // projection media (pictures / videos on the object)
      if (this.onView) this.onView(v, b, doc);
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { this.root.remove(v.group); v.dispose(); this.views.delete(id); }
    this.drawEdgeHighlights();
    this.vp.request();
    this.onRefresh && this.onRefresh();
  }

  styleFor(b) {
    const s = this.state;
    return {
      // bodies a window is about to catch, and an extrude's new body while it's previewed
      selected: s.selected.has(b.id) || s.pre.has(b.id) || !!b.cmdPreview,
      tool: s.tools.has(b.id),
      hovered: s.hovered === b.id,
      ghost: s.ghost.has(b.id),
      edgesStrong: s.mode === "advanced",
      mono: false,
      collide: !!(s.collide && s.collide.has(b.id)),
      appearance: s.mode === "advanced" && s.appearance !== false && b.appearance && !b.hole ? b.appearance : null,
    };
  }

  // jumpstart-3d: holdBusy is raised while a Combine or Group is still staging its result (see combinesplit.js)
  busy() { return this.holdBusy > 0 || (this.doc ? this.doc.bodies.some((b) => this.views.get(b.id)?.pending) : false); }

  // ---------------------------------------------------------- selection visuals
  setSelected(ids) { this.state.selected = new Set(ids); this.refresh(); }
  // bodies a selection window is about to catch
  setPreselected(ids) { const n = new Set(ids); if (n.size === this.state.pre.size && [...n].every((x) => this.state.pre.has(x))) return; this.state.pre = n; this.refresh(); }
  // tool bodies of an open Combine (shown in their own color)
  setToolBodies(ids) { this.state.tools = new Set(ids); this.refresh(); }
  setHovered(id) { if (this.state.hovered !== id) { this.state.hovered = id; this.refresh(); } }
  setFaces(map) { this.state.faces = map; this.refresh(); }
  setEdges(list, hover) { this.state.edges = list; this.state.hoverEdge = hover; this.drawEdgeHighlights(); this.vp.request(); }
  drawEdgeHighlights() {
    for (const c of [...this.edgeHi.children]) { this.edgeHi.remove(c); c.geometry.dispose(); }
    const add = (e, color) => {
      const v = this.views.get(e.body);
      if (!v || !v.data) return;
      const [s, c] = v.data.edgeGroups[e.edge] || [0, 0];
      if (!c) return;
      const pts = [];
      for (let i = s; i < s + c; i++) pts.push(new THREE.Vector3(v.data.lines[i * 3], v.data.lines[i * 3 + 1], v.data.lines[i * 3 + 2]).applyMatrix4(v.group.matrix));
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
      line.renderOrder = 10;
      this.edgeHi.add(line);
    };
    for (const e of this.state.edges) add(e, ACCENT);
    if (this.state.hoverEdge) add(this.state.hoverEdge, HOVER);
  }

  // ---------------------------------------------------------- picking
  meshes(filter) {
    const out = [];
    for (const [id, v] of this.views) if (v.mesh && v.group.visible && (!filter || filter(v.body))) out.push(v.mesh);
    return out;
  }
  pickFace(e, filter) {
    const hits = this.vp.pick(e, this.meshes(filter));
    for (const h of hits) {
      const v = h.object.userData.bodyView;
      if (v.body.hole && filter && !filter.allowHoles) { /* fallthrough allowed */ }
      const idx = h.faceIndex * 3;
      const groups = v.data.faceGroups;
      let lo = 0, hi = groups.length - 1, face = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const [s, c] = groups[mid];
        if (idx < s) hi = mid - 1; else if (idx >= s + c) lo = mid + 1; else { face = mid; break; }
      }
      const nWorld = h.face.normal.clone().transformDirection(v.group.matrix);
      return { body: v.body.id, face, point: h.point.clone(), normal: nWorld, info: v.data.faceInfo[face], view: v, distance: h.distance };
    }
    return null;
  }
  pickEdge(e, filter, px = 7) {
    const [mx, my] = this.vp.local(e);
    const faceHit = this.pickFace(e, filter);
    let best = null, bd = px;
    const cam = this.vp.camera;
    const tmp = new THREE.Vector3();
    for (const [id, v] of this.views) {
      if (!v.data || !v.group.visible || (filter && !filter(v.body))) continue;
      const L = v.data.lines;
      const m = v.group.matrix;
      const proj = new Float32Array((L.length / 3) * 3);
      for (let i = 0; i < L.length / 3; i++) {
        tmp.set(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(m);
        const d = tmp.distanceTo(cam.position);
        tmp.project(cam);
        proj[i * 3] = ((tmp.x + 1) / 2) * this.vp.w;
        proj[i * 3 + 1] = ((1 - tmp.y) / 2) * this.vp.h;
        proj[i * 3 + 2] = d;
      }
      v.data.edgeGroups.forEach(([s, c], ei) => {
        for (let i = s; i < s + c - 1; i++) {
          const ax = proj[i * 3], ay = proj[i * 3 + 1], bx = proj[i * 3 + 3], by = proj[i * 3 + 4];
          const dx = bx - ax, dy = by - ay;
          const t = Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(ax + dx * t - mx, ay + dy * t - my);
          if (d < bd) {
            const depth = proj[i * 3 + 2] + (proj[i * 3 + 5] - proj[i * 3 + 2]) * t;
            // hidden edges behind the picked face don't count
            if (faceHit && depth > faceHit.distance + Math.max(0.5, faceHit.distance * 0.004)) continue;
            bd = d;
            best = { body: v.body.id, edge: ei, info: v.data.edgeInfo[ei] };
          }
        }
      });
    }
    return best;
  }
  bodyWorldBox(id) {
    const v = this.views.get(id);
    if (!v || !v.data) return null;
    const b = v.data.bbox;
    const box = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
    return box.applyMatrix4(v.group.matrix);
  }
  // exact world bbox from the mesh vertices (rotations make the local box loose)
  bodyTightBox(id) {
    const v = this.views.get(id);
    if (!v || !v.mesh) return null;
    return this.boxWithMatrix(id, v.group.matrix);
  }
  boxWithMatrix(id, matrix) {
    const v = this.views.get(id);
    if (!v || !v.data) return null;
    // cached per mesh + matrix: textured meshes can have a million vertices
    const mk = matrix.elements.join(",");
    if (v._box && v._box.data === v.data && v._box.mk === mk) return v._box.box.clone();
    const box = new THREE.Box3();
    const p = v.data.vertices, t = new THREE.Vector3();
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(t.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(matrix));
    v._box = { data: v.data, mk, box: box.clone() };
    return box;
  }
  allBox(filter) {
    const box = new THREE.Box3();
    for (const [id, v] of this.views) if (v.group.visible && v.data && (!filter || filter(v.body))) box.union(this.bodyTightBox(id));
    return box;
  }

  // ---------------------------------------------------------- construction planes
  syncPlanes(doc) {
    for (const c of [...this.planeRoot.children]) { this.planeRoot.remove(c); c.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); }
    for (const p of doc.planes || []) {
      if (p.hidden) continue;
      const s = p.size || 60;
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.copy(planeMatrix(p.plane));
      g.matrixWorldNeedsUpdate = true;
      const hot = this.state.hotPlane === p.id;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: hot ? 0xe8a317 : 0xf0a23a, transparent: true, opacity: hot ? 0.5 : this.state.planesBold ? 0.3 : 0.16, side: THREE.DoubleSide, depthWrite: false }));
      m.userData.cplane = p.id;
      m.renderOrder = 6;
      const h = s / 2;
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => new THREE.Vector3(x, y, 0))), new THREE.LineBasicMaterial({ color: hot ? 0xe8a317 : 0xc9790c }));
      g.add(m, edge);
      this.planeRoot.add(g);
    }
    this.vp.request();
  }
  planeMeshes() {
    const out = [];
    for (const g of this.planeRoot.children) for (const c of g.children) if (c.userData.cplane) out.push(c);
    return out;
  }

  // ---------------------------------------------------------- sketches
  syncSketches(doc) {
    for (const c of [...this.sketchRoot.children]) { this.sketchRoot.remove(c); c.traverse((o) => o.geometry && o.geometry.dispose()); }
    this.sketchViews.clear();
    for (const sk of doc.sketches) {
      const forced = this.state.forceSketch === sk.id || !!(this.state.forceSketches && this.state.forceSketches.has(sk.id));
      if (!forced && (!this.showSketches || sk.hidden)) continue;
      if (this.state.hideSketch === sk.id) continue;
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.copy(planeMatrix(sk.plane));
      g.matrixWorldNeedsUpdate = true;
      g.userData.sketch = sk.id;
      const curves = resolveSketch(sk);
      const pos = [], cpos = [];
      for (const c of curves) {
        if (c.t === "point") continue;
        const pts = sampleCurve(c);
        const arr = c.cons ? cpos : pos;
        for (let i = 0; i < pts.length - 1; i++) arr.push(pts[i][0], pts[i][1], 0, pts[i + 1][0], pts[i + 1][1], 0);
      }
      for (const { pts } of textOutlines(sk)) for (let i = 0; i < pts.length - 1; i++) pos.push(pts[i][0], pts[i][1], 0, pts[i + 1][0], pts[i + 1][1], 0);
      const lines = thickLines(pos, theme.c.sketch, 1.4, true);
      lines.renderOrder = 4;
      g.add(lines);
      if (cpos.length) {
        const cg = new THREE.BufferGeometry();
        cg.setAttribute("position", new THREE.Float32BufferAttribute(cpos, 3));
        const cl = new THREE.LineSegments(cg, new THREE.LineDashedMaterial({ color: 0xc07a12, dashSize: 2, gapSize: 1.5 }));
        cl.computeLineDistances();
        g.add(cl);
      }
      if (sk.image) g.add(sketchImageMesh(sk.image, () => this.vp.request()));
      // profile fills (pickable for extrude)
      const regs = regionsFor(sk);
      regs.forEach((r, i) => {
        const m = new THREE.Mesh(regionGeometry(r), new THREE.MeshBasicMaterial({ color: theme.c.sketchFill, transparent: true, opacity: theme.name === "light" ? 0.18 : 0.38, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
        m.userData.region = { sketch: sk.id, index: i, region: r };
        m.renderOrder = 5;
        g.add(m);
      });
      this.sketchRoot.add(g);
      this.sketchViews.set(sk.id, { group: g, regions: regs });
    }
    this.vp.request();
  }
  regionMeshes() {
    const out = [];
    for (const { group } of this.sketchViews.values()) group.children.forEach((c) => c.userData.region && out.push(c));
    return out;
  }
  highlightRegions(selected, hover) {
    for (const m of this.regionMeshes()) {
      const r = m.userData.region;
      const k = r.sketch + ":" + r.index;
      const sel = selected.has(k), hov = hover === k;
      m.material.color.set(sel ? "#1f6fff" : hov ? "#e8a317" : theme.c.sketchFill);
      m.material.opacity = sel ? 0.62 : hov ? 0.45 : theme.name === "light" ? 0.18 : 0.38;
    }
    this.vp.request();
  }
}
