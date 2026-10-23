// jumpstart-3d: glTF export (.glb, binary glTF 2.0). Pure: takes the mesh data the OBJ and 3MF exporters read, touches no app state.
// One mesh and one node per body, one material per body (base colour), positions + normals + triangle indices in a single buffer.
// The app is millimetres with Z up; glTF is metres with Y up, so every point goes (x, y, z) mm -> (x, z, -y) / 1000.
const MM = 0.001;
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // glTF colours are linear, the app's are sRGB
const factor = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = parseInt(m ? m[1] : "A7B0BA", 16);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255), 1].map((v) => Math.round(v * 1e6) / 1e6);
};

// parts: [{ name, color, matrix (16 numbers, column-major, as three.js stores them), vertices, normals, triangles }]
export function glbBytes(parts, title) {
  const json = { asset: { version: "2.0", generator: "JumpStart 3D", extras: { units: "metres", sourceUnits: "millimetres", scaleFromSource: MM, upAxis: "Y (the app's Z axis becomes Y)", title: String(title || "design") } }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = [];
  let len = 0;
  const view = (data, target) => {
    json.bufferViews.push({ buffer: 0, byteOffset: len, byteLength: data.byteLength, target });
    chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    len += data.byteLength; // Float32 and Uint32 arrays only, so every view stays 4-byte aligned
    return json.bufferViews.length - 1;
  };
  for (const p of parts) {
    const M = p.matrix, P = p.vertices, N = p.normals, T = p.triangles, count = P.length / 3;
    if (!count || !T.length) continue;
    // normals go through the cofactor matrix (inverse transpose up to a positive scale once the sign of det is applied)
    const a = M[0], b = M[4], c = M[8], d = M[1], e = M[5], f = M[9], g = M[2], h = M[6], i = M[10];
    const k = [e * i - f * h, f * g - d * i, d * h - e * g, c * h - b * i, a * i - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d]; // rows of the cofactor matrix
    const det = a * k[0] + b * k[1] + c * k[2], s = det < 0 ? -1 : 1;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      const X = M[0] * x + M[4] * y + M[8] * z + M[12], Y = M[1] * x + M[5] * y + M[9] * z + M[13], Z = M[2] * x + M[6] * y + M[10] * z + M[14];
      pos[v * 3] = X * MM; pos[v * 3 + 1] = Z * MM; pos[v * 3 + 2] = -Y * MM;
      const u = N[v * 3], w = N[v * 3 + 1], q = N[v * 3 + 2];
      let nx = (k[0] * u + k[1] * w + k[2] * q) * s, ny = (k[3] * u + k[4] * w + k[5] * q) * s, nz = (k[6] * u + k[7] * w + k[8] * q) * s;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor[v * 3] = nx / l; nor[v * 3 + 1] = nz / l; nor[v * 3 + 2] = -ny / l;
    }
    const idx = new Uint32Array(T.length);
    for (let t = 0; t < T.length; t += 3) { // a mirrored body turns inside out: flip the winding
      idx[t] = T[t]; idx[t + 1] = s < 0 ? T[t + 2] : T[t + 1]; idx[t + 2] = s < 0 ? T[t + 1] : T[t + 2];
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < pos.length; v++) { const r = v % 3; if (pos[v] < min[r]) min[r] = pos[v]; if (pos[v] > max[r]) max[r] = pos[v]; }
    const acc = (bufferView, componentType, n, type, extra) => json.accessors.push({ bufferView, componentType, count: n, type, ...extra }) - 1;
    const aPos = acc(view(pos, 34962), 5126, count, "VEC3", { min, max });
    const aNor = acc(view(nor, 34962), 5126, count, "VEC3");
    const aIdx = acc(view(idx, 34963), 5125, idx.length, "SCALAR");
    const name = String(p.name || "Body");
    json.materials.push({ name, pbrMetallicRoughness: { baseColorFactor: factor(p.color), metallicFactor: 0, roughnessFactor: 0.6 } });
    json.meshes.push({ name, primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor }, indices: aIdx, material: json.materials.length - 1, mode: 4 }] });
    json.nodes.push({ name, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }
  if (!json.meshes.length) return null;
  json.buffers.push({ byteLength: len });
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = (text.length + 3) & ~3, total = 12 + 8 + jsonLen + 8 + len;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true); // "glTF", version 2
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.fill(0x20, 20, 20 + jsonLen); out.set(text, 20);
  let o = 20 + jsonLen;
  dv.setUint32(o, len, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8; // "BIN\0"
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
