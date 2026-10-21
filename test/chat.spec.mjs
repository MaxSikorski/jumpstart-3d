// Chat inside the app, on both builds. A stand-in model server (test/mockmodel.mjs) runs in this process and answers in the
// Ollama, OpenAI and Anthropic shapes from a script, so the tests cover the panel, the loop, the tools and the adapters
// without a real model. The single build is opened from disk (origin null), so the mock sends CORS headers on everything.
// Each test opens its own page: the chat reads its stored settings once, when the app starts.
import { test, expect } from "@playwright/test";
import { boot, reload, watchErrors } from "./helpers.mjs";
import { startMock } from "./mockmodel.mjs";

const BOX_WITH_HOLE = 40 * 30 * 20 - Math.PI * 4 * 4 * 20;
let mock, page, errors, netNoise;

test.beforeAll(async () => { mock = await startMock(); });
test.afterAll(async () => { await mock.close(); });
test.afterEach(async () => {
  // a refused connection is logged by Chromium itself; only the test about it expects that line
  const real = errors.filter((e) => !(netNoise && /Failed to load resource|ERR_CONNECTION|CORS/.test(e)));
  await page.close();
  expect(real, "console or page errors").toEqual([]);
});

// open a fresh page with the chat settings already stored (null: store none, for the settings test)
async function open(browser, info, settings) {
  netNoise = false;
  mock.reset();
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript((s) => {
    try { localStorage.setItem("jumpstart.chisel.intro", "1"); if (s) localStorage.setItem("jumpstart.chat", JSON.stringify(s)); } catch (e) {}
  }, settings);
  await boot(page, info);
  await page.click("#btn-chat");
  await expect(page.locator("#chat")).toBeVisible();
}
// stored settings in the current shape: one entry per provider; keys only come back when remember is true
const stored = (provider, entry, extra = {}) => ({ provider, remember: true, scripts: false, per: { [provider]: entry }, ...extra });
const anthropic = (extra = {}) => stored("anthropic", { url: mock.url + "/v1", model: "mock-tools", key: "k-test", vision: true, ...extra });
const ask = async (text) => { await page.fill("#chat-input", text); await page.press("#chat-input", "Enter"); };
const done = () => expect(page.locator("#chat-send")).toBeEnabled();
const summaries = () => page.locator("#chat-messages .chat-msg.tool > summary").allTextContents();
const list = () => page.evaluate(async () => { await JS3D.ready(); return JS3D.list(); });
const idOf = (r) => (typeof r === "string" ? r : r.id);
const wireTools = (req) => req.body.tools.map((t) => t.name || t.function?.name);

test("a block with a hole, over the Anthropic shape: five tool calls, an answer, and the right solid", async ({ browser }, info) => {
  test.setTimeout(180_000);
  await open(browser, info, anthropic());
  mock.script = [
    { tool: "add_shape", args: { kind: "box", size: { w: 40, d: 30, h: 20 }, name: "Block" } },
    { tool: "add_shape", args: { kind: "cylinder", size: { w: 8, d: 8, h: 30 }, at: [0, 0, -5], hole: true } },
    (req, results) => ({ tool: "group_bodies", args: { ids: [idOf(results[0]), idOf(results[1])], name: "Block with hole" } }),
    { tool: "wait_ready", args: {} },
    { tool: "screenshot", args: { width: 400 } },
    { text: "Done: a block with a hole." },
  ];
  await ask("Make a 40 by 30 by 20 block with an 8 mm hole through it");
  await done();

  await expect(page.locator("#chat-messages .chat-msg").last()).toHaveClass(/assistant/);
  await expect(page.locator("#chat-messages .chat-msg").last()).toHaveText("Done: a block with a hole.");
  const rows = await summaries();
  expect(rows).toHaveLength(5);
  ["add_shape →", "add_shape →", "group_bodies →", "wait_ready →", "screenshot →"].forEach((p, i) => expect(rows[i].startsWith(p), rows[i]).toBe(true));
  await expect(page.locator("#chat-status")).toHaveText("");

  const bodies = await list();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].name).toBe("Block with hole");
  expect(Math.abs(bodies[0].volume - BOX_WITH_HOLE)).toBeLessThan(1);

  // the assistant content arrays were sent back exactly as received, thinking block included, and every result names its call
  expect(mock.requests).toHaveLength(6);
  const last = mock.requests[5].body;
  expect(last.system).toBeTruthy();
  expect(last.tools.map((t) => t.name)).not.toContain("run_script");
  const assistants = last.messages.filter((m) => m.role === "assistant");
  expect(assistants.map((m) => m.content)).toEqual(mock.sent.slice(0, 5));
  const users = last.messages.filter((m) => m.role === "user");
  expect(users).toHaveLength(6); // the person's message, then one per call
  for (let i = 0; i < 5; i++) {
    const useIds = assistants[i].content.filter((b) => b.type === "tool_use").map((b) => b.id);
    const resultIds = users[i + 1].content.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id);
    expect(useIds.length).toBe(1);
    expect(resultIds).toEqual(useIds);
  }
  // vision was on: the screenshot result holds an image block after its text block
  const shot = users[5].content[0].content;
  expect(shot[0].type).toBe("text");
  expect(shot.some((b) => b.type === "image" && b.source.media_type === "image/png" && b.source.data.length > 100)).toBe(true);
  // the headers the browser needs for Anthropic
  const h = mock.requests[0].headers;
  expect(h["x-api-key"]).toBe("k-test");
  expect(h["anthropic-version"]).toBe("2023-06-01");
  expect(h["anthropic-dangerous-direct-browser-access"]).toBe("true");
});

test("OpenAI shape: one tool call, the key goes in the Authorization header, the arguments reach the design", async ({ browser }, info) => {
  test.setTimeout(180_000);
  await open(browser, info, stored("openai", { url: mock.url + "/v1", model: "mock-tools", key: "sk-test", vision: false }));
  mock.script = [{ tool: "add_shape", args: { kind: "sphere", size: { w: 20, d: 20, h: 20 }, name: "Ball" } }, { text: "Added a ball." }];
  await ask("add a ball, 20 mm");
  await done();
  await expect(page.locator("#chat-messages .chat-msg").last()).toHaveText("Added a ball.");
  const [req, again] = mock.requests;
  expect(req.path).toBe("/v1/chat/completions");
  expect(req.headers.authorization).toBe("Bearer sk-test");
  expect(typeof req.body.messages[0].content).toBe("string"); // the system message
  expect(wireTools(req)).toContain("add_shape");
  expect(wireTools(req)).not.toContain("run_script");
  // the call went back as the assistant message with its tool_calls, then a tool message with the same id
  const asst = again.body.messages.find((m) => m.role === "assistant");
  const tool = again.body.messages.find((m) => m.role === "tool");
  expect(typeof asst.tool_calls[0].function.arguments).toBe("string");
  expect(tool.tool_call_id).toBe(asst.tool_calls[0].id);
  const bodies = await list();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ name: "Ball", kind: "sphere" });
  expect(Math.abs(bodies[0].volume - (4 / 3) * Math.PI * 1000)).toBeLessThan(50);
});

test("Ollama shape: stream off, a bigger context, tool_name on the result", async ({ browser }, info) => {
  test.setTimeout(180_000);
  await open(browser, info, stored("ollama", { url: mock.url, model: "mock-tools", vision: false }, { remember: false }));
  mock.script = [{ tool: "add_shape", args: { kind: "box", size: { w: 10, d: 10, h: 10 } } }, { text: "A box." }];
  await ask("a small box");
  await done();
  await expect(page.locator("#chat-messages .chat-msg").last()).toHaveText("A box.");
  const [req, again] = mock.requests;
  expect(req.path).toBe("/api/chat");
  expect(req.body.stream).toBe(false);
  expect(req.body.options.num_ctx).toBeGreaterThanOrEqual(32768);
  expect(req.body.tools[0].type).toBe("function");
  const tool = again.body.messages.find((m) => m.role === "tool");
  expect(tool.tool_name).toBe("add_shape");
  expect(typeof tool.content).toBe("string");
  expect(again.body.messages.find((m) => m.role === "assistant").tool_calls[0].function.arguments.kind).toBe("box");
  expect(await list()).toHaveLength(1);
});

test("settings persist per provider; a key is stored only when Remember is ticked", async ({ browser }, info) => {
  await open(browser, info, null);
  const text = () => page.evaluate(() => localStorage.getItem("jumpstart.chat"));
  const parsed = async () => JSON.parse(await text());
  await expect(page.locator("#chat-settings")).toHaveJSProperty("open", true); // nothing stored yet: settings start open
  await page.selectOption("#chat-provider", "anthropic");
  await page.fill("#chat-url", mock.url + "/v1");
  await page.fill("#chat-model", "m1");
  await page.fill("#chat-key", "k1");
  expect(await text()).not.toContain('"key"'); // Remember is off

  // each provider keeps its own fields: Ollama shows its defaults and no key; Anthropic comes back with everything, key included
  await page.selectOption("#chat-provider", "ollama");
  expect(await page.inputValue("#chat-url")).toBe("http://localhost:11434");
  expect(await page.inputValue("#chat-key")).toBe("");
  await page.selectOption("#chat-provider", "anthropic");
  expect(await page.inputValue("#chat-url")).toBe(mock.url + "/v1");
  expect(await page.inputValue("#chat-model")).toBe("m1");
  expect(await page.inputValue("#chat-key")).toBe("k1");

  await reload(page);
  await page.click("#btn-chat");
  expect(await page.inputValue("#chat-provider")).toBe("anthropic");
  expect(await page.inputValue("#chat-url")).toBe(mock.url + "/v1");
  expect(await page.inputValue("#chat-model")).toBe("m1");
  expect(await page.inputValue("#chat-key")).toBe("");

  await page.locator("#chat-settings > summary").click();
  await page.check("#chat-remember");
  await page.fill("#chat-key", "k1");
  expect((await parsed()).per.anthropic.key).toBe("k1");
  await reload(page);
  await page.click("#btn-chat");
  expect(await page.inputValue("#chat-key")).toBe("k1");
  expect(await page.isChecked("#chat-remember")).toBe(true);

  await page.locator("#chat-settings > summary").click();
  await page.uncheck("#chat-remember");
  expect(await text()).not.toContain('"key"');
  const s = await parsed();
  expect(s.remember).toBe(false);
  expect(s.per.anthropic.model).toBe("m1");
  expect(mock.requests).toEqual([]); // opening the panel and changing settings sends nothing
  expect(mock.gets).toEqual([]);
});

test("a key typed for one provider is never sent to another", async ({ browser }, info) => {
  await open(browser, info, null);
  await page.selectOption("#chat-provider", "anthropic");
  await page.fill("#chat-key", "k-anthropic");
  await page.selectOption("#chat-provider", "ollama");
  await page.fill("#chat-url", mock.url);
  await page.fill("#chat-model", "mock-tools");
  mock.script = [{ text: "hello" }];
  await ask("hi");
  await expect(page.locator("#chat-messages .chat-msg").last()).toHaveText("hello");
  expect(mock.requests).toHaveLength(1);
  expect(mock.requests[0].path).toBe("/api/chat");
  expect(mock.requests[0].headers.authorization).toBeUndefined();
  expect(mock.requests[0].headers["x-api-key"]).toBeUndefined();
});

test("switching provider in the middle of a chat: the earlier turns are rebuilt in the new provider's shape", async ({ browser }, info) => {
  test.setTimeout(180_000);
  await open(browser, info, stored("ollama", { url: mock.url, model: "mock-tools", vision: false }, {
    per: { ollama: { url: mock.url, model: "mock-tools", vision: false }, anthropic: { url: mock.url + "/v1", model: "mock-tools", key: "k-test", vision: false } },
  }));
  mock.script = [{ tool: "add_shape", args: { kind: "box", size: { w: 10, d: 10, h: 10 } } }, { text: "A box." }, { text: "Now on Anthropic." }];
  await ask("a small box");
  await done();
  await expect(page.locator("#chat-messages .chat-msg").last()).toHaveText("A box.");

  await page.locator("#chat-settings > summary").click();
  await page.selectOption("#chat-provider", "anthropic");
  await ask("thanks");
  await done();
  await expect(page.locator("#chat-messages .chat-msg").last()).toHaveText("Now on Anthropic.");
  const req = mock.requests.at(-1);
  expect(req.path).toBe("/v1/messages");
  const [first, toolTurn, results, answer] = req.body.messages.slice(0, 4).map((m) => m.content);
  expect(first).toBe("a small box");
  expect(Array.isArray(toolTurn)).toBe(true);
  const use = toolTurn.find((b) => b.type === "tool_use");
  expect(use).toMatchObject({ name: "add_shape", input: { kind: "box" } });
  expect(results[0]).toMatchObject({ type: "tool_result", tool_use_id: use.id });
  expect(answer).toEqual([{ type: "text", text: "A box." }]);
  expect(req.body.messages.at(-1).content).toBe("thanks");
});

test("an empty reply shows a note, stores nothing, and the next message still works", async ({ browser }, info) => {
  await open(browser, info, anthropic());
  mock.script = [{ empty: true }, { text: "Here I am." }];
  await ask("hello?");
  await expect(page.locator("#chat-messages .chat-msg.error")).toHaveText("The model gave no answer.");
  await done();
  await ask("hello again");
  await expect(page.locator("#chat-messages .chat-msg").last()).toHaveText("Here I am.");
  const sent = mock.requests[1].body.messages;
  expect(sent.filter((m) => m.role === "assistant")).toEqual([]); // no empty assistant message went back
  expect(sent.map((m) => m.content)).toEqual(["hello?", "hello again"]);
});

test("a server that is not there: an error row and the Ollama hint, no shapes added", async ({ browser }, info) => {
  await open(browser, info, stored("ollama", { url: "http://127.0.0.1:1", model: "x", vision: false }, { remember: false }));
  netNoise = true;
  await ask("make a box");
  await expect(page.locator("#chat-messages .chat-msg.error")).toBeVisible();
  await expect(page.locator("#chat-messages .chat-msg.hint")).toContainText("OLLAMA_ORIGINS");
  await done();
  expect(await page.evaluate(() => JS3D.list().length)).toBe(0);
});

test("Stop ends the run at once: one shape, a Stopped note, the Send button back", async ({ browser }, info) => {
  test.setTimeout(180_000);
  await open(browser, info, anthropic());
  mock.script = [{ tool: "add_shape", args: { kind: "box", size: { w: 10, d: 10, h: 10 } } }, { text: "never shown", delayMs: 8000 }];
  await ask("a box, then think for a long time");
  await expect(page.locator("#chat-messages .chat-msg.tool")).toHaveCount(1);
  await expect(page.locator("#chat-stop")).toBeEnabled();
  await page.click("#chat-stop");
  await expect(page.locator("#chat-status")).toHaveText("Stopped");
  await expect(page.locator("#chat-messages .chat-msg.error").last()).toHaveText("Stopped.");
  await expect(page.locator("#chat-send")).toBeEnabled();
  await expect(page.locator("#chat-stop")).toBeDisabled();
  expect(await list()).toHaveLength(1);
  await expect(page.locator("#chat-messages")).not.toContainText("never shown");
});

test("a model that never stops calling tools is cut off after 30 calls", async ({ browser }, info) => {
  test.setTimeout(180_000);
  await open(browser, info, stored("openai", { url: mock.url + "/v1", model: "mock-tools", key: "k", vision: false }, { remember: false }));
  mock.script = Array.from({ length: 40 }, () => ({ tool: "fit_view", args: {} }));
  await ask("keep going");
  await expect(page.locator("#chat-messages .chat-msg.error").last()).toContainText("30 tool calls");
  await done();
  await expect(page.locator("#chat-messages .chat-msg.tool")).toHaveCount(30);
  expect(mock.requests.length).toBeLessThanOrEqual(31);
});

test("run_script is refused until Allow scripts is ticked", async ({ browser }, info) => {
  test.setTimeout(180_000);
  await open(browser, info, stored("openai", { url: mock.url + "/v1", model: "mock-tools", key: "k", vision: false }, { remember: false }));
  let seen;
  mock.script = [{ tool: "run_script", args: { code: "1+1" } }, (req, results) => { seen = results; return { text: "It said no." }; }];
  await ask("run 1+1");
  await done();
  expect((await summaries())[0]).toMatch(/^run_script → error: Scripts are off/);
  expect(seen).toHaveLength(1);
  expect(String(seen[0])).toContain("Scripts are off");
  expect(wireTools(mock.requests[0])).not.toContain("run_script"); // left out of the list while off

  await page.locator("#chat-settings > summary").click();
  await page.check("#chat-scripts");
  await page.click("#chat-new");
  await expect(page.locator("#chat-messages .chat-msg")).toHaveCount(0);
  mock.script = [{ tool: "run_script", args: { code: "1+1" } }, { text: "It is 2." }];
  await ask("run 1+1");
  await done();
  expect((await summaries())[0]).toBe("run_script → 2");
  expect(wireTools(mock.requests.at(-1))).toContain("run_script");
});
