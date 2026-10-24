// jumpstart-3d: Code CAD, page side of the temporary worker. One job = one new worker (the same worker file and engine as the
// design's own, started fresh), one "code" message, one answer. The worker is always terminated afterwards: on success, on an error,
// on cancel, and when a timer below runs out. Code that never ends is stopped by the timer on this side, because the worker
// cannot stop itself. Nothing here touches the design's own geometry worker.
export const LIMITS = { startMs: 90000, runMs: 25000 }; // the start limit covers loading the engine; the run limit starts once it is ready. Tests lower them.

const MAX_BYTES = 50e6; // the largest STEP file taken from a build
const text = (v) => String(v).slice(0, 2000); // an error message is shown as plain text, but not unlimited text
function fail(kind, message) { return Object.assign(new Error(message), { kind }); }

// kernel: the app's KernelClient (only its workerUrl, workerType and parts are read). Returns { done, cancel }; done resolves to { bytes } (not yet checked: the caller does that).
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
      if (!m || typeof m !== "object") return;
      if (m.type === "ready" && !running) {
        clearTimeout(startTimer);
        running = true;
        runTimer = setTimeout(() => end(reject, fail("timeout", `The code ran for more than ${Math.round(limits.runMs / 1000)} seconds, so it was stopped. Check for a loop that never ends, or simplify the shape.`)), limits.runMs);
        worker.postMessage({ type: "code", req: 1, code, params });
      } else if (!running) {
        if (m.type === "error") end(reject, fail("start", text(m.error)));
      } else if (m.type === "coded" && m.req === 1) { // the first reply wins; the code itself can post anything, so only a plain buffer of sane size is taken, and the page checks it again
        const b = m.bytes;
        if (!(b instanceof ArrayBuffer)) return;
        if (!b.byteLength || b.byteLength > MAX_BYTES) end(reject, fail("code", b.byteLength ? `The solid's STEP file is larger than ${MAX_BYTES / 1e6} MB, so it was not used. Simplify the shape.` : "The code produced an empty file."));
        else end(resolve, { bytes: new Uint8Array(b) });
      } else if (m.type === "error" && m.req === 1) end(reject, fail("code", text(m.error)));
    };
    worker.onerror = (e) => end(reject, fail(running ? "crash" : "start", running ? "The geometry engine stopped while running the code. Simplify the shape and try again." : "The geometry engine could not start for this build" + (e && e.message ? " (" + e.message + ")" : "") + "."));
    startTimer = setTimeout(() => end(reject, fail("start", "The geometry engine took too long to start for this build.")), limits.startMs);
    worker.postMessage({ type: "init", parts: kernel.parts });
  });
  return { done, cancel: () => stop(fail("cancelled", "Cancelled. Nothing was changed.")) };
}
