import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, waitIdle } from "./helpers.mjs";

function linesByLayer(text) {
  const parts = text.trim().split(/\r?\n/), entities = []; let current;
  for (let i = 0; i < parts.length; i += 2) {
    const code = +parts[i], value = parts[i + 1];
    if (code === 0) { current = { type: value }; entities.push(current); }
    else if (current) current[code] = value;
  }
  return (layer) => {
    const lines = entities.filter((e) => e.type === "LINE" && e[8] === layer), xs = [], ys = [];
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const e of lines) { xs.push(+e[10], +e[11]); ys.push(+e[20], +e[21]); }
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };
}
async function download(page) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.click("#bd-export")]);
  const chunks = []; for await (const chunk of await dl.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
for (const inches of [false, true]) test(`body drawing ${inches ? "in inches with sizes" : "in millimetres"}`, async ({ browser }, info) => {
  const page = await browser.newPage(), errors = watchErrors(page);
  try {
    await boot(page, info);
    await page.evaluate(() => { try { localStorage.removeItem("jumpstart.bodyDrawing"); } catch (e) {} });
    await loadDoc(page, newDoc("Drawing", "beginner"));
    await page.evaluate(() => window.JS3D.add("box", { size: { w: 40, d: 30, h: 20 } }));
    await waitIdle(page);
    await page.click("#btn-export"); await page.click('[data-act="bodydxf"]');
    await expect(page.locator("#body-drawing")).toBeVisible();
    for (const name of ["top", "front", "right"]) await expect(page.locator("#bd-" + name)).toBeChecked();
    if (inches) { await page.selectOption("#bd-units", "in"); await page.check("#bd-dims"); }
    const text = await download(page), box = linesByLayer(text), factor = inches ? 1 / 25.4 : 1;
    for (const [layer, w, h] of [["TOP", 40, 30], ["FRONT", 40, 20], ["RIGHT", 30, 20]]) {
      const [width, height] = box(layer); expect(Math.abs(width - w * factor)).toBeLessThan(0.01); expect(Math.abs(height - h * factor)).toBeLessThan(0.01);
    }
    expect(text).toContain(`$INSUNITS\r\n70\r\n${inches ? 1 : 4}\r\n`);
    if (inches) expect(text).toContain('1.575"');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
