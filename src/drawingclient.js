// Bodies as DXF drawing, page side of the temporary worker (the pattern of codecadclient.js): one drawing = one new engine
// with the design's imported files and fonts, one "drawing" message, one answer. The worker is always terminated afterwards:
// on success, on an error, on Cancel and when a timer runs out. Exact hidden-line removal can run long and the worker cannot
// stop itself, so this keeps the design's own geometry worker free and makes Cancel real.
export const LIMITS = { startMs: 90000, runMs: 120000 };

const text = (v) => String(v).slice(0, 2000);
function fail(kind, message) { return Object.assign(new Error(message), { kind }); }

// kernel: the app's KernelClient (workerUrl, workerType, parts, assets and sendAsset are used). Returns { done, cancel };
// done resolves to { views, skipped, faces } with raw curves. onView(view, i, n) is called as each view starts.
export function runDrawingJob(kernel, { bodies, views }, onView, limits = LIMITS) {
  let stop;
  const done = new Promise((resolve, reject) => {
    let finished = false, startTimer = 0, runTimer = 0, running = false;
    const worker = new Worker(kernel.workerUrl, kernel.workerType === "classic" ? {} : { type: "module" });
    const end = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(startTimer); clearTimeout(runTimer);
      worker.onmessage = worker.onerror = null;
      try { worker.terminate(); } catch (e) {}
      fn(value);
    };
    stop = (err) => end(reject, err);
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (!m || typeof m !== "object") return;
      if (m.type === "ready" && !running) {
        clearTimeout(startTimer);
        running = true;
        for (const id of kernel.assets.keys()) kernel.sendAsset(id, worker);
        runTimer = setTimeout(() => end(reject, fail("timeout", `The drawing took more than ${Math.round(limits.runMs / 1000)} seconds, so it was stopped. Draw fewer bodies or views.`)), limits.runMs);
        worker.postMessage({ type: "drawing", req: 1, bodies, views });
      } else if (!running) {
        if (m.type === "error") end(reject, fail("start", text(m.error)));
      } else if (m.type === "drawingView" && m.req === 1) onView && onView(m.view, m.i, m.n);
      else if (m.type === "drawing" && m.req === 1) end(resolve, m.data);
      else if (m.type === "error" && m.req === 1) end(reject, fail("drawing", text(m.error)));
    };
    worker.onerror = (e) => end(reject, fail(running ? "crash" : "start", running ? "The geometry engine stopped while making the drawing (often memory). Draw fewer bodies or views." : "The geometry engine could not start" + (e && e.message ? " (" + e.message + ")" : "") + "."));
    startTimer = setTimeout(() => end(reject, fail("start", "The geometry engine took too long to start.")), limits.startMs);
    worker.postMessage({ type: "init", parts: kernel.parts });
  });
  return { done, cancel: () => stop(fail("cancelled", "Cancelled.")) };
}
