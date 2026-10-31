// Floor Planner tutorials (built into the planner by make_floorplan.py): ten projects, from a
// first room to a furnished two-story house, a shop and the classroom client jobs. Sizes are in
// feet (1 grid block = 1 foot). "Show me" points at the planner's buttons (show.fp); each check
// reads the plan through the helpers t.fp…

const SKETCH = {
  title: "Go to Basic Sketch", tool: "1 · Basic Sketch", icon: "rect", show: { fp: "#m-sketch" },
  how: [
    "The planner opens on its own welcome card. Click <b>Skip</b>, or click <b>1 · Basic Sketch</b> at the top.",
    "The blue graph paper is your plot: <b>1 grid block = 1 foot</b>, so a block is 1 square foot.",
  ],
  when: "Basic Sketch is where rooms are drawn and sized. Design 2D and Real Space 3D use these rooms.",
  check: (t) => t.fpMode("sketch"),
};
const RECT = (w, d, name, where = "") => ({
  title: `A ${w}' × ${d}' ${name.toLowerCase()}`, tool: "Rectangle", icon: "rect", anim: "rect", show: { fp: "[data-t=rect]" },
  how: [
    "Click <b>Rectangle</b> in Drawing Tools.",
    `Press where one corner goes${where} and drag to the opposite corner: <b>${w} blocks</b> across and <b>${d} blocks</b> down. The yellow label shows the size and square feet as you drag.`,
    "Let go. Every side gets its length and the room shows its square feet.",
  ],
  when: "Rectangle is the quickest way to draw a room. Most rooms are rectangles.",
  tip: "Missed by a block? Click Select, click the room, then type the exact width and depth in the boxes inside it.",
  check: (t) => !!t.fpRect(w, d),
});
const NAME = (w, d, name, rx) => ({
  title: `Name it ${name}`, tool: "Blueprint List", icon: "text", show: { fp: "#ir-n, #list .nm" },
  how: [
    "Click <b>Select</b>, then click the room: a box with its name opens inside it. Or use the name box on its card in the <b>Blueprint List</b> (right).",
    `Type <b>${name}</b>.`,
  ],
  when: "Names show on the plan and in the list, and the planner works out the room type from them (bedroom, bath, kitchen…).",
  check: (t) => { const r = t.fpRect(w, d); return !!r && rx.test(r.name); },
});
const SAVE = {
  title: "Save your work", tool: "💾 Save", icon: "save", show: { fp: "#fp-save" },
  how: [
    "Click <b>💾 Save</b> at the top (or press <b>Ctrl+S</b>).",
    "The first time, type your plan's name as <b>Last name, First name, Plan name</b> (like <b>Lopez, Maria, Apartment</b>) and click <b>Save</b>. After that one click saves it again.",
    "<b>📂 My plans</b> opens any saved plan. To take a plan to another computer, use <b>Save to a file</b> there.",
  ],
  when: "Save often: before you try something big, and always before you close the planner.",
  tip: "The planner also keeps your last plan by itself and offers to continue it next time.",
  check: (t) => t.fp().saved,
};
const DOWNLOAD = (what = "the floor plan") => ({
  title: "Download your plan", tool: "Download plan", icon: "finish", anim: "save", show: { fp: "#shotb" },
  how: [
    "Click <b>Download plan</b> (PLAN group, top right of the toolbar).",
    `Tick what to include (floor plan only, or with your design work), pick <b>Entire home</b>, choose <b>PDF</b>, <b>PNG</b> or <b>JPEG</b> and click <b>Download</b>, to keep ${what} or hand it in.`,
  ],
  when: "At the end of every project, so you have a picture of the plan with all its sizes.",
  check: (t) => t.fp().dl.some((n) => /floorplan/.test(n)),
});
const DESIGN = {
  title: "Go to Design 2D", tool: "2 · Design 2D", icon: "texture", show: { fp: "#m-design" },
  how: ["Click <b>2 · Design 2D</b> at the top. Your rooms come along exactly as you drew them."],
  when: "Design 2D is where furniture, floors, walls, doors, windows, the roof and the yard go.",
  check: (t) => t.fpMode("design"),
};
const ITEM = (cat, name, n = 1, extra = "") => ({
  title: n > 1 ? `${n} × ${name}` : `Add a ${name.toLowerCase()}`, tool: cat, icon: "box", show: { fp: `[data-c="${cat}"]` },
  how: [
    `On the left, open <b>${cat}</b>.`,
    `Click <b>${name}</b>, then click in the room to place it${n > 1 ? ` (click ${n} times for ${n})` : ""}. It snaps to the walls and the grid.`,
    `Press <b>Esc</b> to stop placing.${extra}`,
  ],
  when: "Every item is drawn at its real size, so you can see whether it fits with room to walk around.",
  tip: "Click a placed item to drag it. Arrow keys nudge it, R turns it 15°, the red ✕ deletes it.",
  check: (t) => t.fpItems((i) => i.n.startsWith(name)).length >= n,
});
const FLOOR = (kind, label) => ({
  title: `${label} floor`, tool: "Flooring", icon: "texture", show: { fp: "[data-c=Flooring]" },
  how: [
    "Open <b>Flooring</b> (Structural Changes).",
    `Click <b>${label}</b>, pick a colour or pattern, then click inside the room.`,
  ],
  when: "Floors are priced per square foot, so the room's cost in the Blueprint List goes up.",
  check: (t) => t.fp().rooms.some((r) => r.floor && r.floor.t === kind),
});

export const FP_TUTORIALS = [
  // ---------------------------------------------------------------- 1
  {
    id: "fp-room", mode: "plan", level: "Easy", minutes: "5-7", item: "First room",
    title: "Your first room",
    blurb: "Draw a 12' × 10' bedroom on graph paper: its sides, its square feet and its name. Then add a bathroom and download the plan.",
    learn: ["Basic Sketch", "Rectangle", "Square feet", "Blueprint List", "Save", "Download plan"],
    steps: [
      SKETCH,
      RECT(12, 10, "Bedroom"),
      NAME(12, 10, "Bedroom", /bed/i),
      {
        title: "Read the square feet", tool: "Blueprint List", icon: "measure", anim: "measure", show: { fp: "#tot" },
        how: [
          "Look inside the room: it says <b>120.0 sq ft</b>. That's 12 × 10 blocks, each one square foot.",
          "The <b>Blueprint List</b> (right) shows every room's size and square feet, and the <b>TOTAL</b> at the bottom.",
        ],
        when: "Square feet tell you how big a home is and how much it costs to build.",
        check: (t) => t.fp().total >= 119.5,
      },
      { ...RECT(8, 6, "Bathroom", ", touching the bedroom's right side"), tip: "Rooms snap edge to edge like magnets when you drag near another room. Hold Alt to drag freely." },
      NAME(8, 6, "Bathroom", /bath/i),
      SAVE, DOWNLOAD("your first plan"),
    ],
  },
  // ---------------------------------------------------------------- 2
  {
    id: "fp-apt", mode: "plan", level: "Easy", minutes: "8-10", item: "Small apartment",
    title: "A small apartment",
    blurb: "Four rooms at exact sizes (typed in, like 12' 6\"), doors, windows and a square-foot limit. A real apartment plan of about 520 sq ft.",
    learn: ["Rectangle", "Typed sizes", "Door", "Window", "Limit total sq ft"],
    steps: [
      SKETCH,
      RECT(16, 14, "Living room"), NAME(16, 14, "Living Room", /living/i),
      {
        title: "A kitchen, typed exactly", tool: "Select", icon: "move", anim: "move", show: { fp: "#ir-w, [data-t=select]" },
        how: [
          "Drag any rectangle next to the living room.",
          "Click <b>Select</b>, click the new room, and in the boxes inside it type <b>12</b> for the width and <b>10</b> for the depth (sizes like <b>12' 6\"</b> work too).",
          "Name it <b>Kitchen</b>.",
        ],
        when: "Typing sizes is exact. Neighbouring rooms that touch slide along so nothing overlaps.",
        check: (t) => { const r = t.fpRect(12, 10); return !!r && /kitchen/i.test(r.name); },
      },
      { ...RECT(12, 11, "Bedroom"), tip: "Draw it roughly, then type 12 and 11 in the boxes inside the room." }, NAME(12, 11, "Bedroom", /bed/i),
      RECT(8, 6, "Bathroom"), NAME(8, 6, "Bath", /bath/i),
      {
        title: "Doors", tool: "Door", icon: "archDoor", show: { fp: "[data-sk=door]" },
        how: ["Click <b>Door</b> (Doors, Windows &amp; Stairs), then click on a wall: it snaps into the wall at its real width.", "Put a front door in the living room and a door into each of the other rooms."],
        when: "Doors show which way people walk through the home.",
        check: (t) => t.fpItems((i) => i.k === "door").length >= 3,
      },
      {
        title: "Windows", tool: "Window", icon: "archWindow", show: { fp: "[data-sk=win]" },
        how: ["Click <b>Window</b>, then click on outside walls. Give the living room and the bedroom at least one each."],
        when: "Bedrooms need a window to the outside, for light and as a way out in an emergency.",
        check: (t) => t.fpItems((i) => i.k === "win").length >= 3,
      },
      {
        title: "Stay under 600 sq ft", tool: "Plot & limits", icon: "measure", show: { fp: "#lim" },
        how: ["On the left, tick <b>Limit total sq ft</b> and type <b>600</b>.", "If the total goes over, a red warning appears at the top of the plan."],
        when: "Clients and building lots have limits. The planner warns you when the plan is too big.",
        check: (t) => t.fp().lim && t.fp().total > 400,
      },
      SAVE, DOWNLOAD("the apartment plan"),
    ],
  },
  // ---------------------------------------------------------------- 3
  {
    id: "fp-shapes", mode: "plan", level: "Proficient", minutes: "8-10", item: "L-shaped room and a bay",
    title: "L-shapes and curved walls",
    blurb: "Rooms that aren't rectangles: an L-shaped great room with the Line tool, a curved bay with the Arc tool, and resizing by dragging corners and walls.",
    learn: ["Line", "Arc", "Select", "Drag a corner", "Undo / Redo"],
    steps: [
      SKETCH,
      {
        title: "An L-shaped room", tool: "Line", icon: "line", anim: "line", show: { fp: "[data-t=line]" },
        how: [
          "Click <b>Line</b>.",
          "Click each corner in turn: for example (2,2) → (14,2) → (14,8) → (8,8) → (8,14) → (2,14).",
          "Click the first point again to close the room (or double-click, or press Enter).",
        ],
        when: "Line draws any room with straight walls: L-shapes, angled walls, anything.",
        check: (t) => t.fp().rooms.some((r) => !r.arcs && r.edges >= 6),
      },
      {
        title: "A curved bay", tool: "Arc", icon: "arc", show: { fp: "[data-t=arc]" },
        how: [
          "Click <b>Arc</b>.",
          "Click a start point, then an end point, then a point the curve should pass through.",
          "Keep going with more lines or arcs and click the first point to close the shape.",
        ],
        when: "Arcs make round walls: bay windows, turrets, curved sunrooms.",
        check: (t) => t.fp().rooms.some((r) => r.arcs > 0),
      },
      {
        title: "Resize by dragging", tool: "Select", icon: "move", anim: "move", show: { fp: "[data-t=select]" },
        how: ["Click <b>Select</b>, click a room, then drag one of its yellow corner squares, or a wall, to make it bigger or smaller.", "Press <b>Ctrl+Z</b> to undo and <b>Ctrl+Y</b> to redo."],
        when: "Plans change all the time. Dragging is the fastest way to try a new size.",
      },
      SAVE, DOWNLOAD("the shapes"),
    ],
  },
  // ---------------------------------------------------------------- 4
  {
    id: "fp-bed", mode: "plan", level: "Proficient", minutes: "8-10", item: "Furnished bedroom",
    title: "Furnish a bedroom",
    blurb: "A 14' × 12' bedroom with a queen bed, two nightstands, a dresser, a rug, carpet and a painted accent wall, all at real sizes.",
    learn: ["Design 2D", "Bedroom furniture", "Rotate", "Rugs", "Flooring", "Walls"],
    steps: [
      SKETCH, RECT(14, 12, "Bedroom"), NAME(14, 12, "Bedroom", /bed/i), DESIGN,
      ITEM("Bedroom", "Queen Bed", 1, " Put its head against a wall."),
      ITEM("Bedroom", "Nightstand", 2, " One on each side of the bed."),
      ITEM("Bedroom", "Dresser", 1),
      {
        title: "Turn something", tool: "Rotate", icon: "move", show: { fp: "#rot" },
        how: ["Click the dresser, then press <b>R</b> (or <b>Rotate 15°</b>) until it faces the room, or drag the round ⟳ handle above it."],
        when: "Furniture usually sits against a wall, facing into the room.",
        check: (t) => t.fpItems((i) => i.k !== "door" && i.k !== "win" && i.r % 360 !== 0).length > 0,
      },
      ITEM("Rugs", "Rug 5×8"),
      FLOOR("carpet", "Carpet"),
      {
        title: "A painted wall", tool: "Walls", icon: "texture", show: { fp: "[data-c=Walls]" },
        how: ["Open <b>Walls</b>. Keep <b>Interior</b> and <b>One wall</b>.", "Pick a style (like <b>Shiplap</b>) and a wall colour, then click the wall behind the bed."],
        when: "An accent wall is a cheap way to change how a room feels.",
        check: (t) => t.fp().rooms.some((r) => r.inEw || (r.wall && r.wall.style !== "plain")),
      },
      SAVE, DOWNLOAD("the bedroom design"),
    ],
  },
  // ---------------------------------------------------------------- 5
  {
    id: "fp-kitchen", mode: "plan", level: "Proficient", minutes: "10-12", item: "Kitchen and dining",
    title: "Kitchen and dining",
    blurb: "A 20' × 14' open kitchen and dining room: cabinets, sink, range, fridge, dishwasher, an island with stools, a table and a coffee maker on the counter, on a tile floor.",
    learn: ["Kitchen", "Dining Room", "Accessories", "Tile", "Room costs"],
    steps: [
      SKETCH, RECT(20, 14, "Kitchen & dining room"), NAME(20, 14, "Kitchen & Dining", /kitchen/i), DESIGN,
      ITEM("Kitchen", "Cabinet Row 96", 1, " Put it along the top wall."),
      ITEM("Kitchen", "Single Sink"), ITEM("Kitchen", "Range 30"), ITEM("Kitchen", "Fridge 36"), ITEM("Kitchen", "Dishwasher"),
      ITEM("Kitchen", "Island 72"), ITEM("Kitchen", "Bar Stool", 3, " Line them up along the island."),
      ITEM("Dining Room", "Table 6 Seats"),
      {
        title: "Something on the counter", tool: "Accessories", icon: "box", show: { fp: "[data-c=Accessories]" },
        how: ["Open <b>Accessories</b>, click <b>Coffee Maker</b>, then click the counter or the island: it sits on top.", "Arrow keys slide it around on the counter."],
        when: "Accessories sit on furniture: lamps on tables, a TV on a stand, a mixer on a counter.",
        check: (t) => t.fpItems((i) => i.k === "acc" && i.on).length > 0,
      },
      FLOOR("tile", "Tile"),
      {
        title: "Read the costs", tool: "Blueprint List", icon: "measure", show: { fp: "#list" },
        how: ["In the Blueprint List, the room card splits costs into <b>Structural</b> (building, floor, walls, doors, windows) and <b>Furnishings</b>, with a room total and the home total."],
        when: "Designers keep a project inside the client's budget. Swap a pricey item and watch the total change.",
      },
      SAVE, DOWNLOAD("the kitchen design"),
    ],
  },
  // ---------------------------------------------------------------- 6
  {
    id: "fp-outside", mode: "plan", level: "Proficient", minutes: "10-12", item: "House outside",
    title: "Outside the house",
    blurb: "Brick, stone or siding on the outside walls, a hip roof with a front porch and dormers, trees and a driveway, then stand back and look at the house in 3D.",
    learn: ["Exterior walls", "Roofing", "Porch", "Dormers", "Outdoor", "House exterior view"],
    steps: [
      SKETCH, RECT(30, 24, "House"), DESIGN,
      {
        title: "Brick or stone outside", tool: "Walls", icon: "texture", show: { fp: "[data-c=Walls]" },
        how: ["Open <b>Walls</b> and pick <b>Exterior</b>, then <b>Whole room</b>.", "Choose <b>Brick</b>, <b>Stone</b>, <b>Siding</b> or a mix, then click inside the house."],
        when: "The outside finish is the first thing anyone sees, and it's priced by the wall area.",
        check: (t) => t.fp().rooms.some((r) => r.ext),
      },
      {
        title: "A hip roof", tool: "Roofing", icon: "archRoof", show: { fp: "[data-c=Roofing]" },
        how: ["Open <b>Roofing</b> and click <b>Hip</b>. The small front view shows it.", "Try a different <b>Pitch</b> and roof colour."],
        when: "A hip roof slopes down on all four sides: sturdy in strong winds.",
        check: (t) => t.fp().roof.st === "hip",
      },
      {
        title: "Porch and dormers", tool: "Roofing", icon: "archRoof", show: { fp: '[data-rk="porch|small"]' },
        how: ["In Roofing, pick a <b>Front porch</b> (Small or Full width) and add <b>Dormers</b> (1, 2 or 3)."],
        when: "Porches and dormers add curb appeal (and cost).",
        check: (t) => t.fp().roof.porch !== "none" && t.fp().roof.dorm > 0,
      },
      { ...ITEM("Outdoor", "Oak Tree", 2, " Put them in the yard, outside the house."), check: (t) => t.fpItems((i) => /Tree$/.test(i.n)).length >= 2 },
      { ...ITEM("Outdoor", "Concrete Driveway"), check: (t) => t.fpItems((i) => /Driveway/.test(i.n)).length >= 1 },
      {
        title: "Look at the house", tool: "3 · Real Space 3D", icon: "eye", show: { fp: "#m-space" },
        how: ["Click <b>3 · Real Space 3D</b>, then <b>🏠 View house exterior</b> on the left.", "Pick Front, Left, Right or Back, and slide the look direction to walk around it."],
        when: "Seeing the outside in 3D shows whether the roof, porch and finishes go together.",
        check: (t) => t.fp().views.some((v) => v !== "in"),
      },
      SAVE, DOWNLOAD("the house design"),
    ],
  },
  // ---------------------------------------------------------------- 7
  {
    id: "fp-3d", mode: "plan", level: "Easy", minutes: "6-8", item: "3D walk-through",
    title: "Walk through it in 3D",
    blurb: "Put a camera on a wall, look at your rooms in 3D with their floors, walls and furniture, turn around, and save a picture.",
    learn: ["Real Space 3D", "Place Camera", "View in 3D", "Screenshot"],
    steps: [
      SKETCH, RECT(16, 12, "Living room"), DESIGN, ITEM("Living Room", "Sofa 84"), ITEM("Living Room", "Coffee Table"), FLOOR("wood", "Wood"),
      {
        title: "Place the camera", tool: "Place Camera", icon: "eye", show: { fp: "#m-space" },
        how: ["Click <b>3 · Real Space 3D</b>, then <b>📷 Place Camera</b> on the left.", "Click along any wall: the camera stands there, looking into the room."],
        when: "The camera is where a person would stand.",
        check: (t) => t.fp().cam,
      },
      {
        title: "View in 3D", tool: "View in 3D", icon: "eye", show: { fp: "#v3" },
        how: ["Click the 📷 on the plan to open the camera menu, then <b>View in 3D</b>.", "Slide <b>Look direction</b> to turn, and <b>Field of view</b> to zoom."],
        when: "3D shows how the room really feels: is there space to walk around the sofa?",
        check: (t) => t.fp().r3 > 0,
      },
      {
        title: "Save a picture", tool: "Save screenshot", icon: "finish", anim: "save", show: { fp: "#shot" },
        how: ["Click <b>📸 Save screenshot</b>."],
        when: "A 3D picture is the best way to show someone your idea.",
        check: (t) => t.fp().shots > 0,
      },
      SAVE,
    ],
  },
  // ---------------------------------------------------------------- 8
  {
    id: "fp-2story", mode: "plan", level: "Advanced", minutes: "12-15", item: "Two-story house",
    title: "A two-story house",
    blurb: "A main floor with stairs, a second floor drawn over a faint outline of the one below, wall heights, and both floors together in 3D.",
    learn: ["Stairs", "Add second floor", "Floors", "Wall height", "Real Space 3D"],
    steps: [
      SKETCH,
      { ...RECT(28, 20, "Main floor"), how: ["Click <b>Rectangle</b> and drag a <b>28 × 20</b> block main floor (or several rooms that add up to it)."] },
      {
        title: "Stairs", tool: "Stairs", icon: "archRaise", show: { fp: "[data-sk=stairs]" },
        how: ["Click <b>Stairs</b>, then click inside the main floor near a wall."],
        when: "Stairs on the main floor lead up and cut an opening in the floor above.",
        check: (t) => t.fpItems((i) => i.k === "stairs").length > 0,
      },
      {
        title: "Add a second floor", tool: "Add second floor", icon: "archRaise", show: { fp: '[data-addlv="1"]' },
        how: ["On the left (FLOORS &amp; WALL HEIGHT), click <b>＋ Add second floor</b>.", "A new drawing plane opens with a faint dashed outline of the main floor."],
        when: "Each floor is drawn on its own; the outline helps you line the walls up.",
        check: (t) => t.fp().levels.includes(1),
      },
      {
        title: "Upstairs rooms", tool: "Rectangle", icon: "rect", anim: "rect", show: { fp: "[data-t=rect]" },
        how: ["On the 2nd floor, draw two bedrooms and a bathroom inside the dashed outline. Leave the stairwell (hatched) clear."],
        when: "Upstairs rooms usually sit right over the walls below, so the house is easy to build.",
        check: (t) => t.fp().rooms.filter((r) => r.lvl === 1).length >= 3,
      },
      {
        title: "See both floors", tool: "3 · Real Space 3D", icon: "eye", show: { fp: "#m-space" },
        how: ["Click <b>3 · Real Space 3D</b>, then <b>🏠 View house exterior</b>. Both floors stack up with the stairs between them."],
        when: "Check that the upstairs sits on the floor below.",
        check: (t) => t.fp().r3 > 0,
      },
      SAVE, DOWNLOAD("both floors (pick All floors)"),
    ],
  },
  // ---------------------------------------------------------------- 9
  {
    id: "fp-shop", mode: "plan", level: "Advanced", minutes: "10-12", item: "Small shop",
    title: "A small shop",
    blurb: "A storefront with a check-out counter, stocked shelves, a clothing rack, a mannequin and a custom sign with your shop's name.",
    learn: ["Business", "Check-out", "Shelves", "Custom sign", "Doors"],
    steps: [
      SKETCH, RECT(30, 20, "Shop"), NAME(30, 20, "My Shop", /shop|store/i),
      {
        title: "A front door", tool: "Door", icon: "archDoor", show: { fp: "[data-sk=door]" },
        how: ["Click <b>Door</b> and click the front (bottom) wall. In Design 2D, the Doors menu has double and glass entry doors."],
        when: "Shops need a wide, easy front entry.",
        check: (t) => t.fpItems((i) => i.k === "door").length > 0,
      },
      DESIGN,
      ITEM("Business", "Check-Out Counter"),
      { ...ITEM("Business", "Product Shelf Unit", 2), check: (t) => t.fpItems((i) => /Shelf/.test(i.n) && i.k === "biz").length >= 2 },
      ITEM("Business", "Clothing Rack – Round"), ITEM("Business", "Mannequin"),
      {
        title: "Your sign", tool: "Custom sign", icon: "text", show: { fp: "[data-c=Business]" },
        how: ["In Business, click <b>Custom Sign – Wall Banner</b> and place it against a wall.", "With the sign selected, type your shop's name in <b>Item Options</b> and pick its colours."],
        when: "The sign shows in 3D too.",
        check: (t) => t.fpItems((i) => i.k === "sign" && i.txt && i.txt !== "MY SHOP").length > 0,
      },
      SAVE, DOWNLOAD("the shop"),
    ],
  },
  // ---------------------------------------------------------------- 10
  {
    id: "fp-class", mode: "plan", level: "Advanced", minutes: "15-20", item: "Classroom client job",
    title: "Be an Architect (classroom)",
    blurb: "The Education side: sign in, do the guided EXAMPLE client (square feet with the calculator, self-checking boxes), then take on a real client.",
    learn: ["Education", "Sign in", "Calculator", "EXAMPLE client", "Be an Architect"],
    steps: [
      {
        title: "Switch to Education", tool: "Education", icon: "eye", show: { fp: "#ed-e" },
        how: ["At the top, click <b>Education</b>. The planner turns green and adds <b>Be an Architect</b> and <b>Be a Designer</b>."],
        when: "Education is for class: client jobs, payment checks and saved progress for each student.",
        check: (t) => t.fp().edu,
      },
      {
        title: "Sign in", tool: "Be an Architect", icon: "text", show: { fp: "#m-arch" },
        how: ["Click <b>Be an Architect</b>. Sign in with your name: new students get a 4-digit code (write it down to come back to your work)."],
        when: "Signing in saves your jobs and earnings on this computer.",
        check: (t) => t.fp().stu,
      },
      {
        title: "The EXAMPLE client", tool: "EXAMPLE", icon: "measure", show: { fp: "#jobsel .cl.exc" },
        how: ["Pick the green <b>EXAMPLE – Must Complete BEFORE working on your own!</b> card.", "Follow the guide box (bottom left): each step checks itself. <b>▶ Show me</b> demonstrates, <b>💡 Hint</b> helps, <b>🧮 Calculator</b> opens the calculator."],
        when: "The example teaches decimal feet (6 in = 0.5 ft), area = length × width, and adding up the total.",
        check: (t) => !!t.fp().done.exarch,
      },
      {
        title: "A real client", tool: "Be an Architect", icon: "text", show: { fp: "#m-arch" },
        how: ["Back in <b>Be an Architect</b>, the clients are unlocked. Pick one, read their needs, and sketch a plan that meets every requirement in their box.", "Click <b>Submit design</b> when every box is ticked, then sign the play-money check."],
        when: "Real projects have rules: plot size, square-foot limit, budget and the rooms the family needs.",
        check: (t) => Object.keys(t.fp().done).some((k) => /^arch[a]/.test(k) && !/ex/.test(k)),
      },
      SAVE,
    ],
  },
];
