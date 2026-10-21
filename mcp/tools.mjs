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

// Factories, so every tool builds its own copy: the JSON Schema comes out self-contained (a "$ref" appears when one zod object
// is reused inside a single tool, as rotate_bodies once did). Plain 3-number arrays, not tuples ("items": [...]). Some clients
// (Gemini family, small local servers) reject both.
const ids = () => z.union([z.string(), z.array(z.string()).min(1)]).describe("A body id, or a list of ids (see list_bodies)");
const vec3 = () => z.array(z.number()).length(3);
const size = () => z.union([z.array(z.number()).length(3), z.record(z.union([z.number(), z.string()]))])
  .describe("Shape size in mm: [w, d, h] or an object such as {w, d, h}. Other kinds have other keys (see list_kinds for each kind's defaults).");
const exportKind = z.enum(["stl", "obj", "3mf", "step", "json"]);

export const where = (p) => resolve(p.startsWith("~/") ? join(homedir(), p.slice(2)) : p); // relative paths are relative to the folder the server was started in
export async function save(path, bytes) {
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
  { kind: z.string().describe("box, cylinder, sphere, cone, ... (see list_kinds)"), size: size().optional(), at: vec3().optional().describe("Where to put it, mm. Default [0, 0, 0]"), hole: z.boolean().optional(), color: z.string().optional().describe('"#rrggbb"'), name: z.string().optional() },
  ({ kind, size, at, hole, color, name }, s) => call(s, "add", kind, { size, at, hole, color, name }));
tool("add_fastener", "Adds a threaded fastener and returns its id: a hex bolt (length under the head), a hex nut, a threaded rod, or a tap cutter (a threaded rod marked as a hole: put it inside a solid and group_bodies cuts a threaded hole). Sizes M2.5 to M12 (ISO coarse) and #6-32 to 1/2-20 (UNC / UNF). Building takes a few seconds: call wait_ready.",
  { type: z.enum(["bolt", "nut", "rod", "cutter"]), size: z.string().describe("M2.5, M3, M4, M5, M6, M8, M10, M12, or #6-32, #8-32, #10-24, #10-32, 1/4-20, 1/4-28, 5/16-18, 5/16-24, 3/8-16, 3/8-24, 1/2-13, 1/2-20"), length: z.number().optional().describe("Length in mm (under the head for a bolt). Not used for a nut. At least 3 turns of the thread, at most 150"), clear: z.number().optional().describe("Print offset in mm, from -1 to 0. Default 0; -0.2 suits most printers"), left: z.boolean().optional(), at: vec3().optional().describe("Where to put it, mm. Default [0, 0, 0]"), name: z.string().optional() },
  ({ type, size, length, clear, left, at, name }, s) => call(s, "fastener", { type, size, length, clear, left, at, name }));
tool("add_hole_pattern", "Drills a pattern of holes into one flat face of a body and returns {id, holes, dropped}. face is the direction the face looks (+z is the top). Grid: cols x rows at pitch mm (rowPitch for the rows; leave pitch out to spread them over the face); stagger shifts every other row by half a pitch and makes it one hole shorter. Circle: count holes on radius around the face centre or center. Columns run along the face's longest straight edge (on a box top, the longer side), rows across it; angle and start are measured from that edge. Holes that would not fit inside the face and its margin are left out. Round holes (the default) are one Hole feature: kind simple, cbore, csink or tapped; size such as M3 or #8 sets the diameter (and the bore, sink or thread). shape square, hex or slot cuts that outline instead, as one sketch and one Extrude cut (the result also has sketch): width is the square's side, the hex's width across flats or the slot's width; length is the slot's overall length, along a row (pointing at the centre in a circle). At most 200 plain holes or shapes (130 counterbores or countersinks, 8 tapped); call wait_ready after.",
  { body: z.string().describe("A body id (see list_bodies)"), face: z.enum(["+x", "-x", "+y", "-y", "+z", "-z"]).describe("The direction the flat face looks; +z is the top"), layout: z.enum(["grid", "circle"]),
    cols: z.number().optional().describe("Grid: holes per row, 1 to 200"), rows: z.number().optional().describe("Grid: number of rows, 1 to 200"), pitch: z.number().optional().describe("Grid: distance between holes in a row, mm. Leave out to spread the holes over the face"), rowPitch: z.number().optional().describe("Grid: distance between rows, mm. Default: the same as pitch"),
    margin: z.number().optional().describe("Space kept between a hole's edge and the face's edge, mm. Default 0"), stagger: z.boolean().optional().describe("Grid: shift every other row by half a pitch"), angle: z.number().optional().describe("Grid: turn the grid on the face, degrees. Default 0"),
    count: z.number().optional().describe("Circle: number of holes, 2 to 200"), radius: z.number().optional().describe("Circle: radius, mm"), start: z.number().optional().describe("Circle: angle of the first hole, degrees. Default 0"), center: vec3().optional().describe("Circle: the middle, [x, y, z] mm in the world, moved onto the face. Default the face centre"),
    kind: z.enum(["simple", "cbore", "csink", "tapped"]).optional().describe("Default simple"), size: z.string().optional().describe("A screw size such as M3, M4 or #8: sets the diameter, and the bore, sink or thread"), dia: z.number().optional().describe("Hole diameter, mm (needed when size is not given)"), depth: z.number().optional().describe("Depth, mm. Leave out for a hole through the body"),
    shape: z.enum(["round", "square", "hex", "slot"]).optional().describe("Default round. square, hex and slot cut that outline as a sketch and one Extrude cut; kind and size are for round holes only"), width: z.number().optional().describe("square, hex, slot: the side, the width across flats, or the slot's width, mm"), length: z.number().optional().describe("slot: overall length, mm, more than width") },
  ({ body, face, layout, cols, rows, pitch, rowPitch, margin, stagger, angle, count, radius, start, center, kind, size, dia, depth, shape, width, length }, s) => call(s, "holePattern", {
    body, face,
    layout: layout === "circle" ? { type: "circle", count, radius, start, center, margin } : { type: "grid", cols, rows, pitch: rowPitch != null ? [pitch, rowPitch] : pitch, margin, stagger, angle },
    hole: { shape, kind, size, dia, depth, width, length },
  }));
tool("add_gear", "Adds a gear and returns its id: a spur gear, a straight bevel gear (meshes at 90 degrees with a bevel gear of mate teeth) or a straight rack. Involute teeth, 20 degree pressure angle, metric module in mm (for an inch diametral pitch DP use 25.4 / DP). A gear lies flat with its axis along z through at and tooth 0 pointing along +x; a rack runs along +x from at with its pitch line through at and its teeth pointing +y. Two spur gears of one module mesh with centres module * (teeth1 + teeth2) / 2 apart; when teeth2 is even, turn the second one by 180 / teeth2 degrees about its own axis. clear (default 0.1 mm) thins every tooth so printed gears turn freely. Spur 12 to 200 teeth, bevel 12 to 90, rack 2 to 100; call wait_ready after.",
  { kind: z.enum(["spur", "bevel", "rack"]).optional().describe("Default spur"), module: z.number().describe("Tooth size in mm, 0.3 to 10; pitch diameter = module x teeth"), teeth: z.number().describe("Spur 12 to 200, bevel 12 to 90, rack 2 to 100"), width: z.number().optional().describe("Thickness in mm. Default 6; a bevel gear at most a third of the way to its cone's tip"), mate: z.number().optional().describe("Bevel only: the partner bevel gear's teeth. Default the same as teeth"), base: z.number().optional().describe("Rack only: height of the solid strip under the teeth, mm. Default 5"), bore: z.number().optional().describe("Spur and bevel: shaft hole diameter, mm. Default 0, none"), keyway: z.boolean().optional().describe("Spur with a 6 to 58 mm bore: add a DIN 6885 keyway"), clear: z.number().optional().describe("Print clearance, mm, taken off every tooth. Default 0.1"), at: vec3().optional().describe("Where to put it, mm. Default [0, 0, 0]"), name: z.string().optional().describe("Name for the body") },
  ({ kind, module, teeth, width, mate, base, bore, keyway, clear, at, name }, s) => call(s, "gear", { kind, module, teeth, width, mate, base, bore, keyway, clear, at, name }));
tool("remove_bodies", "Deletes bodies. Returns how many.", { ids: ids() }, ({ ids }, s) => call(s, "remove", ids));
tool("duplicate_bodies", "Copies bodies, shifted by offset (mm). Returns the new ids.", { ids: ids(), offset: vec3().optional() }, ({ ids, offset }, s) => call(s, "duplicate", ids, offset));
tool("move_bodies", "Moves bodies by [dx, dy, dz] mm.", { ids: ids(), delta: vec3() }, ({ ids, delta }, s) => call(s, "move", ids, delta));
tool("move_to", "Puts one body's origin at [x, y, z] mm.", { id: z.string(), position: vec3() }, ({ id, position }, s) => call(s, "moveTo", id, position));
tool("rotate_bodies", "Turns bodies by an angle in degrees about an axis through `about` (default: the middle of their box, which needs them built: call wait_ready first, or pass about).",
  { ids: ids(), axis: z.union([z.enum(["x", "y", "z"]), vec3()]), degrees: z.number(), about: vec3().optional() }, ({ ids, axis, degrees, about }, s) => call(s, "rotate", ids, axis, degrees, about ? { about } : {}));
tool("resize_shape", "Changes the size of one basic shape (not a group), in mm. Give only the keys to change, such as {w: 50}.", { id: z.string(), size: size() }, ({ id, size }, s) => call(s, "resize", id, size));
tool("scale_bodies", "Scales bodies by a factor k, or [kx, ky, kz] along their own axes, about `about` (default: the middle of their box; needs them built). Works on any body.",
  { ids: ids(), k: z.union([z.number().positive(), z.array(z.number().positive()).length(3)]), about: vec3().optional() }, ({ ids, k, about }, s) => call(s, "scale", ids, k, about ? { about } : {}));
tool("set_hole", "Marks basic shapes as holes (cutters, shown see-through) or solid again.", { ids: ids(), hole: z.boolean() }, ({ ids, hole }, s) => call(s, "setHole", ids, hole));
tool("set_color", "Sets the colour of bodies.", { ids: ids(), color: z.string().describe('"#rrggbb"') }, ({ ids, color }, s) => call(s, "setColor", ids, color));
tool("rename_body", "Renames a body.", { id: z.string(), name: z.string() }, ({ id, name }, s) => call(s, "rename", id, name));
tool("set_hidden", "Hides or shows bodies. Hidden bodies are left out of exports.", { ids: ids(), hidden: z.boolean() }, ({ ids, hidden }, s) => call(s, "setHidden", ids, hidden));
tool("group_bodies", "Combines two or more bodies into one group and returns its id. By default it joins them; any bodies marked as holes are cut out of the result. op \"cut\" subtracts the others from the first id; op \"intersect\" keeps only what they share.",
  { ids: ids(), name: z.string().optional(), op: z.enum(["cut", "intersect"]).optional() }, ({ ids, name, op }, s) => call(s, "group", ids, { name, op }));
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

tool("screenshot", "A PNG picture of the 3D view, after waiting for the shapes to build. Look at it after every few edits. fit (default true) frames everything shown first; width (default 800) is in pixels. Give `path` if your model cannot see images: the PNG is written there and you get {path, bytes, width} as text instead of the picture.",
  { width: z.number().int().min(1).max(8192).default(800), fit: z.boolean().default(true), path: z.string().optional().describe("Write the PNG to this file instead of returning the picture") },
  async ({ width, fit, path }, s) => {
    const png = await callLong(s, "screenshot", { fit, width });
    if (path) return { ...(await save(path, png)), width: png.readUInt32BE(16) }; // IHDR: the width follows the 8-byte signature and the chunk header
    return raw([{ type: "image", data: png.toString("base64"), mimeType: "image/png" }]);
  });
tool("export_file", "Writes the design to a file on this computer and returns its path and size. kind: stl, obj, 3mf, step, or json (the project file). Holes and hidden bodies are left out; ids limits it to some bodies. Relative paths are relative to the folder the server runs in.",
  { kind: exportKind, path: z.string(), ids: ids().optional() }, async ({ kind, path, ids }, s) => save(path, await callLong(s, "export", kind, ids ? { ids } : {})));
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
