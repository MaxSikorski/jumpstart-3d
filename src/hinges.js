// Quick Hinges: ready-made hinges built from plain primitives, in the hinge's own frame: the
// pin axis runs along X through (y 0, z D/2), the two leaves lie flat on z = 0 (opened out),
// leaf A toward -Y and leaf B toward +Y, so the whole hinge prints flat on the plate.
//   pip     print-in-place: knuckles alternate between the leaves, leaf A's knuckles carry a
//           pin that runs inside leaf B's knuckles with a clearance gap all round, so it prints
//           already assembled and turns as soon as it comes off the plate
//   pin     two leaves with a straight hole through all the knuckles, for a pin: a piece of
//           1.75 mm filament, an M2 or M3 screw, or a printed pin (made as its own part)
//   living  a thin flexible strip joining two plates (print it in PETG, PP or TPU)
// Screw holes in the leaves are optional for the knuckle hinges.

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const T = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r6(x), r6(y), r6(z), 1];
const prim = (kind, p) => ({ t: "prim", kind, p: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "number" ? r6(v) : v])), mods: [] });
const kid = (node, m = T(), hole = false) => ({ node, m, hole });
const group = (children) => ({ t: "group", children, mods: [] });
// a round rod along X, centred at (x, y, z)
function rodX(len, dia, x = 0, y = 0, z = 0, hole = false) {
  const rod = group([kid(prim("cylinder", { w: dia, d: dia, h: len }), [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, -len / 2, 0, 0, 1])]);
  return kid(rod, T(x, y, z), hole);
}

export const HINGE_TYPES = [
  ["pip", "Print-in-place", "Prints already put together: the pin is inside the knuckles with a small gap, so it turns straight off the plate"],
  ["pin", "Pin hinge", "Two leaves with a hole through the knuckles for a pin: filament, a screw or a printed pin"],
  ["living", "Living hinge", "A thin strip that bends: one piece, best in PETG, PP or TPU"],
];
export const PIN_KINDS = [
  ["filament", "1.75 mm filament", 2.0],
  ["m2", "M2 screw", 2.3],
  ["m3", "M3 screw", 3.3],
  ["printed", "Printed pin", 0],
];
export const HINGE_DEFAULTS = { type: "pip", len: 40, dia: 8, knuckles: 5, leafW: 16, leafT: 2.4, clear: 0.4, pin: "filament", screws: false, screwD: 3.4, gap: 3, thin: 0.5 };

export function hingeParts(o0) {
  const o = { ...HINGE_DEFAULTS, ...o0 };
  if (o.type === "living") return living(o);
  const L = Math.max(6, o.len), D = Math.max(3, o.dia), W = Math.max(D / 2 + 2, o.leafW), t = Math.max(0.6, Math.min(o.leafT, D)), c = Math.max(0.05, o.clear);
  let n = Math.max(3, Math.round(o.knuckles)); if (n % 2 === 0) n++; // odd: leaf A has both ends
  const seg = L / n;
  if (seg < 2 * c + 1.5) throw new Error("The knuckles are too short: use fewer knuckles or a longer hinge");
  const zc = D / 2, R = D / 2;
  const span = (i) => { const x0 = -L / 2 + i * seg, x1 = x0 + seg; return [x0 + (i > 0 ? c / 2 : 0), x1 - (i < n - 1 ? c / 2 : 0)]; };
  const knuck = (i) => { const [a, b] = span(i); return rodX(b - a, D, (a + b) / 2, 0, zc); };
  const clearance = (i) => { const [a, b] = span(i); return rodX(b - a + 2 * c, D + 2 * c, (a + b) / 2, 0, zc, true); };
  const evens = [], odds = []; for (let i = 0; i < n; i++) (i % 2 ? odds : evens).push(i);
  // pin size: print-in-place uses about half the barrel; a pin hinge uses the chosen pin
  const pk = PIN_KINDS.find((p) => p[0] === o.pin) || PIN_KINDS[0];
  const pinD = o.type === "pip" ? Math.max(1.6, D * 0.48) : pk[2] || Math.max(2, D * 0.45);
  if (pinD + 2 * c > D - 1.2) throw new Error("The pin is too thick for this barrel: make the barrel wider");
  const screws = (side) => {
    if (!o.screws) return [];
    const d = Math.max(1.5, o.screwD), y = side * (R + c + (W - R - c) / 2);
    if (W - R - c < d + 1.6) return [];
    return [-L / 3, L / 3].map((x) => kid(prim("cylinder", { w: d, d, h: t + 2 }), T(x, y, -1), true));
  };
  // leaf A: plate toward -Y and the even knuckles, cut clear of leaf B's knuckles
  const plateA = kid(prim("box", { w: L, d: W, h: t }), T(0, -W / 2, 0));
  const plateB = kid(prim("box", { w: L, d: W, h: t }), T(0, W / 2, 0));
  let A = group([plateA, ...evens.map(knuck), ...odds.map(clearance), ...screws(-1)]);
  let B = group([plateB, ...odds.map(knuck), ...evens.map(clearance), ...screws(1)]);
  let pin = null;
  if (o.type === "pip") {
    // the pin belongs to leaf A and runs through leaf B's knuckles, which have room round it
    A = group([kid(A), rodX(L - 2 * Math.min(1, seg / 4), pinD, 0, 0, zc)]);
    B = group([kid(B), rodX(L + 2, pinD + 2 * c, 0, 0, zc, true)]);
  } else {
    const hole = pk[2] || pinD + 0.3;
    A = group([kid(A), rodX(L + 2, hole, 0, 0, zc, true)]);
    B = group([kid(B), rodX(L + 2, hole, 0, 0, zc, true)]);
    // a printed pin with a small head, laid beside the hinge
    if (o.pin === "printed") pin = group([rodX(L + 1, pinD, 0, 0, pinD / 2), rodX(1.2, pinD + 2.4, -L / 2 - 1.1, 0, pinD / 2)]);
  }
  return { a: A, b: B, pin, info: { knuckles: n, pinD: r6(pinD), hole: o.type === "pip" ? r6(pinD + 2 * c) : r6(pk[2] || pinD + 0.3) } };
}

function living(o) {
  const L = Math.max(6, o.len), W = Math.max(3, o.leafW), t = Math.max(0.8, o.leafT), g = Math.max(1, o.gap), th = Math.max(0.2, Math.min(o.thin, t));
  const one = group([
    kid(prim("box", { w: L, d: W, h: t }), T(0, -(g / 2 + W / 2), 0)),
    kid(prim("box", { w: L, d: W, h: t }), T(0, g / 2 + W / 2, 0)),
    kid(prim("box", { w: L, d: g + 2, h: th }), T(0, 0, 0)),
  ]);
  return { a: one, b: null, pin: null, info: { strip: r6(th) } };
}
