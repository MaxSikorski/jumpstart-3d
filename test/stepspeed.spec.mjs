// Run on site and single projects. Real worker, actual import entry point; no mocked build stages.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, newDoc, exportBytes } from "./helpers.mjs";
import { readStl, meshReport, readThreeMf } from "./fuzz-checks.mjs";
const fixture = name => Array.from(readFileSync(new URL("./fixtures/" + name, import.meta.url)));
const cube = fixture("judge/cube.step");
async function observe(page) {
  await page.evaluate(() => {
    window.stepObservations = [];
    window.stepStages = [];
    const kernel = window.__app.kernel, progress = kernel.onBuildProgress;
    kernel.onBuildProgress = event => {
      window.stepStages.push(event.stage);
      progress(event);
    };
    window.stepStarted = performance.now();
    window.stepObserver?.disconnect();
    window.stepObserver = new MutationObserver(() => {
      const p = document.getElementById("step-progress");
      for (const row of p.children) {
        const bar = row.querySelector("progress");
        window.stepObservations.push({ token: row.dataset.session, stage: row.dataset.stage, visible: !p.hidden && row.getBoundingClientRect().height > 0, text: row.textContent, value: bar.value, max: bar.max, busy: document.getElementById("busy").hidden, at: performance.now() });
      }
    });
    window.stepObserver.observe(document.getElementById("step-progress"), { childList: true, subtree: true, attributes: true, characterData: true });
  });
}
async function importFile(page, name, bytes) {
  await page.evaluate(([name, bytes]) => window.__app.advanced.importModel({ name }, new Uint8Array(bytes)), [name, bytes]);
}
async function settled(page, n = 1, hidden = false) {
  await page.waitForFunction(n => {
    const a = window.__app, bs = window.__store.doc.bodies;
    return bs.length === n && !a.kernel.inflight && !a.kernel.queue.size && bs.every(b => {
      const v = a.scene.views.get(b.id);
      return v?.data && !v.pending && v.key === b._key && !a.scene.errors.has(b.id);
    });
  }, n, { timeout: 30000 });
  await expect(page.locator("#step-progress")).toBeHidden();
  if (!hidden)
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
}
for (const mode of ["advanced"])
  test.describe(mode, () => {
    let page, errors;
    test.beforeEach(async ({ browser }, info) => {
      page = await browser.newPage();
      errors = watchErrors(page);
      await boot(page, info);
      await loadDoc(page, newDoc("STEP speed", mode));
      await page.evaluate(() => window.__app.setMeshDetail("normal", true, true));
    });
    test.afterEach(async () => {
      expect(errors).toEqual([]);
      await page.close();
    });
    test("cold real stages, completed-stage bar and rendered completion", async () => {
      await observe(page);
      await importFile(page, "Cube.step", [...cube, 32]);
      await settled(page);
      const obs = await page.evaluate(() => window.stepObservations);
      const unique = await page.evaluate(() => window.stepStages);
      expect(unique).toEqual(["reading", "building", "meshing", "sending"]);
      for (const x of obs) {
        expect(x.max).toBe(4);
        expect(x.value).toBe(({ waiting: 0, reading: 0, building: 1, meshing: 2, sending: 3 })[x.stage]);
      }
      const building = obs.filter(x => x.stage === "building");
      expect(building.length).toBeGreaterThan(0);
      for (const row of building)
        expect(row.busy).toBe(true);
      expect(await page.evaluate(() => window.__app.stepProgress.sessions.size)).toBe(0);
      console.log("rendered cold STEP ms", await page.evaluate(() => performance.now() - window.stepStarted));
    });
    test("parts handoff survives first part and cleans up only after all current meshes", async () => {
      await observe(page);
      await page.evaluate(() => {
        const vp = window.__app.vp;
        window.stepOriginalFit = vp.fit;
        window.stepOriginalProject = vp.project;
        window.stepFrameCalls = 0;
        // Force the off-screen branch so each framing check calls fit.
        vp.project = () => [-1, -1, 0];
        vp.fit = function (...args) {
          window.stepFrameCalls++;
          return window.stepOriginalFit.apply(this, args);
        };
      });
      try {
        await importFile(page, "Assembly.step", fixture("step-assembly-3-parts.step"));
        await settled(page, 3);
        const obs = await page.evaluate(() => window.stepObservations);
        expect(new Set(obs.map(x => x.token)).size).toBe(1);
        const parts = obs.filter(x => x.stage === "parts");
        expect(parts.length).toBeGreaterThan(0);
        for (const ready of [1, 2]) {
          expect(parts.some(x => x.visible && x.value === ready && x.max === 3 && x.text.includes(`${ready} of 3 parts ready`))).toBe(true);
        }
        const calls = await page.evaluate(() => window.stepFrameCalls);
        expect(calls).toBeGreaterThan(0);
        expect(calls).toBeLessThanOrEqual(2);
        await page.evaluate(() => window.__app.undo());
        await expect(page.locator("#step-progress")).toBeHidden();
      } finally {
        await page.evaluate(() => {
          const vp = window.__app.vp;
          vp.fit = window.stepOriginalFit;
          vp.project = window.stepOriginalProject;
          delete window.stepOriginalFit;
          delete window.stepOriginalProject;
        });
      }
    });
    test("hidden document completes a built STEP without a deadline toast", async () => {
      await page.evaluate(() => {
        window.stepVisibilityDescriptors = ["hidden", "visibilityState"].map(key => Object.getOwnPropertyDescriptor(document, key));
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        const app = window.__app;
        window.stepOriginalToast = app.toast;
        window.stepHiddenToasts = [];
        app.toast = function (...args) {
          window.stepHiddenToasts.push(String(args[0]));
          return window.stepOriginalToast.apply(this, args);
        };
      });
      try {
        await importFile(page, "Hidden.step", cube);
        await settled(page, 1, true);
        expect(await page.evaluate(() => window.__app.stepProgress.sessions.size)).toBe(0);
        expect(await page.evaluate(() => window.stepHiddenToasts.some(text => text.includes("still loading after 3 minutes")))).toBe(false);
      } finally {
        await page.evaluate(() => {
          ["hidden", "visibilityState"].forEach((key, i) => {
            const descriptor = window.stepVisibilityDescriptors[i];
            if (descriptor)
              Object.defineProperty(document, key, descriptor);
            else
              delete document[key];
          });
          window.__app.toast = window.stepOriginalToast;
          delete window.stepOriginalToast;
          delete window.stepVisibilityDescriptors;
        });
      }
    });
    test("malformed input, Undo, document replacement and replacement import leave no sessions", async () => {
      await importFile(page, "Broken.step", [1, 2, 3]);
      await expect(page.locator("#step-progress")).toBeHidden({ timeout: 30000 });
      await loadDoc(page, newDoc("Undo", mode));
      await importFile(page, "Undo.step", [...cube, 32, 32]);
      await page.evaluate(() => window.__app.undo());
      await expect(page.locator("#step-progress")).toBeHidden();
      await importFile(page, "Replaced.step", [...cube, 32, 32, 32]);
      await loadDoc(page, newDoc("Replacement", mode));
      await expect(page.locator("#step-progress")).toBeHidden();
      await importFile(page, "New.step", fixture("judge/cube.step"));
      await settled(page);
      expect(await page.evaluate(() => window.__app.stepProgress.sessions.size)).toBe(0);
    });
    test("watchdog wording uses detail limit and restart can import again", async () => {
      await page.evaluate(() => {
        const a = window.__app;
        a.setMeshDetail("fine", true, true);
        a.kernel.watchdogMs = 1;
      });
      await importFile(page, "Stopped.step", [...cube, 32, 32, 32, 32]);
      await expect(page.locator("#toasts")).toContainText("building it took longer than 4 minutes, so it was stopped. Last stage:", { timeout: 30000 });
      await expect(page.locator("#step-progress")).toBeHidden();
      await page.evaluate(() => {
        delete window.__app.kernel.watchdogMs;
        window.__app.setMeshDetail("normal", true, true);
      });
      await page.waitForFunction(() => window.__app.kernel.ready);
      await loadDoc(page, newDoc("Restart", mode));
      await importFile(page, "Small.step", fixture("judge/cube.step"));
      await settled(page);
    });
    test("375px panel wraps long filenames in every theme without animation", async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.evaluate(() => window.layoutSession = window.__app.stepProgress.start("Very long original filename ".repeat(8) + ".step"));
      for (const theme of ["light", "dark", "contrast"]) {
        await page.evaluate(theme => window.__app.setTheme(theme), theme);
        const row = page.locator("#step-progress");
        await expect(row).toBeVisible();
        const box = await row.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(375);
        expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(await row.evaluate(el => {
          const panel = el.getBoundingClientRect();
          return [...document.querySelectorAll(".timeline, .panel-tab.bottom")].every(other => {
            const r = other.getBoundingClientRect();
            return !r.width || !r.height || panel.bottom <= r.top || panel.top >= r.bottom || panel.right <= r.left || panel.left >= r.right;
          });
        })).toBe(true);
      }
      await page.evaluate(() => window.__app.stepProgress.finish(window.layoutSession));
    });
    test("Normal exports stay closed with matching volume", async () => {
      await importFile(page, "Export.step", cube);
      await settled(page);
      const stl = meshReport(readStl((await exportBytes(page, "stl")).bytes));
      const mf = readThreeMf((await exportBytes(page, "3mf")).bytes);
      expect(stl.open).toBe(0);
      expect(mf.items).toHaveLength(1);
      expect(mf.items[0].mesh.open).toBe(0);
      expect(Math.abs(mf.items[0].placed - stl.volume) / stl.volume).toBeLessThan(0.01);
    });
  });

for (const mode of ["beginner", "advanced"]) {
  test(`${mode}: small STEP panel appears and closes`, async ({ page }, info) => {
    const errors = watchErrors(page);
    await boot(page, info);
    await loadDoc(page, newDoc("Panel", mode));
    await observe(page);
    await importFile(page, "Panel.step", cube);
    await settled(page);
    expect(await page.evaluate(() => window.stepObservations.some(x => x.visible))).toBe(true);
    expect(errors).toEqual([]);
  });
}
