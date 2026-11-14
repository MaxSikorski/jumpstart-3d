// Layerscape models in JumpStart 3D: the 3D print kit (.zip) or its .3mf, made by Layerscape, comes
// in as one object per part. Kits from Layerscape 2.9.8.9.1 on also say where every part goes in the
// finished diorama, so they come in put together; older ones come in laid out flat as on the plate.
import { store, nextSeq, IDENTITY } from "./store.js";
import { uid } from "./util.js";
import { nextName } from "./ops.js";
import { readZip, repairMesh, packMesh, toB64, contentId, simplify, MESH_LIMIT, isZip } from "./meshimport.js";

const num = (s, k) => { const m = new RegExp("\\b" + k + '="([^"]*)"').exec(s); return m ? +m[1] : 0; };
const att = (s, k) => { const m = new RegExp("\\b" + k + '="([^"]*)"').exec(s); return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : ""; };

// -> null when it isn't from Layerscape, else { title, assembled, parts: [{ name, color, pos }] }
export async function readLayerscape(bytes) {
  if (!isZip(bytes)) return null;
  const buf = (u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
  let z = readZip(buf(bytes));
  let names = z.names();
  if (!names.some((n) => /^3d\/3dmodel\.model$/i.test(n))) {
    const inner = names.find((n) => /\.3mf$/i.test(n));
    if (!inner) return null;
    z = readZip(buf(await z.get(inner)));
    names = z.names();
  }
  let xml;
  try { xml = new TextDecoder().decode(await z.get("3D/3dmodel.model")); } catch (e) { return null; }
  if (!/<metadata\s+name="Application"\s*>\s*Layerscape\s*</i.test(xml)) return null;
  const title = (/<metadata\s+name="Title"\s*>([^<]*)</i.exec(xml) || [])[1] || "Layerscape diorama";
  let info = null;
  if (names.some((n) => /^metadata\/layerscape\.json$/i.test(n))) { try { info = JSON.parse(new TextDecoder().decode(await z.get("Metadata/layerscape.json"))); } catch (e) { info = null; } }
  const items = new Map();
  for (const m of xml.matchAll(/<item\b([^>]*)\/?>/g)) { const t = (att(m[1], "transform") || "1 0 0 0 1 0 0 0 1 0 0 0").split(/\s+/).map(Number); items.set(att(m[1], "objectid"), t); }
  const parts = [];
  let idx = 0;
  for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = att(m[1], "id"), name = att(m[1], "name") || "Part " + (idx + 1), body = m[2];
    const V = []; for (const v of body.matchAll(/<vertex\b([^>]*)\/?>/g)) V.push(num(v[1], "x"), num(v[1], "y"), num(v[1], "z"));
    const T = []; for (const t of body.matchAll(/<triangle\b([^>]*)\/?>/g)) T.push(num(t[1], "v1"), num(t[1], "v2"), num(t[1], "v3"));
    const pi = info && info.parts && info.parts[idx];
    // where it goes: the finished diorama (column-major 4×4), or its place on the plate (3MF 3×4)
    let M;
    if (pi && pi.m) { const a = pi.m; M = [a[0], a[1], a[2], a[4], a[5], a[6], a[8], a[9], a[10], a[12], a[13], a[14]]; }
    else M = items.get(id) || [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    const pos = new Float64Array(T.length * 3);
    for (let t = 0; t < T.length; t += 3) {
      const order = det < 0 ? [0, 2, 1] : [0, 1, 2];
      order.forEach((j, q) => {
        const k = T[t + j] * 3, x = V[k], y = V[k + 1], zz = V[k + 2], o = (t + q) * 3;
        pos[o] = x * M[0] + y * M[3] + zz * M[6] + M[9]; pos[o + 1] = x * M[1] + y * M[4] + zz * M[7] + M[10]; pos[o + 2] = x * M[2] + y * M[5] + zz * M[8] + M[11];
      });
    }
    if (pos.length) parts.push({ name: (pi && pi.name) || name, color: (pi && pi.color) || "#d8b98e", pos });
    idx++;
  }
  if (!parts.length) return null;
  if (!info) { // laid out on the plate: centre it
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) for (let i = 0; i < p.pos.length; i += 3) { x0 = Math.min(x0, p.pos[i]); x1 = Math.max(x1, p.pos[i]); y0 = Math.min(y0, p.pos[i + 1]); y1 = Math.max(y1, p.pos[i + 1]); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const p of parts) for (let i = 0; i < p.pos.length; i += 3) { p.pos[i] -= cx; p.pos[i + 1] -= cy; }
  }
  return { title, assembled: !!info, parts };
}

// parts: [{ name, color, pos } or { name, color, V, I }] in mm, Z up -> one mesh body each
export function addMeshBodies(app, parts, label) {
  const ids = [];
  const meshes = parts.map((pc) => {
    let mesh = pc.pos ? repairMesh(pc.pos).mesh : { V: pc.V, I: pc.I };
    if (mesh.I.length / 3 > MESH_LIMIT) { const s2 = simplify(mesh, MESH_LIMIT); if (s2 && s2.mesh) mesh = s2.mesh; }
    return mesh;
  });
  store.update((doc) => {
    doc.assets = doc.assets || {};
    parts.forEach((pc, i) => {
      const bytes = packMesh(meshes[i]), id = contentId(bytes);
      if (!doc.assets[id]) doc.assets[id] = { kind: "mesh", name: pc.name, data: toB64(bytes) };
      const b = { id: uid("b"), name: nextName(doc, pc.name), seq: nextSeq(doc), color: /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(pc.color || "") ? pc.color : "#d8b98e" /* jumpstart-3d: a kit file is untrusted: colours are hex only */, hole: false, hidden: false, m: IDENTITY.slice(), node: { t: "mesh", asset: id, keepPos: true, mods: [] }, layerscape: true };
      doc.bodies.push(b); ids.push(b.id);
    });
  }, label);
  app.select && app.select(ids);
  const t0 = Date.now();
  const iv = setInterval(() => {
    const ready = ids.every((id) => (app.scene.views.get(id) || {}).data || app.scene.errors.has(id));
    if (ready || Date.now() - t0 > 90000) { clearInterval(iv); app.fit && app.fit(); }
  }, 400);
  return ids;
}
