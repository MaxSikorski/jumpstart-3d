// Constraint badges on a busy sketch (jumpstart-3d: badge layout, browser test F10). The R02 hexagon (Horizontal, five Equals, a length of 20) and the R09
// version with the 120 degree angle, at the school laptop size 1366 x 768 after Fit all: no badge on another badge, on a corner or on a dimension label,
// every badge clickable and tied to its line (selecting it lights the line; hovering one Equal lights its partner), and a plain rectangle's badges stay by their lines.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc } from "./helpers.mjs";

let page, errors;
test.beforeEach(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async ({}, info) => { const e = errors; if (info.status !== "passed") await page.screenshot({ path: info.outputPath("failed.png") }).catch(() => {}); await page.close(); expect(e, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const HEX = [[-20, 20], [4, 20], [16, 0], [4, -20], [-20, -20], [-32, 0]]; // A B C D E F, closed
const sketch = () => run(() => JSON.parse(JSON.stringify(window.__store.doc.sketches[0])));

async function openBlank() {
  await loadDoc(page, newDoc("Badges", "advanced", { sketches: [{ id: "s1", name: "Sketch 1", seq: 1, hidden: false, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [], cons: [] }] }));
  await run(() => window.__app.enterSketch("s1"));
  await page.waitForFunction(() => !window.__app.vp.anim);
  await expect(page.locator("#sk-line")).toBeVisible();
}
async function polygon(pts) { // closed polygon of lines, through the app's own edit call
  await run((pts) => {
    const s = window.__app.sketcher;
    pts.forEach((p, i) => s.edit("Line", (sk) => {
      const at = (q) => { const h = sk.pts.find((o) => Math.hypot(o.x - q[0], o.y - q[1]) < 1e-6); if (h) return h.id; const id = "p" + sk.pts.length; sk.pts.push({ id, x: q[0], y: q[1] }); return id; };
      sk.ents.push({ id: "e" + sk.ents.length, t: "line", a: at(p), b: at(pts[(i + 1) % pts.length]) });
    }));
  }, pts);
}
async function constrain(type, ...ids) {
  await run(([type, ids]) => {
    const s = window.__app.sketcher;
    s.applyConstraint(type, ids.map((id) => ({ kind: "line", e: s.sketch.ents.find((e) => e.id === id) })));
  }, [type, ids]);
}
async function addDim(d, value) {
  const id = "t" + Math.random().toString(36).slice(2, 7);
  await run(([d, id, v]) => { const s = window.__app.sketcher; s.edit("Dimension", (sk) => { sk.cons.push({ id, ...d }); }); s.edit("Edit dimension", (sk) => { sk.cons.find((c) => c.id === id).v = v; }); }, [d, id, value]);
  return id;
}
async function fitAll() {
  await page.locator("#nav-fit").click({ force: true });
  await page.waitForFunction(() => !window.__app.vp.anim && !(window.__app.vp.isMoving && window.__app.vp.isMoving()));
}
async function busyHexagon() {
  const { buildDim } = await import("../src/dims.js");
  await openBlank();
  await polygon(HEX);
  await constrain("horizontal", "e0");
  for (let i = 1; i < 6; i++) await constrain("equal", "e0", "e" + i);
  const sk = await sketch(), m = [(sk.pts[0].x + sk.pts[1].x) / 2, (sk.pts[0].y + sk.pts[1].y) / 2];
  await addDim(buildDim(sk, [{ kind: "line", e: sk.ents[0] }], [m[0] + 1, m[1] + 6]), 20);
}
// everything the screen shows, in page pixels: badges, corners, dimension labels, each badge's own line midpoint
const screen = () => run(() => {
  const s = window.__app.sketcher, vp = window.__app.vp, cb = vp.canvas.getBoundingClientRect(), sk = s.sketch;
  const toScreen = (x, y) => { const V = vp.camera.position.constructor; const q = vp.project(new V(x, y, 0).applyMatrix4(s.mat)); return [cb.left + q[0], cb.top + q[1]]; };
  const rect = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const glyphs = [...document.querySelectorAll(".cglyph")];
  return {
    badges: glyphs.map((g) => ({ rect: rect(g), text: g.textContent, on: g.classList.contains("on"), pair: g.classList.contains("pair") })),
    corners: sk.pts.map((p) => toScreen(p.x, p.y)),
    labels: [...document.querySelectorAll(".dimlabel:not(.preview)")].map(rect),
  };
});
const ownMids = async () => { // where each badge's own line (or point) is on screen: glyphSpots says where each badge belongs, in sketch units
  const { glyphSpots } = await import("../src/constraints.js");
  const spots = glyphSpots(await sketch()).map((q) => q.at);
  return run((spots) => {
    const s = window.__app.sketcher, vp = window.__app.vp, cb = vp.canvas.getBoundingClientRect(), V = vp.camera.position.constructor;
    return spots.map((a) => { const p = vp.project(new V(a[0], a[1], 0).applyMatrix4(s.mat)); return [cb.left + p[0], cb.top + p[1]]; });
  }, spots);
};
const ov = (a, b) => [Math.min(a[2], b[2]) - Math.max(a[0], b[0]), Math.min(a[3], b[3]) - Math.max(a[1], b[1])]; // overlap in x and in y (negative: apart)
const overlapped = (a, b, tol) => { const [ox, oy] = ov(a, b); return ox > tol && oy > tol; };
const centre = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];

async function checkLayout(info, shot, labelCount) {
  const sc = await screen();
  expect(sc.badges.length, "1 H + 5 Equal x 2 ends").toBe(11);
  expect(sc.labels.length, "dimension labels").toBe(labelCount);
  const all = sc.badges.map((b, i) => ({ ...b, i }));
  for (const a of all) for (const b of all) if (a.i < b.i) expect(overlapped(a.rect, b.rect, 1), `badge ${a.i} (${a.text}) on badge ${b.i} (${b.text}): ${JSON.stringify(ov(a.rect, b.rect))}`).toBe(false);
  for (const b of all) for (const [x, y] of sc.corners) expect(x > b.rect[0] + 1 && x < b.rect[2] - 1 && y > b.rect[1] + 1 && y < b.rect[3] - 1, `badge ${b.i} (${b.text}) covers a corner at ${Math.round(x)},${Math.round(y)}`).toBe(false);
  for (const b of all) for (const l of sc.labels) expect(overlapped(b.rect, l, 1), `badge ${b.i} (${b.text}) on a dimension label`).toBe(false);
  const mids = await ownMids();
  for (const b of all) {
    const [cx, cy] = centre(b.rect);
    const top = await run(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.closest(".cglyph") ? [...document.querySelectorAll(".cglyph")].indexOf(e.closest(".cglyph")) : -1; }, [cx, cy]);
    expect(top, `badge ${b.i} (${b.text}) has something on top of it`).toBe(b.i);
    expect(Math.hypot(cx - mids[b.i][0], cy - mids[b.i][1]), `badge ${b.i} (${b.text}) is far from its line: centre ${Math.round(cx)},${Math.round(cy)}, its line ${Math.round(mids[b.i][0])},${Math.round(mids[b.i][1])}`).toBeLessThan(90);
  }
  await page.screenshot({ path: info.outputPath(shot) });
}

test("busy hexagon at Fit all: no badge on another badge, a corner or the length label, each one reachable and near its line", async ({}, info) => {
  test.setTimeout(240_000);
  await busyHexagon();
  await fitAll();
  await checkLayout(info, "busy-fit.png", 1);
});

test("each badge selects its own constraint, and Delete removes just that one", async () => {
  test.setTimeout(240_000);
  await busyHexagon();
  await fitAll();
  const n = await page.locator(".cglyph").count();
  expect(n).toBe(11);
  for (let i = 0; i < n; i++) {
    const r = (await screen()).badges[i].rect, [cx, cy] = centre(r);
    const want = await run((i) => window.__app.sketcher.glyphEls[i]._c.id, i);
    await page.mouse.click(cx, cy);
    const st = await run(() => ({ sel: [...window.__app.sketcher.selCons], lit: [...window.__app.sketcher.litByCons()], cons: window.__store.doc.sketches[0].cons.map((c) => ({ id: c.id, e1: c.e1, e2: c.e2 })) }));
    expect(st.sel, `badge ${i} selects its constraint only`).toEqual([want]);
    expect((await screen()).badges[i].on, `badge ${i} shows it is on`).toBe(true);
    const c = st.cons.find((q) => q.id === want);
    for (const id of [c.e1, c.e2].filter(Boolean)) expect(st.lit, `badge ${i} lights ${id}`).toContain(id);
    await page.mouse.click(cx, cy);
    expect(await run(() => window.__app.sketcher.selCons.size), `badge ${i} unselects`).toBe(0);
  }
  const before = await sketch(), third = before.cons.filter((c) => c.t === "equal")[2];
  const idx = await run((id) => window.__app.sketcher.glyphEls.findIndex((d) => d._c.id === id), third.id);
  const [cx, cy] = centre((await screen()).badges[idx].rect);
  await page.mouse.click(cx, cy);
  await page.keyboard.press("Delete");
  const after = await sketch();
  expect(after.cons.some((c) => c.id === third.id), "that Equal is gone").toBe(false);
  expect(after.cons.filter((c) => c.t === "equal").length, "the other Equals stay").toBe(4);
  await expect(page.locator(".cglyph")).toHaveCount(9);
});

test("hovering a badge lights its pair: the same constraint's other end, and both lines", async () => {
  test.setTimeout(240_000);
  await busyHexagon();
  await fitAll();
  const sk = await sketch(), eq = sk.cons.find((c) => c.t === "equal");
  const idx = await run((id) => window.__app.sketcher.glyphEls.map((d, i) => (d._c.id === id ? i : -1)).filter((i) => i >= 0), eq.id);
  expect(idx.length).toBe(2);
  const sc = await screen();
  const [cx, cy] = centre(sc.badges[idx[0]].rect);
  await page.mouse.move(cx, cy);
  await expect.poll(async () => (await screen()).badges.map((b) => b.pair)).toEqual(sc.badges.map((_, i) => idx.includes(i)));
  const lit = await run(() => [...window.__app.sketcher.litByCons()]);
  expect(lit).toContain(eq.e1);
  expect(lit).toContain(eq.e2);
  await page.mouse.move(5, 5);
  await expect.poll(async () => (await screen()).badges.some((b) => b.pair)).toBe(false);
  expect(await run(() => window.__app.sketcher.litByCons().size)).toBe(0);
});

test("with the 120 degree angle (R09 step 2): still no badge on a badge, a corner or either label", async ({}, info) => {
  test.setTimeout(240_000);
  const { buildDim } = await import("../src/dims.js");
  await busyHexagon();
  const sk = await sketch(), B = sk.pts.find((p) => p.id === sk.ents[1].a), cx = sk.pts.reduce((t, p) => t + p.x, 0) / 6, cy = sk.pts.reduce((t, p) => t + p.y, 0) / 6;
  await addDim(buildDim(sk, [{ kind: "line", e: sk.ents[0] }, { kind: "line", e: sk.ents[1] }], [B.x + (cx - B.x) * 0.3, B.y + (cy - B.y) * 0.3]), 120);
  await fitAll();
  await checkLayout(info, "busy-angle.png", 2);
});

test("a plain rectangle's badges stay by their own lines, on the outside", async () => {
  test.setTimeout(240_000);
  await openBlank();
  await polygon([[-20, -10], [20, -10], [20, 10], [-20, 10]]);
  await constrain("horizontal", "e0");
  await constrain("horizontal", "e2");
  await constrain("vertical", "e1");
  await constrain("vertical", "e3");
  await fitAll();
  const sc = await screen();
  expect(sc.badges.length).toBe(4);
  const cs = sc.corners, mx = cs.reduce((t, p) => t + p[0], 0) / 4, my = cs.reduce((t, p) => t + p[1], 0) / 4;
  const lines = [[0, 1, "H"], [1, 2, "V"], [2, 3, "H"], [3, 0, "V"]]; // bottom, right, top, left (screen y is down, so "bottom" is the sketch's e0)
  const used = new Set();
  for (const [a, b, letter] of lines) {
    const p = cs[a], q = cs[b], m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]), u = [(q[0] - p[0]) / len, (q[1] - p[1]) / len], nrm = [-u[1], u[0]];
    const out = Math.sign((m[0] - mx) * nrm[0] + (m[1] - my) * nrm[1]); // which side of the line is away from the rectangle
    const near = sc.badges.map((g, j) => ({ g, j, d: Math.hypot(centre(g.rect)[0] - m[0], centre(g.rect)[1] - m[1]) })).filter((o) => o.g.text === letter && !used.has(o.j)).sort((x, y) => x.d - y.d)[0];
    used.add(near.j);
    const r = near.g.rect, [bx, by] = centre(r);
    const along = (bx - m[0]) * u[0] + (by - m[1]) * u[1], off = out * ((bx - m[0]) * nrm[0] + (by - m[1]) * nrm[1]);
    const half = (Math.abs(nrm[0]) * (r[2] - r[0]) + Math.abs(nrm[1]) * (r[3] - r[1])) / 2;
    expect(Math.abs(along), `${letter} badge centred along its line`).toBeLessThan(4);
    expect(off - half, `${letter} badge sits 8-20 px off its line, on the outside`).toBeGreaterThanOrEqual(7);
    expect(off - half, `${letter} badge sits 8-20 px off its line, on the outside`).toBeLessThanOrEqual(20);
    for (const [x, y] of cs) expect(x > r[0] + 1 && x < r[2] - 1 && y > r[1] + 1 && y < r[3] - 1, `${letter} badge covers a corner`).toBe(false);
  }
});

test("while the Dimension tool waits for its label click, a badge does not swallow it", async () => {
  test.setTimeout(240_000);
  await busyHexagon();
  await fitAll();
  const before = await sketch(), dims = before.cons.filter((c) => c.t === "dim").length;
  const [lx, ly] = centre((await screen()).badges[0].rect);
  const ab = await run(() => { // screen point on the middle of line AB
    const s = window.__app.sketcher, vp = window.__app.vp, cb = vp.canvas.getBoundingClientRect(), sk = s.sketch, V = vp.camera.position.constructor;
    const P = (id) => sk.pts.find((p) => p.id === id), e = sk.ents[0], a = P(e.a), b = P(e.b);
    const q = vp.project(new V((a.x + b.x) / 2, (a.y + b.y) / 2, 0).applyMatrix4(s.mat));
    return [cb.left + q[0], cb.top + q[1]];
  });
  await page.locator("#sk-dim").click({ force: true });
  await page.mouse.move(...ab);
  await page.mouse.click(...ab);
  await expect.poll(() => run(() => window.__app.sketcher.dimPicks.length)).toBe(1);
  await page.mouse.move(lx, ly);
  await page.mouse.click(lx, ly);
  await page.waitForSelector("#prompt-value");
  expect((await sketch()).cons.filter((c) => c.t === "dim").length, "a new dimension was placed").toBe(dims + 1);
  expect(await run(() => window.__app.sketcher.selCons.size), "no badge was selected").toBe(0);
  await page.keyboard.press("Escape");
});
