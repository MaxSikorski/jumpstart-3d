// The stall watchdog (src/kernelClient.js): a batch of several bodies that runs past the time limit is not an error by itself,
// it is retried one body at a time with a fresh limit each. Only a body that stalls alone is marked "stalled".
// The engine is made slow in a controlled way: a Worker wrapper holds back every build message by `perBody` ms per body
// (or swallows it when it holds the `hang` marker), and `kernel.watchdogMs` (test-only) lowers the limit.
import { test, expect } from "@playwright/test";
import { boot, watchErrors } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => {
    const W = window.Worker;
    window.__workers = 0;
    window.__slow = null;
    window.Worker = class extends W {
      constructor(...a) { super(...a); window.__workers++; }
      postMessage(m, t) {
        const s = window.__slow;
        if (s && m && m.type === "build") {
          if (s.hang && m.bodies.some((b) => JSON.stringify(b.node).includes(s.hang))) return; // never answered
          setTimeout(() => super.postMessage(m, t), s.perBody * m.bodies.length);
          return;
        }
        super.postMessage(m, t);
      }
    };
  });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(async () => {
  await page.evaluate(() => { window.__slow = null; delete window.__app.kernel.watchdogMs; });
  expect(errors, "console or page errors").toEqual([]);
});

// four boxes with sizes no other test uses (a built or stalled size is remembered by the client), the slowdown set, then everything built
async function four(slow, limit, sizes) {
  await page.evaluate(() => JS3D.newDesign("beginner"));
  await page.evaluate(([slow, limit]) => { window.__slow = slow; window.__app.kernel.watchdogMs = limit; window.__before = window.__workers; }, [slow, limit]);
  await page.evaluate((sizes) => { for (const s of sizes) JS3D.add("box", { size: s }); }, sizes);
  return page.evaluate(async () => { await JS3D.ready(); return { list: JS3D.list(), restarts: window.__workers - window.__before }; });
}

test("four bodies that each build in time alone but not together: no error, all built", async () => {
  const sizes = [[11.1, 12, 13], [14.2, 15, 16], [17.3, 18, 19], [20.4, 21, 22]];
  const { list, restarts } = await four({ perBody: 700 }, 1800, sizes);
  expect(list.map((b) => b.error)).toEqual([null, null, null, null]);
  list.forEach((b, i) => expect(b.volume).toBeCloseTo(sizes[i][0] * sizes[i][1] * sizes[i][2], 1));
  expect(restarts, "one restart for the slow batch, none after").toBe(1);
});

test("a body that never finishes is the only one marked stalled", async () => {
  const sizes = [[31.1, 12, 13], [34.2, 15, 16], [37.3, 18, 17.77], [40.4, 21, 22]];
  const { list, restarts } = await four({ perBody: 300, hang: "17.77" }, 1500, sizes);
  expect(list.map((b) => !!b.error)).toEqual([false, false, true, false]);
  expect(list[2].error).toContain("stalled the geometry engine");
  for (const i of [0, 1, 3]) expect(list[i].volume).toBeCloseTo(sizes[i][0] * sizes[i][1] * sizes[i][2], 1);
  expect(restarts, "the batch restart, then the lone body's restart").toBe(2);
});

test("a body that stalls alone is final: one restart, no retry loop", async () => {
  const sizes = [[51.1, 12, 13.31]];
  await page.evaluate(() => JS3D.newDesign("beginner"));
  await page.evaluate(() => { window.__slow = { perBody: 100, hang: "13.31" }; window.__app.kernel.watchdogMs = 1200; window.__before = window.__workers; });
  await page.evaluate((s) => JS3D.add("box", { size: s[0] }), sizes);
  const r = await page.evaluate(async () => { await JS3D.ready(); await new Promise((r) => setTimeout(r, 1500)); return { e: JS3D.list()[0].error, restarts: window.__workers - window.__before }; });
  expect(r.e).toContain("stalled");
  expect(r.restarts).toBe(1);
});
