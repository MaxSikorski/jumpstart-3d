// Fillet and Chamfer (GitHub #239): a click on a body that picks no edge says why, once every 3 seconds; a real edge still lights up and is picked.
// The no-pick cases are real ones: a locked body, a hole, a body whose last change did not build, and a smooth imported mesh (no sharp edge anywhere).
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim, waitIdle } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await boot(page, info);
  // count the toasts as they appear (they leave the page after 2.6 s) and remember when the last one came
  await page.evaluate(() => {
    window.__toastsSeen = []; window.__lastToastAt = -1e9;
    new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.classList && n.classList.contains("toast")) { window.__toastsSeen.push(n.textContent); window.__lastToastAt = performance.now(); } }).observe(document.getElementById("toasts"), { childList: true });
  });
});
test.afterAll(async () => { await page?.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const seen = () => page.evaluate(() => window.__toastsSeen.slice());
const canvas = () => page.locator("canvas.vp-canvas");

// open the Fillet tool on the loaded design, looking at it from the front and above; the hint's 3 s limit has run out
async function openFillet(key = "f", name = "Fillet") {
  await page.evaluate(() => {
    const v = window.__app.vp, V = v.camera.position.constructor;
    v.animateTo({ az: -Math.PI / 2 + 0.5, el: 0.5, dist: 110, target: new V(0, 0, 10) }, 10);
  });
  await page.waitForFunction(() => !window.__app.vp.anim);
  await page.keyboard.press(key);
  await expect(page.locator("#cmd")).toContainText(name);
  await page.waitForFunction(() => performance.now() - window.__lastToastAt > 3100);
  await page.evaluate(() => { window.__toastsSeen = []; document.getElementById("toasts").replaceChildren(); });
}
async function openShape(kind, extra = {}, mods = []) {
  await loadDoc(page, newDoc("Edge hint", "advanced", { bodies: [body("b1", "Shape", prim(kind, { w: 20, d: 20, h: 20, r: 0, c: 0 }, mods), undefined, extra)] }));
  await openFillet();
}
async function point(p) {
  return page.evaluate((p) => {
    const v = window.__app.vp, V = v.camera.position.constructor, q = v.project(new V(...p)), r = v.canvas.getBoundingClientRect();
    return [r.left + q[0], r.top + q[1]];
  }, p);
}
const pickedSets = () => page.locator("#cmd .edge-set.on .nm").innerText();

test("a box edge lights up under the pointer and is picked, with no toast", async () => {
  await openShape("box");
  const [x, y] = await point([0, -10, 20]);
  await page.mouse.move(x, y);
  await expect(canvas()).toHaveCSS("cursor", "pointer");
  await expect.poll(() => page.evaluate(() => {
    let n = 0;
    window.__app.vp.world.traverse((o) => { if (o.renderOrder === 15) n++; });
    return n;
  })).toBeGreaterThan(0);
  await page.mouse.click(x, y);
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await expect(page.locator("#cmd .edge-set.on")).toContainText("1 edge");
  expect(await seen()).toEqual([]);
});

test("empty space gives no toast", async () => {
  await openShape("box");
  const [x, y] = await point([40, -10, 10]);
  await page.mouse.click(x, y);
  await page.mouse.click(x, y);
  expect(await seen()).toEqual([]);
  await expect(page.locator("#cmd .edge-set.on")).toContainText("No edges");
});

test("a locked body says it is locked; a second click inside 3 seconds says nothing, a click after that does", async () => {
  await openShape("box", { locked: true });
  const [x, y] = await point([0, -10, 10]);
  await page.mouse.click(x, y);
  await expect.poll(seen).toEqual([expect.stringMatching(/^This body is locked\. Unlock it to change its edges \(.+L\)\.$/)]);
  await page.mouse.click(x, y);
  await page.mouse.click(x, y);
  expect(await seen(), "limited to one toast per 3 seconds").toHaveLength(1);
  await expect(page.locator("#cmd .edge-set.on")).toContainText("No edges");
  await page.waitForFunction(() => performance.now() - window.__lastToastAt > 3100);
  await page.mouse.click(x, y);
  await expect.poll(async () => (await seen()).length).toBe(2);
});

test("a click on a cylinder's curved side picks its two drawn circles (not the hidden seam), with no toast and no error", async () => {
  await openShape("cylinder");
  const [x, y] = await point([0, -10, 10]);
  await page.mouse.click(x, y);
  await expect(page.locator("#cmd .edge-set.on")).toContainText("2 edges");
  expect(await seen()).toEqual([]);
});

test("a hole is not a body to round: it says so", async () => {
  await openShape("box", { hole: true });
  const [x, y] = await point([0, -10, 10]);
  await page.mouse.click(x, y);
  await expect.poll(seen).toEqual(["A hole has no edges to round. Click a solid body."]);
});

test("Chamfer words the same hint for a chamfer", async () => {
  await loadDoc(page, newDoc("Edge hint", "advanced", { bodies: [body("b1", "Shape", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }), undefined, { hole: true })] }));
  await openFillet("Shift+C", "Chamfer");
  const [x, y] = await point([0, -10, 10]);
  await page.mouse.click(x, y);
  await expect.poll(seen).toEqual(["A hole has no edges to chamfer. Click a solid body."]);
});

test("a body whose last change did not build says so", async () => {
  await openShape("box"); // the box is built and drawn; the tool is closed again before the change that cannot build
  await page.keyboard.press("Escape");
  const edge = { a: [-10, -10, 0], b: [10, -10, 0], m: [0, -10, 0], t: "LINE" };
  await page.evaluate((edge) => { // same body id: the old drawing stays on screen while the build reports its error
    const d = JSON.parse(JSON.stringify(window.__store.doc));
    d.bodies[0].node.mods = [{ id: "f1", seq: 1, t: "fillet", edges: [edge], r: 500 }];
    window.__store.load(d);
  }, edge);
  await waitIdle(page);
  expect(await page.evaluate(() => window.__app.scene.errors.get("b1"))).toContain("too large");
  await openFillet();
  const [x, y] = await point([0, -10, 10]);
  await page.mouse.click(x, y);
  await expect.poll(seen).toEqual(["This body didn't build, so its edges can't be picked. Undo or fix its last change."]);
});

// a closed STL with 320 small flat triangles (a ball): the mesh builder keeps an edge only where two faces bend by more than 25 degrees, so it has none
function stlBall() {
  const p = (1 + Math.sqrt(5)) / 2, R = 15;
  const unit = (a) => { const l = Math.hypot(...a); return a.map((x) => (x / l) * R); };
  const v = [[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]].map(unit);
  let t = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < 2; s++) {
    const cache = new Map(), next = [];
    const mid = (a, b) => { const k = a < b ? a + "_" + b : b + "_" + a; if (!cache.has(k)) { v.push(unit(v[a].map((x, i) => x + v[b][i]))); cache.set(k, v.length - 1); } return cache.get(k); };
    for (const [a, b, c] of t) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    t = next;
  }
  const facets = t.map((tr) => `facet normal 0 0 0\nouter loop\n${tr.map((i) => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`);
  return Buffer.from(`solid ball\n${facets.join("\n")}\nendsolid ball\n`);
}

test("a smooth imported mesh has no edge to pick and says so", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, newDoc("Edge hint mesh", "beginner"));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#bb-import")]);
  await chooser.setFiles({ name: "ball.stl", mimeType: "model/stl", buffer: stlBall() });
  await expect.poll(() => page.evaluate(() => window.__store.doc.bodies.length), { timeout: 120_000 }).toBe(1);
  await waitIdle(page, 120_000);
  await page.evaluate(() => { window.__app.setMode("advanced", true); window.__app.select([]); });
  await openFillet();
  const drawn = await page.evaluate(() => { const v = [...window.__app.scene.views.values()][0]; return v.data.edgeGroups.filter(([, c]) => c > 0).length; });
  expect(drawn, "a ball made of flat triangles draws no edge").toBe(0);
  // (this click used to throw in arrowAnchor: the ball's hidden edges were picked; afterEach checks the page stays quiet)
  // somewhere on the ball (the first point that is on it)
  const [cx, cy] = await point([0, 0, 0]);
  for (const [dx, dy] of [[0, 0], [25, 10], [-25, 10], [10, -30], [-40, 0], [40, 0]]) {
    await page.mouse.click(cx + dx, cy + dy);
    if ((await seen()).length) break;
  }
  await expect.poll(seen).toEqual(["No edge to round here: smooth surfaces and joins have none. Click a sharp edge."]);
  await expect(page.locator("#cmd .edge-set.on")).toContainText("No edges");
});
