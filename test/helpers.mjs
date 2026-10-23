// Shared helpers: boot the app, load a design, wait for the kernel, capture exports.
// The app exposes window.__app and window.__store (the author's app/test/dbg.js did the same).
import { createHash } from "node:crypto";
import { test } from "@playwright/test";

export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// console noise that is not an app error: the Google Fonts links failing when offline. Chromium's
// "Failed to load resource" text has no URL in it, so the check is on the message's location.
const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

// Known noise in one browser, matched by the exact message: WebKit reports a harmless ResizeObserver note as a page error, and on a file:// page it
// logs a refused blob:null worker fetch (the engine still starts; the kernel test would fail if it did not).
const NOISE = [
  { project: /-webkit$/, message: /^ResizeObserver loop completed with undelivered notifications\.$/ },
  { project: /^single-webkit$/, message: /^Cannot load blob:null\/[0-9a-f-]+ due to access control checks\.$/ },
];

export function watchErrors(page) {
  const errors = [];
  const project = test.info().project.name;
  const noise = (text) => NOISE.some((n) => n.project.test(project) && n.message.test(text));
  page.on("pageerror", (e) => { if (!noise(e.message)) errors.push("page: " + e.message); });
  page.on("console", (m) => { if (m.type() === "error" && !FONT_HOSTS.test(m.location().url || "") && !noise(m.text())) errors.push("console: " + m.text().slice(0, 300)); });
  return errors;
}

const MARKER = "__js3d.test.reload";
const RETRIES = 3;
const recorded = new WeakSet();

// The marker is removed before the app runs, so the app never sees it.
function recordStorageAtStart(page) {
  if (recorded.has(page)) return;
  recorded.add(page);
  return page.addInitScript((marker) => {
    try {
      const token = localStorage.getItem(marker);
      localStorage.removeItem(marker);
      const keys = [], values = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); keys.push(k); values[k] = localStorage.getItem(k); }
      window.__storageAtStart = { token, keys, values };
    } catch (e) { window.__storageAtStart = { error: e.name }; }
  }, MARKER);
}

// On the Linux CI runner, Chromium now and then opens the next document of a file:// page with an empty storage area (seen 2026-10-21, not tied to how soon the reload comes). The app never touches the marker key, so a document that starts without it lost the storage to the browser, not to an app mistake; only then is the store put back and the navigation repeated (if every saved localStorage key is there with its saved value, the helper just logs `storage-kept` and carries on). Writes the app makes while the old page unloads (the save at beforeunload, autosave on pagehide) are not in the snapshot, so a test about unsaved work surviving a reload must not use reload().
async function navigateKeepingStorage(page, go) {
  await recordStorageAtStart(page);
  const { saved, age } = await page.evaluate((marker) => {
    const saved = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== marker) saved[k] = localStorage.getItem(k); }
    return { saved, age: Math.round(performance.now()) };
  }, MARKER);
  for (let attempt = 0; ; attempt++) {
    const token = `${Date.now()}-${attempt}`;
    await page.evaluate(([marker, token]) => localStorage.setItem(marker, token), [MARKER, token]);
    await go();
    const at = await page.evaluate(() => window.__storageAtStart);
    if (at && at.token === token) return;
    const where = `${test.info().titlePath.slice(1).join(" > ")} [${test.info().project.name}]`;
    const report = (description, type = "storage-lost") => { console.log(type + ": " + description); test.info().annotations.push({ type, description }); };
    const names = Object.keys(saved);
    // Marker gone but every saved localStorage key is there with its saved value: nothing was lost, so there is nothing to put back and no reason to open another document (it would, for one, send one more hello to the agent mock).
    if (at && at.values && names.every((k) => at.values[k] === saved[k])) {
      report(`${where} navigation ${attempt + 1}: marker gone but all ${names.length} saved localStorage keys present (marker seen at start: ${at.token})`, "storage-kept");
      await page.evaluate((marker) => localStorage.removeItem(marker), MARKER); // in case the old page's marker write landed after the new page started
      return;
    }
    if (attempt === RETRIES) { report(`${where} giving up after ${RETRIES} retries`); return; }
    const present = at && at.keys ? names.filter((k) => at.keys.includes(k)).length : 0;
    report(`${where} attempt ${attempt + 1}/${RETRIES}, keys at start: [${at && at.keys ? at.keys.join(", ") : "unreadable: " + (at && at.error)}], ${present}/${names.length} of the saved keys present, page open ${age} ms before the reload`);
    await page.evaluate((saved) => {
      localStorage.clear();
      for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    }, saved);
  }
}

export async function reload(page) { await navigateKeepingStorage(page, () => page.reload()); }

// Open the build under test (the project's baseURL) and wait for the geometry kernel.
export async function boot(page, info) {
  const url = info.project.use.baseURL;
  if (page.url() === "about:blank") {
    await recordStorageAtStart(page);
    await page.goto(url);
  } else await navigateKeepingStorage(page, () => page.goto(url));
  await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  await page.waitForFunction(() => window.__app.projects.started === true, null, { timeout: 20_000 }); // the saved design is loaded (storage may be slow to open)
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
//    multi-body file, "... 3.2.1'" when a body is several solids); only the counter before the first dot goes, the indexes stay
//  - the same counter in the links between bodies: NEXT_ASSEMBLY_USAGE_OCCURRENCE('12', ...)
// Both counters keep running for as long as the page lives, so they depend on how many STEP exports came before.
export const normalizeStep = (bytes) => Buffer.from(bytes.toString("latin1")
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?/g, "DATE")
  .replace(/STEP translator ([\d.]+) \d+((\.\d+)*)'/g, "STEP translator $1 N$2'")
  .replace(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\('\d+'/g, "NEXT_ASSEMBLY_USAGE_OCCURRENCE('N'"), "latin1");

export const stlTriangles = (bytes) => bytes.readUInt32LE(80);
