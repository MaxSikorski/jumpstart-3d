// jumpstart-3d: chat tools. The same 36 tools the MCP server offers (mcp/tools.mjs), described to a model
// and run straight against window.JS3D (see BRIDGE.md). Three rules:
//  1. Names and descriptions are copied from mcp/tools.mjs; mcp/test/chat.test.mjs fails if they drift.
//     Six differ on purpose (no server, no file paths): status, screenshot, export_file, save_project, load_project, run_script.
//  2. The parameter schemas are flat (no anyOf, oneOf, $ref, default, additionalProperties): small local models read them
//     badly otherwise. Constraints such as "exactly 3 numbers" are said in the description instead.
//  3. run(args, ctx) returns a plain value, or { $text } for raw text, or { $text, $image, $dataURL } for a picture, and throws
//     a plain Error for bad input. ctx is { scripts, vision, download(filename, bytes) }.
// No top-level use of window or document: a node test imports this file.
const J = () => window.JS3D;

// Parameter pieces. Each call builds a fresh object so no schema shares a node with another.
const str = (description) => ({ type: "string", description });
const bool = (description) => ({ type: "boolean", description });
const num = (description) => ({ type: "number", description });
const vec3 = (description) => ({ type: "array", items: { type: "number" }, description: `Exactly 3 numbers. ${description}` });
const ids = (description = "A list of body ids (see list_bodies)") => ({ type: "array", items: { type: "string" }, description });
const size = (description) => ({ type: "object", description: `${description} e.g. {w: 40, d: 30, h: 20} in mm; see list_kinds for each kind's keys` });

// Small models send [] for an optional list they do not want to give; that counts as not given.
const given = (a) => (Array.isArray(a) && !a.length ? undefined : a);

const tool = (name, description, properties, required, run) =>
  ({ name, description, parameters: { type: "object", properties, ...(required.length ? { required } : {}) }, run });

const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "").trim();

export const TOOLS = [
  tool("status", "Says the app version, the open design's name and mode, and how many bodies it has.", {}, [],
    () => ({ app: J().appVersion, js3d: J().version, design: J().doc().name, designMode: J().mode(), bodies: J().list().length })),
  tool("wait_ready", "Waits until the geometry engine has built every shape (volumes and bounding boxes in list_bodies are empty until then). Call it after edits and before reading sizes.",
    { timeout_ms: { type: "integer", description: "Give up after this many milliseconds (default 90000)" } }, [],
    async ({ timeout_ms }) => { await (timeout_ms ? J().ready(timeout_ms) : J().ready()); return { ready: true }; }),
  tool("list_kinds", "Lists the 20 shape kinds add_shape accepts, each with its default size (mm).", {}, [], () => J().kinds()),
  tool("list_bodies", "Lists the design's top-level bodies: id, name, kind, hole, hidden, color, position, bounding box (mm), volume (mm3) and any build error. bbox and volume are null until built (see wait_ready).", {}, [], () => J().list()),
  tool("get_body", "One body in full: the list_bodies entry plus its definition (node) and its 16-number matrix.", { id: str("A body id") }, ["id"], ({ id }) => J().get(id)),

  tool("add_shape", "Adds a basic shape and returns its id. The shape's footprint is centred on `at` [x, y] with its base at z. Set hole: true to make a cutter that group_bodies can subtract from another body.",
    { kind: str("box, cylinder, sphere, cone, ... (see list_kinds)"), size: size("Shape size in mm. A 3-number array [w, d, h] also works."), at: vec3("Where to put it, mm. Default [0, 0, 0]"), hole: bool("true makes a cutter"), color: str('"#rrggbb"'), name: str("Name for the body") },
    ["kind"], ({ kind, size, at, hole, color, name }) => J().add(kind, { size, at: given(at), hole, color, name })),
  tool("add_fastener", "Adds a threaded fastener and returns its id: a hex bolt (length under the head), a hex nut, a threaded rod, or a tap cutter (a threaded rod marked as a hole: put it inside a solid and group_bodies cuts a threaded hole). Sizes M2.5 to M12 (ISO coarse) and #6-32 to 1/2-20 (UNC / UNF). Building takes a few seconds: call wait_ready.",
    { type: { type: "string", enum: ["bolt", "nut", "rod", "cutter"], description: "bolt, nut, rod (threaded rod) or cutter (tap cutter)" }, size: str("M2.5, M3, M4, M5, M6, M8, M10, M12, or #6-32, #8-32, #10-24, #10-32, 1/4-20, 1/4-28, 5/16-18, 5/16-24, 3/8-16, 3/8-24, 1/2-13, 1/2-20"), length: num("Length in mm (under the head for a bolt). Not used for a nut. At least 3 turns of the thread, at most 150"), clear: num("Print offset in mm, from -1 to 0. Default 0; -0.2 suits most printers"), left: bool("true for a left-hand thread"), at: vec3("Where to put it, mm. Default [0, 0, 0]"), name: str("Name for the body") },
    ["type", "size"], ({ type, size, length, clear, left, at, name }) => J().fastener({ type, size, length, clear, left, at: given(at), name })),
  tool("add_hole_pattern", "Drills a pattern of holes into one flat face of a body and returns {id, holes, dropped}. face is the direction the face looks (+z is the top). Grid: cols x rows at pitch mm (rowPitch for the rows; leave pitch out to spread them over the face); stagger shifts every other row by half a pitch and makes it one hole shorter. Circle: count holes on radius around the face centre or center. Columns run along the face's longest straight edge (on a box top, the longer side), rows across it; angle and start are measured from that edge. Holes that would not fit inside the face and its margin are left out. Round holes (the default) are one Hole feature: kind simple, cbore, csink or tapped; size such as M3 or #8 sets the diameter (and the bore, sink or thread). shape square, hex or slot cuts that outline instead, as one sketch and one Extrude cut (the result also has sketch): width is the square's side, the hex's width across flats or the slot's width; length is the slot's overall length, along a row (pointing at the centre in a circle). At most 200 plain holes or shapes (130 counterbores or countersinks, 8 tapped); call wait_ready after.",
    { body: str("A body id (see list_bodies)"), face: { type: "string", enum: ["+x", "-x", "+y", "-y", "+z", "-z"], description: "The direction the flat face looks; +z is the top" }, layout: { type: "string", enum: ["grid", "circle"], description: "grid or circle" },
      cols: num("Grid: holes per row, 1 to 200"), rows: num("Grid: number of rows, 1 to 200"), pitch: num("Grid: distance between holes in a row, mm. Leave out to spread the holes over the face"), rowPitch: num("Grid: distance between rows, mm. Default: the same as pitch"),
      margin: num("Space kept between a hole's edge and the face's edge, mm. Default 0"), stagger: bool("Grid: shift every other row by half a pitch"), angle: num("Grid: turn the grid on the face, degrees. Default 0"),
      count: num("Circle: number of holes, 2 to 200"), radius: num("Circle: radius, mm"), start: num("Circle: angle of the first hole, degrees. Default 0"), center: vec3("Circle: the middle, [x, y, z] mm in the world, moved onto the face. Default the face centre"),
      kind: { type: "string", enum: ["simple", "cbore", "csink", "tapped"], description: "Default simple" }, size: str("A screw size such as M3, M4 or #8: sets the diameter, and the bore, sink or thread"), dia: num("Hole diameter, mm (needed when size is not given)"), depth: num("Depth, mm. Leave out for a hole through the body"),
      shape: { type: "string", enum: ["round", "square", "hex", "slot"], description: "Default round. square, hex and slot cut that outline as a sketch and one Extrude cut; kind and size are for round holes only" }, width: num("square, hex, slot: the side, the width across flats, or the slot's width, mm"), length: num("slot: overall length, mm, more than width") },
    ["body", "face", "layout"], ({ body, face, layout, cols, rows, pitch, rowPitch, margin, stagger, angle, count, radius, start, center, kind, size, dia, depth, shape, width, length }) => J().holePattern({
      body, face,
      layout: layout === "circle" ? { type: "circle", count, radius, start, center: given(center), margin } : { type: "grid", cols, rows, pitch: rowPitch != null ? [pitch, rowPitch] : pitch, margin, stagger, angle },
      hole: { shape, kind, size, dia, depth, width, length },
    })),
  tool("remove_bodies", "Deletes bodies. Returns how many.", { ids: ids() }, ["ids"], ({ ids }) => J().remove(ids)),
  tool("duplicate_bodies", "Copies bodies, shifted by offset (mm). Returns the new ids.", { ids: ids(), offset: vec3("Shift in mm, [dx, dy, dz]. Default none") }, ["ids"], ({ ids, offset }) => J().duplicate(ids, given(offset))),
  tool("move_bodies", "Moves bodies by [dx, dy, dz] mm.", { ids: ids(), delta: vec3("[dx, dy, dz] in mm") }, ["ids", "delta"], ({ ids, delta }) => J().move(ids, delta)),
  tool("move_to", "Puts one body's origin at [x, y, z] mm.", { id: str("A body id"), position: vec3("[x, y, z] in mm") }, ["id", "position"], ({ id, position }) => J().moveTo(id, position)),
  tool("rotate_bodies", "Turns bodies by an angle in degrees about an axis through `about` (default: the middle of their box, which needs them built: call wait_ready first, or pass about).",
    { ids: ids(), axis: { type: "string", enum: ["x", "y", "z"], description: "The axis to turn about. Use axis_vector for any other direction" }, axis_vector: vec3("An axis direction [x, y, z]. If given it is used instead of axis"), degrees: num("Angle in degrees"), about: vec3("A point the axis passes through, mm") },
    ["ids", "degrees"], ({ ids, axis, axis_vector, degrees, about }) => J().rotate(ids, given(axis_vector) || axis, degrees, given(about) ? { about } : {})),
  tool("resize_shape", "Changes the size of one basic shape (not a group), in mm. Give only the keys to change, such as {w: 50}.", { id: str("A body id"), size: size("The keys to change.") }, ["id", "size"], ({ id, size }) => J().resize(id, size)),
  tool("scale_bodies", "Scales bodies by a factor k, or [kx, ky, kz] along their own axes, about `about` (default: the middle of their box; needs them built). Works on any body.",
    { ids: ids(), k: num("One factor for all three directions, above 0"), k_xyz: vec3("Separate factors [kx, ky, kz], each above 0. If given it is used instead of k"), about: vec3("The point to scale about, mm") },
    ["ids"], ({ ids, k, k_xyz, about }) => J().scale(ids, given(k_xyz) || k, given(about) ? { about } : {})),
  tool("set_hole", "Marks basic shapes as holes (cutters, shown see-through) or solid again.", { ids: ids(), hole: bool("true for a hole, false for solid") }, ["ids", "hole"], ({ ids, hole }) => J().setHole(ids, hole)),
  tool("set_color", "Sets the colour of bodies.", { ids: ids(), color: str('"#rrggbb"') }, ["ids", "color"], ({ ids, color }) => J().setColor(ids, color)),
  tool("rename_body", "Renames a body.", { id: str("A body id"), name: str("The new name") }, ["id", "name"], ({ id, name }) => J().rename(id, name)),
  tool("set_hidden", "Hides or shows bodies. Hidden bodies are left out of exports.", { ids: ids(), hidden: bool("true hides, false shows") }, ["ids", "hidden"], ({ ids, hidden }) => J().setHidden(ids, hidden)),
  tool("group_bodies", "Combines two or more bodies into one group and returns its id. By default it joins them; any bodies marked as holes are cut out of the result. op \"cut\" subtracts the others from the first id; op \"intersect\" keeps only what they share.",
    { ids: ids(), name: str("Name for the group"), op: { type: "string", enum: ["cut", "intersect"], description: "Leave out to join" } },
    ["ids"], ({ ids, name, op }) => J().group(ids, { name, op })),
  tool("ungroup_body", "Splits a group back into its parts and returns their ids.", { id: str("A group id") }, ["id"], ({ id }) => J().ungroup(id)),

  tool("list_params", "Lists the design's named parameters: name, expression, value (mm) and unit.", {}, [], () => J().params()),
  tool("set_param", "Adds or changes a named parameter. The expression can use numbers, other parameters and units (\"40\", \"w/2\", \"1in\"). Returns its value in mm.",
    { name: str("Parameter name"), expr: str("The expression"), unit: { type: "string", enum: ["mm", "in"], description: "Unit of a plain number" } },
    ["name", "expr"], ({ name, expr, unit }) => J().setParam(name, expr, unit ? { unit } : {})),
  tool("remove_param", "Deletes a parameter. Returns how many places used it.", { name: str("Parameter name") }, ["name"], ({ name }) => J().removeParam(name)),
  tool("bind_size", "Ties one size of a basic shape (key \"w\", \"d\", \"h\"...) to an expression such as \"w/2\", so it follows the parameters; null frees it. Returns the size now.",
    { id: str("A body id"), key: str('The size key: "w", "d", "h", ...'), expr: str('An expression such as "w/2". An empty string frees the size') },
    ["id", "key", "expr"], ({ id, key, expr }) => J().bind(id, key, expr === "" || expr === undefined ? null : expr)),

  tool("undo", "Undoes the last edit. Returns its label, or null when there is nothing to undo.", {}, [], () => J().undo()),
  tool("redo", "Redoes the last undone edit. Returns its label, or null.", {}, [], () => J().redo()),
  tool("select_bodies", "Selects bodies in the view (an empty list clears the selection).", { ids: ids("A list of body ids; empty clears the selection") }, ["ids"], ({ ids }) => J().select(ids)),
  tool("fit_view", "Frames the selection, or everything when nothing is selected.", {}, [], () => J().fit()),
  tool("set_mode", "Switches the app between Beginner and Advanced mode.", { mode: { type: "string", enum: ["beginner", "advanced"], description: "The mode" } }, ["mode"], ({ mode }) => J().setMode(mode)),

  tool("screenshot", "A PNG picture of the 3D view, after waiting for the shapes to build. Look at it after every few edits. fit (default true) frames everything shown first; width (default 800) is in pixels. If this model cannot see images you get a one-line text note instead of the picture.",
    { width: { type: "integer", description: "1 to 8192, default 800" }, fit: bool("default true") }, [],
    async ({ width = 800, fit = true }, ctx) => {
      const $dataURL = await J().screenshotDataURL({ fit, width });
      if (!ctx.vision) return { $text: `Screenshot taken (${width} px wide) and shown to the user; this model cannot see images, so check sizes with list_bodies.`, $dataURL };
      return { $text: "screenshot taken", $image: $dataURL.split(",")[1], $dataURL };
    }),
  tool("export_file", "Offers the design as a file download in the user's browser (kind: stl, obj, 3mf, step, or json, the project file). Holes and hidden bodies are left out; ids limits it to some bodies. Returns the file name and size.",
    { kind: { type: "string", enum: ["stl", "obj", "3mf", "step", "json"], description: "The file type" }, ids: ids("Only these bodies. Leave out for the whole design"), name: str("File name without the extension") }, ["kind"],
    async ({ kind, ids, name }, ctx) => {
      const bytes = await J().export(kind, given(ids) ? { ids } : {});
      const file = `${safeName(name) || safeName(J().doc().name) || "design"}.${kind}`;
      ctx.download(file, bytes);
      return { file, bytes: bytes.length };
    }),
  tool("save_project", "Returns the whole design as project-file JSON text (see BRIDGE.md).", {}, [],
    async () => ({ $text: new TextDecoder().decode(await J().export("json")) })),
  tool("load_project", "Opens a project file (its JSON text) in place of the open design. The open design stays in the app's Your designs list.",
    { json: str("The project file's JSON text") }, ["json"], async ({ json }) => { await J().load(json); return { loaded: true }; }),
  tool("new_design", "Starts an empty design (the previous one stays in the app's Your designs list).", { mode: { type: "string", enum: ["beginner", "advanced"], description: "The mode. Default beginner" } }, [],
    async ({ mode }) => { await J().newDesign(mode); return { ok: true }; }),
  tool("run_script", "Runs JavaScript in the page with JS3D and app in scope (see BRIDGE.md) and returns the value as JSON. Top-level await works; end with return to give a value back, or make a plain script's last expression the value. Use it for anything the other tools do not cover. It has the full power of the page. Only available when the user has ticked Allow scripts in the chat settings.",
    { code: str("The JavaScript to run") }, ["code"],
    ({ code }, ctx) => {
      if (!ctx.scripts) throw new Error("Scripts are off. The user can tick Allow scripts in the chat settings.");
      return J().run(code);
    }),
];

// The one place that turns "returned nothing" into null, so the model always gets a value.
export async function runTool(tool, args, ctx) {
  const v = await tool.run(args || {}, ctx);
  return v === undefined ? null : v;
}
