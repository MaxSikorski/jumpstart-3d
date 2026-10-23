// Compression springs (Phase 3 step 4c): the Spring dialog and JS3D.spring make a round-wire coil spring with open ends or ends cut flat,
// as one Coil body (plus two Split body planes for flat ends). The oracle is independent of the app: the pitch is solved here by
// Newton's method (the app bisects), the open volume is wire area x helix length, and the flat-cut volume is that minus the two end
// pieces, integrated numerically along the wire from the area of a circle clipped by the cut plane.
//
// The formulas (w wire, O outside diameter, L free length, N turns, R = (O - w) / 2, C = 2 pi R, alpha = atan(p / C)):
//   open: L = N p + w cos(alpha); flat cut: p = L / N; wire length = N sqrt(C^2 + p^2); volume = pi (w/2)^2 x wire length (open).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, exportBytes, quarantine } from "./helpers.mjs";

function pitchOpen(w, O, L, N) {
  const C = Math.PI * (O - w);
  let p = (L - w) / N;
  for (let i = 0; i < 50; i++) {
    const g = N * p + w / Math.sqrt(1 + (p / C) ** 2) - L, dg = N - (w * p) / C ** 2 / (1 + (p / C) ** 2) ** 1.5;
    p -= g / dg;
  }
  return p;
}
// the part of a disc of radius r lying where its binormal coordinate is below d (the segment area)
const segment = (r, d) => (d <= -r ? 0 : d >= r ? Math.PI * r * r : r * r * Math.acos(-d / r) + d * Math.sqrt(r * r - d * d));
function formula({ wire: w = 2, outside: O = 20, freeLength: L = 30, turns: N = 5, ends = "open" }) {
  const C = Math.PI * (O - w), p = ends === "flat" ? L / N : pitchOpen(w, O, L, N), cosA = 1 / Math.sqrt(1 + (p / C) ** 2);
  const area = Math.PI * (w / 2) ** 2, speed = Math.hypot(C, p), total = N * speed * area;
  if (ends === "open") return { p, volume: total, drop: (w * (1 - cosA)) / 2 };
  // the wire at turn fraction t (0 to N) has its centre at z = w/2 + p t; the cut at z0 removes a segment of each disc
  const steps = 200_000, dt = N / steps;
  let removed = 0;
  for (let i = 0; i < steps; i++) {
    const cz = w / 2 + p * (i + 0.5) * dt;
    removed += segment(w / 2, (w / 2 - cz) / cosA) * speed * dt; // below the lower plane (z = w/2)
    removed += (area - segment(w / 2, (L + w / 2 - cz) / cosA)) * speed * dt; // above the upper plane
  }
  return { p, volume: total - removed, drop: w / 2 };
}

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const fresh = (mode = "beginner") => run((m) => JS3D.newDesign(m), mode);
const failure = (fn, arg) => page.evaluate(async ([src, a]) => { try { await new Function("a", "return (" + src + ")(a)")(a); return null; } catch (e) { return e.message; } }, [fn.toString(), arg]);
const built = () => run(async () => { await JS3D.ready(); return JS3D.list(); });
const counts = () => run(() => ({ bodies: JS3D.doc().bodies.length, sketches: JS3D.doc().sketches.length, undo: __store.undoStack.length }));
const near = (got, want, rel, what) => expect(Math.abs(got - want) / Math.abs(want), `${what}: ${got} vs ${want}`).toBeLessThan(rel);
const field = async (id, v) => { await page.fill("#" + id, String(v)); await page.locator("#" + id).blur(); };
const nodeOf = (id) => run((id) => JSON.parse(JSON.stringify(JS3D.doc().bodies.find((b) => b.id === id))), id);
// the middle of the flat top face, in the body's own coordinates: the vertices within 0.1 mm of the highest one
const topFace = (id) => run((id) => { const v = window.__app.scene.views.get(id).data.vertices; let hi = -Infinity; for (let i = 2; i < v.length; i += 3) hi = Math.max(hi, v[i]); let x = 0, y = 0, n = 0; for (let i = 2; i < v.length; i += 3) if (v[i] > hi - 0.1) { x += v[i - 2]; y += v[i - 1]; n++; } return [x / n, y / n]; }, id);

test("Advanced: Create > Advanced Create > Spring makes the default open spring in one undo step", async () => {
  await fresh("advanced");
  await page.click("#ad-features");
  await page.click("#ad-spring");
  await expect(page.locator("#cmd")).toContainText("Spring");
  const f = formula({});
  await expect(page.locator("#cmd")).toContainText(`Pitch ${f.p.toFixed(3)} mm, gap between coils ${(f.p - 2).toFixed(3)} mm, 16 mm inside across.`);
  const undoBefore = await run(() => __store.undoStack.length);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  expect(list.map((b) => b.name)).toEqual(["Spring 20 x 30"]);
  const s = list[0];
  near(s.volume, f.volume, 0.001, "spring volume");
  expect(s.bbox.min[2]).toBeCloseTo(0, 1);
  expect(s.bbox.max[2]).toBeCloseTo(30, 1);
  expect(s.bbox.max[0] - s.bbox.min[0]).toBeLessThanOrEqual(20 + 1e-6);
  expect(s.bbox.max[0] - s.bbox.min[0]).toBeGreaterThan(19.9);
  expect(await run(() => __app.sel)).toEqual([s.id]);
  expect(await run(() => __store.undoStack.length)).toBe(undoBefore + 1);
  expect(await run(() => __store.undoStack.at(-1).label)).toBe("Add Spring 20 x 30");
  await run(() => JS3D.undo());
  expect(await counts()).toMatchObject({ bodies: 0 });
  await run(() => JS3D.redo());
  expect((await counts()).bodies).toBe(1);
});

test("volume, bounds, turns and ends across wire, size, turns, hand and ends", async () => {
  await fresh();
  const cases = [
    { ends: "open" },
    { ends: "flat" },
    { wire: 1, outside: 12, freeLength: 20, turns: 8, ends: "open", hand: "left" },
    { wire: 1, outside: 12, freeLength: 20, turns: 8, ends: "flat", hand: "left" },
    { wire: 3, outside: 30, freeLength: 60, turns: 4.5, ends: "open" },
    { wire: 3, outside: 30, freeLength: 60, turns: 4.5, ends: "flat" },
    { wire: 0.8, outside: 8, freeLength: 12, turns: 10, ends: "flat" },
  ];
  const ids = await run((cs) => cs.map((c, i) => JS3D.spring({ ...c, at: [i * 50, 0, 0] })), cases);
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  for (const [i, c] of cases.entries()) {
    const f = formula(c), b = list.find((x) => x.id === ids[i]), node = (await nodeOf(ids[i])).node, label = JSON.stringify(c);
    const w = c.wire ?? 2, O = c.outside ?? 20, L = c.freeLength ?? 30;
    near(b.volume, f.volume, 0.002, label + " volume");
    expect(node.turns, label + " turns").toBe(c.turns ?? 5);
    expect(node.left, label + " hand").toBe(c.hand === "left");
    near(node.pitch, f.p, 1e-5, label + " pitch");
    expect(Math.abs(b.bbox.min[2] - 0), label + " base").toBeLessThan(0.05);
    expect(Math.abs(b.bbox.max[2] - L), label + " free length").toBeLessThan(0.05);
    expect(b.bbox.max[0] - i * 50, label + " reach").toBeLessThanOrEqual(O / 2 + 1e-6);
    expect(b.bbox.max[0] - i * 50, label + " reach").toBeGreaterThan(O / 2 - 0.05);
    expect(node.size).toBe(w);
    expect(node.mods.length, label + " cuts").toBe(c.ends === "flat" ? 2 : 0);
  }
});

test("the hand: the top of a 5-turn flat spring ends just before +x, counter-clockwise for right-hand and clockwise for left-hand", async () => {
  await fresh();
  const [r, l] = await run(() => [JS3D.spring({ ends: "flat" }), JS3D.spring({ ends: "flat", hand: "left", at: [100, 0, 0] })]);
  await built();
  const [rx, ry] = await topFace(r), [lx, ly] = await topFace(l);
  const turn = (x, y) => (Math.atan2(y, x) * 180) / Math.PI;
  expect(turn(rx, ry)).toBeLessThan(-5);
  expect(turn(rx, ry)).toBeGreaterThan(-90);
  expect(turn(lx, ly)).toBeGreaterThan(5);
  expect(turn(lx, ly)).toBeLessThan(90);
});

test("the spring sits where at says: the axis through x and y, the base at z, for both ends", async () => {
  await fresh();
  const ids = await run(() => [JS3D.spring({ at: [30, -20, 5], name: "Valve spring" }), JS3D.spring({ at: [-30, 20, 5], ends: "flat" })]);
  const list = await built();
  expect(list.find((b) => b.id === ids[0]).name).toBe("Valve spring");
  for (const [i, id] of ids.entries()) {
    const b = list.find((x) => x.id === id), sx = i ? -30 : 30, sy = i ? 20 : -20;
    expect((b.bbox.min[0] + b.bbox.max[0]) / 2, "x").toBeCloseTo(sx, 1);
    expect((b.bbox.min[1] + b.bbox.max[1]) / 2, "y").toBeCloseTo(sy, 1);
    expect(b.bbox.min[2], "base").toBeCloseTo(5, 1);
    expect(b.bbox.max[2], "top").toBeCloseTo(35, 1);
  }
});

test("flat ends are flat: the lowest and highest vertices lie on one plane each", async () => {
  await fresh();
  const id = await run(() => JS3D.spring({ ends: "flat", at: [0, 0, 0] }));
  await built();
  const v = await run((id) => Array.from(window.__app.scene.views.get(id).data.vertices), id);
  const zs = []; for (let i = 2; i < v.length; i += 3) zs.push(v[i]);
  const lo = Math.min(...zs), hi = Math.max(...zs);
  const onLo = zs.filter((z) => z < lo + 1e-4).length, onHi = zs.filter((z) => z > hi - 1e-4).length;
  expect(onLo).toBeGreaterThanOrEqual(8);
  expect(onHi).toBeGreaterThanOrEqual(8);
  expect(hi - lo).toBeCloseTo(30, 3);
});

test("bad input: each bridge error text, and nothing is added", async () => {
  await fresh();
  const before = await counts();
  const bad = [
    [{ wire: 0.3 }, "wire must be a number from 0.4 to 10 (mm)"],
    [{ wire: "2" }, "wire must be a number from 0.4 to 10 (mm)"],
    [{ outside: 1 }, "outside must be a number from 2 to 200 (mm)"],
    [{ wire: 5, outside: 20 }, "outside must be at least five wire diameters (25 mm for this wire)"],
    [{ freeLength: 0.5 }, "freeLength must be a number from 1 to 300 (mm)"],
    [{ turns: 1.5 }, "turns must be a number from 2 to 10, in steps of a half"],
    [{ turns: 11 }, "turns must be a number from 2 to 10, in steps of a half"],
    [{ turns: 5.3 }, "turns must be a number from 2 to 10, in steps of a half"],
    [{ hand: "up" }, 'hand must be "right" or "left"'],
    [{ ends: "closed" }, 'ends must be "open" or "flat"'],
    [{ color: "red" }, 'color must look like "#rrggbb"'],
    [{ at: [0, 0] }, "at must be [x, y, z] in mm"],
    [{ freeLength: 10, turns: 5 }, "The coils would touch. Increase the free length, use fewer turns, or use thinner wire."],
    [{ wire: 0.4, outside: 20, freeLength: 40, turns: 10 }, "This spring needs too much wire to build. Use fewer turns, a smaller outside diameter or thicker wire."],
    [{ outside: 200, turns: 10, freeLength: 200 }, "This spring needs too much wire to build. Use fewer turns, a smaller outside diameter or thicker wire."],
    [{ freeLength: 10, turns: 5, ends: "flat" }, "The coils would touch. Increase the free length, use fewer turns, or use thinner wire."],
  ];
  for (const [spec, text] of bad) {
    expect(await failure((s) => JS3D.spring(s), spec), JSON.stringify(spec)).toBe(text);
    expect(await counts(), JSON.stringify(spec)).toEqual(before);
  }
});

test("the dialog shows the error, switches ends and hand, and the Beginner button opens it", async () => {
  await fresh();
  await page.click("#bb-spring");
  await expect(page.locator("#cmd")).toContainText("Spring");
  await expect(page.locator("#sp-turns")).toHaveValue("5");
  await field("sp-len", 10);
  await expect(page.locator("#sp-err")).toContainText("The coils would touch");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await field("sp-len", 30);
  await expect(page.locator("#sp-err")).toHaveCount(0);
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await page.locator("#sp-ends button", { hasText: "Flat cut" }).click();
  await page.locator("#sp-hand button", { hasText: "Left" }).click();
  await field("sp-turns", 6);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  expect(list).toHaveLength(1);
  expect(list[0].error).toBeNull();
  near(list[0].volume, formula({ turns: 6, ends: "flat" }).volume, 0.002, "left-hand flat spring");
  const node = (await nodeOf(list[0].id)).node;
  expect([node.left, node.turns, node.mods.length]).toEqual([true, 6, 2]);
});

test("the golden design is flat and open springs, each one solid in a STEP file", async ({}, info) => {
  quarantine(info, ["single-webkit"], "STEP export fails in the single file in WebKit");
  const json = JSON.parse(readFileSync(new URL("./projects/spring.json", import.meta.url), "utf8"));
  await loadDoc(page, json);
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  expect(list).toHaveLength(4);
  const { bytes: step } = await exportBytes(page, "step");
  expect(step.toString("latin1").match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(4);
});
