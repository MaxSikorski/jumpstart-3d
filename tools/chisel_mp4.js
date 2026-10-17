// ---- A small MP4 writer for the Puppet Animator's video export: one video track (H.264 when the
// browser can encode it, otherwise VP9 — both are standard MP4), frames rendered one by one so
// the video is smooth even on a slow computer. Built with the browser's WebCodecs encoder.
const MP4 = (() => {
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = (n) => [(n >>> 8) & 255, n & 255];
  const str = (s) => [...s].map((c) => c.charCodeAt(0));
  const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  const box = (type, ...body) => { const b = cat(...body.map((x) => (x instanceof Uint8Array ? x : new Uint8Array(x)))); return cat(new Uint8Array([...u32(b.length + 8), ...str(type)]), b); };
  const full = (type, ver, flags, ...body) => box(type, [ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...body);
  const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
  // samples: [{ data: Uint8Array, key: bool }], codec: "avc" | "vp9", desc: avcC bytes (H.264)
  function mux({ width, height, fps, samples, codec, desc }) {
    const n = samples.length, ts = fps * 1000, delta = 1000, dur = n * delta, ms = Math.round((n / fps) * 1000);
    const ftyp = box("ftyp", str("isom"), u32(0x200), str("isom"), str("iso2"), str(codec === "avc" ? "avc1" : "vp09"), str("mp41"));
    const entryBody = [new Uint8Array(6), u16(1), u16(0), u16(0), new Uint8Array(12), u16(width), u16(height), u32(0x480000), u32(0x480000), u32(0), u16(1), new Uint8Array(32), u16(0x18), u16(0xffff)];
    const entry = codec === "avc" ? box("avc1", ...entryBody, box("avcC", desc))
      : box("vp09", ...entryBody, full("vpcC", 1, 0, [0, 31, (8 << 4) | (1 << 1) | 0, 1, 1, 1], u16(0)));
    const stbl = (off) => box("stbl",
      full("stsd", 0, 0, u32(1), entry),
      full("stts", 0, 0, u32(1), u32(n), u32(delta)),
      full("stss", 0, 0, u32(samples.filter((s) => s.key).length), ...samples.map((s, i) => (s.key ? u32(i + 1) : [])).filter((a) => a.length)),
      full("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1)),
      full("stsz", 0, 0, u32(0), u32(n), ...samples.map((s) => u32(s.data.length))),
      full("stco", 0, 0, u32(1), u32(off)));
    const moov = (off) => box("moov",
      full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x10000), u16(0x100), new Uint8Array(10), MATRIX, new Uint8Array(24), u32(2)),
      box("trak",
        full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(ms), new Uint8Array(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
        box("mdia",
          full("mdhd", 0, 0, u32(0), u32(0), u32(ts), u32(dur), u16(0x55c4), u16(0)),
          full("hdlr", 0, 0, u32(0), str("vide"), new Uint8Array(12), str("VideoHandler"), [0]),
          box("minf",
            full("vmhd", 0, 1, new Uint8Array(8)),
            box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
            stbl(off)))));
    const size0 = moov(0).length, off = ftyp.length + size0 + 8;
    const mdatLen = samples.reduce((a, s) => a + s.data.length, 0);
    return cat(ftyp, moov(off), new Uint8Array([...u32(mdatLen + 8), ...str("mdat")]), ...samples.map((s) => s.data));
  }
  // which codec this browser can encode (null: no WebCodecs encoder)
  async function pick(width, height, fps) {
    if (typeof VideoEncoder === "undefined") return null;
    const tries = [
      { codec: "avc", cfg: { codec: height > 720 ? "avc1.640028" : "avc1.4d401f", avc: { format: "avc" } } },
      { codec: "avc", cfg: { codec: "avc1.42001f", avc: { format: "avc" } } },
      { codec: "vp9", cfg: { codec: "vp09.00.31.08" } },
    ];
    for (const t of tries) {
      const cfg = { ...t.cfg, width, height, bitrate: height > 720 ? 8e6 : 5e6, framerate: fps };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { codec: t.codec, cfg }; } catch (e) {}
    }
    return null;
  }
  // render frames one by one: draw(i) must draw frame i into canvas; returns MP4 bytes
  async function record(canvas, frames, fps, draw, onProgress) {
    const W = canvas.width, H = canvas.height, choice = await pick(W, H, fps);
    if (!choice) return null;
    const samples = []; let desc = null, err = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => { const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); samples.push({ data: d, key: chunk.type === "key" }); if (meta && meta.decoderConfig && meta.decoderConfig.description) desc = new Uint8Array(meta.decoderConfig.description); },
      error: (e) => { err = e; },
    });
    enc.configure(choice.cfg);
    for (let i = 0; i < frames; i++) {
      await draw(i);
      const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (enc.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 4));
      if (err) throw err;
      onProgress && onProgress((i + 1) / frames);
    }
    await enc.flush(); enc.close();
    if (err) throw err;
    if (choice.codec === "avc" && !desc) throw new Error("The video encoder gave no H.264 setup data.");
    return { bytes: mux({ width: W, height: H, fps, samples, codec: choice.codec, desc }), codec: choice.codec };
  }
  return { mux, pick, record };
})();
