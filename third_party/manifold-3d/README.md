# manifold-3d (vendored)

The mesh-boolean engine JumpStart 3D uses for a Join, Cut or Combine that involves an imported mesh (`src/meshbool.js`). OpenCascade stays the engine for everything else.

- Package: **manifold-3d 3.5.4** (npm, 2026-09-25), Apache-2.0, https://github.com/elalish/manifold
- Source tarball: https://registry.npmjs.org/manifold-3d/-/manifold-3d-3.5.4.tgz
- Integrity: `sha512-WWsme5HabwLHVcWPHT9m+s7mdmDVSEvCny+uXH1E7jEc8FbFUgM75C3Dh6NVw57Eeh3Ow7+xHCuXfxDMOemi9A==`

| File | What | sha256 |
|---|---|---|
| `manifold.js` | the package's Emscripten glue, byte for byte | `ca3c8a88df63bb3083013d1eb7f700bf23216594f6e98a2566e34f55d7341ce8` |
| `wasm.js` | generated: `export default "<base64 of manifold.wasm, gzip level 9>"` | (of the unpacked `manifold.wasm`:) `73e3b419ad31294f6b1cc478173944e50efc4a34bfdeeff0107bdfc12975f11c` |
| `index.js` | ours: `loadManifold()` (memoised; unpacks the wasm with `src/inflate.js`, no network, no `import.meta.url`) | |
| `LICENSE` | Apache-2.0, from the package | |

`manifold.wasm` is 541,470 bytes; `wasm.js` is about 274 KB. The wasm also contains Clipper2 (Angus Johnson, Boost Software License 1.0; see `LICENSES/BSL-1.0-clipper2.txt`); its hull code derives from Antti Kuukka's public-domain QuickHull.

The old stand-in that J.Siwek's source carried here (`index.js` that threw "no manifold") is replaced. replicad only imports Manifold's types, so nothing else uses it.

## Regenerate / check

```
mkdir /tmp/m && cd /tmp/m && npm pack manifold-3d@3.5.4 && tar xzf manifold-3d-3.5.4.tgz     # unpacks to ./package
node tools/vendor-manifold.mjs /tmp/m/package           # copies manifold.js + LICENSE, writes wasm.js
node tools/vendor-manifold.mjs /tmp/m/package --check   # says whether the committed files match
```

`test/meshbool.test.mjs` checks that the wasm inside `wasm.js` has the sha256 above and that the bundled loader starts in a sandbox with no `process`, no `import.meta.url` and no `fetch`.
