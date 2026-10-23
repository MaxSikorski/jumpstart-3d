// Shared by the rotation specs (rotation-access, fine-rotate): the lopsided test box, the rotation oracle worked out here from the box's
// own middle (never the app's matrix code), and a few page helpers.
import { expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim } from "./helpers.mjs";

export const M0 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, -12, 5, 1]; // column-major: moved to (30, -12, 5), not turned
export const BOX = { w: 40, d: 24, h: 16, r: 0, c: 0 }; // three different sizes, so a turn about any axis changes the box
export const design = (mode) => newDoc("rotation access", mode, { bodies: [body("b1", "Box", prim("box", BOX), M0)] });

// ---- the oracle: 4 x 4 column-major matrices
export const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
export const tr = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export const rot = (ax, deg) => {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180), m = tr(0, 0, 0);
  if (ax === "x") { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; }
  if (ax === "y") { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
  if (ax === "z") { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  return m;
};
// the turn about the middle of the box, applied after the starting matrix
export const turned = (ax, deg, C, base = M0) => mul(mul(mul(tr(C[0], C[1], C[2]), rot(ax, deg)), tr(-C[0], -C[1], -C[2])), base);
// the box after the turn: the same middle, the half-sizes mixed by cos and sin
export function turnedBox(ax, deg, box) {
  const C = [0, 1, 2].map((i) => (box[i] + box[i + 3]) / 2), h = [0, 1, 2].map((i) => (box[i + 3] - box[i]) / 2);
  const c = Math.abs(Math.cos((deg * Math.PI) / 180)), s = Math.abs(Math.sin((deg * Math.PI) / 180));
  const [i, j] = { x: [1, 2], y: [0, 2], z: [0, 1] }[ax];
  const n = h.slice();
  n[i] = c * h[i] + s * h[j]; n[j] = s * h[i] + c * h[j];
  return [...C.map((v, k) => v - n[k]), ...C.map((v, k) => v + n[k])];
}
// the angle a turn about one axis left in the matrix (the box started unturned)
export const angleOf = (ax, m) => (Math.atan2({ x: m[6], y: m[8], z: m[1] }[ax], { x: m[5], y: m[0], z: m[0] }[ax]) * 180) / Math.PI;
export const expectMatrix = (got, want) => { expect(got).toHaveLength(16); want.forEach((v, i) => expect(got[i], `m[${i}]`).toBeCloseTo(v, 6)); };


export const boxNow = (p) => p.evaluate(() => { const b = window.__app.scene.bodyTightBox("b1"); return b ? [...b.min.toArray(), ...b.max.toArray()] : null; });
export const expectBox = (want, p) => expect.poll(() => boxNow(p), { timeout: 20_000 }).toSatisfy((b) => !!b && b.every((v, i) => Math.abs(v - want[i]) < 1e-3));
export const settle = async (p) => { // the camera stops moving, twice in a row
  for (let ok = 0; ok < 2;) { await p.waitForTimeout(200); ok = (await p.evaluate(() => !window.__app.vp.isMoving())) ? ok + 1 : 0; }
};


export async function open(mode, p) {
  await loadDoc(p, design(mode));
  await p.evaluate(() => window.__app.vp.fit(window.__app.scene.allBox()));
  await settle(p);
  return boxNow(p);
}


// a spot on the box's top face that shows the box (for a click or a tap)
export const spotOnBox = (p) => p.evaluate(() => {
  const { vp, scene } = window.__app, b = scene.bodyTightBox("b1"), r = vp.canvas.getBoundingClientRect();
  for (const fx of [0.5, 0.3, 0.7]) for (const fy of [0.5, 0.3, 0.7]) {
    const v = vp.view.target.clone().set(b.min.x + fx * (b.max.x - b.min.x), b.min.y + fy * (b.max.y - b.min.y), b.max.z);
    const [px, py] = vp.project(v), e = { clientX: r.left + px, clientY: r.top + py };
    const top = document.elementFromPoint(e.clientX, e.clientY);
    if (top === vp.canvas && scene.pickFace(e) && scene.pickFace(e).body === "b1") return { x: e.clientX, y: e.clientY };
  }
  return null;
});

// ---- touch (Chromium: real touch events through the DevTools protocol)
export const tablet = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: "block" };
export async function touchPage(browser, info, options) {
  const ctx = await browser.newContext(options);
  const p = await ctx.newPage();
  const errs = watchErrors(p);
  await boot(p, info);
  const cdp = await ctx.newCDPSession(p);
  return { ctx, p, cdp, errs };
}
export const touch = (cdp, type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: q.id ?? i })) });
export async function touchTo(cdp, from, to, steps = 10) {
  for (let i = 1; i <= steps; i++) await touch(cdp, "touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
}

