// "Report a problem": a bug report on GitHub, filled in from the app. The outcome: nothing leaves the
// page until the person presses the link, the link carries the app details and what they typed (never the
// design, never a path), and a saved copy of the design is there to attach. Both builds.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, waitIdle, newDoc, body, prim } from "./helpers.mjs";
import { VERSION, BUILD } from "../src/version.js";

const DESIGN = "Secret Widget Name";
const box = (id, w) => body(id, "Part " + id, prim("box", { w, d: 10, h: 10, r: 0, c: 0 }));
const CUT_NOTE = "…(cut here: paste the rest on GitHub)";

let page, errors, requests, sockets, opened = 0;
// Every request the page and its popups make, to any host, from before the app boots to the end of the file. Only the app's own
// files (the site, or the single file on disk) and its Google Fonts links are expected; anything else is "outside".
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const outside = (info) => requests.filter((r) => !r.url.startsWith("data:") && !r.url.startsWith("blob:") && !FONTS.test(r.url) && !r.url.startsWith(new URL(info.project.use.baseURL).origin === "null" ? "file:" : new URL(info.project.use.baseURL).origin));
test.beforeAll(async ({ browser }, info) => {
  const context = await browser.newContext();
  requests = [];
  sockets = []; // a WebSocket is not in the request list: watch the page and every popup it opens
  // GitHub is a stub: the test never reaches the real site
  await context.route("https://github.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
  context.on("request", (r) => requests.push({ url: r.url(), type: r.resourceType(), method: r.method(), body: r.postData() }));
  const watchSockets = (p) => p.on("websocket", (ws) => sockets.push(ws.url()));
  context.on("page", watchSockets);
  page = await context.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page.context().close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const openFromMenu = async () => { await page.click("#btn-export"); await page.click("#btn-report"); await expect(page.locator("#rp-details")).toBeVisible(); };
const closeDialog = async () => { await page.keyboard.press("Escape"); await expect(page.locator("#rp-details")).toBeHidden(); };
const href = () => page.locator("#rp-open").getAttribute("href");
async function pressOpen() {
  opened++;
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.click("#rp-open")]);
  await popup.waitForLoadState();
  const url = popup.url();
  await popup.close();
  return new URL(url);
}

test("nothing goes to GitHub until the link is pressed, and then exactly one page is opened", async ({}, info) => {
  await loadDoc(page, newDoc(DESIGN, "beginner", { bodies: [box("a", 20)] }));
  await page.click("#btn-export");
  await expect(page.locator("#btn-report")).toContainText("Report a problem");
  await expect(page.locator("#menu-export")).toBeVisible();
  await page.click("#btn-report");
  await expect(page.locator("#menu-export")).toBeHidden(); // the menu closes itself: the entry has no data-act
  const dialog = page.locator(".modal", { has: page.locator("#rp-details") });
  await expect(dialog).toContainText("Nothing is sent until you press Create on GitHub");
  await expect(dialog).toContainText("free GitHub account");
  await page.fill("#rp-steps", "I pressed the button");
  await page.fill("#rp-details", "App details\nI changed this");
  await page.fill("#rp-steps", "I pressed the button twice");
  await expect(page.locator("#rp-error")).toBeHidden(); // no error has been shown yet: nothing to include
  expect(outside(info), "requests to any other host before the link is pressed").toEqual([]);
  const link = page.locator("#rp-open");
  expect(await link.getAttribute("href")).toMatch(/^https:\/\/github\.com\/MaxSikorski\/jumpstart-3d\/issues\/new\?/);
  expect(await link.getAttribute("target")).toBe("_blank");
  expect(await link.getAttribute("rel")).toContain("noreferrer");
  const url = await pressOpen();
  expect(url.hostname).toBe("github.com");
  expect(outside(info).map((r) => [r.type, r.method, new URL(r.url).hostname, r.body]), "everything that left the page after the press").toEqual([["document", "GET", "github.com", null]]);
  await expect(dialog).toContainText("Finish it on GitHub");
  await closeDialog();
});

test("the details hold the build, where, browser and mode, and nothing of the design", async ({}, info) => {
  await loadDoc(page, newDoc(DESIGN, "beginner", { bodies: [box("a", 20)] }));
  await page.setInputFiles("#file-import", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a project") });
  await expect(page.locator(".toast.err", { hasText: "That file isn't a JumpStart 3D project file." })).toBeVisible();
  await openFromMenu();
  const text = await page.inputValue("#rp-details");
  expect(text).toContain(`community build ${BUILD}`);
  expect(text).toContain(`upstream ${VERSION}`);
  expect(text).toContain(info.project.name === "single" ? "Where: the downloaded jumpstart-3d.html file" : "Where: the website");
  expect(text).toMatch(/Browser: .*Chrome/);
  expect(text).toContain("Mode: Beginner");
  expect(text).toContain("Design file:");
  for (const secret of [DESIGN, "file://", "/Users", page.url()]) expect(text).not.toContain(secret);
  // the error is there to include, not included: nothing from it is in the details or the link until the box is ticked
  await expect(page.locator("#rp-error")).toBeVisible();
  await expect(page.locator("#rp-error")).not.toBeChecked();
  expect(text).not.toContain("Last error");
  expect(decodeURIComponent(await href())).not.toContain("JumpStart 3D project file");
  await page.check("#rp-error");
  expect(await page.inputValue("#rp-details")).toContain("- Last error: That file isn't a JumpStart 3D project file.");
  expect(new URL(await href()).searchParams.get("extra")).toContain("- Last error: That file isn't a JumpStart 3D project file.");
  await page.uncheck("#rp-error");
  expect(await page.inputValue("#rp-details")).toBe(text);
  expect(decodeURIComponent(await href())).not.toContain("JumpStart 3D project file");
  await closeDialog();
});

// each error text is what a real toast could carry; the forbidden words are the personal part
const HOSTILE = [
  ["Could not read file:///Users/someone/x.html or blob:null/1234-abcd", ["someone", "file:/", "blob:", "1234"]],
  ["Failed C:\\Users\\John Smith\\Documents\\design.stl", ["John", "Smith", "Documents", "design"]],
  ["Failed \\\\fileserver\\share\\Max Sikorski\\x.stl", ["fileserver", "share", "Sikorski"]],
  ["Failed ~/Documents/Taxes 2025/x.json", ["Taxes", "Documents", "2025"]],
  ["Failed /Volumes/Backup Drive/Max Stuff/x.json", ["Backup", "Stuff", "Volumes"]],
  ["Failed /private/var/folders/ab/cd/T/x.tmp and /home/bob/z.step", ["folders", "bob", "private"]],
  ["Mail max.sikorski@example.com failed", ["example", "sikorski"]],
  ["GET HTTPS://api.example.org/v1?token=abc123 failed", ["abc123", "example", "HTTPS"]],
  ["Cannot reach WSS://agent.home.example:8787/bridge, webdav://nas.local/dav and chrome-extension://abcdefghijklmnop/page.js", ["agent", "nas", "abcdefghijklmnop", "8787"]],
  ["Cannot reach 192.168.1.20:8080, nas.local and myhost.lan:9000/dav", ["192.168", "nas.local", "myhost", "9000"]],
  ["Auth sk-abc123def456ghi789jkl012 and Bearer ghp_AbCdEf0123456789xyz and 0123456789abcdef0123456789abcdef0123", ["sk-abc", "ghp_", "AbCdEf", "0123456789abcdef"]],
  ["Copies to \u201cMax's Taxes 2025\u201d are paused. \"My Secret Design\" is broken \u2018Private\u2019", ["Taxes", "Secret", "Private", "2025"]],
  ['"Wedding Ring v2" has a build error (x is not defined)', ["Wedding", "Ring"]],
  // misses found by the verify pass on #97
  ["Failed:/Users/bob/x and Error:/home/alice/y.stl", ["bob", "alice"]],
  ["Cannot open 'Wedding Ring v2' or `Client Taxes` or «Acme Corp» or „Marias Haus“", ["Wedding", "Taxes", "Acme", "Marias"]],
  ["Could not read Clients/Acme Corp/x.stl", ["Clients", "Acme", "Corp"]],
  ["Could not read Clients/Acme/x.stl", ["Clients", "Acme"]],
  ["Fetch failed for example.co.uk/private/page and dropbox.fr/secret", ["example", "private", "dropbox", "secret"]],
  ["Cannot reach [2001:db8::1]:8080 and fe80::1 and 2001:db8:85a3:0:0:8a2e:370:7334", ["2001", "db8", "fe80", "8080", "8a2e"]],
  ["Could not read Projects/Order 1234/part.stl", ["Projects", "Order", "1234"]],
  ["Could not read Clients/M\u00fcller GmbH/x.stl", ["Clients", "M\u00fcller", "GmbH"]],
  ["Bad request token=abc123 and password: hunter2 and api_key=zz9", ["abc123", "hunter2", "zz9"]],
];
const STAYS = [
  "Don't panic: it's 1/2 done, read/write, and/or 10/12/2025 aren't names",
  "read/write failed e.g. disk full",
  "Use cut and/or combine on part.stl",
  "Auth: failed",
  "Signature: invalid shape",
  "Failed at 12:30 and face:12 and edge:7",
];
test("a ticked error has its names, paths, addresses and keys taken out first", async () => {
  for (const [message, forbidden] of HOSTILE) {
    await page.evaluate((m) => window.__app.toast(m, "err"), message);
    await openFromMenu();
    await page.check("#rp-error");
    const line = (await page.inputValue("#rp-details")).split("\n").find((l) => l.startsWith("- Last error:"));
    expect(line, message).toMatch(/\[(path|name|email|key|address) removed\]/);
    const inLink = new URL(await href()).searchParams.get("extra");
    for (const word of forbidden) { expect(line, `${word} in the details for ${message}`).not.toContain(word); expect(inLink, `${word} in the link for ${message}`).not.toContain(word); }
    await closeDialog();
  }
  // plain text around the removed parts stays readable, and a long error is cut
  await page.evaluate(() => window.__app.toast("Could not read file:///Users/someone/x.html", "err"));
  await openFromMenu(); await page.check("#rp-error");
  expect(await page.inputValue("#rp-details")).toContain("- Last error: Could not read [path removed]");
  await closeDialog();
  for (const stay of STAYS) { // ordinary words that only look like names, paths, keys or addresses stay as they are
    await page.evaluate((m) => window.__app.toast(m, "err"), stay);
    await openFromMenu(); await page.check("#rp-error");
    expect(await page.inputValue("#rp-details"), stay).toContain("- Last error: " + stay);
    await closeDialog();
  }
  await page.evaluate(() => window.__app.toast("Boom " + "x ".repeat(450), "err"));
  await openFromMenu(); await page.check("#rp-error");
  const line = (await page.inputValue("#rp-details")).split("\n").find((l) => l.startsWith("- Last error:"));
  expect(line.length).toBeLessThan(330);
  await closeDialog();
});

test("the link carries the browser, what was typed and the edited details, and never the person's own words about the outcome", async () => {
  await openFromMenu();
  await page.fill("#rp-steps", "1. Drag a box\n2. Press Fillet & OK");
  const edited = (await page.inputValue("#rp-details")).split("\n").filter((l) => !l.startsWith("- Mode:")).join("\n") + "\nExtra note: it happens on every design";
  await page.fill("#rp-details", edited);
  const url = await pressOpen();
  expect(url.pathname).toBe("/MaxSikorski/jumpstart-3d/issues/new");
  expect(url.searchParams.get("template")).toBe("bug_report.yml");
  expect(url.searchParams.get("browser")).toMatch(/Chrome/);
  expect(url.searchParams.get("browser")).not.toMatch(/Mozilla|AppleWebKit/); // a short name, never the raw user agent
  expect(url.searchParams.get("steps")).toBe("1. Drag a box\n2. Press Fillet & OK");
  expect(url.searchParams.get("extra")).toBe(edited);
  expect(url.searchParams.get("extra")).not.toContain("- Mode:");
  for (const never of ["outcome", "expected", "title", "labels", "version"]) expect(url.searchParams.has(never), never).toBe(false);
  expect(url.href.length).toBeLessThan(6000);
  await closeDialog();
  // the browser field follows its line: delete the line and the field goes
  await openFromMenu();
  await page.fill("#rp-details", (await page.inputValue("#rp-details")).split("\n").filter((l) => !l.startsWith("- Browser:")).join("\n"));
  expect(new URL(await href()).searchParams.has("browser")).toBe(false);
  await page.fill("#rp-details", "- Browser: Lynx 2 on a toaster");
  expect(new URL(await href()).searchParams.get("browser")).toBe("Lynx 2 on a toaster");
  await closeDialog();
});

test("very long text is cut so the link stays short, with a note where it was cut", async () => {
  await openFromMenu();
  const extra = await page.inputValue("#rp-details");
  await page.fill("#rp-steps", "é& ".repeat(3500));
  const link = new URL(await href());
  expect(link.href.length).toBeLessThan(6000);
  const steps = link.searchParams.get("steps");
  expect(steps.endsWith(CUT_NOTE)).toBe(true);
  expect(steps.length).toBeGreaterThan(200);
  expect(link.searchParams.get("extra")).toBe(extra); // the details are the last thing to give up text
  await page.fill("#rp-steps", "");
  await page.fill("#rp-details", "y".repeat(10_000));
  const long = new URL(await href());
  expect(long.href.length).toBeLessThan(6000);
  expect(long.searchParams.get("extra").endsWith(CUT_NOTE)).toBe(true);
  // a cut that lands inside the Browser line must not put the cut note into the browser field
  await page.fill("#rp-details", "- Browser: " + "y".repeat(10_000));
  const inBrowser = new URL(await href());
  expect(inBrowser.href.length).toBeLessThan(6000);
  expect(inBrowser.searchParams.get("extra").endsWith(CUT_NOTE)).toBe(true);
  expect(inBrowser.searchParams.has("browser"), "browser field when the Browser line was cut").toBe(false);
  await closeDialog();
});

test("details that nearly fill the link never push it over the limit, with or without steps", async () => {
  await openFromMenu();
  await page.fill("#rp-details", "");
  const base = (await href()).length;
  for (let room = 0; room <= 90; room += 3) { // the details leave 0 to 90 characters for the steps
    await page.fill("#rp-details", "d".repeat(5999 - base - room));
    await page.fill("#rp-steps", "");
    expect((await href()).length, `details alone, ${room} spare`).toBeLessThan(6000);
    await page.fill("#rp-steps", "é& ".repeat(2000));
    const link = new URL(await href());
    expect(link.href.length, `with steps, ${room} spare`).toBeLessThan(6000);
    const steps = link.searchParams.get("steps");
    expect(steps === null || steps.endsWith(CUT_NOTE), `steps are cut with a note or left out, ${room} spare`).toBe(true);
    await expect(page.locator("#rp-cut")).toBeVisible();
  }
  await closeDialog();
});

test("Copy the details copies what was typed and the details, even when the link had to leave the steps out", async ({}, info) => {
  if (info.project.name === "site") await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: info.project.use.baseURL });
  else await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const read = () => page.evaluate(() => navigator.clipboard.readText());
  await openFromMenu();
  await page.fill("#rp-steps", "1. Drag a box");
  const details = await page.inputValue("#rp-details");
  await page.click("#rp-copy");
  await expect.poll(read).toBe("1. Drag a box\n\n" + details);
  await page.fill("#rp-steps", "");
  await page.click("#rp-copy");
  await expect.poll(read).toBe(details);
  await page.fill("#rp-steps", "kept in the copy");
  await page.fill("#rp-details", "y".repeat(10_000));
  expect(new URL(await href()).searchParams.has("steps")).toBe(false); // too long for the link
  await expect(page.locator("#rp-cut")).toContainText("left out or cut off");
  await page.click("#rp-copy");
  await expect.poll(read).toBe("kept in the copy\n\n" + "y".repeat(10_000));
  await closeDialog();
});

test("Save a copy gives a project file that opens again, and does not count as a save", async () => {
  const doc = newDoc(DESIGN, "advanced", { bodies: [box("a", 20), box("b", 30)] });
  await loadDoc(page, doc);
  const before = await page.evaluate(() => ({ version: window.__app.projects.version(), bodies: window.__store.doc.bodies.length, name: window.__store.doc.name }));
  await openFromMenu();
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#rp-save")]);
  expect(download.suggestedFilename()).toBe("design-for-bug-report.json");
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const file = Buffer.concat(chunks);
  const saved = JSON.parse(file.toString("utf8"));
  expect(saved.app).toBe("jumpstart-3d");
  expect(saved.doc.bodies).toHaveLength(before.bodies);
  expect(saved.doc.name).toBe(before.name);
  expect(await page.evaluate(() => window.__app.projects.version())).toBe(before.version);
  await closeDialog();
  await page.setInputFiles("#file-import", { name: "design-for-bug-report.json", mimeType: "application/json", buffer: file });
  await expect(page.locator(".toast", { hasText: "Opened " + DESIGN })).toBeVisible();
  await waitIdle(page);
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(before.bodies);
});

test("a design over 25 MB in bytes gets the zip advice, even when it is under 25 million characters", async () => {
  await loadDoc(page, newDoc(DESIGN, "beginner", { bodies: [box("a", 20)] }));
  const save = async (count) => { // the name is made big in place, as a note or a very long name would be, and put back
    await page.evaluate((n) => { window.__nameKept = window.__store.doc.name; window.__store.doc.name = "é".repeat(n); }, count);
    const [download] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => window.__app.projects.saveCopy("design-for-bug-report.json"))]);
    await download.delete();
    await page.evaluate(() => { window.__store.doc.name = window.__nameKept; });
  };
  await save(12_000_000); // 24 MB in 12 million characters
  await expect(page.locator(".toast", { hasText: "over 25 MB" })).toHaveCount(0);
  await save(13_000_000); // 26 MB in 13 million characters
  await expect(page.locator(".toast", { hasText: "over 25 MB" })).toBeVisible();
});

test("About has the same Report a problem entry", async () => {
  await page.click("#btn-about");
  await page.click("#ab-report");
  await expect(page.locator(".modal", { hasText: "Created by J.Siwek" })).toBeHidden();
  await expect(page.locator("#rp-details")).toBeVisible();
  await expect(page.locator("#rp-open")).toBeVisible();
  await closeDialog();
});

test("the issue form still has the fields the link fills in", () => {
  const yml = readFileSync(new URL("../.github/ISSUE_TEMPLATE/bug_report.yml", import.meta.url), "utf8");
  const ids = [...yml.matchAll(/^\s+id: (\w+)\s*$/gm)].map((m) => m[1]);
  for (const id of ["browser", "steps", "extra", "outcome", "expected"]) expect(ids, id).toContain(id);
});

test("nothing but the pressed links went anywhere, in the whole file", async ({}, info) => {
  const sent = outside(info);
  expect(opened).toBeGreaterThan(0);
  expect(sent.map((r) => [r.type, r.method, new URL(r.url).hostname, r.body])).toEqual(Array(opened).fill(["document", "GET", "github.com", null]));
  expect(requests.filter((r) => r.method !== "GET" || r.body), "the page uploaded something").toEqual([]);
  expect(sockets, "WebSockets opened").toEqual([]);
});
