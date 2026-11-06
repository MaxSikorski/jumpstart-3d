// Built body meshes packed into a project file (and unpacked when it's opened), so a design
// with very slow bodies opens straight away on any computer. Typed arrays become base64, and the
// whole thing is gzipped when the browser can.
const TYPES = { Float32Array, Uint32Array, Int32Array, Uint16Array, Uint8Array };
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function gz(bytes, back) {
  const S = back ? globalThis.DecompressionStream : globalThis.CompressionStream;
  if (!S) return null;
  const st = new Blob([bytes]).stream().pipeThrough(new S("gzip"));
  return new Uint8Array(await new Response(st).arrayBuffer());
}
export async function packMesh(mesh) {
  const json = JSON.stringify(mesh, (k, v) => {
    if (v && ArrayBuffer.isView(v) && TYPES[v.constructor.name]) return { $t: v.constructor.name, d: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    return v;
  });
  const raw = new TextEncoder().encode(json);
  const z = await gz(raw).catch(() => null);
  return z ? "g:" + b64(z) : "j:" + b64(raw);
}
export async function unpackMesh(str) {
  let raw = unb64(str.slice(2));
  if (str.startsWith("g:")) raw = await gz(raw, true);
  return JSON.parse(new TextDecoder().decode(raw), (k, v) => {
    if (v && typeof v === "object" && v.$t && TYPES[v.$t] && typeof v.d === "string") {
      const b = unb64(v.d);
      return new TYPES[v.$t](b.buffer, b.byteOffset, b.byteLength / TYPES[v.$t].BYTES_PER_ELEMENT);
    }
    return v;
  });
}
