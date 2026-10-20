import { clone } from "../../src/util.js";

export const MCP_PLAN_LIMITS = {
  sketches: 12,
  features: 24,
  primitives: 64,
  bodies: 128,
  operations: 128,
  profilePoints: 128,
  patternCount: 12,
  coordinate: 10000,
};

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const AXES = new Set(["X", "Y", "Z"]);
const MODES = new Set(["one", "sym", "two"]);
const OPERATIONS = new Set(["new", "join", "cut"]);
const PRIMITIVE_DEFAULTS = {
  box: { w: 20, d: 20, h: 20, r: 0, c: 0 },
  cylinder: { w: 20, d: 20, h: 20, r: 0, c: 0 },
  sphere: { w: 20, d: 20, h: 20 },
  cone: { w: 20, d: 20, h: 20, top: 0 },
  pyramid: { w: 20, d: 20, h: 20, sides: 4 },
  wedge: { w: 20, d: 20, h: 20, r: 0, c: 0 },
  torus: { w: 20, d: 20, h: 4, tube: 4 },
  tube: { w: 20, d: 20, h: 20, wall: 2 },
  hemisphere: { w: 20, d: 20, h: 10 },
  prism: { w: 20, d: 20, h: 20, sides: 6, r: 0, c: 0 },
  text: { text: "TEXT", size: 15, h: 5, font: "sans" },
  star: { w: 20, d: 20, h: 5, points: 5, inner: 0.5 },
  heart: { w: 20, d: 18, h: 6 },
  roof: { w: 20, d: 20, h: 12 },
  roundroof: { w: 20, d: 20, h: 10 },
  paraboloid: { w: 20, d: 20, h: 20 },
  gem: { w: 20, d: 20, h: 20 },
  spring: { w: 20, d: 20, h: 30, turns: 5, wire: 2 },
  capsule: { w: 30, d: 12, h: 12 },
  arrow: { w: 30, d: 20, h: 5 },
};
const PRIMITIVE_ENUMS = { pyramid: { sides: [3, 64] }, prism: { sides: [3, 64] }, star: { points: [3, 64] }, spring: { turns: [1, 100] } };

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function strictObject(value, label, keys) {
  const result = object(value, label);
  const allowed = new Set(keys);
  const unknown = Object.keys(result).find((key) => !allowed.has(key));
  if (unknown) fail(`${label}.${unknown} is not supported`);
  return result;
}

function text(value, label, fallback) {
  const v = value === undefined ? fallback : value;
  if (typeof v !== "string" || !v.trim() || v.length > 80) fail(`${label} must be a non-empty string of at most 80 characters`);
  return v.trim();
}

function number(value, label, { min = -MCP_PLAN_LIMITS.coordinate, max = MCP_PLAN_LIMITS.coordinate } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function pair(value, label) {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} must contain two numbers`);
  return value.map((v, i) => number(v, `${label}[${i}]`));
}

function triple(value, label) {
  if (!Array.isArray(value) || value.length !== 3) fail(`${label} must contain three numbers`);
  return value.map((v, i) => number(v, `${label}[${i}]`));
}

function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a, b, c, d) {
  const abC = cross2(a, b, c), abD = cross2(a, b, d), cdA = cross2(c, d, a), cdB = cross2(c, d, b);
  return abC * abD < -1e-12 && cdA * cdB < -1e-12;
}

function planeFor(type, origin) {
  const bases = {
    XY: { x: [1, 0, 0], n: [0, 0, 1] },
    XZ: { x: [1, 0, 0], n: [0, -1, 0] },
    YZ: { x: [0, 1, 0], n: [1, 0, 0] },
  };
  const base = bases[type];
  if (!base) fail("Sketch plane must be XY, XZ, or YZ");
  return { o: origin, x: base.x, n: base.n };
}

function newId(prefix) {
  return `${prefix}${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;
}

export function normalizeModelPlan(value, existingBodyIds = [], defaultMode) {
  const input = strictObject(value, "plan", ["name", "mode", "sketches", "features", "primitives", "operations", "planes"]);
  const rawSketches = input.sketches ?? [];
  const rawFeatures = input.features ?? [];
  const rawPrimitives = input.primitives ?? [];
  const rawOperations = input.operations ?? [];
  const rawPlanes = input.planes ?? [];
  if (!Array.isArray(rawSketches) || rawSketches.length > MCP_PLAN_LIMITS.sketches) fail(`plan.sketches must contain at most ${MCP_PLAN_LIMITS.sketches} sketches`);
  if (!Array.isArray(rawFeatures) || rawFeatures.length > MCP_PLAN_LIMITS.features) fail(`plan.features must contain at most ${MCP_PLAN_LIMITS.features} features`);
  if (!Array.isArray(rawPrimitives) || rawPrimitives.length > MCP_PLAN_LIMITS.primitives) fail(`plan.primitives must contain at most ${MCP_PLAN_LIMITS.primitives} primitives`);
  if (!Array.isArray(rawOperations) || rawOperations.length > MCP_PLAN_LIMITS.operations) fail(`plan.operations must contain at most ${MCP_PLAN_LIMITS.operations} operations`);
  if (!Array.isArray(rawPlanes) || rawPlanes.length > 8) fail("plan.planes must contain at most 8 construction planes");
  if (!rawPrimitives.length && !rawFeatures.length && !rawOperations.length) fail("plan must contain a primitive, feature, or body operation");

  const sketchIds = new Set();
  const sketches = rawSketches.map((raw, i) => {
    const sketch = strictObject(raw, `sketches[${i}]`, ["id", "name", "plane", "origin", "profile"]);
    const id = text(sketch.id, `sketches[${i}].id`);
    if (sketchIds.has(id)) fail(`Duplicate sketch id: ${id}`);
    sketchIds.add(id);
    const plane = text(sketch.plane, `sketches[${i}].plane`).toUpperCase();
    if (!Array.isArray(sketch.origin)) fail(`sketches[${i}].origin must be a 3D coordinate`);
    const origin = triple(sketch.origin, `sketches[${i}].origin`);
    const profile = object(sketch.profile, `sketches[${i}].profile`);
    let normalizedProfile;
    if (profile.type === "circle") {
      strictObject(profile, `sketches[${i}].profile`, ["type", "center", "radius"]);
      normalizedProfile = {
        type: "circle",
        center: pair(profile.center, `sketches[${i}].profile.center`),
        radius: number(profile.radius, `sketches[${i}].profile.radius`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      };
    } else if (profile.type === "polygon") {
      strictObject(profile, `sketches[${i}].profile`, ["type", "points"]);
      if (!Array.isArray(profile.points) || profile.points.length < 3 || profile.points.length > MCP_PLAN_LIMITS.profilePoints) {
        fail(`sketches[${i}].profile.points must contain 3 to ${MCP_PLAN_LIMITS.profilePoints} points`);
      }
      const points = profile.points.map((p, j) => pair(p, `sketches[${i}].profile.points[${j}]`));
      let area = 0;
      for (let j = 0; j < points.length; j++) {
        const a = points[j], b = points[(j + 1) % points.length];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001) fail(`sketches[${i}].profile has a zero-length edge`);
        area += a[0] * b[1] - b[0] * a[1];
      }
      if (Math.abs(area) < 0.002) fail(`sketches[${i}].profile has zero area`);
      for (let a = 0; a < points.length; a++) {
        for (let b = a + 1; b < points.length; b++) {
          if (b === a + 1 || (a === 0 && b === points.length - 1)) continue;
          if (segmentsCross(points[a], points[(a + 1) % points.length], points[b], points[(b + 1) % points.length])) {
            fail(`sketches[${i}].profile self-intersects`);
          }
        }
      }
      normalizedProfile = { type: "polygon", points };
    } else {
      fail(`sketches[${i}].profile.type must be circle or polygon`);
    }
    return { id, name: text(sketch.name, `sketches[${i}].name`, id), plane, origin, profile: normalizedProfile };
  });

  const primitives = rawPrimitives.map(normalizePrimitive);
  const primitiveIds = new Set(primitives.map((primitive) => primitive.id));
  if (primitiveIds.size !== primitives.length) fail("Primitive ids must be unique");
  const planes = rawPlanes.map((raw, i) => {
    const plane = strictObject(raw, `planes[${i}]`, ["id", "name", "plane", "origin"]);
    const type = text(plane.plane, `planes[${i}].plane`).toUpperCase();
    if (!["XY", "XZ", "YZ"].includes(type)) fail(`planes[${i}].plane must be XY, XZ, or YZ`);
    return { id: text(plane.id, `planes[${i}].id`), name: text(plane.name, `planes[${i}].name`, `Construction plane ${i + 1}`), plane: type, origin: triple(plane.origin ?? [0, 0, 0], `planes[${i}].origin`) };
  });
  if (new Set(planes.map((plane) => plane.id)).size !== planes.length) fail("Construction plane ids must be unique");

  const featureIds = new Set();
  const features = rawFeatures.map((raw, i) => {
    const feature = strictObject(raw, `features[${i}]`, ["id", "name", "type", "sketch", "sections", "operation", "target", "axis", "angle", "distance", "mode", "distance2", "pattern", "ruled", "closed"]);
    const id = text(feature.id, `features[${i}].id`);
    if (featureIds.has(id) || primitiveIds.has(id)) fail(`Duplicate model id: ${id}`);
    featureIds.add(id);
    const type = text(feature.type, `features[${i}].type`);
    if (!["revolve", "extrude", "loft"].includes(type)) fail(`features[${i}].type must be revolve, extrude, or loft`);
    const sketch = feature.sketch === undefined ? undefined : text(feature.sketch, `features[${i}].sketch`);
    const sections = type === "loft" ? feature.sections : undefined;
    if (type === "loft") {
      if (!Array.isArray(sections) || sections.length < 2 || sections.length > 12 || sections.some((id) => typeof id !== "string" || !sketchIds.has(id))) {
        fail(`features[${i}].sections must reference 2 to 12 earlier sketches`);
      }
    } else if (!sketch || !sketchIds.has(sketch)) fail(`features[${i}] references an unknown sketch`);
    const operation = text(feature.operation, `features[${i}].operation`, "new");
    if (!OPERATIONS.has(operation)) fail(`features[${i}].operation must be new, join, or cut`);
    const target = feature.target === undefined ? undefined : text(feature.target, `features[${i}].target`);
    if (operation !== "new" && !target) fail(`features[${i}].target is required for ${operation}`);
    if (operation === "new" && target) fail(`features[${i}].target is only valid for join or cut`);

    const out = {
      id,
      name: text(feature.name, `features[${i}].name`, id),
      type,
      operation,
      ...(target ? { target } : {}),
      ...(sketch ? { sketch } : {}),
      ...(sections ? { sections: sections.slice() } : {}),
    };
    if (type === "revolve") {
      const axis = text(feature.axis, `features[${i}].axis`, "Z").toUpperCase();
      if (!AXES.has(axis)) fail(`features[${i}].axis must be X, Y, or Z`);
      out.axis = axis;
      out.angle = number(feature.angle ?? 360, `features[${i}].angle`, { min: 1, max: 360 });
    } else if (type === "extrude") {
      out.distance = number(feature.distance, `features[${i}].distance`, { min: -MCP_PLAN_LIMITS.coordinate, max: MCP_PLAN_LIMITS.coordinate });
      if (Math.abs(out.distance) < 0.001) fail(`features[${i}].distance must not be zero`);
      out.mode = text(feature.mode, `features[${i}].mode`, "one");
      if (!MODES.has(out.mode)) fail(`features[${i}].mode must be one, sym, or two`);
      if (out.mode === "two") out.distance2 = number(feature.distance2, `features[${i}].distance2`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate });
    } else {
      if (feature.ruled !== undefined && typeof feature.ruled !== "boolean") fail(`features[${i}].ruled must be a boolean`);
      if (feature.closed !== undefined && typeof feature.closed !== "boolean") fail(`features[${i}].closed must be a boolean`);
      out.ruled = feature.ruled === true;
      out.closed = feature.closed === true;
    }

    if (feature.pattern !== undefined) {
      const pattern = strictObject(feature.pattern, `features[${i}].pattern`, ["axis", "count", "angle", "origin"]);
      const axis = text(pattern.axis, `features[${i}].pattern.axis`).toUpperCase();
      if (!AXES.has(axis)) fail(`features[${i}].pattern.axis must be X, Y, or Z`);
      const count = number(pattern.count, `features[${i}].pattern.count`, { min: 2, max: MCP_PLAN_LIMITS.patternCount });
      if (!Number.isInteger(count)) fail(`features[${i}].pattern.count must be an integer`);
      out.pattern = {
        axis,
        count,
        angle: number(pattern.angle ?? 360, `features[${i}].pattern.angle`, { min: 1, max: 360 }),
        origin: triple(pattern.origin ?? [0, 0, 0], `features[${i}].pattern.origin`),
      };
    }
    return out;
  });

  const seenFeatures = new Set([...existingBodyIds, ...primitiveIds]);
  for (const feature of features) {
    if (feature.target && !seenFeatures.has(feature.target)) fail(`Feature ${feature.id} must target an earlier body`);
    if (feature.operation === "new") seenFeatures.add(feature.id);
  }
  const operations = rawOperations.map((raw, i) => {
    const operation = object(raw, `operations[${i}]`);
    const type = text(operation.type, `operations[${i}].type`);
    const id = text(operation.id, `operations[${i}].id`);
    if (featureIds.has(id) || primitiveIds.has(id)) fail(`Duplicate model id: ${id}`);
    if (type === "group") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "name", "members", "operation"]);
      if (!Array.isArray(operation.members) || operation.members.length < 1 || operation.members.length > MCP_PLAN_LIMITS.primitives) fail(`operations[${i}].members must contain 1 to ${MCP_PLAN_LIMITS.primitives} body ids`);
      if (new Set(operation.members).size !== operation.members.length) fail(`operations[${i}].members must not contain duplicates`);
      const op = operation.operation ?? "union";
      if (!["union", "cut", "intersect"].includes(op)) fail(`operations[${i}].operation must be union, cut, or intersect`);
      return { type, id, name: text(operation.name, `operations[${i}].name`, id), members: operation.members.map((member) => text(member, `operations[${i}].members`)), operation: op };
    }
    if (type === "pattern") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "source", "mode", "axis", "count", "spacing", "symmetric", "angle", "origin"]);
      const mode = text(operation.mode, `operations[${i}].mode`);
      if (!["linear", "circular"].includes(mode)) fail(`operations[${i}].mode must be linear or circular`);
      if (operation.symmetric !== undefined && typeof operation.symmetric !== "boolean") fail(`operations[${i}].symmetric must be a boolean`);
      const axis = text(operation.axis, `operations[${i}].axis`).toUpperCase();
      if (!AXES.has(axis)) fail(`operations[${i}].axis must be X, Y, or Z`);
      const count = number(operation.count, `operations[${i}].count`, { min: 2, max: MCP_PLAN_LIMITS.patternCount });
      if (!Number.isInteger(count)) fail(`operations[${i}].count must be an integer`);
      return { type, id, source: text(operation.source, `operations[${i}].source`), mode, axis, count,
        ...(mode === "linear" ? { spacing: number(operation.spacing, `operations[${i}].spacing`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), symmetric: operation.symmetric === true } : { angle: number(operation.angle ?? 360, `operations[${i}].angle`, { min: 1, max: 360 }), origin: triple(operation.origin ?? [0, 0, 0], `operations[${i}].origin`) }) };
    }
    if (type === "transform") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "target", "position", "rotation", "relative"]);
      if (operation.relative !== undefined && typeof operation.relative !== "boolean") fail(`operations[${i}].relative must be a boolean`);
      return { type, id, target: text(operation.target, `operations[${i}].target`), position: triple(operation.position ?? [0, 0, 0], `operations[${i}].position`), rotation: triple(operation.rotation ?? [0, 0, 0], `operations[${i}].rotation`), relative: operation.relative === true };
    }
    if (type === "combine") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "target", "tool", "operation", "keepTool"]);
      if (operation.keepTool !== undefined && typeof operation.keepTool !== "boolean") fail(`operations[${i}].keepTool must be a boolean`);
      const op = text(operation.operation, `operations[${i}].operation`);
      if (!["join", "cut", "intersect"].includes(op)) fail(`operations[${i}].operation must be join, cut, or intersect`);
      return { type, id, target: text(operation.target, `operations[${i}].target`), tool: text(operation.tool, `operations[${i}].tool`), operation: op, keepTool: operation.keepTool === true };
    }
    if (type === "modifier") {
      strictObject(operation, `operations[${i}]`, ["id", "type", "target", "modifier"]);
      return { type, id, target: text(operation.target, `operations[${i}].target`), modifier: normalizeModifier(operation.modifier, `operations[${i}].modifier`) };
    }
    fail(`operations[${i}].type must be group, pattern, transform, combine, or modifier`);
  });
  const allIds = new Set([...existingBodyIds, ...primitiveIds, ...featureIds]);
  for (const operation of operations) {
    if (allIds.has(operation.id)) fail(`Duplicate model id: ${operation.id}`);
    if (operation.type === "group") {
      for (const member of operation.members) if (!allIds.has(member)) fail(`Group ${operation.id} references unknown or later body ${member}`);
    } else if (operation.type === "pattern") {
      if (!allIds.has(operation.source)) fail(`Pattern ${operation.id} references unknown or later body ${operation.source}`);
    } else if (operation.type === "transform" || operation.type === "modifier") {
      if (!allIds.has(operation.target)) fail(`${operation.type} ${operation.id} references unknown or later body ${operation.target}`);
    } else if (operation.type === "combine") {
      if (!allIds.has(operation.target) || !allIds.has(operation.tool)) fail(`Combine ${operation.id} references an unknown or later body`);
    }
    allIds.add(operation.id);
  }
  const inferredMode = features.length || sketches.length ? "advanced" : defaultMode || "beginner";
  const mode = text(input.mode, "plan.mode", inferredMode).toLowerCase();
  if (!["beginner", "advanced"].includes(mode)) fail("plan.mode must be beginner or advanced");
  return { name: text(input.name, "plan.name", "AI model"), mode, sketches, features, primitives, operations, planes };
}

function sketchFromDefinition(definition, seq, idFactory) {
  const sketch = {
    id: idFactory("s"),
    name: definition.name,
    seq,
    plane: planeFor(definition.plane, definition.origin),
    pts: [],
    ents: [],
    hidden: true,
  };
  const point = (xy) => {
    const id = idFactory("p");
    sketch.pts.push({ id, x: xy[0], y: xy[1] });
    return id;
  };
  if (definition.profile.type === "circle") {
    sketch.ents.push({ id: idFactory("e"), t: "circle", c: point(definition.profile.center), r: definition.profile.radius });
  } else {
    const points = definition.profile.points.map(point);
    for (let i = 0; i < points.length; i++) sketch.ents.push({ id: idFactory("e"), t: "line", a: points[i], b: points[(i + 1) % points.length] });
  }
  return { sketch, profileRef: { key: sketch.ents.map((entity) => entity.id).sort().join(","), pt: [0, 0] } };
}

function rotationMatrix(axis, angle, origin) {
  const a = angle * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  let r;
  if (axis === "X") r = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0];
  else if (axis === "Y") r = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0];
  else r = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0];
  const [x, y, z] = origin;
  r.push(x - r[0] * x - r[4] * y - r[8] * z, y - r[1] * x - r[5] * y - r[9] * z, z - r[2] * x - r[6] * y - r[10] * z, 1);
  return r;
}

function matrixMultiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  }
  return out;
}

function matrixForTransform(position = [0, 0, 0], rotation = [0, 0, 0]) {
  const [rx, ry, rz] = rotation.map((value) => value * Math.PI / 180);
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const x = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  const y = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const z = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const out = matrixMultiply(matrixMultiply(x, y), z);
  out[12] = position[0]; out[13] = position[1]; out[14] = position[2];
  return out;
}

function matrixInverse(m) {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) fail("Cannot combine bodies with a singular transform");
  const q = 1 / det;
  const out = [
    (e * i - f * h) * q, (f * g - d * i) * q, (d * h - e * g) * q, 0,
    (c * h - b * i) * q, (a * i - c * g) * q, (b * g - a * h) * q, 0,
    (b * f - c * e) * q, (c * d - a * f) * q, (a * e - b * d) * q, 0,
    0, 0, 0, 1,
  ];
  for (let row = 0; row < 3; row++) out[12 + row] = -(out[row] * m[12] + out[4 + row] * m[13] + out[8 + row] * m[14]);
  return out;
}

function normalizePrimitive(raw, index) {
  const item = strictObject(raw, `primitives[${index}]`, ["id", "name", "kind", "parameters", "position", "rotation", "hole"]);
  const kind = text(item.kind, `primitives[${index}].kind`).toLowerCase();
  const defaults = PRIMITIVE_DEFAULTS[kind];
  if (!defaults) fail(`primitives[${index}].kind is not a supported JumpStart primitive`);
  const input = object(item.parameters ?? {}, `primitives[${index}].parameters`);
  const p = { ...defaults };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in defaults)) fail(`primitives[${index}].parameters.${key} is not valid for ${kind}`);
    if (typeof defaults[key] === "string") {
      if (typeof value !== "string" || !value.trim() || value.length > 256) fail(`primitives[${index}].parameters.${key} must be a non-empty string`);
      p[key] = value.trim();
    } else if (PRIMITIVE_ENUMS[kind]?.[key]) {
      const [min, max] = PRIMITIVE_ENUMS[kind][key];
      const n = number(value, `primitives[${index}].parameters.${key}`, { min, max });
      if (!Number.isInteger(n)) fail(`primitives[${index}].parameters.${key} must be an integer`);
      p[key] = n;
    } else {
      p[key] = number(value, `primitives[${index}].parameters.${key}`, { min: ["w", "d", "h", "size", "tube", "wall", "wire"].includes(key) ? 0.001 : 0, max: MCP_PLAN_LIMITS.coordinate });
    }
  }
  for (const key of ["w", "d", "h", "size", "tube", "wall", "wire"]) if (key in p && p[key] <= 0) fail(`primitives[${index}].parameters.${key} must be greater than zero`);
  for (const key of ["sides", "points", "turns"]) if (key in p && !Number.isInteger(p[key])) fail(`primitives[${index}].parameters.${key} must be an integer`);
  if (item.hole !== undefined && typeof item.hole !== "boolean") fail(`primitives[${index}].hole must be a boolean`);
  return {
    id: text(item.id, `primitives[${index}].id`),
    name: text(item.name, `primitives[${index}].name`, kind),
    kind,
    parameters: p,
    position: triple(item.position ?? [0, 0, 0], `primitives[${index}].position`),
    rotation: triple(item.rotation ?? [0, 0, 0], `primitives[${index}].rotation`),
    hole: item.hole === true,
  };
}

function normalizeEdgeSignatures(edges, label) {
  if (!Array.isArray(edges) || !edges.length || edges.length > 512) fail(`${label} must contain 1 to 512 edge signatures`);
  return edges.map((edge, i) => {
    strictObject(edge, `${label}[${i}]`, ["index", "a", "b", "m", "n", "t"]);
    return {
      ...(edge.a === undefined ? {} : { a: triple(edge.a, `${label}[${i}].a`) }),
      ...(edge.b === undefined ? {} : { b: triple(edge.b, `${label}[${i}].b`) }),
      m: triple(edge.m, `${label}[${i}].m`),
      n: triple(edge.n, `${label}[${i}].n`),
      t: text(edge.t, `${label}[${i}].t`),
    };
  });
}

function normalizeModifier(raw, label) {
  const mod = object(raw, label);
  const type = text(mod.type, `${label}.type`);
  if (type === "fillet") {
    strictObject(mod, label, ["type", "radius", "edges", "chain"]);
    return { type, radius: number(mod.radius, `${label}.radius`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), edges: normalizeEdgeSignatures(mod.edges, `${label}.edges`), chain: mod.chain !== false };
  }
  if (type === "shell") {
    strictObject(mod, label, ["type", "thickness", "faces", "direction"]);
    if (mod.direction !== undefined && !["in", "out", "both"].includes(mod.direction)) fail(`${label}.direction must be in, out, or both`);
    if (!Array.isArray(mod.faces) || mod.faces.length > 256) fail(`${label}.faces must be an array of at most 256 face centers`);
    return { type, thickness: number(mod.thickness, `${label}.thickness`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), faces: mod.faces.map((face, i) => ({ c: triple(strictObject(face, `${label}.faces[${i}]`, ["index", "c", "n", "t", "r", "ext", "o", "d", "ax"]).c, `${label}.faces[${i}].c`) })), direction: mod.direction ?? "in" };
  }
  if (type === "hole") {
    strictObject(mod, label, ["type", "at", "kind", "diameter", "through", "depth", "counterboreDiameter", "counterboreDepth", "countersinkDiameter", "countersinkAngle", "tip", "pitch", "clearance"]);
    if (!Array.isArray(mod.at) || !mod.at.length || mod.at.length > 64) fail(`${label}.at must contain 1 to 64 positions`);
    const kind = text(mod.kind, `${label}.kind`, "simple");
    if (!["simple", "cbore", "csink", "tapped"].includes(kind)) fail(`${label}.kind must be simple, cbore, csink, or tapped`);
    const through = mod.through !== false;
    return {
      type, kind: kind === "tapped" ? "simple" : kind,
      dia: number(mod.diameter, `${label}.diameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      through, depth: number(mod.depth ?? 10, `${label}.depth`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      cbDia: number(mod.counterboreDiameter ?? 8, `${label}.counterboreDiameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      cbDepth: number(mod.counterboreDepth ?? 3, `${label}.counterboreDepth`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      csDia: number(mod.countersinkDiameter ?? 9, `${label}.countersinkDiameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      csAngle: number(mod.countersinkAngle ?? 90, `${label}.countersinkAngle`, { min: 1, max: 179 }),
      tip: mod.tip === true, tapped: kind === "tapped",
      pitch: number(mod.pitch ?? 0.5, `${label}.pitch`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }),
      clear: number(mod.clearance ?? 0, `${label}.clearance`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }),
      at: mod.at.map((at, i) => {
        const point = strictObject(at, `${label}.at[${i}]`, ["p", "n"]);
        const n = triple(point.n, `${label}.at[${i}].n`);
        if (Math.hypot(...n) < 1e-9) fail(`${label}.at[${i}].n must not be zero`);
        return { p: triple(point.p, `${label}.at[${i}].p`), n };
      }),
    };
  }
  if (type === "thread") {
    strictObject(mod, label, ["type", "face", "pitch", "length", "flip", "left", "clearance"]);
    const face = strictObject(mod.face, `${label}.face`, ["index", "c", "t", "n", "r", "ext", "o", "d", "ax"]);
    if (face.t !== "CYLINDRE") fail(`${label}.face.t must be CYLINDRE`);
    return { type, face: { c: triple(face.c, `${label}.face.c`), t: "CYLINDRE" }, pitch: number(mod.pitch, `${label}.pitch`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }), length: number(mod.length ?? 0, `${label}.length`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }), flip: mod.flip === true, left: mod.left === true, clear: number(mod.clearance ?? 0, `${label}.clearance`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }) };
  }
  if (type === "emboss") {
    strictObject(mod, label, ["type", "geo", "text", "font", "size", "depth", "mode", "angle"]);
    const geo = strictObject(mod.geo, `${label}.geo`, ["kind", "p", "n", "x"]);
    const kind = text(geo.kind, `${label}.geo.kind`);
    if (kind !== "plane") fail(`${label}.geo.kind must be plane for declarative embossing`);
    if (mod.mode !== undefined && !["emboss", "deboss"].includes(mod.mode)) fail(`${label}.mode must be emboss or deboss`);
    const n = triple(geo.n, `${label}.geo.n`), x = triple(geo.x, `${label}.geo.x`);
    if (Math.hypot(...n) < 1e-9 || Math.hypot(...x) < 1e-9) fail(`${label}.geo.n and geo.x must not be zero`);
    return { type, geo: { kind, p: triple(geo.p, `${label}.geo.p`), n, x }, text: text(mod.text, `${label}.text`), font: text(mod.font, `${label}.font`, "sans"), size: number(mod.size, `${label}.size`, { min: 0.5, max: MCP_PLAN_LIMITS.coordinate }), depth: number(mod.depth, `${label}.depth`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }), mode: mod.mode ?? "emboss", angle: number(mod.angle ?? 0, `${label}.angle`, { min: -360, max: 360 }) };
  }
  if (type === "scale") {
    strictObject(mod, label, ["type", "factors", "offset"]);
    return { type, factors: triple(mod.factors, `${label}.factors`).map((value, i) => number(value, `${label}.factors[${i}]`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate })), offset: triple(mod.offset ?? [0, 0, 0], `${label}.offset`) };
  }
  fail(`${label}.type must be fillet, shell, hole, thread, emboss, or scale`);
}

function patternedNode(node, pattern) {
  if (!pattern) return node;
  return {
    t: "group",
    mods: [],
    children: Array.from({ length: pattern.count }, (_, i) => ({
      node: clone(node),
      m: rotationMatrix(pattern.axis, pattern.angle * i / pattern.count, pattern.origin),
      hole: false,
    })),
  };
}

export function buildModelPlan(document, input, idFactory = newId, replaceBodyIds = [], inputIsNormalized = false) {
  const doc = clone(document);
  const plan = inputIsNormalized ? input : normalizeModelPlan(input, doc.bodies.map((body) => body.id), doc.mode);
  if (!Array.isArray(replaceBodyIds) || replaceBodyIds.length > MCP_PLAN_LIMITS.features || replaceBodyIds.some((bodyId) => typeof bodyId !== "string")) {
    fail("replaceBodyIds must be an array of existing body ids");
  }
  const replaced = new Set(replaceBodyIds);
  if (replaced.size !== replaceBodyIds.length) fail("replaceBodyIds must not contain duplicates");
  const removed = doc.bodies.filter((body) => replaced.has(body.id));
  if (removed.length !== replaced.size) fail("Every replaceBodyId must exist in the current document");
  if (removed.some((body) => body.locked)) fail("Unlock every body before replacing it");
  const removedSketchIds = new Set();
  for (const body of removed) {
    JSON.stringify(body.node, (key, value) => {
      if (key === "sketch" && typeof value === "string") removedSketchIds.add(value);
      return value;
    });
  }
  doc.bodies = doc.bodies.filter((body) => !replaced.has(body.id));
  const keptSketchIds = new Set();
  for (const body of doc.bodies) {
    JSON.stringify(body.node, (key, value) => {
      if (key === "sketch" && typeof value === "string") keptSketchIds.add(value);
      return value;
    });
  }
  doc.sketches = doc.sketches.filter((sketch) => !removedSketchIds.has(sketch.id) || keptSketchIds.has(sketch.id));
  doc.mode = plan.mode;
  const sketches = new Map();
  const bodies = new Map();
  const createdBodyIds = [];
  const affectedBodyIds = new Set();
  const remember = (modelId, bodyList) => bodies.set(modelId, bodyList);
  const bodyList = (modelId) => {
    const value = (bodies.get(modelId) || []).filter((entry) => doc.bodies.some((body) => body.id === entry.id));
    if (!value.length) fail(`Body ${modelId} is unavailable or has already been consumed by a group or boolean`);
    return value;
  };
  const addBody = (name, node, m = IDENTITY.slice(), hole = false) => {
    if (doc.bodies.length >= MCP_PLAN_LIMITS.bodies) fail(`Model plan would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
    const body = { id: idFactory("b"), name, seq: ++doc.seq, color: "#9fb1c4", hole, hidden: false, m: m.slice(), node };
    doc.bodies.push(body);
    createdBodyIds.push(body.id);
    affectedBodyIds.add(body.id);
    return body;
  };
  for (const body of doc.bodies) remember(body.id, [body]);
  for (const definition of plan.planes) {
    const plane = planeFor(definition.plane, definition.origin);
    doc.planes.push({ id: idFactory("pl"), name: definition.name, seq: ++doc.seq, kind: "mcp", def: {}, plane, size: 100, hidden: false });
  }
  for (const definition of plan.sketches) {
    const built = sketchFromDefinition(definition, ++doc.seq, idFactory);
    doc.sketches.push(built.sketch);
    sketches.set(definition.id, built);
  }

  for (const primitive of plan.primitives) {
    const node = { t: "prim", kind: primitive.kind, p: clone(primitive.parameters), mods: [] };
    remember(primitive.id, [addBody(primitive.name, node, matrixForTransform(primitive.position, primitive.rotation), primitive.hole)]);
  }

  for (const feature of plan.features) {
    let node;
    if (feature.type === "loft") {
      node = {
        t: "loft",
        sections: feature.sections.map((sketchId) => {
          const section = sketches.get(sketchId);
          return { sketch: section.sketch.id, ref: clone(section.profileRef) };
        }),
        rail: null, ruled: feature.ruled, closed: feature.closed, mods: [],
      };
    } else {
      const source = sketches.get(feature.sketch);
      node = { t: feature.type, sketch: source.sketch.id, profiles: [source.profileRef], mods: [] };
      if (feature.type === "revolve") Object.assign(node, { axis: feature.axis, angle: feature.angle });
      else Object.assign(node, { dist: feature.distance, mode: feature.mode, dist2: feature.distance2 ?? 0 });
    }
    const tool = patternedNode(node, feature.pattern);
    if (feature.operation === "new") {
      remember(feature.id, [addBody(feature.name, tool)]);
    } else {
      const target = bodyList(feature.target)[0];
      target.node.mods = target.node.mods || [];
      target.node.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "bool", op: feature.operation, tool, m: matrixInverse(target.m) });
      affectedBodyIds.add(target.id);
      remember(feature.id, [target]);
    }
  }

  for (const operation of plan.operations) {
    if (operation.type === "group") {
      const members = operation.members.flatMap((member) => bodyList(member));
      if (members.length < 2) fail(`Group ${operation.id} must contain at least two bodies`);
      if (new Set(members.map((body) => body.id)).size !== members.length) fail(`Group ${operation.id} contains the same body more than once`);
      const first = members[0];
      const children = members.map((body, i) => ({
        node: clone(body.node), m: body.m.slice(), hole: operation.operation === "cut" ? i > 0 : !!body.hole,
        name: body.name, color: body.color,
      }));
      const node = { t: "group", ...(operation.operation === "intersect" ? { op: "intersect" } : {}), children, mods: [] };
      const group = addBody(operation.name, node, IDENTITY.slice(), children.every((child) => child.hole));
      doc.bodies = doc.bodies.filter((body) => !members.some((member) => member.id === body.id));
      remember(operation.id, [group]);
    } else if (operation.type === "pattern") {
      const sources = bodyList(operation.source);
      const copyCount = operation.mode === "linear" && operation.symmetric ? operation.count * 2 - 1 : operation.count;
      if (doc.bodies.length + sources.length * (copyCount - 1) > MCP_PLAN_LIMITS.bodies) fail(`Pattern ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
      const copies = [];
      const indices = operation.mode === "linear" && operation.symmetric
        ? Array.from({ length: operation.count * 2 - 1 }, (_, i) => i - (operation.count - 1))
        : Array.from({ length: operation.count }, (_, i) => i);
      for (const index of indices) {
        for (const source of sources) {
          if (index === 0) { copies.push(source); continue; }
          let transform;
          if (operation.mode === "circular") {
            const fullCircle = operation.angle >= 359.999;
            const stepAngle = fullCircle ? 360 / operation.count : operation.angle / (operation.count - 1);
            transform = rotationMatrix(operation.axis, stepAngle * index, operation.origin);
          }
          else {
            const delta = [0, 0, 0]; delta[["X", "Y", "Z"].indexOf(operation.axis)] = index * operation.spacing;
            transform = matrixForTransform(delta);
          }
          const copy = clone(source);
          copy.id = idFactory("b"); copy.seq = ++doc.seq;
          copy.name = `${source.name} ${index + 1}`.slice(0, 80);
          copy.m = matrixMultiply(transform, source.m);
          doc.bodies.push(copy); createdBodyIds.push(copy.id); affectedBodyIds.add(copy.id); copies.push(copy);
        }
      }
      remember(operation.id, copies);
    } else if (operation.type === "transform") {
      const targets = bodyList(operation.target);
      const transform = matrixForTransform(operation.position, operation.rotation);
      for (const body of targets) {
        body.m = operation.relative ? matrixMultiply(transform, body.m) : transform.slice();
        affectedBodyIds.add(body.id);
      }
      remember(operation.id, targets);
    } else if (operation.type === "combine") {
      const target = bodyList(operation.target);
      const tools = bodyList(operation.tool);
      if (target.length !== 1 || tools.length !== 1 || target[0].id === tools[0].id) fail(`Combine ${operation.id} requires two distinct single bodies`);
      const [base, tool] = [target[0], tools[0]];
      base.node.mods = base.node.mods || [];
      base.node.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "bool", src: "combine", ...(operation.operation === "join" ? {} : { op: operation.operation }), tool: clone(tool.node), m: matrixMultiply(matrixInverse(base.m), tool.m) });
      affectedBodyIds.add(base.id);
      if (!operation.keepTool) doc.bodies = doc.bodies.filter((body) => body.id !== tool.id);
      remember(operation.id, [base]);
    } else if (operation.type === "modifier") {
      const targets = bodyList(operation.target);
      const { type, ...properties } = operation.modifier;
      for (const body of targets) {
        body.node.mods = body.node.mods || [];
        const mod = { id: idFactory("f"), seq: ++doc.seq, t: type };
        if (type === "fillet") Object.assign(mod, { r: properties.radius, edges: properties.edges, chain: properties.chain });
        else if (type === "shell") Object.assign(mod, { th: properties.thickness, faces: properties.faces, ...(properties.direction === "in" ? {} : { dir: properties.direction }) });
        else if (type === "hole") Object.assign(mod, { dia: properties.dia, kind: properties.kind, through: properties.through, depth: properties.depth, cbDia: properties.cbDia, cbDepth: properties.cbDepth, csDia: properties.csDia, csAngle: properties.csAngle, tip: properties.tip, tapped: properties.tapped, pitch: properties.pitch, clear: properties.clear, at: properties.at });
        else if (type === "thread") Object.assign(mod, { face: properties.face, pitch: properties.pitch, length: properties.length, flip: properties.flip, left: properties.left, clear: properties.clear });
        else if (type === "emboss") Object.assign(mod, { ...properties.geo, str: properties.text, font: properties.font, size: properties.size, depth: properties.depth, mode: properties.mode, angle: properties.angle, along: false, mirror: false, reverse: false });
        else if (type === "scale") Object.assign(mod, { k: properties.factors, o: properties.offset });
        body.node.mods.push(mod);
        affectedBodyIds.add(body.id);
      }
      remember(operation.id, targets);
    }
  }

  doc.name = plan.name;
  const featureBodyIds = Object.fromEntries([...bodies].map(([id, list]) => [id, list.length === 1 ? list[0].id : list.map((body) => body.id)]));
  const liveCreatedIds = [...new Set(createdBodyIds)].filter((bodyId) => doc.bodies.some((body) => body.id === bodyId));
  return { document: doc, createdBodyIds: liveCreatedIds, featureBodyIds, affectedBodyIds: [...affectedBodyIds].filter((bodyId) => doc.bodies.some((body) => body.id === bodyId)) };
}

export function resizeBodyDocument(document, bodyId, bounds, requestedSize, anchor = "base", idFactory = newId) {
  const doc = clone(document);
  const body = doc.bodies.find((entry) => entry.id === bodyId);
  if (!body) fail(`Body ${bodyId} does not exist in the current document`);
  if (body.locked) fail("Unlock the body before resizing it");
  if (!body.node || typeof body.node !== "object") fail("The selected body has no editable feature node");
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max) || bounds.min.length !== 3 || bounds.max.length !== 3) {
    fail("The selected body does not have ready 3D bounds");
  }
  object(requestedSize, "size");
  if (!Object.keys(requestedSize).length || Object.keys(requestedSize).some((key) => !["x", "y", "z"].includes(key))) {
    fail("size must specify at least one of x, y, or z");
  }
  if (!["base", "center", "corner"].includes(anchor)) fail("anchor must be base, center, or corner");

  const minimum = triple(bounds.min, "bounds.min");
  const maximum = triple(bounds.max, "bounds.max");
  const current = maximum.map((value, i) => value - minimum[i]);
  if (current.some((value) => !Number.isFinite(value) || value <= 0)) fail("The selected body has a zero or invalid dimension");
  const target = ["x", "y", "z"].map((axis, i) => requestedSize[axis] === undefined
    ? current[i]
    : number(requestedSize[axis], `size.${axis}`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }));
  const factors = target.map((value, i) => value / current[i]);
  const fixed = minimum.map((value, i) => anchor === "base"
    ? (i === 2 ? value : (value + maximum[i]) / 2)
    : anchor === "center" ? (value + maximum[i]) / 2 : value);
  const offset = fixed.map((value, i) => value - factors[i] * value);
  body.node.mods = body.node.mods || [];
  const last = body.node.mods[body.node.mods.length - 1];
  if (last?.t === "scale") {
    last.k = last.k.map((value, i) => +(value * factors[i]).toPrecision(10));
    last.o = last.o.map((value, i) => +(value * factors[i] + offset[i]).toPrecision(10));
  } else {
    body.node.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "scale", k: factors.map((value) => +value.toPrecision(10)), o: offset.map((value) => +value.toPrecision(10)) });
  }
  return { document: doc, bodyId, currentSize: current, targetSize: target, factors };
}
