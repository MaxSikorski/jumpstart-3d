// Shared helpers: boot the app, load a design, wait for the kernel, capture exports.
// The app exposes window.__app and window.__store (the author's app/test/dbg.js did the same).
import { createHash } from "node:crypto";

export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// console noise that is not an app error: the Google Fonts links failing when offline. Chromium's
// "Failed to load resource" text has no URL in it, so the check is on the message's location.
const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

export function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("page: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !FONT_HOSTS.test(m.location().url || "")) errors.push("console: " + m.text().slice(0, 300)); });
  return errors;
}

// Open the build under test (the project's baseURL) and wait for the geometry kernel.
export async function boot(page, info) {
  await page.goto(info.project.use.baseURL);
  await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
}

export function newDoc(name, mode, extra = {}) {
  return { v: 1, id: "t_" + name.replace(/\W+/g, "_"), name, mode, created: 1, seq: 0, grid: 1, bodies: [], sketches: [], planes: [], joints: [], ...extra };
}
export function body(id, name, node, m = IDENTITY, extra = {}) {
  return { id, name, seq: 1, color: "#3b82c4", hole: false, hidden: false, m, node, ...extra };
}
export const prim = (kind, p, mods = []) => ({ t: "prim", kind, p, mods });

// Load a design the way the author's scripts did and wait until every body is built. The selection
// is cleared because body ids repeat across designs and a selection would make Export use "Selected".
export async function loadDoc(page, doc) {
  await page.evaluate((doc) => { window.__store.load(doc); window.__app.setMode(doc.mode || "beginner", true); window.__app.select([]); }, doc);
  await waitIdle(page);
}

// Done when the kernel has nothing queued and every visible body has a mesh or an error.
// A body that errors keeps its previous mesh (views are kept by body id, and ids repeat across
// designs), so every test must also assert that no body has an error before trusting a volume or export.
export async function waitIdle(page, timeout = 90_000) {
  await page.waitForFunction(() => {
    const a = window.__app, k = a.kernel, s = a.scene;
    if (!k.ready || k.inflight || k.queue.size || s.busy()) return false;
    for (const b of window.__store.view.bodies) {
      if (b.hidden) continue;
      const v = s.views.get(b.id);
      if (!v || v.pending) return false;
      if (!v.data && !s.errors.has(b.id)) return false;
    }
    return true;
  }, null, { timeout });
}

// name, volume (mm³) and kernel error of every body in the design
export function bodies(page) {
  return page.evaluate(() => window.__store.doc.bodies.map((b) => {
    const v = window.__app.scene.views.get(b.id);
    return { id: b.id, name: b.name, hole: !!b.hole, volume: v && v.data ? Math.round(v.data.volume * 10) / 10 : null, error: window.__app.scene.errors.get(b.id) || null };
  }));
}

// Export through the real menu and return the downloaded bytes. kind: stl | obj | step | json | dxf
export async function exportBytes(page, kind) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    (async () => { await page.click("#btn-export"); await page.click(`#menu-export button[data-act="${kind}"]`); })(),
  ]);
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  return { name: dl.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// STEP files carry things that depend on the export, not the shape. Blank them so the hash only sees geometry:
//  - the time the file was written
//  - the export counter in product names: "STEP translator 8.0 3'" (one body) or "... 3.2'" (body 2 of a
//    multi-body file); only the counter before the dot goes, the body index stays
//  - the same counter in the links between bodies: NEXT_ASSEMBLY_USAGE_OCCURRENCE('12', ...)
// Both counters keep running for as long as the page lives, so they depend on how many STEP exports came before.
export const normalizeStep = (bytes) => Buffer.from(bytes.toString("latin1")
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?/g, "DATE")
  .replace(/STEP translator ([\d.]+) \d+(\.\d+)?'/g, "STEP translator $1 N$2'")
  .replace(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\('\d+'/g, "NEXT_ASSEMBLY_USAGE_OCCURRENCE('N'"), "latin1");

export const stlTriangles = (bytes) => bytes.readUInt32LE(80);
