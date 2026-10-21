// jumpstart-3d: chat inside the app. The "AI" button opens a side panel: pick a model (a local server
// or a hosted API), type what you want, and this module runs the tool-calling loop in the page. The
// model acts only through the tools in chattools.js, which call JS3D (see BRIDGE.md). The wire formats
// live in chatproviders.js. Nothing runs at load but reading the saved settings; nothing is sent
// anywhere until Send. Each provider keeps its own address, model and key; a key is saved only when "Remember key" is ticked.
import { TOOLS, runTool } from "./chattools.js";
import { PROVIDERS } from "./chatproviders.js";
import { store } from "./store.js";
import { el } from "./util.js";

const KEY = "jumpstart.chat";
const MAX_CALLS = 30; // tool calls per Send; the person can send another message to go on

const SYSTEM = `You are an assistant inside JumpStart 3D, a CAD app that runs in the browser. You change the open design only through your tools; the person watches it update.
Lengths are millimetres, angles degrees, positions [x, y, z] with z up.

How to work:
- Build with add_shape, then set_hole, move_bodies, resize_shape, group_bodies. list_kinds shows the 20 shape kinds and their size keys.
- Call wait_ready, then list_bodies to check sizes and volumes. A body with an error did not build: read the message, fix it, or undo.
- After every few edits take a screenshot and look at it. If you cannot see images, trust list_bodies instead.
- export_file offers a download in the person's browser. Say that you offered it, with the file name.
- Sketches, extrudes, revolves, fillets and chamfers have no tool. If run_script is among your tools, use it only for what no other tool can do.

Facts to keep straight:
- add_shape puts the middle of the shape's footprint at "at" [x, y] and its base at "at" z. Default [0, 0, 0].
- Sizes are {w, d, h} (width x, depth y, height z). Never guess an id: use ids returned by add_shape, group_bodies or list_bodies.
- Shapes build in the background. volume and bbox in list_bodies are null until wait_ready. screenshot and export_file wait by themselves.
- A hole is a cutter, not a part. It does nothing until group_bodies combines it with a solid. A group stays at [0, 0, 0]; read bbox for where it is.

Mistakes to avoid:
- Reading volume before wait_ready, or rotating or scaling before wait_ready.
- Calling group_bodies with a hole alone.
- Forgetting that "at" z is the base of the shape, not its middle.
- new_design, unless asked: it replaces what is on screen.
- Saying a file exists when you did not call export_file.

Example, a 40 x 30 x 20 block with an 8 mm hole straight through:
1. add_shape {kind: "box", size: {w: 40, d: 30, h: 20}, name: "Block"} returns an id.
2. add_shape {kind: "cylinder", size: {w: 8, d: 8, h: 30}, at: [0, 0, -5], hole: true} returns an id.
3. group_bodies {ids: [both ids], name: "Block with hole"}.
4. wait_ready, then list_bodies: one body, volume about 22994.7. Then screenshot.

Answer in the user's language. Keep replies short.`;

const HINT_MORE = "If the browser asked about local network access, allow it. Safari may block localhost from the website; use the single file there.";
const HINTS = {
  ollama: "Ollama refused the page, or is not running. Run Ollama with `OLLAMA_ORIGINS=\"*\"` and restart it (macOS: `launchctl setenv OLLAMA_ORIGINS \"*\"` then quit and reopen Ollama; Linux: `systemctl edit ollama.service` and add `Environment=\"OLLAMA_ORIGINS=*\"`; Windows: add the user environment variable OLLAMA_ORIGINS = *). The single file (opened from disk) needs the same setting.\n" + HINT_MORE,
  lmstudio: "LM Studio refused the page, or its server is not running. In LM Studio, Developer → Server Settings → Enable CORS (or `lms server start --cors`), then start the server.\n" + HINT_MORE,
};

export function initChat(app) {
  const $ = (id) => document.getElementById(id);
  const panel = $("chat"), openBtn = $("btn-chat");
  if (!panel || !openBtn) return;
  const f = { // the form fields
    provider: $("chat-provider"), url: $("chat-url"), model: $("chat-model"), key: $("chat-key"),
    remember: $("chat-remember"), vision: $("chat-vision"), scripts: $("chat-scripts"),
  };
  const box = $("chat-messages"), input = $("chat-input"), status = $("chat-status");
  const sendBtn = $("chat-send"), stopBtn = $("chat-stop"), newBtn = $("chat-new");

  for (const [id, p] of Object.entries(PROVIDERS)) f.provider.append(el("option", { value: id }, p.label));

  // ---- settings: the only thing read at load. Each provider keeps its own address, model, picture setting and key,
  // so a key typed for one server is never sent to another.
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* private mode or bad JSON: use defaults */ }
  if (!stored || typeof stored !== "object" || !PROVIDERS[stored.provider] || !stored.per || typeof stored.per !== "object") stored = null;
  $("chat-settings").open = !stored;
  const per = {}; // provider id -> { url, model, vision, key }
  let current = stored ? stored.provider : "ollama";
  if (stored) {
    for (const id of Object.keys(PROVIDERS)) if (stored.per[id] && typeof stored.per[id] === "object") per[id] = stored.per[id];
    f.remember.checked = !!stored.remember;
    f.scripts.checked = !!stored.scripts;
  }
  const show = (id) => {
    const p = PROVIDERS[id], v = per[id] || {};
    f.url.value = v.url || p.defaultUrl;
    f.model.value = typeof v.model === "string" ? v.model : p.defaultModel;
    f.vision.checked = typeof v.vision === "boolean" ? v.vision : p.vision;
    f.key.value = typeof v.key === "string" ? v.key : "";
    f.key.placeholder = p.needsKey ? "API key" : "not needed for a local server";
  };
  const collect = () => { per[current] = { url: f.url.value.trim(), model: f.model.value.trim(), vision: f.vision.checked, key: f.key.value.trim() }; };
  f.provider.value = current;
  show(current);
  const settings = () => {
    collect();
    const { url, ...rest } = per[current];
    return { provider: current, ...rest, url: url || PROVIDERS[current].defaultUrl, remember: f.remember.checked, scripts: f.scripts.checked };
  };
  const save = () => {
    const s = settings();
    const out = {};
    for (const [id, { key, ...v }] of Object.entries(per)) out[id] = s.remember && key ? { ...v, key } : v; // unticking drops every key on this save
    try { localStorage.setItem(KEY, JSON.stringify({ provider: current, remember: s.remember, scripts: s.scripts, per: out })); } catch (e) { /* storage blocked: settings last until reload */ }
  };
  f.provider.addEventListener("change", () => { collect(); current = f.provider.value; show(current); save(); });
  for (const e of Object.values(f)) if (e !== f.provider) e.addEventListener(e.type === "checkbox" ? "change" : "input", save);

  // ---- conversations: one per design, kept in memory only
  const convs = new Map();
  let docId = store.doc.id;
  const conv = () => { if (!convs.has(docId)) convs.set(docId, { messages: [], rows: [] }); return convs.get(docId); };
  let running = false;
  store.on((kind) => {
    if (kind !== "load" || store.doc.id === docId) return;
    // A design the model opened itself (new_design, load_project) keeps its conversation.
    if (running) { convs.set(store.doc.id, convs.get(docId)); convs.delete(docId); docId = store.doc.id; return; }
    docId = store.doc.id;
    box.replaceChildren(...conv().rows);
  });

  const say = (c, row) => {
    c.rows.push(row);
    if (c === conv()) { box.append(row); box.scrollTop = box.scrollHeight; }
    return row;
  };
  const note = (c, cls, text) => say(c, el("div", { class: "chat-msg " + cls }, text));
  const setStatus = (t) => { status.textContent = t; };

  // plain text with ``` fences: nothing else is rendered, and nothing is trusted as HTML
  const textRow = (c, cls, text) => {
    const row = el("div", { class: "chat-msg " + cls });
    text.split("```").forEach((part, i) => {
      if (i % 2) row.append(el("pre", {}, part.replace(/^[\w+-]*\n/, "").replace(/\n$/, "")));
      else if (part.trim()) row.append(document.createTextNode(i ? part.replace(/^\n/, "") : part));
    });
    return say(c, row);
  };

  const oneLine = (s, max = 80) => {
    s = String(s).replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  };
  const toolRow = (c, call, text, isError, dataURL) => {
    const row = el("details", { class: "chat-msg tool" },
      el("summary", {}, `${call.name} → ${isError ? "error: " : ""}${oneLine(text)}`),
      el("pre", {}, JSON.stringify(call.args, null, 2) + "\n→ " + text));
    if (dataURL) row.append(el("img", { src: dataURL, alt: "screenshot" }));
    return say(c, row);
  };

  const showError = (c, err, id, url) => {
    const provider = PROVIDERS[id];
    note(c, "error", err.message || String(err));
    setStatus(err.message || String(err));
    if (!err.network) return; // a failed fetch: the browser hides the reason, so say the likely ones
    let host = "";
    try { host = new URL(url).hostname; } catch (e) { /* bad address: the error row already says so */ }
    if (provider.local || host === "localhost" || host === "127.0.0.1") {
      note(c, "hint", HINTS[id] || "Could not reach " + url + ". Check that the server is running and allows browser access (CORS).\n" + HINT_MORE);
    }
  };

  const download = (filename, bytes) => {
    const a = el("a", { href: URL.createObjectURL(new Blob([bytes])), download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    app.toast("Saved " + filename);
  };

  let controller = null;
  const busy = (on) => {
    running = on; sendBtn.disabled = on; stopBtn.disabled = !on; newBtn.disabled = on;
    if (!on) controller = null;
  };

  async function send() {
    const text = input.value.trim();
    if (!text || running) return;
    const s = settings(), provider = PROVIDERS[s.provider];
    const cfg = { url: s.url, model: s.model, key: s.key };
    const c = conv();
    input.value = "";
    c.messages.push({ role: "user", text });
    textRow(c, "user", text);
    controller = new AbortController();
    const { signal } = controller;
    busy(true);
    // the model sees the 35 tools; run_script is left out unless the person allowed scripts
    const tools = TOOLS.filter((t) => s.scripts || t.name !== "run_script").map(({ name, description, parameters }) => ({ name, description, parameters }));
    const ctx = { scripts: s.scripts, vision: s.vision, download };
    let calls = 0;
    try {
      for (;;) {
        setStatus("thinking…");
        const r = await provider.chat(cfg, { system: SYSTEM, messages: c.messages, tools, signal });
        if (!r.text && !r.toolCalls.length) { note(c, "error", "The model gave no answer."); break; } // nothing to keep: the next Send must stay valid
        c.messages.push({ role: "assistant", family: provider.family, text: r.text, toolCalls: r.toolCalls, raw: r.raw });
        if (r.text) textRow(c, "assistant", r.text);
        if (!r.toolCalls.length) break;
        for (const call of r.toolCalls) {
          // every call gets a result, so the transcript stays valid for the next Send
          let out = { text: "", isError: true };
          if (signal.aborted) out.text = "Stopped by the user.";
          else if (calls >= MAX_CALLS) out.text = "Not run: too many tool calls in one message.";
          else {
            calls++;
            setStatus(`calling ${call.name}…`);
            out = await callTool(call, ctx);
            toolRow(c, call, out.text, out.isError, out.dataURL);
          }
          c.messages.push({ role: "tool", id: call.id, name: call.name, text: out.text, image: out.image, isError: out.isError });
        }
        if (signal.aborted) throw new DOMException("Stopped", "AbortError");
        if (calls >= MAX_CALLS) { note(c, "error", `Stopped after ${MAX_CALLS} tool calls. Send another message to continue.`); setStatus("Stopped"); break; }
      }
      if (calls < MAX_CALLS) setStatus("");
    } catch (err) {
      if (err && err.name === "AbortError") { note(c, "error", "Stopped."); setStatus("Stopped"); }
      else showError(c, err, s.provider, s.url);
    } finally { busy(false); }
  }

  async function callTool(call, ctx) {
    const tool = TOOLS.find((t) => t.name === call.name);
    try {
      if (!tool) throw new Error("unknown tool " + call.name);
      if (call.args && call.args.$parseError) throw new Error("the arguments were not valid JSON (" + call.args.$parseError + "); send them again");
      const v = await runTool(tool, call.args, ctx);
      const text = v && v.$text !== undefined ? String(v.$text) : JSON.stringify(v);
      return { text, isError: false, image: v?.$image, dataURL: v?.$dataURL };
    } catch (err) {
      return { text: (err && err.message) || String(err), isError: true };
    }
  }

  // ---- panel wiring
  const toggle = (open) => {
    panel.hidden = !open;
    openBtn.setAttribute("aria-pressed", String(open));
    if (open) { box.replaceChildren(...conv().rows); box.scrollTop = box.scrollHeight; input.focus(); }
  };
  openBtn.addEventListener("click", () => toggle(panel.hidden));
  $("chat-close").addEventListener("click", () => toggle(false));
  sendBtn.addEventListener("click", send);
  stopBtn.addEventListener("click", () => {
    if (!controller) return;
    setStatus("Stopping after this tool…");
    controller.abort();
  });
  newBtn.addEventListener("click", () => {
    if (running) return;
    convs.delete(docId);
    box.replaceChildren();
    setStatus("");
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the app's own shortcuts must not see typing
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });

  $("chat-list").addEventListener("click", async () => {
    const s = settings(), provider = PROVIDERS[s.provider], c = conv();
    setStatus("listing models…");
    try {
      const ids = await provider.listModels({ url: s.url, model: s.model, key: s.key });
      $("chat-models").replaceChildren(...ids.map((id) => el("option", { value: id })));
      const first = ids.find((id) => !/embed/i.test(id));
      if (!f.model.value && first) { f.model.value = first; save(); }
      setStatus(ids.length ? ids.length + " models found" : "No models found. Pull or load one first.");
    } catch (err) { showError(c, err, s.provider, s.url); }
  });
}
