// CAM Studio's worker: makes the toolpaths, the G-code and the whole cutting simulation away from
// the page, so the window never freezes while it works. Built into one script (camworker.bundle.txt)
// that the app starts from a Blob, so it works from the single-file app too.
import { buildProgram, programStats, toGcode, StockSim, RotarySim } from "./camcore.js";

self.onmessage = (e) => {
  const { id, job, tris, mach, post, units, title } = e.data;
  try {
    self.postMessage({ id, phase: "paths" });
    const prog = buildProgram(job, tris);
    const gcode = toGcode(prog, job, mach, { post, units, title });
    const stats = programStats(prog, mach);
    const sim = job.rotary ? new RotarySim(job, Math.max(0.3, job.res)) : new StockSim(job, job.res);
    let total = 0; for (const o of prog.ops) total += o.moves.length;
    let prev = null, n = 0, last = 0;
    for (const { op, moves } of prog.ops) for (const m of moves) {
      if (prev) sim.move(prev, m, op.tool, m.g, m.s);
      prev = m; n++;
      if (n - last > 2000) { last = n; self.postMessage({ id, phase: "sim", done: n / Math.max(1, total) }); }
    }
    delete prog.hm;
    const state = sim.rotary ? { rho: sim.rho } : { h: sim.h, burn: sim.burn };
    Object.assign(state, { removed: sim.removed, rapidHits: sim.rapidHits, tooDeep: sim.tooDeep });
    self.postMessage({ id, ok: true, prog, gcode, stats, sim: state }, Object.values(state).filter((v) => v && v.buffer).map((v) => v.buffer));
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
