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

let page, errors, github;
test.beforeAll(async ({ browser }, info) => {
  const context = await browser.newContext();
  github = [];
  // GitHub is a stub: the test never reaches the real site, and every request to it is counted
  await context.route("https://github.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
  context.on("request", (r) => { if (new URL(r.url()).hostname === "github.com") github.push({ url: r.url(), type: r.resourceType() }); });
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
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.click("#rp-open")]);
  await popup.waitForLoadState();
  const url = popup.url();
  await popup.close();
  return new URL(url);
}

test("nothing goes to GitHub until the link is pressed, and then exactly one page is opened", async () => {
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
  expect(github, "requests to github.com before the link is pressed").toEqual([]);
  const link = page.locator("#rp-open");
  expect(await link.getAttribute("href")).toMatch(/^https:\/\/github\.com\/MaxSikorski\/jumpstart-3d\/issues\/new\?/);
  expect(await link.getAttribute("target")).toBe("_blank");
  expect(await link.getAttribute("rel")).toContain("noreferrer");
  const url = await pressOpen();
  expect(url.hostname).toBe("github.com");
  expect(github.filter((r) => r.type === "document")).toHaveLength(1);
  await expect(dialog).toContainText("Finish it on GitHub");
  await closeDialog();
});

test("the details hold the build, where, browser, mode and the real last error, and nothing of the design", async ({}, info) => {
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
  expect(text).toContain("Last error shown: That file isn't a JumpStart 3D project file.");
  expect(text).toContain("Design file:");
  for (const secret of [DESIGN, "file://", "/Users", page.url()]) expect(text).not.toContain(secret);
  await closeDialog();

  // paths inside an error text are taken out; the text around them stays
  await page.evaluate(() => window.__app.toast("Could not read file:///Users/someone/x.html or C:\\Users\\bob\\y.stl or /home/bob/z.step or blob:null/1234-abcd", "err"));
  await openFromMenu();
  const cleaned = await page.inputValue("#rp-details");
  expect(cleaned).toContain("Last error shown: Could not read [path removed]");
  expect(cleaned).toContain("[path removed]");
  for (const secret of ["file:/", "blob:", "someone", "bob", "/Users", "/home", "C:\\"]) expect(cleaned).not.toContain(secret);
  await closeDialog();

  // a long error is cut
  await page.evaluate(() => window.__app.toast("Boom " + "x".repeat(900), "err"));
  await openFromMenu();
  const line = (await page.inputValue("#rp-details")).split("\n").find((l) => l.startsWith("- Last error shown:"));
  expect(line.length).toBeLessThan(340);
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
