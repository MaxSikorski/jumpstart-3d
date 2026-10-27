// The ISO metric thread profile (kernel.js threadGroove), measured on the real kernel: an M3, M5 and M8 bolt and nut are cut through the axis
// and the section is read back (diameters, flat widths, flank angle, pitch diameter), then a nut is slid over the bolt to check they do not
// overlap. Plan and numbers: .claude/plans/screw-threads (ISO 68-1 basic profile, ISO 965 tolerance position h / H).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import opencascade from "../third_party/replicad-opencascadejs/dist/replicad_single.js";

const root = fileURLToPath(new URL("../", import.meta.url));
let runtime;
async function getRuntime() {
  if (!runtime) runtime = (async () => {
    const bundle = await build({
      stdin: { contents: 'export { initKernel, evalNode } from "./src/kernel.js"; export * as R from "replicad";', resolveDir: root },
      bundle: true, write: false, format: "esm", platform: "node", logLevel: "error",
      alias: {
        replicad: root + "third_party/replicad/src/index.ts",
        "replicad/shape-functions": root + "third_party/replicad/src/shapeFunctions/index.ts",
        "opentype.js": root + "third_party/opentype.js/dist/opentype.module.js",
        flatbush: root + "third_party/flatbush/index.js",
        flatqueue: root + "third_party/flatqueue/index.js",
        three: root + "third_party/three/build/three.module.js",
      },
    });
    const api = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
    await api.initKernel(opencascade, gunzipSync(readFileSync(new URL("../src/occt-gz.wasm", import.meta.url))));
    return api;
  })();
  return runtime;
}

// the same bolt and nut the Fastener dialog builds (src/fasteners.js partBody): [width across flats, head height, nut width, nut height]
const HEX = { M3: [5.5, 2, 5.5, 2.4], M5: [8, 3.5, 8, 4.7], M8: [13, 5.3, 13, 6.8] };
const PITCH = { M3: 0.5, M5: 0.8, M8: 1.25 };
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const hexPrism = (af, h) => { const w = +((af * 2) / Math.sqrt(3)).toFixed(3); return { t: "prim", kind: "prism", p: { w, d: w, h, sides: 6, r: 0, c: 0 }, mods: [] }; };
const cylinder = (dia, h) => ({ t: "prim", kind: "cylinder", p: { w: dia, d: dia, h, r: 0, c: 0 }, mods: [] });
let n = 0;
const thread = (z, p, c) => ({ id: "f" + (++n), seq: n, t: "thread", face: { c: [0, 0, z], t: "CYLINDRE" }, pitch: p, length: 0, flip: false, left: false, clear: c });
function bolt(key, c) {
  const d = +key.slice(1), p = PITCH[key], [af, k] = HEX[key], L = Math.max(8, 10 * p), sh = I.slice(); sh[14] = k;
  return { node: { t: "group", children: [{ node: hexPrism(af, k), m: I.slice(), hole: false, name: "head" }, { node: cylinder(d, L), m: sh, hole: false, name: "shank" }], mods: [thread(k + L / 2, p, c)] }, z0: k, z1: k + L };
}
function nut(key, c) {
  const d = +key.slice(1), p = PITCH[key], m = HEX[key][3], node = hexPrism(HEX[key][2], m);
  node.mods.push({ id: "h" + (++n), seq: n, t: "hole", kind: "simple", dia: +(d - 1.0825 * p).toFixed(3), through: true, depth: m + 1, tapped: false, pitch: 0, clear: 0, tip: false, size: "", at: [{ p: [0, 0, m], n: [0, 0, 1] }] });
  node.mods.push(thread(m / 2, p, c));
  return { node, z0: 0, z1: m };
}

// the outer (bolt) or inner (nut) outline of a part, cut through the axis: [[z, radius], ...] on N+1 even steps
function profile(R, shape, zA, zB, rLo, rHi, ext, N) {
  const OC = R.getOC();
  const face = R.makePolygon([[0.001, 0, zA], [rHi, 0, zA], [rHi, 0, zB], [0.001, 0, zB]]);
  const sec = new OC.BRepAlgoAPI_Section(shape.wrapped, face.wrapped, false); sec.Build();
  const cut = R.cast(sec.Shape()); sec.delete();
  const bins = Array.from({ length: N + 1 }, () => null), dz = (zB - zA) / N, segs = [];
  for (const e of cut.edges) {
    let prev = null;
    for (let i = 0; i <= 400; i++) {
      const v = e.pointAt(i / 400), x = v.x, z = v.z; v.delete();
      if (prev && !(Math.abs(z - zA) < 1e-9 && Math.abs(prev[1] - zA) < 1e-9) && !(Math.abs(z - zB) < 1e-9 && Math.abs(prev[1] - zB) < 1e-9)) segs.push([prev[0], prev[1], x, z]); // not the cut window's own top and bottom lines
      prev = [x, z];
      if (x < rLo || z < zA - 1e-9 || z > zB + 1e-9) continue;
      const j = Math.round((z - zA) / dz);
      if (j < 0 || j > N) continue;
      bins[j] = bins[j] === null ? x : ext ? Math.max(bins[j], x) : Math.min(bins[j], x);
    }
    e.delete();
  }
  const out = [];
  for (let i = 0; i <= N; i++) if (bins[i] !== null) out.push([zA + i * dz, bins[i]]);
  out.segs = segs;
  return out;
}
function analyse(pr, p) {
  const rs = pr.map((q) => q[1]), rmax = Math.max(...rs), rmin = Math.min(...rs), dz = pr[1][0] - pr[0][0], tol = 0.005 * p;
  const turns = (pr[pr.length - 1][0] - pr[0][0]) / p;
  const outerFlat = pr.filter((q) => q[1] > rmax - tol).length * dz / turns, innerFlat = pr.filter((q) => q[1] < rmin + tol).length * dz / turns;
  // flank angle (included): the section's own line pieces between 25 and 75 percent of the depth, not the binned outline
  const ang = [];
  for (const [x0, z0, x1, z1] of pr.segs) {
    const r = (x0 + x1) / 2;
    if (r > rmin + 0.25 * (rmax - rmin) && r < rmin + 0.75 * (rmax - rmin) && Math.abs(x1 - x0) > 1e-9) ang.push(Math.atan(Math.abs(z1 - z0) / Math.abs(x1 - x0)));
  }
  ang.sort((a, b) => a - b);
  const flank = 2 * ang[Math.floor(ang.length / 2)] * 180 / Math.PI;
  let a = rmin, b = rmax; // pitch diameter: the radius at which half the length is solid
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (pr.filter((q) => q[1] > m).length / pr.length > 0.5) a = m; else b = m; }
  return { major: 2 * rmax, minor: 2 * rmin, outerFlat: outerFlat / p, innerFlat: innerFlat / p, flank, pitchDia: a + b };
}

// one size, one offset: section both parts, then put the nut at its loosest fit and measure the overlap with a real boolean
// the boolean takes minutes on touching threads (M3 about 3 min each): only with THREAD_BOOLEAN=1
const BOOLEAN = process.env.THREAD_BOOLEAN === "1";
async function measure(key, clear, withBoolean = true) {
  withBoolean = withBoolean && BOOLEAN;
  const { R, evalNode } = await getRuntime();
  const d = +key.slice(1), p = PITCH[key], N = 600;
  const B = bolt(key, clear), sb = evalNode(B.node), zc = (B.z0 + B.z1) / 2;
  const pb = profile(R, sb, zc - 2 * p, zc + 2 * p, d / 2 - 0.8 * p, d / 2 + 0.2, true, N);
  const Nn = nut(key, clear), sn = evalNode(Nn.node), zn = (Nn.z0 + Nn.z1) / 2;
  const nturn = Math.min(1.5, (Nn.z1 - Nn.z0) / 2 / p - 0.6);
  const pn = profile(R, sn, zn - nturn * p, zn + nturn * p, d / 2 - 0.8 * p, d / 2 + 0.5 * p, false, Math.round(N * nturn / 2));
  // the loosest axial position: the shift that maximises the smallest radial gap (nut radius minus bolt radius)
  const rB = (z) => { const t = ((z - pb[0][0]) % p + p) % p + pb[0][0], i = Math.min(pb.length - 2, Math.floor((t - pb[0][0]) / (pb[1][0] - pb[0][0]))); return pb[i][1]; };
  let gap = -1e9, shift = 0;
  for (let k = 0; k < 400; k++) { const s = p * k / 400; let g = 1e9; for (const [z, r] of pn) g = Math.min(g, r - rB(z + s)); if (g > gap) { gap = g; shift = s; } }
  // the real boolean at that position: the nut moved up by the shift (and whole pitches, to sit on the bolt's shank); both frames share the z axis
  let overlap = null;
  if (withBoolean) {
  const lift = shift + p * Math.round((zc - zn) / p), moved = sn.clone().translate([0, 0, lift]), x = sb.clone().intersect(moved);
  overlap = x.wrapped.IsNull() ? 0 : R.measureVolume(x);
  x.delete(); moved.delete();
  }
  const out = { bolt: analyse(pb, p), nut: analyse(pn, p), gap, overlap, engagement: (Math.max(...pb.map((q) => q[1])) - Math.min(...pn.map((q) => q[1]))) };
  sb.delete(); sn.delete();
  return out;
}

const iso = (d, p) => ({ H: 0.866025 * p, d2: d - 0.649519 * p, D1: d - 1.082532 * p, d3: d - 1.226869 * p });
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got.toFixed(4)} vs ${want.toFixed(4)} (allowed ${tol})`);

for (const key of ["M3", "M5", "M8"]) {
  const d = +key.slice(1), p = PITCH[key], I0 = iso(d, p);
  test(`${key}: ISO basic profile at print offset None, bolt and nut do not overlap`, { timeout: 240000 }, async () => {
    const m = await measure(key, 0, key === "M3"); // boolean (THREAD_BOOLEAN=1): M3 only; otherwise the section's radial gap judges the fit
    // bolt: major d, root d3 (17H/24 deep), crest flat P/8, flanks 60 degrees included, pitch diameter d2 within 0.03 mm
    near(m.bolt.major, d, 0.012, "bolt major diameter");
    near(m.bolt.minor, I0.d3, 0.012, "bolt root diameter");
    near((m.bolt.major - m.bolt.minor) / 2, 17 * I0.H / 24, 0.008, "bolt thread depth");
    near(m.bolt.outerFlat, 0.125, 0.03, "bolt crest flat (x P)");
    near(m.bolt.innerFlat, 1 / 6, 0.04, "bolt root flat (x P)");
    near(m.bolt.flank, 60, 1, "bolt flank angle");
    near(m.bolt.pitchDia, I0.d2, 0.03, "bolt pitch diameter");
    // nut: crest D1 (flat P/4), root = major d (flat P/8), thread depth 5H/8
    near(m.nut.minor, I0.D1, 0.012, "nut minor diameter");
    near(m.nut.major, d, 0.012, "nut major diameter");
    near((m.nut.major - m.nut.minor) / 2, 5 * I0.H / 8, 0.008, "nut thread depth");
    near(m.nut.innerFlat, 0.25, 0.03, "nut crest flat (x P)");
    near(m.nut.outerFlat, 0.125, 0.03, "nut root flat (x P)");
    near(m.nut.flank, 60, 1, "nut flank angle");
    near(m.nut.pitchDia, I0.d2, 0.03, "nut pitch diameter");
    // the two fit: no radial interference (0.02 mm = the section's sampling bias on a flank; the ISO basic profile touches flank to flank) and no overlapping volume
    assert.ok(m.gap >= -0.02, `bolt and nut radial gap at offset None is ${m.gap.toFixed(4)} mm (interference)`);
    if (m.overlap !== null) assert.ok(m.overlap < 0.5, `bolt and nut overlap by ${m.overlap.toFixed(3)} mm3 at offset None`); // they touch flank to flank; a real boolean leaves a sliver (it was 1.8 mm3 for M3)
  });
}

test("print offset: the M3 nut no longer falls through at -0.2 (it did: bolt major 2.700 < nut minor 2.759); M5 and M8 keep room at -0.1", { timeout: 600000 }, async () => {
  for (const [key, c] of [["M3", -0.2], ["M5", -0.1], ["M8", -0.1]]) {
    const p = PITCH[key], H = 0.866025 * p;
    const m = await measure(key, c, key === "M3"); // boolean (THREAD_BOOLEAN=1): M3 only
    assert.ok(m.gap > 0.02, `${key} at ${c}: the nut has no room (radial gap ${m.gap.toFixed(4)} mm)`);
    if (m.overlap !== null) assert.ok(m.overlap < 0.05, `${key} at ${c}: overlap ${m.overlap.toFixed(3)} mm3`);
    // the bolt's crest still reaches past the nut's crest by at least 90 percent of the 5H/8 engagement
    assert.ok(m.engagement >= 0.9 * 5 * H / 8, `${key} at ${c}: engagement ${m.engagement.toFixed(3)} mm, wanted at least ${(0.9 * 5 * H / 8).toFixed(3)}`);
    assert.ok(m.bolt.major > m.nut.minor, `${key} at ${c}: the bolt (${m.bolt.major.toFixed(3)}) falls through the nut (${m.nut.minor.toFixed(3)})`);
    // the clearance shows in the flanks: the bolt's pitch diameter shrinks and the nut's grows, each by at least s (the offset, at most 0.2 pitch)
    // (the groove is kept under 0.98 pitch wide, so on a fine pitch a big offset thins the bolt's tooth rather than moving the flank further)
    const s = Math.min(Math.abs(c), 0.2 * p), d2 = +key.slice(1) - 0.649519 * p;
    assert.ok(m.bolt.pitchDia < d2 - s, `${key} at ${c}: bolt pitch diameter ${m.bolt.pitchDia.toFixed(3)} (ISO ${d2.toFixed(3)})`);
    assert.ok(m.nut.pitchDia > d2 + s, `${key} at ${c}: nut pitch diameter ${m.nut.pitchDia.toFixed(3)} (ISO ${d2.toFixed(3)})`);
  }
});
