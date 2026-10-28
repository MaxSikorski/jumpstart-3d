// jumpstart-3d: the Manifold mesh-boolean engine (manifold-3d 3.5.4, Apache-2.0), vendored. This replaces the stand-in that used to sit here.
// loadManifold() unpacks the WebAssembly file (kept gzipped inside wasm.js), starts it and returns the module; it runs once, later calls
// return the same promise. It makes no network request and needs neither `process` nor `import.meta.url`, so it runs in the page's
// worker, in the single file opened from disk, and in Node tests.
// Only src/meshbool.js imports this, by this relative path (not the bare name "manifold-3d", which build.mjs aliases to this file).
import Module from "./manifold.js";
import b64 from "./wasm.js";
import { gunzip } from "../../src/inflate.js";

let ready = null;
export default function loadManifold() {
  return (ready ??= (async () => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bytes = await gunzip(bin);
    // the bytes go in as wasmBinary: the glue then instantiates them itself and REJECTS if that fails (its instantiateWasm hook has no way to fail,
    // so a broken start used to hang forever). With the bytes in hand it makes no fetch.
    const M = await Module({
      // the glue would build "manifold.wasm" from import.meta.url, which does not exist in the single file's worker
      locateFile: () => "manifold.wasm",
      wasmBinary: bytes,
    });
    M.setup();
    return M;
  })().catch((e) => { ready = null; throw e; })); // a failed start can be tried again
}
