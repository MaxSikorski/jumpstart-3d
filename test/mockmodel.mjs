// A stand-in for a language model server, for chat.spec.mjs. It speaks the three wire shapes the in-app chat uses:
//   POST /api/chat           Ollama (native)
//   POST /v1/chat/completions  OpenAI style (also LM Studio)
//   POST /v1/messages        Anthropic
//   GET  /api/tags, GET /v1/models   a fixed model list in each shape
// Every POST is answered from `mock.script`, one item per request: { tool, args } (one tool call), { text } (the final
// answer), { empty: true } (an Anthropic reply with an empty content array), or a function (req, results) => item, where `results` is every tool result in the request, parsed from JSON when
// it is JSON. An item may also carry delayMs. The single build is opened from disk (origin null), so every answer carries
// CORS headers and OPTIONS answers 204.
import { createServer } from "node:http";

const MODELS = ["mock-tools", "mock-vision"];

// the text of a tool result: a string, or an array of content blocks whose first text block is the text
const textOf = (c) => (typeof c === "string" ? c : (Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("") : ""));
const parse = (s) => { try { return JSON.parse(s); } catch (e) { return s; } };

// every tool result in a request, in order, whatever the provider's message format
function toolResults(path, body) {
  const out = [];
  for (const m of body.messages || []) {
    if (m.role === "tool") out.push(parse(textOf(m.content)));
    else if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") out.push(parse(textOf(b.content)));
  }
  return out;
}

export async function startMock() {
  const requests = []; // every POST: { path, headers, body }
  const gets = []; // every GET: { path, headers }
  const sent = []; // every assistant message the mock produced, in the shape it was sent
  let queue = [];
  let n = 0;

  const mock = {
    requests, gets, sent,
    get script() { return queue; },
    set script(items) { queue = [...items]; },
    reset() { requests.length = 0; gets.length = 0; sent.length = 0; queue = []; },
  };

  const render = (path, item) => {
    const call = item.tool ? { id: "call_" + ++n, name: item.tool, args: item.args || {} } : null;
    const text = item.text || "";
    if (path === "/api/chat") {
      const message = { role: "assistant", content: text };
      if (call) message.tool_calls = [{ function: { index: 0, name: call.name, arguments: call.args } }];
      return { model: "mock-tools", message, done: true, done_reason: "stop" };
    }
    if (path === "/v1/chat/completions") {
      const message = { role: "assistant", content: text || null };
      if (call) message.tool_calls = [{ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }];
      return { id: "chatcmpl-mock", object: "chat.completion", model: "mock-tools", choices: [{ index: 0, message, finish_reason: call ? "tool_calls" : "stop" }] };
    }
    // Anthropic: a (empty) thinking block comes first, as Sonnet 5.5 sends it; the chat must echo it back unchanged
    if (item.empty) return { id: "msg_mock", type: "message", role: "assistant", model: "mock-tools", content: [], stop_reason: "end_turn" };
    const content = [{ type: "thinking", thinking: "", signature: "sig_" + n }];
    if (text) content.push({ type: "text", text });
    if (call) content.push({ type: "tool_use", id: "toolu_mock_" + n, name: call.name, input: call.args });
    return { id: "msg_mock", type: "message", role: "assistant", model: "mock-tools", content, stop_reason: call ? "tool_use" : "end_turn" };
  };

  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    const reqHeaders = req.headers["access-control-request-headers"];
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", reqHeaders || "*");
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.method === "GET") {
      gets.push({ path, headers: req.headers });
      if (path === "/api/tags") return send(200, { models: MODELS.map((name) => ({ name, model: name })) });
      if (path === "/v1/models") return send(200, { object: "list", data: MODELS.map((id) => ({ id, object: "model" })) });
      return send(404, { error: { message: "no such route " + path } });
    }
    if (req.method !== "POST" || !["/api/chat", "/v1/chat/completions", "/v1/messages"].includes(path)) return send(404, { error: { message: "no such route " + path } });

    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body;
      try { body = JSON.parse(raw); } catch (e) { return send(400, { error: { message: "bad json" } }); }
      const entry = { path, headers: req.headers, body };
      requests.push(entry);
      let item = queue.shift();
      if (!item) return send(500, { error: { message: "script exhausted" } });
      if (typeof item === "function") item = item(entry, toolResults(path, body));
      const reply = render(path, item);
      sent.push(path === "/v1/messages" ? reply.content : reply.message ?? reply.choices[0].message);
      const go = () => { if (!res.writableEnded && !res.destroyed) send(200, reply); };
      if (item.delayMs) { const t = setTimeout(go, item.delayMs); res.on("close", () => clearTimeout(t)); } else go();
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  mock.port = server.address().port;
  mock.url = `http://127.0.0.1:${mock.port}`;
  mock.close = () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });
  return mock;
}
