// JumpStart 3D scripting bridge: a demo you can paste into the browser console.
//
// Open the app, open the console (Chrome and Edge: F12 or Ctrl+Shift+J, Mac: Cmd+Option+J; Firefox:
// Ctrl+Shift+K; Safari: enable the Develop menu, then Cmd+Option+C), paste this whole file and press Enter.
// You will see the box with its hole appear in the 3D view, and the console prints a summary.
//
// It uses only window.JS3D (see BRIDGE.md). Run it on a fresh page: it starts a new design, so the one
// you had open stays in "Your designs" but is no longer on screen.
(async () => {
  // 1. A fresh Beginner design, a 40 x 30 x 20 mm block, and a hole 8 mm wide.
  //    The hole is a cylinder marked as a hole; it is taller than the block so it cuts all the way through.
  //    "at" is where the middle of the shape's footprint sits, with its base at the given height.
  await JS3D.newDesign("beginner");
  const box = JS3D.add("box", { size: { w: 40, d: 30, h: 20 }, at: [0, 0, 0], name: "Block" });
  const hole = JS3D.add("cylinder", { size: { w: 8, d: 8, h: 30 }, at: [0, 0, -5], hole: true, name: "Hole" });

  // 2. Combine them: the hole is cut out of the block.
  const part = JS3D.group([box, hole], { name: "Block with hole" });

  // 3. The shape is built by the geometry engine in the background. ready() waits until it is done.
  await JS3D.ready();
  const volume = JS3D.get(part).volume; // mm3; about 22994.7: 40*30*20 minus pi*4*4*20

  // 4. Export a 3D-printing file (STL) and the design itself (the project .json).
  const stl = await JS3D.export("stl");
  const json = await JS3D.export("json");

  // 5. Load the saved design back in, and export again. The two STL files should be the same.
  await JS3D.load(new TextDecoder().decode(json));
  const stlAgain = await JS3D.export("stl");

  const triangles = (bytes) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true); // the count sits after the 80-byte header
  const fingerprint = (bytes) => { let h = 2166136261; for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0; return h; };
  const summary = {
    ids: { box, hole, group: part },
    volume,
    stlBytes: stl.length,
    stlAgain: stlAgain.length,
    triangles: triangles(stl),
    sameShape: stl.length === stlAgain.length && fingerprint(stl) === fingerprint(stlAgain),
    bodies: JS3D.list().map((b) => `${b.name} (${b.kind}) at ${b.position.join(", ")}`),
  };
  console.log(summary);
  return summary;
})();
