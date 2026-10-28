import * as R from "replicad";

const OPEN = "This body isn't a closed solid. Repair it first (Import > CAD faces… / Mesh to STEP).";
const FAILED = "Fill openings couldn't close this part. Undo, or keep the red openings open.";
const JOINED = "This opening joins the rest of the part in a way that can't be closed neatly";
const OUTSIDE = "This opening runs out to the outside of the part below the surface, so it can't be filled neatly.";
const COMPLEX = "This opening is too complicated to fill.";

// Measure volume without retaining the engine's property object.
function volume(shape) {
  const properties = R.measureShapeVolumeProperties(shape);
  try {
    return properties.volume;
  } finally {
    properties.delete();
  }
}

// Project a point onto a direction.
function dot(point, normal) {
  return point[0] * normal[0] + point[1] * normal[1] + point[2] * normal[2];
}

// Own persistent topology handles and delete temporary explorer items immediately.
function context() {
  const oc = R.getOC();
  const types = oc.TopAbs_ShapeEnum;
  const orientations = oc.TopAbs_Orientation;
  const owned = [];
  const edges = [];
  const buckets = new Map();
  const times = { setup: 0, walk: 0, rebuild: 0, checks: 0 };

  // Keep a handle alive until the operation finishes.
  function own(handle) {
    owned.push(handle);
    return handle;
  }

  // Visit borrowed topology items, freeing each after the callback.
  function visit(shape, type, callback) {
    const explorer = new oc.TopExp_Explorer(shape, type, types.TopAbs_SHAPE);
    try {
      for (; explorer.More(); explorer.Next()) {
        const item = explorer.Current();
        try {
          callback(item);
        } finally {
          item.delete();
        }
      }
    } finally {
      explorer.delete();
    }
  }

  // Collect only typed handles that callers actually need to retain.
  function collect(shape, type, name) {
    const result = [];
    visit(shape, type, item => result.push(own(oc.TopoDS[name](item))));
    return result;
  }

  // Distinguish hash collisions with the engine's topology identity check.
  function edgeKey(edge) {
    const hash = oc.ReplicadShapeHasher.HashCode(edge, 2147483647);
    const bucket = buckets.get(hash) || [];
    for (const index of bucket) {
      if (edges[index].IsSame(edge)) return index;
    }
    const index = edges.length;
    edges.push(own(oc.TopoDS.Edge(edge)));
    bucket.push(index);
    buckets.set(hash, bucket);
    return index;
  }

  // Read edge identities without keeping duplicate handles.
  function edgeKeys(shape) {
    const keys = [];
    visit(shape, types.TopAbs_EDGE, edge => keys.push(edgeKey(edge)));
    return keys;
  }

  // Read vertex positions as plain arrays.
  function vertices(shape) {
    const points = [];
    visit(shape, types.TopAbs_VERTEX, item => {
      const vertex = oc.TopoDS.Vertex(item);
      const point = oc.BRep_Tool.Pnt(vertex);
      try {
        points.push([point.X(), point.Y(), point.Z()]);
      } finally {
        point.delete();
        vertex.delete();
      }
    });
    return points;
  }

  // Find a flat face's outward normal and plane offset.
  function planeOf(face) {
    const adaptor = new oc.BRepAdaptor_Surface(face, true);
    try {
      if (adaptor.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) return null;
      const plane = adaptor.Plane();
      const axis = plane.Axis();
      const direction = axis.Direction();
      const location = plane.Location();
      try {
        let normal = [direction.X(), direction.Y(), direction.Z()];
        if (face.Orientation() === orientations.TopAbs_REVERSED) normal = normal.map(value => -value);
        const origin = [location.X(), location.Y(), location.Z()];
        return { n: normal, d: dot(normal, origin), o: origin };
      } finally {
        location.delete();
        direction.delete();
        axis.delete();
        plane.delete();
      }
    } finally {
      adaptor.delete();
    }
  }

  // Cache a face's forward wires and their keys only when needed.
  function wiresOf(face) {
    const forward = face.Oriented(orientations.TopAbs_FORWARD);
    const outer = oc.BRepTools.OuterWire(face);
    try {
      return collect(forward, types.TopAbs_WIRE, "Wire").map(wire => ({
        wire,
        keys: edgeKeys(wire),
        outer: wire.IsSame(outer),
      }));
    } finally {
      outer.delete();
      forward.delete();
    }
  }

  function sampleEdges(shape, skipLines = false) {
    const segments = [];
    visit(shape, types.TopAbs_EDGE, item => {
      const edge = oc.TopoDS.Edge(item);
      const adaptor = new oc.BRepAdaptor_Curve(edge);
      try {
        const count = adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line ? 2 : 16;
        if (skipLines && count === 2) return;
        const first = adaptor.FirstParameter();
        const last = adaptor.LastParameter();
        const points = [];
        for (let index = 0; index < count; index++) {
          const point = adaptor.Value(first + (last - first) * index / (count - 1));
          points.push([point.X(), point.Y(), point.Z()]);
          point.delete();
        }
        segments.push(points);
      } finally {
        adaptor.delete();
        edge.delete();
      }
    });
    return segments;
  }

  // Sample each wire in edge order for drawing and hit testing.
  function sample(wire) {
    const segments = sampleEdges(wire);
    if (!segments.length) return [];
    const points = segments.shift();
    while (segments.length) {
      const end = points[points.length - 1];
      let bestDistance = Infinity;
      let bestIndex = 0;
      let reverse = false;
      segments.forEach((segment, index) => {
        for (const reversed of [false, true]) {
          const point = reversed ? segment[segment.length - 1] : segment[0];
          const distance = Math.hypot(...point.map((value, axis) => value - end[axis]));
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
            reverse = reversed;
          }
        }
      });
      const segment = segments.splice(bestIndex, 1)[0];
      if (reverse) segment.reverse();
      points.push(...segment.slice(1));
    }
    return points;
  }

  function highestPoint(face, planar, points, normal) {
    let highest = -Infinity;
    const include = point => { highest = Math.max(highest, dot(point, normal)); };
    points.forEach(include);
    // Straight edges on planar mesh strips cannot exceed their vertices.
    for (const segment of sampleEdges(face, planar)) segment.forEach(include);
    if (!planar) {
      // The wasm has no 2D face classifier; mesh only the trimmed face.
      const mesh = new oc.BRepMesh_IncrementalMesh(face, 0.01, false, 0.1, false);
      const location = new oc.TopLoc_Location();
      let triangulation;
      let transform;
      try {
        triangulation = oc.BRep_Tool.Triangulation(face, location, 0);
        if (!triangulation || triangulation.isNull()) throw new Error(FAILED);
        transform = location.Transformation();
        for (let index = 1; index <= triangulation.NbNodes(); index++) {
          const point = triangulation.Node(index);
          try {
            point.Transform(transform);
            include([point.X(), point.Y(), point.Z()]);
          } finally {
            point.delete();
          }
        }
      } finally {
        transform?.delete();
        triangulation?.delete();
        location.delete();
        mesh.delete();
      }
    }
    return highest;
  }

  // Release every retained engine handle in reverse creation order.
  function dispose() {
    for (let index = owned.length - 1; index >= 0; index--) owned[index].delete();
  }

  return { oc, types, orientations, own, visit, collect, edgeKeys, vertices, planeOf, wiresOf, sample, sampleEdges, highestPoint, dispose, times };
}

// Measure only openings that survived the silent boss-footprint rejection.
function describeGroup(context, inner, members, walls, faceVertices, normal, offset) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  const loops = [];
  let area = 0;
  for (const index of members) {
    const wire = inner[index].wire;
    loops.push(context.sample(wire));
    const wrapped = R.cast(wire);
    const box = wrapped.boundingBox;
    try {
      const [low, high] = box.bounds;
      for (let axis = 0; axis < 3; axis++) {
        minimum[axis] = Math.min(minimum[axis], low[axis]);
        maximum[axis] = Math.max(maximum[axis], high[axis]);
      }
    } finally {
      box.delete();
      wrapped.delete();
    }
    const maker = new context.oc.BRepBuilderAPI_MakeFace(wire, true);
    const face = maker.Face();
    const shape = R.cast(face);
    const properties = R.measureShapeSurfaceProperties(shape);
    try {
      area += Math.abs(properties.area);
    } finally {
      properties.delete();
      shape.delete();
      face.delete();
      maker.delete();
    }
  }
  let depth = 0;
  for (const face of walls) {
    for (const point of faceVertices(face)) depth = Math.max(depth, offset - dot(point, normal));
  }
  return { c: minimum.map((value, axis) => (value + maximum[axis]) / 2), a: area, depth, loops };
}

// Group the opening walls and decide which cap wires can be removed.
function analyseSolid(context, solid, plane, faceOffset) {
  const start = performance.now();
  const { types, collect, edgeKeys, planeOf, times } = context;
  const length = Math.hypot(...plane.n);
  let normal = plane.n.map(value => value / length);
  const faces = collect(solid, types.TopAbs_FACE, "Face");
  const byEdge = new Map();
  const inputUses = new Map();
  const faceEdges = faces.map((face, index) => {
    const keys = edgeKeys(face);
    for (const key of keys) inputUses.set(key, (inputUses.get(key) || 0) + 1);
    const unique = [...new Set(keys)];
    for (const key of unique) {
      const neighbours = byEdge.get(key) || [];
      neighbours.push(index);
      byEdge.set(key, neighbours);
    }
    return unique;
  });
  const planes = faces.map(planeOf);
  const wireCache = new Map();
  const vertexCache = new Map();
  const highestCache = new Map();

  // Read each face's wires at most once.
  function faceWires(index) {
    if (!wireCache.has(index)) wireCache.set(index, context.wiresOf(faces[index]));
    return wireCache.get(index);
  }

  // Read each visited face's vertices at most once.
  function faceVertices(index) {
    if (!vertexCache.has(index)) vertexCache.set(index, context.vertices(faces[index]));
    return vertexCache.get(index);
  }

  function faceHighest(index) {
    if (!highestCache.has(index)) {
      highestCache.set(index, context.highestPoint(faces[index], !!planes[index], faceVertices(index), normal));
    }
    return highestCache.get(index);
  }

  let clickedFace = -1;
  let distance = Infinity;
  let planeDistance = Infinity;
  const { oc } = context;
  const point = new oc.gp_Pnt(...plane.o);
  let maker, vertex, extrema;
  try {
    maker = new oc.BRepBuilderAPI_MakeVertex(point);
    vertex = maker.Vertex();
    extrema = new oc.BRepExtrema_DistShapeShape();
    extrema.LoadS1(vertex);
    planes.forEach((info, index) => {
      if (!info || dot(info.n, normal) <= 1 - 1e-4) return;
      const wrapped = R.cast(faces[index]);
      const box = wrapped.boundingBox;
      try {
        const [low, high] = box.bounds;
        if (!plane.o.every((value, axis) => value >= low[axis] - 0.05 && value <= high[axis] + 0.05)) return;
        extrema.LoadS2(faces[index]);
        if (!extrema.Perform()) return;
        const candidateDistance = extrema.Value();
        if (candidateDistance > 0.01) return;
        const candidatePlaneDistance = Math.abs(dot(info.n, plane.o) - info.d);
        // Rounded clicks can lie near a plane but outside its trimmed face.
        const tied = Math.abs(candidateDistance - distance) <= 1e-6;
        if (tied ? candidatePlaneDistance >= planeDistance : candidateDistance >= distance) return;
        clickedFace = index;
        distance = candidateDistance;
        planeDistance = candidatePlaneDistance;
      } finally {
        box.delete();
        wrapped.delete();
      }
    });
  } finally {
    extrema?.delete();
    vertex?.delete();
    maker?.delete();
    point.delete();
  }
  const pickedFaces = new Set();
  let offset = -Infinity;
  if (clickedFace !== -1) {
    normal = planes[clickedFace].n;
    const clickedOffset = dot(normal, plane.o);
    planes.forEach((info, index) => {
      if (!info || dot(info.n, normal) <= 1 - 1e-5) return;
      const points = faceVertices(index);
      const atLevel = point => Math.abs(dot(point, normal) - clickedOffset) <= 0.01;
      if (!points.every(atLevel) || !context.sampleEdges(faces[index], true).every(segment => segment.every(atLevel))) return;
      pickedFaces.add(index);
      for (const point of points) offset = Math.max(offset, dot(point, normal));
    });
  }

  const inner = [];
  const outerEdges = new Set();
  const edgeToInner = new Map();
  for (const face of pickedFaces) {
    for (const wire of faceWires(face)) {
      if (wire.outer) {
        wire.keys.forEach(key => outerEdges.add(key));
      } else {
        const index = inner.length;
        inner.push({ face, ...wire });
        wire.keys.forEach(key => edgeToInner.set(key, index));
      }
    }
  }
  times.setup += performance.now() - start;
  const walkStart = performance.now();
  const done = new Set();
  const groups = [];
  for (let first = 0; first < inner.length; first++) {
    if (done.has(first)) continue;
    const members = new Set([first]);
    const openingEdges = new Set(inner[first].keys);
    const walls = new Set();
    const queue = [];
    const caps = new Map();
    let bad = null;
    let head = 0;

    // Start the walk at walls sharing the opening's edges.
    function seed(keys) {
      for (const key of keys) {
        for (const face of byEdge.get(key) || []) {
          if (!pickedFaces.has(face) && !walls.has(face)) {
            walls.add(face);
            queue.push(face);
          }
        }
      }
    }

    // Join another picked-face wire reached inside the part.
    function link(index) {
      if (index === undefined || members.has(index)) return;
      members.add(index);
      inner[index].keys.forEach(key => openingEdges.add(key));
      seed(inner[index].keys);
    }

    seed(inner[first].keys);
    while (head < queue.length && !bad) {
      if (head >= 20000) {
        bad = COMPLEX;
        break;
      }
      const face = queue[head++];
      if (faceHighest(face) > offset + 1e-4) {
        bad = "boss";
        break;
      }
      for (const key of faceEdges[face]) {
        if (openingEdges.has(key)) continue;
        for (const neighbour of byEdge.get(key) || []) {
          if (neighbour === face || walls.has(neighbour)) continue;
          if (pickedFaces.has(neighbour)) {
            if (outerEdges.has(key)) caps.set(neighbour, null);
            else link(edgeToInner.get(key));
          } else if (planes[neighbour] && Math.abs(Math.abs(dot(planes[neighbour].n, normal)) - 1) < 1e-5) {
            caps.set(neighbour, null);
          } else {
            walls.add(neighbour);
            queue.push(neighbour);
          }
        }
      }
      if (head !== queue.length) continue;
      const wallEdges = new Set([...walls].flatMap(index => faceEdges[index]));
      for (const cap of [...caps.keys()]) {
        const dropped = [];
        for (const wire of faceWires(cap)) {
          const touched = wire.keys.filter(key => wallEdges.has(key)).length;
          if (!touched) continue;
          if (touched !== wire.keys.length) {
            bad = JOINED;
            break;
          }
          if (wire.outer) {
            if (pickedFaces.has(cap) && [...members].some(index => inner[index].face === cap)) {
              bad = OUTSIDE;
              break;
            }
            caps.delete(cap);
            if (!walls.has(cap)) {
              walls.add(cap);
              if (!pickedFaces.has(cap)) queue.push(cap);
              else {
                for (const islandWire of faceWires(cap)) {
                  if (!islandWire.outer) link(edgeToInner.get(islandWire.keys[0]));
                }
              }
            }
            break;
          }
          dropped.push(wire.wire);
        }
        if (bad) break;
        if (caps.has(cap)) caps.set(cap, dropped);
      }
    }
    members.forEach(index => done.add(index));
    if (bad === "boss") continue;
    const through = [...caps].some(([face, wires]) =>
      wires?.length > 0 && planes[face] && dot(planes[face].n, normal) < -1 + 1e-5);
    groups.push({
      members, walls, caps, through,
      ...describeGroup(context, inner, members, walls, faceVertices, normal, offset),
      ...(bad ? { why: bad } : {}),
    });
  }
  times.walk += performance.now() - walkStart;
  return { faces, faceWires, inputUses, inner, groups, picked: [...pickedFaces].map(index => index + faceOffset) };
}

// Analyse every solid and limit the plain drawing data sent to the page.
function analyse(shape, plane) {
  const owner = context();
  try {
    const solids = owner.collect(shape.wrapped, owner.types.TopAbs_SOLID, "Solid");
    if (!solids.length) throw new Error(OPEN);
    let offset = 0;
    const parts = solids.map(solid => {
      const part = analyseSolid(owner, solid, plane, offset);
      part.solid = solid;
      offset += part.faces.length;
      return part;
    });
    let budget = 40000;
    for (const part of parts) {
      for (const group of part.groups) {
        const allowance = Math.min(2000, budget);
        const total = group.loops.reduce((sum, loop) => sum + loop.length, 0);
        group.loops = group.loops.map(loop => {
          const count = Math.floor(loop.length * Math.min(1, allowance / total));
          return Array.from({ length: count }, (_, index) => loop[Math.floor(index * loop.length / count)]);
        });
        budget -= group.loops.reduce((sum, loop) => sum + loop.length, 0);
      }
    }
    return { owner, parts };
  } catch (error) {
    owner.dispose();
    throw error;
  }
}

// Remove engine topology from an opening's public description.
function plain(group) {
  return {
    c: group.c, a: group.a, depth: group.depth, loops: group.loops,
    through: Boolean(group.through),
    ...(group.why ? { why: group.why } : {}),
  };
}

// Describe the picked face's openings without changing its solid.
export function analyseOpenings(shape, plane) {
  const { owner, parts } = analyse(shape, plane);
  try {
    return { faces: parts.flatMap(part => part.picked), groups: parts.flatMap(part => part.groups.map(plain)) };
  } finally {
    owner.dispose();
  }
}

// Match saved keep entries to the nearest opening, breaking ties by area.
export function chooseOpenings(analysis, keep = []) {
  const groups = analysis.groups;
  const kept = new Set();
  for (const entry of keep) {
    let best = -1;
    let distance = Infinity;
    let areaDifference = Infinity;
    groups.forEach((group, index) => {
      const candidateDistance = Math.hypot(...group.c.map((value, axis) => value - entry.c[axis]));
      const candidateArea = Math.abs(group.a - entry.a);
      if (candidateDistance <= 0.5 && (candidateDistance < distance - 1e-9 ||
          (Math.abs(candidateDistance - distance) <= 1e-9 && candidateArea < areaDifference))) {
        best = index;
        distance = candidateDistance;
        areaDifference = candidateArea;
      }
    });
    if (best >= 0) kept.add(best);
  }
  const openings = groups.map((group, index) => ({
    ...plain(group), state: group.why ? "refused" : kept.has(index) ? "keep" : "fill",
  }));
  return {
    faces: analysis.faces.length,
    filled: openings.filter(group => group.state === "fill").length,
    kept: openings.filter(group => group.state === "keep").length,
    openings,
  };
}

// Rebuild a shell with the selected walls and cap wires removed.
function rebuild(owner, part, chosen, fixSolid) {
  const { oc, own, orientations } = owner;
  const removed = new Set();
  const drops = new Map();

  // Combine wire removals when several openings share a face.
  function drop(face, wire) {
    const wires = drops.get(face) || [];
    wires.push(wire);
    drops.set(face, wires);
  }

  for (const group of chosen) {
    group.walls.forEach(face => removed.add(face));
    group.members.forEach(index => drop(part.inner[index].face, part.inner[index].wire));
    for (const [face, wires] of group.caps) {
      if (wires) wires.forEach(wire => drop(face, wire));
    }
  }
  const builder = own(new oc.TopoDS_Builder());
  const shell = own(new oc.TopoDS_Shell());
  builder.MakeShell(shell);
  part.faces.forEach((face, index) => {
    if (removed.has(index)) return;
    const dropped = drops.get(index);
    if (!dropped) {
      builder.Add(shell, face);
      return;
    }
    const forward = own(face.Oriented(orientations.TopAbs_FORWARD));
    const empty = own(forward.EmptyCopied());
    const replacement = own(oc.TopoDS.Face(empty));
    for (const { wire } of part.faceWires(index)) {
      if (!dropped.some(candidate => candidate.IsSame(wire))) builder.Add(replacement, wire);
    }
    replacement.Orientation(face.Orientation());
    builder.Add(shell, replacement);
  });
  const fixer = own(new oc.ShapeFix_Solid());
  let output = R.cast(own(fixer.SolidFromShell(shell)));
  try {
    if (volume(output) < 0) {
      const reversed = R.cast(own(output.wrapped.Reversed()));
      output.delete();
      output = reversed;
    }
    const before = volume(output);
    const fixed = fixSolid(output.clone());
    if (Math.abs(volume(fixed) - before) <= Math.abs(before) * 1e-6) {
      output.delete();
      output = fixed;
    } else {
      fixed.delete();
    }
    return output;
  } catch (error) {
    output.delete();
    throw error;
  }
}

// Reject new edge defects, changed solid counts, or implausible volume growth.
function checkResult(owner, part, output, chosen) {
  const original = R.cast(part.solid);
  let originalVolume;
  try {
    originalVolume = volume(original);
  } finally {
    original.delete();
  }
  const growth = volume(output) - originalVolume;
  const maximumGrowth = chosen.reduce((sum, group) => sum + group.a * group.depth, 0) * 1.05;
  const uses = new Map();
  owner.visit(output.wrapped, owner.types.TopAbs_FACE, face => {
    for (const key of owner.edgeKeys(face)) uses.set(key, (uses.get(key) || 0) + 1);
  });
  let solids = 0;
  owner.visit(output.wrapped, owner.types.TopAbs_SOLID, () => solids++);
  const newDefect = [...uses].some(([key, count]) => count !== 2 && part.inputUses.get(key) !== count);
  if (solids !== 1 || newDefect || !(growth > 0 && growth <= maximumGrowth)) throw new Error(FAILED);
}

// Fill selected openings, consuming the input only after every check passes.
export function fillOpenings(shape, mod, fixSolid = shape => shape) {
  const { owner, parts } = analyse(shape, mod.plane);
  const outputs = [];
  try {
    const report = chooseOpenings({ faces: parts.flatMap(part => part.picked), groups: parts.flatMap(part => part.groups) }, mod.keep);
    if (!report.filled) return { shape, report, timings: owner.times };
    let index = 0;
    for (const part of parts) {
      const chosen = part.groups.filter(() => report.openings[index++].state === "fill");
      if (!chosen.length) {
        outputs.push(R.cast(part.solid));
        continue;
      }
      const start = performance.now();
      const output = rebuild(owner, part, chosen, fixSolid);
      outputs.push(output);
      owner.times.rebuild += performance.now() - start;
      const checkStart = performance.now();
      checkResult(owner, part, output, chosen);
      owner.times.checks += performance.now() - checkStart;
    }
    let result;
    if (outputs.length === 1) {
      result = outputs.pop();
    } else {
      const builder = owner.own(new owner.oc.TopoDS_Builder());
      const compound = owner.own(new owner.oc.TopoDS_Compound());
      builder.MakeCompound(compound);
      for (const output of outputs) builder.Add(compound, output.wrapped);
      result = R.cast(compound);
    }
    shape.delete();
    return { shape: result, report, timings: owner.times };
  } finally {
    outputs.forEach(output => output.delete());
    owner.dispose();
  }
}
