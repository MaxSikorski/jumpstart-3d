// Step-by-step tutorials for Beginner and Advanced, each a real item that takes about 5-15
// minutes when the steps are followed exactly. Every tutorial starts by naming the
// design "Last name, First name, Item name" and ends by saving (a new version: v1, v2...) and
// exporting an STL for 3D printing.
//
// A step: { title, tool, icon, show, how: [...], when, tip, check(t) }
//   show:  what "Show me" points at: { sel: "#id" } (a button or field), { tile: "box", hole }
//          (a tile in Beginner's bottom strip), { sel, via: "#menu-button" } (inside a drop-down)
//   check: optional; returns true when the step looks done, and ticks it off by itself.
//          Steps without a check (or a student who did it a little differently) are ticked by hand.

const nameStep = (item, example) => ({
  title: "Name your design",
  tool: "Design name box",
  icon: "text",
  show: { sel: "#docname", name: true },
  how: [
    "Click the name box at the top left of the screen (it says <b>Untitled</b>).",
    `Type <b>Last name, First name, ${item}</b>, for example <b>${example}</b>.`,
    "Press <b>Enter</b>.",
  ],
  when: "Always first, in every design. Your teacher can find your work, and every save and STL file gets your name on it.",
  tip: "On a small screen, use the quick name boxes below instead.",
  check: (t) => t.nameOk(item),
});
const saveStep = () => ({
  title: "Save your design",
  tool: "Save",
  icon: "finish",
  show: { sel: "#btn-save" },
  how: [
    "Click <b>Save</b> at the top of the screen, or press <b>Ctrl+S</b>.",
    "Look at the name: it now ends in <b>v1</b>. Each time you save this design again, the number goes up: v2, v3…",
  ],
  when: "Save whenever you finish a step you're proud of, and always before you close the app. Older saves keep their own number, so you can tell your versions apart.",
  tip: "Autosave (top bar) keeps extra backup copies named \"… autosave v1\", \"… autosave v2\" in case the app closes by accident. Find them under Your designs → Autosaves.",
  check: (t) => t.saved(),
});
const exportStep = () => ({
  title: "Export an STL for 3D printing",
  tool: "Export → STL",
  icon: "import",
  show: { sel: "#btn-export" },
  how: [
    "Click an empty spot in the 3D view so nothing is selected (then every part is exported).",
    "Click the <b>Export</b> button (the down-arrow at the top right).",
    "Choose <b>STL for 3D printing</b>.",
    "The file is named after your design and version, for example <b>Lopez, Maria, Keychain v1.stl</b>. Save it where your teacher asks (a class folder, Google Drive, or a USB stick).",
  ],
  when: "Last. STL is the file that slicer programs (Cura, PrusaSlicer, Bambu Studio…) open to make the printer's instructions.",
  tip: "If a shape is selected, only that shape is exported, and its name is added to the file name.",
  check: (t) => t.exported("stl"),
});

// Beginner panel fields
const FIELDS = "In the panel on the right, click each box, type the number and press <b>Enter</b>.";
// tool panels (with an OK button): Enter there means OK
const TABS = "In the tool's panel, press <b>Tab</b> to go to the next box. (<b>Enter</b> works like <b>OK</b>, so use it only at the end.)";

export const TUTORIALS = [
  // ============================================================== BEGINNER
  {
    id: "b-top", mode: "beginner", level: "Proficient", minutes: "8-10", item: "Spinning Top",
    title: "Spinning top (Lathe)",
    blurb: "Turn a square block of wood into a spinning top on the virtual lathe: round it, shape a point and a handle.",
    learn: ["Lathe", "Foot pedal", "Roughing gouge", "Spindle gouge", "Parting tool"],
    steps: [
      nameStep("Spinning Top", "Lopez, Maria, Spinning Top"),
      {
        title: "Open the Lathe", tool: "Lathe", icon: "lathe", show: { sel: "#bb-lathe" }, anim: false,
        how: [
          "In the toolbar, click <b>Lathe</b> (next to 3D Sketch).",
          "The Lathe opens over the whole screen with a window asking <b>What do you want to turn?</b>",
        ],
        when: "A lathe makes round things: it spins the wood while you hold a chisel against it, so everything you cut comes out perfectly round. Bowls, cups, bats, pens, chess pieces and tops are all turned.",
        tip: "Your design is safe: nothing changes until you press Add to design.",
        check: (t) => t.latheOpen(),
      },
      {
        title: "Put a square blank on the lathe", tool: "Square blank", icon: "box", show: { sel: "#lathe-start" }, anim: false,
        how: [
          "Choose <b>Square blank</b>.",
          "Type <b>Side 40</b> and <b>Length 70</b>. Material: <b>Maple</b>.",
          "Click <b>Put it on the lathe</b>. The block is held between the two pointed centers.",
        ],
        when: "Real turners start from a square block cut from a board. The lathe turns it round.",
        check: (t) => t.latheWork((w, st) => st.src === "square" && t.near(w.L, 70, 1) && t.near(st.blank.side, 40, 1)),
      },
      {
        title: "Turn the lathe on", tool: "Foot pedal", icon: "lathe", show: { sel: "#lathe-pedalmode" }, anim: false,
        how: [
          "In the toolbar, under <b>Foot pedal</b>, choose <b>Stays on</b>.",
          "Tap the <b>Space</b> bar once (or press the big <b>Start</b> button at the bottom right). The work starts spinning and the speed shows next to it.",
          "Tap <b>Space</b> again whenever you want to stop. (With <b>Hold</b>, it only spins while you hold Space down, like a real foot pedal.)",
        ],
        when: "The chisel only cuts while the work is spinning. If you press while it's stopped, a red note reminds you to start it.",
        tip: "Higher speed (the Speed slider) cuts faster. Start around 1200 rpm.",
        check: (t) => t.latheSpinning(),
      },
      {
        title: "Rough it round", tool: "Roughing gouge", icon: "lathe", show: { sel: "#lathe-tool" }, anim: false,
        how: [
          "Under <b>Chisel</b>, pick <b>Roughing gouge</b>. Set <b>Angle 0°</b>.",
          "Point just inside the wood's outline near the left end, then press and hold. The chisel cuts in toward where you point, a little at a time, and chips fly off.",
          "Keep holding and slowly drag to the right, all the way along. Go back and forth, a little further in each pass, until no flat sides are left and it looks like a smooth round bar.",
        ],
        when: "The roughing gouge is the big, fast tool: it knocks the corners off a square block. Always rough it round before the fine shaping.",
        tip: "Drag slowly. If you lift your finger or the mouse button, the chisel stops cutting.",
        check: (t) => t.latheWork((w) => t.roundness(w) > 0.85),
      },
      {
        title: "Shape the point", tool: "Spindle gouge", icon: "lathe", show: { sel: "#lathe-angle" }, anim: false,
        how: [
          "Pick <b>Spindle gouge</b>. Set <b>Angle +30°</b> (or scroll, or press <b>E</b>, to twist the chisel).",
          "Work on the <b>right third</b> (next to the tailstock). Press and hold inside the outline and drag to the right, pointing further in near the end each time.",
          "Stop when it comes to a blunt point about the size of a pencil tip at the right end.",
        ],
        when: "The spindle gouge makes curves and points. Twisting it lets its side do the cutting, so a slope comes out smooth.",
        check: (t) => t.latheWork((w) => { let mx = 0; for (let i = 0; i < w.N; i++) mx = Math.max(mx, w.rowMax[i]); return t.rAt(w, 0.96) < mx * 0.45 && mx > 8; }),
      },
      {
        title: "Turn the handle", tool: "Parting tool", icon: "lathe", show: { sel: "#lathe-tool" }, anim: false,
        how: [
          "Pick <b>Parting tool</b> and set <b>Angle 0°</b>.",
          "On the <b>left end</b>, press in and drag to the left, making a thin stem about <b>15 mm long</b> and about as thick as a pencil (8 mm).",
          "Leave the middle fat: that's the body of the top, where its weight is.",
        ],
        when: "The parting tool is thin and cuts straight down. It sizes a stem or a tenon, or cuts a part right off (if you go all the way to the middle, the piece comes apart).",
        check: (t) => t.latheWork((w) => { for (let f = 0.02; f <= 0.3; f += 0.02) { const r = t.rAt(w, f); if (r > 0.6 && r < 5.5) return true; } return false; }),
      },
      {
        title: "Add it to your design", tool: "Done → Add to design", icon: "finish", show: { sel: "#lathe-done" }, anim: false,
        how: [
          "Click <b>Done</b> at the top right of the Lathe.",
          "Click <b>Add to design</b>. The Lathe closes and your turned part appears in your design as a mesh body (it takes a moment to build).",
        ],
        when: "When the shape looks right. Until then you can keep cutting, or use Undo (Ctrl+Z): each time you press the chisel in is one step.",
        check: (t) => t.turned().length > 0,
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "b-keychain", mode: "beginner", level: "Easy", minutes: "5-7", item: "Keychain",
    title: "Name keychain",
    blurb: "A rounded tag with your name in raised letters and a hole for the key ring.",
    learn: ["Box", "Radius", "Text", "Holes", "Group"],
    steps: [
      nameStep("Keychain", "Lopez, Maria, Keychain"),
      {
        title: "Add the tag", tool: "Box", icon: "box", show: { tile: "box" },
        how: [
          "At the bottom of the screen, under <b>Objects</b>, click the <b>Box</b> tile. A box appears on the workplane and is selected.",
          FIELDS,
          "Size: <b>Width 60</b>, <b>Depth 25</b>, <b>Height 4</b>.",
          "Set <b>Radius</b> to <b>1.5</b> (type it in the box next to the slider) to round off every edge.",
        ],
        when: "A Box is the starting block for most flat parts. Radius takes the sharp edges off, so it feels good in your pocket.",
        check: (t) => t.prim("box").some((b) => t.near(b.node.p.w, 60) && t.near(b.node.p.d, 25) && t.near(b.node.p.h, 4)),
      },
      {
        title: "Add your name", tool: "Text", icon: "text", show: { tile: "text" }, anim: "tile",
        how: [
          "Click the <b>Text</b> tile (use the arrows on the strip if you can't see it).",
          "In the <b>Text</b> box on the right, type your first name and press <b>Enter</b>.",
          "Set <b>Letter size 9</b> and <b>Height 2</b>.",
        ],
        when: "Text makes raised (or, as a hole, carved) letters. A height of 2 mm shows up well on a print.",
        tip: "Names up to about 6 letters fit. For a longer name, use Letter size 7.",
        check: (t) => t.prim("text").some((b) => (b.node.p.text || "").trim() && b.node.p.text !== "TEXT" && t.near(b.node.p.size, 9, 1.5)),
      },
      {
        title: "Put the name on top", tool: "Position", icon: "move", show: { sel: "#insp-pos0" }, anim: "position",
        how: [
          "Keep the text selected. Under <b>Position</b> type <b>X 5</b>, <b>Y 0</b>, <b>Z (bottom) 4</b>.",
          "Z 4 lifts the letters to the top of the 4 mm tag, so they sit on it instead of inside it.",
          "Look at it from the side (drag with the right mouse button, or use the view cube): the letters should sit on the tag.",
        ],
        when: "Typing positions is the exact way to place shapes. Dragging is quicker, typing is perfect.",
        check: (t) => t.prim("text").some((b) => { const x = t.box(b.id); return x && t.near(x.min.z, 4, 0.4) && t.near(x.center.x, 5, 1.5); }),
      },
      {
        title: "Make the key-ring hole", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true },
        how: [
          "At the bottom left, click <b>Holes</b>, then click the <b>Cylinder</b> hole tile.",
          "Size: <b>Width 6</b>, <b>Depth 6</b>, <b>Height 10</b>.",
          "Position: <b>X -24</b>, <b>Y 0</b>, <b>Z (bottom) -2</b>. The hole now pokes through the left end of the tag.",
        ],
        when: "A hole shape cuts away everything it overlaps when you group. Make it a little taller than the part so it cuts all the way through.",
        check: (t) => t.prim("cylinder", true).some((b) => { const x = t.box(b.id); return x && t.near(x.center.x, -24, 2) && x.min.z < 0.01; }),
      },
      {
        title: "Group everything", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: [
          "Select everything: press <b>Ctrl+A</b> (or drag a box around all the shapes).",
          "Click <b>Group</b> in the toolbar (or press <b>Ctrl+G</b>).",
          "The tag, the letters and the hole become one keychain, with the hole cut out.",
        ],
        when: "Group last: it joins the solids and cuts the holes. To change something later, Ungroup, fix it, and group again.",
        check: (t) => t.groups().some((g) => t.hasHole(g) && t.childKinds(g).includes("text")),
      },
      {
        title: "Pick a color", tool: "Color", icon: "appearance", show: { sel: ".inspector .colors, #inspector .colors" },
        how: ["With the keychain selected, click a color in the panel on the right."],
        when: "Colors help you tell parts apart on screen. (The printer uses whatever filament is loaded.)",
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "b-coaster", mode: "beginner", level: "Easy", minutes: "5-7", item: "Coaster",
    title: "Coaster with drainage channels",
    blurb: "A round coaster with grooves across the top so drips run off instead of sitting under the cup.",
    learn: ["Cylinder", "Radius", "Box hole", "Pattern", "View cube", "Group"],
    steps: [
      nameStep("Coaster", "Lopez, Maria, Coaster"),
      {
        title: "Add the coaster", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" },
        how: [
          "Under <b>Objects</b>, click the <b>Cylinder</b> tile.",
          FIELDS,
          "Size: <b>Width 100</b>, <b>Depth 100</b>, <b>Height 6</b>.",
          "Set <b>Radius 2</b> to soften the edges.",
        ],
        when: "Cylinders make anything round: coasters, wheels, knobs, bases.",
        check: (t) => t.prim("cylinder").some((b) => t.near(b.node.p.w, 100) && t.near(b.node.p.h, 6)),
      },
      {
        title: "Cut the first channel", tool: "Holes → Box", icon: "holeToggle", show: { tile: "box", hole: true }, anim: "holeBox",
        how: [
          "Click <b>Holes</b> at the bottom left, then the <b>Box</b> hole tile.",
          "Size: <b>Width 110</b>, <b>Depth 4</b>, <b>Height 4</b>.",
          "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 3</b>.",
          "The channel is 3 mm deep and longer than the coaster, so water can run out of both ends.",
        ],
        when: "Long, thin box holes make grooves and slots.",
        check: (t) => t.prim("box", true).some((b) => t.near(b.node.p.w, 110, 2) && t.near(b.node.p.d, 4, 1)),
      },
      {
        title: "Copy it into a row", tool: "Pattern", icon: "pattern", show: { sel: "#bb-pattern" },
        how: [
          "Click the channel to select only it.",
          "Click <b>Pattern</b> in the toolbar.",
          TABS,
          "Type <b>Rectangular</b>. Direction 1: <b>Along Y</b>, <b>Count 4</b>, <b>Spacing 14</b>.",
          "Tick <b>Both sides of the original</b>. The panel says 7 instances.",
          "Click <b>OK</b>.",
        ],
        when: "Pattern makes many evenly spaced copies at once, much faster and neater than copying by hand.",
        check: (t) => t.prim("box", true).length >= 7,
      },
      {
        title: "Check it from the top", tool: "View cube", icon: "eye", show: { sel: ".viewcube, #viewcube, .vcube" },
        how: [
          "Click <b>TOP</b> on the view cube (top right of the 3D view).",
          "All 7 channels should be evenly spaced across the coaster.",
          "Click the <b>Home</b> button under the cube to go back.",
        ],
        when: "Looking straight down (or from the front or side) is the best way to check spacing and alignment.",
      },
      {
        title: "Group it", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b> to select everything, then click <b>Group</b> (or press <b>Ctrl+G</b>)."],
        when: "Grouping cuts all 7 channels into the coaster at once.",
        check: (t) => t.groups().some((g) => t.countHoles(g) >= 7),
      },
      {
        title: "Pick a color", tool: "Color", icon: "appearance", show: { sel: "#inspector .colors" },
        how: ["Click a color in the panel on the right."],
        when: "Choose the color you plan to print it in.",
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "b-pencil", mode: "beginner", level: "Proficient", minutes: "6-8", item: "Pencil Holder",
    title: "Hexagon pencil holder",
    blurb: "A six-sided cup for pens and pencils, hollowed out with a hole shape and lined up with Align.",
    learn: ["Prism", "Prism hole", "Align", "Group", "Texture"],
    steps: [
      nameStep("Pencil Holder", "Lopez, Maria, Pencil Holder"),
      {
        title: "Add the outside", tool: "Prism", icon: "prism", show: { tile: "prism" },
        how: [
          "Under <b>Objects</b>, click the <b>Prism</b> tile.",
          "Check that <b>Sides</b> is <b>6</b> (a hexagon).",
          "Size: <b>Width 80</b>, <b>Depth 80</b>, <b>Height 100</b>.",
        ],
        when: "Prisms are shapes with flat sides: triangles, hexagons, octagons. Sides sets how many.",
        check: (t) => t.prim("prism").some((b) => t.near(b.node.p.w, 80, 2) && t.near(b.node.p.h, 100, 2)),
      },
      {
        title: "Hollow it out", tool: "Holes → Prism", icon: "holeToggle", show: { tile: "prism", hole: true },
        how: [
          "Click <b>Holes</b>, then the <b>Prism</b> hole tile. Sides <b>6</b>.",
          "Size: <b>Width 72</b>, <b>Depth 72</b>, <b>Height 100</b>.",
          "Position: <b>Z (bottom) 4</b>. This leaves a 4 mm floor; the walls will be 4 mm thick.",
        ],
        when: "A smaller copy of a shape, made into a hole, hollows it out. The difference in size is the wall thickness.",
        check: (t) => t.prim("prism", true).some((b) => t.near(b.node.p.w, 72, 2) && t.box(b.id) && t.near(t.box(b.id).min.z, 4, 0.5)),
      },
      {
        title: "Line them up", tool: "Align", icon: "align", show: { sel: "#bb-align" },
        how: [
          "Click the outside prism, then hold <b>Shift</b> and click the hole, so both are selected.",
          "Click <b>Align</b> in the toolbar.",
          "X axis: click <b>Center</b>. Y axis: click <b>Center</b>. Leave Z axis at <b>—</b>.",
          "Click <b>OK</b>.",
        ],
        when: "Align centers shapes exactly. Lining up by eye can leave one wall thin and another thick.",
        check: (t) => { const o = t.prim("prism")[0], h = t.prim("prism", true)[0]; const a = o && t.box(o.id), b = h && t.box(h.id); return !!(a && b && t.near(a.center.x, b.center.x, 0.2) && t.near(a.center.y, b.center.y, 0.2)); },
      },
      {
        title: "Group it", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["With both selected (or <b>Ctrl+A</b>), click <b>Group</b>. Orbit the view to look inside: it's hollow with a floor."],
        when: "Group to cut the hole out of the solid.",
        check: (t) => t.groups().some((g) => t.hasHole(g)),
      },
      {
        title: "Add a texture", tool: "Texture", icon: "texture", show: { sel: "#bb-texture" },
        how: [
          "With the holder selected, click <b>Texture</b> in the toolbar.",
          "Click two or three of the outside flat sides that face you.",
          "Pick a pattern from the library (try one of the first few), keep <b>Raise</b>, and click <b>OK</b>.",
        ],
        when: "Textures add grip and style to a surface. Put them only on the outside faces you'll see.",
        tip: "Textures take a moment to build. If it's slow, use fewer faces or a larger Tile size.",
        check: (t) => t.bodies().some((b) => (b.textures || []).length > 0),
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "b-phone", mode: "beginner", level: "Proficient", minutes: "7-9", item: "Phone Stand",
    title: "Phone stand",
    blurb: "A sloped stand that holds a phone at a comfy angle, with a lip so it can't slide off and a slot for the charging cable.",
    learn: ["Box", "Wedge", "Rotate 90°", "Position", "Box hole", "Group"],
    steps: [
      nameStep("Phone Stand", "Lopez, Maria, Phone Stand"),
      {
        title: "Add the base", tool: "Box", icon: "box", show: { tile: "box" },
        how: [
          "Click the <b>Box</b> tile.",
          "Size: <b>Width 70</b>, <b>Depth 70</b>, <b>Height 5</b>.",
          "Position: <b>X 0</b>, <b>Y -10</b>, <b>Z (bottom) 0</b>.",
        ],
        when: "A wide, flat base keeps the stand from tipping over.",
        check: (t) => t.prim("box").some((b) => t.near(b.node.p.w, 70, 1) && t.near(b.node.p.d, 70, 1) && t.near(b.node.p.h, 5, 0.5)),
      },
      {
        title: "Add the slope", tool: "Wedge", icon: "pyramid", show: { tile: "wedge" },
        how: [
          "Click the <b>Wedge</b> tile (a ramp shape).",
          "Size: <b>Width 50</b>, <b>Depth 70</b>, <b>Height 65</b>.",
          "Under <b>Rotate 90°</b>, click <b>↻ Z</b> once. The slope now faces the front (toward you when you press Home).",
          "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 0</b>.",
        ],
        when: "A wedge is a ramp. The phone leans back against the sloped side.",
        check: (t) => t.prim("wedge").some((b) => { const x = t.box(b.id); return x && t.near(x.size.y, 50, 2) && t.near(x.size.x, 70, 2) && t.near(x.center.y, 0, 2); }),
      },
      {
        title: "Add the front lip", tool: "Box", icon: "box", show: { tile: "box" },
        how: [
          "Click the <b>Box</b> tile again.",
          "Size: <b>Width 70</b>, <b>Depth 5</b>, <b>Height 15</b>.",
          "Position: <b>X 0</b>, <b>Y -40.5</b>, <b>Z (bottom) 0</b>.",
          "The gap between the lip and the bottom of the slope is where the phone stands (about 13 mm).",
        ],
        when: "The lip stops the phone from sliding forward.",
        check: (t) => t.prim("box").some((b) => t.near(b.node.p.d, 5, 1) && t.near(b.node.p.h, 15, 1) && t.box(b.id) && t.near(t.box(b.id).center.y, -40.5, 2)),
      },
      {
        title: "Cut a cable slot", tool: "Holes → Box", icon: "holeToggle", show: { tile: "box", hole: true }, anim: "holeBox",
        how: [
          "Click <b>Holes</b>, then the <b>Box</b> hole tile.",
          "Size: <b>Width 16</b>, <b>Depth 20</b>, <b>Height 30</b>.",
          "Position: <b>X 0</b>, <b>Y -38</b>, <b>Z (bottom) -1</b>.",
          "The slot cuts through the lip and the front of the base so a charging cable fits.",
        ],
        when: "Think about how the thing will be used: a phone on a stand is often charging.",
        check: (t) => t.prim("box", true).some((b) => t.near(b.node.p.w, 16, 2) && t.box(b.id) && t.near(t.box(b.id).center.y, -38, 2)),
      },
      {
        title: "Group it", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b>, then click <b>Group</b> (or press <b>Ctrl+G</b>)."],
        when: "Grouping joins the base, slope and lip into one stand and cuts the slot.",
        check: (t) => t.groups().some((g) => t.hasHole(g) && t.childKinds(g).includes("wedge")),
      },
      {
        title: "Test the angle", tool: "Measure", icon: "measure", show: { sel: "#bb-measure" },
        how: [
          "Click <b>Measure</b>, then click the sloped face and then the base's top face. It shows the angle between them (about 52°). The base's top is the strip between the lip and the slope.",
          "Press <b>Esc</b> when you're done.",
        ],
        when: "Measure checks sizes, distances and angles before you print, which saves plastic and time.",
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "b-fidget", mode: "beginner", level: "Advanced", minutes: "8-10", item: "Fidget Spinner",
    title: "Fidget spinner",
    blurb: "A three-arm spinner built from one arm and a circular pattern. Its center fits a standard skateboard bearing.",
    learn: ["Cylinders", "Box", "Group parts", "Circular Pattern", "Holes"],
    steps: [
      nameStep("Fidget Spinner", "Lopez, Maria, Fidget Spinner"),
      {
        title: "Add the hub", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" },
        how: [
          "Click the <b>Cylinder</b> tile.",
          "Size: <b>Width 30</b>, <b>Depth 30</b>, <b>Height 7</b>. Position: <b>X 0</b>, <b>Y 0</b>.",
        ],
        when: "The hub is the middle that holds the bearing.",
        check: (t) => t.prim("cylinder").some((b) => t.near(b.node.p.w, 30, 1) && t.near(b.node.p.h, 7, 0.5)),
      },
      {
        title: "Add one arm", tool: "Cylinder + Box", icon: "box", show: { tile: "cylinder" },
        how: [
          "Click the <b>Cylinder</b> tile again: <b>Width 26</b>, <b>Depth 26</b>, <b>Height 7</b>, Position <b>X 34</b>, <b>Y 0</b>. This is the weight at the end of the arm.",
          "Click the <b>Box</b> tile: <b>Width 30</b>, <b>Depth 12</b>, <b>Height 7</b>, Position <b>X 17</b>, <b>Y 0</b>. This joins the hub to the weight.",
        ],
        when: "Build one piece first, perfectly. Then a pattern makes the others identical.",
        check: (t) => t.prim("cylinder").some((b) => t.near(b.node.p.w, 26, 1) && t.box(b.id) && t.near(t.box(b.id).center.x, 34, 2)) && t.prim("box").some((b) => t.near(b.node.p.d, 12, 1)),
      },
      {
        title: "Group the arm", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: [
          "Click the end cylinder, then <b>Shift</b>+click the box (not the hub).",
          "Click <b>Group</b>. The arm is now one piece.",
        ],
        when: "Grouping a few shapes into one part lets you copy, move or pattern them together.",
        check: (t) => t.groups().some((g) => t.childKinds(g).includes("box") && t.childKinds(g).includes("cylinder")),
      },
      {
        title: "Make three arms", tool: "Pattern (circular)", icon: "pattern", show: { sel: "#bb-pattern" },
        how: [
          "With the arm selected, click <b>Pattern</b>.",
          TABS,
          "Type: <b>Circular</b>. Around: <b>Z</b>. Through: <b>Origin</b>.",
          "<b>Count 3</b>, <b>Total angle 360</b>. Click <b>OK</b>.",
        ],
        when: "A circular pattern spaces copies evenly around a center: spinner arms, gear teeth, flower petals.",
        check: (t) => t.groups().filter((g) => t.childKinds(g).includes("box")).length >= 3,
      },
      {
        title: "Bearing hole", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true },
        how: [
          "Click <b>Holes</b>, then the <b>Cylinder</b> hole tile.",
          "Size: <b>Width 22.2</b>, <b>Depth 22.2</b>, <b>Height 10</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) -1</b>.",
        ],
        when: "A 608 skateboard bearing is 22 mm across. 22.2 mm gives a snug press fit on most printers.",
        check: (t) => t.prim("cylinder", true).some((b) => t.near(b.node.p.w, 22.2, 0.5)),
      },
      {
        title: "Weight holes", tool: "Holes + Pattern", icon: "pattern", show: { tile: "cylinder", hole: true },
        how: [
          "Add another <b>Cylinder</b> hole: <b>Width 16</b>, <b>Depth 16</b>, <b>Height 10</b>, Position <b>X 34</b>, <b>Y 0</b>, <b>Z (bottom) -1</b>.",
          "With it selected, click <b>Pattern</b>: <b>Circular</b>, Around <b>Z</b>, Through <b>Origin</b>, <b>Count 3</b>, <b>360</b>. <b>OK</b>.",
        ],
        when: "Holes in the ends make it lighter, or hold coins or nuts for a longer spin.",
        check: (t) => t.prim("cylinder", true).filter((b) => t.near(b.node.p.w, 16, 1)).length >= 3,
      },
      {
        title: "Group everything", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b>, then <b>Group</b>. Your spinner is one part with four holes."],
        when: "The final group cuts every hole.",
        check: (t) => t.groups().some((g) => t.countHoles(g) >= 4),
      },
      saveStep(),
      exportStep(),
    ],
  },

  {
    id: "b-rocket", mode: "beginner", level: "Proficient", minutes: "10-12", item: "Rocket",
    title: "Rocket with fins",
    blurb: "A rocket that stands on four fins, with a pointed nose and a round porthole. You line parts up with Align's black dots and copy the fins with a circular Pattern.",
    learn: ["Cylinder", "Cone", "Align (dots)", "Wedge", "Circular Pattern", "Torus", "Rotate 90°", "3D Print Sim"],
    steps: [
      nameStep("Rocket", "Lopez, Maria, Rocket"),
      {
        title: "The rocket body", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" },
        how: [
          "Under <b>Objects</b>, click the <b>Cylinder</b> tile.",
          FIELDS,
          "Size: <b>Width 30</b>, <b>Depth 30</b>, <b>Height 70</b>.",
          "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 0</b>.",
        ],
        when: "Start with the biggest part. Everything else is placed around it.",
        check: (t) => t.prim("cylinder").some((b) => t.near(b.node.p.w, 30, 1) && t.near(b.node.p.h, 70, 1)),
      },
      {
        title: "The nose cone", tool: "Cone", icon: "pyramid", show: { tile: "cone" }, anim: "tile",
        how: [
          "Click the <b>Cone</b> tile.",
          "Size: <b>Width 30</b>, <b>Depth 30</b>, <b>Height 30</b>.",
          "Position: <b>X 20</b>, <b>Y 15</b>, <b>Z (bottom) 70</b>. It's off to the side on purpose: the next step lines it up with Align.",
        ],
        when: "A cone with the same width as the body makes a smooth, pointed nose.",
        check: (t) => t.prim("cone").some((b) => t.near(b.node.p.h, 30, 1) && t.box(b.id) && t.near(t.box(b.id).min.z, 70, 1)),
      },
      {
        title: "Line them up with Align", tool: "Align (black dots)", icon: "align", show: { sel: "#bb-align" },
        how: [
          "Click the body first, then hold <b>Shift</b> and click the cone. Both are selected.",
          "Click <b>Align</b> in the toolbar. Black dots appear around the two shapes: three along the front edge (left, center, right), three along the side (front, center, back) and three up the corner (bottom, middle, top).",
          "In the panel, set <b>Align to</b>: <b>First shape</b>. The body stays still and the cone moves to it.",
          "Click the <b>middle dot</b> of the front row, then the <b>middle dot</b> of the side row. They turn orange and the cone slides onto the center of the body. Click <b>OK</b>.",
        ],
        when: "Align lines shapes up exactly: centers, left sides, tops… Much faster and more exact than dragging.",
        tip: "Click an orange dot again to undo that axis. The buttons in the Align panel do the same thing as the dots.",
        check: (t) => { const c = t.prim("cylinder").find((b) => t.near(b.node.p.h, 70, 1)), n = t.prim("cone")[0]; const a = c && t.box(c.id), b = n && t.box(n.id); return !!(a && b && t.near(a.center.x, 0, 0.5) && t.near(b.center.x, 0, 0.3) && t.near(b.center.y, 0, 0.3)); },
      },
      {
        title: "One fin", tool: "Wedge", icon: "pyramid", show: { tile: "wedge" }, anim: "tile",
        how: [
          "Click the <b>Wedge</b> tile.",
          "Size: <b>Width 25</b>, <b>Depth 3</b>, <b>Height 30</b>. A thin ramp: that's a fin.",
          "Position: <b>X 26</b>, <b>Y 0</b>, <b>Z (bottom) 0</b>.",
          "The tall side of the fin touches the rocket and the slope runs down and out. Orbit around to check (drag the view cube).",
        ],
        when: "Fins reach the ground so the rocket stands up by itself, like legs.",
        check: (t) => t.prim("wedge").some((b) => t.near(b.node.p.w, 25, 1) && t.near(b.node.p.d, 3, 0.6)),
      },
      {
        title: "Four fins with a circular pattern", tool: "Pattern (circular)", icon: "pattern", show: { sel: "#bb-pattern" }, anim: "cpattern",
        how: [
          "Click the fin so only it is selected, then click <b>Pattern</b>.",
          TABS,
          "Type: <b>Circular</b>. Around: <b>Z</b>. Through: <b>Origin</b>.",
          "<b>Count 4</b>, <b>Total angle 360</b>. Click <b>OK</b>.",
        ],
        when: "A circular pattern spaces copies evenly around a center: fins, wheel spokes, petals, gear teeth.",
        check: (t) => t.prim("wedge").length >= 4,
      },
      {
        title: "A porthole", tool: "Torus + Rotate 90°", icon: "box", show: { tile: "torus" }, anim: "rotate",
        how: [
          "Click the <b>Torus</b> tile (a ring). Set <b>Diameter 14</b> and <b>Tube 2</b>.",
          "Under <b>Rotate 90°</b>, click <b>↻ X</b> once. The ring stands up.",
          "Position: <b>X 0</b>, <b>Y -15</b>, <b>Z (bottom) 42</b>. Y -15 puts it on the front of the body (the body is 30 wide, so its front is at -15).",
        ],
        when: "Rotate 90° turns a shape a quarter turn. The axis you pick is what it spins around.",
        check: (t) => t.prim("torus").some((b) => { const x = t.box(b.id); return x && x.size.z > 10 && x.center.y < -10; }),
      },
      {
        title: "Group everything", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b> to select every part, then click <b>Group</b> (or <b>Ctrl+G</b>)."],
        when: "Grouping fuses the parts into one solid rocket, ready to print in one piece.",
        check: (t) => t.groups().some((g) => t.childKinds(g).includes("wedge") && t.childKinds(g).includes("cone")),
      },
      {
        title: "Test-print it in the 3D Print Sim", tool: "3D Print Sim", icon: "eye", show: { sel: "#bb-printsim" }, anim: "printsim",
        how: [
          "Click <b>3D Print Sim</b> in the toolbar, then <b>▶ Play the print</b> (in the panel). Watch the layers stack up from the bottom.",
          "Look for a big red <b>Supports needed!</b> sign. Steep slopes like the cone (63°) and the fin edges print fine, because each layer rests mostly on the one below. If the porthole's underside shows red, it's tiny: printers handle overhangs that small.",
          "Read the <b>Orientation advice</b> (why standing up is the strongest way for this rocket), then click <b>Done</b> or press <b>Esc</b>.",
        ],
        when: "Check every design before printing. The sim shows overhangs (parts that would print in mid-air) and how long the print takes.",
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "b-desk", mode: "beginner", level: "Advanced", minutes: "12-15", item: "Desk Organizer",
    title: "Desk organizer with your name",
    blurb: "A block with a big pen cup, a row of pencil holes, a slot for your phone or cards, and your name standing out on the front.",
    learn: ["Box", "Radius", "Cylinder holes", "Pattern", "Box hole", "Text", "Rotate 90°", "Group"],
    steps: [
      nameStep("Desk Organizer", "Lopez, Maria, Desk Organizer"),
      {
        title: "The block", tool: "Box", icon: "box", show: { tile: "box" },
        how: [
          "Click the <b>Box</b> tile.",
          FIELDS,
          "Size: <b>Width 120</b>, <b>Depth 80</b>, <b>Height 60</b>. Set <b>Radius 2</b>.",
          "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 0</b>.",
        ],
        when: "The outside block is the whole organizer. Everything else is a hole cut into it.",
        check: (t) => t.prim("box").some((b) => t.near(b.node.p.w, 120, 1) && t.near(b.node.p.d, 80, 1) && t.near(b.node.p.h, 60, 1)),
      },
      {
        title: "The pen cup", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true },
        how: [
          "Click <b>Holes</b>, then the <b>Cylinder</b> hole tile.",
          "Size: <b>Width 30</b>, <b>Depth 30</b>, <b>Height 60</b>.",
          "Position: <b>X -35</b>, <b>Y 10</b>, <b>Z (bottom) 4</b>. Z 4 leaves a 4 mm floor under the pens.",
        ],
        when: "A hole that starts above the bottom makes a pocket with a floor instead of a hole all the way through.",
        check: (t) => t.prim("cylinder", true).some((b) => t.near(b.node.p.w, 30, 1) && t.box(b.id) && t.near(t.box(b.id).min.z, 4, 0.5)),
      },
      {
        title: "One pencil hole", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true },
        how: [
          "Add another <b>Cylinder</b> hole: <b>Width 12</b>, <b>Depth 12</b>, <b>Height 60</b>.",
          "Position: <b>X 5</b>, <b>Y 22</b>, <b>Z (bottom) 10</b>.",
        ],
        when: "12 mm fits a pencil or a marker with room to spare.",
        check: (t) => t.prim("cylinder", true).some((b) => t.near(b.node.p.w, 12, 1)),
      },
      {
        title: "A row of three", tool: "Pattern", icon: "pattern", show: { sel: "#bb-pattern" },
        how: [
          "Keep the pencil hole selected and click <b>Pattern</b>.",
          TABS,
          "Type <b>Rectangular</b>. Direction 1: <b>Along X</b>, <b>Count 3</b>, <b>Spacing 16</b>. Leave <b>Both sides</b> off.",
          "Click <b>OK</b>. Three holes in a neat row.",
        ],
        when: "Spacing is measured center to center: 16 mm between 12 mm holes leaves 4 mm of plastic between them.",
        check: (t) => t.prim("cylinder", true).filter((b) => t.near(b.node.p.w, 12, 1)).length >= 3,
      },
      {
        title: "A phone and card slot", tool: "Holes → Box", icon: "holeToggle", show: { tile: "box", hole: true }, anim: "holeBox",
        how: [
          "Add a <b>Box</b> hole: <b>Width 100</b>, <b>Depth 12</b>, <b>Height 60</b>.",
          "Position: <b>X 0</b>, <b>Y -25</b>, <b>Z (bottom) 20</b>. The slot is 40 mm deep: a phone stands in it, or cards and sticky notes.",
        ],
        when: "Long box holes make slots. Keep about 8 mm of wall in front so it stays strong.",
        check: (t) => t.prim("box", true).some((b) => t.near(b.node.p.w, 100, 2) && t.near(b.node.p.d, 12, 1)),
      },
      {
        title: "Your name", tool: "Text", icon: "text", show: { tile: "text" }, anim: "tile",
        how: [
          "Click <b>Objects</b>, then the <b>Text</b> tile.",
          "Type your first name in the <b>Text</b> box and press <b>Enter</b>.",
          "Set <b>Letter size 12</b> and <b>Height 2</b>.",
        ],
        when: "Text makes raised letters. Here they go on the front of the organizer.",
        check: (t) => t.prim("text").some((b) => (b.node.p.text || "").trim() && b.node.p.text !== "TEXT" && t.near(b.node.p.size, 12, 1.5)),
      },
      {
        title: "Stand the name up on the front", tool: "Rotate 90° + Position", icon: "move", show: { sel: "#insp-pos0" }, anim: "rotate",
        how: [
          "Under <b>Rotate 90°</b>, click <b>↻ X</b> <b>three times</b>. The letters stand up and face the front.",
          "Position: <b>X 0</b>, <b>Y -41</b>, <b>Z (bottom) 22</b>. The block's front is at Y -40, so the 2 mm letters sit right on it.",
          "Press <b>Home</b> (under the view cube): your name should read the right way round.",
        ],
        when: "Shapes are made lying flat. Rotate them to stand them up, then type the position to place them exactly.",
        tip: "Upside down or backwards? Click ↻ X again until it reads correctly, then type the position again.",
        check: (t) => t.prim("text").some((b) => { const x = t.box(b.id); return x && x.size.z > 6 && x.max.y < -39 && x.min.z > 10; }),
      },
      {
        title: "Group it", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b>, then click <b>Group</b>. All five holes are cut and the name joins the front."],
        when: "One Group does everything at once: solids join, holes cut.",
        check: (t) => t.groups().some((g) => t.countHoles(g) >= 5 && t.childKinds(g).includes("text")),
      },
      {
        title: "Pick a color", tool: "Color", icon: "appearance", show: { sel: "#inspector .colors" },
        how: ["Click a color in the panel on the right."],
        when: "Pick the color of the filament you'll print with.",
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "b-castle", mode: "beginner", level: "Advanced", minutes: "12-15", item: "Castle Tower",
    title: "Castle tower",
    blurb: "A round tower with battlements on top, an arched door and window slits. A good pencil cup or a piece for a board game.",
    learn: ["Tube", "Wall", "Box holes", "Circular Pattern", "Rotate 90°", "Arches", "3D Print Sim"],
    steps: [
      nameStep("Castle Tower", "Lopez, Maria, Castle Tower"),
      {
        title: "The tower", tool: "Tube", icon: "cylinder", show: { tile: "tube" }, anim: "tileRound",
        how: [
          "Click the <b>Tube</b> tile (a cylinder with a hole down the middle).",
          FIELDS,
          "Size: <b>Width 60</b>, <b>Depth 60</b>, <b>Height 80</b>. Set <b>Wall 5</b>.",
        ],
        when: "A tube is a hollow cylinder. Wall sets how thick its sides are.",
        check: (t) => t.prim("tube").some((b) => t.near(b.node.p.w, 60, 1) && t.near(b.node.p.h, 80, 1) && t.near(b.node.p.wall, 5, 0.5)),
      },
      {
        title: "A floor", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" },
        how: [
          "A tube is open at both ends. Click the <b>Cylinder</b> tile: <b>Width 60</b>, <b>Depth 60</b>, <b>Height 4</b>.",
          "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 0</b>.",
        ],
        when: "Add a floor when the tower should hold things (pencils, dice, game pieces).",
        check: (t) => t.prim("cylinder").some((b) => t.near(b.node.p.w, 60, 1) && t.near(b.node.p.h, 4, 0.5)),
      },
      {
        title: "Cut one pair of battlements", tool: "Holes → Box", icon: "holeToggle", show: { tile: "box", hole: true }, anim: "holeBox",
        how: [
          "Click <b>Holes</b>, then the <b>Box</b> hole tile.",
          "Size: <b>Width 70</b>, <b>Depth 10</b>, <b>Height 10</b>.",
          "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 72</b>. It crosses the whole top, so it cuts two notches at once (left and right).",
        ],
        when: "One long hole through the middle cuts both sides of a round part.",
        check: (t) => t.prim("box", true).some((b) => t.near(b.node.p.w, 70, 2) && t.box(b.id) && t.near(t.box(b.id).min.z, 72, 1)),
      },
      {
        title: "All the way round", tool: "Pattern (circular)", icon: "pattern", show: { sel: "#bb-pattern" }, anim: "cpattern",
        how: [
          "Keep the notch hole selected and click <b>Pattern</b>.",
          TABS,
          "Type <b>Circular</b>, Around <b>Z</b>, Through <b>Origin</b>.",
          "<b>Count 4</b>, <b>Total angle 135</b>. Click <b>OK</b>. That's 4 holes 45° apart: 8 notches all round.",
        ],
        when: "With an angle under 360, the copies spread from the first one up to that angle: 0°, 45°, 90°, 135°. Each hole cuts two notches (one on each side), so that covers the whole circle.",
        check: (t) => t.prim("box", true).filter((b) => t.box(b.id) && t.near(t.box(b.id).min.z, 72, 1)).length >= 4,
      },
      {
        title: "The door", tool: "Holes → Box", icon: "holeToggle", show: { tile: "box", hole: true }, anim: "holeBox",
        how: [
          "Add a <b>Box</b> hole: <b>Width 16</b>, <b>Depth 20</b>, <b>Height 21</b>.",
          "Position: <b>X 0</b>, <b>Y -28</b>, <b>Z (bottom) -1</b>. It cuts through the front wall.",
        ],
        when: "Starting a hole at -1 makes sure it cuts all the way to the bottom.",
        check: (t) => t.prim("box", true).some((b) => t.near(b.node.p.w, 16, 1) && t.near(b.node.p.h, 21, 1)),
      },
      {
        title: "Make it an arch", tool: "Cylinder hole + Rotate 90°", icon: "holeToggle", show: { tile: "cylinder", hole: true }, anim: "rotate",
        how: [
          "Add a <b>Cylinder</b> hole: <b>Width 16</b>, <b>Depth 16</b>, <b>Height 20</b>.",
          "Under <b>Rotate 90°</b>, click <b>↻ X</b> once. Now it lies on its side and points through the wall.",
          "Position: <b>X 0</b>, <b>Y -28</b>, <b>Z (bottom) 12</b>. Its middle is at the top of the door, so the top half makes a round arch.",
        ],
        when: "Arches are strong, and most of the curve prints without supports: each layer only sticks out a little past the one under it. Only the very top is nearly flat.",
        check: (t) => t.prim("cylinder", true).some((b) => { const x = t.box(b.id); return x && t.near(b.node.p.w, 16, 1) && x.size.y > 15 && t.near(x.min.z, 12, 1); }),
      },
      {
        title: "Window slits", tool: "Box hole + Pattern", icon: "pattern", show: { tile: "box", hole: true }, anim: "holeBox",
        how: [
          "Add a <b>Box</b> hole: <b>Width 4</b>, <b>Depth 70</b>, <b>Height 14</b>. Position <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 45</b>. That cuts a slit in the front and the back.",
          "With it selected, click <b>Pattern</b>: <b>Circular</b>, Around <b>Z</b>, Through <b>Origin</b>, <b>Count 2</b>, <b>Total angle 90</b>. <b>OK</b>. Now there are slits on all four sides.",
        ],
        when: "Narrow slits were for archers. On a print they also let you see inside.",
        check: (t) => t.prim("box", true).filter((b) => t.near(b.node.p.w, 4, 1)).length >= 2,
      },
      {
        title: "Group the tower", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b>, then <b>Group</b>. Orbit around: battlements, door, arch and slits."],
        when: "Group last, after every hole is in place.",
        check: (t) => t.groups().some((g) => t.childKinds(g).includes("tube") && t.countHoles(g) >= 8),
      },
      {
        title: "Check it in the 3D Print Sim", tool: "3D Print Sim", icon: "eye", show: { sel: "#bb-printsim" }, anim: "printsim",
        how: [
          "Click <b>3D Print Sim</b>, then <b>▶ Play the print</b> (in the panel).",
          "A red <b>Supports needed!</b> sign appears. The red areas are the very top of the arch and the tops of the window slits: spans that are flat or nearly flat.",
          "They're short (16 mm or less), so most printers can <b>bridge</b> them: the plastic is stretched straight across, like a rope. For a long span you would turn on supports (the Tree button on the sign).",
          "Click <b>Done</b> or press <b>Esc</b>.",
        ],
        when: "Designing so a part prints without supports saves plastic and gives a cleaner finish.",
      },
      saveStep(),
      exportStep(),
    ],
  },

  // ============================================================== ADVANCED
  {
    id: "a-coaster", mode: "advanced", level: "Easy", minutes: "8-10", item: "Coaster",
    title: "Coaster with drainage channels",
    blurb: "Sketch and extrude a coaster and round its edge. Then sketch a channel right on its top face, copy it with Pattern and cut it in with Combine.",
    learn: ["Sketch", "Circle", "Extrude", "Fillet", "Sketch on a face", "Center rectangle", "Extrude (New body)", "Pattern", "Combine (Cut)"],
    steps: [
      nameStep("Coaster", "Lopez, Maria, Coaster"),
      {
        title: "Sketch a circle", tool: "Sketch → Circle", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "circle",
        how: [
          "Click <b>Sketch</b> (top left of the toolbar).",
          "In the panel, click <b>XY · Top</b> (or click the workplane).",
          "Click <b>Circle</b> (or press <b>C</b>).",
          "Click the dot in the middle (the origin; the cursor snaps to it).",
          "Type <b>100</b> and press <b>Enter</b>. That's the diameter in mm.",
        ],
        when: "Every Advanced part starts as a flat sketch. The sketch is the shape seen from one side.",
        check: (t) => t.sketchCircle(50),
      },
      {
        title: "Extrude it", tool: "Extrude", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" },
        how: [
          "Press <b>E</b> (or click <b>Extrude</b>). The circle is picked for you.",
          TABS,
          "Type <b>6</b> for the Distance.",
          "Click <b>OK</b>. The sketch hides itself once it's used.",
        ],
        when: "Extrude pulls a flat sketch up into a solid, like cookie dough through a cutter.",
        check: (t) => t.bodies().some((b) => b.node.t === "extrude" && t.box(b.id) && t.near(t.box(b.id).size.z, 6, 0.3) && t.near(t.box(b.id).size.x, 100, 1)),
      },
      {
        title: "Round the top edge", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "Click <b>Fillet</b> (or press <b>F</b>).",
          "Click the round edge around the top of the coaster.",
          "Type <b>1.5</b> for the size. Click <b>OK</b>.",
        ],
        when: "Fillets round edges so they're smooth to touch and less likely to chip. Do them before cutting details.",
        check: (t) => t.hasMod("fillet"),
      },
      {
        title: "Sketch a channel on the top face", tool: "Sketch on a face → Center rectangle", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "Click <b>Sketch</b>, then click the <b>top face</b> of the coaster. The view turns to look straight down at it.",
          "Click <b>Rectangle</b> (or press <b>R</b>), then choose <b>Center</b> in the panel.",
          "Move to the middle until the label next to the cursor says <b>Point · 0, 0</b>, and click.",
          "Type <b>110</b>, press <b>Tab</b>, type <b>4</b>, press <b>Enter</b>. A long, thin rectangle that runs past both edges.",
        ],
        when: "Sketch right on a face when a detail belongs on that surface. The sketch sits exactly at the top, so you don't need to work out the height.",
        tip: "The circle around the face is the coaster's edge, copied into the sketch so you can snap to it.",
        check: (t) => t.sketchRect(110, 4, 6),
      },
      {
        title: "Extrude a cutter down into it", tool: "Extrude (New body)", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" }, anim: "cut",
        how: [
          "Press <b>E</b>. The rectangle is picked.",
          TABS,
          "Distance <b>-3</b> (minus means down, into the coaster).",
          "Operation: <b>New body</b>. Click <b>OK</b>. You get a separate 3 mm bar: a cutting tool.",
        ],
        when: "Extrude can join, cut or make a new body. A new body lets you copy the cutter with Pattern before you cut.",
        check: (t) => t.feat("extrude").some((b) => { const x = t.box(b.id); return x && t.near(x.size.x, 110, 1.5) && t.near(x.size.z, 3, 0.4); }),
      },
      {
        title: "Pattern the cutter", tool: "Pattern", icon: "pattern", show: { sel: "#ad-pattern" },
        how: [
          "Click the bar (the cutter) to select it, then click <b>Pattern</b> (or press <b>P</b>).",
          TABS,
          "<b>Rectangular</b>. Direction 1: <b>Along Y</b>, <b>Count 4</b>, <b>Spacing 14</b>.",
          "Tick <b>Both sides of the original</b> (7 instances) and <b>Join copies into one body</b>.",
          "Click <b>OK</b>.",
        ],
        when: "Pattern makes exact, evenly spaced copies.",
        check: (t) => t.bodies().some((b) => b.node.t === "group" && (b.node.children || []).length >= 7),
      },
      {
        title: "Cut the channels", tool: "Combine (Cut)", icon: "combine", show: { sel: "#ad-combine", via: "#ad-advmod" },
        how: [
          "Open <b>Advanced Modify</b> ▾ and choose <b>Combine</b> (or press <b>B</b>).",
          "<b>Target body</b>: click the coaster.",
          "<b>Tool bodies</b>: click the row of channels.",
          "Operation: <b>Cut</b>. Click <b>OK</b>.",
        ],
        when: "Combine joins bodies, cuts one with another, or keeps only where they overlap (Intersect).",
        check: (t) => t.hasCombine("cut"),
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-plate", mode: "advanced", level: "Easy", minutes: "10-12", item: "Name Plate",
    title: "Desk name plate",
    blurb: "Draw a triangle side view, stretch it into a long plate, round the top, hollow the inside to save plastic and raise your name on the slope.",
    learn: ["Sketch on a plane", "Line with length and angle", "Extrude (Symmetric)", "Fillet", "View cube", "Shell", "Emboss text"],
    steps: [
      nameStep("Name Plate", "Lopez, Maria, Name Plate"),
      {
        title: "Sketch on the Front plane", tool: "Sketch", icon: "sketch", show: { sel: "#ad-sketch" },
        how: [
          "Click <b>Sketch</b>, then click <b>XZ · Front</b> in the panel.",
          "You now look at the sketch straight on: right is X, up is Z.",
        ],
        when: "Draw the side view of a long part, then stretch it. A name plate is the same triangle all the way along.",
        check: (t) => t.sketchOn("XZ"),
      },
      {
        title: "Draw the triangle", tool: "Line", icon: "line", show: { sel: "#sk-line" },
        how: [
          "Click <b>Line</b> (or press <b>L</b>) and click the origin dot.",
          "Type <b>40</b>, <b>Tab</b>, <b>0</b>, <b>Enter</b>: the bottom, 40 mm to the right.",
          "Type <b>40</b>, <b>Tab</b>, <b>135</b>, <b>Enter</b>: the front slope, up and back at 45°.",
          "Click the origin dot to close the triangle. It shades blue.",
        ],
        when: "Angles count counter-clockwise from the right: 0 = right, 90 = up, 135 = up and left, 180 = left.",
        tip: "Made a mistake? Ctrl+Z removes the last line.",
        check: (t) => t.sketchLines(3),
      },
      {
        title: "Stretch it into a plate", tool: "Extrude (Symmetric)", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" },
        how: [
          "Press <b>E</b>. The triangle is picked.",
          TABS,
          "Direction: <b>Symmetric</b>. <b>Total distance 160</b>. Click <b>OK</b>.",
          "Press <b>Home</b> (under the view cube) to see the whole plate.",
        ],
        when: "Symmetric grows the same amount on both sides of the sketch, so the plate is centered on the origin.",
        check: (t) => t.feat("extrude").some((b) => t.box(b.id) && t.near(t.box(b.id).size.y, 160, 1)),
      },
      {
        title: "Round the top", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "Click <b>Fillet</b> (or press <b>F</b>).",
          "Click the long edge along the very top (where the slope meets the back).",
          "Size <b>3</b>. Click <b>OK</b>.",
        ],
        when: "A sharp top edge prints poorly and chips. A fillet makes it smooth and strong.",
        check: (t) => t.hasMod("fillet"),
      },
      {
        title: "Hollow it from underneath", tool: "View cube + Shell", icon: "shell", show: { sel: "#ad-shell" },
        how: [
          "<b>Drag the view cube up</b> (top right) until you see the bottom of the plate.",
          "Click <b>Shell</b>, then click the <b>bottom face</b>.",
          "<b>Thickness 2</b>, <b>Inside</b>. Click <b>OK</b>.",
          "Press <b>Home</b> to turn back.",
        ],
        when: "A hollow part uses much less plastic and prints faster. Open the face that sits on the printer bed.",
        tip: "You can drag the view cube any way you like to turn the view. Click a face of the cube to look straight at that side.",
        check: (t) => t.hasMod("shell"),
      },
      {
        title: "Raise your name on the slope", tool: "Decorate → Emboss text", icon: "emboss", show: { sel: "#ad-emboss", via: "#ad-decorate" },
        how: [
          "Open <b>Decorate</b> ▾ and choose <b>Emboss text</b>.",
          "Click the <b>middle of the sloped front face</b>. The text is centered where you click.",
          "Type your name in <b>Text</b>. <b>Letter height 14</b>, <b>Height 1.5</b>. Style <b>Emboss (raised)</b>.",
          "Click <b>OK</b>.",
        ],
        when: "Emboss puts raised (or cut-in) letters right on a face, flat or curved. Keep letters at least 5 mm tall so they print clearly.",
        tip: "Upside down? Click ↻ 180° in the panel. Too long? Make the letter height smaller.",
        check: (t) => t.hasMod("emboss"),
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-phone", mode: "advanced", level: "Proficient", minutes: "7-9", item: "Phone Stand",
    title: "Phone stand from a side profile",
    blurb: "Draw the stand's side outline with typed line lengths and angles, extrude it, and round the edges.",
    learn: ["Sketch on a plane", "Line with typed length and angle", "Extrude (Symmetric)", "Fillet"],
    steps: [
      nameStep("Phone Stand", "Lopez, Maria, Phone Stand"),
      {
        title: "Sketch on the Front plane", tool: "Sketch", icon: "sketch", show: { sel: "#ad-sketch" },
        how: [
          "Click <b>Sketch</b>, then click <b>XZ · Front</b> in the panel.",
          "The view turns so you look at the sketch straight on: right is X, up is Z.",
        ],
        when: "Pick the plane that shows the part's most important outline. For a stand, that's the side view.",
        check: (t) => t.sketchOn("XZ"),
      },
      {
        title: "Draw the outline", tool: "Line", icon: "line", show: { sel: "#sk-line" },
        how: [
          "Click <b>Line</b> (or press <b>L</b>). Click the origin dot to start.",
          "For each line, type the <b>Length</b>, press <b>Tab</b>, type the <b>Angle</b>, press <b>Enter</b>:",
          "<b>75</b> Tab <b>0</b> Enter · <b>15</b> Tab <b>90</b> Enter · <b>12</b> Tab <b>180</b> Enter · <b>7</b> Tab <b>270</b> Enter · <b>60</b> Tab <b>120</b> Enter",
          "Then click the origin dot again to close the shape. It shades blue when it's closed.",
        ],
        when: "Typed lengths and angles give an exact shape. Angles count counter-clockwise from the right: 0 = right, 90 = up, 180 = left, 270 = down.",
        tip: "Made a mistake? Press Ctrl+Z to undo the last line.",
        check: (t) => t.sketchLines(6),
      },
      {
        title: "Extrude it both ways", tool: "Extrude", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" },
        how: [
          "Press <b>E</b>. The outline is picked.",
          TABS,
          "Direction: <b>Symmetric</b>. <b>Total distance 70</b>. Click <b>OK</b>.",
          "Press <b>Home</b> (under the view cube) to see the whole stand.",
          "Orbit around it: a base, a small lip at the front, and a slope for the phone to lean on.",
        ],
        when: "Symmetric extrudes the same amount each side of the sketch, so the part stays centered.",
        check: (t) => t.bodies().some((b) => b.node.t === "extrude" && t.box(b.id) && t.near(t.box(b.id).size.y, 70, 1)),
      },
      {
        title: "Round the edges", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "Click <b>Fillet</b> (or press <b>F</b>).",
          "Click the top edge of the slope and the top edges of the lip (the long edges that run front to back).",
          "Size <b>2</b>. Click <b>OK</b>.",
        ],
        when: "Rounded edges look finished and won't scratch your phone.",
        check: (t) => t.hasMod("fillet"),
      },
      {
        title: "Check the phone gap", tool: "Measure", icon: "measure", show: { sel: "#ad-measure" },
        how: [
          "Click <b>Measure</b>, then click the back face of the lip and the bottom of the slope where the phone sits.",
          "You should see 7 mm of lip height and room for the phone's bottom edge. Press <b>Esc</b> when done.",
        ],
        when: "Measure before printing: most phones in a case are 10-13 mm thick.",
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-pawn", mode: "advanced", level: "Proficient", minutes: "10-12", item: "Chess Pawn",
    title: "Chess pawn (revolve)",
    blurb: "Draw half of a pawn's side view and spin it around the center line with Revolve. Round the head with a big fillet and add a pocket underneath for a weight.",
    learn: ["Sketch on a plane", "Line with length and angle", "Revolve", "Fillet", "View cube", "Hole (depth)"],
    steps: [
      nameStep("Chess Pawn", "Lopez, Maria, Chess Pawn"),
      {
        title: "Sketch on the Front plane", tool: "Sketch", icon: "sketch", show: { sel: "#ad-sketch" },
        how: ["Click <b>Sketch</b>, then <b>XZ · Front</b>."],
        when: "Round parts (pawns, bottles, knobs, bowls) are drawn as half a side view and then spun around.",
        check: (t) => t.sketchOn("XZ"),
      },
      {
        title: "Draw half the outline", tool: "Line", icon: "line", show: { sel: "#sk-line" },
        how: [
          "Click <b>Line</b> (or press <b>L</b>) and click the origin dot.",
          "For each pair, type the <b>Length</b>, press <b>Tab</b>, type the <b>Angle</b>, press <b>Enter</b> (0 = right, 90 = up, 180 = left):",
          "<b>16</b>·0 &nbsp;<b>5</b>·90 &nbsp;<b>4</b>·180 &nbsp;<b>3</b>·90 &nbsp;<b>5</b>·180 &nbsp;<b>20</b>·90 &nbsp;<b>3</b>·0",
          "<b>3</b>·90 &nbsp;<b>4</b>·180 &nbsp;<b>3</b>·90 &nbsp;<b>3</b>·0 &nbsp;<b>14</b>·90 &nbsp;<b>9</b>·180",
          "Click the origin dot to close it. The left edge, straight up from the origin, is the pawn's center line.",
        ],
        when: "Typed lengths and angles give an exact outline. From the bottom: base, collar, stem, neck ring, head.",
        tip: "Lost your place? Ctrl+Z removes the last line. Count the lines: there are 14.",
        check: (t) => t.sketchLines(13),
      },
      {
        title: "Spin it with Revolve", tool: "Revolve", icon: "revolve", show: { sel: "#ad-revolve", via: "#ad-features" },
        how: [
          "Click <b>Finish sketch</b> (top right of the toolbar).",
          "Open <b>Advanced Create</b> ▾ and choose <b>Revolve</b>.",
          "Click inside the outline to pick it (it turns blue).",
          "Axis: under <b>…or use</b>, click <b>Z axis</b> (the center line).",
          "<b>Angle 360</b>. Click <b>OK</b>.",
        ],
        when: "Revolve spins a profile around an axis to make anything round. 360° is a full turn; less makes a slice, like a cake.",
        check: (t) => t.feat("revolve").length > 0,
      },
      {
        title: "Round the head", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "Press <b>Home</b> (under the view cube).",
          "Click <b>Fillet</b>, then click the <b>top edge of the head</b> (the circle around the top).",
          "Size <b>7</b>. Click <b>OK</b>. The flat top becomes a dome.",
        ],
        when: "A fillet almost as big as the radius turns a cylinder end into a ball shape.",
        check: (t) => t.hasMod("fillet"),
      },
      {
        title: "Soften the edges", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "<b>Fillet</b> again. Click the <b>top edge of the base</b> (the wide disk) and the <b>bottom edge of the head</b>.",
          "Size <b>1.5</b>. Click <b>OK</b>.",
        ],
        when: "Small fillets make a part look finished and feel nice in your hand.",
        check: (t) => t.countMods("fillet") >= 2,
      },
      {
        title: "A pocket for a weight", tool: "View cube + Hole", icon: "hole", show: { sel: "#ad-hole" },
        how: [
          "<b>Drag the view cube up</b> until you see the bottom of the pawn.",
          "Click <b>Hole</b>, then click the <b>bottom face</b>.",
          "Under <b>Position</b>, type <b>X 0</b> and <b>Y 0</b> (the center).",
          "<b>Diameter 10</b>. Extent: <b>Depth</b>, <b>Depth 8</b>. Click <b>OK</b>. Press <b>Home</b>.",
        ],
        when: "Real chess pieces are weighted so they don't tip over. Glue a coin or a nut into the pocket.",
        check: (t) => t.hasMod("hole"),
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-vase", mode: "advanced", level: "Proficient", minutes: "8-10", item: "Vase",
    title: "Lofted vase",
    blurb: "Stack three circles at different heights (narrow, wide, narrow), blend them into a curvy vase with Loft, then hollow it with Shell.",
    learn: ["Offset planes", "Sketch on a plane", "Circle", "Loft", "Shell"],
    steps: [
      nameStep("Vase", "Lopez, Maria, Vase"),
      {
        title: "Make two construction planes", tool: "Planes → Offset plane", icon: "planeOffset", show: { sel: "#ad-plane-off", via: "#ad-construct" },
        how: [
          "Open <b>Planes</b> ▾ and choose <b>Offset plane</b>.",
          TABS,
          "In the panel, click <b>XY · Top</b>, type <b>Distance 60</b>, click <b>OK</b>.",
          "Do it again: <b>Offset plane</b>, <b>XY · Top</b>, <b>Distance 120</b>, <b>OK</b>.",
        ],
        when: "Construction planes are invisible sheets you can sketch on, here at 60 mm and 120 mm up.",
        check: (t) => (t.doc().planes || []).length >= 2,
      },
      {
        title: "Bottom circle", tool: "Sketch → Circle", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "Click <b>Sketch</b> → <b>XY · Top</b>.",
          "<b>Circle</b>: click the origin, type <b>60</b>, <b>Enter</b>.",
          "Click <b>Finish sketch</b>.",
        ],
        when: "The bottom profile sets the base: 60 mm wide.",
        check: (t) => t.sketchCircle(30),
      },
      {
        title: "Middle circle", tool: "Sketch → Circle", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "Click <b>Sketch</b>, then choose <b>Plane 1</b> (the 60 mm plane) in the panel's list.",
          "<b>Circle</b>: click the origin, type <b>90</b>, <b>Enter</b>.",
          "Click <b>Finish sketch</b>.",
        ],
        when: "The middle profile makes the belly of the vase: wider than the base, so the sides curve out.",
        check: (t) => t.sketchCircle(45),
      },
      {
        title: "Top circle", tool: "Sketch → Circle", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "Click <b>Sketch</b>, then choose <b>Plane 2</b> (the 120 mm plane) in the list.",
          "<b>Circle</b>: click the origin, type <b>50</b>, <b>Enter</b>. <b>Finish sketch</b>.",
        ],
        when: "The top profile sets the opening.",
        check: (t) => t.sketchCircle(25),
      },
      {
        title: "Loft them together", tool: "Loft", icon: "loft", show: { sel: "#ad-loft", via: "#ad-features" },
        how: [
          "Open <b>Advanced Create</b> ▾ and choose <b>Loft</b>.",
          "Click inside the circles, a little away from the center dot. The first click picks the <b>top circle</b>; click the same spot again for the <b>middle circle</b>, and once more for the <b>bottom circle</b>. The panel lists 3 sections.",
          "Shape: <b>Smooth</b>. Click <b>OK</b>.",
        ],
        tip: "Press Home (under the view cube) to look at your vase from the side.",
        when: "Loft blends between shapes on different planes: bottles, vases, boat hulls, nozzles. (Try a square or hexagon in the middle another time: Loft can blend different shapes too.)",
        check: (t) => t.bodies().some((b) => b.node.t === "loft"),
      },
      {
        title: "Hollow it with Shell", tool: "Shell", icon: "shell", show: { sel: "#ad-shell" },
        how: [
          "Click <b>Shell</b>.",
          "Click the <b>top face</b> of the vase (that face is removed to make the opening).",
          "<b>Thickness 2</b>, Direction <b>Inside</b>. Click <b>OK</b>.",
        ],
        when: "Shell hollows a solid into walls of even thickness, leaving open the faces you pick.",
        tip: "Hide the sketches and planes (eye icons in the Browser) to see the vase clearly.",
        check: (t) => t.hasMod("shell"),
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-hook", mode: "advanced", level: "Proficient", minutes: "10-13", item: "Wall Hook",
    title: "Wall hook with screw holes",
    blurb: "A J-shaped hook drawn from its side view, made strong with fillets, with countersunk holes so the screws sit flush. Then the Print Sim shows the strongest way to print it.",
    learn: ["Sketch", "Line with length and angle", "Extrude (Symmetric)", "Fillet", "Hole (countersink)", "3D Print Sim orientation"],
    steps: [
      nameStep("Wall Hook", "Lopez, Maria, Wall Hook"),
      {
        title: "Sketch on the Front plane", tool: "Sketch", icon: "sketch", show: { sel: "#ad-sketch" },
        how: ["Click <b>Sketch</b>, then <b>XZ · Front</b>."],
        when: "The hook's shape is its side view: a back plate, a bottom arm and a tip.",
        check: (t) => t.sketchOn("XZ"),
      },
      {
        title: "Draw the J shape", tool: "Line", icon: "line", show: { sel: "#sk-line" },
        how: [
          "Click <b>Line</b> and click the origin dot.",
          "Length <b>Tab</b> Angle <b>Enter</b> for each: <b>60</b>·90 &nbsp;<b>5</b>·0 &nbsp;<b>55</b>·270 &nbsp;<b>20</b>·0 &nbsp;<b>15</b>·90 &nbsp;<b>5</b>·0 &nbsp;<b>20</b>·270",
          "Click the origin dot to close it.",
        ],
        when: "Up the back, over the top, down the inside, along the arm, up the tip and back down. 270 means straight down.",
        check: (t) => t.sketchLines(8),
      },
      {
        title: "Give it width", tool: "Extrude (Symmetric)", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" },
        how: [
          "Press <b>E</b>. Direction <b>Symmetric</b>, <b>Total distance 20</b>. <b>OK</b>.",
          "Press <b>Home</b> to look at it.",
        ],
        when: "20 mm wide is plenty for keys, bags or a jacket.",
        check: (t) => t.feat("extrude").some((b) => t.box(b.id) && t.near(t.box(b.id).size.y, 20, 0.6) && t.near(t.box(b.id).size.z, 60, 1)),
      },
      {
        title: "Strengthen the bend", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "Click <b>Fillet</b>, then click the <b>inside corner</b> where the back plate meets the bottom arm.",
          "Size <b>4</b>. Click <b>OK</b>.",
        ],
        when: "Sharp inside corners are where parts crack under load. A fillet spreads the force out: always round inside corners on hooks and brackets.",
        check: (t) => t.hasMod("fillet"),
      },
      {
        title: "Round the tips", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "<b>Fillet</b> again. Click the two top edges of the back plate and the two top edges of the hook's tip.",
          "Size <b>2</b>. Click <b>OK</b>.",
        ],
        when: "Rounded tips won't snag clothes or scratch your hand.",
        check: (t) => t.countMods("fillet") >= 2,
      },
      {
        title: "Top screw hole", tool: "Hole (Countersink)", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: [
          "Click <b>Hole</b>, then click the <b>front of the back plate</b> (the tall flat face facing the hook).",
          "Hole type: <b>Countersink</b>. Screw size: <b>M4</b>.",
          "Position: <b>Y 0</b>, <b>Z 45</b>. Keep <b>Through all</b>. Click <b>OK</b>.",
        ],
        when: "A countersink is a cone at the top of the hole so a flat-head screw sits flush, below the surface.",
        check: (t) => t.countMods("hole") >= 1,
      },
      {
        title: "Bottom screw hole", tool: "Hole (Countersink)", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: [
          "<b>Hole</b> again on the same face: <b>Countersink</b>, <b>M4</b>.",
          "Position: <b>Y 0</b>, <b>Z 22</b>. <b>OK</b>.",
        ],
        when: "Two screws stop the hook from turning on the wall.",
        check: (t) => t.countMods("hole") >= 2,
      },
      {
        title: "Find the strongest way to print it", tool: "3D Print Sim", icon: "eye", show: { sel: "#ws-print" }, anim: "printsim",
        how: [
          "Click <b>3D Print Sim</b> at the top left (next to Design).",
          "Read the <b>Orientation advice</b>. <b>Strongest</b> lays the hook on its side, so the printed layers run along the bend instead of across it.",
          "Click <b>Use this</b> on Strongest and press <b>▶ Play print</b> to watch.",
          "Click <b>Design</b> to go back. (The sim never changes your design.)",
        ],
        when: "Printed parts are weakest between layers. Turn the part so the force pulls along the layers, not across them.",
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-drawer", mode: "advanced", level: "Advanced", minutes: "12-15", item: "Box With Drawer",
    title: "Box with a sliding drawer",
    blurb: "Sketch a rounded case that's open at the front and a drawer with a handle, sized with a small gap so it slides. Test the fit, then lay them out to print.",
    learn: ["Center rectangle", "Extrude", "Fillet", "Shell", "Clearance", "Sketch on a face", "Move/Copy", "Undo"],
    steps: [
      nameStep("Box With Drawer", "Lopez, Maria, Box With Drawer"),
      {
        title: "Sketch the case", tool: "Sketch → Center rectangle", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "rect",
        how: [
          "Click <b>Sketch</b> → <b>XY · Top</b>.",
          "Click <b>Rectangle</b> (or press <b>R</b>) and choose <b>Center</b> in the panel.",
          "Click the origin dot, then type <b>80</b>, <b>Tab</b>, <b>70</b>, <b>Enter</b>.",
        ],
        when: "A center rectangle grows out from the point you click, so the part ends up centered on the origin.",
        check: (t) => t.sketchRect(80, 70),
      },
      {
        title: "Extrude the case", tool: "Extrude", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" },
        how: ["Press <b>E</b>, Distance <b>50</b>, <b>OK</b>."],
        when: "Start with the outside size of the finished part.",
        check: (t) => t.feat("extrude").some((b) => { const x = t.box(b.id); return x && t.near(x.size.x, 80, 1) && t.near(x.size.z, 50, 1); }),
      },
      {
        title: "Round the corners", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: [
          "Press <b>Home</b>. Click <b>Fillet</b> (or press <b>F</b>).",
          "Click the <b>4 upright edges</b> at the corners of the box (drag the view cube to reach the back ones).",
          "Size <b>4</b>. <b>OK</b>.",
        ],
        when: "Round the outside first, while the box is still solid: the walls made next follow the curves.",
        check: (t) => t.hasMod("fillet"),
      },
      {
        title: "Open the front", tool: "Shell", icon: "shell", show: { sel: "#ad-shell" },
        how: [
          "Press <b>Home</b> so you look at the front.",
          "Click <b>Shell</b>, then click the <b>front face</b> of the box (the one facing you).",
          "<b>Thickness 3</b>, <b>Inside</b>. <b>OK</b>. The box is now a hollow case open at the front.",
        ],
        when: "Shell with one face removed is the quickest way to make cases, cups and drawers.",
        check: (t) => t.hasMod("shell"),
      },
      {
        title: "Sketch the drawer beside it", tool: "Sketch → Center rectangle", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "rect",
        how: [
          "Click <b>Sketch</b> → <b>XY · Top</b>. Zoom out (scroll wheel or pinch) so you can see to the right of the case.",
          "<b>Rectangle</b> → <b>Center</b>. Move right along the red X axis until the label by the cursor says <b>100, 0 mm</b>, then click.",
          "Type <b>73</b>, <b>Tab</b>, <b>62</b>, <b>Enter</b>.",
          "The opening is 74 × 44 mm, so the drawer will have a 0.5 mm gap on each side.",
        ],
        when: "Parts that slide need a gap (clearance) or they print stuck together. 0.4-0.5 mm per side suits most printers.",
        check: (t) => t.sketchRect(73, 62),
      },
      {
        title: "Extrude the drawer", tool: "Extrude", icon: "extrude", show: { sel: "#sk-extrude, #ad-extrude" },
        how: [
          "Press <b>E</b>, Distance <b>43</b>.",
          "The panel says <b>Will create a new body</b>: it doesn't touch the case. <b>OK</b>.",
        ],
        when: "Automatic picks the operation for you: join when the sketch touches a body, a new body when it doesn't.",
        check: (t) => t.feat("extrude").some((b) => { const x = t.box(b.id); return x && t.near(x.size.x, 73, 1) && t.near(x.size.z, 43, 1); }),
      },
      {
        title: "Hollow the drawer", tool: "Shell", icon: "shell", show: { sel: "#ad-shell" },
        how: ["Click <b>Fit all</b> (under the view cube) to see both parts. <b>Shell</b> → click the drawer's <b>top face</b> → <b>Thickness 2</b> → <b>OK</b>."],
        when: "Same tool, different open face: now it's a tray.",
        check: (t) => t.countMods("shell") >= 2,
      },
      {
        title: "A handle on the front", tool: "Sketch on a face + Extrude", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "Click <b>Sketch</b>, then click the drawer's <b>front face</b> (the side facing you).",
          "<b>Rectangle</b> → <b>Center</b>. Click a little above the middle of the face. Type <b>30</b>, <b>Tab</b>, <b>8</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>8</b>. It says <b>Will join the body it touches</b>. <b>OK</b>.",
        ],
        when: "A sketch on a face, extruded outward, adds a feature that's part of that body: here a handle that prints with the drawer.",
        check: (t) => t.extrudeMod("join"),
      },
      {
        title: "Test the fit", tool: "Transform → Move/Copy", icon: "move", show: { sel: "#ad-move", via: "#ad-transform" },
        how: [
          "Click the drawer to select it.",
          "<b>Transform</b> ▾ → <b>Move/Copy</b> (or press <b>M</b>). Move by <b>X -100</b>, <b>Y 0</b>, <b>Z 3.5</b>. <b>OK</b>.",
          "The drawer slides into the case. Orbit around: there's a thin, even gap all the way round, and the handle sticks out the front.",
        ],
        when: "Check that parts fit on screen before printing them. It costs nothing to fix a size now.",
        check: (t) => t.bodies().some((b) => b.node.mods && b.node.mods.some((m) => m.t === "bool") && t.box(b.id) && Math.abs(t.box(b.id).center.x) < 5),
      },
      {
        title: "Lay them out to print", tool: "Undo", icon: "move", show: { sel: "#btn-undo" },
        how: [
          "Press <b>Ctrl+Z</b> (or click <b>Undo</b> at the top) to slide the drawer back out beside the case.",
          "Print the case and the drawer side by side, then slide the drawer in.",
        ],
        when: "Undo steps back one change at a time. Moving parts apart for printing keeps them from fusing together.",
        check: (t) => t.bodies().some((b) => b.node.mods && b.node.mods.some((m) => m.t === "bool") && t.box(b.id) && t.box(b.id).min.x > 40),
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-candy", mode: "advanced", level: "Advanced", minutes: "12-15", item: "Candy Jar",
    title: "Candy jar with a screw-on lid",
    blurb: "Sketch a round jar, add a neck by sketching on its top face, and cut a matching lid. Real screw threads inside and out, ready to print.",
    learn: ["Sketch", "Sketch on a face", "Extrude (Join, Cut)", "Shell", "Thread (outside and inside)", "Print offset"],
    steps: [
      nameStep("Candy Jar", "Lopez, Maria, Candy Jar"),
      {
        title: "The jar", tool: "Sketch → Circle + Extrude", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "Click <b>Sketch</b> → <b>XY · Top</b>. <b>Circle</b>: click the origin, type <b>60</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>60</b>, <b>OK</b>.",
        ],
        when: "Sketch then extrude: the two steps behind most parts.",
        check: (t) => t.feat("extrude").some((b) => { const x = t.box(b.id); return x && t.near(x.size.x, 60, 1) && x.size.z > 59; }),
      },
      {
        title: "The neck, sketched on top", tool: "Sketch on a face", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "faceSketch",
        how: [
          "Press <b>Home</b>. Click <b>Sketch</b>, then click the jar's <b>top face</b>.",
          "<b>Circle</b>: move to the middle until the label says <b>Point · 0, 0</b>, click, type <b>48</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>12</b>. It says <b>Will join the body it touches</b>. <b>OK</b>.",
        ],
        when: "Sketching on a face starts the new feature exactly where the old one ends, and joins them into one body.",
        check: (t) => t.extrudeMod("join"),
      },
      {
        title: "Hollow the jar", tool: "Shell", icon: "shell", show: { sel: "#ad-shell" },
        how: ["<b>Shell</b> → click the <b>top face of the neck</b> → <b>Thickness 4</b> → <b>OK</b>."],
        when: "4 mm walls leave enough plastic for the thread to be cut into the neck.",
        check: (t) => t.hasMod("shell"),
      },
      {
        title: "Thread the neck", tool: "Thread", icon: "thread", show: { sel: "#ad-thread", via: "#ad-features" },
        how: [
          "<b>Advanced Create</b> ▾ → <b>Thread</b>.",
          "Click the <b>outside of the neck</b>.",
          "Size: <b>Custom pitch</b>. <b>Pitch 3</b>. Keep <b>Full length</b>. Print offset: <b>-0.2 mm</b>. <b>OK</b> (it takes a few seconds).",
        ],
        when: "Threads turn a twist into a tight hold. Pitch is the distance between ridges; 3 mm is chunky and prints well.",
        check: (t) => t.countMods("thread") >= 1,
      },
      {
        title: "The lid", tool: "Sketch → Circle + Extrude", icon: "circle", show: { sel: "#ad-sketch" },
        how: [
          "Click <b>Sketch</b> → <b>XY · Top</b>. Zoom out so you can see to the right of the jar.",
          "<b>Circle</b>: move right along the red X axis until the label says <b>80, 0 mm</b>, click, type <b>58</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>16</b>, <b>OK</b>. A new body beside the jar.",
        ],
        when: "The lid is printed upside down: the bottom you see now becomes its top.",
        check: (t) => t.feat("extrude").some((b) => { const x = t.box(b.id); return x && t.near(x.size.x, 58, 1) && t.near(x.size.z, 16, 1); }),
      },
      {
        title: "Cut the hole in the lid", tool: "Sketch on a face + Extrude (Cut)", icon: "sketch", show: { sel: "#ad-sketch" }, anim: "cut",
        how: [
          "Click <b>Fit all</b> (under the view cube). Click <b>Sketch</b>, then the lid's <b>top face</b>.",
          "<b>Circle</b>: click the center (<b>Point · 0, 0</b>), type <b>44.8</b>, <b>Enter</b>.",
          "Press <b>E</b>, Distance <b>-12</b> (into the lid). It says <b>Will cut</b>. <b>OK</b>. That leaves a 4 mm top.",
        ],
        when: "A hole for an inside thread is smaller than the bolt: 48 − (1.08 × pitch 3) ≈ 44.8 mm, so the two threads mesh.",
        check: (t) => t.extrudeMod("cut"),
      },
      {
        title: "Thread the lid", tool: "Thread", icon: "thread", show: { sel: "#ad-thread", via: "#ad-features" },
        how: [
          "<b>Thread</b> again. Click the <b>inside wall</b> of the lid's hole.",
          "<b>Custom pitch</b>, <b>Pitch 3</b>, <b>Full length</b>, Print offset <b>-0.2 mm</b>. <b>OK</b>.",
        ],
        when: "Same pitch on both parts, or they won't screw together. The print offset gives a little play so printed threads turn smoothly.",
        check: (t) => t.countMods("thread") >= 2,
      },
      saveStep(),
      exportStep(),
    ],
  },
  {
    id: "a-cup", mode: "advanced", level: "Proficient", minutes: "12-15", item: "Turned Cup",
    title: "Turned cup (Lathe)",
    blurb: "Turn a tapered cup with a decorative groove on the virtual lathe, hollow it out, export it, then scale it in Advanced.",
    learn: ["Lathe", "Round blank", "Point tool", "Hollow", "3MF export", "Scale"],
    steps: [
      nameStep("Turned Cup", "Lopez, Maria, Turned Cup"),
      {
        title: "Open the Lathe", tool: "Lathe", icon: "lathe", show: { sel: "#ad-lathe" }, anim: false,
        how: [
          "On the <b>Create</b> tab, click <b>Lathe</b>.",
          "The Lathe opens over the whole screen with a window asking <b>What do you want to turn?</b>",
        ],
        when: "A lathe makes round things: it spins the wood while you hold a chisel against it, so everything you cut comes out perfectly round. Bowls, cups, bats, pens, chess pieces and tops are all turned.",
        tip: "Your design is safe: nothing changes until you press Add to design.",
        check: (t) => t.latheOpen(),
      },
      {
        title: "Put a round blank on the lathe", tool: "Round blank", icon: "cylinder", show: { sel: "#lathe-start" }, anim: false,
        how: [
          "Choose <b>Round blank</b>.",
          "Type <b>Diameter 60</b> and <b>Length 90</b>. Material: <b>Cherry</b>.",
          "Click <b>Put it on the lathe</b>.",
        ],
        when: "A round blank is already a cylinder, so you can go straight to shaping.",
        check: (t) => t.latheWork((w, st) => st.src === "round" && t.near(w.L, 90, 1) && t.near(st.blank.d, 60, 1)),
      },
      {
        title: "Turn the lathe on", tool: "Foot pedal", icon: "lathe", show: { sel: "#lathe-pedalmode" }, anim: false,
        how: [
          "In the toolbar, under <b>Foot pedal</b>, choose <b>Stays on</b>.",
          "Tap the <b>Space</b> bar once (or press the big <b>Start</b> button at the bottom right). The work starts spinning and the speed shows next to it.",
          "Tap <b>Space</b> again whenever you want to stop. (With <b>Hold</b>, it only spins while you hold Space down, like a real foot pedal.)",
        ],
        when: "The chisel only cuts while the work is spinning. If you press on the wood while it's stopped, a red note reminds you to start it.",
        tip: "Higher speed (the Speed slider) cuts faster. Start around 1200 rpm.",
        check: (t) => t.latheSpinning(),
      },
      {
        title: "Taper the outside", tool: "Roughing gouge", icon: "lathe", show: { sel: "#lathe-tool" }, anim: false,
        how: [
          "Pick <b>Roughing gouge</b>, <b>Angle 0°</b>.",
          "The right end (tailstock) will be the cup's rim, so leave it full size.",
          "Press and hold at the <b>left end</b>, pointing about 8 mm inside the outline, until it's about <b>44 mm across</b> there. Then drag slowly to the right while easing out, so the cup gets wider toward the rim.",
        ],
        when: "Shaping the outside comes first, while the wood is solid and stiff.",
        check: (t) => t.latheWork((w) => t.rAt(w, 0.08) < 25 && t.rAt(w, 0.92) > 27),
      },
      {
        title: "Cut a decorative groove", tool: "Point tool (V)", icon: "lathe", show: { sel: "#lathe-tool" }, anim: false,
        how: [
          "Pick <b>Point tool (V)</b>, <b>Angle 0°</b>.",
          "About a third of the way from the right end, point about 3 mm inside the outline and press and hold for a moment to cut a V groove. Don't drag.",
          "Want more? Add a second groove a little further along.",
        ],
        when: "Grooves and beads are classic lathe decoration, and they give your fingers something to grip.",
        check: (t) => t.latheWork((w) => { const k = Math.round(5 / w.du); for (let i = k; i < w.N - k; i++) if (w.rowMax[i] < (w.rowMax[i - k] + w.rowMax[i + k]) / 2 - 1.5) return true; return false; }),
      },
      {
        title: "Hollow it out", tool: "Done → Hollow it out", icon: "shell", show: { sel: "#lathe-done" }, anim: false,
        how: [
          "Click <b>Done</b>, then tick <b>Hollow it out</b>.",
          "Open end: <b>Tailstock (right)</b>. Inside: <b>Follows the outside</b>. <b>Wall 3</b>, <b>Bottom 6</b>.",
          "The preview cuts the front half away so you can see the inside of your cup.",
        ],
        when: "Hollowing makes it a cup instead of a solid post. A 3 mm wall is strong when 3D printed.",
        check: (t) => { const u = t.lathe(); return (u && u.st.hollow.on && !!u.root.querySelector(".lathe-done-back")) || t.turned().some((b) => b.turned.hollow); },
      },
      {
        title: "Export it from the lathe", tool: "Export 3MF", icon: "import", show: { sel: "#lathe-exp-3mf" }, anim: false,
        how: [
          "In the same panel, next to <b>Export</b>, click <b>3MF</b>. The cup (hollowed) is saved as a file you can open in a slicer.",
          "STL and OBJ work the same way.",
        ],
        when: "Exporting from the lathe saves just the turned part. 3MF keeps millimeters and color; STL is the most common for printing; OBJ opens in most 3D apps.",
        check: (t) => t.exported("3mf"),
      },
      {
        title: "Add it to your design", tool: "Add to design", icon: "finish", show: { sel: "#lathe-add" }, anim: false,
        how: ["Click <b>Add to design</b>. The Lathe closes and your hollow cup appears in Advanced as a mesh body."],
        when: "In your design, the cup can be moved, scaled, combined with other parts and sliced, like any body.",
        check: (t) => t.turned().some((b) => b.turned.hollow),
      },
      {
        title: "Make it 10% bigger", tool: "Transform → Scale", icon: "scale", show: { sel: "#ad-scale", via: "#ad-transform" },
        how: [
          "Click the cup to select it.",
          "Under <b>Modify</b>, open <b>Transform</b> and click <b>Scale</b>. Keep <b>Uniform</b> ticked, type <b>Factor 1.1</b> and click <b>OK</b>.",
        ],
        when: "A turned part is a mesh, so you change its size by scaling it rather than with sketch dimensions.",
        check: (t) => t.turned().some((b) => (b.node.mods || []).some((m) => m.t === "scale")),
      },
      saveStep(),
      exportStep(),
    ],
  },
];
