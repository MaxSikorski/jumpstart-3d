// Fill openings (Pi-lid ranked fix #4): click a flat face, see every opening outlined, keep some open, press Fill, and the part is a
// closed plate. The whole job is done with real clicks on both builds: a generated "mini lid" (60 x 40 x 3 mm plate, six openings, one clip
// standing on it; test/fixtures/lidgen.mjs) and Max's Raspberry Pi lid (examples/pi-lid/raspberry-pi-4-case-lid.stl, committed as a
// reference model). Volumes and "closed" come from the exported STL bytes, not from what the panel says. Only the camera is moved
// by script (as holepattern.spec.mjs does); the group of the lid with a window box uses the bridge to place the box.
import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boot, watchErrors, loadDoc, newDoc, waitIdle, exportBytes } from "./helpers.mjs";
import { miniLid } from "./fixtures/lidgen.mjs";

const LID = fileURLToPath(new URL("../examples/pi-lid/raspberry-pi-4-case-lid.stl", import.meta.url));
const lid = miniLid();
const hole1 = lid.openings.find((o) => o.name === "hole1");
const WAIT = 5000; // the bar: face click to preview, and Fill to finished, each under 5 s

let page, errors, dir, miniFile;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }, info) => {
  dir = mkdtempSync(join(tmpdir(), "fillopen-"));
  miniFile = join(dir, "MiniLid.stl");
  writeFileSync(miniFile, lid.stl);
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); rmSync(dir, { recursive: true, force: true }); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const undoDepth = () => run(() => __store.undoStack.length);
const lastLabel = () => run(() => __store.undoStack.at(-1).label);
const mods = () => run(() => __store.doc.bodies[0].node.mods || []);
const note = (what, ms) => test.info().annotations.push({ type: "timing", description: `${what}: ${ms} ms` });
async function timed(what, fn, limit = WAIT) {
  const t0 = Date.now();
  await fn();
  const ms = Date.now() - t0;
  note(what, ms);
  expect(ms, what + " took " + ms + " ms").toBeLessThan(limit);
}

// the camera only: look at the plate from above (el > 0) or from below (el < 0); everything else is clicks
async function look(el = 1.4, dist = 180) {
  await run(([el, dist]) => { const v = __app.vp; const V = v.camera.position.constructor; __app.needFit = false; v.animateTo({ az: -Math.PI / 2, el, dist, target: new V(0, 0, 0) }, 10); if (v.anim) v.stepAnim(v.anim.t0 + v.anim.ms); v.render(); }, [el, dist]);
}
async function clickAt(x, y, z) {
  const r = await run(([x, y, z]) => { const v = __app.vp; const V = v.camera.position.constructor; const q = v.project(new V(x, y, z)); const b = v.canvas.getBoundingClientRect(); return [b.left + q[0], b.top + q[1]]; }, [x, y, z]);
  await page.mouse.click(r[0], r[1]);
}
// the Import button's own file picker (Beginner)
async function importFile(path) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#bb-import")]);
  await chooser.setFiles(path);
  await page.waitForFunction(() => window.__store.doc.bodies.length > 0, null, { timeout: 60_000 }); // the file is read and repaired before the body appears
  await waitIdle(page);
}
async function fresh(file, mode = "beginner") {
  await loadDoc(page, newDoc("Fill openings " + mode, mode));
  await run(() => { document.getElementById("toasts").replaceChildren(); __app.vp.view.target.set(0, 0, 0); });
  await importFile(file);
  const list = await run(() => JS3D.list());
  expect(list).toHaveLength(1);
  expect(list[0].error).toBeNull();
  return list[0].id;
}
// the kernel's report for the first body, as the panel reads it
const report = () => run(() => { const b = __store.view.bodies[0], r = b._key && __app.kernel.get(b._key); const all = r && r.mesh && r.mesh.fillReports; return all ? Object.values(all).at(-1) : null; });

// what an exported STL says about the part: volume, open edges (used once), edges used three or more times, and separate shells
function stlStats(bytes) {
  const tris = [];
  const n = bytes.readUInt32LE(80);
  if (84 + 50 * n === bytes.length) {
    for (let i = 0; i < n; i++) { const t = []; for (let j = 0; j < 3; j++) t.push([0, 1, 2].map((k) => bytes.readFloatLE(84 + 50 * i + 12 + 12 * j + 4 * k))); tris.push(t); }
  } else {
    const v = [...bytes.toString("latin1").matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
    for (let i = 0; i + 2 < v.length; i += 3) tris.push([v[i], v[i + 1], v[i + 2]]);
  }
  const ids = new Map(), parent = [];
  const id = (p) => { const k = p.map((x) => Math.round(x * 1e3)).join(","); if (!ids.has(k)) { ids.set(k, ids.size); parent.push(ids.size - 1); } return ids.get(k); };
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const edges = new Map();
  let vol = 0;
  for (const t of tris) {
    const [a, b, c] = t.map(id);
    const [A, B, C] = t;
    vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
    if (a === b || b === c || a === c) continue; // a sliver with no area
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = Math.min(p, q) + "_" + Math.max(p, q); edges.set(k, (edges.get(k) || 0) + 1); parent[find(p)] = find(q); }
  }
  const used = [...edges.values()];
  return { tris: tris.length, volume: Math.abs(vol), open: used.filter((c) => c === 1).length, nonManifold: used.filter((c) => c > 2).length, shells: new Set([...ids.values()].map(find)).size };
}
async function exported() { return stlStats((await exportBytes(page, "stl")).bytes); }
function expectClosed(s, why) {
  expect(s.open, why + ": open edges").toBe(0);
  expect(s.nonManifold, why + ": edges shared by 3 or more triangles").toBe(0);
  expect(s.shells, why + ": separate shells").toBe(1);
}
const near = (got, want, tol, what) => expect(Math.abs(got - want) / want, `${what}: ${got} vs ${want}`).toBeLessThan(tol);
const total = () => page.locator("#fo-total");
// what the panel draws on the model: the colour of every outline set (one LineSegments per state: fill blue, kept grey, refused red)
const FILL_BLUE = 0x1f4fa8, KEEP_GREY = 0x8a8f98;
const outlines = () => run(() => { const out = []; __app.vp.world.traverse((o) => { if (o.isLineSegments && o.renderOrder === 13) out.push(o.material.color.getHex()); }); return out.sort((a, b) => a - b); });

test("Beginner: pick the top, keep one hole open, Fill: every other opening is solid and the part is closed (steps 1-5)", async () => {
  const id = await fresh(miniFile);
  await look();
  await page.click("#bb-fillopen");
  await expect(page.locator("#cmd")).toContainText("Fill openings");
  await expect(page.locator(".picklist")).toContainText("Click a flat face with openings in it.");
  await expect(page.locator("#cmd-ok")).toBeDisabled();

  // the top of the plate, away from the openings and the clip
  await timed("face click to preview (mini lid, top)", async () => {
    await clickAt(lid.solidPoint[0], lid.solidPoint[1], lid.plate.t);
    await expect(page.locator(".picklist")).toContainText("· flat face");
    await expect(total()).toContainText("Filling 6 of 6 openings, 3 mm deep", { timeout: WAIT });
  });
  // six outlines, one per opening, in the right places; the clip's footprint is not one of them
  const r = await report();
  expect(r.openings).toHaveLength(6);
  for (const want of lid.openings) {
    const got = r.openings.find((o) => Math.hypot(o.c[0] - want.c[0], o.c[1] - want.c[1]) < 0.3);
    expect(got, want.name + " is in the report").toBeTruthy();
    near(got.a, want.area, 0.01, want.name + " area");
    expect(got.state).toBe("fill");
    expect(got.depth).toBeCloseTo(lid.plate.t, 2);
  }
  const { x0, y0, x1, y1 } = lid.clip;
  expect(r.openings.some((o) => o.loops.some((l) => l.some((p) => p[0] > x0 - 0.01 && p[0] < x1 + 0.01 && p[1] > y0 - 0.01 && p[1] < y1 + 0.01))), "the clip is not outlined").toBe(false);

  await expect.poll(outlines, { message: "all six outlined in the fill colour" }).toEqual([FILL_BLUE]);

  // click inside one round hole: it stays open, the count drops, and Fill waits for the rebuilt report
  await clickAt(hole1.c[0], hole1.c[1], lid.plate.t);
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await expect(total()).toContainText("Filling 5 of 6 openings", { timeout: WAIT });
  await expect.poll(outlines, { message: "the kept hole is grey, the rest blue" }).toEqual([FILL_BLUE, KEEP_GREY]);
  // clicking the face again between the openings changes nothing: the kept hole stays kept
  await clickAt(lid.solidPoint[0], lid.solidPoint[1], lid.plate.t);
  await page.waitForTimeout(600);
  await expect(total()).toContainText("Filling 5 of 6 openings");
  await expect.poll(outlines).toEqual([FILL_BLUE, KEEP_GREY]);
  await expect(page.locator("#cmd-ok")).toHaveText("Fill");
  await expect(page.locator("#cmd-ok")).toBeEnabled();

  const before = await undoDepth();
  await timed("Fill to finished (mini lid, top, 5 of 6)", async () => {
    await page.click("#cmd-ok");
    await expect(page.locator("#cmd")).toBeHidden();
    await waitIdle(page);
  });
  expect(await undoDepth()).toBe(before + 1);
  expect(await lastLabel()).toBe("Fill openings (5)");
  const m = (await mods()).at(-1);
  expect(m.t).toBe("fillopen");
  expect(m.keep).toHaveLength(1);
  expect(Math.hypot(m.keep[0].c[0] - hole1.c[0], m.keep[0].c[1] - hole1.c[1])).toBeLessThan(0.3);
  expect((await run(() => JS3D.list()))[0].error).toBeNull();

  // the Beginner panel of the body
  await run((id) => JS3D.select([id]), id);
  await expect(page.locator("#insp-fillopen")).toContainText("Openings filled: 5");

  // the exported STL: closed, one shell, plate + clip minus one Ø5 hole
  const s = await exported();
  expectClosed(s, "mini lid, top, one hole kept");
  near(s.volume, lid.volumeFilled - hole1.area * lid.plate.t, 0.001, "volume");
});

test("Pro: the ribbon has Fill openings in Modify; double-click the timeline entry, fill the kept hole too (step 7)", async () => {
  // continues with the design of the test above (one hole kept)
  await page.click("#mode-advanced");
  await expect(page.locator("#ad-fillopen")).toBeVisible();
  await expect(page.locator("#ad-fillopen")).toContainText("Fill openings");
  await page.click("#ad-fillopen");
  await expect(page.locator("#cmd")).toContainText("Fill openings");
  await expect(page.locator(".picklist")).toContainText("Click a flat face with openings in it.");
  await page.locator("#cmd .xbtn").click(); // close without a pick
  await expect(page.locator("#cmd")).toBeHidden();

  await look();
  const before = await undoDepth();
  await page.locator('.tl-item[aria-label^="Fill openings"]').dblclick();
  await expect(page.locator("#cmd")).toContainText("Edit Fill openings");
  await expect(total()).toContainText("Filling 5 of 6 openings", { timeout: WAIT });
  await expect(page.locator("#cmd-ok")).toBeDisabled(); // nothing changed yet
  await clickAt(hole1.c[0], hole1.c[1], lid.plate.t);
  await expect(total()).toContainText("Filling 6 of 6 openings", { timeout: WAIT });
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  expect(await undoDepth()).toBe(before + 1);
  const all = await mods();
  expect(all.filter((m) => m.t === "fillopen")).toHaveLength(1); // edited, not added
  expect(all.at(-1).keep).toEqual([]);
  expect((await report()).filled).toBe(6);
  const s = await exported();
  expectClosed(s, "mini lid, all six filled");
  near(s.volume, lid.volumeFilled, 0.001, "volume");
});

test("Beginner: the underside gives the same answer (step 6)", async () => {
  await fresh(miniFile);
  await look(-1.4);
  await page.click("#bb-fillopen");
  await timed("face click to preview (mini lid, underside)", async () => {
    await clickAt(lid.solidPoint[0], lid.solidPoint[1], 0);
    await expect(page.locator(".picklist")).toContainText("· flat face");
    await expect(total()).toContainText("Filling 6 of 6 openings", { timeout: WAIT });
  });
  await timed("Fill to finished (mini lid, underside)", async () => {
    await page.click("#cmd-ok");
    await expect(page.locator("#cmd")).toBeHidden();
    await waitIdle(page);
  });
  expect((await run(() => JS3D.list()))[0].error).toBeNull();
  const s = await exported();
  expectClosed(s, "mini lid, underside");
  near(s.volume, lid.volumeFilled, 0.001, "volume");

  // the Beginner panel's Remove takes the fill away again, in one undo step
  const id = await run(() => JS3D.list()[0].id);
  await run((id) => JS3D.select([id]), id);
  await expect(page.locator("#insp-fillopen")).toContainText("Openings filled: 6");
  const before = await undoDepth();
  await page.locator("#insp-fillopen .xbtn").click();
  await waitIdle(page);
  expect((await mods()).filter((m) => m.t === "fillopen")).toEqual([]);
  expect(await undoDepth()).toBe(before + 1);
  expect(await lastLabel()).toBe("Remove filled openings");
  await run(() => JS3D.undo());
  expect((await mods()).filter((m) => m.t === "fillopen")).toHaveLength(1);
});

test("a flat face with no openings says so, and Fill stays off", async () => {
  await fresh(miniFile);
  await look();
  await page.click("#bb-fillopen");
  // the clip's top is a flat face with no openings in it
  await clickAt((lid.clip.x0 + lid.clip.x1) / 2, (lid.clip.y0 + lid.clip.y1) / 2, lid.plate.t + lid.clip.h);
  await expect(total()).toHaveText("No openings in this face.", { timeout: WAIT });
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await page.locator("#cmd .xbtn").click();
  await expect(page.locator("#cmd")).toBeHidden();
  expect((await mods()).filter((m) => m.t === "fillopen")).toEqual([]);
});

test("Fill all and Keep all open do every opening at once", async () => {
  await fresh(miniFile);
  await look();
  await page.click("#bb-fillopen");
  await clickAt(lid.solidPoint[0], lid.solidPoint[1], lid.plate.t);
  await expect(total()).toContainText("Filling 6 of 6 openings", { timeout: WAIT });
  await page.click("#fo-none");
  await expect(total()).toContainText("Filling 0 of 6 openings", { timeout: WAIT });
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await page.click("#fo-all");
  await expect(total()).toContainText("Filling 6 of 6 openings", { timeout: WAIT });
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await page.locator("#cmd .xbtn").click();
  await expect(page.locator("#cmd")).toBeHidden();
  // cancelled: no feature and no preview left behind
  expect((await mods()).filter((m) => m.t === "fillopen")).toEqual([]);
  expect(await run(() => __store.preview)).toBeNull();
  await waitIdle(page);
  expect((await run(() => JS3D.list()))[0].error).toBeNull();
});

test("Max's Pi lid: all 25 openings filled in a minute of clicks, then the 38 x 38 mm window (step 8)", async () => {
  test.setTimeout(240_000);
  const lidId = await fresh(LID);
  await look(1.4, 220);

  // a point on the lid's top plate: the middle of the biggest triangle lying at z = 3
  const stl = readFileSync(LID), n = stl.readUInt32LE(80);
  let best = null;
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2].map((j) => [0, 1, 2].map((k) => stl.readFloatLE(84 + 50 * i + 12 + 12 * j + 4 * k)));
    if (!p.every((q) => Math.abs(q[2] - 3) < 0.01)) continue;
    const area = Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2;
    if (!best || area > best.area) best = { area, c: [0, 1].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3) };
  }
  expect(best, "a triangle of the lid's top face").toBeTruthy();

  await page.click("#bb-fillopen");
  await timed("face click to preview (Pi lid)", async () => {
    await clickAt(best.c[0], best.c[1], 3);
    await expect(total()).toContainText("Filling 25 of 25 openings", { timeout: WAIT });
  });
  await timed("Fill to finished (Pi lid)", async () => {
    await page.click("#cmd-ok");
    await expect(page.locator("#cmd")).toBeHidden();
    await waitIdle(page);
  });
  expect((await run(() => JS3D.list()))[0].error).toBeNull();
  const filled = await exported();
  expectClosed(filled, "Pi lid, 25 openings filled");
  near(filled.volume, 18259.7, 0.001, "filled lid volume");
  test.info().annotations.push({ type: "volume", description: `filled lid ${filled.volume.toFixed(1)} mm3` });

  // the 38 x 38 x 5 mm window, then Group (the lid is one closed solid, so the cut is ordinary)
  const boxId = await run(() => JS3D.add("box", { size: { w: 38, d: 38, h: 5 }, at: [-7.3, 0, -1], hole: true }));
  await run((ids) => JS3D.select(ids), [lidId, boxId]);
  // the window cut is the existing Group, not this feature: the design's 5 s bar covers the face click and Fill only
  await timed("Group (the window cut)", async () => {
    await page.click("#bb-group");
    await waitIdle(page);
  }, 30_000);
  const list = await run(() => JS3D.list());
  expect(list).toHaveLength(1);
  expect(list[0].error).toBeNull();
  await run(() => JS3D.select([]));
  const cut = await exported();
  expectClosed(cut, "Pi lid with the window");
  near(cut.volume, 13930, 0.005, "volume after the window (Orca slices Max's own result at about 13,930)");
  test.info().annotations.push({ type: "volume", description: `lid with window ${cut.volume.toFixed(1)} mm3` });
});
