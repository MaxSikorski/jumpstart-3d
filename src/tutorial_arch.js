// Architect tutorials: twelve projects, from a first tiny house to a two-story house, log cabins,
// a small business, and the landscape: ground, ponds, plants, a flood test and printing it all;
// the first five go from a first tiny house to a two-story house
// sent to Beginner and exported for 3D printing. Sizes are given in feet and inches with the
// metric size in brackets; every check accepts either (sizes are compared in mm, with room to spare).
import { nameStep, saveStep, exportStep } from "./tutorial_data.js";

const FT = 304.8, IN = 25.4;
const UNITS = {
  title: "Feet and inches, or metric", tool: "Units", icon: "archPlan", show: { sel: "#ar-units" },
  how: [
    "In the Architect toolbar, find the <b>ft · in | Metric</b> switch.",
    "Click <b>ft · in</b> to work in feet and inches (like <b>12' 6\"</b>), or <b>Metric</b> to work in millimetres.",
    "You can type sizes either way in any box: <b>12'</b>, <b>12' 6\"</b>, <b>150\"</b>, <b>3.6 m</b> or <b>3600</b> all work.",
  ],
  when: "First, so every size you see matches the plans you're used to. Houses in the US are usually drawn in feet and inches.",
  tip: "Switching sets the standard wall thickness, wall height and grid for that system.",
  check: (t) => t.archUnitsPicked(),
};
const RAISE = (h, label, metric = h > 2600 ? "2.7 m" : "2.4 m") => ({
  title: "Raise the walls", tool: "Raise walls", icon: "archRaise", show: { sel: "#ar-raise-all, #ar-raise" },
  how: [
    "Click <b>Raise walls</b> (or press <b>E</b>).",
    `Click the <b>${label}</b> height button (metric: <b>${metric}</b>), or type it in <b>Height</b> and press Enter.`,
    "Click <b>Raise all walls on Level 1</b> and watch the floor plan grow into walls.",
  ],
  when: "After the floor plan is right. A plan is quick to change; raised walls are where doors and windows go.",
  check: (t) => t.archRaised(h, 120),
});
const PLACE = (what, preset, where) => ({
  title: `Add ${what}`, tool: what.includes("window") ? "Window" : "Door", icon: what.includes("window") ? "archWindow" : "archDoor",
  show: { sel: `#ar-cat [data-p="${preset}"], ${what.includes("window") ? "#ar-window" : "#ar-door"}` },
  how: [
    `Click <b>${what.includes("window") ? "Window" : "Door"}</b> (or press <b>${what.includes("window") ? "N" : "D"}</b>).`,
    `In the panel, pick <b>${presetName(preset)}</b>.`,
    `Point at ${where}: a blue preview snaps along the wall (red means it doesn't fit there). Click to put it in.`,
    "Press <b>Esc</b> when you're done.",
  ],
  when: "Doors and windows cut real openings in the wall, with frames, so they show up when you 3D print the house.",
});
const presetName = (id) => ({ garage9: "Garage door 9'", ext36: 'Front door 36"', int32: 'Interior door 32"', int30: 'Interior door 30"', sh3648: "Single hung 36×48", sh2436: "Small 24×36", pic7248: "Picture 72×48", patio72: 'Sliding patio 72"', garage16: "Garage door 16'", bath2424: "Bathroom 24×24", dbl60: 'Double door 60"', sl4836: "Slider 48×36" }[id] || id);
const ROOF = (kind, label, slope) => ({
  title: `A ${label} roof`, tool: "Roof", icon: "archRoof", show: { sel: `#ar-roofs [data-r="${kind}"], #ar-roof` },
  how: [
    "Click <b>Roof</b> (or press <b>O</b>).",
    `Pick <b>${label[0].toUpperCase() + label.slice(1)}</b>, then click the <b>${slope}</b> slope button.`,
    "Click <b>Cover the whole level</b>.",
    "In the roof panel, try a different <b>Overhang</b> (how far it sticks out past the walls).",
  ],
  when: { gable: "A gable roof has two slopes and triangle ends: the classic house shape, simple to build.", hip: "A hip roof slopes down on all four sides: sturdy in strong winds, and no tall gable walls.", flat: "Flat roofs suit garages, shops and modern buildings.", shed: "A shed roof is one slope: sheds, porches and modern houses." }[kind],
  check: (t) => t.archRoof(kind),
});

export const ARCH_TUTORIALS = [
  // ---------------------------------------------------------------- 1
  {
    id: "h-shed", mode: "arch", level: "Easy", minutes: "6-8", item: "Garden shed",
    title: "Garden shed",
    blurb: "Your first building: a 12' × 10' shed with a door, a window and a gable roof. Learn the Room tool, raising walls and roofs.",
    learn: ["Units", "Room", "Raise walls", "Door", "Window", "Gable roof"],
    steps: [
      nameStep("Garden Shed", "Lopez, Maria, Garden Shed"),
      UNITS,
      {
        title: "Draw the floor plan", tool: "Room", icon: "archRoom", show: { sel: "#ar-room" },
        how: [
          "Click <b>Room</b> (or press <b>R</b>).",
          "Press and hold where one corner goes, drag to the opposite corner and let go. The blue labels show the sizes as you drag.",
          "Make it <b>12' × 10'</b> (about <b>3.6 m × 3 m</b>). It snaps to the grid, so this is easy.",
        ],
        when: "Room draws four walls at once, for any rectangular room or building.",
        tip: "Missed? Press Ctrl+Z and drag again. Right-drag turns the view, scroll zooms.",
        check: (t) => t.archRect(12 * FT, 10 * FT, 220),
      },
      RAISE(8 * FT, "8'"),
      { ...PLACE("a front door", "ext36", "the middle of the front wall"), check: (t) => t.archOpens("door").length > 0 },
      { ...PLACE("a window", "sh3648", "a side wall"), check: (t) => t.archOpens("window").length > 0 },
      ROOF("gable", "gable", "6/12"),
      saveStep(),
    ],
  },
  // ---------------------------------------------------------------- 2
  {
    id: "h-cabin", mode: "arch", level: "Easy", minutes: "8-10", item: "Two-room cabin",
    title: "Two-room cabin",
    blurb: "A 24' × 16' cabin split into two rooms with an inside wall and an inside door. Learn the Wall tool, plan view and wall types.",
    learn: ["Room", "Wall", "Wall type", "Plan view", "Interior door", "Hip roof"],
    steps: [
      nameStep("Cabin", "Lopez, Maria, Cabin"),
      {
        title: "The outside walls", tool: "Room", icon: "archRoom", show: { sel: "#ar-room" },
        how: ["Click <b>Room</b> and drag a <b>24' × 16'</b> rectangle (about <b>7.2 m × 4.8 m</b>)."],
        when: "Start with the outside of the building, then divide it into rooms.",
        check: (t) => t.archRect(24 * FT, 16 * FT, 250),
      },
      {
        title: "Look straight down", tool: "Plan view", icon: "archPlan", show: { sel: "#ar-plan" },
        how: ["Click <b>Plan view</b> (or press <b>P</b>). You see the plan from above like a drawing, with every wall's length."],
        when: "Plan view is the easiest way to draw and check inside walls. Click it again (3D view) to go back.",
        check: (t) => t.archPlanSeen(),
      },
      {
        title: "An inside wall", tool: "Wall", icon: "archWall", show: { sel: "#ar-wall" },
        how: [
          "Click <b>Wall</b> (or press <b>W</b>).",
          "In the panel, set <b>Wall type</b> to <b>Interior 2×4 (4½\")</b> (or <b>Interior 100 mm</b>): inside walls are thinner.",
          "Click on the long front wall about <b>10'</b> (3 m) from the left corner: it snaps to the wall.",
          "Click straight across on the back wall (it stays straight on its own), then press <b>Enter</b>.",
        ],
        when: "The Wall tool draws walls corner by corner: inside walls, L-shapes and anything that isn't a plain rectangle.",
        tip: "Hold Shift to draw at any angle. Type a length (like 16') and press Enter for an exact wall.",
        check: (t) => t.archInside().length > 0,
      },
      RAISE(8 * FT, "8'"),
      {
        title: "A door between the rooms", tool: "Door", icon: "archDoor", show: { sel: '#ar-cat [data-p="int30"], #ar-door' },
        how: ["Click <b>Door</b> and pick <b>Interior door 30\"</b>.", "Point at the inside wall and click. Then press <b>Esc</b>."],
        when: "Inside doors are narrower than outside doors: 28\" to 32\" is typical.",
        check: (t) => { const ins = new Set(t.archInside().map((w) => w.id)); return t.arch().openings.some((o) => o.k === "door" && ins.has(o.wall)); },
      },
      { ...PLACE("a front door", "ext36", "an outside wall"), check: (t) => t.archOpens("door").length >= 2 },
      { ...PLACE("two windows", "sh3648", "the outside walls, one in each room"), check: (t) => t.archOpens("window").length >= 2 },
      ROOF("hip", "hip", "6/12"),
      saveStep(),
    ],
  },
  // ---------------------------------------------------------------- 3
  {
    id: "h-grid", mode: "arch", level: "Proficient", minutes: "10-12", item: "Cottage",
    title: "Exact placement: the wall grid",
    blurb: "A 30' × 20' cottage where every door and window is exactly where the plan says. Learn the wall grid, see-through editing and typing positions.",
    learn: ["Room", "Select a wall", "Wall grid", "From start / From end", "Center", "Sill height"],
    steps: [
      nameStep("Cottage", "Lopez, Maria, Cottage"),
      {
        title: "Plan and walls", tool: "Room + Raise walls", icon: "archRoom", show: { sel: "#ar-room" },
        how: ["Draw a <b>30' × 20'</b> room (about <b>9 m × 6 m</b>).", "Raise the walls to <b>9'</b> (about <b>2.7 m</b>)."],
        when: "9' (2.7 m) walls are common in newer houses; 8' (2.4 m) in older ones.",
        check: (t) => t.archRect(30 * FT, 20 * FT, 250) && t.archRaised(9 * FT, 400),
      },
      {
        title: "Select the front wall", tool: "Select", icon: "select", show: { sel: "#ar-select" },
        how: [
          "Click <b>Select</b> (or press <b>V</b>), then click the long front wall.",
          "The rest of the house turns see-through, and the <b>Wall grid</b> opens at the bottom: the wall seen straight on, with a grid every 6\" (100 mm).",
        ],
        when: "Whenever you want to see or change one wall: everything else fades out of the way.",
        check: (t) => t.archSelWall() || t.archOpens().length > 0,
      },
      {
        title: "A door in the exact middle", tool: "+ Door, Center", icon: "archDoor", show: { sel: "#ar-add-door, #ar-center" },
        how: ["In the wall panel click <b>+ Door</b>: a door goes in the middle of the wall.", "Change <b>Model</b> to <b>Front door 36\"</b>, then click <b>Center</b>."],
        when: "Front doors are usually centered, or lined up with a path or porch.",
        check: (t) => t.archOpens("door").length > 0,
      },
      {
        title: "A window 4' from the corner", tool: "Wall grid", icon: "archWindow", show: { sel: "#ar-os, #ar-add-window" },
        how: [
          "Click <b>Back to the wall</b>, then <b>+ Window</b>.",
          "In <b>From start</b> type <b>4'</b> (or <b>1200</b>) and press Enter. The window jumps there, and the grid shows the distances.",
        ],
        when: "Plans give window positions as distances from a corner: type them in instead of guessing.",
        check: (t) => t.archOpenAt("window", 4 * FT, 80) || t.archOpenAt("window", 1200, 40),
      },
      {
        title: "A matching window 4' from the other end", tool: "From end", icon: "archWindow", show: { sel: "#ar-oe, #ar-add-window" },
        how: ["Back on the wall, click <b>+ Window</b> again.", "Type <b>4'</b> (or <b>1200</b>) in <b>From end</b> and press Enter."],
        when: "Measuring from either end makes symmetrical fronts easy.",
        check: (t) => t.archOpens("window").length >= 2,
      },
      {
        title: "Drag on the grid", tool: "Wall grid", icon: "archWindow", show: { sel: "#arch-elev" },
        how: [
          "Select another wall and add a <b>Small 24×36</b> window.",
          "In the <b>Wall grid</b>, drag the window: it snaps to the grid and to the middle of the wall. Windows can also go up and down.",
          "Set its <b>Sill height</b> to <b>4'</b> (or <b>1200</b>): a high window, like over a kitchen counter.",
        ],
        when: "Dragging is quick for trying ideas; typing is exact. Use both.",
        check: (t) => t.arch().openings.some((o) => o.k === "window" && Math.abs(o.sill - 4 * FT) < 120),
      },
      ROOF("gable", "gable", "8/12"),
      saveStep(),
    ],
  },
  // ---------------------------------------------------------------- 4
  {
    id: "h-ranch", mode: "arch", level: "Advanced", minutes: "12-15", item: "Ranch house",
    title: "L-shaped ranch with a garage",
    blurb: "Draw an L-shaped house by typing each wall's length, then add a garage door, a patio door, windows, a floor and two roofs.",
    learn: ["Wall (typed lengths)", "Garage door", "Sliding patio door", "Floor", "Roof by dragging", "Ridge direction"],
    steps: [
      nameStep("Ranch House", "Lopez, Maria, Ranch House"),
      {
        title: "An L-shaped plan, typed", tool: "Wall", icon: "archWall", show: { sel: "#ar-wall" },
        how: [
          "Click <b>Wall</b>. Click a start point on the grid.",
          "Move the pointer to the right, type <b>40'</b> and press Enter. Move up, type <b>24'</b>, Enter.",
          "Move left, type <b>16'</b>, Enter. Move up, type <b>12'</b>, Enter. Move left, type <b>24'</b>, Enter.",
          "Click the very first point to close the outline (6 walls).",
        ],
        when: "Typing lengths is the fastest way to copy a real plan exactly. The direction comes from where the pointer is.",
        tip: "Metric: 12000, 7200, 4800, 3600, 7200.",
        check: (t) => t.archWalls().length >= 6 && (() => { const b = t.archBox(); return b && Math.abs(Math.max(b.w, b.d) - 40 * FT) < 600; })(),
      },
      RAISE(9 * FT, "9'"),
      { ...PLACE("a garage door", "garage16", "the long front wall, near one end"), check: (t) => t.archPreset(["garage16", "garage9"]).length > 0 },
      { ...PLACE("a sliding patio door", "patio72", "the back wall"), check: (t) => t.archPreset(["patio72"]).length > 0 },
      { ...PLACE("four windows", "sh3648", "the outside walls"), check: (t) => t.archOpens("window").length >= 4 },
      {
        title: "A floor", tool: "Floor", icon: "archFloor", show: { sel: "#ar-floor-all, #ar-floor" },
        how: ["Click <b>Floor</b> (or press <b>G</b>), then <b>Cover the whole level</b>."],
        when: "A floor slab holds a printed model together and looks finished from below.",
        check: (t) => t.archSlab(),
      },
      {
        title: "Two roofs for the L", tool: "Roof", icon: "archRoof", show: { sel: "#ar-roof" },
        how: [
          "Click <b>Roof</b> and pick <b>Gable</b>.",
          "Drag across the long part of the house, from one outside corner to the opposite one: the roof covers just that part.",
          "Drag again across the short wing for a second roof.",
          "Select a roof and change <b>Ridge runs</b> so each ridge runs along the length of its part.",
        ],
        when: "Roofs are rectangles: an L-shaped house gets one roof per wing, just like real framing.",
        check: (t) => t.archRoofs() >= 2,
      },
      saveStep(),
    ],
  },
  // ---------------------------------------------------------------- 5
  {
    id: "h-twostory", mode: "arch", level: "Expert", minutes: "15-20", item: "Two-story house",
    title: "Two-story house, ready to 3D print",
    blurb: "Build two levels, then send the house to Beginner at ¼\" = 1' scale and export an STL for 3D printing.",
    learn: ["Levels", "Raise walls", "Doors and windows", "Gable roof", "Send to design", "Scale", "Export STL"],
    steps: [
      nameStep("Two-Story House", "Lopez, Maria, Two-Story House"),
      {
        title: "The ground floor", tool: "Room + Raise walls", icon: "archRoom", show: { sel: "#ar-room" },
        how: ["Draw a <b>28' × 24'</b> room (about <b>8.4 m × 7.2 m</b>) and raise its walls to <b>9'</b>."],
        when: "Each level is drawn and raised on its own.",
        check: (t) => t.archRect(28 * FT, 24 * FT, 250) && t.archRaised(9 * FT, 400),
      },
      { ...PLACE("a front door and two windows", "ext36", "the front wall (then switch to Window for the windows)"), check: (t) => t.archOpens("door").length >= 1 && t.archOpens("window").length >= 2 },
      {
        title: "A second level", tool: "Level", icon: "archRaise", show: { sel: "#ar-addlevel, #ar-level" },
        how: [
          "Press <b>Esc</b> until nothing is selected; the panel shows <b>Architect</b>.",
          "Click <b>+ Level above</b>. Level 2 starts right on top of Level 1, with the outside walls copied as a floor plan.",
          "Use the <b>Level</b> list in the toolbar to switch between levels at any time.",
        ],
        when: "For any building with more than one floor. The other levels show faded so you can line things up.",
        check: (t) => t.arch().levels.length >= 2,
      },
      { ...RAISE(8 * FT, "8'"), title: "Raise the upstairs walls", check: (t) => t.archRaised(8 * FT, 400, 2) },
      { ...PLACE("upstairs windows", "sh3648", "the Level 2 walls, above the windows below"), check: (t) => t.archOpens("window", 2).length >= 2 },
      { ...ROOF("gable", "gable", "8/12"), how: ["Make sure <b>Level 2</b> is chosen in the toolbar.", "Click <b>Roof</b>, pick <b>Gable</b> and the <b>8/12</b> slope, then <b>Cover the whole level</b>."] },
      {
        title: "Send it to Beginner", tool: "Send to design", icon: "archSend", show: { sel: "#ar-send" },
        how: [
          "Click <b>Send to design</b>.",
          "Pick the scale <b>1:48 · ¼\" = 1'</b> (or <b>1:100</b> for metric). The dialog shows how big the model will be.",
          "Keep <b>Then open: Beginner</b> and click <b>Send to design</b>. The house arrives as walls, doors, frames and roofs you can print.",
        ],
        when: "When the building is done (you can always come back to Architect, change it and send it again).",
        tip: "At 1:48 a 28' house is 7\" long: it fits most 3D printers.",
        check: (t) => t.archSent(),
      },
      saveStep(),
      exportStep(),
    ],
  },
];

// ------------------------------------------------------------------ more building projects and the landscape
const LOGTYPE = (label, metric) => ({
  title: "Pick log walls", tool: "Room · Wall type", icon: "archWall", show: { sel: "#ar-walltype, #ar-room" },
  how: [
    "Click <b>Room</b> (or press <b>R</b>).",
    `In the panel, set <b>Wall type</b> to <b>${label}</b> (metric: <b>${metric}</b>). The list has a <b>Log cabin</b> group.`,
  ],
  when: "Before drawing: new walls are made of the wall type you pick. You can also change a wall later: select it and use <b>Build as</b>.",
  check: (t) => !!(t.arch().wallLog || t.archWalls().some((w) => w.log)),
});
const GROUND_STEP = {
  title: "Make the ground", tool: "Landscape", icon: "archLand", show: { sel: "#ar-land-make, #ar-land" },
  how: [
    "Click <b>Landscape</b> (or press <b>L</b>).",
    "Under <b>Make the ground</b>, click the middle size (<b>25' around</b> or <b>8 m around</b>).",
    "A lawn appears around the house. It belongs to Architect only: the other modes get just the house.",
  ],
  when: "First, before shaping hills, digging ponds or planting.",
  check: (t) => t.archLand(),
};
const HOUSE_QUICK = (w, d, what) => ({
  title: "A quick house", tool: "Room + Raise walls + Roof", icon: "archRoom", show: { sel: "#ar-room" },
  how: [`Draw a <b>${w}' × ${d}'</b> room, raise the walls to <b>8'</b>, put in a <b>Front door 36"</b> and cover it with a <b>Gable</b> roof.`, what],
  when: "Any house will do: this project is about what goes around it.",
  check: (t) => t.archRaised(null) && t.archOpens("door").length > 0 && t.archRoof(),
});
const PLANT = (n, what, cat) => ({
  title: `Plant ${what}`, tool: "Landscape · Plant", icon: "archLand", show: { sel: `#ar-pcat, #ar-landtools [data-t="plant"]` },
  how: [
    "In the Landscape panel, click <b>Plant</b>.",
    `Click <b>${cat}</b> to see that group, pick one, then click on the ground to place it. Drag to plant a row.`,
    `Place at least <b>${n}</b>. Pick different kinds for a natural look.`,
  ],
  when: "Plants and stones make the model look real, and they print as their own colored parts.",
});
ARCH_TUTORIALS.push(
  // ---------------------------------------------------------------- 6
  {
    id: "h-logcabin", mode: "arch", level: "Easy", minutes: "8-10", item: "Log cabin",
    title: "Round-log cabin",
    blurb: "A 16' × 12' cabin built from round logs that cross at the corners, with a door, a window and a steep gable roof.",
    learn: ["Units", "Wall type: round logs", "Room", "Raise walls", "Door", "Window", "Gable roof"],
    steps: [
      nameStep("Log Cabin", "Lopez, Maria, Log Cabin"),
      UNITS,
      LOGTYPE('Round logs 10"', "Round logs 250 mm"),
      {
        title: "Draw the cabin", tool: "Room", icon: "archRoom", show: { sel: "#ar-room" },
        how: ["Drag a <b>16' × 12'</b> room (about <b>4.8 m × 3.6 m</b>). The walls are log-thick."],
        when: "Log cabins are simple rectangles: logs come in lengths that make long walls hard.",
        check: (t) => t.archRect(16 * FT, 12 * FT, 400) && t.archLogs("round"),
      },
      { ...RAISE(8 * FT, "8'"), how: [...RAISE(8 * FT, "8'").how, "The logs stack up, and run past each corner where they cross, like a real cabin."] },
      { ...PLACE("a front door", "ext36", "the middle of a long wall"), check: (t) => t.archOpens("door").length > 0 },
      { ...PLACE("a window", "sh3648", "a short wall"), check: (t) => t.archOpens("window").length > 0 },
      ROOF("gable", "gable", "12/12"),
      saveStep(),
    ],
  },
  // ---------------------------------------------------------------- 7
  {
    id: "h-workshop", mode: "arch", level: "Easy", minutes: "8-10", item: "Square-log workshop",
    title: "Square-log workshop",
    blurb: "A 24' × 20' workshop of hewn square logs, with a garage door, a small window and a shed roof.",
    learn: ["Wall type: square logs", "Garage door", "Shed roof"],
    steps: [
      nameStep("Log Workshop", "Lopez, Maria, Log Workshop"),
      LOGTYPE('Square logs 8" (hewn)', "Square logs 200 mm"),
      {
        title: "Draw the workshop", tool: "Room", icon: "archRoom", show: { sel: "#ar-room" },
        how: ["Drag a <b>24' × 20'</b> room (about <b>7.2 m × 6 m</b>)."],
        when: "Square (hewn) logs sit flat on each other with a strip of chinking between them.",
        check: (t) => t.archRect(24 * FT, 20 * FT, 400) && t.archLogs("square"),
      },
      RAISE(9 * FT, "9'"),
      { ...PLACE("a garage door", "garage9", "the middle of a long wall"), check: (t) => t.archPreset(["garage9", "garage16"]).length > 0 },
      { ...PLACE("a small window", "sh2436", "a short wall"), check: (t) => t.archOpens("window").length > 0 },
      ROOF("shed", "shed", "4/12"),
      saveStep(),
    ],
  },
  // ---------------------------------------------------------------- 8
  {
    id: "h-shop", mode: "arch", level: "Proficient", minutes: "12-15", item: "Corner café",
    title: "Small business: a corner café",
    blurb: "A 30' × 24' shop with tall walls, a double front door, big display windows, a back door, a flat roof, a floor and brick walls.",
    learn: ["Tall walls", "Double door", "Picture windows", "Flat roof", "Floor", "Finishes: brick"],
    steps: [
      nameStep("Corner Café", "Lopez, Maria, Corner Café"),
      {
        title: "The shop floor plan", tool: "Room", icon: "archRoom", show: { sel: "#ar-room" },
        how: ["Draw a <b>30' × 24'</b> room (about <b>9 m × 7.2 m</b>)."],
        when: "Shops are open spaces: one big room you can divide later.",
        check: (t) => t.archRect(30 * FT, 24 * FT, 250),
      },
      RAISE(12 * FT, "12'", "3.6 m"),
      { ...PLACE("a double front door", "dbl60", "the middle of the long front wall"), check: (t) => t.archPreset(["dbl60"]).length > 0 },
      { ...PLACE("two display windows", "pic7248", "the front wall, one on each side of the door"), check: (t) => t.archPreset(["pic7248"]).length >= 2 },
      { ...PLACE("a back door", "ext36", "the back wall (for deliveries)"), check: (t) => t.archOpens("door").length >= 2 },
      ROOF("flat", "flat", "4/12"),
      {
        title: "A floor", tool: "Floor", icon: "archFloor", show: { sel: "#ar-floor-all, #ar-floor" },
        how: ["Click <b>Floor</b> (or press <b>G</b>), then <b>Cover the whole level</b>."],
        when: "Shops sit on a concrete slab.",
        check: (t) => t.archSlab(),
      },
      {
        title: "Brick walls", tool: "Finishes", icon: "archFinish", show: { sel: "#ar-fin-presets, #ar-finish" },
        how: ["Click <b>Finishes</b> (or press <b>T</b>).", "Under <b>Quick picks</b> click <b>Brick</b>, then click <b>All walls on Level 1</b>."],
        when: "Finishes give the walls a colour and a texture you can see, and that print on the model when you send it to Beginner.",
        check: (t) => t.archFinished("wall") >= 4,
      },
      saveStep(),
    ],
  },
  // ---------------------------------------------------------------- 9
  {
    id: "l-yard", mode: "arch", level: "Easy", minutes: "8-10", item: "Yard with a hill",
    title: "Landscape basics: a yard",
    blurb: "Put a house on the ground, then raise a hill, paint a stone path to the door and plant trees.",
    learn: ["Landscape", "Make the ground", "Raise", "Paint", "Plant"],
    steps: [
      nameStep("My Yard", "Lopez, Maria, My Yard"),
      HOUSE_QUICK(20, 16, "Tip: the Room, Raise walls, Door and Roof tools are on the left of the toolbar."),
      GROUND_STEP,
      {
        title: "Raise a hill", tool: "Landscape · Raise", icon: "archLand", show: { sel: '#ar-landtools [data-t="raise"]' },
        how: ["Click <b>Raise</b>.", "Drag back and forth on the ground behind the house: it builds up a hill. Hold still to keep raising.", "Use <b>Lower</b> to dig, and <b>Smooth</b> to round it off."],
        when: "Real yards are rarely flat: hills and dips change how the house sits, and where rain goes.",
        tip: "The circle shows the brush. Make it bigger with Brush size.",
        check: (t) => t.archLandRange(500),
      },
      {
        title: "Paint a path", tool: "Landscape · Paint", icon: "archLand", show: { sel: '#ar-grounds, #ar-landtools [data-t="paint"]' },
        how: ["Click <b>Paint</b>, then pick <b>Stone path</b> (or <b>Gravel path</b>).", "Drag from the front door out to the edge of the ground."],
        when: "Paths, patios, gardens and beaches are all paint: the ground keeps its shape.",
        check: (t) => t.archPainted(["stonepath", "gravel", "brickpath", "paving"]),
      },
      { ...PLANT(3, "three trees", "Trees"), check: (t) => t.archPlants("tree") >= 3 },
      saveStep(),
    ],
  },
  // ---------------------------------------------------------------- 10
  {
    id: "l-pond", mode: "arch", level: "Proficient", minutes: "10-12", item: "Pond garden",
    title: "A pond garden",
    blurb: "Dig a pond that fills with water, give it a sandy shore, cattails and lily pads, plant flowers, then watch the water move in the rain.",
    learn: ["Pond / lake", "Paint: sand", "Grass & flowers", "Simulate: weather", "Moving water"],
    steps: [
      nameStep("Pond Garden", "Lopez, Maria, Pond Garden"),
      HOUSE_QUICK(16, 12, "A small house or garden shed is plenty."),
      GROUND_STEP,
      {
        title: "Dig a pond", tool: "Landscape · Pond / lake", icon: "archLand", show: { sel: '#ar-landtools [data-t="water"]' },
        how: ["Click <b>Pond / lake</b>.", "Drag in a loop on the ground beside the house: it digs down and fills with water.", "Set <b>Water depth</b> for a deeper lake."],
        when: "Ponds, lakes and streams. The water stays level with where you started dragging.",
        check: (t) => t.archLandWater(),
      },
      {
        title: "A sandy shore", tool: "Landscape · Paint", icon: "archLand", show: { sel: '#ar-grounds [data-g="beach"], #ar-landtools [data-t="paint"]' },
        how: ["Click <b>Paint</b> and pick <b>Beach sand</b> (or <b>Sand</b> or <b>Dune sand</b>).", "Paint a ring around the pond."],
        when: "Shores, river stones and moss make water look real.",
        check: (t) => t.archPainted(["beach", "sand", "dune", "riverstone"]),
      },
      { ...PLANT(2, "cattails and lily pads", "Grass & flowers"), how: ["In the Landscape panel, click <b>Plant</b> and then <b>Grass & flowers</b>.", "Put <b>Cattails (reeds)</b> at the edge of the pond and <b>Lily pads</b> on the water."], check: (t) => t.archPlants(["reeds", "lilypad"]) >= 2 },
      { ...PLANT(3, "flowers", "Grass & flowers"), how: ["Still in <b>Grass & flowers</b> (or <b>Shrubs</b>), plant <b>Wildflowers</b>, <b>Tulips</b>, <b>Lavender</b> or <b>Rose bushes</b> around the garden.", "Place at least 3."], check: (t) => t.archPlants(["wildflowers", "tulips", "lavender", "rose", "hydrangea", "shrub"]) >= 3 },
      {
        title: "Weather and moving water", tool: "Simulate", icon: "archSim", show: { sel: "#ar-wx-kind, #ar-sim" },
        how: ["Click <b>Simulate</b> (or press <b>S</b>).", "Make sure <b>Moving water</b> is ticked: the pond ripples.", "Click <b>Rain</b> (try <b>Snow</b>, <b>Fog</b> and <b>Thunderstorm</b> too), and raise the <b>Wind</b>."],
        when: "To see your design in different weather. It is only for looking: it never changes the model.",
        check: (t) => t.archWeather(),
      },
      saveStep(),
    ],
  },
  // ---------------------------------------------------------------- 11
  {
    id: "l-flood", mode: "arch", level: "Advanced", minutes: "10-15", item: "Flood test",
    title: "Will it flood? Test a house in a storm",
    blurb: "Run a rainstorm over a house and its yard, see where the water collects and whether it gets in, fix it by raising the house on graded ground, and test again.",
    learn: ["Simulate", "Flood test: rainstorm", "Reading the results", "Graded pad", "Rising water"],
    steps: [
      nameStep("Flood Test", "Lopez, Maria, Flood Test"),
      HOUSE_QUICK(24, 16, "Doors matter here: water gets in where a door meets the ground."),
      GROUND_STEP,
      {
        title: "Run a rainstorm", tool: "Simulate · Flood test", icon: "archSim", show: { sel: "#ar-flood-run, #ar-sim" },
        how: ["Click <b>Simulate</b> (or press <b>S</b>).", "Under <b>Flood test</b>, keep <b>Rainstorm</b>, click <b>Very heavy</b> and <b>3 hours</b>.", "Click <b>Run the flood test</b>. Rain falls, runs off the roof, soaks in and flows downhill."],
        when: "Before building: a house on flat or low ground can flood in a big storm.",
        check: (t) => t.archFloodDone(),
      },
      {
        title: "Read the result", tool: "Results", icon: "archSim", show: { sel: "#ar-flood-result" },
        how: ["The panel says whether water gets above the floor, and by how much, at each door. Red labels in the view mark the doors that flood.", "Deeper water is darker blue. Turn the view to see where it collects."],
        when: "Water collects in low places and against the walls, where the roof drains.",
        check: (t) => t.archFloodDone(),
      },
      {
        title: "Fix it", tool: "Fix it / Landscape", icon: "archLand", show: { sel: "#ar-flood-fix, #ar-flood-result" },
        how: ["If the house flooded, click <b>Fix it: raise the house on a graded pad</b>: the floor goes up and the ground slopes away on every side.", "Or fix it yourself: in <b>Landscape</b>, raise the ground and lower it away from the house, or dig a pond for the water to go to; or set the level's <b>Floor at</b> higher."],
        when: "Builders always slope the ground away from a house: about 6\" in the first 10' (150 mm in 3 m).",
        check: (t) => t.archFloorRaised() || t.archFloodDry(),
      },
      {
        title: "Test again", tool: "Simulate · Flood test", icon: "archSim", show: { sel: "#ar-flood-run" },
        how: ["Back in <b>Simulate</b>, click <b>Run the flood test</b> with the same storm.", "It should now say <b>Dry</b>."],
        when: "Always test again after a change.",
        check: (t) => t.archFloodDry(),
      },
      {
        title: "A rising river", tool: "Simulate · Rising water", icon: "archSim", show: { sel: "#ar-flood-mode" },
        how: ["Click <b>Rising water</b>.", "Set <b>Water rises to</b> a height (try <b>2'</b> or <b>600</b>) and run the test: the water comes in from the edges of the land, like a river or the sea."],
        when: "Near rivers, lakes and the coast, floods come from rising water more than from rain.",
        check: (t) => t.archFloodDone("rise"),
      },
      saveStep(),
    ],
  },
  // ---------------------------------------------------------------- 12
  {
    id: "l-print", mode: "arch", level: "Expert", minutes: "15-20", item: "House and landscape model",
    title: "House and landscape, ready to 3D print",
    blurb: "Finish a house with brick walls and a shingle roof, give it a yard with a hill, a pond and trees, and export it all as one colored 3MF that fits the build plate.",
    learn: ["Finishes", "Landscape", "Pond", "Plants", "Export 3MF", "Scale to fit"],
    steps: [
      nameStep("House and Yard", "Lopez, Maria, House and Yard"),
      HOUSE_QUICK(24, 20, "Add a window or two as well."),
      {
        title: "Brick walls, shingle roof", tool: "Finishes", icon: "archFinish", show: { sel: "#ar-fin-presets, #ar-finish" },
        how: ["Click <b>Finishes</b> (or press <b>T</b>).", "Click <b>Brick</b>, then <b>All walls on Level 1</b>.", "Click <b>Shingles</b>, then <b>All roofs</b>."],
        when: "Finishes print as real texture on the model.",
        check: (t) => t.archFinished("wall") >= 4 && t.archFinished("roof") >= 1,
      },
      GROUND_STEP,
      {
        title: "A hill and a pond", tool: "Landscape", icon: "archLand", show: { sel: "#ar-landtools" },
        how: ["With <b>Raise</b>, build a hill on one side.", "With <b>Pond / lake</b>, dig a pond on the other."],
        when: "Shape makes a landscape interesting to look at and to print.",
        check: (t) => t.archLandRange(400) && t.archLandWater(),
      },
      { ...PLANT(4, "trees and shrubs", "Trees"), check: (t) => t.archPlants() >= 4 },
      {
        title: "Export it", tool: "Export", icon: "archExport", show: { sel: "#ar-export, #ar-exp-go" },
        how: ["Click <b>Export</b> in the toolbar.", "Keep <b>3MF (colours)</b> and <b>Fit the 256 mm build plate</b>: everything is scaled down together.", "Click <b>Export</b>. Each part (ground, water, trees, walls, roof) is its own colored object for a multi-color printer."],
        when: "When it's finished. STL works for single-color printers.",
        check: (t) => t.exported("3mf") || t.exported("stl") || t.exported("obj"),
      },
      saveStep(),
    ],
  },
);
void IN;
