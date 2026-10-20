import { inspectTriangleMesh, sectionTriangleMesh, sampleSolidIntervals } from "./mcp-geometry.js";

// Parallel flat-bottom channels only. Results are inferred from tessellation sections,
// never from primitive parameters or the expected values supplied by the agent.
export function measureParallelChannels(mesh, { axis = "Y", crossAt = 0, tolerance = 0.001 } = {}) {
  if (!["X", "Y"].includes(axis)) throw new Error("Channel measurement supports world X or Y spacing and Z depth only");
  const across = axis === "Y" ? 1 : 0, along = 1 - across;
  const crossAxis = along === 0 ? "X" : "Y";
  const section = sectionTriangleMesh(mesh, { axis: crossAxis, offset: crossAt, tolerance });
  const levels = [];
  for (const [a, b] of section.segments) {
    if (Math.abs(a[2] - b[2]) > tolerance || Math.abs(a[across] - b[across]) < tolerance * 10) continue;
    let level = levels.find((entry) => Math.abs(entry.z - a[2]) <= tolerance);
    if (!level) { level = { z: a[2], length: 0 }; levels.push(level); }
    level.length += Math.abs(a[across] - b[across]);
  }
  const flat = levels.filter((entry) => entry.length > tolerance * 20).sort((a, b) => a.z - b.z);
  if (flat.length !== 3) throw new Error("Channel measurement needs a section with one flat base, one common channel floor, and one flat top; choose a suitable crossAt");
  const [base, floor, top] = flat.map((entry) => entry.z);
  const probe = [0, 0, (floor + top) / 2]; probe[along] = crossAt;
  const ridges = sampleSolidIntervals(mesh, { axis, point: probe, tolerance });
  if (ridges.ambiguous || ridges.intervals.length < 2 || ridges.intervals.length > 25) throw new Error("Channel section is ambiguous or exceeds 24 channels");
  const gaps = ridges.intervals.slice(1).map((interval, index) => [ridges.intervals[index][1], interval[0]]);
  const widths = gaps.map(([a, b]) => b - a), centers = gaps.map(([a, b]) => (a + b) / 2);
  const spacing = centers.slice(1).map((value, i) => value - centers[i]);
  const floors = [], depths = [], openings = [];
  for (const center of centers) {
    const point = probe.slice(); point[across] = center;
    const vertical = sampleSolidIntervals(mesh, { axis: "Z", point, tolerance });
    if (vertical.ambiguous || vertical.intervals.length !== 1) throw new Error("Channel floor sample is ambiguous");
    floors.push(vertical.intervals[0][1] - vertical.intervals[0][0]);
    depths.push(top - vertical.intervals[0][1]);
    const lengthwise = sampleSolidIntervals(mesh, { axis: crossAxis, point, tolerance });
    openings.push(!lengthwise.ambiguous && lengthwise.intervals.length === 0);
  }
  const avg = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const bounds = inspectTriangleMesh(mesh, { tolerance }).bounds;
  const mid = (bounds.min[across] + bounds.max[across]) / 2;
  return { source: "generated triangle section and line intersections", count: gaps.length,
    width: avg(widths), widths, depth: avg(depths), depths, spacing: spacing.length ? avg(spacing) : null, spacings: spacing,
    floor: avg(floors), floors, centers, baseZ: base, floorZ: floor, topZ: top,
    openEnds: openings.every(Boolean), symmetric: centers.every((value, i) => Math.abs(value + centers.at(-1 - i) - 2 * mid) <= tolerance),
    limitations: ["Only axis-aligned straight parallel channels with a common flat floor are supported.", "Sampled openness at the probe height does not prove hydraulic performance or minimum thickness everywhere."] };
}

export function inspectGeometry(mesh, options = {}) {
  const tolerance = options.tolerance ?? 0.0001;
  const estimatedPasses = 1 + (options.samples?.length || 0) * 2 + (options.section ? 2 : 0) + (options.checks || []).reduce((sum, check) => sum + (check.kind === "channels" ? 104 : 2), 0);
  if (mesh.triangles.length / 3 * estimatedPasses > 8000000) throw new Error("Inspection exceeds the 8 million triangle-visit budget; inspect fewer checks or use a coarser tessellation");
  const meshValidation = options.mesh === false ? undefined : inspectTriangleMesh(mesh, { tolerance });
  if (meshValidation) meshValidation.valid = meshValidation.triangleCount > 0 && !meshValidation.degenerateTriangles && !meshValidation.boundaryEdges && !meshValidation.nonManifoldEdges && !meshValidation.inconsistentWindingEdges && meshValidation.disconnectedComponents === 1;
  const section = options.section ? sectionTriangleMesh(mesh, { ...options.section, tolerance }) : undefined;
  const samples = (options.samples || []).map((sample) => sampleSolidIntervals(mesh, { ...sample, tolerance }));
  const checks = (options.checks || []).map((check) => {
    try {
      const threshold = check.tolerance ?? tolerance;
      if (check.kind === "dimension") {
        const measurement = meshValidation || inspectTriangleMesh(mesh, { tolerance });
        const measured = measurement.bounds?.dimensions[["X", "Y", "Z"].indexOf(check.axis)];
        return { id: check.id, kind: check.kind, expected: check.expected, measured, tolerance: threshold, pass: Number.isFinite(measured) && Math.abs(measured - check.expected) <= threshold };
      }
      if (check.kind === "channels") {
        const measured = measureParallelChannels(mesh, { axis: check.axis, crossAt: check.crossAt, tolerance });
        const errors = [];
        for (const [key, expected] of Object.entries(check.expected)) {
          const values = ({ width: measured.widths, depth: measured.depths, spacing: measured.spacings, floor: measured.floors })[key];
          const pass = key === "count" ? measured.count === expected : values ? values.length > 0 && values.every((value) => Math.abs(value - expected) <= threshold) : typeof expected === "number" ? Math.abs(measured[key] - expected) <= threshold : measured[key] === expected;
          if (!pass) errors.push(`${key} does not match expected ${expected}`);
        }
        return { id: check.id, kind: check.kind, expected: check.expected, measured, tolerance: threshold, pass: !errors.length, errors };
      }
      throw new Error("Unsupported geometry check");
    } catch (error) { return { id: check.id, kind: check.kind, expected: check.expected, pass: false, error: error.message }; }
  });
  return { coordinateSpace: "world", units: "mm", meshValidation, section, samples, checks,
    geometricRequirements: checks.length ? checks.every((check) => check.pass) ? "passed" : "failed" : "not_requested",
    physicalFit: "unverified", manufacturingPerformance: "unverified" };
}
