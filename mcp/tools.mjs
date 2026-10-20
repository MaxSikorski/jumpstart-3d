// The tool table: one MCP tool per JS3D call (BRIDGE.md), in snake_case. The names are the contract.
// Lengths are mm, angles degrees, positions [x, y, z] with z up. A handler gets (args, session) and returns a value,
// which becomes one JSON text block; raw(...) hands back finished MCP content instead (a picture, or plain text).
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";

const RAW = Symbol("raw");
const raw = (content) => ({ [RAW]: content });
// a trailing undefined would travel as null over the WebSocket and defeat the call's default
const caller = (opts) => (s, name, ...args) => { while (args.length && args[args.length - 1] === undefined) args.pop(); return s.call(name, args, opts); };
const call = caller();
const callLong = caller({ timeoutMs: 600_000 }); // exports, pictures and scripts of big designs can take minutes

const ids = z.union([z.string(), z.array(z.string()).min(1)]).describe("A body id, or a list of ids (see list_bodies)");
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const size = z.union([z.array(z.number()).length(3), z.record(z.union([z.number(), z.string()]))])
  .describe("Shape size in mm: [w, d, h] or an object such as {w, d, h}. Other kinds have other keys (see list_kinds for each kind's defaults).");
const exportKind = z.enum(["stl", "obj", "3mf", "step", "json"]);

const where = (p) => resolve(p.startsWith("~/") ? join(homedir(), p.slice(2)) : p); // relative paths are relative to the folder the server was started in
async function save(path, bytes) {
  const file = where(path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return { path: file, bytes: bytes.length };
}

export const TOOLS = [];
const tool = (name, description, shape, run) => TOOLS.push({ name, description, shape, run });

tool("status", "Says how this server reaches JumpStart 3D (a connected browser tab, or a headless browser), the app version, the open design's name and mode, and how many bodies it has. Never starts a browser: with no page yet it explains how to get one.",
  {}, (_, s) => s.status());
tool("wait_ready", "Waits until the geometry engine has built every shape (volumes and bounding boxes in list_bodies are empty until then). Call it after edits and before reading sizes.",
  { timeout_ms: z.number().int().positive().optional().describe("Give up after this many milliseconds (default 90000)") },
  async ({ timeout_ms }, s) => { await s.call("ready", timeout_ms ? [timeout_ms] : [], { timeoutMs: (timeout_ms || 90_000) + 10_000 }); return { ready: true }; });
tool("list_kinds", "Lists the 20 shape kinds add_shape accepts, each with its default size (mm).", {}, (_, s) => call(s, "kinds"));
tool("list_bodies", "Lists the design's top-level bodies: id, name, kind, hole, hidden, color, position, bounding box (mm), volume (mm3) and any build error. bbox and volume are null until built (see wait_ready).", {}, (_, s) => call(s, "list"));
tool("get_body", "One body in full: the list_bodies entry plus its definition (node) and its 16-number matrix.", { id: z.string() }, ({ id }, s) => call(s, "get", id));

tool("add_shape", "Adds a basic shape and returns its id. The shape's footprint is centred on `at` [x, y] with its base at z. Set hole: true to make a cutter that group_bodies can subtract from another body.",
  { kind: z.string().describe("box, cylinder, sphere, cone, ... (see list_kinds)"), size: size.optional(), at: vec3.optional().describe("Where to put it, mm. Default [0, 0, 0]"), hole: z.boolean().optional(), color: z.string().optional().describe('"#rrggbb"'), name: z.string().optional() },
  ({ kind, size, at, hole, color, name }, s) => call(s, "add", kind, { size, at, hole, color, name }));
tool("remove_bodies", "Deletes bodies. Returns how many.", { ids }, ({ ids }, s) => call(s, "remove", ids));
tool("duplicate_bodies", "Copies bodies, shifted by offset (mm). Returns the new ids.", { ids, offset: vec3.optional() }, ({ ids, offset }, s) => call(s, "duplicate", ids, offset));
tool("move_bodies", "Moves bodies by [dx, dy, dz] mm.", { ids, delta: vec3 }, ({ ids, delta }, s) => call(s, "move", ids, delta));
tool("move_to", "Puts one body's origin at [x, y, z] mm.", { id: z.string(), position: vec3 }, ({ id, position }, s) => call(s, "moveTo", id, position));
tool("rotate_bodies", "Turns bodies by an angle in degrees about an axis through `about` (default: the middle of their box, which needs them built: call wait_ready first, or pass about).",
  { ids, axis: z.union([z.enum(["x", "y", "z"]), vec3]), degrees: z.number(), about: vec3.optional() }, ({ ids, axis, degrees, about }, s) => call(s, "rotate", ids, axis, degrees, about ? { about } : {}));
tool("resize_shape", "Changes the size of one basic shape (not a group), in mm. Give only the keys to change, such as {w: 50}.", { id: z.string(), size }, ({ id, size }, s) => call(s, "resize", id, size));
tool("scale_bodies", "Scales bodies by a factor k, or [kx, ky, kz] along their own axes, about `about` (default: the middle of their box; needs them built). Works on any body.",
  { ids, k: z.union([z.number().positive(), z.tuple([z.number().positive(), z.number().positive(), z.number().positive()])]), about: vec3.optional() }, ({ ids, k, about }, s) => call(s, "scale", ids, k, about ? { about } : {}));
tool("set_hole", "Marks basic shapes as holes (cutters, shown see-through) or solid again.", { ids, hole: z.boolean() }, ({ ids, hole }, s) => call(s, "setHole", ids, hole));
tool("set_color", "Sets the colour of bodies.", { ids, color: z.string().describe('"#rrggbb"') }, ({ ids, color }, s) => call(s, "setColor", ids, color));
tool("rename_body", "Renames a body.", { id: z.string(), name: z.string() }, ({ id, name }, s) => call(s, "rename", id, name));
tool("set_hidden", "Hides or shows bodies. Hidden bodies are left out of exports.", { ids, hidden: z.boolean() }, ({ ids, hidden }, s) => call(s, "setHidden", ids, hidden));
tool("group_bodies", "Combines two or more bodies into one group and returns its id. By default it joins them; any bodies marked as holes are cut out of the result. op \"cut\" subtracts the others from the first id; op \"intersect\" keeps only what they share.",
  { ids, name: z.string().optional(), op: z.enum(["cut", "intersect"]).optional() }, ({ ids, name, op }, s) => call(s, "group", ids, { name, op }));
tool("ungroup_body", "Splits a group back into its parts and returns their ids.", { id: z.string() }, ({ id }, s) => call(s, "ungroup", id));

tool("list_params", "Lists the design's named parameters: name, expression, value (mm) and unit.", {}, (_, s) => call(s, "params"));
tool("set_param", "Adds or changes a named parameter. The expression can use numbers, other parameters and units (\"40\", \"w/2\", \"1in\"). Returns its value in mm.",
  { name: z.string(), expr: z.string(), unit: z.enum(["mm", "in"]).optional() }, ({ name, expr, unit }, s) => call(s, "setParam", name, expr, unit ? { unit } : {}));
tool("remove_param", "Deletes a parameter. Returns how many places used it.", { name: z.string() }, ({ name }, s) => call(s, "removeParam", name));
tool("bind_size", "Ties one size of a basic shape (key \"w\", \"d\", \"h\"...) to an expression such as \"w/2\", so it follows the parameters; null frees it. Returns the size now.",
  { id: z.string(), key: z.string(), expr: z.string().nullable() }, ({ id, key, expr }, s) => call(s, "bind", id, key, expr));

tool("undo", "Undoes the last edit. Returns its label, or null when there is nothing to undo.", {}, (_, s) => call(s, "undo"));
tool("redo", "Redoes the last undone edit. Returns its label, or null.", {}, (_, s) => call(s, "redo"));
tool("select_bodies", "Selects bodies in the view (an empty list clears the selection).", { ids: z.array(z.string()) }, ({ ids }, s) => call(s, "select", ids));
tool("fit_view", "Frames the selection, or everything when nothing is selected.", {}, (_, s) => call(s, "fit"));
tool("set_mode", "Switches the app between Beginner and Advanced mode.", { mode: z.enum(["beginner", "advanced"]) }, ({ mode }, s) => call(s, "setMode", mode));

tool("screenshot", "A PNG picture of the 3D view, after waiting for the shapes to build. Look at it after every few edits. fit (default true) frames everything shown first; width (default 800) is in pixels.",
  { width: z.number().int().min(1).max(8192).default(800), fit: z.boolean().default(true) },
  async ({ width, fit }, s) => raw([{ type: "image", data: (await callLong(s, "screenshot", { fit, width })).toString("base64"), mimeType: "image/png" }]));
tool("export_file", "Writes the design to a file on this computer and returns its path and size. kind: stl, obj, 3mf, step, or json (the project file). Holes and hidden bodies are left out; ids limits it to some bodies. Relative paths are relative to the folder the server runs in.",
  { kind: exportKind, path: z.string(), ids: ids.optional() }, async ({ kind, path, ids }, s) => save(path, await callLong(s, "export", kind, ids ? { ids } : {})));
tool("save_project", "Returns the whole design as project-file JSON text (see BRIDGE.md), or writes it to `path` and returns the path and size.",
  { path: z.string().optional() }, async ({ path }, s) => {
    const bytes = await callLong(s, "export", "json");
    return path ? save(path, bytes) : raw([{ type: "text", text: bytes.toString("utf8") }]);
  });
tool("load_project", "Opens a project file in place of the open design (give `path` to a file, or `json` as text). The open design stays in the app's Your designs list.",
  { path: z.string().optional(), json: z.string().optional() }, async ({ path, json }, s) => {
    if ((path === undefined) === (json === undefined)) throw new Error("give exactly one of path or json");
    await call(s, "load", path === undefined ? json : await readFile(where(path), "utf8"));
    return { loaded: true };
  });
tool("new_design", "Starts an empty design (the previous one stays in the app's Your designs list).", { mode: z.enum(["beginner", "advanced"]).optional() }, async ({ mode }, s) => { await call(s, "newDesign", mode); return { ok: true }; });
tool("run_script", "Runs JavaScript in the page with JS3D and app in scope (see BRIDGE.md) and returns the value as JSON. Top-level await works; end with return to give a value back, or make a plain script's last expression the value. Use it for anything the other tools do not cover. It has the full power of the page.",
  { code: z.string() }, ({ code }, s) => callLong(s, "run", code));

function toResult(v) {
  if (v && v[RAW]) return { content: v[RAW] };
  return { content: [{ type: "text", text: JSON.stringify(v === undefined ? null : v) }] };
}
async function runTool(t, args, session) {
  try { return toResult(await t.run(args, session)); }
  catch (e) { return { isError: true, content: [{ type: "text", text: (e && e.message) || String(e) }] }; }
}
export function registerTools(server, session) {
  for (const t of TOOLS) server.registerTool(t.name, { description: t.description, inputSchema: t.shape }, (args) => runTool(t, args, session));
}
