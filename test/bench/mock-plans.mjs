const idOf = (result) => typeof result === "string" ? result : result.id;
const end = () => [{ tool: "wait_ready", args: {} }, { text: "Done." }];

// These five queues are independent of the benchmark's expected geometry.
export const mockPlans = {
  "J3-001": () => [
    { tool: "add_shape", args: { kind: "box", size: { w: 40, d: 30, h: 20 } } }, ...end(),
  ],
  "J3-003": () => [
    { tool: "add_shape", args: { kind: "box", size: { w: 40, d: 30, h: 20 } } },
    { tool: "add_shape", args: { kind: "cylinder", size: { w: 8, d: 8, h: 30 }, at: [0, 0, -5], hole: true } },
    (_req, results) => ({ tool: "group_bodies", args: { ids: [idOf(results[0]), idOf(results[1])] } }), ...end(),
  ],
  "J3-005": () => [
    { tool: "add_shape", args: { kind: "box", size: { w: 60, d: 40, h: 5 } } },
    (_req, results) => ({ tool: "add_hole_pattern", args: { body: idOf(results[0]), face: "+z", layout: "grid", cols: 2, rows: 1, pitch: 30, dia: 8 } }), ...end(),
  ],
  "J3-007": () => [
    { tool: "add_shape", args: { kind: "tube", size: { w: 30, d: 30, h: 25, wall: 5 } } }, ...end(),
  ],
  "J3-008": () => [
    { tool: "add_shape", args: { kind: "box", size: { w: 40, d: 30, h: 20 } } },
    (_req, results) => ({ tool: "add_hole_pattern", args: { body: idOf(results[0]), face: "+x", layout: "grid", cols: 1, rows: 1, dia: 8 } }), ...end(),
  ],
};
