// Chisel tutorials: twelve sculpting projects in Chisel's Easy tools, from a first pebble pet to
// animating a character, and three for action figures (a first ball-jointed figure, a custom one,
// and one made from scratch with the ball joint kit). "Show me" points inside Chisel (show.ch);
// the checks read what Chisel is doing (strokes per tool, objects, saving), see tutorials.js.
import { nameStep, saveStep } from "./tutorial_data.js";

const CH = (sel) => ({ ch: sel });
const shape = (id, name, n = 1) => ({
  title: n > 1 ? `Add ${n} ${name.toLowerCase()}s` : `Add a ${name.toLowerCase()}`, tool: name, icon: "sphere", show: CH(`#shapes [data-shape="${id}"]`),
  how: [`In Chisel's panel on the right, under <b>Shapes</b>, click <b>${name}</b>${n > 1 ? ` ${n} times` : ""}.`, "It appears in the middle of the view, ready to sculpt. Right-drag turns the view, scroll zooms."],
  when: "Every sculpt starts from a lump of digital clay: a simple shape you push, pull and smooth.",
  check: (t) => t.chCount(new RegExp("^" + name), n),
});
const tool = (id, name, key, n, how, when, extra = {}) => ({
  title: extra.title || name, tool: name, icon: "sculpt", show: CH(`#tools [data-easy="${id}"]`),
  how: [`Click <b>${name}</b> in the tools on the left.`, ...how], when, ...(extra.tip ? { tip: extra.tip } : {}),
  check: (t) => t.chUsed(key, n),
});
const BUILD = (n, where) => tool("e-add", "Build up", "standard", n, [`Drag across ${where} a few times (at least ${n} strokes) to add clay.`, "Make the brush bigger or smaller with the <b>Size</b> slider under the view."], "Build up adds clay where you drag: bumps, cheeks, muscles, mountains.");
const DIG = (n, where) => tool("e-dig", "Dig in", "standard-", n, [`Drag on ${where} (at least ${n} strokes) to scoop clay out.`], "Dig in is the opposite of Build up: eyes, mouths, grooves and craters.");
const SMOOTH = (n) => tool("e-smooth", "Smooth", "smooth", n, [`Rub over the lumpy spots (at least ${n} strokes).`], "Smooth evens out the bumps the other tools leave, like rubbing clay with a wet finger.");
const PULL = (n, what) => tool("e-pull", "Pull", "move", n, [`Grab the surface where ${what} should be and drag outward (at least ${n} pulls).`], "Pull stretches the clay out (or pushes it in) like soft clay: ears, horns, noses, tails.");
const FLAT = (n, where) => tool("e-flat", "Flatten", "flatten", n, [`Drag over ${where} (at least ${n} strokes).`], "Flatten presses areas flat like a spatula: a base to stand on, cliffs, plates of armour.");
const PAINT = (n, what) => tool("e-paint", "Paint", "paint", n, [`Pick a color under the view, then paint ${what} (at least ${n} strokes). Pick other colors for other parts.`], "Paint colors the sculpt. Colors go into the design and into 3MF and OBJ files for color printers.");
const MIRROR = {
  title: "Mirror your strokes", tool: "Mirror", icon: "mirror", show: CH("#eSym, #symBtn"),
  how: ["Turn on <b>Mirror</b> (above the view, or in the tool settings).", "Now every stroke on one side is copied to the other side, so both sides match."],
  when: "Faces, masks and bodies are the same on both sides: mirror saves half the work and keeps them even.",
  check: (t) => t.chSym(),
};
const CHAR = (id, name) => ({
  title: `Start from a ${name.toLowerCase()}`, tool: "Characters", icon: "sculpt", show: CH(`#charShapes [data-char="${id}"]`),
  how: [`In the panel on the right, under <b>Characters</b>, click <b>${name}</b>.`, "It's built for you in a few seconds, standing on the floor, already shaped and ready to sculpt."],
  when: "Characters give you the right proportions to start from, so you can spend your time on the details.",
  check: (t) => t.chCount(new RegExp("^" + name), 1),
});
const SAVE_CH = {
  title: "Save the sculpt into your design", tool: "Save to design", icon: "finish", show: CH("#js3dSave"),
  how: ["Click <b>Save to design</b> at the top right of Chisel.", "Your sculpts become bodies in the design: you'll see them in Beginner and Advanced too."],
  when: "Before you save the design or switch modes, so everything you sculpted is kept.",
  check: (t) => t.chSaved(),
};
const EXPORT_CH = (what = "the visible objects") => ({
  title: "Export it for 3D printing", tool: "Export", icon: "import", show: CH("#exportBtn"),
  how: ["Click <b>Export</b> at the top of Chisel.", `Pick <b>STL</b> (or OBJ for colors). It saves ${what} at full detail, in millimetres.`],
  when: "When it's finished: the STL goes into your slicer (or the 3D Print Sim) to be printed.",
  check: (t) => t.chExported(),
});
const easy = (o) => ({ mode: "chisel", ...o });

export const CHISEL_TUTORIALS = [
  easy({ id: "c-pebble", level: "Easy", minutes: "5-7", item: "Pebble pet", title: "Pebble pet", blurb: "Your first sculpt: a round little creature from a sphere. Learn Build up, Dig in, Smooth and Paint.",
    learn: ["Sphere", "Build up", "Dig in", "Smooth", "Paint"],
    steps: [nameStep("Pebble Pet", "Lopez, Maria, Pebble Pet"), shape("sphere", "Sphere"), BUILD(3, "the top and sides to make a head and cheeks"), DIG(2, "the face for two eyes"), SMOOTH(2), PAINT(3, "your pet"), SAVE_CH, saveStep()] }),
  easy({ id: "c-monster", level: "Easy", minutes: "6-8", item: "Monster head", title: "Monster head", blurb: "A cartoon head with horns and a big grin, the same on both sides. Learn Mirror and Pull.",
    learn: ["Cartoon head", "Mirror", "Pull", "Dig in", "Paint"],
    steps: [nameStep("Monster Head", "Lopez, Maria, Monster Head"), CHAR("toon", "Cartoon head"), MIRROR, PULL(2, "two horns"), DIG(2, "a wide mouth"), BUILD(2, "the brows"), PAINT(3, "the skin, horns and mouth"), SAVE_CH, saveStep()] }),
  easy({ id: "c-snowman", level: "Easy", minutes: "6-8", item: "Snowman", title: "Snowman", blurb: "Three spheres stacked and joined into one snowman. Learn Move and Combine.",
    learn: ["Sphere", "Move", "Combine", "Paint"],
    steps: [nameStep("Snowman", "Lopez, Maria, Snowman"), shape("sphere", "Sphere", 3),
      { title: "Stack them", tool: "Move", icon: "move", show: CH('#tools [data-easy="e-move"]'), how: ["Click <b>Move</b>, then drag each sphere into place: the big one at the bottom, smaller ones on top.", "Use the <b>Size</b> handles (or the scale box) to make the top ones smaller. The black arrow lifts a ball up."], when: "Move places, turns and resizes whole objects.", check: (t) => t.chTool("xform") && t.chHist(5) },
      { title: "Join them into one", tool: "Combine", icon: "combine", show: CH('#tools [data-easy="e-combine"]'), how: ["Click <b>Combine</b>, pick the bottom sphere, then <b>Join</b> it with the others (one at a time)."], when: "Combine joins objects into one (or cuts one out of another), so the snowman prints as one piece.", check: (t) => t.chCount(/^Sphere/, 1) && t.chCount(/^Sphere/, 2) === false },
      PAINT(3, "coal eyes, buttons and a carrot nose"), SAVE_CH, saveStep()] }),
  easy({ id: "c-mountain", level: "Easy", minutes: "6-8", item: "Mountain", title: "Mountain diorama", blurb: "A flat-bottomed mountain with cliffs and snow on top, from a round cube. Learn Flatten.",
    learn: ["Round cube", "Build up", "Flatten", "Paint"],
    steps: [nameStep("Mountain", "Lopez, Maria, Mountain"), shape("rcube", "Round cube"), BUILD(4, "the top to raise peaks"), FLAT(2, "the sides for cliffs, and the bottom so it stands"), DIG(2, "a valley or a cave"), PAINT(3, "rock, grass and a snowy top"), SAVE_CH, EXPORT_CH()] }),
  easy({ id: "c-cat", level: "Proficient", minutes: "8-10", item: "Cat", title: "Pet cat", blurb: "Sculpt a cat from the Cat character: bigger ears, a fluffy tail and markings.",
    learn: ["Cat character", "Pull", "Smooth", "Paint"],
    steps: [nameStep("Cat", "Lopez, Maria, Cat"), CHAR("cat", "Cat"), MIRROR, PULL(2, "the ears"), BUILD(3, "the cheeks and chest fur"), SMOOTH(3), PAINT(4, "the fur, nose and stripes or spots"), SAVE_CH, saveStep()] }),
  easy({ id: "c-alien", level: "Proficient", minutes: "8-10", item: "Alien", title: "Alien bust", blurb: "Give the Grey alien big eyes, a strange skull and skin color, then export it.",
    learn: ["Grey alien", "Dig in", "Build up", "Paint", "Export"],
    steps: [nameStep("Alien", "Lopez, Maria, Alien"), CHAR("grey", "Grey alien"), MIRROR, DIG(3, "deeper eye sockets"), BUILD(3, "ridges on the skull"), SMOOTH(2), PAINT(3, "the skin and eyes"), SAVE_CH, EXPORT_CH()] }),
  easy({ id: "c-dog", level: "Proficient", minutes: "10-12", item: "Wagging dog", title: "Animate a dog", blurb: "Pose the Dog character and make its tail wag in the Puppet Animator, then save the animation.",
    learn: ["Dog character", "Animate", "Pose", "Keyframes"],
    steps: [nameStep("Dog", "Lopez, Maria, Dog"), CHAR("dog", "Dog"), PULL(1, "a longer snout or tail"),
      { title: "Open the animator", tool: "Animate", icon: "motion", show: CH("#pupBtn"), how: ["Click <b>Animate</b> at the top right of Chisel. The dog already has a skeleton: its joints show as dots."], when: "The Puppet Animator poses and animates a sculpt without changing it.", check: (t) => t.chPup() },
      { title: "Make the tail wag", tool: "Pose and keys", icon: "motion", show: CH("#ptlKey, #ptlTrack"), how: ["Drag the tail's joint to one side. A keyframe is set at the start.", "Move the time slider along, drag the tail to the other side (another keyframe).", "Do it once more, then press <b>Play</b>."], when: "Keyframes are poses at moments in time; the animator moves smoothly between them.", check: (t) => t.chKeys(2) },
      { title: "Back to sculpting", tool: "Back", icon: "sculpt", show: CH("#pupBack, #pupBtn"), how: ["Click <b>Back to sculpting</b> (or Animate again). The animation is kept with the dog."], when: "When the animation is done (you can also export it as an MP4 video there).", check: (t) => !t.chPup() },
      SAVE_CH, saveStep()] }),
  easy({ id: "c-bird", level: "Proficient", minutes: "8-10", item: "Bird ornament", title: "Bird ornament", blurb: "A smooth little bird with painted feathers, exported for printing.",
    learn: ["Bird character", "Smooth", "Build up", "Paint", "Export"],
    steps: [nameStep("Bird", "Lopez, Maria, Bird"), CHAR("bird", "Bird"), MIRROR, BUILD(2, "a puffed-out chest"), SMOOTH(3), PAINT(4, "the wings, chest and beak"), SAVE_CH, EXPORT_CH()] }),
  easy({ id: "c-planet", level: "Advanced", minutes: "10-12", item: "Planet", title: "Clay planet", blurb: "A small world: mountains, craters, flat plains and painted oceans and land.",
    learn: ["Sphere", "Build up", "Dig in", "Flatten", "Paint", "Export"],
    steps: [nameStep("Planet", "Lopez, Maria, Planet"), shape("sphere", "Sphere"), BUILD(5, "the land for mountain ranges"), DIG(4, "craters and sea beds"), FLAT(2, "plains between the mountains"), SMOOTH(3), PAINT(5, "blue oceans, green and brown land and white poles"), SAVE_CH, EXPORT_CH()] }),
  // ---------------------------------------------------------------- action figures
  easy({ id: "c-fig1", level: "Proficient", minutes: "10-12", item: "Action figure", title: "Your first action figure", blurb: "Build a 15-part hero with snap-fit ball joints, give it a face, lay it out and export it for printing.",
    learn: ["Action figure builder", "Ball joints", "Dig in", "Paint", "Lay out to print", "Export"],
    steps: [nameStep("Action Figure", "Lopez, Maria, Action Figure"),
      { title: "Open the builder", tool: "Action figures", icon: "sculpt", show: CH('#figTpls [data-fig="hero"]'), how: ["In the panel on the right, under <b>Action figures</b>, click <b>Hero</b>.", "The builder opens: read what the figure will be (15 parts, 14 ball joints)."], when: "The builder makes every part and every joint for you, sized to print.", check: (t) => !!t.chEl("#figDlg") || t.chFig(/^Hero figure/) },
      { title: "Choose its size and build it", tool: "Build figure", icon: "sculpt", show: CH("#fig-H, #fig-go"), how: ["Set <b>Height</b> to <b>150</b> mm (about 6 inches), leave the joint fit on <b>Standard</b> and Detail on <b>Print</b>.", "Click <b>Build figure</b> and wait a few seconds."], when: "The balls are sized from the height (at least 4 mm), with 0.15 mm clearance so they snap in and hold a pose.", check: (t) => t.chFig(/^Hero figure/) && t.chCount(/ figure · /, 15) },
      { ...DIG(2, "the head (it's its own part) for eyes and a mouth"), tip: "Click the head in the Objects list first so only it is sculpted. Don't sculpt near the balls or sockets: they're sized exactly to fit." },
      PAINT(3, "a costume on the chest, arms and legs"),
      { title: "Lay it out for printing", tool: "Lay out to print", icon: "sculpt", show: CH("#figLay"), how: ["Under <b>Action figures</b>, pick your figure and click <b>Lay out to print</b>.", "The parts stand side by side on the floor, 5 mm apart (Assemble puts them back)."], when: "Every part prints on its own; after printing, snap the balls into the sockets.", check: (t) => t.chLaid() },
      SAVE_CH, EXPORT_CH("every part, at full detail")] }),
  easy({ id: "c-fig2", level: "Advanced", minutes: "12-15", item: "Custom figure", title: "Custom action figure", blurb: "Design your own character: a chibi, robot or alien with your own proportions and joint fit, sculpted and painted.",
    learn: ["Templates", "Proportions", "Joint fit", "Sculpting parts", "Export"],
    steps: [nameStep("Custom Figure", "Lopez, Maria, Custom Figure"),
      { title: "Pick a template and shape it", tool: "Action figure builder", icon: "sculpt", show: CH('#figTpls [data-fig="chibi"], #figTpls [data-fig="robot"]'), how: ["Under <b>Action figures</b>, click <b>Chibi</b>, <b>Robot</b>, <b>Alien</b>, <b>Kid</b> or <b>Heroine</b>.", "Move the <b>Build</b>, <b>Head size</b>, <b>Shoulders</b>, <b>Arm length</b> and <b>Leg length</b> sliders until it looks like your character.", "Choose a <b>Joint fit</b>: Tight holds poses best, Loose moves most easily. Then <b>Build figure</b>."], when: "Proportions make a character: a big head reads as cute, long limbs as strange, broad shoulders as strong.", check: (t) => t.chFig(/^(Chibi|Robot|Alien|Kid|Heroine) figure/) },
      MIRROR, BUILD(3, "details: hair, armour plates or muscles (one part at a time)"), DIG(2, "the face"), SMOOTH(2), PAINT(4, "your character's colors"),
      { title: "Lay it out for printing", tool: "Lay out to print", icon: "sculpt", show: CH("#figLay"), how: ["Click <b>Lay out to print</b>."], when: "Before exporting, so the parts don't touch on the build plate.", check: (t) => t.chLaid() },
      SAVE_CH, EXPORT_CH("every part")] }),
  easy({ id: "c-fig3", level: "Expert", minutes: "12-15", item: "Scratch figure", title: "A jointed figure from scratch", blurb: "Sculpt your own parts and join them with the Ball joint kit: a ball on one part and a socket in the other.",
    learn: ["Shapes", "Ball joint kit", "Move", "Combine: Join and Subtract", "Export"],
    steps: [nameStep("Jointed Figure", "Lopez, Maria, Jointed Figure"), shape("sphere", "Sphere"), shape("cube", "Cube"),
      { title: "Get a ball joint", tool: "Ball joint kit", icon: "joint", show: CH("#figKit"), how: ["Under <b>Action figures</b>, click <b>Ball joint kit</b>.", "Three pieces appear: <b>Joint ball</b> (a ball on a peg), <b>Joint housing</b> and <b>Joint socket cutter</b>."], when: "A ball joint is a ball on one part that snaps into a round socket in the other, with a little clearance.", check: (t) => t.chCount(/^Joint ball/, 1) && t.chCount(/^Joint socket cutter/, 1) },
      { title: "Put the pieces in place", tool: "Move", icon: "move", show: CH('#tools [data-easy="e-move"]'), how: ["With <b>Move</b>, put the <b>Joint ball</b> where the cube (an arm) should turn: the peg goes into the cube.", "Put the <b>Joint housing</b> and the <b>Socket cutter</b> at exactly the same spot, against the sphere (the body)."], when: "The ball and the socket must sit at the same point, or the parts won't line up.", check: (t) => t.chTool("xform") && t.chHist(6) },
      { title: "Join the ball and the housing", tool: "Combine → Join", icon: "combine", show: CH('#tools [data-easy="e-combine"]'), how: ["Click <b>Combine</b>, pick the cube and <b>Join</b> the Joint ball to it.", "Pick the sphere and <b>Join</b> the Joint housing to it."], when: "Join makes the joint pieces part of your sculpts.", check: (t) => t.chCount(/^Joint ball/, 1) === false && t.chCount(/^Joint housing/, 1) === false },
      { title: "Cut the socket", tool: "Combine → Subtract", icon: "combine", show: CH('#tools [data-easy="e-combine"]'), how: ["Pick the sphere and <b>Subtract</b> the Joint socket cutter from it: that leaves the round socket with its narrow mouth."], when: "Subtract cuts one shape out of another.", check: (t) => t.chCount(/^Joint socket cutter/, 1) === false },
      SAVE_CH, EXPORT_CH("both parts")] }),
];
