// jumpstart-3d: Code CAD, page side of the temporary worker. One job = one new worker (the same worker file and engine as the
// design's own, started fresh), one "code" message, one answer. The worker is always terminated afterwards: on success, on an error,
// on cancel, and when a timer below runs out. Code that never ends is stopped by the timer on this side, because the worker
// cannot stop itself. Nothing here touches the design's own geometry worker.
export const LIMITS = { startMs: 90000, runMs: 25000 }; // the start limit covers loading the engine; the run limit starts once it is ready. Tests lower them.

function fail(kind, message) { return Object.assign(new Error(message), { kind }); }

// kernel: the app's KernelClient (only its workerUrl, workerType and parts are read). Returns { done, cancel }; done resolves to { bytes, volume, bbox }.
export function runCodeJob(kernel, { code, params }, limits = LIMITS) {
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
      if (m.type === "ready") {
        clearTimeout(startTimer);
        running = true;
        runTimer = setTimeout(() => end(reject, fail("timeout", `The code ran for more than ${Math.round(limits.runMs / 1000)} seconds, so it was stopped. Check for a loop that never ends, or simplify the shape.`)), limits.runMs);
        worker.postMessage({ type: "code", req: 1, code, params });
      } else if (m.type === "coded") end(resolve, { bytes: new Uint8Array(m.bytes), volume: m.volume, bbox: m.bbox });
      else if (m.type === "error") end(reject, fail(running ? "code" : "start", m.error));
    };
    worker.onerror = (e) => end(reject, fail(running ? "crash" : "start", running ? "The geometry engine stopped while running the code. Simplify the shape and try again." : "The geometry engine could not start for this build" + (e && e.message ? " (" + e.message + ")" : "") + "."));
    startTimer = setTimeout(() => end(reject, fail("start", "The geometry engine took too long to start for this build.")), limits.startMs);
    worker.postMessage({ type: "init", parts: kernel.parts });
  });
  return { done, cancel: () => stop(fail("cancelled", "Cancelled. Nothing was changed.")) };
}
