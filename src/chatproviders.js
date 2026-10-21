// jumpstart-3d: chat providers. One small adapter per model server: Ollama, LM Studio, OpenAI, Anthropic.
// Each one turns the chat's own transcript into that server's request and the reply back into { text, toolCalls, raw }.
//   transcript: { role: "user", text } | { role: "assistant", text, toolCalls, raw } | { role: "tool", id, name, text, image?, isError? }
// Three rules, all learned from the servers' own docs (.claude/phase2d-scout.md):
//  1. Stateless: every call rebuilds the wire messages from the transcript. An assistant turn whose `raw` came from the same
//     `family` is sent back as is; after a switch of provider it is rebuilt from its text and tool calls.
//  2. A tool result with a picture: Anthropic takes the image inside the tool_result. OpenAI-style servers and Ollama take text only
//     in a tool message, so the picture rides in one user message after the last result of that turn.
//  3. No tool_choice, no temperature, no output limit (except Anthropic's required max_tokens): the plainest request works everywhere.
// A failed fetch is rethrown with `network: true` (the chat shows a hint for it); AbortError passes through.

const join = (base, path) => base.replace(/\/+$/, "") + path;

// A 200 whose body is not the shape we expect (a wrong address that answers, a proxy page).
const shaped = (v) => {
  if (v === undefined) throw new Error("The server did not answer in the expected shape");
  return v;
};

// Arguments arrive as an object (Ollama, Anthropic) or a JSON string (OpenAI-style). A bad string comes back as
// { $parseError, raw } so the chat can send the model an error result and let it retry.
function parseArgs(v) {
  if (v && typeof v === "object") return v;
  if (v === undefined || v === null || v === "") return {};
  try { return JSON.parse(v); } catch (e) { return { $parseError: e.message, raw: String(v) }; }
}

// The HTTP errors a person can read ("401 Incorrect API key") versus network errors they cannot (e.network).
async function request(url, { headers, body, signal }) {
  let res;
  try { res = await fetch(url, { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body), signal }); }
  catch (e) { if (e.name !== "AbortError") e.network = true; throw e; }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON: handled below */ }
  if (!res.ok) {
    const err = data && data.error;
    const message = (err && err.message) || (typeof err === "string" && err) || (data && data.message) || res.statusText || text.slice(0, 200);
    throw new Error(`${res.status} ${message}`);
  }
  if (data === null) throw new Error("The server did not answer with JSON: " + text.slice(0, 200));
  return data;
}

// Ollama and the OpenAI-style servers share one transcript walk. A tool turn can have several results, and the
// results must stay together right after the assistant message, so pictures wait until the turn's results are done.
function wireMessages(system, transcript, { family, assistant, tool, picture }) {
  const out = [{ role: "system", content: system }];
  let shots = [];
  const flush = () => { if (shots.length) out.push(picture(shots)); shots = []; };
  for (const m of transcript) {
    if (m.role !== "tool") flush();
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant") out.push(m.raw && m.family === family ? m.raw : assistant(m));
    else { out.push(tool(m)); if (m.image) shots.push(m.image); }
  }
  flush();
  return out;
}

const functionTools = (tools) => tools.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } }));
const bearer = (cfg) => ({ "content-type": "application/json", ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) });

// ---- Ollama: native /api/chat ----
const ollama = {
  label: "Ollama",
  family: "ollama",
  defaultUrl: "http://localhost:11434",
  defaultModel: "",
  needsKey: false,
  vision: false,
  local: true,
  async listModels(cfg) {
    const data = await request(join(cfg.url, "/api/tags"), { headers: cfg.key ? { authorization: `Bearer ${cfg.key}` } : {} });
    return shaped(data.models?.map((m) => m.name));
  },
  async chat(cfg, { system, messages, tools, signal }) {
    const body = {
      model: cfg.model,
      stream: false, // Ollama streams by default
      options: { num_ctx: 32768 }, // the default context (4k on a small GPU) is cut silently and is too small for 36 tools
      messages: wireMessages(system, messages, {
        family: this.family,
        assistant: (m) => ({ role: "assistant", content: m.text, ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : {}) }),
        tool: (m) => ({ role: "tool", tool_name: m.name, content: m.text }),
        picture: (shots) => ({ role: "user", content: "The screenshot from the tool call above.", images: shots }),
      }),
      tools: functionTools(tools),
    };
    const data = await request(join(cfg.url, "/api/chat"), { headers: bearer(cfg), body, signal });
    const msg = shaped(data.message);
    return {
      text: msg.content || "",
      toolCalls: (msg.tool_calls || []).map((c, i) => ({ id: c.id || "call_" + i, name: c.function.name, args: parseArgs(c.function.arguments) })),
      raw: msg,
    };
  },
};

// ---- OpenAI-style /chat/completions: OpenAI itself and LM Studio ----
const openaiStyle = {
  family: "openai",
  async listModels(cfg) {
    const data = await request(join(cfg.url, "/models"), { headers: cfg.key ? { authorization: `Bearer ${cfg.key}` } : {} });
    return shaped(data.data?.map((m) => m.id).sort());
  },
  async chat(cfg, { system, messages, tools, signal }) {
    const body = {
      model: cfg.model,
      messages: wireMessages(system, messages, {
        family: this.family,
        assistant: (m) => ({
          role: "assistant",
          content: m.text || null,
          ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
        }),
        tool: (m) => ({ role: "tool", tool_call_id: m.id, content: m.text }),
        picture: (shots) => ({
          role: "user",
          content: [{ type: "text", text: "The screenshot from the tool call above." }, ...shots.map((b64) => ({ type: "image_url", image_url: { url: "data:image/png;base64," + b64 } }))],
        }),
      }),
      tools: functionTools(tools),
    };
    const data = await request(join(cfg.url, "/chat/completions"), { headers: bearer(cfg), body, signal });
    const msg = shaped(data.choices?.[0]?.message);
    return {
      text: typeof msg.content === "string" ? msg.content : "",
      toolCalls: (msg.tool_calls || []).map((c) => ({ id: c.id, name: c.function.name, args: parseArgs(c.function.arguments) })),
      raw: msg,
    };
  },
};

const lmstudio = { ...openaiStyle, label: "LM Studio", defaultUrl: "http://localhost:1234/v1", defaultModel: "", needsKey: false, vision: false, local: true };
const openai = { ...openaiStyle, label: "OpenAI-style (OpenAI, OpenRouter, Groq…)", defaultUrl: "https://api.openai.com/v1", defaultModel: "gpt-6.1-sol", needsKey: true, vision: true, local: false };

// ---- Anthropic: /messages ----
// The browser header is required: without it the API refuses calls made from a web page.
const claudeHeaders = (cfg) => ({
  "content-type": "application/json",
  "x-api-key": cfg.key,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
});

const anthropic = {
  family: "anthropic",
  label: "Anthropic",
  defaultUrl: "https://api.anthropic.com/v1",
  defaultModel: "claude-sonnet-5-5",
  needsKey: true,
  vision: true,
  local: false,
  async listModels(cfg) {
    const data = await request(join(cfg.url, "/models"), { headers: claudeHeaders(cfg) });
    return shaped(data.data?.map((m) => m.id));
  },
  async chat(cfg, { system, messages, tools, signal }) {
    const wire = [];
    for (const m of messages) {
      if (m.role === "user") wire.push({ role: "user", content: m.text });
      else if (m.role === "assistant") {
        // the content array goes back untouched: it can hold thinking blocks the API needs to see again
        wire.push({
          role: "assistant",
          content: m.raw && m.family === this.family ? m.raw : [...(m.text ? [{ type: "text", text: m.text }] : []), ...m.toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args }))],
        });
      } else {
        // all results of one turn go in one user message, as its first blocks; the picture sits inside its tool_result
        const block = { type: "tool_result", tool_use_id: m.id, content: m.text, ...(m.isError ? { is_error: true } : {}) };
        if (m.image) block.content = [{ type: "text", text: m.text }, { type: "image", source: { type: "base64", media_type: "image/png", data: m.image } }];
        const last = wire[wire.length - 1];
        if (last && last.role === "user" && Array.isArray(last.content)) last.content.push(block);
        else wire.push({ role: "user", content: [block] });
      }
    }
    const body = {
      model: cfg.model,
      max_tokens: 16000,
      system,
      messages: wire,
      tools: tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters })),
    };
    const data = await request(join(cfg.url, "/messages"), { headers: claudeHeaders(cfg), body, signal });
    const blocks = shaped(data.content);
    return {
      text: blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
      toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: b.input || {} })),
      raw: blocks,
    };
  },
};

export const PROVIDERS = { ollama, lmstudio, openai, anthropic };
