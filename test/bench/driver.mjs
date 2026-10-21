import { JudgeError, MAX_STL_BYTES, compare, plannedRow, sha256, topology } from "./score.mjs";

export const CHROMIUM_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"];
export const limitsFor = (mode) => ({ bootMs: 120000, caseMs: mode === "mock" ? 90000 : 300000,
  providerMs: 120000, readyMs: 60000, exportMs: 30000, runMs: mode === "mock" ? 480000 : 3600000,
  providerRequests: 31, toolCalls: 30, stlBytes: MAX_STL_BYTES, triangles: 200000, fixtureBytes: 1048576, requestCharacters: 2000 });

export function redact(value) {
  return String(value).replace(/(?:authorization|proxy-authorization|x-api-key|api[_-]?key|cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi, "[redacted header]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/https?:\/\/[^\s"'<>]+/g, (s) => {
      try { const u = new URL(s); u.username = ""; u.password = ""; u.search = ""; u.hash = ""; return u.href; } catch { return "[address]"; }
    }).slice(0, 1000);
}

async function bounded(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new JudgeError(message)), Math.max(1, ms)); })]); }
  finally { clearTimeout(timer); }
}

export async function driveCase({ browser, url, build, fixture, case: c, providerUrl, model = "mock-tools", mode = "mock", limits: overrides = {}, signal, allowConsoleError = () => false }) {
  const limits = { ...limitsFor(mode), ...overrides }, row = plannedRow(c), metadata = {};
  const evidence = { toolNames: [], userRows: 0, consoleErrors: [], chatErrors: [] };
  const endpoint = providerUrl.replace(/\/$/, "") + "/api/chat";
  let context, page, sentAt = null, timer, fatalError, rejectFatal, disposing = false;
  const fatal = new Promise((_, reject) => { rejectFatal = reject; });
  fatal.catch(() => {});
  const fail = (error) => { if (!fatalError) { fatalError = error; rejectFatal(error); } };
  const abort = () => {
    const reason = signal.reason?.message || "chat judge: interrupted before case ran";
    fail(new JudgeError(reason === "chat judge: interrupted before case ran" ? "chat judge: interrupted during case" : reason, `${c.id} was in flight`));
  };
  const providerTimers = new Map();
  const step = (promise, ms, message) => Promise.race([bounded(promise, ms, message), fatal]);
  const capture = async () => {
    if (!page || page.isClosed()) return;
    const data = await bounded(page.evaluate(() => ({
      tools: [...document.querySelectorAll("#chat-messages .chat-msg.tool > summary")].map((e) => e.textContent),
      users: document.querySelectorAll("#chat-messages .chat-msg.user").length,
      errors: [...document.querySelectorAll("#chat-messages .chat-msg.error")].map((e) => e.textContent),
    })), 1000, "chat judge: page failed");
    row.toolCalls = data.tools.length;
    row.toolErrors = data.tools.filter((s) => s.includes(" → error: ")).map((s) => ({ tool: s.split(" →")[0], detail: redact(s.split(" → error: ")[1]) }));
    evidence.toolNames = data.tools.map((s) => s.split(" →")[0]); evidence.userRows = data.users; evidence.chatErrors = data.errors;
  };
  if (signal) { signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); }
  try {
    const bootMessage = `chat judge: could not boot ${build} within 120 s`, bootEnd = Date.now() + limits.bootMs;
    const boot = (promise) => step(promise, bootEnd - Date.now(), bootMessage);
    context = await boot(browser.newContext({ viewport: { width: 1400, height: 880 }, serviceWorkers: "block", acceptDownloads: false }).then(async (created) => {
      if (disposing) { await created.close(); throw new JudgeError(bootMessage); }
      context = created; return created;
    }));
    await boot(context.addInitScript(({ providerUrl, model }) => {
      localStorage.setItem("jumpstart.chisel.intro", "1");
      localStorage.setItem("jumpstart.meshdetail", "normal");
      localStorage.setItem("jumpstart.chat", JSON.stringify({ provider: "ollama", remember: false, scripts: false,
        per: { ollama: { url: providerUrl, model, vision: false, key: "" } } }));
    }, { providerUrl, model }));
    page = await boot(context.newPage());
    page.on("pageerror", (error) => fail(new JudgeError("chat judge: page failed", redact(error.message))));
    page.on("crash", () => fail(new JudgeError("chat judge: page failed", "browser page crashed")));
    page.on("console", (msg) => {
      if (msg.type() !== "error" || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(msg.location().url || "")) return;
      // A provider HTTP error also logs "Failed to load resource"; the app's own error row says what went wrong.
      if (msg.text().startsWith("Failed to load resource") && (msg.location().url || "").startsWith(endpoint)) return;
      if (allowConsoleError(msg)) return;
      evidence.consoleErrors.push(redact(msg.text()));
      fail(new JudgeError("chat judge: page failed", redact(msg.text())));
    });
    page.on("request", (request) => {
      if (request.method() !== "POST" || request.url() !== endpoint) return;
      row.providerRequests++;
      if (row.providerRequests > limits.providerRequests) { fail(new JudgeError("chat judge: exceeded 31 provider requests")); return; }
      if (metadata.systemSha256 === undefined) {
        try {
          const body = request.postDataJSON();
          if (body.model !== model) throw new Error("outgoing model differs from the preflighted tag");
          const system = body.messages.find((m) => m.role === "system")?.content;
          if (typeof system !== "string" || !Array.isArray(body.tools)) throw new Error("missing outgoing system text or tools");
          metadata.systemSha256 = sha256(system); metadata.toolsSha256 = sha256(JSON.stringify(body.tools)); metadata.toolCount = body.tools.length;
        } catch (e) { fail(new JudgeError("chat judge: page failed", redact(e.message))); }
      }
      providerTimers.set(request, setTimeout(() => fail(new JudgeError("chat judge: provider request exceeded 120 s")), limits.providerMs));
    });
    const finished = (request) => { clearTimeout(providerTimers.get(request)); providerTimers.delete(request); };
    page.on("requestfinished", finished); page.on("requestfailed", finished);
    await boot(page.goto(url, { timeout: limits.bootMs }));
    await boot(page.waitForFunction(() => window.JS3D && window.__app?.kernel?.ready, null, { timeout: limits.bootMs }));
    await boot(page.waitForSelector("#loading", { state: "hidden", timeout: limits.bootMs }));
    await boot(page.waitForFunction(() => window.__app.projects.started === true, null, { timeout: limits.bootMs }));
    const initial = await boot(page.evaluate(async () => {
      await JS3D.newDesign("beginner"); await JS3D.ready();
      return { count: JS3D.list().length, appVersion: JS3D.appVersion, bridgeVersion: JS3D.version };
    }));
    if (initial.count !== 0) throw new JudgeError("chat judge: geometry is missing or failed to build", "initial design was not empty");
    Object.assign(metadata, { appVersion: initial.appVersion, bridgeVersion: initial.bridgeVersion });
    await boot(page.click("#btn-chat"));
    await boot(page.fill("#chat-input", fixture.preamble + "\n" + c.request));
    sentAt = Date.now();
    const caseMessage = `chat judge: ${c.id} exceeded ${limits.caseMs / 1000} s`;
    timer = setTimeout(() => fail(new JudgeError(caseMessage)), limits.caseMs);
    const remaining = () => Math.max(1, limits.caseMs - (Date.now() - sentAt));
    const stage = (promise, limit, message) => {
      const left = remaining();
      return step(promise, Math.min(limit, left), left <= limit ? caseMessage : message);
    };
    const started = await step(page.evaluate(() => {
      document.getElementById("chat-send").click();
      return document.getElementById("chat-send").disabled && !document.getElementById("chat-stop").disabled;
    }), remaining(), caseMessage);
    if (!started) throw new JudgeError("chat judge: chat did not finish normally", "Send did not enter its busy state");
    await step(page.waitForFunction(() => !document.getElementById("chat-send").disabled && document.getElementById("chat-stop").disabled, null, { timeout: limits.caseMs }), remaining(), caseMessage);
    await capture();
    const completion = await step(page.evaluate(() => {
      const last = document.querySelector("#chat-messages .chat-msg:last-child");
      return { errors: [...document.querySelectorAll("#chat-messages .chat-msg.error")].map((e) => e.textContent),
        answered: !!last?.classList.contains("assistant") && !!last.textContent.trim() };
    }), remaining(), caseMessage);
    if (completion.errors.length || !completion.answered) throw new JudgeError("chat judge: chat did not finish normally", completion.errors.map(redact).join("; ") || "no final non-empty assistant row");
    const readyMessage = "chat judge: geometry did not become ready within 60 s";
    try { await stage(page.evaluate((ms) => JS3D.ready(ms), Math.min(limits.readyMs, remaining())), limits.readyMs, readyMessage); }
    catch (e) { if (fatalError) throw fatalError; if (e.message === caseMessage) throw e; throw new JudgeError(readyMessage, redact(e.detail || e.message)); }
    const bodies = await step(page.evaluate(() => JS3D.list().map((b) => JS3D.get(b.id))), remaining(), caseMessage);
    const observed = { bodies: bodies.length, volumeMm3: null, bboxMm: null, holes: null, topology: null };
    const body = bodies[0], visibleSolid = bodies.length === 1 && !body.hidden && !body.hole;
    if (!visibleSolid) { compare(row, observed, fixture.tolerance, false); }
    else {
      observed.volumeMm3 = body.volume; observed.bboxMm = body.bbox;
      if (body.error || !Number.isFinite(body.volume) || body.volume <= 0 || !body.bbox || ![body.bbox.min, body.bbox.max].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) {
        row.observed = observed; row.metrics.body = true;
        throw new JudgeError("chat judge: geometry is missing or failed to build", body.error && redact(body.error));
      }
      // Keep the measured metrics if topology cannot be measured.
      compare(row, observed, fixture.tolerance); row.messages = row.messages.filter((m) => m !== "chat judge: geometry is missing or failed to build");
      const encoded = await stage(page.evaluate(async ({ id, cap }) => {
        const bytes = await JS3D.export("stl", { ids: [id] });
        if (bytes.length > cap) return { oversize: true };
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return { base64: btoa(binary) };
      }, { id: body.id, cap: MAX_STL_BYTES }), limits.exportMs, "chat judge: STL export exceeded 30 s");
      if (encoded.oversize) throw new JudgeError("chat judge: STL exceeds 200000 triangles");
      observed.topology = topology(Buffer.from(encoded.base64, "base64")); observed.holes = observed.topology.holes;
      row.messages = []; row.metrics = { body: null, volume: null, bbox: null, holes: null };
      compare(row, observed, fixture.tolerance);
    }
    if (Date.now() - sentAt > limits.caseMs) throw new JudgeError(caseMessage);
    if (fatalError) throw fatalError;
  } catch (error) {
    const e = fatalError || error;
    row.status = "error";
    row.messages.push(e instanceof JudgeError ? e.message : sentAt === null ? `chat judge: could not boot ${build} within 120 s` : "chat judge: page failed");
    const detail = e instanceof JudgeError ? e.detail : e.message;
    if (detail) row.messages.push({ detail: typeof detail === "string" ? redact(detail) : detail });
  } finally {
    disposing = true;
    clearTimeout(timer); for (const t of providerTimers.values()) clearTimeout(t);
    signal?.removeEventListener("abort", abort);
    if (page && !page.isClosed()) {
      try { await capture(); } catch { /* A closed or unresponsive page has no readable transcript. */ }
      try { await bounded(page.evaluate(() => { const stop = document.getElementById("chat-stop"); if (stop && !stop.disabled) stop.click(); }), 500, "chat judge: page failed"); } catch { /* Closing the context also aborts its requests and builds. */ }
    }
    if (context) await context.close();
    if (fatalError && row.status !== "error") {
      row.status = "error"; row.messages.push(fatalError.message);
      if (fatalError.detail) row.messages.push({ detail: redact(fatalError.detail) });
    }
    const chatErrors = evidence.chatErrors.map(redact).join("; ");
    if (row.status === "error" && chatErrors && !row.messages.some((m) => m.detail === chatErrors)) row.messages.push({ detail: chatErrors });
    row.elapsedMs = sentAt === null ? 0 : Date.now() - sentAt;
  }
  return { row, metadata, evidence };
}
