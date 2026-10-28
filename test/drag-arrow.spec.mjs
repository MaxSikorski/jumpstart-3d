// jumpstart-3d: visible pull handles, real mouse drags and committed geometry on both builds.
import { test, expect } from "@playwright/test";
import { THEMES } from "../src/theme.js";
import { boot, watchErrors, loadDoc, waitIdle, newDoc, body, prim, bodies } from "./helpers.mjs";

let page, errors;
test.beforeEach(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async ({}, info) => {
  if (info.status !== "passed") await page.screenshot({ path: info.outputPath("failed.png") }).catch(() => {});
  await page.close();
  expect(errors, "console or page errors").toEqual([]);
});
const settle = async () => { for (let ok = 0; ok < 2;) { await page.waitForTimeout(200); ok = await page.evaluate(() => !window.__app.vp.isMoving()) ? ok + 1 : 0; } };
const box = () => body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }));
function square(onBody = false) {
  return { id: "s1", name: "Square", seq: 2, hidden: false, ...(onBody ? { onBody: "b1" } : {}),
    plane: { o: [0, 0, onBody ? 20 : 0], x: [1, 0, 0], n: [0, 0, 1] },
    pts: [[-10, -10], [10, -10], [10, 10], [-10, 10]].map(([x, y], i) => ({ id: `p${i}`, x, y })),
    ents: [0, 1, 2, 3].map((i) => ({ id: `e${i}`, t: "line", a: `p${i}`, b: `p${(i + 1) % 4}` })), cons: [] };
}
async function open(mode = "advanced", theme = "light", onBody = false) {
  await loadDoc(page, newDoc("Pull arrow", mode, { sketches: [square(onBody)], bodies: onBody ? [box()] : [] }));
  await page.evaluate((theme) => { const a = window.__app; a.setTheme(theme); a.vp.fit(a.scene.allBox()); }, theme);
  await settle();
  // quickExtrude forwards sketch options only while a sketch is active.
  await page.evaluate(() => window.__app.enterSketch("s1"));
  await settle();
  await page.evaluate(() => window.__app.quickExtrude({ sketch: "s1" }));
  await settle();
  // Side-on makes the requested axial pixel lengths measurable without foreshortening.
  await page.evaluate(() => window.__app.vp.setView("front"));
  await settle();
  await expect(page.locator("#ex-dist")).toBeVisible();
}
async function arrow() {
  return page.evaluate(() => {
    const { vp, command } = window.__app, a = command.arrow, r = vp.canvas.getBoundingClientRect();
    const client = (p) => { const s = vp.project(p); return { x: s[0] + r.left, y: s[1] + r.top }; };
    const h = a.headCore;
    const end = (y) => client(a.head.clone().addScaledVector(a.n, y * h.scale.y));
    return { origin: client(a.origin), tip: client(a.tip), head: client(a.head), ends: [end(-1.3), end(1.3)],
      color: a.color, colors: a.colors, outline: a.outlineColor, coneColor: h.material.color.getHex(), shaftLinear: a.core.material.uniforms.uC.value,
      widths: [a.core.material.uniforms.uW.value, a.outline.material.uniforms.uW.value] };
  });
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
async function drag(pixels, start = "shaft") {
  await settle();
  const a = await arrow(), dx = a.head.x - a.origin.x, dy = a.head.y - a.origin.y, d = Math.hypot(dx, dy);
  const p = start === "head" ? a.head : { x: a.origin.x + 30 * dx / d, y: a.origin.y + 30 * dy / d };
  if (start === "shaft") expect(distance(p, a.head)).toBeGreaterThan(36);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator("canvas.vp-canvas")).toHaveCSS("cursor", "grab");
  await page.mouse.down();
  await page.mouse.move(p.x + pixels * dx / d, p.y + pixels * dy / d, { steps: 12 });
}
function luminance(hex) {
  const rgb = [16, 8, 0].map((shift) => ((hex >> shift) & 255) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test("Advanced: distance zero has a visible handle beyond the profile", async () => {
  await open();
  expect(Number(await page.locator("#ex-dist").inputValue())).toBe(0);
  const a = await arrow();
  expect(distance(a.head, a.origin)).toBeGreaterThanOrEqual(60);
  expect(a.widths).toEqual([8, 13]);
});

for (const mode of ["beginner", "advanced"]) test(`${mode}: shaft hover and drag extrude a real solid`, async () => {
  await open(mode);
  const before = Number(await page.locator("#ex-dist").inputValue());
  await drag(80);
  expect((await arrow()).color).toBe(0xb45309);
  expect((await arrow()).coneColor).toBe(0xb45309);
  await page.mouse.up();
  const dist = Number(await page.locator("#ex-dist").inputValue());
  expect(dist).toBeGreaterThan(before + 1);
  await page.mouse.move(5, 5);
  await expect.poll(async () => (await arrow()).color).toBe(0x1d4ed8);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !window.__app.command);
  await waitIdle(page);
  const result = await bodies(page);
  expect(result).toHaveLength(1);
  expect(result[0].error).toBeNull();
  expect(Math.abs(result[0].volume - 400 * dist)).toBeLessThan(400 * dist * 0.01);
});

for (const theme of ["light", "dark"]) test(`${theme}: constant screen size and contrast at two zooms`, async ({}, info) => {
  await open("advanced", theme);
  const measurements = [];
  for (let zoom = 0; zoom < 2; zoom++) {
    if (zoom) {
      await page.evaluate(() => { const vp = window.__app.vp; vp.view.dist *= 3; vp.request(); });
      await settle();
    }
    const a = await arrow(), bg = parseInt(THEMES[theme].bg.slice(1), 16), wp = parseInt(THEMES[theme].wp.bg.slice(1), 16);
    expect(a.color).toBe(theme === "light" ? 0x1d4ed8 : 0x6ea8ff);
    expect(a.coneColor).toBe(a.color);
    const rgb = [16, 8, 0].map((shift) => ((a.color >> shift) & 255) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    a.shaftLinear.forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 6));
    const ratios = { coreBackground: contrast(a.color, bg), coreWorkplane: contrast(a.color, wp),
      hoverBackground: contrast(a.colors.hover, bg), hoverWorkplane: contrast(a.colors.hover, wp),
      cutBackground: contrast(a.colors.cut, bg), cutWorkplane: contrast(a.colors.cut, wp), coreOutline: contrast(a.color, a.outline) };
    for (const [name, ratio] of Object.entries(ratios)) expect(ratio, name).toBeGreaterThanOrEqual(3);
    let pixel;
    if (!zoom) {
      // At 60% the shaft is clear of the profile outline and the arrowhead.
      const p = { x: a.origin.x + 0.6 * (a.head.x - a.origin.x), y: a.origin.y + 0.6 * (a.head.y - a.origin.y) };
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const png = await page.screenshot({ clip: { x: Math.round(p.x) - 1, y: Math.round(p.y) - 1, width: 3, height: 3 }, scale: "css" });
      pixel = await page.evaluate(async (base64) => {
        const img = new Image();
        img.src = "data:image/png;base64," + base64;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(1, 1, 1, 1).data).slice(0, 3);
      }, png.toString("base64"));
      [16, 8, 0].forEach((shift, i) => expect(Math.abs(pixel[i] - ((a.color >> shift) & 255)), "rendered RGB channel " + i).toBeLessThanOrEqual(24));
    }
    const size = distance(...a.ends), handle = distance(a.head, a.tip);
    expect(size).toBeGreaterThanOrEqual(30);
    measurements.push({ size, handle, ...ratios, outlineBackground: contrast(a.outline, bg), pixel });
  }
  expect(Math.abs(measurements[1].size - measurements[0].size)).toBeLessThanOrEqual(2);
  expect(Math.abs(measurements[1].handle - measurements[0].handle)).toBeLessThanOrEqual(2);
  await info.attach("size-and-contrast", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
});

test("Dark: pulling into the sketch's body turns the arrow cut red", async () => {
  await open("advanced", "dark", true);
  expect((await arrow()).color).toBe(0x6ea8ff);
  await page.locator("#ex-dist").fill("-5");
  await page.locator("#ex-dist").press("Tab");
  await expect.poll(async () => (await arrow()).color).toBe(0xff6b6e);
  expect((await arrow()).coneColor).toBe(0xff6b6e);
  await expect(page.locator("#ex-hint")).toContainText("cut");
});

test("Offset face: head grab corridor and a 60 px drag change the offset", async () => {
  await loadDoc(page, newDoc("Offset arrow", "advanced", { bodies: [box()] }));
  await page.evaluate(() => { const a = window.__app; a.vp.fit(a.scene.allBox()); });
  await settle();
  await page.locator("#ad-offset").click();
  const p = await page.evaluate(() => {
    const { vp } = window.__app, r = vp.canvas.getBoundingClientRect();
    const s = vp.project(vp.view.target.clone().set(0, 0, 20));
    return { x: r.left + s[0], y: r.top + s[1] };
  });
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => !!window.__app.command.arrow);
  await settle();
  const a = await arrow(), dx = a.head.x - a.origin.x, dy = a.head.y - a.origin.y, d = Math.hypot(dx, dy);
  await page.mouse.move(a.head.x - dy / d * 30, a.head.y + dx / d * 30);
  await expect(page.locator("canvas.vp-canvas")).toHaveCSS("cursor", "grab");
  const before = Number(await page.locator("#of-d").inputValue());
  await drag(60, "head");
  await page.mouse.up();
  expect(Number(await page.locator("#of-d").inputValue())).toBeGreaterThan(before);
});
