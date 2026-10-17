// Web Worker hosting the OpenCascade kernel.
import opencascade from "replicad-opencascadejs";
import { gunzip } from "./inflate.js";
import { initKernel, buildBodies, exportStep, clearCache, setAsset } from "./kernel.js";

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
      const res = buildBodies(msg.bodies, msg.quality || 1);
      const transfer = [];
      for (const r of res) if (r.ok) {
        const m = r.mesh;
        transfer.push(m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.lines.buffer);
      }
      self.postMessage({ type: "built", req: msg.req, results: res }, transfer);
    } else if (msg.type === "step") {
      await ready;
      const blob = exportStep(msg.bodies);
      const buf = await blob.arrayBuffer();
      self.postMessage({ type: "step", req: msg.req, data: buf }, [buf]);
    } else if (msg.type === "asset") {
      setAsset(msg.id, msg.kind, new Uint8Array(msg.bytes));
    } else if (msg.type === "clear") {
      clearCache();
    }
  } catch (e) {
    self.postMessage({ type: "error", req: msg.req, error: (e && e.message) || String(e) });
  }
};
