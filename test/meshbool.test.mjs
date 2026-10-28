// Manifold, the mesh-boolean engine for joins and cuts with an imported mesh (src/meshbool.js, third_party/manifold-3d/).
// Block 1 (the engine): the vendored files are the ones the README names, and the engine, bundled the way build.mjs bundles the
// worker (IIFE, minified), starts in a sandbox that has no `process`, no `import.meta.url` and no fetch, and cuts a cylinder out of a cube.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha = (b) => createHash("sha256").update(b).digest("hex");

describe("the vendored Manifold engine", () => {
  const readme = readFileSync(root + "third_party/manifold-3d/README.md", "utf8");

  test("wasm.js holds the manifold.wasm the README names, and manifold.js is the package's glue", async () => {
    const mod = readFileSync(root + "third_party/manifold-3d/wasm.js", "utf8");
    const b64 = /export default "([A-Za-z0-9+/=]+)"/.exec(mod)[1];
    const wasm = gunzipSync(Buffer.from(b64, "base64"));
    assert.deepEqual([...wasm.subarray(0, 4)], [0, 0x61, 0x73, 0x6d], "a WebAssembly file");
    const wasmHash = sha(wasm), jsHash = sha(readFileSync(root + "third_party/manifold-3d/manifold.js"));
    assert.ok(readme.includes(wasmHash), "README.md names the sha256 of manifold.wasm: " + wasmHash);
    assert.ok(readme.includes(jsHash), "README.md names the sha256 of manifold.js: " + jsHash);
    assert.match(readme, /manifold-3d 3\.5\.4/);
    assert.equal(JSON.parse(readFileSync(root + "third_party/manifold-3d/package.json", "utf8")).version, "3.5.4");
  });

  test("the loader, bundled like the worker, starts with no process, no import.meta.url and no fetch, and cuts a cylinder out of a cube", async () => {
    // build.mjs: common options + format iife, and the empty import.meta warning silenced (the loader never needs it)
    const out = await build({
      stdin: { contents: 'import load from "./third_party/manifold-3d/index.js"; globalThis.__load = load;', resolveDir: root },
      bundle: true, minify: true, legalComments: "eof", target: "es2020", logLevel: "warning", format: "iife", write: false, external: ["node:*"],
      logOverride: { "empty-import-meta": "silent" },
    });
    const sandbox = {
      // what a worker has, and nothing else: JS built-ins come with the context; these are the web APIs the loader reads
      atob, TextDecoder, TextEncoder, DecompressionStream, Response, Blob, ReadableStream, WritableStream, TransformStream, URL, performance, queueMicrotask, setTimeout, clearTimeout,
      console, // the engine may log
      fetch: () => { throw new Error("the engine must not fetch anything"); },
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    assert.equal(vm.runInContext("typeof process + typeof window + typeof importScripts", sandbox), "undefinedundefinedundefined");
    vm.runInContext(out.outputFiles[0].text, sandbox, { filename: "worker-bundle.js" });
    const t0 = performance.now();
    const M = await sandbox.__load();
    const loadMs = Math.round(performance.now() - t0);
    assert.equal(await sandbox.__load(), M, "loads once");
    const cube = M.Manifold.cube({ x: 10, y: 10, z: 10 }), cyl = M.Manifold.cylinder(20, 3, 3, 96).translate({ x: 5, y: 5, z: -5 }); // plain objects: this sandbox's Array is not ours
    const cut = cube.subtract(cyl);
    const expected = 1000 - Math.PI * 9 * 10; // a 96-sided cylinder is a little smaller than the round one
    assert.ok(Math.abs(cut.volume() - expected) < 0.5, `volume ${cut.volume()} vs ${expected}`);
    assert.equal(cut.status(), "NoError");
    [cube, cyl, cut].forEach((m) => m.delete());
    console.log(`manifold-load: ${loadMs} ms in the sandbox`);
  });
});
