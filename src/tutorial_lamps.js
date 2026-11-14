// Version 2.9.8.8: LED lamp projects (three kinds, in Beginner and in Advanced) and more projects
// for both modes. Same step format as tutorial_data.js.
//   Push-light lamp: a base that slips over a 2.75" (68.8 mm wide, 18 mm tall) LED push light, with
//     a slot for an edge-lit acrylic panel the student also designs (and exports for the laser cutter)
//   LED strip lantern: a post for a 10 mm wide LED strip, a cable path, and a textured shade
//   Hanging lantern: a pendant shade that holds the push light, with windows and a cord hole
import { nameStep, saveStep, exportStep, FIELDS, TABS } from "./tutorial_data.js";

const near = (a, b, tol = 1) => Math.abs((+a || 0) - b) <= tol;
const sz = (t, b) => (t.box(b.id) || {}).size || { x: 0, y: 0, z: 0 };
const sized = (t, w, d, h, tol = 1.5) => t.bodies().some((b) => {
  const x = t.box(b.id);
  return x && near(x.size.z, h, tol) && ((near(x.size.x, w, tol) && near(x.size.y, d, tol)) || (near(x.size.x, d, tol) && near(x.size.y, w, tol)));
});
const prim = (t, kind, hole, fn) => t.prim(kind, hole).some((b) => fn(b.node.p, b));
const groupSized = (t, w, d, h, holes = 1, tol = 1.5) => t.groups().some((g) => { const s = sz(t, g); return t.countHoles(g) >= holes && near(s.z, h, tol) && ((near(s.x, w, tol) && near(s.y, d, tol)) || (near(s.x, d, tol) && near(s.y, w, tol))); });
const cuts = (t) => { let n = 0; for (const b of t.bodies()) for (const m of b.node.mods || []) if (m.t === "bool" && m.tool && m.tool.t === "extrude" && m.op === "cut") n++; return n; };
const textured = (t, keys) => t.bodies().some((b) => (b.textures || []).some((x) => !keys || keys.includes(x.tex)));
const mods = (t, kind) => t.countMods(kind);
const SEASON = "Pick a group (<b>Seasons</b>, <b>Holidays</b>, <b>Celebrations</b> or <b>Animals</b>) and a picture texture you like, for example <b>Snowflakes</b>.";

// the laser file for the acrylic panel, and an STL of just the printed parts
const laserStep = (what) => ({
  title: "Laser file for the acrylic", tool: "Open/Export → Laser cut file", icon: "import", show: { sel: "#btn-export" },
  how: [`Select ${what} only (click it).`, "Click <b>Open/Export</b> and choose <b>Laser cut file .svg</b> (or <b>.dxf</b> if your laser software prefers it).",
    "In the file, <b>red lines</b> are cut right through and <b>black areas</b> are engraved. Hand it to whoever runs the laser cutter, with <b>3 mm (1/8\") clear acrylic</b>."],
  when: "A laser cutter cuts acrylic with perfectly smooth, clear edges, which is what makes an edge-lit panel glow. Engraved lines catch the light and shine.",
  tip: "The file is made from the part itself, so what you see is what gets cut. Keep the panel flat on the ground (3 mm thick) for the best file.",
  check: (t) => t.exported("laser"),
});
const stlOfStep = (what) => ({
  ...exportStep(),
  title: "Export the printed part as an STL",
  how: [`Select ${what} (click it) so only it goes in the file. The acrylic panel isn't printed.`, "Click <b>Open/Export</b> → <b>STL for 3D printing</b>."],
});

export const LAMP_TUTORIALS = [
  // ============================================================== BEGINNER: LED lamps
  {
    id: "b-lamp-push", mode: "beginner", level: "Advanced", minutes: "18-22", item: "Push Light Lamp",
    title: "LED lamp: glowing acrylic panel",
    blurb: "A round base that slips over a 2.75 inch LED push light (68.8 mm wide, 18 mm tall), with a slot for an edge-lit acrylic panel. You design the panel too, with your name and a picture that glow, and export it for the laser cutter.",
    learn: ["Cylinder", "Cylinder holes (pockets)", "Box hole (slot)", "Group", "Text as a hole (engrave)", "Laser cut file", "Clearance"],
    steps: [
      nameStep("Push Light Lamp", "Lopez, Maria, Push Light Lamp"),
      {
        title: "The base", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Click the <b>Cylinder</b> tile.", FIELDS, "Size: <b>Width 75</b>, <b>Depth 75</b>, <b>Height 31</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "The base is built upside down, the way it prints: the flat bottom here is the top of the lamp. It slips over the push light like a cap, so tapping the lamp presses the light's button.",
        check: (t) => prim(t, "cylinder", false, (p) => near(p.w, 75) && near(p.h, 31)),
      },
      {
        title: "A pocket for the light", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true }, anim: "holeBox",
        how: ["Click <b>Holes</b> at the left of the strip, then the <b>Cylinder</b> tile.", "Size: <b>Width 69.6</b>, <b>Depth 69.6</b>, <b>Height 18.5</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 12.5</b>."],
        when: "The light is 68.8 mm wide and 18 mm tall. 0.8 mm extra (0.4 each side) is the clearance that lets it slide in, because printed holes come out a little small.",
        check: (t) => prim(t, "cylinder", true, (p) => near(p.w, 69.6, 0.6) && near(p.h, 18.5, 1)),
      },
      {
        title: "A pocket for its lens", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true }, anim: "holeBox",
        how: ["Add another <b>Cylinder</b> hole: <b>Width 44</b>, <b>Depth 44</b>, <b>Height 6.5</b>.", "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 6.5</b>, right under the first pocket."],
        when: "The push light's dome (its lens and button) pokes into this smaller pocket, close to where the panel stands.",
        check: (t) => prim(t, "cylinder", true, (p) => near(p.w, 44, 0.6) && near(p.h, 6.5, 0.6)),
      },
      {
        title: "The slot for the panel", tool: "Holes → Box", icon: "holeToggle", show: { tile: "box", hole: true }, anim: "holeBox",
        how: ["Add a <b>Box</b> hole: <b>Width 42.6</b>, <b>Depth 3.6</b>, <b>Height 8</b>.", "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) -0.5</b>, so it cuts right through the top into the lens pocket."],
        when: "The acrylic is 3 mm (1/8\") thick and its tab 41.5 mm wide. The slot is about 0.5 mm bigger each way so the panel drops in, and the light shines straight up into the panel's bottom edge.",
        check: (t) => prim(t, "box", true, (p) => near(p.w, 42.6, 0.6) && near(p.d, 3.6, 0.4)),
      },
      {
        title: "Group the base", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b> to select everything (only the base so far), then click <b>Group</b>."],
        when: "Group now, before you start the panel, so the panel doesn't get grouped into the base.",
        check: (t) => groupSized(t, 75, 75, 31, 3),
      },
      {
        title: "The acrylic panel", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Click <b>Objects</b>, then the <b>Cylinder</b> tile.", "Size: <b>Width 120</b>, <b>Depth 120</b>, <b>Height 3</b>. Position: <b>X 130</b>, <b>Y 60</b>, <b>Z 0</b>."],
        when: "The panel lies flat beside the base: that's how the laser cutter sees it. 3 mm is the thickness of the acrylic sheet.",
        check: (t) => prim(t, "cylinder", false, (p) => near(p.w, 120, 1) && near(p.h, 3, 0.4)),
      },
      {
        title: "The panel's tab", tool: "Box", icon: "box", show: { tile: "box" }, anim: "tile",
        how: ["Add a <b>Box</b>: <b>Width 41.5</b>, <b>Depth 16</b>, <b>Height 3</b>.", "Position: <b>X 130</b>, <b>Y 0</b>, <b>Z 0</b>. Its top half overlaps the bottom of the circle."],
        when: "The tab stands in the slot. It's 8 mm long below the circle: through the 6.5 mm top of the base and just into the lens pocket, close to the light.",
        check: (t) => prim(t, "box", false, (p) => near(p.w, 41.5, 0.6) && near(p.d, 16, 0.6) && near(p.h, 3, 0.4)),
      },
      {
        title: "Engrave your name", tool: "Text → Hole", icon: "text", show: { tile: "text" }, anim: "tile",
        how: ["Click the <b>Text</b> tile. Type your first name and press <b>Enter</b>.", "<b>Letter size 12</b>, <b>Height 1</b>. Position: <b>X 130</b>, <b>Y 25</b>, <b>Z (bottom) 2.5</b>.", "Click <b>Hole</b> in the toolbar: the letters become a hole, cut 0.5 mm into the top of the panel."],
        when: "The laser engraves wherever the panel's top is cut away. Engraved lines catch the light in the acrylic and glow.",
        check: (t) => t.prim("text", true).length > 0,
      },
      {
        title: "Engrave a picture", tool: "Star (or Heart) → Hole", icon: "holeToggle", show: { tile: "star", hole: true }, anim: "holeBox",
        how: ["Click <b>Holes</b>, then the <b>Star</b> tile (or <b>Heart</b>).", "Size: <b>Width 45</b>, <b>Depth 45</b>, <b>Height 1</b>. Position: <b>X 130</b>, <b>Y 70</b>, <b>Z (bottom) 2.5</b>."],
        when: "Simple, bold shapes glow best. Add more holes if you like: small stars, hearts, a moon. Keep them inside the circle.",
        check: (t) => t.prim("star", true).length + t.prim("heart", true).length > 0,
      },
      {
        title: "Group the panel", tool: "Shift+click + Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Click the panel's <b>tab</b> first. Then hold <b>Shift</b> and click the <b>circle</b>, the <b>star</b> and <b>one of the letters</b> of your name. (On a tablet, tap <b>Multi-select</b> first instead of holding Shift.)", "Check the panel on the right says <b>4 selected</b>, then click <b>Group</b>."],
        when: "Grouped, the holes cut into the panel. It's now one flat part, ready for the laser file. (Ctrl+A would also pick the base, which must stay separate.) Start with the tab: once the big circle is selected, its resize handles sit right on top of the tab.",
        check: (t) => t.groups().some((g) => { const s = sz(t, g); return near(s.z, 3, 0.4) && near(s.x, 120, 1.5) && near(s.y, 128, 1.5) && t.countHoles(g) >= 2; }),
      },
      laserStep("the panel"),
      {
        title: "Put it together", tool: "Tip", icon: "eye", show: { sel: "#bb-printsim" },
        how: ["Print the base as it is (flat side down, no supports). Peel the paper off the acrylic.", "Put the push light on the table, lens up. Set the base over it, slot on top, and drop the panel's tab into the slot.", "Press down on the base to click the light on and off."],
        when: "Edge lighting: the light goes into the panel's edge, bounces along inside the clear acrylic, and comes out only where it's engraved.",
        tip: "If the light is loose, add a strip of tape around it. If the panel wobbles, a little hot glue in the slot holds it.",
      },
      saveStep(), stlOfStep("the base"),
    ],
  },
  {
    id: "b-lamp-strip", mode: "beginner", level: "Proficient", minutes: "14-18", item: "LED Strip Lantern",
    title: "LED lamp: LED strip lantern",
    blurb: "A lantern lit by a 10 mm wide LED strip wound around a center post, with a channel for the cable and a shade with a seasonal picture texture that glows when it's on.",
    learn: ["Cylinder", "Tube", "Holes (cable path)", "Group", "Clearance", "Texture (picture themes)"],
    steps: [
      nameStep("LED Strip Lantern", "Lopez, Maria, LED Strip Lantern"),
      {
        title: "The base", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Click the <b>Cylinder</b> tile.", FIELDS, "Size: <b>Width 100</b>, <b>Depth 100</b>, <b>Height 12</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "A wide, heavy base keeps the lantern from tipping.",
        check: (t) => prim(t, "cylinder", false, (p) => near(p.w, 100) && near(p.h, 12, 0.6)),
      },
      {
        title: "The post for the LED strip", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Add a <b>Cylinder</b>: <b>Width 40</b>, <b>Depth 40</b>, <b>Height 80</b>.", "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 12</b>, standing on the base."],
        when: "Each turn around a 40 mm post uses about 126 mm of strip, so a 1 m, 10 mm wide strip makes about 8 turns, filling the 80 mm post.",
        check: (t) => prim(t, "cylinder", false, (p) => near(p.w, 40) && near(p.h, 80)),
      },
      {
        title: "A channel for the cable", tool: "Holes → Box", icon: "holeToggle", show: { tile: "box", hole: true }, anim: "holeBox",
        how: ["Add a <b>Box</b> hole: <b>Width 60</b>, <b>Depth 12</b>, <b>Height 6</b>.", "Position: <b>X 30</b>, <b>Y 0</b>, <b>Z (bottom) -1</b>: from the middle out through the side, under the base."],
        when: "The USB cable (or battery box wires) runs under the base and out the side, so the lantern sits flat.",
        check: (t) => prim(t, "box", true, (p) => near(p.w, 60, 1) && near(p.d, 12, 0.6)),
      },
      {
        title: "A hole down the post", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true }, anim: "holeBox",
        how: ["Add a <b>Cylinder</b> hole: <b>Width 10</b>, <b>Depth 10</b>, <b>Height 95</b>.", "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 2</b>."],
        when: "The strip's wire goes in at the top of the post and down to the channel. Wind the strip down the post from the top.",
        check: (t) => prim(t, "cylinder", true, (p) => near(p.w, 10, 0.6) && near(p.h, 95, 2)),
      },
      {
        title: "A ring to hold the shade", tool: "Tube", icon: "cylinder", show: { tile: "tube" }, anim: "tile",
        how: ["Click <b>Objects</b>, then the <b>Tube</b> tile.", "Size: <b>Width 85.2</b>, <b>Depth 85.2</b>, <b>Height 4</b>, <b>Wall 3</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 12</b>."],
        when: "The shade's inside is 86 mm wide. The ring is 0.8 mm smaller so the shade slips over it and stays centered.",
        check: (t) => prim(t, "tube", false, (p) => near(p.w, 85.2, 0.6) && near(p.h, 4, 0.6)),
      },
      {
        title: "Group the base", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b>, then <b>Group</b>."],
        when: "Group before you start the shade, so the shade stays a separate part.",
        check: (t) => groupSized(t, 100, 100, 92, 2),
      },
      {
        title: "The shade", tool: "Cylinder + hole", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Add a <b>Cylinder</b>: <b>Width 90</b>, <b>Depth 90</b>, <b>Height 110</b>. Position: <b>X 120</b>, <b>Y 0</b>, <b>Z 0</b>.", "Add a <b>Cylinder</b> hole: <b>Width 86</b>, <b>Depth 86</b>, <b>Height 110</b>. Position: <b>X 120</b>, <b>Y 0</b>, <b>Z (bottom) 2</b>.", "Select both (click one, <b>Shift</b>+click the other) and <b>Group</b>."],
        when: "2 mm walls let light through white or natural PLA. The shade prints upside down: its closed top on the bed.",
        check: (t) => groupSized(t, 90, 90, 110, 1),
      },
      {
        title: "A picture texture on the shade", tool: "Texture", icon: "texture", show: { sel: "#bb-texture" },
        how: ["Select the shade and click <b>Texture</b>. Click the shade's <b>outside wall</b>.", SEASON, "<b>Depth 0.8</b>. <b>OK</b>."],
        when: "Where the wall is thicker the light is dimmer, so the pictures show as shadows when the lantern is on.",
        check: (t) => textured(t),
      },
      {
        title: "Put it together", tool: "Tip", icon: "eye", show: { sel: "#bb-printsim" },
        how: ["Print the shade in white or natural PLA. Stick the 10 mm LED strip around the post from the top down in a spiral, wire into the hole at the top.", "Run the cable down the post and out through the channel. Set the shade over the ring."],
        when: "LED strips stay cool, so they're safe inside a plastic shade. Use a USB (5 V) or battery strip.",
      },
      saveStep(), exportStep(),
    ],
  },
  {
    id: "b-lamp-hang", mode: "beginner", level: "Advanced", minutes: "14-18", item: "Hanging Lantern",
    title: "LED lamp: hanging lantern",
    blurb: "A pendant lantern in one piece that holds the push light facing down, with tall windows all around and a hole for the hanging cord. It prints upside down with no supports.",
    learn: ["Cylinder", "Tube", "Box hole through both walls", "Pattern (circular)", "Group", "Printing upside down"],
    steps: [
      nameStep("Hanging Lantern", "Lopez, Maria, Hanging Lantern"),
      {
        title: "The top", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Click the <b>Cylinder</b> tile.", FIELDS, "Size: <b>Width 110</b>, <b>Depth 110</b>, <b>Height 3</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "The lantern is built upside down, like it prints: this disc on the bed is the top of the lantern when it hangs.",
        check: (t) => prim(t, "cylinder", false, (p) => near(p.w, 110) && near(p.h, 3, 0.5)),
      },
      {
        title: "The shade wall", tool: "Tube", icon: "cylinder", show: { tile: "tube" }, anim: "tile",
        how: ["Add a <b>Tube</b>: <b>Width 110</b>, <b>Depth 110</b>, <b>Height 120</b>, <b>Wall 2</b>.", "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "A thin wall glows when the light is on.",
        check: (t) => prim(t, "tube", false, (p) => near(p.w, 110) && near(p.h, 120, 2)),
      },
      {
        title: "A cup for the push light", tool: "Tube", icon: "cylinder", show: { tile: "tube" }, anim: "tile",
        how: ["Add a <b>Tube</b>: <b>Width 75.2</b>, <b>Depth 75.2</b>, <b>Height 22</b>, <b>Wall 3</b>.", "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "Inside, the cup is 69.2 mm: just 0.4 mm bigger than the 68.8 mm light, so it pushes in snugly and holds. It's 22 mm deep for the 18 mm light.",
        check: (t) => prim(t, "tube", false, (p) => near(p.w, 75.2, 0.6) && near(p.h, 22, 1)),
      },
      {
        title: "A hole for the cord", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true }, anim: "holeBox",
        how: ["Add a <b>Cylinder</b> hole: <b>Width 6</b>, <b>Depth 6</b>, <b>Height 5</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) -1</b>."],
        when: "Thread a cord through and tie a big knot inside, or use a hook.",
        check: (t) => prim(t, "cylinder", true, (p) => near(p.w, 6, 0.6)),
      },
      {
        title: "A window through the wall", tool: "Holes → Box", icon: "holeToggle", show: { tile: "box", hole: true }, anim: "holeBox",
        how: ["Add a <b>Box</b> hole: <b>Width 8</b>, <b>Depth 130</b>, <b>Height 60</b>.", "Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 40</b>."],
        when: "It's longer than the lantern is wide, so this one hole cuts a window in the front and the back wall at once. It's above the cup (which ends at 22 mm), so the cup isn't cut.",
        check: (t) => prim(t, "box", true, (p) => near(p.w, 8, 0.6) && near(p.d, 130, 2)),
      },
      {
        title: "Windows all around", tool: "Pattern (circular)", icon: "pattern", show: { sel: "#bb-pattern" },
        how: ["Keep the window hole selected and click <b>Pattern</b>.", TABS, "<b>Circular</b>, Axis <b>Z</b>, About <b>Origin</b>, Count <b>3</b>, Angle <b>360</b>. <b>OK</b>."],
        when: "3 copies of a hole that cuts two windows: 6 windows, evenly spaced 60° apart.",
        check: (t) => t.prim("box", true).filter((b) => near(b.node.p.d, 130, 2)).length >= 3 || t.groups().some((g) => t.countHoles(g) >= 3 && near(sz(t, g).x, 130, 3)),
      },
      {
        title: "Group it all", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b>, then <b>Group</b>. Orbit around: 6 tall windows, the cup inside, the cord hole in the top."],
        when: "One part, no supports needed: the top is flat on the bed and everything else rises straight up from it.",
        check: (t) => t.groups().some((g) => near(sz(t, g).z, 120, 2) && t.countHoles(g) >= 3),
      },
      {
        title: "Hang it up", tool: "Tip", icon: "eye", show: { sel: "#bb-printsim" },
        how: ["Push the light into the cup, lens facing down (out the bottom of the lantern).", "Thread the cord through the top, tie a knot, and hang it. Reach up inside and press the lens to switch it on."],
        when: "The push light runs on AAA batteries and stays cool, so it's safe in a plastic lantern.",
      },
      saveStep(), exportStep(),
    ],
  },

  // ============================================================== BEGINNER: more projects
  {
    id: "b-ornament", mode: "beginner", level: "Easy", minutes: "8-10", item: "Holiday Ornament",
    title: "Holiday ornament",
    blurb: "A round ornament with a holiday picture texture, your name, and a loop for a ribbon. Quick to print in an afternoon.",
    learn: ["Cylinder", "Texture (holiday themes)", "Text", "Torus", "Group"],
    steps: [
      nameStep("Holiday Ornament", "Lopez, Maria, Holiday Ornament"),
      {
        title: "The disc", tool: "Cylinder", icon: "cylinder", show: { tile: "cylinder" }, anim: "tile",
        how: ["Click the <b>Cylinder</b> tile.", FIELDS, "Size: <b>Width 70</b>, <b>Depth 70</b>, <b>Height 4</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "4 mm is thick enough not to snap and light enough to hang on a branch.",
        check: (t) => prim(t, "cylinder", false, (p) => near(p.w, 70) && near(p.h, 4, 0.5)),
      },
      {
        title: "A holiday texture", tool: "Texture", icon: "texture", show: { sel: "#bb-texture" },
        how: ["Select the disc and click <b>Texture</b>. Click the disc's <b>top face</b>.", "Click <b>Holidays</b> and pick one: <b>Snowmen</b>, <b>Christmas trees</b>, <b>Nutcrackers</b>, <b>Jack-o'-lanterns</b>… <b>OK</b>."],
        when: "Picture textures repeat across the face. Use <b>Tile size</b> to make the pictures bigger or smaller.",
        check: (t) => textured(t),
      },
      {
        title: "A loop for the ribbon", tool: "Torus", icon: "cylinder", show: { tile: "torus" }, anim: "tile",
        how: ["Add a <b>Torus</b>: <b>Diameter 16</b>, <b>Tube 4</b>.", "Position: <b>X 0</b>, <b>Y 39</b>, <b>Z 0</b>, overlapping the top edge of the disc."],
        when: "A ring at the top hangs straight. Overlapping the disc joins it firmly.",
        check: (t) => t.prim("torus").length > 0,
      },
      {
        title: "Your name", tool: "Text", icon: "text", show: { tile: "text" }, anim: "tile",
        how: ["Add <b>Text</b> with your name: <b>Letter size 9</b>, <b>Height 1</b>. Position: <b>X 0</b>, <b>Y -26</b>, <b>Z (bottom) 4</b>."],
        when: "Name ornaments make great gifts. Put the year on the back if you like.",
        check: (t) => t.prim("text").length > 0 || t.groups().length > 0,
      },
      {
        title: "Group it", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b>, then <b>Group</b>."],
        when: "Grouping joins the loop, the disc and your name into one part to print.",
        check: (t) => t.groups().some((g) => near(sz(t, g).x, 70, 2)),
      },
      saveStep(), exportStep(),
    ],
  },
  {
    id: "b-binset", mode: "beginner", level: "Proficient", minutes: "8-12", item: "Storage Bins",
    title: "Stacking storage bins (Box Maker)",
    blurb: "Use the Box Maker to make a set of bins with compartments that stack and lock together, sized to fit your drawer or shelf.",
    learn: ["Box Maker", "Compartments", "Stacking", "Fit clearance", "Printing a set"],
    steps: [
      nameStep("Storage Bins", "Lopez, Maria, Storage Bins"),
      {
        title: "Open the Box Maker", tool: "Box Maker", icon: "box", show: { sel: "#bb-bins" },
        how: ["Click <b>Box Maker</b> in the toolbar. A panel opens with an open bin."],
        when: "The Box Maker builds a whole set of parts from a few numbers, and remembers them so you can change it later (double-click any bin).",
        check: (t) => !!document.getElementById("bn-style"),
      },
      {
        title: "Size it for your drawer", tool: "Box Maker → Size", icon: "box", show: { sel: "#bn-w" },
        how: ["Style <b>Open bin</b>. Set <b>Width 80</b>, <b>Depth 120</b>, <b>Height 40</b>.", "Measure the drawer or shelf first, and leave a few mm free on each side."],
        when: "Bins sized to fill a drawer neatly stop everything sliding around.",
      },
      {
        title: "Compartments", tool: "Box Maker → Columns and Rows", icon: "pattern", show: { sel: "#bn-cols" },
        how: ["Under Compartments, set <b>Columns 2</b> and <b>Rows 3</b>."],
        when: "Small compartments for small things: screws, beads, LEGO, erasers.",
      },
      {
        title: "Two bins side by side", tool: "Box Maker → Bins across", icon: "box", show: { sel: "#bn-across" },
        how: ["Set <b>Bins across 2</b>, then press <b>Tab</b>. Side join <b>Dovetail rails</b>.", "Tick <b>Interlocking rim and foot</b> so bins can stack too. Click on the workplane to place the set, then <b>OK</b>."],
        when: "Bins that stack and line up keep a shelf tidy. The panel tells you the clearance it uses so they fit.",
        check: (t) => t.bodies().some((b) => b.bin),
      },
      saveStep(), exportStep(),
    ],
  },
  {
    id: "b-planter", mode: "beginner", level: "Proficient", minutes: "10-12", item: "Planter",
    title: "Planter with a drip saucer",
    blurb: "A six-sided planter with drainage holes and a saucer that catches the water. Two parts, with clearance so the planter sits in the saucer.",
    learn: ["Prism (six sides)", "Prism hole", "Cylinder holes", "Pattern (circular)", "Group", "Clearance"],
    steps: [
      nameStep("Planter", "Lopez, Maria, Planter"),
      {
        title: "The planter", tool: "Prism", icon: "box", show: { tile: "prism" }, anim: "tile",
        how: ["Click the <b>Prism</b> tile (6 sides).", FIELDS, "Size: <b>Width 80</b>, <b>Depth 80</b>, <b>Height 75</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z 0</b>."],
        when: "Six flat sides look good and print cleanly with no supports.",
        check: (t) => prim(t, "prism", false, (p) => near(p.w, 80) && near(p.h, 75)),
      },
      {
        title: "Hollow it", tool: "Holes → Prism", icon: "holeToggle", show: { tile: "prism", hole: true }, anim: "holeBox",
        how: ["Add a <b>Prism</b> hole: <b>Width 74</b>, <b>Depth 74</b>, <b>Height 75</b>. Position: <b>X 0</b>, <b>Y 0</b>, <b>Z (bottom) 3</b>."],
        when: "3 mm walls and floor are strong enough for soil and water.",
        check: (t) => prim(t, "prism", true, (p) => near(p.w, 74)),
      },
      {
        title: "A drainage hole", tool: "Holes → Cylinder", icon: "holeToggle", show: { tile: "cylinder", hole: true }, anim: "holeBox",
        how: ["Add a <b>Cylinder</b> hole: <b>Width 6</b>, <b>Depth 6</b>, <b>Height 5</b>. Position: <b>X 18</b>, <b>Y 0</b>, <b>Z (bottom) -1</b>."],
        when: "Without drainage, water sits at the bottom and the roots rot.",
        check: (t) => prim(t, "cylinder", true, (p) => near(p.w, 6, 0.6)),
      },
      {
        title: "Drainage all around", tool: "Pattern (circular)", icon: "pattern", show: { sel: "#bb-pattern" },
        how: ["Keep the hole selected, click <b>Pattern</b>.", TABS, "<b>Circular</b>, Axis <b>Z</b>, About <b>Origin</b>, Count <b>5</b>, Angle <b>360</b>. <b>OK</b>."],
        when: "Pattern makes evenly spaced copies around the center, all exactly the same.",
        check: (t) => t.prim("cylinder", true).filter((b) => near(b.node.p.w, 6, 0.6)).length >= 5 || t.groups().some((g) => t.countHoles(g) >= 5),
      },
      {
        title: "Group the planter", tool: "Group", icon: "group", show: { sel: "#bb-group" },
        how: ["Press <b>Ctrl+A</b>, then <b>Group</b>."],
        when: "Grouping cuts all the holes out at once.",
        check: (t) => t.groups().some((g) => near(sz(t, g).z, 75, 1.5) && t.countHoles(g) >= 5),
      },
      {
        title: "The saucer", tool: "Prism + Prism hole + Group", icon: "box", show: { tile: "prism" }, anim: "tile",
        how: ["Add a <b>Prism</b>: <b>Width 92</b>, <b>Depth 92</b>, <b>Height 12</b>, at <b>X 110</b>, <b>Y 0</b>, <b>Z 0</b>.", "Add a <b>Prism</b> hole: <b>Width 86</b>, <b>Depth 86</b>, <b>Height 12</b>, at <b>X 110</b>, <b>Y 0</b>, <b>Z (bottom) 2</b>.", "Select both (<b>Shift</b>+click) and <b>Group</b>."],
        when: "Inside, the saucer is 86 mm: 6 mm bigger than the 80 mm planter, so it sits in easily and water can spread.",
        check: (t) => t.groups().some((g) => near(sz(t, g).z, 12, 1) && near(sz(t, g).y, 92, 3)),
      },
      saveStep(), exportStep(),
    ],
  },

  // ============================================================== ADVANCED: LED lamps
  {
    id: "a-lamp-push", mode: "advanced", level: "Advanced", minutes: "20-25", item: "Push Light Lamp",
    title: "LED lamp: edge-lit acrylic panel",
    blurb: "A base that slips over a 2.75 inch LED push light (68.8 × 18 mm), pocketed with face sketches, with a themed texture, and the acrylic panel it lights: sketched, joined, engraved with your name and a traced picture, and exported for the laser cutter.",
    learn: ["Sketch + Extrude", "Sketch on a face", "Extrude cut (pockets, slot)", "Texture", "New body / Join", "Deboss text", "Image to trace", "Laser cut file"],
    steps: [
      nameStep("Push Light Lamp", "Lopez, Maria, Push Light Lamp"),
      {
        title: "The base", tool: "Sketch → Circle + Extrude", icon: "circle", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b> → <b>XY · Top</b>. <b>Circle</b>: click the origin, type <b>75</b>, <b>Enter</b>.", "Press <b>E</b>, Distance <b>31</b>, <b>OK</b>."],
        when: "The base is built upside down, the way it prints: it slips over the light like a cap, so pressing the lamp clicks the light on.",
        check: (t) => sized(t, 75, 75, 31),
      },
      {
        title: "Pocket for the light", tool: "Sketch on a face → Circle + Extrude cut", icon: "circle", show: { sel: "#ad-sketch" }, anim: "cut",
        how: ["Press <b>Home</b>. <b>Sketch</b>, click the <b>top face</b>.", "<b>Circle</b>: click the center (the label says <b>0, 0</b>), type <b>69.6</b>, <b>Enter</b>.", "Press <b>E</b>, Distance <b>-18.5</b>. It says <b>Will cut</b>. <b>OK</b>."],
        when: "68.8 mm light + 0.8 mm clearance. The pocket is 18.5 deep for the 18 mm light.",
        check: (t) => cuts(t) >= 1,
      },
      {
        title: "Pocket for the lens", tool: "Sketch on a face → Extrude cut", icon: "circle", show: { sel: "#ad-sketch" }, anim: "cut",
        how: ["<b>Sketch</b>, click the <b>floor of the pocket</b>. <b>Circle</b> at the center, <b>44</b>, <b>Enter</b>.", "Press <b>E</b>, Distance <b>-6</b>, <b>OK</b>."],
        when: "The light's dome fits in this smaller pocket, close to the panel. It's a little wider than the slot you'll cut next, so the slot sits inside it.",
        check: (t) => cuts(t) >= 2,
      },
      {
        title: "Slot for the panel", tool: "Sketch on a face → Center rectangle + Extrude cut", icon: "rect", show: { sel: "#ad-sketch" }, anim: "cut",
        how: ["<b>Sketch</b>, click the <b>floor of the lens pocket</b>. <b>Rectangle</b> → <b>Center</b>, click the center, type <b>42.6</b>, <b>Tab</b>, <b>3.6</b>, <b>Enter</b>.", "Press <b>E</b>, Distance <b>-7</b>. <b>OK</b>: the slot goes right through."],
        when: "3 mm (1/8\") acrylic with a 41.5 mm tab: about 0.5 mm clearance each way.",
        check: (t) => cuts(t) >= 3,
      },
      {
        title: "A texture around the side", tool: "Decorate → Texture", icon: "texture", show: { sel: "#ad-texture", via: "#ad-decorate" },
        how: ["Select the base. <b>Decorate</b> → <b>Texture</b>, click the base's <b>side</b>.", SEASON, "<b>OK</b>."],
        when: "Picture textures wrap around curved faces too.",
        check: (t) => textured(t),
      },
      {
        title: "The panel", tool: "Sketch → Circle + Extrude (New body)", icon: "circle", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b> → <b>XY · Top</b>. <b>Circle</b>: move the pointer until the label says <b>130, 60</b>, click, type <b>120</b>, <b>Enter</b>.", "Press <b>E</b>, Distance <b>3</b>, Operation <b>New body</b>. <b>OK</b>."],
        when: "The panel lies flat: that's how the laser cutter sees it. 3 mm is the acrylic's thickness.",
        check: (t) => sized(t, 120, 120, 3, 1),
      },
      {
        title: "The panel's tab", tool: "Sketch → Center rectangle + Extrude (Join)", icon: "rect", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b> → <b>XY · Top</b>. <b>Rectangle</b> → <b>Center</b>, click where the label says <b>130, 0</b>, type <b>41.5</b>, <b>Tab</b>, <b>16</b>, <b>Enter</b>.", "Press <b>E</b>, Distance <b>3</b>, Operation <b>Join</b>. <b>OK</b>."],
        when: "The tab overlaps the circle, so Join makes one panel. 8 mm of it stands in the slot.",
        check: (t) => sized(t, 120, 128, 3, 1.5),
      },
      {
        title: "Engrave your name", tool: "Decorate → Emboss text (Deboss)", icon: "text", show: { sel: "#ad-emboss", via: "#ad-decorate" },
        how: ["<b>Decorate</b> → <b>Emboss text</b>, click the panel's top, low down near the tab.", "Type your name. Style <b>Deboss (cut in)</b>, Letter height <b>12</b>, Depth <b>0.5</b>. <b>OK</b>."],
        when: "The laser engraves wherever the top is cut away. Engraved lines glow in edge-lit acrylic.",
        check: (t) => t.bodies().some((b) => (b.node.mods || []).some((m) => m.t === "emboss" && m.mode === "deboss")) || mods(t, "emboss") > 0,
      },
      {
        title: "Engrave a traced picture", tool: "Sketch → Insert → Image to trace + Extrude cut", icon: "image", show: { sel: "#ad-sketch" },
        how: ["Find a simple black-and-white line drawing (your own drawing, or free clip art you're allowed to use).", "<b>Sketch</b>, click the panel's top. <b>Insert</b> → <b>Image to trace</b>, pick the picture.", "Width <b>70</b>, X <b>130</b>, Y <b>65</b> (the middle of the circle). Tick <b>Auto trace it after placing</b>. <b>OK</b>.", "The <b>Auto trace</b> panel shows the outlines it found: <b>OK</b>.", "Press <b>E</b>. The traced shape is picked (if not, click <b>Clear</b> and click inside it). Distance <b>-0.5</b>, <b>OK</b>."],
        when: "Line drawings work best: thick, closed outlines. The laser engraves the traced shapes.",
        tip: "No picture handy? Draw your own with Circle, Line and Spline instead.",
        check: (t) => cuts(t) >= 4,
      },
      laserStep("the panel"),
      saveStep(), stlOfStep("the base"),
    ],
  },
  {
    id: "a-lamp-strip", mode: "advanced", level: "Proficient", minutes: "15-18", item: "LED Strip Lantern",
    title: "LED lamp: LED strip lantern",
    blurb: "A lantern lit by a 10 mm LED strip wound around a post: Hole tool for the wire, a cut channel for the cable, a joined seating ring, and a shelled shade with a picture texture.",
    learn: ["Extrude", "Fillet", "Sketch on a face + Join", "Hole (through all)", "Extrude cut", "Shell", "Texture"],
    steps: [
      nameStep("LED Strip Lantern", "Lopez, Maria, LED Strip Lantern"),
      {
        title: "The base", tool: "Sketch → Circle + Extrude", icon: "circle", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b> → <b>XY · Top</b>. <b>Circle</b> at the origin, <b>100</b>, <b>Enter</b>. Press <b>E</b>, Distance <b>12</b>, <b>OK</b>."],
        when: "Start with the biggest, simplest shape. Everything else is added to it or cut from it.",
        check: (t) => sized(t, 100, 100, 12),
      },
      {
        title: "Round the top edge", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: ["Press <b>Home</b>. <b>Fillet</b>, click the base's <b>top outer edge</b>. Size <b>3</b>. <b>OK</b>."],
        when: "A rounded edge feels nicer and doesn't chip.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      {
        title: "The post", tool: "Sketch on a face → Circle + Extrude (Join)", icon: "circle", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b>, click the base's top. <b>Circle</b> at the center, <b>40</b>, <b>Enter</b>. Press <b>E</b>, Distance <b>80</b>, <b>OK</b>."],
        when: "A 1 m, 10 mm LED strip makes about 8 turns around a 40 mm post.",
        check: (t) => sized(t, 100, 100, 92),
      },
      {
        title: "A hole down the post", tool: "Hole (through all)", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: ["<b>Hole</b>, click the <b>top of the post</b>. Position <b>X 0</b>, <b>Y 0</b>. <b>Diameter 10</b>, Extent <b>Through all</b>. <b>OK</b>."],
        when: "The strip's wire goes in at the top and down through the post.",
        check: (t) => mods(t, "hole") >= 1,
      },
      {
        title: "A channel for the cable", tool: "Sketch → Center rectangle + Extrude cut", icon: "rect", show: { sel: "#ad-sketch" }, anim: "cut",
        how: ["<b>Sketch</b> → <b>XY · Top</b> (the ground, under the base). <b>Rectangle</b> → <b>Center</b>, click where the label says <b>30, 0</b>, type <b>60</b>, <b>Tab</b>, <b>12</b>, <b>Enter</b>.", "Press <b>E</b>, Distance <b>5</b>, Operation <b>Cut</b>. <b>OK</b>."],
        when: "The cable runs under the base and out the side, so the lantern sits flat.",
        check: (t) => cuts(t) >= 1,
      },
      {
        title: "A ring to seat the shade", tool: "Sketch on a face → two Circles + Extrude (Join)", icon: "circle", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b>, click the base's top. <b>Circle</b> at the center <b>85.2</b>, <b>Enter</b>; another at the center <b>79.2</b>, <b>Enter</b>.", "Press <b>E</b>, click the <b>ring</b> between the circles, Distance <b>4</b>, <b>OK</b>."],
        when: "The shade's inside is 86 mm: the ring is 0.8 mm smaller so the shade drops over it.",
        check: (t) => { let n = 0; for (const b of t.bodies()) for (const m of b.node.mods || []) if (m.t === "bool" && m.tool && m.tool.t === "extrude" && (m.op || "join") === "join") n++; return n >= 2; },
      },
      {
        title: "The shade", tool: "Sketch → Circle + Extrude (New body)", icon: "circle", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b> → <b>XY · Top</b>. <b>Circle</b>: click where the label says <b>130, 0</b>, type <b>90</b>, <b>Enter</b>. Press <b>E</b>, Distance <b>112</b>, Operation <b>New body</b>. <b>OK</b>."],
        when: "New body keeps the shade a separate part from the base.",
        check: (t) => sized(t, 90, 90, 112),
      },
      {
        title: "Hollow the shade", tool: "Shell", icon: "shell", show: { sel: "#ad-shell" },
        how: ["<b>Shell</b>, click the shade's <b>top face</b>. Thickness <b>2</b>, <b>Inside</b>. <b>OK</b>."],
        when: "It prints this way up (closed end on the bed) and is turned over onto the base.",
        check: (t) => mods(t, "shell") >= 1,
      },
      {
        title: "A picture texture", tool: "Decorate → Texture", icon: "texture", show: { sel: "#ad-texture", via: "#ad-decorate" },
        how: ["Select the shade. <b>Decorate</b> → <b>Texture</b>, click its <b>outside wall</b>.", SEASON, "<b>Depth 0.8</b>. <b>OK</b>."],
        when: "Thicker spots let less light through, so the pictures glow as shadows.",
        check: (t) => textured(t),
      },
      saveStep(), exportStep(),
    ],
  },
  {
    id: "a-lamp-hang", mode: "advanced", level: "Advanced", minutes: "18-22", item: "Hanging Lantern",
    title: "LED lamp: hanging lantern",
    blurb: "A pendant lantern that holds a push light facing down: shelled shade, a joined cup, a cord hole, and tall windows cut through both walls and patterned all around.",
    learn: ["Extrude", "Shell", "Sketch on a face + Join (ring)", "Hole", "Symmetric extrude cut", "Pattern features (circular)", "Fillet"],
    steps: [
      nameStep("Hanging Lantern", "Lopez, Maria, Hanging Lantern"),
      {
        title: "The lantern", tool: "Sketch → Circle + Extrude", icon: "circle", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b> → <b>XY · Top</b>. <b>Circle</b> at the origin, <b>110</b>, <b>Enter</b>. Press <b>E</b>, Distance <b>120</b>, <b>OK</b>."],
        when: "Built upside down, the way it prints: the bottom face here is the lantern's top.",
        check: (t) => sized(t, 110, 110, 120),
      },
      {
        title: "Hollow it, open at the bottom", tool: "Shell", icon: "shell", show: { sel: "#ad-shell" },
        how: ["Press <b>Home</b>. <b>Shell</b>, click the <b>top face</b>. Thickness <b>2</b>, <b>Inside</b>. <b>OK</b>."],
        when: "The face you click is removed: that's the open bottom of the lantern when it hangs.",
        check: (t) => mods(t, "shell") >= 1,
      },
      {
        title: "A cup for the push light", tool: "Sketch on a face → two Circles + Extrude (Join)", icon: "circle", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b>, click the <b>floor inside</b>. <b>Circle</b> at the center <b>75.2</b>, <b>Enter</b>; another at the center <b>69.2</b>, <b>Enter</b>.", "Press <b>E</b>, click the <b>ring</b>, Distance <b>20</b>, <b>OK</b>."],
        when: "69.2 mm inside: 0.4 mm over the 68.8 mm light, so it pushes in snugly. 20 mm deep for the 18 mm light.",
        check: (t) => { let n = 0; for (const b of t.bodies()) for (const m of b.node.mods || []) if (m.t === "bool" && m.tool && m.tool.t === "extrude" && (m.op || "join") === "join") n++; return n >= 1; },
      },
      {
        title: "A hole for the cord", tool: "Hole", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: ["<b>Hole</b>, click the floor in the middle of the cup. Position <b>X 0</b>, <b>Y 0</b>. <b>Diameter 6</b>, Extent <b>Through all</b>. <b>OK</b>."],
        when: "Thread the cord through and tie a big knot inside, or use a hook.",
        check: (t) => mods(t, "hole") >= 1,
      },
      {
        title: "A window through both walls", tool: "Sketch (XZ) → Center rectangle + Symmetric extrude cut", icon: "rect", show: { sel: "#ad-sketch" }, anim: "cut",
        how: ["<b>Sketch</b> → <b>XZ · Front</b>. <b>Rectangle</b> → <b>Center</b>, click where the label says <b>0, 70</b>, type <b>8</b>, <b>Tab</b>, <b>60</b>, <b>Enter</b>.", "Press <b>E</b>. Direction <b>Symmetric</b>, Distance <b>130</b>, Operation <b>Cut</b>. <b>OK</b>."],
        when: "Symmetric cuts both ways from the sketch, through the front and the back wall at once. It's above the cup, which ends 22 mm up.",
        check: (t) => cuts(t) >= 1,
      },
      {
        title: "Windows all around", tool: "Pattern → Features (circular)", icon: "pattern", show: { sel: "#ad-pattern" },
        how: ["<b>Pattern</b> → <b>Features</b>, tick the newest <b>Extrude cut</b>.", "<b>Circular</b>, Axis <b>Z</b>, About <b>Origin</b>, Count <b>3</b>, Angle <b>360</b>. <b>OK</b>."],
        when: "3 copies of a cut that makes two windows: 6 windows, 60° apart.",
        check: (t) => cuts(t) >= 3 || mods(t, "pattern") >= 1,
      },
      {
        title: "Soften the rim", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: ["<b>Fillet</b>, click the <b>outer edge of the rim</b> at the top. Size <b>1</b>. <b>OK</b>."],
        when: "The rim is the bottom edge when it hangs: the edge you touch.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      saveStep(), exportStep(),
    ],
  },

  // ============================================================== ADVANCED: more projects
  {
    id: "a-keyrack", mode: "advanced", level: "Proficient", minutes: "14-18", item: "Key Rack",
    title: "Wall key rack with keyhole slots",
    blurb: "A key rack that hangs on two screws: rounded plate, hooks braced by gusset ribs, keyhole slots on the back, and a debossed label.",
    learn: ["Extrude", "Fillet", "Sketch on a face + Join", "Pattern features", "Rib (gusset)", "Keyhole slot", "Deboss text"],
    steps: [
      nameStep("Key Rack", "Lopez, Maria, Key Rack"),
      {
        title: "The plate", tool: "Sketch → Center rectangle + Extrude", icon: "rect", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b> → <b>XZ · Front</b>. <b>Rectangle</b> → <b>Center</b>, click where the label says <b>0, 30</b>, type <b>160</b>, <b>Tab</b>, <b>60</b>, <b>Enter</b>.", "Press <b>E</b>, Distance <b>-8</b> (backwards), <b>OK</b>."],
        when: "Sketched on the front plane, the plate stands up like it hangs on the wall; its back is flat on the wall.",
        check: (t) => t.bodies().some((b) => { const x = t.box(b.id); return x && near(x.size.x, 160, 2) && near(x.size.z, 60, 2); }),
      },
      {
        title: "Round the corners", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: ["<b>Fillet</b>, click the <b>4 short corner edges</b> (front to back). Size <b>6</b>. <b>OK</b>."],
        when: "Rounded corners look finished and don't catch on things.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      {
        title: "A hook", tool: "Sketch on a face → Circle + Extrude (Join)", icon: "circle", show: { sel: "#ad-sketch" },
        how: ["Press <b>Home</b>. <b>Sketch</b>, click the plate's <b>front face</b>. <b>Circle</b>: click where the label says <b>-60, 20</b>, type <b>8</b>, <b>Enter</b>.", "Press <b>E</b>, Distance <b>25</b>, <b>OK</b>."],
        when: "An 8 mm peg is strong enough for keys and a bag strap.",
        check: (t) => { let n = 0; for (const b of t.bodies()) for (const m of b.node.mods || []) if (m.t === "bool" && m.tool && m.tool.t === "extrude" && (m.op || "join") === "join") n++; return n >= 1; },
      },
      {
        title: "Brace it with a gusset", tool: "Advanced Create → Rib (Gusset)", icon: "rib", show: { sel: "#ad-rib", via: "#ad-features" },
        how: ["Click <b>FRONT</b> on the view cube. <b>Advanced Create</b> → <b>Rib</b>.", "Click the front face <b>just below the hook</b>, then click again about <b>10 mm lower</b>.", "Shape <b>Gusset</b>, Tall end <b>At the start</b>, Height <b>18</b>, Thickness <b>3</b>. <b>OK</b>."],
        when: "A gusset is a triangle that braces a corner. Under a hook, it stops the hook bending down when something heavy hangs on it.",
        check: (t) => t.bodies().some((b) => (b.node.mods || []).some((m) => m.src === "rib")),
      },
      {
        title: "Four hooks", tool: "Pattern → Features", icon: "pattern", show: { sel: "#ad-pattern" },
        how: ["<b>Pattern</b> → <b>Features</b>, tick the <b>hook</b> (Extrude join) and the <b>Gusset</b>.", "<b>Rectangular</b>, Direction 1 <b>X</b>, Count <b>4</b>, Spacing <b>40</b>. <b>OK</b>."],
        when: "A feature pattern repeats the hook and its gusset exactly, evenly spaced.",
        check: (t) => mods(t, "pattern") >= 1 || t.bodies().some((b) => (b.node.mods || []).filter((m) => m.src === "rib").length >= 4),
      },
      {
        title: "Keyhole slots on the back", tool: "Advanced Create → Keyhole slot", icon: "keyhole", show: { sel: "#ad-keyhole", via: "#ad-features" },
        how: ["Click <b>BACK</b> on the view cube. <b>Advanced Create</b> → <b>Keyhole slot</b>.", "Click the back face twice, about <b>50 mm left and right of the middle</b>, a little below the center.", "Screw size <b>Medium (M4 / #8)</b>, Slot points <b>Up</b>. <b>OK</b>."],
        when: "Keyholes hide the screws: hang the rack on two screws, slide it down, and the heads hook behind the lips. The plate is 8 mm thick: deep enough for the 6 mm cut.",
        check: (t) => t.bodies().some((b) => (b.node.mods || []).some((m) => m.src === "keyhole")),
      },
      {
        title: "A label", tool: "Decorate → Emboss text (Deboss)", icon: "text", show: { sel: "#ad-emboss", via: "#ad-decorate" },
        how: ["Press <b>Home</b>. <b>Decorate</b> → <b>Emboss text</b>, click the front face above the hooks. Type <b>KEYS</b>, <b>Deboss</b>, Letter height <b>12</b>, Depth <b>1</b>. <b>OK</b>."],
        when: "Deboss cuts the letters in, so they don't snap off.",
        check: (t) => mods(t, "emboss") >= 1,
      },
      saveStep(), exportStep(),
    ],
  },
  {
    id: "a-bracket", mode: "advanced", level: "Advanced", minutes: "16-20", item: "Shelf Bracket",
    title: "Shelf bracket with gussets",
    blurb: "An L bracket for a small shelf, drawn as one outline and extruded, stiffened with two gusset ribs, and fixed with countersunk screw holes.",
    learn: ["Line (closed outline)", "Symmetric extrude", "Rib (gusset, count)", "Hole (countersink)", "Pattern features", "Fillet"],
    steps: [
      nameStep("Shelf Bracket", "Lopez, Maria, Shelf Bracket"),
      {
        title: "The L outline", tool: "Sketch → Line", icon: "line", show: { sel: "#ad-sketch" },
        how: ["<b>Sketch</b> → <b>XZ · Front</b>. <b>Line</b>: click the origin, then type each line's length and angle (<b>Tab</b> between, <b>Enter</b> after): <b>100</b>, <b>0</b> · <b>5</b>, <b>90</b> · <b>95</b>, <b>180</b> · <b>95</b>, <b>90</b> · <b>5</b>, <b>180</b>. Click the origin to close it."],
        when: "One outline, the shape of an L: 100 mm along the shelf and 100 mm down the wall, 5 mm thick.",
        check: (t) => t.sketchLines(6),
      },
      {
        title: "Give it width", tool: "Extrude (Symmetric)", icon: "extrude", show: { sel: "#sk-extrude" },
        how: ["Press <b>E</b>. Direction <b>Symmetric</b>, Distance <b>30</b>. <b>OK</b>."],
        when: "Symmetric puts the outline in the middle of the bracket's width.",
        check: (t) => sized(t, 100, 30, 100, 2),
      },
      {
        title: "Gusset ribs in the corner", tool: "Advanced Create → Rib", icon: "rib", show: { sel: "#ad-rib", via: "#ad-features" },
        how: ["Orbit to look into the inside corner of the L. <b>Advanced Create</b> → <b>Rib</b>.", "Click the shelf arm's <b>top face, in the middle of its width, right against the wall arm</b>, then click again <b>70 mm along it</b> (the label shows the length).", "Shape <b>Gusset</b>, Tall end <b>At the start</b>, Height <b>70</b>, Thickness <b>4</b>, Count <b>2</b>, Spacing <b>18</b>. <b>OK</b>."],
        when: "Without gussets the L bends at the corner. Two triangles turn it into a stiff truss.",
        check: (t) => t.bodies().some((b) => (b.node.mods || []).some((m) => m.src === "rib" && m.rib && m.rib.count >= 2)),
      },
      {
        title: "Countersunk screw holes", tool: "Hole (Countersink) + Pattern features", icon: "hole", show: { sel: "#ad-hole" }, anim: "holeTool",
        how: ["<b>Hole</b>, click the wall arm's <b>outside face</b> near the bottom, in the middle. Hole type <b>Countersink</b>, Screw size <b>M4</b>, Extent <b>Through all</b>. <b>OK</b>.", "Do the same on the shelf arm's <b>underside</b>, near its end."],
        when: "Countersunk screws sit flush, so the bracket lies flat against the wall and the shelf.",
        check: (t) => mods(t, "hole") >= 2,
      },
      {
        title: "Soften the outside corner", tool: "Fillet", icon: "fillet", show: { sel: "#ad-edge" },
        how: ["<b>Fillet</b>, click the <b>outside corner edge</b> of the L. Size <b>5</b>. <b>OK</b>."],
        when: "A rounded outside corner is stronger and looks finished.",
        check: (t) => mods(t, "fillet") >= 1,
      },
      {
        title: "Print it on its side", tool: "Tip", icon: "eye", show: { sel: "#ws-print" },
        how: ["In <b>3D Print Sim</b>, lay it on its side (the flat L face down). That way the layers run around the L, and it doesn't snap at the corner."],
        when: "Printed parts are weakest between layers. Turn them so the load runs along the layers.",
      },
      saveStep(), exportStep(),
    ],
  },
  {
    id: "a-jigs", mode: "advanced", level: "Proficient", minutes: "12-15", item: "Woodworking Jigs",
    title: "Woodworking jigs: miter box and dowel jig",
    blurb: "Use the Jig Maker to make a miter box sized to your stock and saw, and a self-centring dowel jig for your board and dowels, then check them in the Print Sim.",
    learn: ["Jig Maker", "Clearance (hole fit)", "Measuring stock and tools", "Editing a set", "Print Sim"],
    steps: [
      nameStep("Woodworking Jigs", "Lopez, Maria, Woodworking Jigs"),
      {
        title: "Measure first", tool: "Tip", icon: "measure", show: { sel: "#ad-measure" },
        how: ["With a ruler or calipers, measure: the width and height of the wood strip you'll cut, your saw's kerf (the width of the cut it makes), your board's thickness, and your dowel's diameter."],
        when: "Jigs are only as accurate as the numbers you give them.",
      },
      {
        title: "A miter box", tool: "Workshop → Jig Maker (Miter box)", icon: "jig", show: { sel: "#ad-jigs", via: "#ad-workshop" },
        how: ["<b>Workshop</b> → <b>Jig Maker</b>. Pick <b>Miter box</b>.", "Stock width <b>40</b>, Stock height <b>30</b> (or your own), Saw kerf <b>1</b>. Cuts <b>90° + 45° both ways</b>. Tick <b>Ears</b>.", "Click the workplane to place it. <b>OK</b>."],
        when: "The kerf slots guide the saw so cuts come out square and at exactly 45°.",
        check: (t) => t.bodies().some((b) => b.jig && b.jig.o.type === "miter"),
      },
      {
        title: "A dowel jig", tool: "Jig Maker (Dowel jig)", icon: "jig", show: { sel: "#ad-jigs", via: "#ad-workshop" },
        how: ["<b>Workshop</b> → <b>Jig Maker</b> again. Pick <b>Dowel jig</b>.", "Board thickness <b>19</b>, Dowel <b>8 mm</b>, Holes <b>2</b>, Spacing <b>32</b>. Tick <b>End stop</b>. Hole fit <b>Normal</b>.", "Click beside the miter box to place it. <b>OK</b>."],
        when: "The U shape fits over the board, so the holes always land on the middle of its thickness.",
        check: (t) => t.bodies().some((b) => b.jig && b.jig.o.type === "dowel"),
      },
      {
        title: "Change your mind", tool: "Double-click to edit", icon: "jig", show: { sel: "#viewport" },
        how: ["Double-click the dowel jig. Change <b>Holes</b> to <b>3</b>. <b>OK</b>."],
        when: "Jigs remember their settings, so you can resize them for the next project in seconds.",
        check: (t) => t.bodies().some((b) => b.jig && b.jig.o.type === "dowel" && b.jig.o.dCount >= 3),
      },
      {
        title: "Check them in the Print Sim", tool: "3D Print Sim", icon: "printer3d", show: { sel: "#ws-print" },
        how: ["Click <b>3D Print Sim</b>. The dowel jig prints with its cheeks up, the miter box flat. Look at the print time, then go back to <b>Design</b>."],
        when: "Print jigs with 4 walls and 40% infill: they get bumped and clamped.",
      },
      saveStep(), exportStep(),
    ],
  },
  {
    id: "a-cabinet", mode: "advanced", level: "Advanced", minutes: "12-16", item: "Drawer Cabinet",
    title: "Stacking drawer cabinet (Box Maker)",
    blurb: "A grid of cases with drawers that lock together with dovetails, a fit you choose, and plates on all four sides holding the stack together.",
    learn: ["Box Maker (cases)", "Dovetail stacking and side joins", "Dovetail fit", "Plates on all four sides", "Lock clips"],
    steps: [
      nameStep("Drawer Cabinet", "Lopez, Maria, Drawer Cabinet"),
      {
        title: "Open the Box Maker", tool: "Simulate → Box Maker", icon: "box", show: { sel: "#ws-simulate" },
        how: ["Click the <b>Simulate</b> tab, then <b>Box Maker</b>."],
        when: "The Box Maker builds a whole set of matching parts from a few numbers.",
        check: () => !!document.getElementById("bn-style"),
      },
      {
        title: "Drawers in a 2 × 2 grid", tool: "Box Maker → Style + How many", icon: "box", show: { sel: "#bn-style" },
        how: ["Style <b>Drawer</b>. <b>Cases high 2</b>, <b>Tab</b>, <b>Cases across 2</b>, <b>Tab</b>."],
        when: "Each case holds one drawer; the cases stack and join into a cabinet.",
      },
      {
        title: "Dovetail joins", tool: "Box Maker → Joins", icon: "box", show: { sel: "#bn-lock" },
        how: ["Stack join <b>Dovetail rails</b>; Side join <b>Dovetail rails</b>.", "Dovetail fit <b>Normal</b> (or <b>Snug</b> on a well-tuned printer)."],
        when: "Dovetail rails slide together and can't pull apart sideways.",
      },
      {
        title: "Lock it on every side", tool: "Box Maker → Plates on all four sides", icon: "box", show: { sel: "#bn-plates-all" },
        how: ["Click <b>Plates on all four sides</b>. Plate fit <b>Snug</b>. Lock clips <b>On the back</b> too.", "Click the workplane to place the cabinet. <b>OK</b>."],
        when: "Plates slide over the open rails (top, right) and into the open grooves (bottom, left): the whole stack becomes one solid block.",
        check: (t) => t.bodies().some((b) => b.bin && b.bin.plates === "both" && b.bin.gplates === "both"),
      },
      saveStep(), exportStep(),
    ],
  },
];
