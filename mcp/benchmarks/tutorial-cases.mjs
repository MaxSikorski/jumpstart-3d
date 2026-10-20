const p = (id, kind, parameters, extra = {}) => ({ id, kind, parameters, ...extra });
const circle = (id, plane, origin, radius) => ({ id, plane, origin, profile: { type: "circle", center: [0, 0], radius } });
const polygon = (id, plane, origin, points) => ({ id, plane, origin, profile: { type: "polygon", points } });
const bodyPlan = (name, primitives, operations = [], more = {}) => ({ name, mode: "beginner", primitives, operations, ...more });
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
const flatten = (node, bodies, modifiers, hole = false, transform = null) => {
  if (!node || typeof node !== "object") return;
  if (node.t === "prim") bodies.push({ ...node, hole, transform });
  for (const modifier of node.mods || []) { modifiers.push(modifier); if (modifier.tool) flatten(modifier.tool, bodies, modifiers); }
  for (const child of node.children || []) flatten(child.node, bodies, modifiers, !!child.hole, child.m || null);
};
const content = (document) => {
  const bodies = [], modifiers = [];
  for (const body of document.bodies) flatten(body.featureTree, bodies, modifiers);
  return { bodies, modifiers };
};
const requirePrim = (document, kind, predicate = () => true, hole) => {
  const found = content(document).bodies.some((body) => body.kind === kind && (hole === undefined || body.hole === hole) && predicate(body.p || {}));
  if (!found) throw new Error(`Expected a ${kind} primitive with the tutorial dimensions`);
};
const requireModifierCount = (document, kind, count) => {
  const actual = content(document).modifiers.filter((modifier) => modifier.t === kind).length;
  if (actual < count) throw new Error(`Expected at least ${count} ${kind} features; found ${actual}`);
};
const requireHolePrimitiveCount = (document, kind, count, predicate = () => true) => {
  const actual = content(document).bodies.filter((body) => body.hole && body.kind === kind && predicate(body.p || {})).length;
  if (actual < count) throw new Error(`Expected at least ${count} ${kind} hole primitives; found ${actual}`);
};
const requireValidBodies = (document) => {
  if (!document.bodies.length) throw new Error("The document contains no solid bodies");
  for (const body of document.bodies) {
    if (body.error) throw new Error(`${body.name}: ${body.error}`);
    if (!body.dimensions || Object.values(body.dimensions).some((value) => !(value > 0))) throw new Error(`${body.name}: missing positive dimensions`);
    if (!(body.volume > 0) || !(body.triangleCount > 0)) throw new Error(`${body.name}: missing valid solid measurements`);
  }
};
const bodyNamed = (preview, name) => {
  const body = preview.bodies?.find((entry) => entry.name === name);
  if (!body) throw new Error(`Preview did not return body ${name}`);
  return body;
};
const edges = (body, predicate, count = 1) => {
  const found = (body.geometrySelectors?.edges || []).filter(predicate).map(({ index, ...signature }) => signature).slice(0, count);
  if (found.length < count) throw new Error(`Preview did not find ${count} matching edges on ${body.name}`);
  return found;
};
const faces = (body, predicate, count = 1) => {
  const found = (body.geometrySelectors?.faces || []).filter(predicate).map(({ c }) => ({ c })).slice(0, count);
  if (found.length < count) throw new Error(`Preview did not find ${count} matching faces on ${body.name}`);
  return found;
};
const modifier = (id, target, definition) => ({ id, type: "modifier", target, modifier: definition });

export const TUTORIAL_CASES = [
  {
    id: "b-keychain", title: "Name keychain", prompt: "Make a rounded 60 by 25 by 4 mm keychain tag with the name Mia raised 2 mm, and a 6 mm ring hole 6 mm from the left edge.",
    plan: bodyPlan("Lopez, Mia, Keychain", [
      p("tag", "box", { w: 60, d: 25, h: 4, r: 1.5 }),
      p("name", "text", { text: "Mia", size: 9, h: 2, font: "sans" }, { position: [5, 0, 4] }),
      p("ring-hole", "cylinder", { w: 6, d: 6, h: 10 }, { position: [-24, 0, -2], hole: true }),
    ], [{ id: "finished", type: "group", name: "Keychain", members: ["tag", "name", "ring-hole"] }]),
    verify(document) { requireValidBodies(document); requirePrim(document, "box", (q) => near(q.w, 60) && near(q.d, 25) && near(q.h, 4)); requirePrim(document, "text", (q) => q.text === "Mia" && near(q.size, 9)); requirePrim(document, "cylinder", (q) => near(q.w, 6), true); },
  },
  {
    id: "b-coaster", title: "Coaster with drainage channels", prompt: "Make a 100 mm round, 6 mm thick coaster with seven 4 mm wide drainage channels spaced 14 mm apart, 3 mm deep.",
    plan: bodyPlan("Lopez, Mia, Coaster", [
      p("coaster", "cylinder", { w: 100, d: 100, h: 6, r: 2 }),
      p("channel", "box", { w: 110, d: 4, h: 4 }, { position: [0, 0, 3], hole: true }),
    ], [
      { id: "channels", type: "pattern", source: "channel", mode: "linear", axis: "Y", count: 4, spacing: 14, symmetric: true },
      { id: "finished", type: "group", name: "Coaster with channels", members: ["coaster", "channels"] },
    ]),
    verify(document) { requireValidBodies(document); requirePrim(document, "cylinder", (q) => near(q.w, 100) && near(q.h, 6)); requireHolePrimitiveCount(document, "box", 7, (q) => near(q.d, 4)); },
  },
  {
    id: "b-pencil", title: "Hexagon pencil holder", prompt: "Create a hexagonal pencil holder, 80 mm wide and 100 mm tall, with 4 mm walls and floor.",
    plan: bodyPlan("Lopez, Mia, Pencil Holder", [
      p("outer", "prism", { w: 80, d: 80, h: 100, sides: 6 }),
      p("cavity", "prism", { w: 72, d: 72, h: 100, sides: 6 }, { position: [0, 0, 4], hole: true }),
    ], [{ id: "finished", type: "group", name: "Pencil Holder", members: ["outer", "cavity"] }]),
    verify(document) { requireValidBodies(document); requirePrim(document, "prism", (q) => q.sides === 6 && near(q.w, 80) && near(q.h, 100)); requirePrim(document, "prism", (q) => q.sides === 6 && near(q.w, 72), true); },
  },
  {
    id: "b-phone", title: "Phone stand", prompt: "Make a phone stand with a 70 by 70 by 5 mm base, a sloped wedge, a 15 mm front lip, and a 16 by 20 mm cable slot.",
    plan: bodyPlan("Lopez, Mia, Phone Stand", [
      p("base", "box", { w: 70, d: 70, h: 5 }, { position: [0, -10, 0] }),
      p("slope", "wedge", { w: 50, d: 70, h: 65 }, { rotation: [0, 0, 90] }),
      p("lip", "box", { w: 70, d: 5, h: 15 }, { position: [0, -40.5, 0] }),
      p("cable-slot", "box", { w: 16, d: 20, h: 30 }, { position: [0, -38, -1], hole: true }),
    ], [{ id: "finished", type: "group", name: "Phone Stand", members: ["base", "slope", "lip", "cable-slot"] }]),
    verify(document) { requireValidBodies(document); requirePrim(document, "box", (q) => near(q.w, 70) && near(q.d, 70) && near(q.h, 5)); requirePrim(document, "wedge", (q) => near(q.w, 50) && near(q.h, 65)); requirePrim(document, "box", (q) => near(q.w, 16), true); },
  },
  {
    id: "b-fidget", title: "Fidget spinner", prompt: "Create a three-arm fidget spinner with a 30 mm hub, three 26 mm weights, a 22.2 mm center hole, and three 16 mm weight holes.",
    plan: bodyPlan("Lopez, Mia, Fidget Spinner", [
      p("hub", "cylinder", { w: 30, d: 30, h: 7 }),
      p("arm-weight", "cylinder", { w: 26, d: 26, h: 7 }, { position: [34, 0, 0] }),
      p("arm-connector", "box", { w: 30, d: 12, h: 7 }, { position: [17, 0, 0] }),
      p("bearing-hole", "cylinder", { w: 22.2, d: 22.2, h: 10 }, { position: [0, 0, -1], hole: true }),
      p("weight-hole", "cylinder", { w: 16, d: 16, h: 10 }, { position: [34, 0, -1], hole: true }),
    ], [
      { id: "arm", type: "group", members: ["arm-weight", "arm-connector"] },
      { id: "arms", type: "pattern", source: "arm", mode: "circular", axis: "Z", count: 3, angle: 360, origin: [0, 0, 0] },
      { id: "weights", type: "pattern", source: "weight-hole", mode: "circular", axis: "Z", count: 3, angle: 360, origin: [0, 0, 0] },
      { id: "finished", type: "group", name: "Fidget Spinner", members: ["hub", "arms", "bearing-hole", "weights"] },
    ]),
    verify(document) { requireValidBodies(document); requirePrim(document, "cylinder", (q) => near(q.w, 30) && near(q.h, 7)); requirePrim(document, "cylinder", (q) => near(q.w, 22.2), true); requireHolePrimitiveCount(document, "cylinder", 3, (q) => near(q.w, 16)); },
  },
  {
    id: "b-rocket", title: "Rocket with fins", prompt: "Build a 30 mm diameter, 70 mm tall rocket with a 30 mm cone, four radial fins, and a 14 mm porthole on the front.",
    plan: bodyPlan("Lopez, Mia, Rocket", [
      p("body", "cylinder", { w: 30, d: 30, h: 70 }),
      p("nose", "cone", { w: 30, d: 30, h: 30 }, { position: [0, 0, 70] }),
      p("fin", "wedge", { w: 25, d: 3, h: 30 }, { position: [26, 0, 0] }),
      p("porthole", "torus", { w: 14, d: 14, h: 2, tube: 2 }, { position: [0, -15, 42], rotation: [90, 0, 0] }),
    ], [
      { id: "fins", type: "pattern", source: "fin", mode: "circular", axis: "Z", count: 4, angle: 360, origin: [0, 0, 0] },
      { id: "finished", type: "group", name: "Rocket", members: ["body", "nose", "fins", "porthole"] },
    ]),
    verify(document) { requireValidBodies(document); requirePrim(document, "cylinder", (q) => near(q.w, 30) && near(q.h, 70)); if (content(document).bodies.filter((q) => q.kind === "wedge").length < 4) throw new Error("Expected four radial fins"); },
  },
  {
    id: "b-desk", title: "Desk organizer with name", prompt: "Make a 120 by 80 by 60 mm desk organizer with a 30 mm pen cup, three 12 mm pencil holes, a phone slot, and Mia's raised name on the front.",
    plan: bodyPlan("Lopez, Mia, Desk Organizer", [
      p("block", "box", { w: 120, d: 80, h: 60, r: 2 }),
      p("cup", "cylinder", { w: 30, d: 30, h: 60 }, { position: [-35, 10, 4], hole: true }),
      p("pencil-hole", "cylinder", { w: 12, d: 12, h: 60 }, { position: [5, 22, 10], hole: true }),
      p("slot", "box", { w: 100, d: 12, h: 60 }, { position: [0, -25, 20], hole: true }),
      p("name", "text", { text: "Mia", size: 12, h: 2, font: "sans" }, { position: [0, -41, 22], rotation: [270, 0, 0] }),
    ], [
      { id: "pencil-row", type: "pattern", source: "pencil-hole", mode: "linear", axis: "X", count: 3, spacing: 16 },
      { id: "finished", type: "group", name: "Desk Organizer", members: ["block", "cup", "pencil-row", "slot", "name"] },
    ]),
    verify(document) { requireValidBodies(document); requirePrim(document, "box", (q) => near(q.w, 120) && near(q.d, 80) && near(q.h, 60)); requireHolePrimitiveCount(document, "cylinder", 1, (q) => near(q.w, 30)); requireHolePrimitiveCount(document, "cylinder", 3, (q) => near(q.w, 12)); requireHolePrimitiveCount(document, "box", 1, (q) => near(q.w, 100)); requirePrim(document, "text", (q) => q.text === "Mia"); },
  },
  {
    id: "b-castle", title: "Castle tower", prompt: "Build an 80 mm tall castle tower with 5 mm walls, four pairs of battlements, an arched doorway, and four-sided window slits.",
    plan: bodyPlan("Lopez, Mia, Castle Tower", [
      p("tower", "tube", { w: 60, d: 60, h: 80, wall: 5 }),
      p("floor", "cylinder", { w: 60, d: 60, h: 4 }),
      p("battlement", "box", { w: 70, d: 10, h: 10 }, { position: [0, 0, 72], hole: true }),
      p("door", "box", { w: 16, d: 20, h: 21 }, { position: [0, -28, -1], hole: true }),
      p("arch", "cylinder", { w: 16, d: 16, h: 20 }, { position: [0, -28, 12], rotation: [90, 0, 0], hole: true }),
      p("slit", "box", { w: 4, d: 70, h: 14 }, { position: [0, 0, 45], hole: true }),
    ], [
      { id: "battlements", type: "pattern", source: "battlement", mode: "circular", axis: "Z", count: 4, angle: 135, origin: [0, 0, 0] },
      { id: "windows", type: "pattern", source: "slit", mode: "circular", axis: "Z", count: 2, angle: 90, origin: [0, 0, 0] },
      { id: "finished", type: "group", name: "Castle Tower", members: ["tower", "floor", "battlements", "door", "arch", "windows"] },
    ]),
    verify(document) { requireValidBodies(document); requirePrim(document, "tube", (q) => near(q.w, 60) && near(q.h, 80) && near(q.wall, 5)); requireHolePrimitiveCount(document, "box", 4, (q) => near(q.w, 70)); requireHolePrimitiveCount(document, "box", 2, (q) => near(q.w, 4)); if (content(document).bodies.filter((q) => q.hole).length < 8) throw new Error("Expected eight tower cutter instances"); },
  },
  {
    id: "a-coaster", title: "Advanced coaster with drainage channels", prompt: "Create a 100 mm round coaster, 6 mm thick, with a 1.5 mm rounded top edge and seven 3 mm deep drainage channels.",
    async buildPlan(preview) {
      const base = { name: "Lopez, Mia, Coaster", mode: "advanced", sketches: [circle("disk", "XY", [0, 0, 0], 50)], features: [{ id: "coaster", type: "extrude", sketch: "disk", distance: 6 }] };
      const geometry = await preview(base);
      const edge = edges(bodyNamed(geometry, "coaster"), (item) => item.t === "CIRCLE" && Math.abs(item.m[2] - 6) < 0.01)[0];
      return {
        ...base,
        sketches: [...base.sketches, polygon("channel-profile", "XY", [0, 0, 6], [[-55, -2], [55, -2], [55, 2], [-55, 2]])],
        features: [...base.features, { id: "channel", type: "extrude", sketch: "channel-profile", distance: -3 }],
        operations: [
          modifier("round-top", "coaster", { type: "fillet", radius: 1.5, edges: [edge] }),
          { id: "channel-row", type: "pattern", source: "channel", mode: "linear", axis: "Y", count: 4, spacing: 14, symmetric: true },
          { id: "channel-tools", type: "group", members: ["channel-row"] },
          { id: "cut-channels", type: "combine", target: "coaster", tool: "channel-tools", operation: "cut" },
        ],
      };
    },
    verify(document) { requireValidBodies(document); requireModifierCount(document, "fillet", 1); requireModifierCount(document, "bool", 1); if (!document.sketches.some((sketch) => sketch.entityCount >= 4)) throw new Error("Expected the rectangular channel sketch"); const cut = content(document).modifiers.find((entry) => entry.t === "bool" && entry.src === "combine" && entry.op === "cut"); if ((cut?.tool?.children || []).length !== 7) throw new Error("Expected a cut feature with seven patterned channel tools"); },
  },
  {
    id: "a-plate", title: "Desk name plate", prompt: "Make a symmetric 160 mm thick triangular desk name plate, round its top edge, hollow it from below, and emboss Mia on the sloped face.",
    async buildPlan(preview) {
      const base = { name: "Lopez, Mia, Name Plate", mode: "advanced", sketches: [polygon("plate", "XZ", [0, 0, 0], [[0, 0], [40, 0], [40 - 40 / Math.sqrt(2), 40 / Math.sqrt(2)]])], features: [{ id: "plate-body", type: "extrude", sketch: "plate", distance: 160, mode: "sym" }] };
      const geometry = await preview(base);
      const info = bodyNamed(geometry, "plate-body");
      const topEdge = edges(info, (edge) => edge.t === "LINE" && edge.a && edge.b && Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1], edge.b[2] - edge.a[2]) > 150, 1)[0];
      const bottomFace = faces(info, (face) => face.t === "PLANE" && face.c[2] < 0.5)[0];
      const slope = (info.geometrySelectors?.faces || []).find((face) => face.t === "PLANE" && Math.abs(face.n?.[0] || 0) > 0.4 && face.c[2] > 1);
      if (!slope) throw new Error("Could not identify the sloped planar face for embossing");
      const n = slope.n;
      const tangent = [1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]];
      const tangentLength = Math.hypot(...tangent) || 1;
      const x = tangent.map((value) => value / tangentLength);
      return {
        ...base,
        operations: [
          modifier("top-round", "plate-body", { type: "fillet", radius: 3, edges: [topEdge] }),
          modifier("underside-shell", "plate-body", { type: "shell", thickness: 2, faces: [bottomFace] }),
          modifier("name", "plate-body", { type: "emboss", geo: { kind: "plane", p: slope.c, n, x }, text: "Mia", size: 14, depth: 1.5 }),
        ],
      };
    },
    verify(document) { requireValidBodies(document); requireModifierCount(document, "fillet", 1); requireModifierCount(document, "shell", 1); requireModifierCount(document, "emboss", 1); },
  },
  {
    id: "a-phone", title: "Phone stand from a side profile", prompt: "Extrude this 75 by 60 mm side profile symmetrically to 70 mm wide and fillet the lip and slope edges by 2 mm.",
    async buildPlan(preview) {
      const base = { name: "Lopez, Mia, Phone Stand", mode: "advanced", sketches: [polygon("side", "XZ", [0, 0, 0], [[0, 0], [75, 0], [75, 15], [63, 15], [63, 8], [33, 60]])], features: [{ id: "stand", type: "extrude", sketch: "side", distance: 70, mode: "sym" }] };
      const geometry = await preview(base);
      const info = bodyNamed(geometry, "stand");
      const longEdges = edges(info, (edge) => edge.t === "LINE" && Math.abs(edge.b?.[1] - edge.a?.[1]) > 69 && edge.m[2] > 7, 2);
      return { ...base, operations: [modifier("round-lip-and-slope", "stand", { type: "fillet", radius: 2, edges: longEdges })] };
    },
    verify(document) { requireValidBodies(document); requireModifierCount(document, "fillet", 1); const body = document.bodies.find((entry) => entry.feature === "extrude"); if (!body || !near(body.dimensions.y, 70, 1)) throw new Error("Phone stand should be 70 mm wide"); },
  },
  {
    id: "a-pawn", title: "Chess pawn", prompt: "Revolve the supplied pawn profile 360 degrees around Z, round its head and base edges, and drill a 10 mm by 8 mm blind pocket underneath.",
    async buildPlan(preview) {
      const points = [[0, 0], [16, 0], [16, 5], [12, 5], [12, 8], [7, 8], [7, 28], [10, 28], [10, 31], [6, 31], [6, 34], [9, 34], [9, 48], [0, 48]];
      const base = { name: "Lopez, Mia, Chess Pawn", mode: "advanced", sketches: [polygon("pawn-section", "XZ", [0, 0, 0], points)], features: [{ id: "pawn", type: "revolve", sketch: "pawn-section", axis: "Z", angle: 360 }] };
      const geometry = await preview(base);
      const top = edges(bodyNamed(geometry, "pawn"), (edge) => edge.t === "CIRCLE" && edge.m[2] > 47.9)[0];
      const firstPlan = { ...base, operations: [modifier("head-round", "pawn", { type: "fillet", radius: 7, edges: [top] })] };
      const first = await preview(firstPlan);
      const info = bodyNamed(first, "pawn");
      const baseAndHead = edges(info, (edge) => edge.t === "CIRCLE" && (Math.abs(edge.m[2] - 5) < 0.2 || Math.abs(edge.m[2] - 34) < 0.2), 2);
      const requested = { ...firstPlan, operations: [...firstPlan.operations, modifier("soft-base", "pawn", { type: "fillet", radius: 1.5, edges: baseAndHead }), modifier("weight-pocket", "pawn", { type: "hole", kind: "simple", diameter: 10, through: false, depth: 8, at: [{ p: [0, 0, 0], n: [0, 0, -1] }] })] };
      try { await preview(requested); return requested; }
      catch (error) {
        const fit = /largest that fits is about ([0-9.]+) mm/i.exec(error.message || "");
        if (!fit) throw error;
        const correctedRadius = Math.floor(Number(fit[1]) * 0.9 * 10) / 10;
        return { ...requested, operations: requested.operations.map((operation) => operation.id === "soft-base" ? modifier("soft-base", "pawn", { type: "fillet", radius: correctedRadius, edges: baseAndHead }) : operation) };
      }
    },
    verify(document) { requireValidBodies(document); requireModifierCount(document, "fillet", 2); requireModifierCount(document, "hole", 1); if (!document.bodies.some((body) => body.feature === "revolve" && near(body.dimensions.z, 48, 1))) throw new Error("Expected the 48 mm revolved pawn body"); },
  },
  {
    id: "a-vase", title: "Lofted vase", prompt: "Create a smooth vase through circles of diameter 60, 90, and 50 mm at heights 0, 60, and 120 mm, then shell it 2 mm inward with an open top.",
    async buildPlan(preview) {
      const base = { name: "Lopez, Mia, Vase", mode: "advanced", planes: [{ id: "plane-60", plane: "XY", origin: [0, 0, 60] }, { id: "plane-120", plane: "XY", origin: [0, 0, 120] }], sketches: [circle("bottom", "XY", [0, 0, 0], 30), circle("middle", "XY", [0, 0, 60], 45), circle("top", "XY", [0, 0, 120], 25)], features: [{ id: "vase", type: "loft", sections: ["bottom", "middle", "top"] }] };
      const geometry = await preview(base);
      const top = faces(bodyNamed(geometry, "vase"), (face) => face.t === "PLANE" && face.c[2] > 119.9)[0];
      return { ...base, operations: [modifier("open-top-shell", "vase", { type: "shell", thickness: 2, faces: [top] })] };
    },
    verify(document) { requireValidBodies(document); requireModifierCount(document, "shell", 1); if (!document.bodies.some((body) => body.feature === "loft" && near(body.dimensions.z, 120, 1))) throw new Error("Expected a 120 mm tall lofted vase"); if (document.planes.length < 2) throw new Error("Expected two offset construction planes"); },
  },
  {
    id: "a-hook", title: "Wall hook with screw holes", prompt: "Make a 60 mm tall J-shaped wall hook, 20 mm thick, with a 4 mm bend fillet, 2 mm tip fillets, and two M4 countersinks 23 mm apart.",
    async buildPlan(preview) {
      const points = [[0, 0], [0, 60], [5, 60], [5, 5], [25, 5], [25, 20], [30, 20], [30, 0]];
      const base = { name: "Lopez, Mia, Wall Hook", mode: "advanced", sketches: [polygon("hook-outline", "XZ", [0, 0, 0], points)], features: [{ id: "hook", type: "extrude", sketch: "hook-outline", distance: 20, mode: "sym" }] };
      const geometry = await preview(base);
      const info = bodyNamed(geometry, "hook");
      const longEdges = (info.geometrySelectors?.edges || []).filter((edge) => edge.t === "LINE" && edge.a && edge.b && Math.abs(edge.b[1] - edge.a[1]) > 19);
      if (longEdges.length < 5) throw new Error("Preview did not expose enough longitudinal hook edges");
      const inside = longEdges.find((edge) => Math.abs(edge.m[0] - 5) < 0.2 && Math.abs(edge.m[2] - 5) < 0.2);
      if (!inside) throw new Error("Preview did not identify the inside hook bend");
      const { index: _insideIndex, ...insideSignature } = inside;
      const tips = longEdges.filter((edge) => edge !== inside).slice(0, 4).map(({ index, ...signature }) => signature);
      if (tips.length < 4) throw new Error("Preview did not identify four hook tip edges");
      return { ...base, operations: [
        modifier("bend-fillet", "hook", { type: "fillet", radius: 4, edges: [insideSignature] }),
        modifier("tip-fillets", "hook", { type: "fillet", radius: 2, edges: tips }),
        modifier("mount-holes", "hook", { type: "hole", kind: "csink", diameter: 4.5, countersinkDiameter: 9.4, countersinkAngle: 90, through: true, at: [{ p: [0, -10, 45], n: [0, -1, 0] }, { p: [0, -10, 22], n: [0, -1, 0] }] }),
      ] };
    },
    verify(document) { requireValidBodies(document); requireModifierCount(document, "fillet", 2); requireModifierCount(document, "hole", 1); if (!document.bodies.some((body) => body.feature === "extrude" && near(body.dimensions.y, 20, 1))) throw new Error("Expected a 20 mm wide hook"); },
  },
  {
    id: "a-drawer", title: "Box with a sliding drawer", prompt: "Make an 80 by 70 by 50 mm open-front case and a separate 73 by 62 by 43 mm hollow drawer beside it, with an extruded handle. Verify undo restores the print layout.",
    async buildPlan(preview) {
      const base = { name: "Lopez, Mia, Box With Drawer", mode: "advanced", sketches: [
        polygon("case-profile", "XY", [0, 0, 0], [[-40, -35], [40, -35], [40, 35], [-40, 35]]),
        polygon("drawer-profile", "XY", [100, 0, 0], [[-36.5, -31], [36.5, -31], [36.5, 31], [-36.5, 31]]),
        polygon("handle-profile", "XZ", [100, -31, 0], [[-15, 17.5], [15, 17.5], [15, 25.5], [-15, 25.5]]),
      ], features: [
        { id: "case", type: "extrude", sketch: "case-profile", distance: 50 },
        { id: "drawer", type: "extrude", sketch: "drawer-profile", distance: 43 },
        { id: "handle", type: "extrude", sketch: "handle-profile", distance: 8, operation: "join", target: "drawer" },
      ] };
      const geometry = await preview(base);
      const caseInfo = bodyNamed(geometry, "case"), drawerInfo = bodyNamed(geometry, "drawer");
      const caseFace = faces(caseInfo, (face) => face.t === "PLANE" && face.c[1] < -34 && face.c[2] > 20)[0];
      const drawerTop = faces(drawerInfo, (face) => face.t === "PLANE" && face.c[2] > 42.9)[0];
      const caseEdges = edges(caseInfo, (edge) => edge.t === "LINE" && Math.abs(edge.b?.[2] - edge.a?.[2]) > 49, 4);
      return { ...base, operations: [
        modifier("case-corners", "case", { type: "fillet", radius: 4, edges: caseEdges }),
        modifier("case-shell", "case", { type: "shell", thickness: 3, faces: [caseFace] }),
        modifier("drawer-shell", "drawer", { type: "shell", thickness: 2, faces: [drawerTop] }),
      ] };
    },
    verify(document) { requireValidBodies(document); if (document.bodies.length < 2) throw new Error("The case and drawer should remain separate bodies for printing"); requireModifierCount(document, "fillet", 1); requireModifierCount(document, "shell", 2); requireModifierCount(document, "bool", 1); },
  },
  {
    id: "a-candy", title: "Candy jar with a screw-on lid", prompt: "Create a 60 mm diameter jar with a 48 mm neck, 4 mm walls, full-length 3 mm pitch threads, and a separate hollow 58 by 16 mm lid with matching internal threads.",
    async buildPlan(preview) {
      const base = { name: "Lopez, Mia, Candy Jar", mode: "advanced", sketches: [
        circle("jar-profile", "XY", [0, 0, 0], 30),
        circle("neck-profile", "XY", [0, 0, 60], 24),
        circle("lid-profile", "XY", [80, 0, 0], 29),
        circle("lid-cavity", "XY", [80, 0, 16], 22.4),
      ], features: [
        { id: "jar", type: "extrude", sketch: "jar-profile", distance: 60 },
        { id: "neck", type: "extrude", sketch: "neck-profile", distance: 12, operation: "join", target: "jar" },
        { id: "lid", type: "extrude", sketch: "lid-profile", distance: 16 },
        { id: "lid-cavity-cut", type: "extrude", sketch: "lid-cavity", distance: -12, operation: "cut", target: "lid" },
      ] };
      const geometry = await preview(base);
      const jar = bodyNamed(geometry, "jar"), lid = bodyNamed(geometry, "lid");
      const neckFace = (jar.geometrySelectors?.faces || []).find((face) => face.t === "CYLINDRE" && near(face.r, 24, 0.2) && face.c[2] > 60 && face.c[2] < 72);
      const innerFace = (lid.geometrySelectors?.faces || []).find((face) => face.t === "CYLINDRE" && near(face.r, 22.4, 0.3));
      if (!neckFace || !innerFace) throw new Error("Preview did not expose the matching cylindrical thread faces");
      return { ...base, operations: [
        modifier("jar-shell", "jar", { type: "shell", thickness: 4, faces: [{ c: [0, 0, 72] }] }),
        modifier("neck-thread", "jar", { type: "thread", face: { c: neckFace.c, t: "CYLINDRE" }, pitch: 3, length: 0, clearance: 0.2 }),
        modifier("lid-thread", "lid", { type: "thread", face: { c: innerFace.c, t: "CYLINDRE" }, pitch: 3, length: 0, clearance: 0.2 }),
      ] };
    },
    verify(document) { requireValidBodies(document); requireModifierCount(document, "shell", 1); requireModifierCount(document, "thread", 2); requireModifierCount(document, "bool", 2); if (document.bodies.length < 2) throw new Error("Jar and lid should remain separate bodies"); },
  },
];

export function validateTutorialCase(document, scenario) {
  requireValidBodies(document);
  scenario.verify(document);
}
