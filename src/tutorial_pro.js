// Bigger Advanced-mode projects: five Advanced and five Expert tutorials, each a real item made of
// two or more parts, using many tools, about 18-28 minutes when the steps are followed exactly.
// Same step format as tutorial_data.js (title, tool, icon, show, how, when, tip, check).
import { nameStep, saveStep, exportStep } from "./tutorial_data.js";

// helpers for the checks
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
// a body whose bounding box is about w × d × h (any order of w and d)
const sized = (t, w, d, h, tol = 1.5) => t.bodies().some((b) => {
  const x = t.box(b.id);
  return x && near(x.size.z, h, tol) && ((near(x.size.x, w, tol) && near(x.size.y, d, tol)) || (near(x.size.x, d, tol) && near(x.size.y, w, tol)));
});
// sketches on the front (XZ) plane, and their points (x along X, y up along Z)
const xzSketches = (t) => t.sketches().filter((s) => Math.abs(s.plane.n[1]) > 0.99);
const hasPt = (s, x, y, tol = 0.6) => s.pts.some((p) => near(p.x, x, tol) && near(Math.abs(p.y), y, tol));
// how many features of a kind on bodies that are not holes
const mods = (t, kind) => t.countMods(kind);
const bodiesNamed = (t, re) => t.bodies().filter((b) => re.test(b.name || ""));
// how many extrudes were joined onto bodies
const joins = (t) => { let n = 0; for (const b of t.bodies()) for (const m of b.node.mods || []) if (m.t === "bool" && m.tool && m.tool.t === "extrude" && (m.op || "join") === "join") n++; return n; };

export const PRO_TUTORIALS = [
  // ============================================================== ADVANCED
  {
    id: "a-birdhouse", mode: "advanced", level: "Advanced", minutes: "18-22", item: "Birdhouse",
    title: "Birdhouse with a lift-off roof",
    blurb: "A hollow house with an entrance, a perch and side vents, and a separate pitched roof that lifts off for cleaning. Two parts, laid out side by side to print.",
    learn: ["Center rectangle", "Extrude", "Shell", "Sketch on a face", "Extrude cut and join", "Hole", "Pattern features", "Line (length and angle)", "Symmetric extrude", "New body", "Fillet", "Emboss", "Move/Copy"],
    steps: [
      nameStep("Birdhouse", "Lopez, Maria, Birdhouse"),
      {
        title: "The house", tool: "Sketch → Center rectangle + Extrude", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "rect",
        how: [
          "Click <b>Sketch</b> → <b>XY · Top</b>.",
          "Click <b>Rectangle</b> (or press <b>R</b>) and choose <b>Center</b> in the panel. Click the origin dot, type <b>100</b>, <b>Tab</b>, <b>100</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>120</b>, <b>OK</b>.",
        ],
        when: "Start every project with the biggest, simplest shape. Everything else is added to it or cut from it.",
        check: (t) => sized(t, 100, 100, 120),
      },
      {
        title: "Hollow it, open at the top", tool: "Shell", icon: "shell", show: { sel: "#ad-shell" },
        how: [
          "Press <b>Home</b>. Click <b>Shell</b>, then click the <b>top face</b> of the block.",
          "<b>Thickness 3</b>, <b>Inside</b>. <b>OK</b>.",
        ],
        when: "Shell makes walls of an even thickness. The face you click is removed, so the house is open where the roof will sit.",
        check: (t) => mods(t, "shell") >= 1,
      },
      {
        title: "The entrance hole", tool: "Sketch on a face → Circle + Extrude (Cut)", icon: "circle", show: { sel: "#ad-sketch" }, anim: "cut",
        how: [
          "Press <b>Home</b> so you look at the front. Click <b>Sketch</b>, then click the house's <b>front face</b>.",
          "Click <b>Circle</b>. Move the pointer straight up from the middle of the face until the label says <b>0, 80</b> (80 mm up), then click. Type <b>32</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>-5</b> (into the wall). It says <b>Will cut</b>. <b>OK</b>.",
        ],
        when: "A 32 mm hole suits small birds such as wrens and chickadees. Cutting a little deeper (5 mm) than the 3 mm wall makes sure it goes right through.",
        check: (t) => t.extrudeMod("cut"),
      },
      {
        title: "The perch", tool: "Sketch on a face → Circle + Extrude (Join)", icon: "circle", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "Click <b>Sketch</b>, then the <b>front face</b> again.",
          "<b>Circle</b>: move straight down from the hole until the label says <b>0, 50</b>, click, type <b>8</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>25</b>. It says <b>Will join the body it touches</b>. <b>OK</b>.",
        ],
        when: "The same sketch-and-extrude adds material when you pull outward: the perch is part of the house, so it can't fall off.",
        check: (t) => t.extrudeMod("join"),
      },
      {
        title: "A vent hole in the side", tool: "Hole", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: [
          "Orbit (right-drag) a little so you can see the <b>right side</b> of the house.",
          "Click <b>Hole</b> (or press <b>H</b>), then click the <b>right side face</b> near the top.",
          `In the panel set the position: <b>Y -30</b>, <b>Z 100</b> (keep X as it is). <b>Diameter 6</b>. Extent: <b>Through all</b>. <b>OK</b>.`,
        ],
        when: "Through all goes through both side walls at once, so you get a vent on each side. Vents let hot air out of the house in summer.",
        check: (t) => mods(t, "hole") >= 1,
      },
      {
        title: "A row of vents", tool: "Pattern → Features", icon: "pattern", show: { sel: "#ad-pattern" },
        how: [
          "Click <b>Pattern</b>. At the top choose <b>Features</b>, then click the inside wall of the vent hole you just made, or tick <b>Hole</b> in the list (it turns blue).",
          "Type <b>Rectangular</b>, Direction 1 <b>Y</b>, Count <b>3</b>, Spacing <b>30</b>. <b>OK</b>.",
        ],
        when: "Pattern → Features copies cuts and holes on the same body, so you don't have to place each one. Change the first hole later and its copies follow.",
        check: (t) => mods(t, "hole") >= 3,
      },
      {
        title: "Draw the roof's end", tool: "Sketch → Line (length and angle)", icon: "line", show: { sel: "#ad-sketch" }, anim: "line",
        how: [
          "Click <b>Sketch</b> → <b>XZ · Front</b>.",
          "Click <b>Line</b> (or press <b>L</b>). Move to the left until the label says <b>-60, 120</b> and click.",
          "Type <b>120</b>, <b>Tab</b>, <b>0</b>, <b>Enter</b> (a line 120 mm long going right).",
          "Type <b>72.11</b>, <b>Tab</b>, <b>146.31</b>, <b>Enter</b> (up and back to the peak at 0, 160).",
          "Click the first point to close the triangle.",
        ],
        when: "Typing a length and an angle draws exact slopes. The angle is measured from the right (east) direction, counterclockwise.",
        tip: "72.11 is the slope's length: √(60² + 40²). 146.31° points up and to the left.",
        check: (t) => xzSketches(t).some((s) => s.ents.filter((e) => e.t === "line").length >= 3 && hasPt(s, 0, 160)),
      },
      {
        title: "The roof, as its own part", tool: "Extrude (Symmetric, New body)", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" },
        how: [
          "Press <b>E</b>. Direction <b>Symmetric</b>, Total distance <b>116</b>.",
          "Operation: choose <b>New body</b> (otherwise it would join the house, since it touches the walls). <b>OK</b>.",
        ],
        when: "New body keeps the roof a separate part. Symmetric pushes it out the same amount both ways, so it overhangs the 100 mm house by 8 mm front and back.",
        check: (t) => t.bodies().filter((b) => b.node.t === "extrude").length >= 2 && t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.size.y, 116, 1.5) && near(x.size.z, 40, 1.5); }),
      },
      {
        title: "Hollow the roof from below", tool: "Shell", icon: "shell", show: { sel: "#ad-shell" },
        how: [
          "Drag the view cube up so you look at the house from <b>below</b>.",
          "Click <b>Shell</b>, then click the strip of the roof's <b>underside</b> that sticks out past the walls (front, back or sides).",
          "<b>Thickness 3</b>. <b>OK</b>. Press <b>Home</b>.",
        ],
        when: "A hollow roof uses far less plastic and prints faster. Its rim sits on the walls.",
        check: (t) => mods(t, "shell") >= 2,
      },
      {
        title: "Round the ridge", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: ["Click <b>Fillet</b> (or press <b>F</b>), click the roof's <b>top edge</b> (the ridge), Size <b>4</b>, <b>OK</b>."],
        when: "A rounded ridge looks finished and has no sharp point to print.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      {
        title: "Your name on the front", tool: "Decorate → Emboss", icon: "emboss", show: { sel: "#ad-emboss", via: "#ad-decorate" },
        how: [
          "<b>Decorate</b> ▾ → <b>Emboss text</b>. Click the house's <b>front face</b> below the perch.",
          "Text: your <b>first name</b>. Letter height <b>12</b>, Height <b>1</b>. Drag the text so it's centered under the perch. <b>OK</b>.",
        ],
        when: "Emboss raises letters out of a face (Deboss cuts them in). Keep letters at least 8 mm tall so they print clearly.",
        check: (t) => mods(t, "emboss") >= 1,
      },
      {
        title: "Lay the roof out to print", tool: "Transform → Move/Copy", icon: "move", show: { sel: "#ad-move", via: "#ad-transform" },
        how: [
          "Click the <b>roof</b> to select it.",
          "<b>Transform</b> ▾ → <b>Move/Copy</b> (or press <b>M</b>). Move by <b>X 140</b>, <b>Y 0</b>, <b>Z -120</b>. <b>OK</b>.",
          "The roof now sits on the ground beside the house, ready to print.",
        ],
        when: "Parts that print separately must not touch, and each must sit on the build plate (Z 0).",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.size.z, 40, 1.5) && x.min.z > -1 && x.min.z < 1 && x.center.x > 90; }),
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-keepsake", mode: "advanced", level: "Advanced", minutes: "20-24", item: "Keepsake Box",
    title: "Round keepsake box, split into a box and lid",
    blurb: "Model one closed, hollow shape, then split it into a box and a lid with a construction plane. Add a lip and a matching recess with a print clearance, wrap your name around the side, and flip the lid for printing in the 3D Print Sim.",
    learn: ["Circle", "Extrude", "Fillet", "Shell (hollow)", "Offset plane", "Split body", "Sketch on a construction plane", "Profile picking", "Extrude cut", "Clearance", "Emboss on a curve", "3D Print Sim objects"],
    steps: [
      nameStep("Keepsake Box", "Lopez, Maria, Keepsake Box"),
      {
        title: "The whole box, closed", tool: "Sketch → Circle + Extrude", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "Click <b>Sketch</b> → <b>XY · Top</b>. <b>Circle</b>: click the origin, type <b>80</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>50</b>, <b>OK</b>.",
        ],
        when: "Designers often model a box and its lid as one shape first, then split it: the two parts are sure to line up.",
        check: (t) => sized(t, 80, 80, 50),
      },
      {
        title: "Round the top", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: ["Press <b>Home</b>. <b>Fillet</b> (or <b>F</b>), click the <b>top edge</b> (the circle around the top), Size <b>6</b>, <b>OK</b>."],
        when: "Round edges before you hollow a part, so the walls follow the curve and stay the same thickness everywhere.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      {
        title: "Hollow it, closed all round", tool: "Shell → Hollow", icon: "shell", show: { sel: "#ad-shell" },
        how: [
          "Click <b>Shell</b>. At the top of the panel choose Type <b>Hollow</b> (no faces are removed).",
          "The box is picked for you (the panel shows <b>Body 1</b>; if it says <b>Click a shape</b>, click the box once). Wall thickness <b>3.5</b>, <b>OK</b>. From outside it looks the same: it's hollow inside.",
        ],
        when: "Hollow keeps every face, like an egg. Splitting it next opens it up into two parts.",
        check: (t) => mods(t, "shell") >= 1,
      },
      {
        title: "A plane where the lid starts", tool: "Planes → Offset plane", icon: "planeOffset", show: { sel: "#ad-plane-off", via: "#ad-construct" }, anim: "plane",
        how: [
          "<b>Planes</b> ▾ → <b>Offset plane</b>.",
          "From <b>XY</b>, Distance <b>38</b>. <b>OK</b>. A plane appears 38 mm up, crossing the box.",
        ],
        when: "Construction planes are helpers: they make no plastic, but you can sketch on them, split with them or mirror across them.",
        check: (t) => t.planes().length >= 1,
      },
      {
        title: "Split it into box and lid", tool: "Advanced Modify → Split body", icon: "splitBody", show: { sel: "#ad-splitbody", via: "#ad-advmod" },
        how: [
          "<b>Advanced Modify</b> ▾ → <b>Split body</b>.",
          "Click the box. Tool type <b>Plane / face</b>, then choose <b>Plane 1</b> in the <b>A construction plane…</b> list. <b>OK</b>.",
          "Now there are two bodies: the box (38 mm tall) and the lid (12 mm). Each is open where the plane cut it.",
        ],
        when: "Split body cuts one body into separate parts along a plane, a face, a sketch or another body.",
        check: (t) => mods(t, "halfspace") >= 2 && t.bodies().length >= 2,
      },
      {
        title: "Make room for the lip", tool: "Sketch on a plane + Extrude (Cut)", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "cut",
        how: [
          "Click <b>Sketch</b>, and in the panel pick <b>Plane 1</b> from the <b>Pick a construction plane…</b> list.",
          "<b>Circle</b>: click the origin, type <b>76.6</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>4.5</b> (up, into the lid). Operation <b>Cut</b>. <b>OK</b>. Only the lid is above the plane, so only the lid is cut.",
        ],
        when: "The lip you add next is 76 mm across. This recess is 0.6 mm bigger (0.3 mm all round): a clearance, so the printed lid slides on without forcing.",
        check: (t) => t.extrudeMod("cut"),
      },
      {
        title: "Lift the lid to look", tool: "Transform → Move/Copy", icon: "move", show: { sel: "#ad-move", via: "#ad-transform" },
        how: [
          "Click the <b>lid</b>. <b>Transform</b> ▾ → <b>Move/Copy</b>: <b>X 0</b>, <b>Y 0</b>, <b>Z 20</b>. <b>OK</b>.",
          "Orbit around and look under the lid: its rim now has a wider recess inside. With the lid out of the way, the lip is easy to add and pick.",
        ],
        when: "Pull parts apart on screen to work on them and to check how they fit.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && x.min.z > 50 && x.min.z < 70; }),
      },
      {
        title: "The lip, as its own part", tool: "Sketch on a plane → Two circles + Extrude (New body)", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "<b>Sketch</b> → pick <b>Plane 1</b> again. <b>Circle</b>: click the origin, type <b>76</b>, <b>Enter</b>. Click the origin again, type <b>70</b>, <b>Enter</b>.",
          "Press <b>E</b>. Two shapes are possible, so click the <b>thin ring</b> between the circles (it turns blue).",
          "Distance <b>4</b>, Operation <b>New body</b>. <b>OK</b>. A ring stands on the box's rim.",
        ],
        when: "Two circles make two profiles: the ring and the disk inside it. You choose which to extrude by clicking it. The ring touches both the box and the lid, so you make it on its own and choose which part it joins next.",
        check: (t) => t.bodies().length >= 3,
      },
      {
        title: "Join the lip to the box", tool: "Advanced Modify → Combine (Join)", icon: "combine", show: { sel: "#ad-combine", via: "#ad-advmod" }, anim: "combine",
        how: [
          "<b>Advanced Modify</b> ▾ → <b>Combine</b> (or press <b>B</b>).",
          "Click the <b>box</b> (the bottom part) first, then the <b>ring</b>. Operation <b>Join</b>. <b>OK</b>.",
          "The box is now 42 mm tall with the lip on top; the lid is still separate.",
        ],
        when: "Combine joins, cuts or intersects whole bodies. The first body you click is the one that's kept.",
        check: (t) => t.hasCombine("join") && t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.size.z, 42, 1) && x.min.z < 1; }),
      },
      {
        title: "Your name around the side", tool: "Decorate → Emboss (around a curve)", icon: "emboss", show: { sel: "#ad-emboss", via: "#ad-decorate" },
        how: [
          "<b>Decorate</b> ▾ → <b>Emboss text</b>. Click the <b>side</b> of the box (the lower part), facing you.",
          "Text: your <b>first name</b>. Letter height <b>10</b>, Height <b>1</b>, Direction <b>Around</b>. <b>OK</b>.",
        ],
        when: "On a round face, emboss wraps the letters around the curve.",
        check: (t) => mods(t, "emboss") >= 1,
      },
      {
        title: "Flip the lid for printing", tool: "3D Print Sim → Objects", icon: "printsim", show: { sel: "#ws-print" }, anim: "printsim",
        how: [
          "Click the <b>3D Print Sim</b> tab (left of the toolbar).",
          "Click the <b>lid</b> on the plate. Under <b>Objects</b>, type <b>180</b> in Turn and click <b>X</b>: the lid turns upside down, open side up, resting on its top.",
          "Click <b>Arrange</b> so the two parts sit side by side. These turns are only in the sim: your design doesn't change.",
        ],
        when: "Printed rim-down, the lid's 70 mm wide top would hang over thin air. Upside down, the top rests on the plate and every layer has something under it. A little red on the rounded edge near the plate is normal: it prints fine.",
        check: (t) => t.psimArranged(),
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-headset", mode: "advanced", level: "Advanced", minutes: "22-26", item: "Headphone Stand",
    title: "Headphone stand with a cable clip",
    blurb: "A weighted round base with rubber-foot pockets, a tall post and a padded-looking saddle with a lip at each end, plus a clip that slides onto the post to hold the cable. Two parts.",
    learn: ["Circle", "Extrude", "Chamfer", "Sketch on a face", "Center rectangle", "Symmetric extrude", "Fillet", "Mirror (Join)", "Hole (depth)", "Pattern features (circular)", "Emboss", "Two-rectangle profile", "Clearance", "Hole (through)"],
    steps: [
      nameStep("Headphone Stand", "Lopez, Maria, Headphone Stand"),
      {
        title: "The base", tool: "Sketch → Circle + Extrude", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "Click <b>Sketch</b> → <b>XY · Top</b>. <b>Circle</b>: click the origin, type <b>120</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>10</b>, <b>OK</b>.",
        ],
        when: "A wide base keeps a tall stand from tipping over.",
        check: (t) => sized(t, 120, 120, 10),
      },
      {
        title: "Bevel the base's top edge", tool: "Chamfer", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "Press <b>Home</b>. Press <b>C</b> (or click <b>Fillet</b> and choose Type <b>Chamfer</b>).",
          "Click the base's <b>top edge</b>. Distance <b>2</b>. <b>OK</b>.",
        ],
        when: "A chamfer is a flat, angled cut along an edge. Unlike a fillet it prints cleanly even on an edge facing down.",
        check: (t) => mods(t, "chamfer") >= 1,
      },
      {
        title: "The post", tool: "Sketch on a face → Center rectangle + Extrude", icon: "rect", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "Click <b>Sketch</b>, then the base's <b>top face</b>.",
          "<b>Rectangle</b> → <b>Center</b>. Click the middle (<b>0, 0</b>), type <b>30</b>, <b>Tab</b>, <b>20</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>240</b>. It joins the base. <b>OK</b>.",
        ],
        when: "Sketching on the base's top face starts the post exactly where the base ends, so the two are one solid part.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.size.z, 250, 1.5); }),
      },
      {
        title: "The saddle", tool: "Sketch (XZ) → Center rectangle + Symmetric extrude", icon: "rect", show: { sel: "#ad-sketch" }, anim: "rect",
        how: [
          "Click <b>Sketch</b> → <b>XZ · Front</b>. Zoom out so you can see the top of the post.",
          "<b>Rectangle</b> → <b>Center</b>. Move up the blue Z axis to the top corner of the post: the label says <b>0, 250</b>. Click. Type <b>110</b>, <b>Tab</b>, <b>10</b>, <b>Enter</b>.",
          "Press <b>E</b>. Direction <b>Symmetric</b>, Total distance <b>40</b>. It joins the post. <b>OK</b>.",
        ],
        when: "Centered on the post's top, the bar sits half over it and half above it, so the two overlap and join solidly. 110 mm long and 40 mm deep holds a headband without bending it.",
        check: (t) => joins(t) >= 2,
      },
      {
        title: "Soften the saddle", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "<b>Fillet</b> (or <b>F</b>). Click the saddle's <b>two long top edges</b> (front and back).",
          "Size <b>4</b>. <b>OK</b>.",
        ],
        when: "Round where things rest: a sharp edge would dent a soft headband.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      {
        title: "A lip at one end", tool: "Sketch on a face → Center rectangle + Extrude", icon: "rect", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "Click <b>Sketch</b>, then the saddle's <b>top face</b>.",
          "<b>Rectangle</b> → <b>Center</b>. Click where the label says <b>50, 0</b> (near the right end). Type <b>5</b>, <b>Tab</b>, <b>40</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>6</b>. It joins. <b>OK</b>.",
        ],
        when: "A low lip stops the headphones sliding off the end.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.max.z, 261, 1.5); }),
      },
      {
        title: "Mirror the lip to the other end", tool: "Mirror (Join)", icon: "mirror", show: { sel: "#ad-mirror", via: "#ad-features" }, anim: "mirror",
        how: [
          "<b>Advanced Create</b> ▾ → <b>Mirror</b>. Click the stand (the panel says <b>1 body</b>).",
          "Under <b>…or use</b> click <b>YZ</b> (the plane down the middle, left to right). Result: <b>Join</b>. <b>OK</b>.",
          "The mirror image lands exactly on the stand, so the only new thing is a second lip at the left end.",
        ],
        when: "Mirror makes symmetric parts: model one side, mirror the other. Join merges the copy into the same body.",
        check: (t) => t.bodies().some((b) => (b.node.mods || []).some((m) => m.tool && m.tool.t === "mirror")),
      },
      {
        title: "A pocket for a rubber foot", tool: "Hole (Depth)", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: [
          "Drag the view cube up to look at the stand from <b>below</b>.",
          "Click <b>Hole</b>, then the base's <b>bottom face</b>. Position <b>X 40</b>, <b>Y 0</b>. <b>Diameter 12</b>. Extent <b>Depth</b>, <b>1.5</b>. <b>OK</b>.",
        ],
        when: "Stick-on rubber feet are usually 12 mm across. A shallow pocket keeps them from peeling off and stops the stand sliding.",
        check: (t) => mods(t, "hole") >= 1,
      },
      {
        title: "Three feet, evenly spaced", tool: "Pattern → Features (Circular)", icon: "pattern", show: { sel: "#ad-pattern" },
        how: [
          "Click <b>Pattern</b> → <b>Features</b>, and click the pocket you just made.",
          "Type <b>Circular</b>, Axis <b>Z</b>, Through <b>Origin</b>, Count <b>3</b>, Total angle <b>360</b>. <b>OK</b>. Press <b>Home</b>.",
        ],
        when: "Three feet never wobble, even on an uneven desk (like a three-legged stool).",
        check: (t) => mods(t, "hole") >= 3,
      },
      {
        title: "Your name on the base", tool: "Decorate → Emboss", icon: "emboss", show: { sel: "#ad-emboss", via: "#ad-decorate" },
        how: ["<b>Decorate</b> ▾ → <b>Emboss text</b>. Click the base's top face in front of the post. Your <b>first name</b>, Letter height <b>10</b>, Height <b>1</b>. <b>OK</b>."],
        when: "Name your work where it shows.",
        check: (t) => mods(t, "emboss") >= 1,
      },
      {
        title: "The cable clip", tool: "Sketch → Two center rectangles + Extrude (New body)", icon: "rect", show: { sel: "#ad-sketch" },
        how: [
          "Click <b>Sketch</b> → <b>XY · Top</b>. Zoom out so you can see to the right of the base.",
          "<b>Rectangle</b> → <b>Center</b>. Click where the label says <b>120, 0</b>, type <b>36.6</b>, <b>Tab</b>, <b>26.6</b>, <b>Enter</b>. Click <b>120, 0</b> again, type <b>30.6</b>, <b>Tab</b>, <b>20.6</b>, <b>Enter</b>.",
          "Press <b>E</b>, click the <b>frame</b> between the rectangles, Distance <b>12</b>, Operation <b>New body</b>. <b>OK</b>.",
        ],
        when: "The opening is 30.6 × 20.6 mm for a 30 × 20 mm post: 0.3 mm of clearance on each side, so the clip slides down the post and stays where you put it.",
        check: (t) => sized(t, 36.6, 26.6, 12, 1),
      },
      {
        title: "A tab for the cable", tool: "Sketch on a face + Extrude (Join)", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "Click <b>Sketch</b>, then the clip's <b>right-hand outside face</b>.",
          "<b>Rectangle</b> → <b>Center</b>. Click the middle of that face, type <b>12</b>, <b>Tab</b>, <b>12</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>15</b>. It joins the clip. <b>OK</b>.",
        ],
        when: "Adding to a face of the clip makes the tab part of the clip.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.size.z, 12, 1) && near(x.max.x - x.min.x, 51.6, 1.5); }),
      },
      {
        title: "A hole for the cable", tool: "Hole (Through all)", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: ["Click <b>Hole</b>, then the <b>top</b> of the tab. Position: the middle of the tab (about <b>X 146</b>, <b>Y 0</b>). <b>Diameter 7</b>, Extent <b>Through all</b>. <b>OK</b>."],
        when: "Thread the headphone cable through the hole and slide the clip up or down the post.",
        check: (t) => mods(t, "hole") >= 4,
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-fidgetcone", mode: "advanced", level: "Advanced", minutes: "20-24", item: "Fidget Cone",
    title: "Fidget cone with spinning rings",
    blurb: "Three rings that spin freely around a core, trapped between its base and cap, printed already assembled. You shape the rings into a cone by intersecting them with a cone, and look inside with a section to check the gaps.",
    learn: ["Line (length and angle)", "Revolve", "Fillet", "Offset plane", "Two-circle profile", "Clearance", "Pattern (bodies)", "Cone primitive", "Combine (Intersect)", "Section Analysis", "3D Print Sim"],
    steps: [
      nameStep("Fidget Cone", "Lopez, Maria, Fidget Cone"),
      {
        title: "Draw half of the core", tool: "Sketch → Line (length and angle)", icon: "line", show: { sel: "#ad-sketch" }, anim: "line",
        how: [
          "Click <b>Sketch</b> → <b>XZ · Front</b>. Click <b>Line</b> (<b>L</b>), click the <b>origin</b>.",
          "Type each pair (length <b>Tab</b> angle <b>Enter</b>): <b>20, 0</b> · <b>3, 90</b> · <b>12, 180</b> · <b>60, 90</b> · <b>3, 0</b> · <b>3, 90</b> · <b>11, 180</b>.",
          "Click the origin to close it. This is half of the core's outline: a base 40 mm across, a shaft 16 mm across and a cap 22 mm across.",
        ],
        when: "A round part is drawn as half its outline, then spun around an axis. The left edge, on the Z axis, becomes the center.",
        check: (t) => xzSketches(t).some((s) => s.ents.filter((e) => e.t === "line").length >= 8 && hasPt(s, 11, 66) && hasPt(s, 8, 63)),
      },
      {
        title: "Spin it into the core", tool: "Advanced Create → Revolve", icon: "revolve", show: { sel: "#ad-revolve", via: "#ad-features" }, anim: "revolve",
        how: [
          "Click <b>Finish sketch</b>. <b>Advanced Create</b> ▾ → <b>Revolve</b> (or <b>Shift+R</b>).",
          "Click inside the outline. Under <b>…or use</b> choose <b>Z axis</b>. Angle <b>360</b>. <b>OK</b>.",
        ],
        when: "Revolve makes anything round: knobs, bottles, chess pieces, wheels.",
        check: (t) => t.feat("revolve").length >= 1,
      },
      {
        title: "Round the cap", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: ["Press <b>Home</b>. <b>Fillet</b>, click the cap's <b>top edge</b>, Size <b>1.5</b>, <b>OK</b>."],
        when: "The cap is what your fingers touch. Round it so it feels good.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      {
        title: "A plane for the first ring", tool: "Planes → Offset plane", icon: "planeOffset", show: { sel: "#ad-plane-off", via: "#ad-construct" }, anim: "plane",
        how: ["<b>Planes</b> ▾ → <b>Offset plane</b>. From <b>XY</b>, Distance <b>3.4</b>. <b>OK</b>."],
        when: "The base is 3 mm thick, so 3.4 leaves a 0.4 mm gap under the first ring. The gap is what lets parts that print together move apart.",
        check: (t) => t.planes().some((q) => near(q.plane.o[2], 3.4, 0.05)),
      },
      {
        title: "The first ring", tool: "Sketch on a plane → Two circles + Extrude (New body)", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "<b>Sketch</b> → pick <b>Plane 1</b> from the list. <b>Circle</b>: click the origin, type <b>60</b>, <b>Enter</b>. Click the origin again, type <b>16.8</b>, <b>Enter</b>.",
          "Press <b>E</b>, click the wide <b>ring</b> between the circles. Distance <b>18</b>, Operation <b>New body</b>. <b>OK</b>.",
        ],
        when: "The shaft is 16 mm; a 16.8 mm hole leaves 0.4 mm all round, enough for the ring to spin but not wobble.",
        check: (t) => sized(t, 60, 60, 18, 1),
      },
      {
        title: "Two more rings", tool: "Pattern (bodies, rectangular)", icon: "pattern", show: { sel: "#ad-pattern" },
        how: [
          "Click the ring to select it, then <b>Pattern</b>.",
          "Type <b>Rectangular</b>, Direction 1 <b>Z</b>, Count <b>3</b>, Spacing <b>18.4</b>. <b>OK</b>.",
          "Three rings now stack up the shaft, each 0.4 mm above the one below.",
        ],
        when: "Pattern copies whole bodies too. 18 mm ring + 0.4 mm gap = 18.4 mm spacing.",
        check: (t) => t.bodies().filter((b) => { const x = t.box(b.id); return x && near(x.size.x, 60, 1) && near(x.size.z, 18, 1); }).length >= 3,
      },
      {
        title: "A cone to shape them", tool: "Primitives → Cone", icon: "box", show: { sel: "#ad-cone", via: "#ad-prims" },
        how: [
          "<b>Primitives</b> ▾ → <b>Cone</b>, and click anywhere on the ground.",
          "Size: Width <b>64</b>, Depth <b>64</b>, Height <b>66</b>, Top ratio <b>0</b> (a point). Base position <b>X 0</b>, <b>Y 0</b>, <b>Z 3.4</b>. <b>OK</b>.",
          "The cone covers the rings. It's a tool: you'll use its shape and then it disappears.",
        ],
        when: "Primitives are ready-made shapes you size by typing. They're quick tools for shaping other bodies.",
        check: (t) => t.prim("cone").length >= 1 || t.hasCombine("intersect"),
      },
      {
        title: "Cut the rings to the cone", tool: "Advanced Modify → Combine (Intersect)", icon: "combine", show: { sel: "#ad-combine", via: "#ad-advmod" }, anim: "combine",
        how: [
          "Click an empty spot so nothing is selected. <b>Advanced Modify</b> ▾ → <b>Combine</b> (<b>B</b>). Click the <b>bottom ring</b> (Target), then the <b>cone</b> (Tool). Operation <b>Intersect</b>, tick <b>Keep tools</b>. <b>OK</b>. Only the part of the ring inside the cone is kept.",
          "Click an empty spot again, then do the same for the <b>middle ring</b> (Keep tools ticked).",
          "And (after another click on an empty spot) the <b>top ring</b>, this time with <b>Keep tools</b> <b>not</b> ticked, so the cone is used up.",
        ],
        when: "Intersect keeps only where two bodies overlap. It's a quick way to give several parts one shared outside shape.",
        tip: "If a ring is hidden inside the cone, click it in the Browser list on the left instead.",
        check: (t) => { let n = 0; for (const b of t.bodies()) for (const m of b.node.mods || []) if (m.t === "bool" && m.src === "combine" && m.op === "intersect") n++; return n >= 3 && t.prim("cone").length === 0; },
      },
      {
        title: "Look inside", tool: "Inspect → Section Analysis", icon: "section", show: { sel: "#ad-section" },
        how: [
          "Click <b>Section Analysis</b>. Under <b>…or use</b> click <b>XZ</b>. <b>OK</b>.",
          "The model is cut in half on screen. Zoom in: thin gaps separate each ring from the shaft, the base, the cap and the next ring. No gap, no spin.",
        ],
        when: "A section shows the inside of a design without changing it. Use it to check walls and gaps before you print.",
        tip: "To turn the cut off, click the × on the Section chip at the top of the view.",
        check: (t) => t.sectionOn(),
      },
      {
        title: "Watch it print", tool: "3D Print Sim → Layers", icon: "printsim", show: { sel: "#ws-print" }, anim: "printsim",
        how: [
          "Click the <b>3D Print Sim</b> tab. Click <b>Layers</b> and then <b>Play print</b>.",
          "Watch the rings build up around the shaft, each separated by its gap. Click <b>Design</b> when you're done.",
        ],
        when: "Print-in-place parts work only if the gaps really print as gaps. The layer view shows them.",
        check: (t) => { const p = t.psim(); return !!p && p.view === "layers"; },
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-robot", mode: "advanced", level: "Advanced", minutes: "24-28", item: "Robot",
    title: "Robot with plug-in arms",
    blurb: "A friendly robot: a rounded body with legs, a head with eyes, a mouth and an antenna, and two arms that plug into shoulder sockets with a clearance fit, so they swing. Three parts.",
    learn: ["Center rectangle", "Extrude", "Fillet all edges", "Sketch on a face", "Hole (depth)", "Pattern features", "Extrude cut", "Sphere and box primitives", "Combine (Join)", "Mirror (Join)", "Clearance fit", "Pattern (bodies)", "Deboss text"],
    steps: [
      nameStep("Robot", "Lopez, Maria, Robot"),
      {
        title: "The body", tool: "Sketch → Center rectangle + Extrude", icon: "rect", show: { sel: "#ad-sketch" }, anim: "rect",
        how: [
          "<b>Sketch</b> → <b>XY · Top</b>. <b>Rectangle</b> → <b>Center</b>, click the origin, type <b>40</b>, <b>Tab</b>, <b>30</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>50</b>, <b>OK</b>.",
        ],
        when: "Big shapes first.",
        check: (t) => sized(t, 40, 30, 50),
      },
      {
        title: "Round every edge", tool: "Fillet → Round all edges", icon: "fillet", show: { sel: "#ad-edge" },
        how: ["Press <b>Home</b>. <b>Fillet</b>, click <b>any edge</b> of the body, then click <b>Round all edges of the shape</b>. Size <b>3</b>. <b>OK</b>."],
        when: "One click picks all 12 edges: a quick way to make a part look soft and friendly.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      {
        title: "The head", tool: "Sketch on a face → Center rectangle + Extrude", icon: "rect", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "<b>Sketch</b>, click the body's <b>top face</b>. <b>Rectangle</b> → <b>Center</b>, click the middle (<b>0, 0</b>), type <b>28</b>, <b>Tab</b>, <b>20</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>24</b>. It joins. <b>OK</b>.",
        ],
        when: "Sketching on the top face stacks the head right on the body.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.max.z, 74, 1); }),
      },
      {
        title: "One eye", tool: "Hole (Depth)", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: ["<b>Hole</b>, click the head's <b>front face</b>. Position <b>X -7</b>, <b>Z 64</b>. <b>Diameter 6</b>. Extent <b>Depth</b>, <b>2</b>. <b>OK</b>."],
        when: "A shallow hole makes an eye socket. Typing the position puts it exactly where you want.",
        check: (t) => mods(t, "hole") >= 1,
      },
      {
        title: "The other eye", tool: "Pattern → Features", icon: "pattern", show: { sel: "#ad-pattern" },
        how: ["<b>Pattern</b> → <b>Features</b>, click the <b>inside wall</b> of the eye (or tick <b>Hole</b> in the list). <b>Rectangular</b>, Direction 1 <b>X</b>, Count <b>2</b>, Spacing <b>14</b>. <b>OK</b>."],
        when: "From X -7, a 14 mm step lands the copy at X +7: perfectly matched eyes.",
        check: (t) => mods(t, "hole") >= 2,
      },
      {
        title: "A mouth", tool: "Sketch on a face + Extrude (Cut)", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "cut",
        how: [
          "<b>Sketch</b>, click the head's <b>front face</b>. <b>Rectangle</b> → <b>Center</b>, click where the label says <b>0, 56</b>, type <b>12</b>, <b>Tab</b>, <b>3</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>-1.5</b>. It cuts. <b>OK</b>.",
        ],
        when: "A shallow cut (deboss) gives a face detail that prints without supports.",
        check: (t) => t.extrudeMod("cut"),
      },
      {
        title: "The antenna", tool: "Sketch on a face → Circle + Extrude", icon: "circle", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: ["<b>Sketch</b>, click the head's <b>top face</b>. <b>Circle</b> at the middle, <b>4</b>, <b>Enter</b>. Press <b>E</b>, Distance <b>10</b>. <b>OK</b>."],
        when: "Thin features: 4 mm across is about the thinnest post that prints sturdy.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.max.z, 84, 1); }),
      },
      {
        title: "A ball on top", tool: "Primitives → Sphere", icon: "box", show: { sel: "#ad-sphere", via: "#ad-prims" },
        how: [
          "<b>Primitives</b> ▾ → <b>Sphere</b>, click anywhere on the ground.",
          "Size <b>X 8</b>, <b>Y 8</b>, <b>Z 8</b>. Base position <b>X 0</b>, <b>Y 0</b>, <b>Z 82</b>. <b>OK</b>. The ball sits on the antenna's tip.",
        ],
        when: "Base position is where the bottom of the shape goes: typing it places parts exactly.",
        check: (t) => t.prim("sphere").length >= 1 || t.hasCombine("join"),
      },
      {
        title: "Join the ball on", tool: "Advanced Modify → Combine (Join)", icon: "combine", show: { sel: "#ad-combine", via: "#ad-advmod" }, anim: "combine",
        how: ["Click an empty spot. <b>Combine</b>: click the <b>robot</b>, then the <b>ball</b>. <b>Join</b>. <b>OK</b>."],
        when: "Combine Join turns separate bodies into one part.",
        check: (t) => t.hasCombine("join"),
      },
      {
        title: "Legs", tool: "Sketch on a face + Extrude (Cut)", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "cut",
        how: [
          "<b>Sketch</b>, click the body's <b>front face</b>. <b>Rectangle</b> → <b>Center</b>, click where the label says <b>0, 8</b>, type <b>8</b>, <b>Tab</b>, <b>16</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>-30</b> (right through the body). <b>OK</b>. A gap between two legs.",
        ],
        when: "Cutting all the way through (deeper than the part) makes an opening.",
        check: (t) => { let n = 0; for (const b of t.bodies()) for (const m of b.node.mods || []) if (m.t === "bool" && m.tool && m.tool.t === "extrude" && m.op === "cut") n++; return n >= 2; },
      },
      {
        title: "A shoulder socket", tool: "Hole (Depth)", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: ["Orbit so you can see the body's <b>right side</b>. <b>Hole</b>, click the right side. Position <b>Y 0</b>, <b>Z 40</b>. <b>Diameter 6.4</b>. Extent <b>Depth</b>, <b>8</b>. <b>OK</b>."],
        when: "The arm's peg will be 6 mm. A 6.4 mm socket leaves 0.2 mm all round: snug, but the arm can swing.",
        check: (t) => mods(t, "hole") >= 3,
      },
      {
        title: "The other socket", tool: "Mirror (Join)", icon: "mirror", show: { sel: "#ad-mirror", via: "#ad-features" }, anim: "mirror",
        how: ["<b>Advanced Create</b> ▾ → <b>Mirror</b>, click the robot. <b>…or use</b> <b>YZ</b>, Result <b>Join</b>. <b>OK</b>. The left side gets a socket too."],
        when: "The robot is the same on both sides, so mirroring it onto itself copies the socket to the left.",
        check: (t) => t.bodies().some((b) => (b.node.mods || []).some((m) => m.tool && m.tool.t === "mirror")),
      },
      {
        title: "An arm", tool: "Primitives → Box", icon: "box", show: { sel: "#ad-box", via: "#ad-prims" },
        how: ["<b>Primitives</b> ▾ → <b>Box</b>, click the ground. Width <b>8</b>, Depth <b>8</b>, Height <b>30</b>, Fillet all <b>2</b>. Base position <b>X 60</b>, <b>Y 0</b>, <b>Z 0</b>. <b>OK</b>."],
        when: "The arm stands up beside the robot. That's how it prints best: no overhangs.",
        check: (t) => sized(t, 8, 8, 30, 1) || t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.size.x, 8, 1) && near(x.size.z, 37.5, 1); }),
      },
      {
        title: "The arm's peg", tool: "Primitives → Cylinder + Combine (Join)", icon: "combine", show: { sel: "#ad-cyl", via: "#ad-prims" },
        how: [
          "<b>Primitives</b> ▾ → <b>Cylinder</b>, click the ground. Width <b>6</b>, Depth <b>6</b>, Height <b>7.5</b>. Base position <b>X 60</b>, <b>Y 0</b>, <b>Z 30</b>. <b>OK</b>.",
          "Click an empty spot. <b>Combine</b>: click the <b>arm</b>, then the <b>peg</b>. <b>Join</b>. <b>OK</b>.",
        ],
        when: "The peg is 7.5 mm long for an 8 mm deep socket, so it never bottoms out.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.size.x, 8, 1) && near(x.size.z, 37.5, 1); }),
      },
      {
        title: "The second arm", tool: "Pattern (bodies)", icon: "pattern", show: { sel: "#ad-pattern" },
        how: ["Click the arm. <b>Pattern</b>: <b>Rectangular</b>, Direction 1 <b>X</b>, Count <b>2</b>, Spacing <b>20</b>. <b>OK</b>."],
        when: "Both arms are the same, so one copy does it.",
        check: (t) => t.bodies().filter((b) => { const x = t.box(b.id); return x && near(x.size.x, 8, 1) && near(x.size.z, 37.5, 1); }).length >= 2,
      },
      {
        title: "A badge on the chest", tool: "Decorate → Emboss (Deboss)", icon: "emboss", show: { sel: "#ad-emboss", via: "#ad-decorate" },
        how: ["<b>Decorate</b> ▾ → <b>Emboss text</b>, click the body's front, above the legs. Text <b>BOT</b> (or your initials), Style <b>Deboss</b>, Letter height <b>8</b>, Depth <b>1</b>. <b>OK</b>."],
        when: "Deboss cuts the letters in, so nothing sticks out to snag.",
        check: (t) => mods(t, "emboss") >= 1,
      },
      saveStep(),
      exportStep(),
    ],
  },
  // ============================================================== EXPERT
  {
    id: "a-chain", mode: "advanced", level: "Expert", minutes: "24-28", item: "Link Bracelet",
    title: "Link bracelet that prints already linked",
    blurb: "Design one link with a pin at the front and a socket at the back, with exact gaps all round, then pattern it into a bracelet whose links hinge freely straight off the printer. Precise outlines, cuts, mirror, section checks and two-color printing.",
    learn: ["Line (12 typed segments)", "Extrude", "Sketch on the front plane", "Symmetric extrude (Join and Cut)", "Sketch on a side face", "Mirror (Join)", "Print-in-place clearance", "Pattern (bodies)", "Section Analysis", "3D Print Sim filaments"],
    steps: [
      nameStep("Link Bracelet", "Lopez, Maria, Link Bracelet"),
      {
        title: "Draw the link from above", tool: "Sketch → Line (typed)", icon: "line", show: { sel: "#ad-sketch" }, anim: "line",
        how: [
          "<b>Sketch</b> → <b>XY · Top</b>. Zoom in close to the origin. <b>Line</b>: click the point <b>0, -3</b> (just below the origin).",
          "Type each pair (length <b>Tab</b> angle <b>Enter</b>): <b>3.4, 0</b> · <b>5, 270</b> · <b>10.6, 0</b> · <b>4.6, 90</b> · <b>7, 180</b> · <b>6.8, 90</b> · <b>7, 0</b> · <b>4.6, 90</b> · <b>10.6, 180</b> · <b>5, 270</b> · <b>3.4, 180</b>.",
          "Click the first point to close it. You have a fork: a short neck at the left, a cross bar, and two prongs reaching to X 14.",
        ],
        when: "Every link is the same, so you design just one, carefully. The gap between the prongs (6.8 mm) is where the next link's socket will sit.",
        tip: "Made a wrong segment? Press Ctrl+Z while still drawing to step back one line.",
        check: (t) => t.sketches().some((s) => Math.abs(s.plane.n[2]) > 0.99 && s.ents.filter((e) => e.t === "line").length >= 12 && s.pts.some((q) => near(q.x, 14, 0.2) && near(q.y, 8, 0.2)) && s.pts.some((q) => near(q.x, 7, 0.2) && near(q.y, 3.4, 0.2))),
      },
      {
        title: "Give it thickness", tool: "Extrude", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" },
        how: ["Press <b>E</b>, Distance <b>4</b>, <b>OK</b>."],
        when: "4 mm is thick enough to be strong and thin enough to be comfortable on a wrist.",
        check: (t) => sized(t, 14, 16, 4, 0.6),
      },
      {
        title: "The socket", tool: "Sketch (XZ) → Circle + Symmetric extrude", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "<b>Sketch</b> → <b>XZ · Front</b>. <b>Circle</b>: click the point <b>0, 3</b>, type <b>6</b>, <b>Enter</b>.",
          "Press <b>E</b>. Direction <b>Symmetric</b>, Total distance <b>6</b>. It joins the neck. <b>OK</b>.",
        ],
        when: "The socket is a short round barrel lying on its side at the back of the link, 6 mm wide so it fits between the next link's prongs (6.8 mm apart).",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.min.x, -3, 0.3) && near(x.max.z, 6, 0.3); }),
      },
      {
        title: "Bore the socket", tool: "Sketch (XZ) → Circle + Extrude (Cut)", icon: "circle", show: { sel: "#ad-sketch" }, anim: "cut",
        how: [
          "<b>Sketch</b> → <b>XZ · Front</b>. <b>Circle</b>: click <b>0, 3</b> again, type <b>4</b>, <b>Enter</b>.",
          "Press <b>E</b>, <b>Symmetric</b>, Total distance <b>6.8</b>, Operation <b>Cut</b>. <b>OK</b>.",
        ],
        when: "The pin will be 3.2 mm. A 4 mm bore leaves 0.4 mm all round: the gap a printer needs so the parts don't fuse together.",
        check: (t) => t.extrudeMod("cut"),
      },
      {
        title: "Round the end of one prong", tool: "Sketch on a side face + Extrude", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "Press <b>Home</b>. <b>Sketch</b>, then click the link's long <b>front side face</b> (the side of the front prong, facing you).",
          "<b>Circle</b>: click where the label says <b>14, 3</b> (at the prong's end, 3 mm up: half of the circle sticks out past the corner, which is fine). Type <b>6</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>-4.6</b> (into the prong, as thick as it is), Operation <b>Join</b>. <b>OK</b>.",
        ],
        when: "A round prong end can swing around the next socket without hitting it. Join (not Automatic) because pushing into a body would otherwise cut it.",
        check: (t) => joins(t) >= 2,
      },
      {
        title: "Mirror it to the other prong", tool: "Mirror (Join)", icon: "mirror", show: { sel: "#ad-mirror", via: "#ad-features" }, anim: "mirror",
        how: ["<b>Advanced Create</b> ▾ → <b>Mirror</b>, click the link. <b>…or use</b> <b>XZ</b> (front to back), Result <b>Join</b>. <b>OK</b>."],
        when: "The link is symmetric front to back, so mirroring across XZ adds the second rounded end exactly.",
        check: (t) => t.bodies().some((b) => (b.node.mods || []).some((m) => m.tool && m.tool.t === "mirror")),
      },
      {
        title: "The pin", tool: "Sketch (XZ) → Circle + Symmetric extrude", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "<b>Sketch</b> → <b>XZ · Front</b>. <b>Circle</b>: click <b>14, 3</b>, type <b>3.2</b>, <b>Enter</b>.",
          "Press <b>E</b>, <b>Symmetric</b>, Total distance <b>16</b>. It joins, bridging the two prongs. <b>OK</b>.",
        ],
        when: "The pin passes through the gap between the prongs, exactly where the next link's socket will be.",
        check: (t) => joins(t) >= 3,
      },
      {
        title: "Check the gaps in a section", tool: "Inspect → Section Analysis", icon: "section", show: { sel: "#ad-section" },
        how: [
          "<b>Section Analysis</b> → <b>…or use</b> <b>XZ</b>. <b>OK</b>.",
          "Zoom in on the socket: a ring of empty space surrounds where the next pin will go. Click the <b>×</b> on the Section chip to turn it off.",
        ],
        when: "Measure twice, print once: check the parts that must move apart, on screen, first.",
        check: (t) => t.sectionOn(),
      },
      {
        title: "Make the bracelet", tool: "Pattern (bodies, rectangular)", icon: "pattern", show: { sel: "#ad-pattern" },
        how: [
          "Click the link to select it. <b>Pattern</b>: <b>Rectangular</b>, Direction 1 <b>X</b>, Count <b>12</b>, Spacing <b>14</b>. <b>OK</b>.",
          "Each copy's socket lands around the previous link's pin. Zoom in: they're linked, yet never touch.",
        ],
        when: "The spacing equals the distance from socket to pin (14 mm): that's what links them. 12 links make about 17 cm, a typical wrist.",
        check: (t) => t.bodies().length >= 12,
      },
      {
        title: "Two colors", tool: "3D Print Sim → Filaments", icon: "printsim", show: { sel: "#ws-print" }, anim: "printsim",
        how: [
          "Click an empty spot so nothing is selected (then every link goes on the plate). Click the <b>3D Print Sim</b> tab. In <b>On the plate</b>, set every other link to <b>F2</b> with the little filament menu next to its name.",
          "Click <b>Layers</b>, then <b>Play print</b>, to watch the links build up together, pins inside sockets.",
        ],
        when: "On a printer with more than one filament (an AMS, or several nozzles), each body can print in its own color.",
        tip: "The red Support needed warning is about the round undersides of the barrels and pins. Print-in-place links are printed without supports (supports would glue them together); small curves like these print fine.",
        check: (t) => { const p = t.psim(); return !!p && new Set([...p.slotOf.values()]).size >= 2; },
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-car", mode: "advanced", level: "Expert", minutes: "26-28", item: "Toy Car",
    title: "Toy car with spinning wheels",
    blurb: "A car body drawn as a side outline, with see-through windows and axle holes, two axles that spin freely in their holes, and four textured wheels that press onto the axles. Seven parts, laid out and oriented for printing.",
    learn: ["Line (typed slopes)", "Symmetric extrude", "Fillet all", "Sketch on a face + cut through", "Hole + Pattern features", "Clearance fit and press fit", "New bodies", "Offset plane", "Two-circle profile", "Texture", "Pattern (two directions)", "Move/Copy", "3D Print Sim objects"],
    steps: [
      nameStep("Toy Car", "Lopez, Maria, Toy Car"),
      {
        title: "The car's side outline", tool: "Sketch (XZ) → Line (typed)", icon: "line", show: { sel: "#ad-sketch" }, anim: "line",
        how: [
          "<b>Sketch</b> → <b>XZ · Front</b>. Zoom in near the left end of the red X axis until the label by the pointer can show <b>-50, 6</b> (not just steps of 5). <b>Line</b>: click the point <b>-50, 6</b>.",
          "Type each pair (length <b>Tab</b> angle <b>Enter</b>): <b>100, 0</b> · <b>20, 90</b> · <b>20, 180</b> · <b>21.93, 133.15</b> · <b>35, 180</b> · <b>21.93, 226.85</b> · <b>15, 180</b>.",
          "Click the first point to close it: a car seen from the side, hood at the right, trunk at the left, sitting 6 mm off the ground.",
        ],
        when: "Many objects are easiest to draw from the side: their outline, then pulled to their width.",
        tip: "21.93 is the length of each windshield slope: √(15² + 16²).",
        check: (t) => xzSketches(t).some((s) => s.ents.filter((e) => e.t === "line").length >= 8 && hasPt(s, 15, 42, 0.3) && hasPt(s, -20, 42, 0.3)),
      },
      {
        title: "Give it width", tool: "Extrude (Symmetric)", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" },
        how: ["Press <b>E</b>, <b>Symmetric</b>, Total distance <b>40</b>, <b>OK</b>."],
        when: "Symmetric keeps the car centered on the XZ plane, so the left and right sides match.",
        check: (t) => sized(t, 100, 40, 36, 1),
      },
      {
        title: "Soften every edge", tool: "Fillet → Round all edges", icon: "fillet", show: { sel: "#ad-edge" },
        how: ["Press <b>Home</b>. <b>Fillet</b>, click any edge of the car, <b>Round all edges of the shape</b>, Size <b>2</b>, <b>OK</b>."],
        when: "Rounded edges make a toy safe to hold and look molded.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      {
        title: "See-through windows", tool: "Sketch on a face → Center rectangle + Extrude (Cut)", icon: "rect", show: { sel: "#ad-sketch" }, anim: "cut",
        how: [
          "<b>Sketch</b>, click the car's <b>side</b> facing you. <b>Rectangle</b> → <b>Center</b>: zoom in a little and click where the label says <b>-3, 34</b>, type <b>22</b>, <b>Tab</b>, <b>8</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>-40</b> (right through the car). <b>OK</b>. A window on both sides.",
        ],
        when: "Cutting deeper than the part goes through both walls at once.",
        check: (t) => t.extrudeMod("cut"),
      },
      {
        title: "Axle holes", tool: "Hole + Pattern → Features", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: [
          "<b>Hole</b>, click the car's side near the back. Position <b>X -32</b>, <b>Z 10</b>. <b>Diameter 4.6</b>, Extent <b>Through all</b>. <b>OK</b>.",
          "<b>Pattern</b> → <b>Features</b>, click the inside wall of that hole (or tick <b>Hole</b> in the list). <b>Rectangular</b>, Direction 1 <b>X</b>, Count <b>2</b>, Spacing <b>64</b>. <b>OK</b>. Now there's a hole at the front wheel too.",
        ],
        when: "The axles will be 4 mm. 4.6 mm holes leave 0.3 mm all round, so the axles spin freely.",
        check: (t) => mods(t, "hole") >= 2,
      },
      {
        title: "An axle", tool: "Sketch (XZ) → Circle + Symmetric extrude (New body)", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "<b>Sketch</b> → <b>XZ · Front</b>. <b>Circle</b>: click <b>-32, 10</b> (in the back hole), type <b>4</b>, <b>Enter</b>.",
          "Press <b>E</b>, <b>Symmetric</b>, Total distance <b>56</b>, Operation <b>New body</b>. <b>OK</b>. The axle pokes 8 mm out of each side.",
        ],
        when: "New body keeps the axle separate, so it can turn in the car.",
        check: (t) => sized(t, 4, 56, 4, 0.6),
      },
      {
        title: "A plane for the wheels", tool: "Planes → Offset plane", icon: "planeOffset", show: { sel: "#ad-plane-off", via: "#ad-construct" }, anim: "plane",
        how: ["<b>Planes</b> ▾ → <b>Offset plane</b>. From <b>XZ</b>, Distance <b>22</b>. <b>OK</b>. It's 2 mm in front of the car's side."],
        when: "The wheels start 2 mm away from the car so they never rub on it.",
        check: (t) => t.planes().some((q) => near(Math.abs(q.plane.o[1]), 22, 0.05)),
      },
      {
        title: "A wheel", tool: "Sketch on a plane → Two circles + Extrude (New body)", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "<b>Sketch</b> → pick <b>Plane 1</b>. <b>Circle</b>: click <b>-32, 10</b>, type <b>20</b>, <b>Enter</b>. Click <b>-32, 10</b> again, type <b>3.8</b>, <b>Enter</b>.",
          "Press <b>E</b>, click the <b>ring</b>, Distance <b>6</b> (outward, away from the car), Operation <b>New body</b>. <b>OK</b>.",
        ],
        when: "A 3.8 mm hole on a 4 mm axle is a press fit: tight enough that the wheel turns with the axle and doesn't fall off.",
        check: (t) => sized(t, 20, 6, 20, 0.8),
      },
      {
        title: "Tread on the tire", tool: "Decorate → Texture", icon: "texture", show: { sel: "#ad-texture", via: "#ad-decorate" }, anim: "texture",
        how: [
          "<b>Decorate</b> ▾ → <b>Texture</b>. Click the wheel's <b>round outside</b> (the tire).",
          "Pick <b>Chevron tread</b>. Tile size <b>3</b>, Depth <b>0.6</b>. <b>OK</b>.",
        ],
        when: "A texture is real shape on the surface, not just a color: this tread will be felt and printed.",
        check: (t) => t.bodies().some((b) => (b.textures || []).length > 0),
      },
      {
        title: "Four wheels and two axles", tool: "Pattern (bodies, two directions)", icon: "pattern", show: { sel: "#ad-pattern" },
        how: [
          "Click the <b>wheel</b>. <b>Pattern</b>: <b>Rectangular</b>, Direction 1 <b>X</b>, Count <b>2</b>, Spacing <b>64</b>. Direction 2 <b>Y</b>, Count <b>2</b>, Spacing <b>50</b>. <b>OK</b>. Four wheels!",
          "Click the <b>axle</b>. <b>Pattern</b>: Direction 1 <b>X</b>, Count <b>2</b>, Spacing <b>64</b> (Direction 2 Count <b>1</b>). <b>OK</b>.",
        ],
        when: "Two directions make a grid of copies: 2 along X (front and back) × 2 along Y (left and right). The wheel at Y -28 to -22 lands at Y 22 to 28 after a 50 mm step. Copies carry everything, tread included.",
        check: (t) => t.bodies().filter((b) => (b.textures || []).length > 0).length >= 4 && t.bodies().filter((b) => { const x = t.box(b.id); return x && near(x.size.y, 56, 0.6) && near(x.size.x, 4, 0.6); }).length >= 2,
      },
      {
        title: "Spread the parts out", tool: "Transform → Move/Copy", icon: "move", show: { sel: "#ad-move", via: "#ad-transform" },
        how: [
          "Click an empty spot. Click the <b>four wheels</b> (hold <b>Shift</b> to add each one). <b>Move/Copy</b>: <b>Y -70</b>. <b>OK</b>.",
          "Click the <b>two axles</b> (Shift). <b>Move/Copy</b>: <b>X 90</b>. <b>OK</b>.",
        ],
        when: "Parts print separately, and separate parts must not touch on the plate. You'll assemble them after printing.",
        check: (t) => t.bodies().filter((b) => { const x = t.box(b.id); return x && x.max.y < -40; }).length >= 4,
      },
      {
        title: "Lay the wheels flat", tool: "3D Print Sim → Objects", icon: "printsim", show: { sel: "#ws-print" }, anim: "printsim",
        how: [
          "Click an empty spot, then the <b>3D Print Sim</b> tab.",
          "Click a wheel, <b>Shift-click</b> the other three. Turn <b>90</b>, click <b>X</b>: they lie flat. Click <b>Arrange</b>.",
        ],
        when: "Wheels print best lying flat, like coins: round on every layer. These turns are only for printing; the design is unchanged.",
        tip: "The red warning is about the car's rounded bottom edge and the tops of the windows: small curves and short bridges that print fine without supports.",
        check: (t) => t.psimArranged(),
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-enclosure", mode: "advanced", level: "Expert", minutes: "26-28", item: "Electronics Case",
    title: "Electronics case with a screw-on lid",
    blurb: "A real project box: rounded corners, four screw bosses for heat-set inserts, a USB opening and cooling vents, and a lid made from the case's own outline, with countersunk holes. Drop a real M3 screw from the parts library in to check the fit, then lay the parts out to print.",
    learn: ["Fillet", "Shell", "Pattern features in two directions", "Hole (depth, countersink)", "Heat-set insert sizes", "Extrude cut", "A face's outline as a profile", "New body", "Fasteners library", "Section Analysis", "Deboss text", "Move/Copy"],
    steps: [
      nameStep("Electronics Case", "Lopez, Maria, Electronics Case"),
      {
        title: "The case", tool: "Sketch → Center rectangle + Extrude", icon: "rect", show: { sel: "#ad-sketch" }, anim: "rect",
        how: ["<b>Sketch</b> → <b>XY · Top</b>. <b>Rectangle</b> → <b>Center</b>, click the origin, <b>70</b>, <b>Tab</b>, <b>50</b>, <b>Enter</b>. Press <b>E</b>, Distance <b>25</b>, <b>OK</b>."],
        when: "Measure your board first: this case fits a board up to about 60 × 40 mm.",
        check: (t) => sized(t, 70, 50, 25),
      },
      {
        title: "Round the corners", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "Press <b>Home</b>. <b>Fillet</b>, then click the <b>4 upright corner edges</b> (click BACK on the view cube to reach the back two; the panel keeps your picks).",
          "Size <b>5</b>. <b>OK</b>.",
        ],
        when: "Round the outside before the shell, so the walls follow the curves.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      {
        title: "Hollow it, open at the top", tool: "Shell", icon: "shell", show: { sel: "#ad-shell" },
        how: ["Press <b>Home</b>. <b>Shell</b> (Type <b>Openings</b>), click the <b>top face</b>, Thickness <b>2</b>, <b>Inside</b>. <b>OK</b>."],
        when: "2 mm walls are stiff enough for a small case.",
        check: (t) => mods(t, "shell") >= 1,
      },
      {
        title: "A screw boss", tool: "Sketch → Circle + Extrude (Join)", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "<b>Sketch</b> → <b>XY · Top</b> (the ground, under the case).",
          "<b>Circle</b>: click where the label says <b>-28, -18</b> (near the front-left inside corner), type <b>7</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>25</b> (up to the rim), Operation <b>Join</b>. <b>OK</b>.",
        ],
        when: "A boss is a post a screw goes into. Starting from the ground, it overlaps the case's floor, and Join makes it part of the case. It reaches the rim, so the lid will rest on it.",
        check: (t) => joins(t) >= 1,
      },
      {
        title: "Four bosses", tool: "Pattern → Features (two directions)", icon: "pattern", show: { sel: "#ad-pattern" },
        how: [
          "<b>Pattern</b> → <b>Features</b>, click the boss (or tick <b>Extrude join</b> in the list).",
          "<b>Rectangular</b>: Direction 1 <b>X</b>, Count <b>2</b>, Spacing <b>56</b>. Direction 2 <b>Y</b>, Count <b>2</b>, Spacing <b>36</b>. <b>OK</b>.",
        ],
        when: "A feature pattern in two directions puts a boss in every corner, all exactly the same.",
        check: (t) => joins(t) >= 4,
      },
      {
        title: "Holes for heat-set inserts", tool: "Hole (Depth) + Pattern features", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: [
          "<b>Hole</b>, click the <b>top</b> of the front-left boss. Position <b>X -28</b>, <b>Y -18</b>. <b>Diameter 4</b>, Extent <b>Depth</b>, <b>6</b>. <b>OK</b>.",
          "<b>Pattern</b> → <b>Features</b>, tick the <b>Hole</b>, and use the same 2 × 2 pattern (X 56, Y 36). <b>OK</b>.",
        ],
        when: "A heat-set insert is a little brass nut you press in with a hot soldering iron: printed threads wear out, brass ones don't. M3 inserts need a hole about 4 mm wide.",
        check: (t) => mods(t, "hole") >= 4,
      },
      {
        title: "The USB opening", tool: "Sketch on a face + Extrude (Cut)", icon: "rect", show: { sel: "#ad-sketch" }, anim: "cut",
        how: [
          "Press <b>Home</b>. <b>Sketch</b>, click the case's <b>front</b> outside face. <b>Rectangle</b> → <b>Center</b>, click where the label says <b>0, 10</b>, type <b>12</b>, <b>Tab</b>, <b>6</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>-5</b>. It cuts through the front wall. <b>OK</b>.",
        ],
        when: "Openings for plugs need about 1 mm extra on each side of the plug.",
        check: (t) => t.extrudeMod("cut"),
      },
      {
        title: "Cooling vents", tool: "Sketch on a face + Cut + Pattern features", icon: "pattern", show: { sel: "#ad-sketch" },
        how: [
          "Orbit so you see the case's <b>right side</b>. <b>Sketch</b>, click it. <b>Rectangle</b> → <b>Center</b>, click where the label says <b>-12, 14</b>, type <b>3</b>, <b>Tab</b>, <b>12</b>, <b>Enter</b>. Press <b>E</b>, Distance <b>-5</b>, <b>OK</b>.",
          "<b>Pattern</b> → <b>Features</b>, tick the newest <b>Extrude cut</b> (the slot). <b>Rectangular</b>, Direction 1 <b>Y</b>, Count <b>5</b>, Spacing <b>6</b>. <b>OK</b>.",
        ],
        when: "Electronics get warm. Tall, thin slots let air through but keep fingers out.",
        check: (t) => { let n = 0; for (const b of t.bodies()) for (const m of b.node.mods || []) if (m.t === "bool" && m.tool && m.tool.t === "extrude" && m.op === "cut") n++; return n >= 6; },
      },
      {
        title: "A lid from the case's own outline", tool: "Sketch on a face → Extrude (New body)", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "Press <b>Home</b>. <b>Sketch</b>, click the <b>top of the case's rim</b>. Don't draw anything: the rim's outline is already in the sketch.",
          "Press <b>E</b>. Click the <b>rim</b> and then the big <b>area inside it</b>, so both are blue.",
          "Distance <b>2.5</b>, Operation <b>New body</b>. <b>OK</b>. A lid exactly the shape of the case sits on top, with four small holes right above the inserts.",
        ],
        when: "Every face sketch includes that face's outline, holes and all. Extruding it makes a part that matches perfectly: rounded corners, and holes that line up with the bosses below.",
        check: (t) => sized(t, 70, 50, 2.5, 0.6),
      },
      {
        title: "Countersink the lid's holes", tool: "Hole (Countersink) + Pattern features", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: [
          "<b>Hole</b>, click the lid's top. Hole type <b>Countersink</b>, Screw size <b>M3</b>. Position <b>X -28</b>, <b>Y -18</b> (right on the front-left hole). <b>OK</b>.",
          "With the lid selected, <b>Pattern</b> → <b>Features</b>: tick <b>Countersunk hole</b>, 2 × 2 again (X <b>56</b>, Y <b>36</b>). <b>OK</b>.",
        ],
        when: "A countersink is a cone at the top of a hole, so a flat-head screw sits flush with the surface.",
        check: (t) => t.bodies().some((b) => (b.node.mods || []).filter((m) => m.t === "hole" && m.kind === "csink").length >= 1) && mods(t, "hole") >= 8,
      },
      {
        title: "Drop in a real screw", tool: "Fasteners (parts library)", icon: "thread", show: { sel: "#ad-fastbtn" },
        how: [
          "Click <b>Fasteners</b> (right end of the toolbar).",
          "Part <b>Flat head (countersunk) screw</b>, Standard <b>Metric</b>, Size <b>M3</b>, Length <b>8 mm</b>.",
          "Point at one of the lid's holes: the screw drops in, lined up with it. Click, then <b>OK</b>.",
        ],
        when: "Library parts are true to size. A real screw in your hole shows at once if the countersink and length are right.",
        check: (t) => t.bodies().some((b) => b.fastener),
      },
      {
        title: "Check the screw in a section", tool: "Inspect → Section Analysis", icon: "section", show: { sel: "#ad-section" },
        how: [
          "<b>Section Analysis</b> → <b>…or use</b> <b>XZ</b>, Distance <b>-18</b> (through the front screws). <b>OK</b>.",
          "Zoom in: the head sits flush in the countersink and the screw reaches down into the insert hole. Click the <b>×</b> on the Section chip when you're done.",
        ],
        when: "A section shows how parts meet inside, where you can't otherwise look.",
        check: (t) => t.sectionOn(),
      },
      {
        title: "Your name on the lid", tool: "Decorate → Emboss (Deboss)", icon: "emboss", show: { sel: "#ad-emboss", via: "#ad-decorate" },
        how: ["<b>Emboss text</b>, click the lid's top between the holes. Your <b>name</b>, Style <b>Deboss</b>, Letter height <b>8</b>, Depth <b>0.6</b>. <b>OK</b>."],
        when: "A shallow deboss stays crisp and doesn't catch on anything.",
        check: (t) => mods(t, "emboss") >= 1,
      },
      {
        title: "Lay out for printing", tool: "Delete + Transform → Move/Copy", icon: "move", show: { sel: "#ad-move", via: "#ad-transform" },
        how: [
          "Click the <b>screw</b> and press <b>Delete</b>: it was there to check the fit (you'll buy real ones). Only the parts you print go in the STL.",
          "Click the <b>lid</b>. <b>Move/Copy</b>: <b>X 90</b>, <b>Z -25</b>. <b>OK</b>. It lies on the plate beside the case, top up, so the countersinks print cleanly.",
        ],
        when: "Parts that print separately must sit on the plate (Z 0) and not touch each other.",
        check: (t) => !t.bodies().some((b) => b.fastener) && t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.size.z, 2.5, 0.8) && x.min.z < 1 && x.center.x > 60; }),
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-royals", mode: "advanced", level: "Expert", minutes: "24-28", item: "Chess King and Queen",
    title: "Chess king and queen",
    blurb: "Two classic chess pieces from long typed outlines: a king with a cross and a queen with a crown of balls. Each gets a pocket underneath for a coin, so it stands heavy and steady, and a tiny chamfer so its base prints crisp.",
    learn: ["Line (long typed outlines)", "Revolve", "Symmetric extrude", "Hole (pocket)", "Move/Copy", "Sphere primitive", "Circular pattern (bodies, joined)", "Combine (Join)", "Chamfer", "3D Print Sim filaments"],
    steps: [
      nameStep("Chess King and Queen", "Lopez, Maria, Chess King and Queen"),
      {
        title: "Half of the king", tool: "Sketch (XZ) → Line (typed)", icon: "line", show: { sel: "#ad-sketch" }, anim: "line",
        how: [
          "<b>Sketch</b> → <b>XZ · Front</b>. <b>Line</b>, click the <b>origin</b>.",
          "Type each pair (length <b>Tab</b> angle <b>Enter</b>): <b>16, 0</b> · <b>3, 90</b> · <b>3, 180</b> · <b>2, 90</b> · <b>25.71, 103.5</b> · <b>4.47, 26.57</b> · <b>3, 90</b> · <b>3, 180</b> · <b>13.15, 81.25</b> · <b>3, 90</b> · <b>10, 180</b>.",
          "Click the origin to close it: a base, a tapering stem, a collar and a flared top.",
        ],
        when: "Chess pieces are turned shapes, so you draw half the outline and spin it. Slanted lines are typed as a length and an angle.",
        check: (t) => xzSketches(t).some((s) => s.ents.filter((e) => e.t === "line").length >= 12 && hasPt(s, 10, 51, 0.3) && hasPt(s, 8, 35, 0.3)),
      },
      {
        title: "Spin up the king", tool: "Revolve", icon: "revolve", show: { sel: "#ad-revolve", via: "#ad-features" }, anim: "revolve",
        how: ["<b>Finish sketch</b>. <b>Advanced Create</b> ▾ → <b>Revolve</b>, click inside the outline, <b>…or use</b> <b>Z axis</b>, <b>OK</b>."],
        when: "Revolve spins the outline all the way round the Z axis.",
        check: (t) => t.feat("revolve").length >= 1,
      },
      {
        title: "Draw the cross", tool: "Sketch (XZ) → Line (typed)", icon: "line", show: { sel: "#ad-sketch" }, anim: "line",
        how: [
          "<b>Sketch</b> → <b>XZ · Front</b>. Zoom in on the top of the king. <b>Line</b>: click the point <b>-3, 48</b> (a little below the top, so the cross sinks into the king).",
          "Type: <b>10, 90</b> · <b>4, 180</b> · <b>5, 90</b> · <b>4, 0</b> · <b>6, 90</b> · <b>6, 0</b> · <b>6, 270</b> · <b>4, 0</b> · <b>5, 270</b> · <b>4, 180</b> · <b>10, 270</b>.",
          "Click the first point to close the cross.",
        ],
        when: "One closed outline makes one clean profile, even for a shape with arms. Starting 3 mm inside the king's top makes the two overlap, so they join into one solid piece.",
        check: (t) => xzSketches(t).some((s) => s.ents.filter((e) => e.t === "line").length >= 12 && hasPt(s, -7, 63, 0.3) && hasPt(s, 3, 69, 0.3)),
      },
      {
        title: "Give the cross thickness", tool: "Extrude (Symmetric)", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" },
        how: ["Press <b>E</b>, <b>Symmetric</b>, Total distance <b>6</b>. It joins the king. <b>OK</b>."],
        when: "Symmetric keeps the cross centered on the piece.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.max.z, 69, 0.6); }),
      },
      {
        title: "A coin pocket in the king", tool: "Hole (Depth)", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: [
          "Drag the view cube up to look from <b>below</b>. <b>Hole</b>, click the king's <b>bottom</b>. Position <b>X 0</b>, <b>Y 0</b>. <b>Diameter 24.6</b>, Extent <b>Depth</b>, <b>2</b>. <b>OK</b>. Press <b>Home</b>.",
        ],
        when: "A coin (a US quarter is 24.3 mm across) glued in the pocket makes the piece heavy, like a store-bought set. A 0.3 mm larger hole lets it drop in.",
        check: (t) => mods(t, "hole") >= 1,
      },
      {
        title: "Move the king aside", tool: "Transform → Move/Copy", icon: "move", show: { sel: "#ad-move", via: "#ad-transform" },
        how: ["Click the king. <b>Move/Copy</b>: <b>X -45</b>. <b>OK</b>."],
        when: "The queen is spun around the same Z axis, so the king moves out of the way first.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.max.z, 69, 0.6) && x.center.x < -30; }),
      },
      {
        title: "Half of the queen", tool: "Sketch (XZ) → Line (typed)", icon: "line", show: { sel: "#ad-sketch" }, anim: "line",
        how: [
          "<b>Sketch</b> → <b>XZ · Front</b>. <b>Line</b>, click the <b>origin</b>.",
          "Type: <b>16, 0</b> · <b>3, 90</b> · <b>3, 180</b> · <b>2, 90</b> · <b>31.78, 102.72</b> · <b>5, 36.87</b> · <b>3, 90</b> · <b>3, 180</b> · <b>12.37, 75.96</b> · <b>10, 180</b>.",
          "Click the origin to close it. (If the origin is hidden behind the timeline, pan the view up first: drag with the middle mouse button, or Shift + right-drag.)",
        ],
        when: "The queen is a little taller and slimmer than the king, with a cup-shaped top for her crown.",
        check: (t) => xzSketches(t).some((s) => s.ents.filter((e) => e.t === "line").length >= 11 && hasPt(s, 10, 54, 0.3)),
      },
      {
        title: "Spin up the queen", tool: "Revolve", icon: "revolve", show: { sel: "#ad-revolve", via: "#ad-features" }, anim: "revolve",
        how: ["<b>Finish sketch</b>. <b>Revolve</b>, click inside the outline, <b>Z axis</b>, <b>OK</b>."],
        when: "Same tool, new outline: a whole new piece.",
        check: (t) => t.feat("revolve").length >= 2,
      },
      {
        title: "One ball of the crown", tool: "Primitives → Sphere", icon: "box", show: { sel: "#ad-sphere", via: "#ad-prims" },
        how: ["<b>Primitives</b> ▾ → <b>Sphere</b>, click the ground. Size <b>6</b>, <b>6</b>, <b>6</b>. Base position <b>X 8.5</b>, <b>Y 0</b>, <b>Z 52</b>. <b>OK</b>. It sits on the rim of the queen's top."],
        when: "Typed positions put small parts exactly where they belong.",
        check: (t) => t.prim("sphere").length >= 1 || t.hasCombine("join"),
      },
      {
        title: "A ring of balls", tool: "Pattern (circular, joined)", icon: "pattern", show: { sel: "#ad-pattern" }, anim: "pattern",
        how: [
          "Click the ball. <b>Pattern</b>: <b>Circular</b>, Axis <b>Z</b>, Through <b>Origin</b>, Count <b>8</b>, Total angle <b>360</b>.",
          "Tick <b>Join copies into one body</b>. <b>OK</b>.",
        ],
        when: "A circular pattern copies around an axis: eight balls evenly round the crown, joined as one part.",
        check: (t) => t.groups().length >= 1 || t.hasCombine("join"),
      },
      {
        title: "Crown the queen", tool: "Advanced Modify → Combine (Join)", icon: "combine", show: { sel: "#ad-combine", via: "#ad-advmod" }, anim: "combine",
        how: ["Click an empty spot. <b>Combine</b>: click the <b>queen</b>, then the <b>crown</b>. <b>Join</b>. <b>OK</b>."],
        when: "Now the crown is part of the queen.",
        check: (t) => t.hasCombine("join"),
      },
      {
        title: "A coin pocket in the queen", tool: "Hole (Depth)", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: ["Look from <b>below</b> again. <b>Hole</b>, click the queen's bottom. <b>X 0</b>, <b>Y 0</b>, <b>Diameter 24.6</b>, <b>Depth 2</b>. <b>OK</b>. Press <b>Home</b>."],
        when: "Both pieces the same weight feels right in the hand.",
        check: (t) => mods(t, "hole") >= 2,
      },
      {
        title: "Crisp bottom edges", tool: "Chamfer", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "Press <b>C</b> (Chamfer). Click the <b>bottom outside edge</b> of the king. Distance <b>0.5</b>. <b>OK</b>.",
          "Do the same for the queen.",
        ],
        when: "The first layers of a print squash out a little (\"elephant's foot\"). A tiny chamfer at the bottom hides it.",
        check: (t) => mods(t, "chamfer") >= 2,
      },
      {
        title: "Black and white", tool: "3D Print Sim → Filaments", icon: "printsim", show: { sel: "#ws-print" }, anim: "printsim",
        how: [
          "Click an empty spot, then the <b>3D Print Sim</b> tab. Set the king to <b>F1</b> and the queen to <b>F2</b> with the filament menus, and pick white and black (click a filament's color square to change it).",
          "Or print them on separate days in one color each.",
        ],
        when: "One print, two colors: the printer swaps filament between the pieces.",
        check: (t) => { const p = t.psim(); return !!p && new Set([...p.slotOf.values()]).size >= 2; },
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-spiralcone", mode: "advanced", level: "Expert", minutes: "24-28", item: "Spiral Fidget Cone",
    title: "Spiral fidget cone that spins on a base",
    blurb: "The classic spiral cone, made the way CAD pros do it: a revolved cone, one twisted sweep cut that spirals all the way round, and a circular pattern of that cut. Then a pin-and-socket base so it spins like a top. Two parts.",
    learn: ["Line (typed)", "Revolve", "Fillet", "Sketch a path and a profile", "Sweep (Cut, with twist)", "Pattern features (circular)", "Hole (depth)", "Clearance fit", "Chamfer", "3D Print Sim layers"],
    steps: [
      nameStep("Spiral Fidget Cone", "Lopez, Maria, Spiral Fidget Cone"),
      {
        title: "Half of the cone", tool: "Sketch (XZ) → Line (typed)", icon: "line", show: { sel: "#ad-sketch" }, anim: "line",
        how: [
          "<b>Sketch</b> → <b>XZ · Front</b>. <b>Line</b>, click the <b>origin</b>.",
          "Type: <b>20, 0</b> · <b>52.2, 106.7</b> · <b>5, 180</b>. Click the origin to close it.",
          "<b>Finish sketch</b>.",
        ],
        when: "A cone 40 mm across at the bottom, 10 mm across at the top and 50 mm tall, drawn as half its outline.",
        check: (t) => xzSketches(t).some((s) => s.ents.filter((e) => e.t === "line").length >= 4 && hasPt(s, 5, 50, 0.3)),
      },
      {
        title: "Spin it into a cone", tool: "Revolve", icon: "revolve", show: { sel: "#ad-revolve", via: "#ad-features" }, anim: "revolve",
        how: ["<b>Advanced Create</b> ▾ → <b>Revolve</b>, click inside the outline, <b>…or use</b> <b>Z axis</b>, <b>OK</b>."],
        when: "Revolve makes the cone exactly round.",
        check: (t) => t.feat("revolve").length >= 1,
      },
      {
        title: "The path: straight up the middle", tool: "Sketch (XZ) → Line", icon: "line", show: { sel: "#ad-sketch" }, anim: "line",
        how: [
          "<b>Sketch</b> → <b>XZ · Front</b>. <b>Line</b>, click the <b>origin</b>, type <b>50</b>, <b>Tab</b>, <b>90</b>, <b>Enter</b>. Press <b>Esc</b>, then <b>Finish sketch</b>.",
        ],
        when: "A sweep moves a shape along a path. This path runs up the cone's center, so the twist will turn the shape around the center.",
        check: (t) => xzSketches(t).some((s) => s.ents.filter((e) => e.t === "line").length === 1 && hasPt(s, 0, 50, 0.3)),
      },
      {
        title: "The shape to cut", tool: "Sketch (XY) → Circle", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "<b>Sketch</b> → <b>XY · Top</b> (the ground, under the cone). <b>Circle</b>: click where the label says <b>12, 0</b>, type <b>8</b>, <b>Enter</b>. <b>Finish sketch</b>.",
        ],
        when: "The profile sits where the path starts (at the bottom). Off to one side of the path, it will spiral around it.",
        check: (t) => t.sketches().some((s) => Math.abs(s.plane.n[2]) > 0.99 && s.ents.some((e) => e.t === "circle" && near(e.r, 4, 0.2))),
      },
      {
        title: "One spiral cut", tool: "Advanced Create → Sweep (Cut, Twist)", icon: "sweep", show: { sel: "#ad-sweep", via: "#ad-features" },
        how: [
          "<b>Advanced Create</b> ▾ → <b>Sweep</b>. Click the <b>circle</b> (the profile).",
          "Click <b>Path</b>, then the <b>vertical line</b> up the middle (you can click it through the cone).",
          "Twist angle <b>360</b>, Operation <b>Cut</b>. <b>OK</b>. A groove spirals once round the cone, bottom to top.",
        ],
        when: "Twist turns the profile as it travels: 360° is one full turn. This one cut is the whole idea; the pattern will repeat it.",
        check: (t) => t.bodies().some((b) => (b.node.mods || []).some((m) => m.t === "bool" && m.op === "cut" && m.tool && m.tool.t === "sweep" && Math.abs(m.tool.twist || 0) > 1)),
      },
      {
        title: "Repeat it all round", tool: "Pattern → Features (Circular)", icon: "pattern", show: { sel: "#ad-pattern" }, anim: "pattern",
        how: [
          "Click the cone. <b>Pattern</b> → <b>Features</b>, then click any face of the spiral groove (or tick <b>Sweep cut</b> in the list).",
          "<b>Circular</b>, Around <b>Z</b>, Through <b>Origin</b>, Count <b>5</b>, Total angle <b>360</b>. <b>OK</b>.",
          "Five spiral grooves take a little while to build: wait for <b>Rebuilding</b> at the bottom to finish.",
        ],
        when: "Pattern copies the feature, not the body: the cut is repeated around the cone exactly like in Fusion 360.",
        check: (t) => t.bodies().some((b) => (b.node.mods || []).filter((m) => m.t === "bool" && m.op === "cut" && m.tool && m.tool.t === "sweep").length >= 5),
      },
      {
        title: "A socket underneath", tool: "Hole (Depth)", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: ["Look from <b>below</b>. <b>Hole</b>, click the cone's bottom. <b>X 0</b>, <b>Y 0</b>, <b>Diameter 6</b>, Extent <b>Depth</b>, <b>12</b>. <b>OK</b>. Press <b>Home</b>."],
        when: "The cone will sit on a pin through this socket and spin on it.",
        check: (t) => mods(t, "hole") >= 1,
      },
      {
        title: "Crisp bottom edge", tool: "Chamfer", icon: "fillet", show: { sel: "#ad-edge" },
        how: ["Press <b>C</b> (Chamfer). Click the cone's <b>bottom outside edge</b>. Distance <b>0.6</b>. <b>OK</b>."],
        when: "Hides the squashed first layers (\"elephant's foot\").",
        check: (t) => mods(t, "chamfer") >= 1,
      },
      {
        title: "The base", tool: "Sketch → Circle + Extrude (New body)", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "<b>Sketch</b> → <b>XY · Top</b>. <b>Circle</b>: click <b>60, 0</b>, type <b>50</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>5</b>, Operation <b>New body</b>. <b>OK</b>. Then <b>Fillet</b> its top edge, Size <b>2</b>.",
        ],
        when: "A wide, heavy base keeps the spinning cone steady.",
        check: (t) => sized(t, 50, 50, 5, 1) && mods(t, "fillet") >= 1,
      },
      {
        title: "The pin", tool: "Sketch on a face → Circle + Extrude", icon: "circle", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "<b>Sketch</b>, click the base's <b>top</b>. <b>Circle</b> at its center (<b>60, 0</b>), type <b>5.4</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>11</b>. It joins. <b>OK</b>.",
        ],
        when: "A 5.4 mm pin in a 6 mm socket leaves 0.3 mm all round: loose enough to spin freely. The pin is 11 mm tall and the socket 12 mm deep, so the pin never bottoms out and the cone sits on the base.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.size.x, 50, 1) && near(x.size.z, 16, 0.8); }),
      },
      {
        title: "Watch it print", tool: "3D Print Sim → Layers", icon: "printsim", show: { sel: "#ws-print" }, anim: "printsim",
        how: [
          "Click an empty spot, then the <b>3D Print Sim</b> tab. Click <b>Layers</b>, then <b>Play print</b>.",
          "Watch the grooves turn a little on every layer. The groove roofs lean out at a gentle angle, so this prints without supports.",
        ],
        when: "The layer view shows how a twist becomes a stack of slightly turned slices.",
        check: (t) => { const p = t.psim(); return !!p && p.view === "layers"; },
      },
      saveStep(),
      exportStep(),
    ],
  },
];
