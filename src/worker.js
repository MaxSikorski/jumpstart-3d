// Web Worker hosting the OpenCascade kernel.
import opencascade from "replicad-opencascadejs";
import { gunzip } from "./inflate.js";
import { initKernel, buildBodies, exportStep, clearCache, setAsset, errorText, fontsReady } from "./kernel.js";
import { runCodeCad } from "./codecad-worker.js"; // jumpstart-3d: Code CAD
import { startManifold, manifoldReady } from "./meshbool.js"; // jumpstart-3d: Manifold mesh booleans

let ready = null;

async function fetchBytes(parts, onProgress) {
  // parts: [{url, gz}] fetched in order and concatenated
  const chunks = [];
  let total = 0;
  for (const part of parts) {
    if (part.bytes) {
      // standalone file: the engine was embedded in the page and handed over directly
      let buf = new Uint8Array(part.bytes);
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = await gunzip(buf);
      chunks.push(buf); total += buf.length;
      continue;
    }
    const res = await fetch(part.url);
    if (!res.ok) throw new Error(`Couldn't load the geometry engine (${res.status})`);
    let stream = res.body;
    const size = +res.headers.get("content-length") || part.size || 0;
    let got = 0;
    const counter = new TransformStream({
      transform(chunk, ctl) { got += chunk.length; onProgress(got, size, part); ctl.enqueue(chunk); },
    });
    stream = stream.pipeThrough(counter);
    let buf = new Uint8Array(await new Response(stream).arrayBuffer());
    // gzip magic: decompress here (the host may or may not have done it already)
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      buf = await gunzip(buf);
    }
    chunks.push(buf);
    total += buf.length;
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      ready = (async () => {
        const bytes = await fetchBytes(msg.parts, (got, size, part) =>
          self.postMessage({ type: "progress", got, size, part: part.url }));
        self.postMessage({ type: "progress", phase: "compile" });
        await initKernel(opencascade, bytes);
      })();
      await ready;
      self.postMessage({ type: "ready" });
    } else if (msg.type === "build") {
      await ready;
      await manifoldReady(); // jumpstart-3d: Manifold starts with the first imported mesh; a build waits for it (nothing when no mesh was imported)
      await fontsReady();
      // jumpstart-3d: scoped stage messages are independent of engine loading.
      const res = buildBodies(msg.bodies, msg.quality || 1, { onProgress: (event) => self.postMessage({ type: "progress", req: msg.req, ...event }) });
      const transfer = [];
      for (const r of res) if (r.ok) {
        const m = r.mesh;
        transfer.push(m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.lines.buffer);
      }
      self.postMessage({ type: "built", req: msg.req, results: res }, transfer);
    } else if (msg.type === "step") {
      await ready;
      await manifoldReady(); // jumpstart-3d: Manifold
      const blob = exportStep(msg.bodies);
      const buf = await blob.arrayBuffer();
      self.postMessage({ type: "step", req: msg.req, data: buf }, [buf]);
    } else if (msg.type === "code") { // jumpstart-3d: Code CAD. only the temporary worker that codecadclient.js starts is sent this
      await ready;
      await manifoldReady(); // jumpstart-3d: Manifold
      const r = await runCodeCad(msg);
      self.postMessage({ type: "coded", req: msg.req, bytes: r.bytes }, [r.bytes]);
    } else if (msg.type === "dropasset") { // jumpstart-3d: Code CAD. frees the bytes of a file the design no longer has
      setAsset(msg.id, "step", new Uint8Array(0));
    } else if (msg.type === "asset") {
      setAsset(msg.id, msg.kind, new Uint8Array(msg.bytes));
      if (msg.kind === "mesh") startManifold(); // jumpstart-3d: Manifold, fire and forget (a failed start leaves OpenCascade doing the booleans)
    } else if (msg.type === "clear") {
      clearCache();
    }
  } catch (e) {
    self.postMessage({ type: "error", req: msg.req, error: errorText(e) }); // jumpstart-3d: errorText reads engine exceptions
  }
};
