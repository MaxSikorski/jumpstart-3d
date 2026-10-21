// The in-app chat (src/chattools.js) offers a model the same tools as this server. This test keeps the two lists from drifting:
// same names in the same order, the same descriptions and parameter names, except for the six tools that differ on purpose
// (no files or folders in a web page). It also checks that the chat's parameter schemas use only the plain JSON Schema that
// small local models and every provider accept.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.mjs";

const DIFFERENT = ["status", "screenshot", "export_file", "save_project", "load_project", "run_script"];
// what the chat adds to a tool the server also has
const EXTRA = { rotate_bodies: ["axis_vector"], scale_bodies: ["k_xyz"] };
// the parameter names of the six, spelled out
const SIX = { status: [], screenshot: ["width", "fit"], export_file: ["kind", "ids", "name"], save_project: [], load_project: ["json"], run_script: ["code"] };

let s, server, chat;
before(async () => {
  s = await startServer({ JS3D_MODE: "headless" });
  server = (await s.client.listTools()).tools;
  chat = (await import("../../src/chattools.js")).TOOLS;
});
after(async () => { await s.close(); });

const props = (schema) => Object.keys((schema && schema.properties) || {}).sort();
const required = (schema) => [...((schema && schema.required) || [])].sort();

test("the chat has the same tools as the server, in the same order", () => {
  assert.ok(chat.length >= 35);
  assert.deepEqual(chat.map((t) => t.name), server.map((t) => t.name));
  for (const t of chat) {
    assert.equal(typeof t.description, "string", t.name);
    assert.equal(typeof t.run, "function", t.name);
  }
});

test("descriptions and parameters match, except for the six that differ on purpose", () => {
  for (const t of chat) {
    if (DIFFERENT.includes(t.name)) continue;
    const m = server.find((x) => x.name === t.name);
    assert.equal(t.description, m.description, t.name + ": description");
    const extra = EXTRA[t.name] || [];
    assert.deepEqual(props(t.parameters), [...props(m.inputSchema), ...extra].sort(), t.name + ": parameter names");
    // axis and k can be given as axis_vector / k_xyz instead, so they are no longer required; everything else stays required
    const widened = { rotate_bodies: "axis", scale_bodies: "k" }[t.name];
    assert.deepEqual(required(t.parameters), required(m.inputSchema).filter((n) => n !== widened), t.name + ": required");
  }
});

test("the six that differ on purpose have exactly the documented parameters", () => {
  assert.deepEqual(DIFFERENT.slice().sort(), Object.keys(SIX).sort());
  for (const name of DIFFERENT) {
    const t = chat.find((x) => x.name === name);
    assert.deepEqual(props(t.parameters), SIX[name].slice().sort(), name);
  }
  const need = (name) => required(chat.find((x) => x.name === name).parameters);
  assert.deepEqual(need("export_file"), ["kind"]);
  assert.deepEqual(need("load_project"), ["json"]);
  assert.deepEqual(need("run_script"), ["code"]);
  assert.match(chat.find((x) => x.name === "run_script").description, /Allow scripts/);
  // the screenshot keeps the server's first three sentences
  const sentences = (d) => d.split(". ").slice(0, 3).join(". ");
  assert.equal(sentences(chat.find((x) => x.name === "screenshot").description), sentences(server.find((x) => x.name === "screenshot").description));
});

test("no parameter schema uses anyOf, oneOf, $ref, default or additionalProperties", () => {
  const banned = ["anyOf", "oneOf", "$ref", "default", "additionalProperties"];
  const walk = (node, where) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, where + "[" + i + "]"));
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      // a property may legitimately be called "default"; only schema keywords count, and those sit beside "type" or "properties"
      if (banned.includes(k) && !(where.endsWith(".properties") )) assert.fail(where + " uses " + k);
      walk(v, where + "." + k);
    }
  };
  for (const t of chat) {
    assert.equal(t.parameters.type, "object", t.name);
    walk(t.parameters, t.name);
    // no tuples and no type arrays either
    const json = JSON.stringify(t.parameters);
    assert.ok(!json.includes('"items":['), t.name + " has a tuple");
    assert.ok(!/"type":\[/.test(json), t.name + " has a type array");
  }
});
