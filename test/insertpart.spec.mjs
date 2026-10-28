// Supplier files use the real model importer; only the folder picker and its poll clock are fake.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, loadDoc, newDoc, waitIdle, bodies, watchErrors } from "./helpers.mjs";

const STEP = readFileSync(new URL("./fixtures/judge/cube.step", import.meta.url));
const STL = readFileSync(new URL("./fixtures/judge/cube.stl", import.meta.url));
test.setTimeout(120_000);

async function openPanel(page) {
  await page.click("#btn-export");
  await page.click("#btn-insertpart-menu");
  await expect(page.locator("#insertpart-title")).toBeVisible();
}
async function cubes(page, count) {
  await expect.poll(async () => (await bodies(page)).length).toBe(count);
  await waitIdle(page);
  for (const b of await bodies(page)) {
    expect(b.error).toBeNull();
    expect(b.volume).toBeGreaterThan(0);
    expect(b.volume).toBeCloseTo(1000, 1);
  }
}
async function drop(page, bytes = STEP, name = "cube.step", modified = 1) {
  const dt = await page.evaluateHandle(({ bytes, name, modified }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], name, { lastModified: modified }));
    return dt;
  }, { bytes: [...bytes], name, modified });
  for (const type of ["dragenter", "dragover", "drop"]) await page.dispatchEvent("#insertpart-drop", type, { dataTransfer: dt });
  await dt.dispose();
}

for (const mode of ["Beginner", "Advanced"]) {
  test(`${mode}: dropping on the supplier card imports once`, async ({ page }) => {
    await loadDoc(page, newDoc("Supplier drop", mode.toLowerCase()));
    await openPanel(page);
    await drop(page);
    await cubes(page, 1);
    const list = await page.evaluate(() => window.JS3D.list());
    expect(list[0].bbox.min[2]).toBeCloseTo(0, 3);
    await expect(page.locator("#insertpart-panel")).toBeHidden();
    expect(errors).toEqual([]);
  });
}

async function installFolder(page, options = {}) {
  await page.addInitScript(({ bytes, options }) => {
    const p = window.parts = { entries: new Map(), calls: [], queries: [], requests: [], permission: "granted", requested: "granted", enumeration: 0, reads: 0, holds: new Map(), pickerError: "", accessError: "", storageError: options.storageError };
    p.add = (name, modified = 1, size = bytes.length) => p.entries.set(name, {
      kind: "file", name, modified, size,
      async getFile() {
        p.reads++;
        if (p.holds.has(name)) { p.heldRead = name; await p.holds.get(name).promise; }
        const current = p.entries.get(name);
        if (!current) throw new DOMException("test file disappeared", "NotFoundError");
        return new File([new Uint8Array(bytes.slice(0, current.size))], name, { lastModified: current.modified });
      },
    });
    p.hold = (name) => {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      p.holds.set(name, { promise, release });
    };
    p.directory = (name = "3D parts") => ({
      kind: "directory", name,
      async queryPermission(options) { p.queries.push(options); return p.permission; },
      async requestPermission(options) { p.requests.push(options); return p.requested; },
      async *values() {
        p.enumeration++;
        if (p.accessError) throw new DOMException("test access failure", p.accessError);
        for (const entry of p.entries.values()) yield entry;
      },
      async *entries() { for await (const entry of this.values()) yield [entry.name, entry]; },
    });
    p.add("old.step");
    window.showDirectoryPicker = options.unsupported ? undefined : async (options) => {
      p.calls.push(options);
      if (p.pickerError) throw new DOMException("test picker failure", p.pickerError);
      return p.directory();
    };
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, ...args) {
      if (name === "js3d-insertpart" && p.storageError === "open") throw new DOMException("test storage failure", "SecurityError");
      return open.call(this, name, ...args);
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === "handles" && this.transaction.db.name === "js3d-insertpart") {
        if (p.storageError === "put") throw new DOMException("test storage failure", "DataCloneError");
        if (value?.kind === "directory") value = { __insertpartFakeDirectory: true, name: value.name };
      }
      return put.call(this, value, ...args);
    };
    const result = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "result");
    Object.defineProperty(IDBRequest.prototype, "result", { ...result, get() {
      const value = result.get.call(this), source = this.source;
      if (source instanceof IDBObjectStore && source.name === "handles" && source.transaction.db.name === "js3d-insertpart" && value?.__insertpartFakeDirectory) return p.directory(value.name);
      return value;
    } });
  }, { bytes: [...STEP], options });
}
async function clock(page) {
  await page.evaluate(() => {
    const set = window.setInterval, clear = window.clearInterval;
    window.partsTimers = new Map();
    let id = -1;
    window.setInterval = (fn, ms, ...args) => {
      if (ms !== 2000) return set(fn, ms, ...args);
      const key = id--;
      window.partsTimers.set(key, () => fn(...args));
      return key;
    };
    window.clearInterval = (id) => window.partsTimers.delete(id) || clear(id);
    window.tickParts = async () => { for (const callback of window.partsTimers.values()) await callback(); };
  });
}
async function tick(page, n = 1) {
  await page.evaluate(async (n) => { for (let i = 0; i < n; i++) await window.tickParts(); }, n);
}
async function watch(page) {
  await openPanel(page);
  await page.click("#insertpart-watch");
  await expect(page.locator("#insertpart-status")).toHaveText("Watching 3D parts");
}
const add = (page, name = "new.StEp", modified = 1, size = STEP.length) => page.evaluate(({ name, modified, size }) => window.parts.add(name, modified, size), { name, modified, size });
async function stopped(page) {
  await expect(page.locator("#insertpart-pill")).toBeHidden();
  expect(await page.evaluate(() => window.partsTimers.size)).toBe(0);
}
let errors;
test.beforeEach(async ({ page }, info) => {
  errors = watchErrors(page);
  await installFolder(page, { unsupported: info.title === "folder watching explains unsupported browsers" });
  await boot(page, info);
  await loadDoc(page, newDoc("Supplier", "beginner"));
  await clock(page);
});
test.afterEach(() => { expect(errors).toEqual([]); });

for (const mode of ["Beginner", "Advanced"]) {
  test(`${mode}: file menu opens Insert a real part`, async ({ page }) => {
    await loadDoc(page, newDoc("Menu", mode.toLowerCase()));
    const before = await page.evaluate(() => ({ modals: document.querySelectorAll(".modal-back").length, command: !!window.__app.command }));
    await openPanel(page);
    await expect(page.locator("#menu-export")).toBeHidden();
    expect(await page.locator("#btn-import-menu + #btn-insertpart-menu").count()).toBe(1);
    expect(await page.locator("#btn-insertpart-menu").getAttribute("data-act")).toBeNull();
    await expect(page.locator("#btn-insertpart-menu")).toHaveAttribute("title", "Find a supplier part and import its downloaded model");
    expect(await page.evaluate(() => ({ modals: document.querySelectorAll(".modal-back").length, command: !!window.__app.command }))).toEqual(before);
  });
  test(`${mode}: Choose file uses the existing model picker`, async ({ page }) => {
    await loadDoc(page, newDoc("Picker", mode.toLowerCase()));
    await openPanel(page);
    const inputs = await page.locator('input[type="file"]').count();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#insertpart-file")]);
    await chooser.setFiles({ name: "cube.step", mimeType: "model/step", buffer: STEP });
    await cubes(page, 1);
    expect(await page.locator('input[type="file"]').count()).toBe(inputs);
  });
}

test("Advanced Insert opens the supplier panel", async ({ page }) => {
  await loadDoc(page, newDoc("Advanced", "advanced"));
  await page.click("#ad-insert");
  await page.click("#ad-ins-realpart");
  await expect(page.locator("#insertpart-title")).toBeVisible();
  await page.click("#insertpart-close");
  await openPanel(page);
  expect(await page.locator("#insertpart-panel").count()).toBe(1);
});

test("supplier links navigate only after a click", async ({ browser }, info) => {
  const context = await browser.newContext(), page = await context.newPage();
  const requests = [], sockets = [], localErrors = watchErrors(page);
  const links = [["mcmaster", "https://www.mcmaster.com/"], ["misumi", "https://us.misumi-ec.com/"], ["openbuilds", "https://openbuilds.com/"], ["traceparts", "https://www.traceparts.com/"]];
  context.on("request", (r) => requests.push(r));
  const track = (p) => p.on("websocket", (ws) => sockets.push(ws.url()));
  track(page); context.on("page", track);
  try {
    for (const [, url] of links) await context.route(`${url}**`, (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><title>Supplier</title><link rel=icon href="data:,">' }));
    await installFolder(page);
    await boot(page, info);
    await loadDoc(page, newDoc("Links", "beginner"));
    await clock(page);
    const bootRequests = requests.length;
    await watch(page);
    for (const [id, url] of links) {
      const link = page.locator(`#insertpart-${id}`);
      await expect(link).toHaveAttribute("href", url);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener");
      await link.hover();
    }
    await tick(page, 10);
    expect(requests.slice(bootRequests)).toEqual([]);
    for (const [id, url] of links) {
      const count = requests.length;
      const [popup] = await Promise.all([page.waitForEvent("popup"), page.click(`#insertpart-${id}`)]);
      await popup.waitForLoadState();
      expect(await popup.evaluate(() => window.opener === null)).toBe(true);
      expect(requests.slice(count).filter((req) => req.isNavigationRequest()).map((r) => [r.url(), r.method(), r.resourceType(), r.postData()])).toEqual([[url, "GET", "document", null]]);
      await popup.close();
      await expect(page.locator("#insertpart-panel")).toBeVisible();
    }
    expect(sockets).toEqual([]);
    expect(localErrors).toEqual([]);
  } finally { await context.close(); }
});

test("folder watching explains unsupported browsers", async ({ page }) => {
  await openPanel(page);
  await expect(page.locator("#insertpart-watch-area")).toHaveText("Watching a folder needs Chrome or Edge on a computer. Drag the file in instead.");
  expect(await page.locator("#insertpart-watch-area button").count()).toBe(0);
  await drop(page);
  await cubes(page, 1);
});

test("watching ignores the baseline", async ({ page }) => {
  await watch(page);
  expect(await page.evaluate(() => window.parts.calls)).toEqual([{ id: "js3d-parts", startIn: "downloads", mode: "read" }]);
  await tick(page, 10);
  await cubes(page, 0);
});

test("a new STEP imports once and a changed version imports once", async ({ page }) => {
  await watch(page); await add(page);
  await tick(page); await cubes(page, 0);
  await tick(page); await cubes(page, 1);
  await tick(page, 10); await cubes(page, 1);
  await add(page, "new.StEp", 2);
  await tick(page, 2); await cubes(page, 2);
});

test("temporary hidden unsupported and nested files are ignored", async ({ page }) => {
  await watch(page);
  for (const name of [".hidden.step", "x.step.crdownload", "x.step.part", "x.step.download", "x.step.tmp", "readme.txt"]) await add(page, name);
  await page.evaluate(() => window.parts.entries.set("nested", { kind: "directory", name: "nested", async *values() { yield window.parts.entries.get("old.step"); } }));
  await tick(page, 10); await cubes(page, 0);
  await page.evaluate(() => window.parts.entries.delete("x.step.crdownload"));
  await add(page, "ready.stp");
  await tick(page, 2); await cubes(page, 1);
});

test("a growing or empty file waits until stable", async ({ page }) => {
  await watch(page);
  for (const size of [0, 80, 200, STEP.length]) {
    await add(page, "growing.step", 1, size);
    await tick(page); await cubes(page, 0);
  }
  await tick(page); await cubes(page, 1);
});

test("Stop prevents later imports and cancels an outstanding read", async ({ page }) => {
  await watch(page); await add(page);
  await page.evaluate(() => { window.parts.hold("new.StEp"); window.parts.reads = 0; window.pendingTick = window.tickParts(); });
  await page.waitForFunction(() => window.parts.heldRead === "new.StEp");
  await page.click("#insertpart-stop");
  await page.evaluate(async () => { window.parts.holds.get("new.StEp").release(); await window.pendingTick; window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await stopped(page); await cubes(page, 0);
  await expect(page.locator("#insertpart-status")).toHaveText("Watching stopped.");
  await page.evaluate(() => { window.parts.hold("old.step"); });
  await page.click("#insertpart-watch");
  await page.waitForFunction(() => window.parts.heldRead === "old.step");
  await expect(page.locator("#insertpart-status")).toHaveText("Reading folder…");
  await expect(page.locator("#insertpart-watch")).toBeDisabled();
  await page.click("#insertpart-stop");
  await page.evaluate(() => { window.parts.holds.get("old.step").release(); });
  await stopped(page); await cubes(page, 0);
});

test("a pending file waits for a modal dialog", async ({ page }) => {
  await watch(page); await add(page);
  await page.click("#btn-about");
  await tick(page, 2); await cubes(page, 0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-back")).toHaveCount(0);
  await expect(page.locator("#insertpart-panel")).toBeVisible();
  await tick(page); await cubes(page, 1);
});

test("a pending file waits for a command and the correct mode", async ({ page }) => {
  await loadDoc(page, newDoc("Command", "advanced"));
  await watch(page);
  await page.click("#ad-moverot");
  await page.waitForFunction(() => !!window.__app.command);
  await add(page); await tick(page, 2); await cubes(page, 0);
  await page.keyboard.press("Escape");
  await page.click("#mode-arch");
  await tick(page); await cubes(page, 0);
  await page.click("#mode-advanced");
  await tick(page); await cubes(page, 1);
});

test("watching continues behind the closed panel", async ({ page }) => {
  await watch(page); await page.click("#insertpart-close");
  await add(page); await tick(page, 2); await cubes(page, 1);
  await expect(page.locator("#insertpart-pill")).toBeVisible();
  await page.click("#insertpart-pill-open");
  await expect(page.locator("#insertpart-panel")).toBeVisible();
  await page.click("#insertpart-close"); await page.click("#insertpart-pill-stop");
  await stopped(page);
  await expect(page.locator("#insertpart-panel")).toBeHidden();
});

test("hidden pages wait and focus checks immediately", async ({ page }) => {
  await watch(page); await add(page);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await cubes(page, 0);
  const before = await page.evaluate(() => { window.partsVisibility = "hidden"; Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.partsVisibility }); return window.parts.enumeration; });
  await tick(page, 2); await cubes(page, 0);
  expect(await page.evaluate(() => window.parts.enumeration)).toBe(before);
  await page.evaluate(() => { window.partsVisibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  await tick(page); await cubes(page, 0);
  await tick(page); await cubes(page, 1);
});

test("watched imports never overlap", async ({ page }) => {
  await watch(page); await add(page, "b.step"); await add(page, "a.step");
  await page.evaluate(() => {
    const open = window.__app.advanced.openModelFile;
    window.importOrder = []; window.activeImports = 0; window.maxImports = 0; window.releaseImport = null;
    window.__app.advanced.openModelFile = async (file) => {
      window.importOrder.push(file.name);
      window.maxImports = Math.max(window.maxImports, ++window.activeImports);
      await open(file);
      await new Promise((resolve) => { window.releaseImport = resolve; });
      window.activeImports--;
    };
  });
  await tick(page);
  await page.evaluate(() => { window.pendingTick = window.tickParts(); });
  await page.waitForFunction(() => window.importOrder.length === 1 && !!window.releaseImport);
  await cubes(page, 1);
  const enumeration = await page.evaluate(() => { window.extraTick = window.tickParts(); window.dispatchEvent(new Event("focus")); return window.parts.enumeration; });
  await page.evaluate(() => { window.releaseImport(); window.releaseImport = null; });
  await page.waitForFunction(() => window.importOrder.length === 2 && !!window.releaseImport);
  await page.evaluate(async () => { window.releaseImport(); await window.pendingTick; });
  await expect.poll(() => page.evaluate(() => window.parts.enumeration)).toBeGreaterThan(enumeration);
  await page.evaluate(() => window.extraTick);
  await cubes(page, 2);
  expect(await page.evaluate(() => [window.maxImports, window.importOrder])).toEqual([1, ["a.step", "b.step"]]);
});

for (const error of ["NotAllowedError", "NotFoundError"]) test(`${error}: lost folder access stops watching`, async ({ page }) => {
  await watch(page);
  await page.evaluate((error) => { window.parts.accessError = error; }, error);
  await tick(page);
  await expect(page.locator("#insertpart-status")).toHaveText("Folder access ended. Click to watch again.");
  await stopped(page);
  await expect(page.locator("#insertpart-again")).toBeVisible();
  await expect(page.locator("#insertpart-watch")).toBeEnabled();
  await page.evaluate(() => { window.parts.accessError = ""; });
  await page.click("#insertpart-watch");
  await expect(page.locator("#insertpart-status")).toHaveText("Watching 3D parts");
});

async function saved(page) {
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open("js3d-insertpart", 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction("handles"), get = tx.objectStore("handles").get("parts-folder");
      get.onsuccess = () => resolve(get.result?.name);
      tx.oncomplete = () => db.close();
    };
  }))).toBe("3D parts");
}

test("reload remembers the folder without restarting", async ({ page }, info) => {
  test.skip(info.project.name.startsWith("single"), "Known Linux file:// storage loss on reload includes IndexedDB; see test/README.md.");
  await watch(page); await saved(page);
  await boot(page, info); await clock(page);
  expect(await page.evaluate(() => [window.parts.calls.length, window.partsTimers.size])).toEqual([0, 0]);
  await expect(page.locator("#insertpart-pill")).toHaveCount(0);
  await openPanel(page);
  await expect(page.locator("#insertpart-again")).toHaveText('Watch "3D parts" again');
  await page.evaluate(() => { window.parts.permission = "prompt"; });
  await page.click("#insertpart-again");
  await expect(page.locator("#insertpart-status")).toHaveText("Watching 3D parts");
  expect(await page.evaluate(() => [window.parts.queries, window.parts.requests])).toEqual([[{ mode: "read" }], [{ mode: "read" }]]);
  await page.evaluate(() => { window.parts.permission = "granted"; });
  await tick(page, 10); await cubes(page, 0);
});

test("remembering failures keep manual picking usable", async ({ browser }, info) => {
  for (const storageError of ["open", "put"]) {
    const context = await browser.newContext(), page = await context.newPage(), localErrors = watchErrors(page);
    try {
      await installFolder(page, { storageError }); await boot(page, info);
      await loadDoc(page, newDoc("Storage", "beginner")); await clock(page);
      await watch(page); await add(page); await tick(page, 2); await cubes(page, 1);
      await page.click("#insertpart-pill-open");
      await page.click("#insertpart-stop");
      await expect(page.locator("#insertpart-watch")).toBeEnabled();
      await page.click("#insertpart-watch");
      await expect(page.locator("#insertpart-status")).toHaveText("Watching 3D parts");
      expect(await page.evaluate(() => window.parts.calls.length)).toBe(2);
      expect(localErrors).toEqual([]);
    } finally { await context.close(); }
  }
});

test("permission refusal falls back to picking again", async ({ page }, info) => {
  test.skip(info.project.name.startsWith("single"), "Known Linux file:// storage loss on reload includes IndexedDB; see test/README.md.");
  await watch(page); await saved(page); await boot(page, info); await clock(page);
  await openPanel(page);
  await expect(page.locator("#insertpart-again")).toBeVisible();
  await page.evaluate(() => { window.parts.permission = "prompt"; window.parts.requested = "denied"; });
  await page.click("#insertpart-again");
  await expect(page.locator("#insertpart-status")).toHaveText("Choose the folder again to watch for new parts.");
  await expect(page.locator("#insertpart-again")).toBeHidden();
  await page.evaluate(() => { window.parts.permission = "granted"; });
  await page.click("#insertpart-watch");
  await expect(page.locator("#insertpart-status")).toHaveText("Watching 3D parts");
});

test("picker cancellation and rejection stay inside the panel", async ({ page }) => {
  await openPanel(page);
  await page.evaluate(() => { window.parts.pickerError = "AbortError"; });
  await page.click("#insertpart-watch");
  await expect(page.locator("#insertpart-watch")).toBeEnabled();
  await expect(page.locator("#insertpart-status")).toBeEmpty();
  await page.evaluate(() => { window.parts.pickerError = "SecurityError"; });
  await page.click("#insertpart-watch");
  await expect(page.locator("#insertpart-status")).toHaveText("That folder can't be watched here. Try another folder or drop the file instead.");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#insertpart-file")]);
  await chooser.setFiles({ name: "cube.step", mimeType: "model/step", buffer: STEP });
  await cubes(page, 1);
});

test("Escape and Close preserve the selection", async ({ page }) => {
  await openPanel(page); await drop(page); await cubes(page, 1);
  const selection = await page.evaluate(() => window.JS3D.selection());
  expect(selection).toHaveLength(1);
  await openPanel(page);
  for (const close of [() => page.keyboard.press("Escape"), () => page.click("#insertpart-close")]) {
    await close();
    await expect(page.locator("#insertpart-panel")).toBeHidden();
    expect(await page.evaluate(() => window.JS3D.selection())).toEqual(selection);
    await openPanel(page);
  }
  expect(await page.locator("#insertpart-panel").count()).toBe(1);
  expect(await page.locator("#insertpart-css").count()).toBe(1);
});

for (const mode of ["Beginner", "Advanced"]) test(`${mode}: pill clears controls and import notes at both widths`, async ({ page }) => {
  await loadDoc(page, newDoc("Layout", mode.toLowerCase()));
  await watch(page);
  for (const [width, height] of [[1400, 880], [375, 667]]) {
    await page.setViewportSize({ width, height });
    await openPanel(page);
    await drop(page, STL, "cube.stl");
    await cubes(page, width === 1400 ? 1 : 2);
    await expect(page.locator("#toasts")).not.toBeEmpty();
    await expect.poll(() => page.evaluate(() => {
      const pill = document.getElementById("insertpart-pill").getBoundingClientRect();
      return [...document.querySelectorAll(".ribbon, #shapes.dock, #timeline, .status, #toasts .toast, #dock-help")].filter((el) => {
        const r = el.getBoundingClientRect();
        return el.getClientRects().length && r.width && r.height && getComputedStyle(el).visibility !== "hidden" && pill.left < r.right && pill.right > r.left && pill.top < r.bottom && pill.bottom > r.top;
      }).map((el) => el.id || el.className);
    })).toEqual([]);
    await openPanel(page);
    expect(await page.evaluate(() => [...document.querySelectorAll("#insertpart-panel button, #insertpart-panel a")].filter((el) => !el.hidden).every((el) => {
      const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height >= 44;
    }))).toBe(true);
  }
});


test("a watched import holds the shared drop lock", async ({ page }) => {
  await watch(page); await add(page, "watched.step");
  await page.evaluate(() => {
    const open = window.__app.advanced.openModelFile;
    window.__app.advanced.openModelFile = async (file) => {
      await open(file);
      await new Promise((resolve) => { window.releaseImport = resolve; });
    };
  });
  await tick(page);
  await page.evaluate(() => { window.pendingTick = window.tickParts(); });
  await page.waitForFunction(() => !!window.releaseImport);
  await cubes(page, 1);
  await openPanel(page); await drop(page);
  await expect(page.locator("#toasts")).toContainText("Still opening the last files. Drop this one again in a moment.");
  await cubes(page, 1);
  await page.evaluate(async () => { window.releaseImport(); await window.pendingTick; });
  await tick(page, 2); await cubes(page, 1);
});

test("a stopped folder read cannot block a new watch session", async ({ page }) => {
  await watch(page); await add(page, "a.step");
  await page.evaluate(() => { window.parts.hold("a.step"); window.pendingTick = window.tickParts(); });
  await page.waitForFunction(() => window.parts.heldRead === "a.step");
  await page.click("#insertpart-stop");
  await page.evaluate(() => {
    window.parts.entries = new Map();
    window.showDirectoryPicker = async () => window.parts.directory("Folder B");
  });
  await page.click("#insertpart-watch");
  await expect(page.locator("#insertpart-status")).toHaveText("Watching Folder B");
  await add(page, "b.step"); await tick(page, 2); await cubes(page, 1);
  await page.evaluate(async () => { window.parts.holds.get("a.step").release(); await window.pendingTick; });
  await tick(page, 2); await cubes(page, 1);
});

test("Escape in a Beginner inspector field reverts without closing the panel", async ({ page }) => {
  await openPanel(page); await drop(page); await cubes(page, 1);
  await openPanel(page);
  const field = page.locator("#insp-s0");
  const value = await field.inputValue();
  await field.fill("123"); await field.press("Escape");
  await expect(field).toHaveValue(value);
  await expect(page.locator("#insertpart-panel")).toBeVisible();
  await page.evaluate(() => window.__app.vp.canvas.focus());
  await page.keyboard.press("Escape");
  await expect(page.locator("#insertpart-panel")).toBeHidden();
});

test("Enter on pill Stop preserves an Advanced command", async ({ page }) => {
  await loadDoc(page, newDoc("Command", "advanced"));
  await watch(page); await page.click("#insertpart-close");
  await page.click("#ad-moverot");
  await page.waitForFunction(() => !!window.__app.command);
  await page.evaluate(() => { window.partsCommand = window.__app.command; });
  await page.locator("#insertpart-pill-stop").press("Enter");
  await stopped(page);
  expect(await page.evaluate(() => window.__app.command === window.partsCommand)).toBe(true);
});

test("Undo from the panel Close button undoes an import", async ({ page }) => {
  await openPanel(page); await drop(page); await cubes(page, 1);
  await openPanel(page);
  await page.locator("#insertpart-close").press("ControlOrMeta+z");
  await cubes(page, 0);
});

test("a dropped folder file is never imported again by the watch", async ({ page }) => {
  await watch(page); await add(page, "cube.step");
  await tick(page);
  await drop(page); await cubes(page, 1);
  await expect(page.locator("#insertpart-panel")).toBeHidden();
  await tick(page, 10); await cubes(page, 1);
});

test("a watched import closes an open panel", async ({ page }) => {
  await watch(page); await add(page); await tick(page, 2); await cubes(page, 1);
  await expect(page.locator("#insertpart-panel")).toBeHidden();
  await expect(page.locator("#insertpart-pill")).toBeVisible();
});

for (const stage of ["baseline", "scan"]) test(`${stage}: a file read failure keeps watching`, async ({ page }) => {
  if (stage === "scan") await watch(page);
  await add(page, "unreadable.step");
  await page.evaluate(() => {
    const entry = window.parts.entries.get("unreadable.step"), get = entry.getFile;
    entry.getFile = async () => { entry.getFile = get; throw new DOMException("test disappeared", "NotFoundError"); };
  });
  if (stage === "baseline") await watch(page);
  else await tick(page);
  await expect(page.locator("#insertpart-status")).toHaveText("Watching 3D parts");
  if (stage === "baseline") { await tick(page, 3); await cubes(page, 0); }
  await page.evaluate(() => window.parts.entries.delete("unreadable.step"));
  await add(page, "later.step"); await tick(page, 2); await cubes(page, 1);
});

test("a pending file waits for a Beginner drag preview", async ({ page }) => {
  await watch(page); await add(page);
  await page.evaluate(() => window.__store.setTransient(window.__store.doc));
  await tick(page, 2); await cubes(page, 0);
  await page.evaluate(() => window.__store.setTransient(null));
  await tick(page); await cubes(page, 1);
});


test("a watched file dropped later is not imported twice", async ({ page }) => {
  await watch(page);
  await expect(page.locator("#insertpart-help")).toHaveText("New files in 3D parts come in by themselves. You can also drop a file here.");
  await add(page, "new.step"); await tick(page, 2); await cubes(page, 1);
  await openPanel(page);
  await drop(page, STEP, "new.step", 1);
  await expect(page.locator("#toasts")).toContainText("Already brought in from 3D parts.");
  await tick(page, 10); await cubes(page, 1);
  await page.click("#insertpart-stop");
  await expect(page.locator("#insertpart-help")).toHaveText("Find the part, download its STEP file, then drop it here.");
});

test("Choose file refuses a busy watch and accepts a file after release", async ({ page }) => {
  await watch(page); await add(page, "watched.step");
  await page.evaluate(() => {
    const open = window.__app.advanced.openModelFile;
    window.activeImports = 0; window.maxImports = 0;
    window.__app.advanced.openModelFile = async (file) => {
      window.maxImports = Math.max(window.maxImports, ++window.activeImports);
      try {
        await open(file);
        await new Promise((resolve) => { window.releaseImport = resolve; });
      } finally { window.activeImports--; }
    };
    const note = window.__app.insertPart.noteFile;
    window.pickedWhileBusy = false;
    window.__app.insertPart.noteFile = (file) => {
      if (file.name === "picked.step" && window.activeImports) window.pickedWhileBusy = true;
      return note(file);
    };
  });
  await tick(page);
  await page.evaluate(() => { window.pendingTick = window.tickParts(); });
  await page.waitForFunction(() => !!window.releaseImport);
  await cubes(page, 1);
  await openPanel(page);
  let chooserCount = 0;
  page.on("filechooser", () => chooserCount++);
  await page.click("#insertpart-file");
  await expect(page.locator("#toasts")).toContainText("Finish or close what's open first, then choose the file.");
  expect(chooserCount).toBe(0);
  await page.evaluate(async () => { window.releaseImport(); await window.pendingTick; });
  const chooser = page.waitForEvent("filechooser");
  await page.click("#insertpart-file");
  await (await chooser).setFiles({ name: "picked.step", mimeType: "application/octet-stream", buffer: STEP });
  await cubes(page, 2);
  expect(chooserCount).toBe(1);
  expect(await page.evaluate(() => [window.maxImports, window.pickedWhileBusy])).toEqual([1, false]);
});

test("a watched import preserves focus outside the panel", async ({ page }) => {
  await watch(page); await add(page);
  await page.evaluate(() => window.__app.vp.canvas.focus());
  await tick(page, 2); await cubes(page, 1);
  await expect(page.locator("#insertpart-panel")).toBeHidden();
  expect(await page.evaluate(() => document.activeElement === window.__app.vp.canvas)).toBe(true);
});

test("the Import menu picker refuses a busy watched import", async ({ page }) => {
  await watch(page); await add(page, "watched.step");
  await page.evaluate(() => {
    const open = window.__app.advanced.openModelFile;
    const note = window.__app.insertPart.noteFile;
    window.activeImports = 0; window.maxImports = 0;
    window.__app.insertPart.noteFile = (file) => {
      // The picker calls the private importer, so count its entry through noteFile too.
      window.maxImports = Math.max(window.maxImports, window.activeImports + (file.name === "picked.step" ? 1 : 0));
      return note(file);
    };
    window.__app.advanced.openModelFile = async (file) => {
      window.maxImports = Math.max(window.maxImports, ++window.activeImports);
      try {
        await open(file);
        await new Promise((resolve) => { window.releaseImport = resolve; });
      } finally { window.activeImports--; }
    };
  });
  await tick(page);
  await page.evaluate(() => { window.pendingTick = window.tickParts(); });
  await page.waitForFunction(() => !!window.releaseImport);
  await cubes(page, 1);
  await page.click("#btn-export");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#btn-import-menu")]);
  await chooser.setFiles({ name: "picked.step", mimeType: "model/step", buffer: STEP });
  await expect(page.locator("#toasts")).toContainText("Still opening the last file. Choose it again in a moment.");
  expect(await page.evaluate(() => window.maxImports)).toBe(1);
  await page.evaluate(async () => { window.releaseImport(); await window.pendingTick; });
  await tick(page, 2); await cubes(page, 1);
  expect(await page.evaluate(() => window.maxImports)).toBe(1);
});

test("a manually removed ready candidate does not end watching", async ({ page }) => {
  await watch(page); await add(page, "a.step"); await add(page, "z.step");
  await tick(page);
  await page.evaluate(() => {
    const entry = window.parts.entries.get("a.step"), get = entry.getFile;
    let reads = 0;
    entry.getFile = async () => {
      if (++reads === 2) await new Promise((resolve) => { window.releaseReread = resolve; });
      return get.call(entry);
    };
    window.pendingTick = window.tickParts();
  });
  await page.waitForFunction(() => !!window.releaseReread);
  await drop(page, STEP, "z.step"); await cubes(page, 1);
  await page.evaluate(async () => { window.releaseReread(); await window.pendingTick; });
  await cubes(page, 2);
  await expect(page.locator("#insertpart-pill")).toBeVisible();
  await expect(page.locator("#insertpart-status")).toHaveText("Watching 3D parts");
  await add(page, "later.step"); await tick(page, 2); await cubes(page, 3);
});

test("manual imports during baseline reading are remembered", async ({ page }) => {
  await add(page, "new.step", 1);
  await page.evaluate(async () => {
    window.parts.entries.delete("old.step"); // the held baseline below lists only new.step
    const folder = window.parts.directory();
    // Enumeration can return an older file snapshot while the manual import is newer.
    const snapshot = await window.parts.entries.get("new.step").getFile();
    folder.values = async function* () {
      await new Promise((resolve) => { window.releaseBaseline = resolve; });
      yield { kind: "file", name: "new.step", getFile: async () => snapshot };
    };
    const values = window.parts.directory().values;
    window.showDirectoryPicker = async () => folder;
    window.finishBaseline = () => { folder.values = values; window.releaseBaseline(); };
  });
  await openPanel(page); await page.click("#insertpart-watch");
  await page.waitForFunction(() => !!window.releaseBaseline);
  await expect(page.locator("#insertpart-status")).toHaveText("Reading folder…");
  await add(page, "new.step", 2);
  await drop(page, STEP, "new.step", 2); await cubes(page, 1);
  await page.evaluate(() => window.finishBaseline());
  await expect(page.locator("#insertpart-status")).toHaveText("Watching 3D parts");
  await tick(page, 2); await cubes(page, 1);
  await expect(page.locator("#insertpart-pill")).toBeVisible();
});
