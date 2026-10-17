// ---- A small pure-JavaScript DEFLATE / gzip decoder. Used only when the browser has no
// DecompressionStream (Safari before 16.4, older iPads and iPhones), so the 3D engine, Chisel
// sculpts and 3MF files still open there.
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// canonical Huffman table: counts per length + symbols sorted by code
function huff(lens, n) {
  const count = new Uint16Array(16), sym = new Uint16Array(n), offs = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lens[i]]++;
  count[0] = 0;
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  for (let i = 0; i < n; i++) if (lens[i]) sym[offs[lens[i]]++] = i;
  return { count, sym };
}
let FIXED_L = null, FIXED_D = null;
function fixed() {
  if (FIXED_L) return;
  const l = new Uint8Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8;
  for (let i = 144; i < 256; i++) l[i] = 9;
  for (let i = 256; i < 280; i++) l[i] = 7;
  for (let i = 280; i < 288; i++) l[i] = 8;
  FIXED_L = huff(l, 288);
  FIXED_D = huff(new Uint8Array(30).fill(5), 30);
}

export function inflateRaw(src, sizeHint) {
  let pos = 0, bit = 0, nb = 0;
  let out = new Uint8Array(Math.max(1024, sizeHint || src.length * 4)), op = 0;
  const need = (n) => {
    if (op + n <= out.length) return;
    let m = out.length * 2; while (m < op + n) m *= 2;
    const o = new Uint8Array(m); o.set(out.subarray(0, op)); out = o;
  };
  const bits = (n) => {
    while (nb < n) { if (pos >= src.length) throw new Error("Compressed data ended early."); bit |= src[pos++] << nb; nb += 8; }
    const v = bit & ((1 << n) - 1); bit >>>= n; nb -= n; return v;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.sym[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error("Bad compressed data.");
  };
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bit = 0; nb = 0;
      const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      if (pos + len > src.length) throw new Error("Compressed data ended early.");
      need(len); out.set(src.subarray(pos, pos + len), op); op += len; pos += len;
      continue;
    }
    let L, D;
    if (type === 1) { fixed(); L = FIXED_L; D = FIXED_D; }
    else if (type === 2) {
      const hl = bits(5) + 257, hd = bits(5) + 1, hc = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hc; i++) cl[CLORD[i]] = bits(3);
      const ch = huff(cl, 19), lens = new Uint8Array(hl + hd);
      for (let i = 0; i < hl + hd;) {
        const s = decode(ch);
        if (s < 16) lens[i++] = s;
        else {
          let rep = 0, v = 0;
          if (s === 16) { if (!i) throw new Error("Bad compressed data."); v = lens[i - 1]; rep = 3 + bits(2); }
          else if (s === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          while (rep--) lens[i++] = v;
        }
      }
      L = huff(lens.subarray(0, hl), hl); D = huff(lens.subarray(hl), hd);
    } else throw new Error("Bad compressed data.");
    for (;;) {
      const s = decode(L);
      if (s < 256) { need(1); out[op++] = s; }
      else if (s === 256) break;
      else {
        const k = s - 257, len = LBASE[k] + bits(LEXT[k]);
        const d = decode(D), dist = DBASE[d] + bits(DEXT[d]);
        if (dist > op) throw new Error("Bad compressed data.");
        need(len);
        for (let i = 0; i < len; i++, op++) out[op] = out[op - dist];
      }
    }
  }
  return out.subarray(0, op);
}

// gzip (possibly several members back to back)
export function gunzipSync(u8) {
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) throw new Error("Not gzip data.");
  const flg = u8[3]; let p = 10;
  if (flg & 4) p += 2 + (u8[p] | (u8[p + 1] << 8));
  if (flg & 8) { while (u8[p++]); }
  if (flg & 16) { while (u8[p++]); }
  if (flg & 2) p += 2;
  const n = u8.length, isize = (u8[n - 4] | (u8[n - 3] << 8) | (u8[n - 2] << 16) | (u8[n - 1] << 24)) >>> 0;
  return inflateRaw(u8.subarray(p, n - 8), isize || undefined);
}

// async helpers: native stream when the browser has one, this decoder otherwise
async function viaStream(u8, fmt) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream(fmt));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function gunzip(u8) {
  if (typeof DecompressionStream !== "undefined") { try { return await viaStream(u8, "gzip"); } catch (e) { /* fall through */ } }
  return gunzipSync(u8);
}
export async function inflate(u8) {
  if (typeof DecompressionStream !== "undefined") { try { return await viaStream(u8, "deflate-raw"); } catch (e) { /* fall through */ } }
  return inflateRaw(u8);
}
