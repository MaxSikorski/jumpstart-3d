// Architect landscape: animals that live around the house. Pets, farm animals and wildlife from around the world walk
// over the hills, stop to eat grass and plants, climb trees and the house, birds fly between
// perches, ducks paddle and fish swim in the ponds. Only for looking at: they are never part of
// the design's shapes or the exported model. Sizes in mm (real size), Z up.
import * as THREE from "three";

// ------------------------------------------------------------------ the species
// plan: how the body is built and moves (quad, hop, bird, duck, hawk, fish, turtle, frog)
// len: body length; sp: walking (or swimming, flying) speed mm/s; run: running speed
// eats: what it looks for (grass, plants, garden, seeds, acorns, worms, bugs, fruit)
// climbs: tree and/or house; prey: runs from these; acts: how often it does each thing
export const ANIMALS = [
  // pets
  { id: "cat", name: "House cat", grp: "farm", plan: "quad", len: 450, leg: 210, r: 95, head: 68, ears: "cat", tail: { l: 290, r: 17, a: 1.0 }, col: "#c98a45", belly: "#f1dfc4", sp: 650, run: 3200, climb: 1200, eats: ["grass"], climbs: ["tree", "house"], prey: ["dog"], acts: { walk: 3, idle: 3, eat: 1, tree: 2, house: 3 } },
  { id: "dog", name: "Dog (beagle)", grp: "farm", plan: "quad", len: 700, leg: 340, r: 150, head: 105, ears: "dog", snout: 1.6, tail: { l: 280, r: 24, a: 0.9 }, col: "#a8742f", belly: "#f3ecdc", sp: 1100, run: 4500, eats: ["grass", "bugs"], hunts: ["cat", "rabbit", "chipmunk", "graysq", "foxsq", "groundhog", "deer", "dove", "robin"], acts: { walk: 5, idle: 2, eat: 2 } },
  // North America (these all live in Ohio)
  { id: "deer", name: "White-tailed deer", grp: "na", plan: "quad", len: 1400, leg: 620, r: 230, head: 140, ears: "deer", snout: 1.8, neck: 1, tail: { l: 180, r: 55, a: 1.2, col: "#f4efe6" }, col: "#9a6b43", belly: "#efe6d8", sp: 900, run: 9000, eats: ["plants", "garden", "fruit", "grass"], prey: ["dog", "fox"], acts: { walk: 3, idle: 2, eat: 5 } },
  { id: "rabbit", name: "Eastern cottontail", grp: "na", plan: "hop", len: 300, leg: 90, r: 105, head: 78, ears: "rabbit", tail: { l: 60, r: 42, a: 0.5, col: "#f6f3ee" }, col: "#8a7560", belly: "#d8cbb8", sp: 900, run: 4500, eats: ["grass", "plants", "garden"], prey: ["dog", "fox", "cat", "hawk"], acts: { walk: 3, idle: 2, eat: 5 } },
  { id: "chipmunk", name: "Eastern chipmunk", grp: "na", plan: "quad", len: 140, leg: 42, r: 40, head: 32, ears: "round", stripe: "#3a2a20", tail: { l: 100, r: 11, a: 0.8 }, col: "#a3683a", belly: "#ead7b7", sp: 600, run: 2500, climb: 900, eats: ["seeds", "acorns"], climbs: ["tree", "rock"], prey: ["dog", "cat", "fox", "hawk"], acts: { walk: 4, idle: 2, eat: 4, tree: 1, rock: 2 } },
  { id: "graysq", name: "Eastern gray squirrel", grp: "na", plan: "quad", len: 240, leg: 78, r: 60, head: 45, ears: "round", tail: { l: 240, r: 46, a: 1.4, bushy: 1 }, col: "#8d8c88", belly: "#ebe7df", sp: 800, run: 3500, climb: 1600, eats: ["acorns", "seeds", "fruit"], climbs: ["tree", "house"], prey: ["dog", "cat", "fox", "hawk"], acts: { walk: 3, idle: 2, eat: 3, tree: 4, house: 1 } },
  { id: "foxsq", name: "Fox squirrel", grp: "na", plan: "quad", len: 280, leg: 85, r: 68, head: 50, ears: "round", tail: { l: 260, r: 52, a: 1.4, bushy: 1 }, col: "#ad6c3a", belly: "#dba66c", sp: 800, run: 3400, climb: 1500, eats: ["acorns", "seeds", "garden"], climbs: ["tree", "house"], prey: ["dog", "cat", "fox", "hawk"], acts: { walk: 3, idle: 2, eat: 3, tree: 4, house: 1 } },
  { id: "fox", name: "Red fox", grp: "na", plan: "quad", len: 600, leg: 320, r: 105, head: 82, ears: "fox", snout: 1.9, legc: "#2b2420", tail: { l: 400, r: 66, a: 0.35, bushy: 1, tip: "#f6f1e8" }, col: "#c4561e", belly: "#f4ece0", sp: 900, run: 5500, eats: ["bugs", "fruit"], hunts: ["rabbit", "chipmunk", "graysq", "foxsq", "groundhog"], prey: ["dog"], acts: { walk: 4, idle: 2, eat: 2 } },
  { id: "raccoon", name: "Raccoon", grp: "na", plan: "quad", len: 550, leg: 220, r: 150, head: 92, ears: "round", mask: 1, tail: { l: 280, r: 50, a: 0.25, rings: 1 }, col: "#7d7c79", belly: "#a9a7a2", sp: 600, run: 2200, climb: 700, eats: ["garden", "fruit", "bugs"], climbs: ["tree", "house"], prey: ["dog"], acts: { walk: 3, idle: 2, eat: 3, tree: 2, house: 2 } },
  { id: "groundhog", name: "Groundhog (woodchuck)", grp: "na", plan: "quad", len: 480, leg: 110, r: 150, head: 84, ears: "round", tail: { l: 150, r: 30, a: 0.2 }, col: "#7a5a3a", belly: "#a37b51", sp: 400, run: 1600, eats: ["garden", "plants", "grass"], prey: ["dog", "fox"], acts: { walk: 2, idle: 3, eat: 5 } },
  { id: "opossum", name: "Virginia opossum", grp: "na", plan: "quad", len: 450, leg: 150, r: 110, head: 80, ears: "round", snout: 2, face: "#f4f0e8", tail: { l: 330, r: 14, a: -0.2, col: "#e9c9c0" }, col: "#9b9a97", belly: "#cfccc6", sp: 450, run: 1200, climb: 500, eats: ["fruit", "bugs", "garden"], climbs: ["tree"], prey: ["dog"], acts: { walk: 3, idle: 2, eat: 3, tree: 2 } },
    { id: "cardinal", name: "Northern cardinal", grp: "na", plan: "bird", len: 220, col: "#c8102e", wing: "#a50e26", belly: "#d42a3c", beak: "#f07a2a", crest: 1, mask: 1, sp: 6000, eats: ["seeds"], acts: { fly: 4, eat: 4, idle: 3 } },
  { id: "bluejay", name: "Blue jay", grp: "na", plan: "bird", len: 280, col: "#3a72c4", wing: "#2d5fa8", belly: "#eef0f2", beak: "#222", crest: 1, sp: 6500, eats: ["acorns", "seeds"], acts: { fly: 4, eat: 4, idle: 3 } },
  { id: "robin", name: "American robin", grp: "na", plan: "bird", len: 250, col: "#56504a", wing: "#4a443f", belly: "#d4672e", beak: "#e6c13a", sp: 6000, eats: ["worms", "fruit"], acts: { fly: 3, eat: 5, idle: 3 } },
  { id: "goldfinch", name: "American goldfinch", grp: "na", plan: "bird", len: 120, col: "#f3cf1b", wing: "#1f1f1f", belly: "#f6dc4a", beak: "#e9a35a", cap: "#1f1f1f", sp: 5500, eats: ["seeds"], acts: { fly: 5, eat: 4, idle: 2 } },
  { id: "dove", name: "Mourning dove", grp: "na", plan: "bird", len: 300, col: "#b9a58e", wing: "#a8937c", belly: "#d4c1ab", beak: "#333", sp: 7000, eats: ["seeds"], prey: ["hawk", "cat"], acts: { fly: 3, eat: 5, idle: 3 } },
  { id: "woodpecker", name: "Red-bellied woodpecker", grp: "na", plan: "bird", len: 240, col: "#e9e4da", wing: "#2a2a2a", belly: "#efe2cf", beak: "#2a2a2a", cap: "#d22a2a", sp: 6000, eats: ["bugs", "acorns"], climbs: ["tree"], climb: 300, acts: { fly: 3, eat: 2, idle: 2, tree: 4 } },
  { id: "hawk", name: "Red-tailed hawk", grp: "na", plan: "hawk", len: 550, col: "#6e4a2c", wing: "#5c3e25", belly: "#efe4d2", beak: "#e2b13a", tailc: "#b4542a", sp: 7000, eats: ["mice"], acts: { soar: 5, fly: 2, idle: 2, eat: 1 } },
    { id: "mallard", name: "Mallard duck", grp: "na", plan: "duck", len: 580, col: "#8a8a86", wing: "#7b7b78", belly: "#a59a8c", head: "#1f6b3a", beak: "#e6c53a", sp: 450, water: 1, eats: ["pond"], acts: { swim: 4, eat: 4, idle: 2, walk: 1 } },
  { id: "goose", name: "Canada goose", grp: "na", plan: "duck", len: 950, col: "#7a6a58", wing: "#6b5b4a", belly: "#d9d1c4", head: "#1d1d1d", chin: 1, beak: "#1d1d1d", sp: 500, water: 1, eats: ["grass", "pond"], acts: { swim: 3, eat: 4, idle: 2, walk: 2 } },
  { id: "frog", name: "American bullfrog", grp: "na", plan: "frog", len: 160, col: "#5f7f35", belly: "#e5e1b5", sp: 700, edge: 1, eats: ["bugs"], acts: { hop: 3, idle: 4, eat: 3, swim: 1 } },
  { id: "turtle", name: "Eastern box turtle", grp: "na", plan: "turtle", len: 150, col: "#5a3e1f", spot: "#e2a72a", skin: "#7a5a2a", sp: 70, edge: 1, eats: ["plants", "bugs", "fruit"], acts: { walk: 3, idle: 4, eat: 3, rock: 2 } },
  { id: "bass", name: "Largemouth bass", grp: "na", plan: "fish", len: 400, col: "#5f7a3a", belly: "#dfe3c0", fin: "#4d6630", stripe: "#2f3f20", sp: 600, fish: 1, eats: ["surface"], acts: { swim: 5, idle: 2, eat: 2 } },
  { id: "bluegill", name: "Bluegill", grp: "na", plan: "fish", len: 180, tall: 1.5, col: "#55706c", belly: "#e09a3a", fin: "#3f5753", sp: 450, fish: 1, eats: ["surface"], acts: { swim: 5, idle: 3, eat: 3 } },
  { id: "catfish", name: "Channel catfish", grp: "na", plan: "fish", len: 520, col: "#7b8088", belly: "#e8e8e4", fin: "#646972", whisk: 1, sp: 380, fish: 1, bottom: 1, eats: ["bottom"], acts: { swim: 4, idle: 3, eat: 3 } },
  { id: "perch", name: "Yellow perch", grp: "na", plan: "fish", len: 250, col: "#c9b43c", belly: "#efe8c4", fin: "#d9772e", stripe: "#4a4a24", sp: 500, fish: 1, eats: ["surface"], acts: { swim: 5, idle: 2, eat: 2 } },
  { id: "horse", name: "Horse", grp: "farm", plan: "quad", len: 2000, leg: 1000, r: 330, head: 200, ears: "deer", snout: 2.2, neck: 1.5, mane: "#3a2a1c", tail: { l: 700, r: 70, a: -0.7, col: "#3a2a1c" }, col: "#8a5a32", belly: "#8a5a32", sp: 1300, run: 7000, eats: ["grass", "plants"], acts: { walk: 3, idle: 3, eat: 5 } },
  { id: "cow", name: "Cow", grp: "farm", plan: "quad", len: 2000, leg: 750, r: 420, head: 220, ears: "dog", earc: "#f4f2ee", snout: 1.5, horns: "#d8ccb0", spots: "#1d1d1d", tail: { l: 700, r: 25, a: -1.2 }, col: "#f4f2ee", belly: "#f4f2ee", face: "#f0c9b8", sp: 700, run: 2500, eats: ["grass"], acts: { walk: 2, idle: 4, eat: 6 } },
  { id: "sheep", name: "Sheep", grp: "farm", plan: "quad", len: 1000, leg: 420, r: 300, head: 140, ears: "dog", earc: "#2a2522", face: "#2a2522", legc: "#2a2522", tail: { l: 100, r: 50, a: -0.6 }, col: "#ede8dc", belly: "#e2dccd", sp: 700, run: 3000, eats: ["grass", "plants"], prey: ["dog", "wolf"], acts: { walk: 2, idle: 3, eat: 6 } },
  { id: "goat", name: "Goat", grp: "farm", plan: "quad", len: 1000, leg: 550, r: 210, head: 135, ears: "dog", horns: "#9a8a70", snout: 1.6, tail: { l: 120, r: 25, a: 1.2 }, col: "#d8cdb8", belly: "#e8e0d0", sp: 800, run: 4000, climb: 900, eats: ["plants", "garden", "grass"], climbs: ["rock", "house"], acts: { walk: 3, idle: 2, eat: 4, rock: 3, house: 2 } },
  { id: "pig", name: "Pig", grp: "farm", plan: "quad", len: 1100, leg: 330, r: 280, head: 180, ears: "dog", earc: "#e8a294", snout: 1.3, face: "#f0b6a8", tail: { l: 120, r: 15, a: 1 }, col: "#f0b6a8", belly: "#f4c4b8", sp: 600, run: 2500, eats: ["garden", "grass", "fruit"], acts: { walk: 2, idle: 3, eat: 5 } },
  { id: "chicken", name: "Chicken", grp: "farm", plan: "bird", walker: 1, len: 400, legs: 1.2, col: "#c9752e", wing: "#a85a22", belly: "#d88a42", beak: "#e6c53a", cap: "#d22a2a", sp: 500, run: 2500, eats: ["seeds", "bugs", "worms"], prey: ["dog", "fox", "coyote"], acts: { walk: 4, idle: 2, eat: 6 } },
  // more of North America
  { id: "blackbear", call: "black bear", name: "American black bear", grp: "na", plan: "quad", len: 1600, leg: 420, r: 380, head: 220, ears: "round", snout: 1.5, face: "#8a6a4a", tail: { l: 100, r: 50, a: 0.3 }, col: "#1f1c1a", belly: "#2b2724", sp: 800, run: 6000, climb: 700, eats: ["fruit", "garden", "bugs"], climbs: ["tree"], acts: { walk: 3, idle: 2, eat: 4, tree: 1 } },
  { id: "moose", name: "Moose", grp: "na", plan: "quad", len: 2600, leg: 1050, r: 480, head: 300, ears: "deer", snout: 2.2, neck: 1, antlers: "#c2ab83", palm: 1, tail: { l: 120, r: 50, a: -0.5 }, col: "#4a3526", belly: "#5a4434", legc: "#7a6a58", sp: 1000, run: 8000, water: 0, edge: 1, eats: ["plants", "leaves", "pond"], acts: { walk: 3, idle: 2, eat: 5, swim: 1 } },
  { id: "coyote", name: "Coyote", grp: "na", plan: "quad", len: 900, leg: 360, r: 130, head: 95, ears: "fox", snout: 1.9, tail: { l: 380, r: 55, a: -0.2, bushy: 1, tip: "#2a2420" }, col: "#9b8467", belly: "#d9cdb5", sp: 1000, run: 7000, eats: ["meat", "fruit", "bugs"], hunts: ["rabbit", "chipmunk", "graysq", "chicken", "groundhog"], prey: ["dog", "wolf"], acts: { walk: 4, idle: 2, eat: 2 } },
  { id: "skunk", name: "Striped skunk", grp: "na", plan: "quad", len: 450, leg: 110, r: 120, head: 70, ears: "round", stripe: "#151515", tail: { l: 300, r: 60, a: 1.3, bushy: 1, tip: "#f4f2ee" }, col: "#151515", belly: "#f4f2ee", sp: 350, run: 1200, eats: ["bugs", "garden", "worms"], acts: { walk: 3, idle: 2, eat: 4 } },
  { id: "eagle", call: "eagle", name: "Bald eagle", grp: "na", plan: "hawk", len: 900, col: "#4a3322", wing: "#3e2a1c", belly: "#4a3322", head: "#f6f4ee", tailc: "#f6f4ee", beak: "#f0c23a", sp: 8000, eats: ["fish"], acts: { soar: 5, fly: 2, idle: 2, eat: 1 } },
  { id: "hummingbird", name: "Ruby-throated hummingbird", grp: "na", plan: "bird", len: 90, col: "#3f8a4a", wing: "#5a6a5a", belly: "#f0ece4", beak: "#222", bigBeak: 1.8, sp: 6000, eats: ["nectar"], acts: { fly: 6, eat: 5, idle: 2 } },
  // tropical rainforests (Central and South America, and Asia)
  { id: "toucan", name: "Toco toucan", grp: "trop", plan: "bird", len: 550, col: "#151515", wing: "#151515", belly: "#f6f2e6", beak: "#f08a1c", bigBeak: 2.4, sp: 5500, eats: ["fruit", "seeds"], acts: { fly: 4, eat: 4, idle: 3 } },
  { id: "macaw", name: "Scarlet macaw", grp: "trop", plan: "bird", len: 850, col: "#d81e24", wing: "#2b6fd0", belly: "#d81e24", beak: "#f2efe6", bigBeak: 1.4, tailLong: 2.2, tailc: "#d81e24", sp: 7000, eats: ["fruit", "seeds"], acts: { fly: 4, eat: 4, idle: 3 } },
  { id: "parrot", name: "Green parrot (amazon)", grp: "trop", plan: "bird", len: 380, col: "#3aa23a", wing: "#2f8a2f", belly: "#6ac24a", head: "#e8d23a", beak: "#e8e0d0", bigBeak: 1.3, sp: 6500, eats: ["fruit", "seeds"], acts: { fly: 4, eat: 4, idle: 3 } },
  { id: "spidermonkey", name: "Spider monkey", grp: "trop", plan: "quad", len: 450, leg: 380, r: 90, head: 75, ears: "round", snout: 0.9, face: "#c9a48a", tail: { l: 750, r: 14, a: 1.6 }, col: "#2a201a", belly: "#4a3a30", sp: 800, run: 3000, climb: 1500, eats: ["fruit", "leaves"], climbs: ["tree", "house"], prey: ["jaguar", "dog"], acts: { walk: 2, idle: 2, eat: 3, tree: 6, house: 2 }, treeMeal: "swinging in" },
  { id: "jaguar", name: "Jaguar", grp: "trop", plan: "quad", len: 1600, leg: 380, r: 230, head: 140, ears: "round", spots: "#2a1d12", tail: { l: 700, r: 30, a: 0.1, tip: "#2a1d12" }, col: "#d79a3a", belly: "#f1e2c4", sp: 800, run: 9000, climb: 900, edge: 1, eats: ["meat"], climbs: ["tree"], hunts: ["capybara", "tapir", "deer", "rabbit"], acts: { walk: 3, idle: 4, eat: 1, tree: 1, swim: 1 } },
  { id: "sloth", name: "Three-toed sloth", grp: "trop", plan: "quad", len: 600, leg: 300, r: 160, head: 90, ears: "round", snout: 0.8, face: "#e2d6be", mask: 1, tail: { l: 40, r: 30, a: 0 }, col: "#9a8a70", belly: "#b4a488", sp: 60, run: 120, climb: 60, eats: ["leaves"], climbs: ["tree"], acts: { tree: 9, idle: 3, eat: 1 }, treeMeal: "eating leaves, slowly, up in", treeStay: 5 },
  { id: "capybara", name: "Capybara", grp: "trop", plan: "quad", len: 1100, leg: 300, r: 300, head: 180, ears: "round", snout: 1.4, tail: { l: 30, r: 30, a: 0 }, col: "#8f6a44", belly: "#a07a54", sp: 500, run: 3500, edge: 1, eats: ["grass", "pond", "plants"], prey: ["jaguar", "dog", "crocodile"], acts: { walk: 2, idle: 4, eat: 4, swim: 2 } },
  { id: "tapir", call: "tapir", name: "Baird's tapir", grp: "trop", plan: "quad", len: 2000, leg: 600, r: 400, head: 230, ears: "round", snout: 2, trunk: 0.5, tail: { l: 80, r: 30, a: -0.5 }, col: "#3f3a38", belly: "#5a5450", sp: 600, run: 4000, edge: 1, eats: ["plants", "fruit", "leaves"], prey: ["jaguar"], acts: { walk: 3, idle: 2, eat: 4, swim: 2 } },
  { id: "dartfrog", name: "Poison dart frog", grp: "trop", plan: "frog", len: 45, col: "#2a7fe0", belly: "#151515", sp: 400, edge: 1, eats: ["bugs"], acts: { hop: 3, idle: 4, eat: 3 } },
  { id: "iguana", name: "Green iguana", grp: "trop", plan: "low", len: 1400, fat: 0.8, col: "#5a9a3a", belly: "#9ac25a", spikes: "#4a7a2a", sp: 300, run: 1500, climb: 400, edge: 1, eats: ["plants", "fruit", "leaves"], climbs: ["tree", "rock"], acts: { walk: 2, idle: 5, eat: 3, tree: 2, rock: 2, swim: 1 } },
  { id: "piranha", name: "Red-bellied piranha", grp: "trop", plan: "fish", len: 250, tall: 1.5, col: "#8a9298", belly: "#d84a2a", fin: "#6a7278", sp: 600, fish: 1, eats: ["surface"], acts: { swim: 5, idle: 2, eat: 3 } },
  // the African savanna
  { id: "lion", name: "Lion", grp: "afr", plan: "quad", len: 1900, leg: 520, r: 300, head: 200, ears: "round", mane: "#7a4a1e", maneBig: 1, snout: 1.3, tail: { l: 900, r: 25, a: -0.4, tip: "#4a2a12" }, col: "#c9973e", belly: "#e2c690", sp: 900, run: 15000, eats: ["meat"], hunts: ["zebra", "warthog", "wildebeest", "deer", "capybara"], acts: { walk: 2, idle: 6, eat: 1 } },
  { id: "cheetah", name: "Cheetah", grp: "afr", plan: "quad", len: 1300, leg: 560, r: 170, head: 105, ears: "round", spots: "#1d1712", tail: { l: 750, r: 25, a: -0.2, tip: "#1d1712" }, col: "#d9ab5a", belly: "#f1e2c4", sp: 1000, run: 25000, eats: ["meat"], hunts: ["zebra", "warthog", "rabbit", "deer"], prey: ["lion"], acts: { walk: 3, idle: 4, eat: 1 } },
  { id: "elephant", name: "African elephant", grp: "afr", plan: "quad", len: 3500, leg: 1600, r: 800, head: 550, ears: "elephant", trunk: 1, tusks: 1, snout: 0.6, tail: { l: 1000, r: 30, a: -1.3 }, col: "#8e8a86", belly: "#8e8a86", sp: 1200, run: 6000, edge: 1, eats: ["leaves", "plants", "grass", "fruit"], acts: { walk: 3, idle: 2, eat: 5, swim: 1 } },
  { id: "giraffe", thin: 0.6, name: "Giraffe", grp: "afr", plan: "quad", len: 2200, leg: 1700, r: 420, head: 200, ears: "deer", snout: 1.8, neck: 5, mane: "#7a4520", horns: "#5a3e22", spots: "#7a4520", tail: { l: 900, r: 25, a: -1.2, tip: "#2a1d12" }, col: "#d9a24a", belly: "#e6cf9c", sp: 1100, run: 12000, wary: 6000, eats: ["leaves", "plants"], prey: ["lion"], acts: { walk: 3, idle: 2, eat: 6 } },
  { id: "zebra", call: "zebra", name: "Plains zebra", grp: "afr", plan: "quad", len: 2200, leg: 800, r: 360, head: 220, ears: "deer", snout: 2.2, neck: 1.4, mane: "#151515", stripes: "#151515", tail: { l: 600, r: 25, a: -1, tip: "#151515" }, col: "#f4f2ee", belly: "#f4f2ee", face: "#2a2a2a", sp: 1100, run: 14000, wary: 6000, eats: ["grass"], prey: ["lion", "cheetah", "tiger", "jaguar", "crocodile"], acts: { walk: 3, idle: 2, eat: 6 } },
  { id: "wildebeest", name: "Blue wildebeest", grp: "afr", plan: "quad", len: 2100, leg: 760, r: 380, head: 240, ears: "deer", snout: 1.8, neck: 1, horns: "#2a2a28", mane: "#1d1d1d", stripes: "#4a4a4a", tail: { l: 600, r: 30, a: -1, col: "#1d1d1d" }, col: "#6e6e72", belly: "#7e7e80", sp: 1100, run: 14000, wary: 6000, eats: ["grass"], prey: ["lion", "cheetah", "crocodile"], acts: { walk: 3, idle: 2, eat: 6 } },
  { id: "hippo", name: "Hippopotamus", grp: "afr", plan: "quad", len: 3500, leg: 500, r: 700, head: 450, ears: "round", snout: 1.2, tail: { l: 300, r: 40, a: -0.8 }, col: "#7d6a70", belly: "#c99a92", sp: 600, run: 6000, edge: 1, eats: ["grass", "pond"], acts: { walk: 2, idle: 3, eat: 3, swim: 5 } },
  { id: "warthog", name: "Warthog", grp: "afr", plan: "quad", len: 1300, leg: 500, r: 280, head: 230, ears: "round", snout: 1.4, tusks: 1, mane: "#4a3a2e", tail: { l: 400, r: 12, a: 1.4 }, col: "#7a6a5e", belly: "#8a7a6e", sp: 800, run: 5000, eats: ["grass", "garden"], prey: ["lion", "cheetah"], acts: { walk: 3, idle: 2, eat: 5 } },
  { id: "meerkat", name: "Meerkat", grp: "afr", plan: "quad", len: 280, leg: 70, r: 50, head: 40, ears: "round", mask: 1, stand: -1.25, tail: { l: 220, r: 10, a: -0.2, tip: "#2a2018" }, col: "#c4a57a", belly: "#dcc39a", sp: 500, run: 2500, eats: ["bugs"], prey: ["eagle", "hawk", "dog", "lion", "cheetah"], acts: { walk: 3, idle: 5, eat: 3 } },
  { id: "ostrich", name: "Ostrich", grp: "afr", plan: "bird", walker: 1, len: 1500, legs: 4.5, neck: 3, col: "#2a2522", wing: "#f4f2ee", belly: "#2a2522", head: "#c9a48a", beak: "#d8b48a", sp: 1500, run: 15000, eats: ["plants", "seeds", "bugs"], prey: ["lion", "cheetah"], acts: { walk: 4, idle: 2, eat: 4 } },
  { id: "flamingo", name: "Greater flamingo", grp: "afr", plan: "bird", wader: 1, len: 700, legs: 5, neck: 3, col: "#f28aa0", wing: "#e2607e", belly: "#f6a0b2", beak: "#2a2a2a", sp: 7000, eats: ["pond"], acts: { wade: 5, eat: 4, idle: 3, fly: 1 } },
  { id: "crocodile", call: "crocodile", name: "Nile crocodile", grp: "afr", plan: "low", len: 4000, col: "#4f5a32", belly: "#c9c08a", spikes: "#3e4828", snout: 1.6, sp: 300, run: 3000, edge: 1, eats: ["meat"], hunts: ["zebra", "wildebeest", "capybara"], acts: { walk: 1, idle: 5, swim: 5, eat: 1 } },
  { id: "tilapia", call: "tilapia", name: "Nile tilapia", grp: "afr", plan: "fish", len: 300, tall: 1.3, col: "#7a8a7a", belly: "#d8d4c0", fin: "#c95a4a", stripe: "#5a6a5a", sp: 450, fish: 1, eats: ["surface"], acts: { swim: 5, idle: 2, eat: 3 } },
  // Asia
  { id: "panda", name: "Giant panda", grp: "asia", plan: "quad", len: 1500, leg: 380, r: 380, head: 240, ears: "round", earc: "#151515", legc: "#151515", patches: "#151515", snout: 1, face: "#f4f2ee", tail: { l: 120, r: 50, a: -0.3, col: "#f4f2ee" }, col: "#f4f2ee", belly: "#f4f2ee", sp: 500, run: 2500, climb: 400, eats: ["bamboo", "plants"], climbs: ["tree"], acts: { walk: 2, idle: 4, eat: 6, tree: 1 } },
  { id: "tiger", call: "tiger", name: "Bengal tiger", grp: "asia", plan: "quad", len: 2000, leg: 520, r: 300, head: 190, ears: "round", stripes: "#1d1712", snout: 1.2, face: "#f4ece0", tail: { l: 900, r: 30, a: -0.3, rings: 1 }, col: "#e07a24", belly: "#f4ece0", sp: 900, run: 15000, edge: 1, eats: ["meat"], hunts: ["deer", "reddeer", "boar", "zebra", "capybara"], acts: { walk: 3, idle: 4, eat: 1, swim: 2 } },
  { id: "redpanda", name: "Red panda", grp: "asia", plan: "quad", len: 550, leg: 180, r: 120, head: 90, ears: "cat", face: "#f4ece0", legc: "#2a1a12", tail: { l: 450, r: 55, a: 0.2, rings: 1, bushy: 1 }, col: "#b4421e", belly: "#2a1a12", sp: 500, run: 2000, climb: 800, eats: ["bamboo", "fruit"], climbs: ["tree", "house"], acts: { walk: 2, idle: 3, eat: 3, tree: 5, house: 1 }, treeMeal: "napping on a branch of" },
  { id: "macaque", call: "macaque", name: "Japanese macaque (snow monkey)", grp: "asia", plan: "quad", len: 550, leg: 300, r: 140, head: 90, ears: "round", snout: 0.8, face: "#d77a6a", tail: { l: 90, r: 20, a: 0.4 }, col: "#9a8a78", belly: "#b4a490", sp: 600, run: 3000, climb: 1100, edge: 1, eats: ["fruit", "plants", "garden"], climbs: ["tree", "house"], acts: { walk: 3, idle: 3, eat: 3, tree: 3, house: 2, swim: 2 } },
  { id: "peacock", call: "peacock", name: "Indian peafowl (peacock)", grp: "asia", plan: "bird", walker: 1, len: 1000, legs: 1.8, neck: 1.6, col: "#1f5fb4", wing: "#7a6a4a", belly: "#1f5fb4", head: "#1f5fb4", crest: 1, beak: "#c9b49a", tailLong: 3, tailc: "#2f8a5a", sp: 600, run: 3500, eats: ["seeds", "bugs", "plants"], prey: ["tiger", "dog"], acts: { walk: 4, idle: 3, eat: 4 } },
  { id: "crane", name: "Red-crowned crane", grp: "asia", plan: "bird", wader: 1, len: 1000, legs: 4, neck: 2.5, col: "#f4f2ee", wing: "#151515", belly: "#f4f2ee", head: "#151515", cap: "#d22a2a", beak: "#8a8a6a", sp: 7000, eats: ["pond", "bugs"], acts: { wade: 5, eat: 4, idle: 3, fly: 1 } },
  { id: "mandarin", name: "Mandarin duck", grp: "asia", plan: "duck", len: 450, col: "#d8742a", wing: "#3a5a8a", belly: "#f4f2ee", head: "#5a3a8a", beak: "#d83a2a", sp: 450, water: 1, eats: ["pond"], acts: { swim: 4, eat: 4, idle: 2, walk: 1 } },
  { id: "koi", name: "Koi", grp: "asia", plan: "fish", len: 600, col: "#f07a2a", belly: "#f4f2ee", fin: "#f4f2ee", stripe: "#f4f2ee", sp: 350, fish: 1, eats: ["surface"], acts: { swim: 5, idle: 3, eat: 3 } },
  // Europe
  { id: "reddeer", name: "Red deer", grp: "eur", plan: "quad", len: 1900, leg: 750, r: 300, head: 170, ears: "deer", snout: 1.8, neck: 1.2, antlers: "#c2ab83", tail: { l: 120, r: 40, a: -0.6 }, col: "#8a4f2e", belly: "#c9a884", sp: 1000, run: 10000, wary: 6000, eats: ["plants", "leaves", "grass", "garden"], prey: ["dog", "wolf", "tiger", "lion"], acts: { walk: 3, idle: 2, eat: 5 } },
  { id: "hedgehog", call: "hedgehog", name: "European hedgehog", grp: "eur", plan: "quad", len: 220, leg: 40, r: 85, head: 45, ears: "round", snout: 1.6, spines: "#4a3a2e", face: "#c9b49a", tail: { l: 20, r: 10, a: 0 }, col: "#5a4a3a", belly: "#c9b49a", sp: 250, run: 600, eats: ["bugs", "worms", "fruit"], acts: { walk: 4, idle: 3, eat: 4 } },
  { id: "badger", call: "badger", name: "European badger", grp: "eur", plan: "quad", len: 750, leg: 180, r: 180, head: 110, ears: "round", snout: 1.5, face: "#f4f2ee", mask: 1, tail: { l: 150, r: 35, a: 0 }, col: "#8a8a86", belly: "#2a2a2a", legc: "#2a2a2a", sp: 400, run: 1800, eats: ["worms", "bugs", "fruit", "garden"], acts: { walk: 3, idle: 2, eat: 4 } },
  { id: "boar", name: "Wild boar", grp: "eur", plan: "quad", len: 1400, leg: 500, r: 330, head: 240, ears: "cat", snout: 1.4, tusks: 1, mane: "#2a221c", tail: { l: 250, r: 15, a: -0.8 }, col: "#4a3a2e", belly: "#5a4a3e", sp: 700, run: 6000, eats: ["garden", "acorns", "worms"], prey: ["wolf", "tiger"], acts: { walk: 3, idle: 2, eat: 5 } },
  { id: "wolf", name: "Gray wolf", grp: "eur", plan: "quad", len: 1200, leg: 450, r: 170, head: 120, ears: "fox", snout: 1.9, tail: { l: 450, r: 65, a: -0.4, bushy: 1 }, col: "#8a8580", belly: "#d9d4cc", sp: 1100, run: 9000, eats: ["meat"], hunts: ["reddeer", "deer", "boar", "sheep", "rabbit", "reindeer"], acts: { walk: 4, idle: 3, eat: 1 } },
  { id: "eurobin", call: "robin", name: "European robin", grp: "eur", plan: "bird", len: 140, col: "#7a6448", wing: "#6a5640", belly: "#e0682a", beak: "#2a2a2a", sp: 5500, eats: ["worms", "bugs", "seeds"], acts: { fly: 3, eat: 5, idle: 3 } },
  { id: "stork", name: "White stork", grp: "eur", plan: "bird", wader: 1, len: 1000, legs: 3.5, neck: 1.8, col: "#f4f2ee", wing: "#151515", belly: "#f4f2ee", beak: "#e2402a", bigBeak: 1.6, sp: 7000, eats: ["pond", "bugs"], acts: { wade: 4, eat: 3, idle: 3, fly: 2 } },
  { id: "trout", name: "Brown trout", grp: "eur", plan: "fish", len: 450, col: "#a08a4a", belly: "#efe6c4", fin: "#8a7438", stripe: "#6a5a2a", sp: 600, fish: 1, eats: ["surface"], acts: { swim: 5, idle: 2, eat: 3 } },
  // Australia
  { id: "kangaroo", name: "Red kangaroo", grp: "aus", plan: "hop", len: 1300, leg: 400, r: 280, head: 140, ears: "deer", snout: 1.6, stand: -0.75, standAlways: 1, tail: { l: 1000, r: 90, a: -0.5 }, col: "#b4642e", belly: "#e6c9a4", sp: 2000, run: 9000, eats: ["grass", "plants"], prey: ["dingo", "dog"], acts: { walk: 3, idle: 3, eat: 5 } },
  { id: "koala", name: "Koala", grp: "aus", plan: "quad", len: 700, leg: 220, r: 220, head: 170, ears: "koala", snout: 0.6, tail: { l: 30, r: 30, a: 0 }, col: "#9a9894", belly: "#e8e4dc", sp: 200, run: 1500, climb: 250, eats: ["leaves"], climbs: ["tree"], acts: { tree: 9, idle: 2, walk: 1 }, treeMeal: "eating eucalyptus leaves up in", treeStay: 4 },
  { id: "wombat", call: "wombat", name: "Common wombat", grp: "aus", plan: "quad", len: 1000, leg: 180, r: 300, head: 200, ears: "round", snout: 0.9, tail: { l: 30, r: 30, a: 0 }, col: "#7a6a5a", belly: "#8a7a6a", sp: 400, run: 3000, eats: ["grass", "plants"], acts: { walk: 3, idle: 3, eat: 5 } },
  { id: "platypus", name: "Platypus", grp: "aus", plan: "low", len: 450, fat: 1.3, bill: "#2a2a2a", beaver: 1, col: "#5a3e2a", belly: "#8a6a4a", sp: 250, run: 600, edge: 1, eats: ["bugs", "pond"], acts: { walk: 1, idle: 3, swim: 6, eat: 3 } },
  { id: "dingo", name: "Dingo", grp: "aus", plan: "quad", len: 1000, leg: 400, r: 150, head: 105, ears: "fox", snout: 1.8, tail: { l: 350, r: 45, a: 0.4, bushy: 1, tip: "#f4ece0" }, col: "#d29a5a", belly: "#f4ece0", sp: 1100, run: 8000, eats: ["meat"], hunts: ["kangaroo", "wombat", "rabbit", "emu"], acts: { walk: 4, idle: 3, eat: 1 } },
  { id: "kookaburra", name: "Laughing kookaburra", grp: "aus", plan: "bird", len: 420, col: "#8a6a4a", wing: "#6a5a4a", belly: "#efe6d8", head: "#efe6d8", beak: "#3a3a3a", bigBeak: 1.6, sp: 6000, eats: ["bugs", "worms"], acts: { fly: 3, eat: 4, idle: 4 } },
  { id: "cockatoo", name: "Sulphur-crested cockatoo", grp: "aus", plan: "bird", len: 480, col: "#f4f2ee", wing: "#ece8de", belly: "#f4f2ee", crest: 1, crestc: "#f2d22a", beak: "#2a2a2a", bigBeak: 1.3, sp: 6500, eats: ["seeds", "fruit"], acts: { fly: 4, eat: 4, idle: 3 } },
  { id: "emu", name: "Emu", grp: "aus", plan: "bird", walker: 1, len: 1300, legs: 4, neck: 2.5, col: "#5a4a3a", wing: "#5a4a3a", belly: "#5a4a3a", head: "#3a4a6a", beak: "#2a2a2a", sp: 1300, run: 13000, eats: ["plants", "fruit", "bugs"], prey: ["dingo"], acts: { walk: 4, idle: 2, eat: 4 } },
  { id: "barramundi", name: "Barramundi", grp: "aus", plan: "fish", len: 700, col: "#9aa2a8", belly: "#e8eae4", fin: "#7a8288", sp: 500, fish: 1, eats: ["surface"], acts: { swim: 5, idle: 2, eat: 3 } },
  // the Arctic and Antarctic
  { id: "polarbear", name: "Polar bear", grp: "polar", plan: "quad", len: 2200, leg: 450, r: 480, head: 260, ears: "round", snout: 1.6, neck: 0.5, tail: { l: 120, r: 60, a: 0.2 }, col: "#efebe0", belly: "#e6e0d2", sp: 900, run: 9000, edge: 1, eats: ["meat"], hunts: ["seal", "arcticfox"], acts: { walk: 3, idle: 3, eat: 1, swim: 3 } },
  { id: "arcticfox", name: "Arctic fox", grp: "polar", plan: "quad", len: 600, leg: 260, r: 110, head: 80, ears: "round", snout: 1.6, tail: { l: 330, r: 70, a: 0.3, bushy: 1 }, col: "#f4f2ee", belly: "#f4f2ee", sp: 900, run: 5000, eats: ["meat", "bugs", "fruit"], hunts: ["rabbit", "chipmunk"], prey: ["polarbear", "wolf"], acts: { walk: 4, idle: 3, eat: 2 } },
  { id: "reindeer", name: "Reindeer (caribou)", grp: "polar", plan: "quad", len: 1900, leg: 700, r: 330, head: 180, ears: "deer", snout: 1.6, neck: 1, antlers: "#c2ab83", mane: "#efe6d8", tail: { l: 150, r: 50, a: -0.4, col: "#f4f2ee" }, col: "#8a7a68", belly: "#efe6d8", sp: 1100, run: 9000, wary: 6000, eats: ["grass", "plants"], prey: ["wolf", "polarbear"], acts: { walk: 3, idle: 2, eat: 5 } },
  { id: "penguin", name: "Emperor penguin", grp: "polar", plan: "penguin", len: 1100, col: "#1d1d22", belly: "#f4f2ee", head: "#1d1d22", cheek: "#f2b63a", beak: "#2a2a2a", sp: 300, run: 700, edge: 1, eats: ["fish"], prey: ["seal"], acts: { walk: 3, idle: 4, swim: 4, eat: 1 } },
  { id: "snowyowl", name: "Snowy owl", grp: "polar", plan: "bird", owl: 1, len: 600, col: "#f4f2ee", wing: "#e8e4dc", belly: "#f6f4f0", spotsB: "#4a4a4a", beak: "#2a2a2a", sp: 6500, eats: ["mice"], acts: { fly: 2, eat: 1, idle: 6 } },
  { id: "seal", name: "Harbor seal", grp: "polar", plan: "low", len: 1700, fat: 1.6, flippers: 1, snout: 0.7, col: "#7a7a72", belly: "#a8a8a0", spots: "#4a4a44", sp: 250, run: 600, edge: 1, eats: ["fish"], hunts: ["penguin"], acts: { walk: 1, idle: 5, swim: 6, eat: 1 } },
  { id: "arcticchar", name: "Arctic char", grp: "polar", plan: "fish", len: 500, col: "#4a5a64", belly: "#e05a3a", fin: "#e8e4dc", sp: 550, fish: 1, eats: ["surface"], acts: { swim: 5, idle: 2, eat: 3 } },
];
export const ANIMAL_GROUPS = [["farm", "Pets & farm"], ["na", "North America"], ["trop", "Tropical rainforest"], ["afr", "African savanna"], ["asia", "Asia"], ["eur", "Europe"], ["aus", "Australia"], ["polar", "Arctic & Antarctic"]];
// within a region: land animals, birds, and those that live in or by the water
export function animalKind(s) { return s.fish ? "Fish" : s.water || s.wader || s.plan === "duck" || s.plan === "penguin" || (s.edge && s.acts.swim >= 3) ? "In and by the water" : s.plan === "bird" || s.plan === "hawk" ? "Birds" : "Animals"; }
const SPEC = new Map(ANIMALS.map((s) => [s.id, s]));
export const needsWater = (id) => { const s = SPEC.get(id); return !!(s && (s.fish || s.water)); };

// what the plants are, for eating and climbing (ids from the landscape's plant list)
const TREES = new Set("oak maple birch pine spruce palm willow cypress fir cherry apple aspen dead redmaple fanpalm magnolia jacaranda ginkgo olive japanesemaple dogwood sequoia cedar poplar elm acacia baobab coconut datepalm eucalyptus lemon orange snowpine".split(" "));
const NUT = new Set("oak maple redmaple elm poplar ginkgo birch aspen pine spruce fir cedar".split(" "));
const FRUIT = new Set("apple cherry lemon orange olive dogwood".split(" "));
const BROWSE = new Set("bush shrub hedge boxwood rose hydrangea fern azalea lilac forsythia holly hosta tallhedge juniper tulips wildflowers daisies poppies daffodils marigolds bluebells clover lavender sunflowers".split(" "));
const GARDEN = new Set("vegbed corn pumpkins tomato".split(" "));
const SEEDS = new Set("sunflowers wildflowers pampas fountaingrass grassclump birdbath".split(" "));
const FLOWERS = new Set("tulips wildflowers daisies poppies daffodils marigolds bluebells sunflowers lavender rose hydrangea azalea lilac forsythia lotus".split(" "));
const FOODS = [["meat", "a meal it caught"], ["fish", "a fish it caught"], ["grass", "the grass"], ["bugs", "bugs in the grass"], ["worms", "worms in the lawn"], ["seeds", "seeds on the ground"], ["acorns", "nuts on the ground"], ["fruit", "fallen fruit"], ["pond", "water weeds"], ["mice", "a mouse it caught"]];
const ROCKS = new Set("rock stone rockpile boulder2 log stump mossyrock".split(" "));
const PNAME = { oak: "oak tree", maple: "maple tree", redmaple: "red maple", birch: "birch", pine: "pine", spruce: "spruce", hosta: "hostas", vegbed: "vegetable bed", corn: "corn", pumpkins: "pumpkins", tomato: "tomato plant", apple: "apple tree", sunflowers: "sunflowers", tulips: "tulips", rose: "rose bush", birdbath: "bird bath", clover: "clover" };

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
function weighted(acts) { let t = 0; for (const k in acts) t += acts[k]; let r = Math.random() * t; for (const k in acts) { r -= acts[k]; if (r <= 0) return k; } return Object.keys(acts)[0]; }
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// ------------------------------------------------------------------ the bodies (simple shapes)
const SPH = new THREE.SphereGeometry(1, 12, 8);
const LEG = new THREE.CylinderGeometry(1, 0.8, 1, 7).rotateX(Math.PI / 2).translate(0, 0, -0.5); // hangs down from 0
const CONE = new THREE.ConeGeometry(1, 1, 8).rotateX(Math.PI / 2); // points +Z
const FIN = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, -1, 0, 0.6, -1, 0, -0.6, 0, 0, 0, -1, 0, -0.6, -1, 0, 0.6], 3)); FIN.computeVertexNormals();
for (const g of [SPH, LEG, CONE, FIN]) g.userData.shared = true;
const mats = new Map();
const M = (c) => { if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide })); return mats.get(c); };
function part(parent, geo, c, sx, sy, sz, x, y, z) { const m = new THREE.Mesh(geo, M(c)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = false; parent.add(m); return m; }
const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

// a four-legged animal: +X forward, the feet at z = 0
function buildQuad(s) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0), L = s.len, h = s.leg, r = s.r, hr = s.head, bz = h + r * 0.75;
  const P = { root, body, legs: [], head: null, tail: null };
  part(body, SPH, s.col, L / 2, r, r * 0.95, 0, 0, bz);
  part(body, SPH, s.belly, L * 0.42, r * 0.8, r * 0.6, 0, 0, bz - r * 0.35);
  if (s.stripe) for (const y of [-0.45, 0, 0.45]) part(body, SPH, y ? s.belly : s.stripe, L * 0.42, r * 0.12, r * 0.2, 0, y * r, bz + r * 0.82);
  // stripes go round the body; spots and patches sit on it
  if (s.stripes) for (let i = 0; i < 9; i++) { const x = L * (0.36 - i * 0.09), c = Math.sqrt(Math.max(0.05, 1 - (x / (L / 2)) ** 2)); part(body, SPH, s.stripes, L * 0.02, r * 1.015 * c, r * 0.965 * c, x, 0, bz); }
  if (s.spots) for (let k = 0; k < 22; k++) { const a = ((k * 137.5) % 360) * (Math.PI / 180), x = (((k * 0.618) % 1) - 0.5) * L * 0.8, c = Math.sqrt(Math.max(0, 1 - (x / (L / 2)) ** 2)); if (Math.cos(a) < -0.3) continue; part(body, SPH, s.spots, r * 0.13, r * 0.13, r * 0.13, x, Math.sin(a) * r * 0.97 * c, bz + Math.cos(a) * r * 0.92 * c); }
  if (s.patches) { part(body, SPH, s.patches, L * 0.16, r * 1.02, r * 0.97, L * 0.28, 0, bz); }
  if (s.spines) for (let k = 0; k < 26; k++) { const a = (((k * 47) % 140) - 70) * (Math.PI / 180), x = (((k * 0.618) % 1) - 0.55) * L * 0.85; const c = part(body, CONE, s.spines, r * 0.08, r * 0.08, r * 0.35, x, Math.sin(a) * r * 0.95, bz + Math.cos(a) * r * 0.9); c.rotation.x = -a; c.rotation.y = -0.5; }
  const lc = s.legc || s.col;
  for (const [x, y] of [[0.33, 0.55], [0.33, -0.55], [-0.33, 0.55], [-0.33, -0.55]]) {
    const pv = pivot(body, x * L, y * r, h + r * 0.2), lr = Math.max(5, r * (h > 300 ? 0.2 : 0.24) * (s.trunk === 1 ? 1.4 : 1) * (s.thin || 1));
    part(pv, LEG, lc, lr, lr, h + r * 0.2, 0, 0, 0); P.legs.push(pv);
  }
  // the head on a neck (a little one, or a deer's, or a giraffe's)
  const nf = s.neck || 0, nk = hr * (0.6 + 2 * nf), hx = L * 0.46 + nf * hr * 0.25;
  const head = pivot(body, hx, 0, bz + nk * 0.55);
  if (nf) { const nkm = part(body, SPH, s.col, hr * 0.7, hr * 0.55, nk * 0.36, (L * 0.42 + hx) / 2, 0, bz + nk * 0.3); nkm.rotation.y = 0.3 / Math.max(1, nf * 0.6); if (s.spots && nf > 2) for (let k = 0; k < 8; k++) part(body, SPH, s.spots, hr * 0.2, hr * 0.57, hr * 0.2, (L * 0.42 + hx) / 2 + (k % 2 ? 1 : -1) * hr * 0.1, 0, bz + nk * (0.05 + k * 0.07)); }
  if (s.mane) { if (s.maneBig) part(head, SPH, s.mane, hr * 0.95, hr * 1.45, hr * 1.45, -hr * 0.15, 0, -hr * 0.1); else part(body, SPH, s.mane, nf ? hr * 0.25 : L * 0.2, hr * 0.15, nf ? nk * 0.36 : r * 0.3, nf ? (L * 0.42 + hx) / 2 - hr * 0.55 : L * 0.25, 0, nf ? bz + nk * 0.36 : bz + r * 0.95).rotation.y = nf ? 0.3 / Math.max(1, nf * 0.6) : 0; }
  part(head, SPH, s.col, hr * 1.05, hr * 0.9, hr * 0.85, hr * 0.5, 0, 0);
  if (s.patches) for (const y of [1, -1]) part(head, SPH, s.patches, hr * 0.22, hr * 0.18, hr * 0.26, hr * 1.18, y * hr * 0.4, hr * 0.15);
  const sn = s.snout || 1.2;
  part(head, SPH, s.face || s.belly, hr * 0.55 * sn, hr * 0.42, hr * 0.38, hr * (0.9 + 0.35 * sn), 0, -hr * 0.2);
  part(head, SPH, "#111", hr * 0.1, hr * 0.1, hr * 0.1, hr * (0.95 + 0.6 * sn), 0, -hr * 0.12); // nose
  for (const y of [1, -1]) part(head, SPH, "#111", hr * 0.12, hr * 0.12, hr * 0.12, hr * 1.2, y * hr * 0.42, hr * 0.25);
  if (s.mask) for (const y of [1, -1]) part(head, SPH, "#1b1b1b", hr * 0.3, hr * 0.22, hr * 0.18, hr * 1.1, y * hr * 0.4, hr * 0.22);
  const ec = s.earc || s.col;
  const ear = { cat: [0.32, 0.55, "cone"], fox: [0.35, 0.8, "cone"], dog: [0.3, 0.8, "flop"], deer: [0.3, 0.9, "ell"], rabbit: [0.22, 1.9, "ell"], round: [0.22, 0.28, "ell"], koala: [0.45, 0.45, "ell"], elephant: [1.1, 1.3, "big"] }[s.ears] || [0.25, 0.4, "ell"];
  for (const y of [1, -1]) {
    if (ear[2] === "cone") part(head, CONE, ec, hr * ear[0], hr * ear[0] * 0.6, hr * ear[1], hr * 0.35, y * hr * 0.5, hr * (0.7 + ear[1] / 2));
    else if (ear[2] === "flop") part(head, SPH, s.earc || "#6b4420", hr * 0.18, hr * ear[0], hr * ear[1] * 0.7, hr * 0.4, y * hr * 0.9, -hr * 0.15);
    else if (ear[2] === "big") part(head, SPH, ec, hr * 0.12, hr * ear[0], hr * ear[1], hr * 0.1, y * hr * 1.2, -hr * 0.1);
    else part(head, SPH, ec, hr * 0.12, hr * ear[0], hr * ear[1] * 0.55, hr * 0.25, y * hr * (s.ears === "koala" ? 0.8 : 0.45), hr * (0.6 + ear[1] * 0.45));
  }
  // a trunk hangs from the snout; tusks curve out; horns and antlers stand up
  if (s.trunk) { const tl = hr * (s.trunk === 1 ? 2.4 : 0.6); const t = part(head, LEG, s.col, hr * 0.2 * s.trunk, hr * 0.2 * s.trunk, tl, hr * (1.1 + 0.3 * sn), 0, -hr * 0.05); t.rotation.y = s.trunk === 1 ? -0.15 : -1.2; }
  if (s.tusks) for (const y of [1, -1]) { const t = part(head, CONE, "#f4efe2", hr * 0.07, hr * 0.07, hr * (s.trunk ? 0.9 : 0.45), hr * (1.2 + 0.2 * sn), y * hr * 0.3, -hr * 0.45); t.rotation.y = s.trunk ? 2.2 : -0.4; }
  if (s.horns) for (const y of [1, -1]) { const t = part(head, CONE, s.horns, hr * 0.09, hr * 0.09, hr * 0.5, hr * 0.3, y * hr * 0.3, hr * 0.9); t.rotation.y = s.id === "goat" ? -0.7 : 0; t.rotation.x = s.id === "cow" || s.id === "wildebeest" ? -y * 1.1 : 0; }
  if (s.antlers) for (const y of [1, -1]) {
    const a = pivot(head, hr * 0.2, y * hr * 0.35, hr * 0.7), len = hr * (s.palm ? 1.6 : 2.2);
    a.rotation.x = -y * 0.6; a.rotation.y = -0.35;
    part(a, LEG, s.antlers, hr * 0.09, hr * 0.09, len, 0, 0, len).rotation.x = Math.PI; // the beam, pointing up
    if (s.palm) part(a, SPH, s.antlers, hr * 0.5, hr * 0.08, hr * 0.7, -hr * 0.1, 0, len * 0.9);
    else for (let k = 1; k <= 3; k++) { const t = part(a, LEG, s.antlers, hr * 0.07, hr * 0.07, hr * 0.7, 0, 0, len * (0.3 + k * 0.22) + hr * 0.6); t.rotation.x = Math.PI; t.rotation.y = 0.7; }
  }
  P.head = head;
  // the tail: long and thin, bushy or a puff
  const t = s.tail, tail = pivot(body, -L * 0.48, 0, bz + r * 0.2);
  tail.rotation.y = -(t.a || 0);
  const tc = t.col || s.col;
  if (t.l < t.r * 2) part(tail, SPH, tc, t.r, t.r, t.r, -t.r * 0.4, 0, 0);
  else if (t.rings) for (let i = 0; i < 5; i++) part(tail, SPH, i % 2 ? (s.id === "redpanda" ? "#7a2a12" : "#2a2a28") : tc, t.l * 0.11, t.r, t.r, -t.l * (0.1 + i * 0.19), 0, 0);
  else {
    part(tail, SPH, tc, t.l / 2, t.r, t.r, -t.l / 2, 0, 0);
    if (t.tip) part(tail, SPH, t.tip, t.l * 0.14, t.r * 0.75 + 4, t.r * 0.75 + 4, -t.l * 0.94, 0, 0);
  }
  if (t.bushy) tail.rotation.y = -(t.a || 0) - 0.2;
  P.tail = tail;
  return P;
}
// a rabbit or kangaroo: a quad with big back legs (it hops)
function buildHop(s) { const P = buildQuad(s); const k = s.id === "kangaroo" ? [2.2, 1.6] : [1.6, 1.4]; P.legs[2].scale.set(k[0], k[1], 1); P.legs[3].scale.set(k[0], k[1], 1); if (s.id === "kangaroo") { P.legs[0].scale.set(0.6, 0.6, 0.6); P.legs[1].scale.set(0.6, 0.6, 0.6); } return P; }
// a bird: body, head with a beak, two wings that flap, a tail and legs (long ones on a wader)
function buildBird(s) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0), L = s.len, r = L * 0.2, lg = L * 0.22 * (s.legs || 1), bz = lg + r, hr = L * 0.15 * (s.owl ? 1.4 : 1);
  const P = { root, body, legs: [], wings: [], head: null };
  part(body, SPH, s.col, L * 0.33, r, r, 0, 0, bz);
  part(body, SPH, s.belly, L * 0.26, r * 0.85, r * 0.7, L * 0.04, 0, bz - r * 0.3);
  if (s.spotsB) for (let k = 0; k < 10; k++) part(body, SPH, s.spotsB, r * 0.08, r * 0.08, r * 0.08, L * (0.2 - k * 0.045), (k % 2 ? 1 : -1) * r * 0.6, bz + r * (0.5 - (k % 3) * 0.2));
  // a long neck lifts the head (flamingo, ostrich, crane)
  const nh = s.neck ? (s.neck - 1) * L * 0.22 : 0;
  if (nh) part(body, SPH, s.head && s.plan !== "duck" && !s.cap ? s.head : s.col, hr * 0.42, hr * 0.42, nh * 0.6, L * 0.3, 0, bz + r * 0.5 + nh * 0.5);
  const head = pivot(body, L * (s.owl ? 0.18 : 0.3), 0, bz + r * (s.owl ? 0.9 : 0.7) + nh);
  part(head, SPH, s.head || s.col, hr, hr * 0.92, hr, 0, 0, 0);
  if (s.cap) part(head, SPH, s.cap, hr * 0.85, hr * 0.8, hr * 0.5, -hr * 0.1, 0, hr * 0.55);
  if (s.crest) part(head, CONE, s.crestc || s.head || s.col, hr * 0.35, hr * 0.25, hr * (s.crestc ? 1.3 : 0.9), -hr * 0.45, 0, hr * 0.95).rotation.y = -0.6;
  if (s.mask) part(head, SPH, "#111", hr * 0.5, hr * 0.85, hr * 0.45, hr * 0.55, 0, -hr * 0.1);
  if (s.chin) part(head, SPH, "#f4f2ee", hr * 0.55, hr * 0.95, hr * 0.4, hr * 0.15, 0, -hr * 0.3);
  const bb = s.bigBeak || 1;
  const bk = part(head, CONE, s.beak, hr * 0.32 * Math.sqrt(bb), hr * 0.28 * Math.sqrt(bb), hr * (s.plan === "duck" ? 0.9 : 0.7) * bb, hr * (0.8 + 0.35 * bb), 0, -hr * 0.1); bk.rotation.y = Math.PI / 2 + (s.id === "flamingo" ? 0.9 : 0);
  if (s.plan === "duck") bk.scale.set(hr * 0.42, hr * 0.15, hr * 0.85);
  for (const y of [1, -1]) part(head, SPH, s.owl ? "#e8b62a" : "#111", hr * 0.15, hr * 0.15, hr * 0.15, hr * (s.owl ? 0.85 : 0.55), y * hr * (s.owl ? 0.4 : 0.7), hr * 0.25);
  P.head = head;
  const span = s.plan === "hawk" ? L * 1.0 : L * 0.62 * (s.wader ? 1.4 : 1);
  for (const y of [1, -1]) {
    const w = pivot(body, 0, y * r * 0.75, bz + r * 0.3);
    part(w, SPH, s.wing, L * 0.24, span / 2, r * 0.12, -L * 0.04, (y * span) / 2.1, 0);
    P.wings.push(w); w.userData.side = y;
  }
  const tlen = s.tailLong || 1, tl = part(body, SPH, s.tailc || s.wing, L * 0.22 * tlen, r * 0.55 * (tlen > 2 ? 1.6 : 1), r * 0.1, -L * (0.3 + 0.12 * tlen), 0, bz + r * 0.15 - (tlen > 2 ? L * 0.06 : 0)); tl.rotation.y = tlen > 2 ? 0.12 : 0.25;
  if (s.id === "peacock") for (let k = 0; k < 9; k++) part(body, SPH, "#2a6ab4", L * 0.025, L * 0.025, L * 0.01, -L * (0.45 + (k % 3) * 0.12), ((k % 5) - 2) * r * 0.25, bz + r * 0.25 - (k % 3) * L * 0.035);
  if (s.plan !== "duck") for (const y of [1, -1]) { const lgp = pivot(body, L * 0.02, y * r * 0.35, bz - r * 0.7); part(lgp, LEG, s.legc || (s.id === "flamingo" ? "#e57a8e" : s.wader ? "#3a3a3a" : "#6b5a46"), L * 0.012 * (s.walker && s.legs > 2 ? 2.5 : 1), L * 0.012 * (s.walker && s.legs > 2 ? 2.5 : 1), lg + r * 0.3, 0, 0, 0); P.legs.push(lgp); }
  return P;
}
// a penguin: it stands up, waddles and swims, and doesn't fly
function buildPenguin(s) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0), L = s.len, r = L * 0.2;
  const P = { root, body, legs: [], wings: [], head: null };
  part(body, SPH, s.col, r * 1.05, r, L * 0.38, 0, 0, L * 0.4);
  part(body, SPH, s.belly, r * 0.75, r * 0.85, L * 0.33, r * 0.4, 0, L * 0.38);
  const head = pivot(body, r * 0.15, 0, L * 0.82);
  part(head, SPH, s.head, r * 0.6, r * 0.55, r * 0.55, 0, 0, 0);
  if (s.cheek) for (const y of [1, -1]) part(head, SPH, s.cheek, r * 0.2, r * 0.12, r * 0.3, r * 0.1, y * r * 0.45, -r * 0.1);
  const bk = part(head, CONE, s.beak, r * 0.12, r * 0.1, r * 0.6, r * 0.75, 0, -r * 0.05); bk.rotation.y = Math.PI / 2 + 0.2;
  for (const y of [1, -1]) part(head, SPH, "#111", r * 0.07, r * 0.07, r * 0.07, r * 0.4, y * r * 0.35, r * 0.15);
  P.head = head;
  for (const y of [1, -1]) { const w = pivot(body, 0, y * r * 0.95, L * 0.6); part(w, SPH, s.col, r * 0.3, r * 0.08, L * 0.25, 0, 0, -L * 0.18); w.userData.side = y; P.wings.push(w); }
  for (const y of [1, -1]) { const f = pivot(body, r * 0.2, y * r * 0.4, L * 0.03); part(f, SPH, "#2a2a2a", r * 0.3, r * 0.15, L * 0.03, r * 0.1, 0, 0); P.legs.push(f); }
  return P;
}
// a crocodile, iguana, platypus or seal: long and low, short legs (or flippers), a long tail
function buildLow(s) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0), L = s.len, r = L * 0.08 * (s.fat || 1), bz = r * 0.75;
  const P = { root, body, legs: [], head: null, tail: null };
  part(body, SPH, s.col, L * (s.flippers ? 0.38 : 0.26), r, r * 0.7, 0, 0, bz);
  part(body, SPH, s.belly, L * (s.flippers ? 0.33 : 0.22), r * 0.85, r * 0.45, 0, 0, bz - r * 0.3);
  if (s.spots) for (let k = 0; k < 12; k++) part(body, SPH, s.spots, r * 0.1, r * 0.1, r * 0.06, L * (0.25 - k * 0.04), ((k % 3) - 1) * r * 0.5, bz + r * 0.66);
  if (s.spikes) for (let k = 0; k < 9; k++) part(body, CONE, s.spikes, r * 0.1, r * 0.06, r * 0.35, L * (0.2 - k * 0.05), 0, bz + r * 0.7);
  const hl = s.flippers ? L * 0.12 : L * 0.1, head = pivot(body, L * (s.flippers ? 0.36 : 0.26), 0, bz + r * (s.flippers ? 0.25 : 0));
  part(head, SPH, s.col, hl, r * 0.7 * (s.flippers ? 1.2 : 1), r * 0.55 * (s.flippers ? 1.3 : 1), hl * 0.6, 0, 0);
  const sn = s.snout || 1;
  if (s.bill) part(head, SPH, s.bill, hl * 0.8, r * 0.75, r * 0.15, hl * 1.6, 0, -r * 0.1);
  else part(head, SPH, s.col, hl * 0.9 * sn, r * 0.45, r * 0.32, hl * (1.2 + 0.5 * sn), 0, -r * 0.1);
  for (const y of [1, -1]) part(head, SPH, "#111", r * 0.1, r * 0.1, r * 0.1, hl * 0.9, y * r * 0.42, r * 0.35);
  P.head = head;
  for (const [x, y] of [[0.17, 1], [0.17, -1], [-0.17, 1], [-0.17, -1]]) {
    const pv = pivot(body, x * L * (s.flippers ? 1.6 : 1), y * r * 0.8, bz);
    if (s.flippers) { if (x > 0) part(pv, SPH, s.col, r * 0.45, r * 0.35, r * 0.08, 0, y * r * 0.3, -bz * 0.8); else continue; }
    else { const l = part(pv, LEG, s.col, r * 0.18, r * 0.18, bz * 1.3, 0, y * r * 0.3, 0); l.rotation.x = y * 0.6; }
    P.legs.push(pv);
  }
  const tail = pivot(body, -L * (s.flippers ? 0.36 : 0.25), 0, bz);
  if (s.flippers) part(tail, FIN, s.col, L * 0.12, 1, r * 0.6, 0, 0, 0).rotation.x = Math.PI / 2;
  else if (s.beaver) part(tail, SPH, s.col, L * 0.16, r * 0.6, r * 0.15, -L * 0.14, 0, -r * 0.3);
  else { const c = part(tail, CONE, s.col, r * 0.6, r * 0.45, L * 0.48, -L * 0.24, 0, -r * 0.2); c.rotation.y = -Math.PI / 2; }
  P.tail = tail;
  return P;
}
// a fish: a long body, a tail that swishes, fins on top
function buildFish(s) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0), L = s.len, r = L * 0.13 * (s.tall || 1);
  const P = { root, body, tail: null, legs: [] };
  part(body, SPH, s.col, L * 0.42, r * 0.55, r, 0, 0, 0);
  part(body, SPH, s.belly, L * 0.34, r * 0.45, r * 0.6, L * 0.02, 0, -r * 0.35);
  if (s.stripe) for (let i = 0; i < 5; i++) part(body, SPH, s.stripe, L * 0.03, r * 0.56, r * 0.75, L * (0.2 - i * 0.1), 0, r * 0.1);
  for (const y of [1, -1]) part(body, SPH, "#111", L * 0.025, L * 0.025, L * 0.025, L * 0.33, y * r * 0.38, r * 0.25);
  if (s.whisk) for (const y of [1, -1]) part(body, LEG, "#3a3a3a", 2, 2, L * 0.15, L * 0.4, y * r * 0.3, -r * 0.1).rotation.x = y * 1.1;
  const fin = part(body, FIN, s.fin, L * 0.22, 1, r * 0.6, L * 0.1, 0, r * 1.1); fin.rotation.y = Math.PI;
  const tail = pivot(body, -L * 0.38, 0, 0);
  part(tail, FIN, s.fin, L * 0.2, 1, r * 0.9, 0, 0, 0);
  P.tail = tail;
  return P;
}
// a box turtle: a high-domed shell with yellow spots, a head and short legs
function buildTurtle(s) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0), L = s.len;
  const P = { root, body, legs: [], head: null };
  part(body, SPH, s.col, L * 0.5, L * 0.4, L * 0.32, 0, 0, L * 0.18);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; part(body, SPH, s.spot, L * 0.06, L * 0.06, L * 0.03, Math.cos(a) * L * 0.25, Math.sin(a) * L * 0.2, L * 0.42); }
  for (const [x, y] of [[0.3, 0.32], [0.3, -0.32], [-0.3, 0.32], [-0.3, -0.32]]) { const pv = pivot(body, x * L, y * L, L * 0.12); part(pv, LEG, s.skin, L * 0.07, L * 0.07, L * 0.12, 0, 0, 0); P.legs.push(pv); }
  const head = pivot(body, L * 0.5, 0, L * 0.14); part(head, SPH, s.skin, L * 0.13, L * 0.1, L * 0.09, L * 0.08, 0, 0); P.head = head;
  return P;
}
// a bullfrog: a squat body, big eyes and long back legs
function buildFrog(s) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0), L = s.len;
  const P = { root, body, legs: [], head: null };
  part(body, SPH, s.col, L * 0.45, L * 0.33, L * 0.22, 0, 0, L * 0.25);
  part(body, SPH, s.belly, L * 0.38, L * 0.28, L * 0.12, L * 0.03, 0, L * 0.12);
  for (const y of [1, -1]) { part(body, SPH, s.col, L * 0.09, L * 0.09, L * 0.09, L * 0.28, y * L * 0.17, L * 0.42); part(body, SPH, "#111", L * 0.05, L * 0.05, L * 0.05, L * 0.33, y * L * 0.19, L * 0.45); }
  for (const y of [1, -1]) { const pv = pivot(body, -L * 0.25, y * L * 0.3, L * 0.15); part(pv, SPH, s.col, L * 0.35, L * 0.1, L * 0.08, -L * 0.1, 0, 0); P.legs.push(pv); }
  P.head = pivot(body, L * 0.35, 0, L * 0.3);
  return P;
}
const BUILD = { quad: buildQuad, hop: buildHop, bird: buildBird, hawk: buildBird, duck: buildBird, fish: buildFish, turtle: buildTurtle, frog: buildFrog, penguin: buildPenguin, low: buildLow };

// ------------------------------------------------------------------ the simulator
// root: the landscape's group (the animals show and hide with it)
export function makeAnimals(vp, root) {
  const g = new THREE.Group();
  g.name = "animals";
  root.add(g);
  const st = { on: true, size: 1, t: 0, stats: { ate: 0, tree: 0, house: 0, flew: 0, swam: 0, fled: 0, rock: 0 }, log: [] };
  let W = null, list = [], raf = 0, last = 0, onStatus = null, statusT = 0, threatT = 0;
  // ------------------------------------------------ the world they live in
  // L, arr: the landscape; plants: its plant list; plantGroup: the plant objects (same order);
  // mask(): the cells under the house; top(x, y): the height of the roof (or wall top) there
  function setWorld(o) {
    const key = o.key;
    if (W && W.key === key) { W.plantGroup = o.plantGroup; W.top = o.top; return false; }
    const { L, arr } = o, { nx, ny, res } = L, n = nx * ny, mask = o.mask();
    const land = [], water = [], edge = [], ring = [], inHouse = [], kind = new Uint8Array(n); // 1 land, 2 water, 3 by the water, 4 house
    const wet = (q) => !isNaN(arr.w[q]) && arr.w[q] - arr.h[q] > 40;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const q = j * nx + i;
      if (mask[q]) { inHouse.push(q); kind[q] = 4; continue; }
      if (wet(q)) { water.push(q); kind[q] = 2; continue; }
      land.push(q); kind[q] = 1;
      const nb = [i > 0 ? q - 1 : -1, i < nx - 1 ? q + 1 : -1, j > 0 ? q - nx : -1, j < ny - 1 ? q + nx : -1];
      if (nb.some((b) => b >= 0 && wet(b) && !mask[b])) { edge.push(q); kind[q] = 3; }
      if (nb.some((b) => b >= 0 && mask[b])) ring.push(q);
    }
    const plants = (o.plants || []).map((p, k) => ({ ...p, idx: k, h: (o.plantH ? o.plantH(p.k) : 3000) * (p.s || 1), z: 0 }));
    W = { key, L, arr, mask, kind, land, water, edge, ring, inHouse, plants, plantGroup: o.plantGroup, top: o.top };
    for (const p of W.plants) p.z = ground(p.x, p.y);
    W.trees = W.plants.filter((p) => TREES.has(p.k) && p.h > 1500);
    W.rocks = W.plants.filter((p) => ROCKS.has(p.k));
    // animals that are now somewhere they can't be start again from a good place
    for (const A of list) { A.task = []; if (A.wob) { A.wob = null; } place(A); if (!A.none && !A.s.fish && A.z > ground(A.x, A.y) + 50 && !A.s.water) A.z = ground(A.x, A.y); }
    return true;
  }
  const cellXY = (q) => [W.L.x0 + (q % W.L.nx) * W.L.res, W.L.y0 + ((q / W.L.nx) | 0) * W.L.res];
  const cellOf = (x, y) => { const L = W.L, i = Math.round((x - L.x0) / L.res), j = Math.round((y - L.y0) / L.res); return i >= 0 && j >= 0 && i < L.nx && j < L.ny ? j * L.nx + i : -1; };
  const ground = (x, y) => { const L = W.L, H = W.arr.h, fx = Math.max(0, Math.min(L.nx - 1.001, (x - L.x0) / L.res)), fy = Math.max(0, Math.min(L.ny - 1.001, (y - L.y0) / L.res)), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, n = L.nx; return (H[j * n + i] * (1 - u) + H[j * n + i + 1] * u) * (1 - v) + (H[(j + 1) * n + i] * (1 - u) + H[(j + 1) * n + i + 1] * u) * v; };
  const waterAt = (x, y) => { const q = cellOf(x, y); return q >= 0 && !isNaN(W.arr.w[q]) && W.arr.w[q] - W.arr.h[q] > 40 && !W.mask[q] ? W.arr.w[q] : null; };
  const houseAt = (x, y) => { const q = cellOf(x, y); return q >= 0 && W.mask[q] === 1; };
  const jit = (q) => { const [x, y] = cellXY(q), r = W.L.res * 0.45, L = W.L; return [Math.max(L.x0, Math.min(L.x0 + (L.nx - 1) * L.res, x + rnd(-r, r))), Math.max(L.y0, Math.min(L.y0 + (L.ny - 1) * L.res, y + rnd(-r, r)))]; };
  // can it go straight from here to there? (land animals keep out of the water and the house,
  // fish keep in the water)
  function clear(A, x1, y1) {
    const x0 = A.x, y0 = A.y, d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.ceil(d / (W.L.res * 0.5)));
    for (let k = 1; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n, q = cellOf(x, y);
      if (q < 0) return false;
      const wet = waterAt(x, y) !== null;
      if (A.s.fish) { if (!wet) return false; continue; }
      if (W.mask[q]) return false;
      if (wet && !(A.s.water || A.s.edge)) return false;
    }
    return true;
  }
  // a spot to go to: near (within r) when asked
  function spot(A, kind, r) {
    const pool = kind === "water" ? W.water : kind === "edge" ? (W.edge.length ? W.edge : W.land) : W.land;
    if (!pool.length) return null;
    for (let k = 0; k < 24; k++) {
      let q = pick(pool);
      if (r) { q = cellOf(A.x + rnd(-r, r), A.y + rnd(-r, r)); if (q < 0 || W.kind[q] !== (kind === "water" ? 2 : kind === "edge" && W.edge.length ? 3 : 1) && !(kind === "land" && W.kind[q] === 3)) continue; }
      const [x, y] = jit(q);
      if (kind !== "water" && houseAt(x, y)) continue;
      if (clear(A, x, y)) return [x, y];
    }
    return null;
  }
  // ------------------------------------------------ one animal
  function make(id) {
    const s = SPEC.get(id), P = BUILD[s.plan](s);
    P.root.userData.animal = id;
    g.add(P.root);
    const A = { s, P, id, x: 0, y: 0, z: 0, hd: rnd(0, 6.28), task: [], msg: "", ph: rnd(0, 6), mv: 0, pitch: 0, eat: 0, fly: 0, perched: false, wob: null };
    place(A);
    return A;
  }
  // a starting place that suits it
  function place(A) {
    if (!W) return;
    const s = A.s;
    const bad = () => !A.x || (s.fish ? waterAt(A.x, A.y) === null : houseAt(A.x, A.y) || (!s.water && !s.edge && waterAt(A.x, A.y) !== null));
    if (A.placed && !bad()) return;
    const pool = s.fish ? W.water : s.water ? (W.water.length ? W.water : W.land) : s.edge ? (W.edge.length ? W.edge : W.land) : W.land;
    if (!pool.length) { A.P.root.visible = false; A.none = true; return; }
    A.none = false; A.P.root.visible = true;
    [A.x, A.y] = jit(pick(pool));
    A.z = posZ(A, "ground");
    if (s.fish) A.z = fishZ(A);
    A.task = []; A.placed = true; A.perched = false;
  }
  function fishZ(A) { const w = waterAt(A.x, A.y), h = ground(A.x, A.y); if (w === null) return h; if (A.s.bottom) return h + 80; return Math.max(h + 60, Math.min(w - 80, rnd(h + (w - h) * 0.3, w - 80))); }
  function posZ(A, mode) {
    if (mode === "roof") { const t = W.top && W.top(A.x, A.y); return t ?? A.z; }
    const h = ground(A.x, A.y), w = waterAt(A.x, A.y);
    if (w !== null && mode !== "swimdeep") {
      const s = A.s;
      if (s.fish) return A.z;
      if (s.wader) return h; // stands on the bottom in the shallows
      return Math.max(h, w - (s.plan === "duck" ? s.len * 0.12 : s.plan === "low" ? s.len * 0.07 : s.leg ? s.leg + s.r * 0.3 : s.len * 0.15));
    }
    return h;
  }
  const say = (A, m) => { A.msg = m; };
  const tag = (s) => s.call || s.name.replace(/^(House |Eastern |American |Northern |Red-tailed |Largemouth |Channel |Yellow |White-tailed |Virginia |Red-bellied |Mourning |Canada |Fox |Red )/, "").replace(/ \(.*\)$/, "").toLowerCase();
  // ------------------------------------------------ choosing what to do next
  function plan(A) {
    const s = A.s, act = weighted(s.acts);
    const go = (x, y, sp, mode = "ground", m) => A.task.push({ k: "go", x, y, sp, mode, msg: m });
    const wait = (t, pose, m, plant) => A.task.push({ k: "wait", t, pose, msg: m, plant });
    if (A.none) { wait(5, "idle", ""); return; }
    if (s.fish) {
      if (act === "eat") { if (s.bottom) wait(rnd(3, 6), "eat", `${s.name} is feeding on the bottom of the pond`); else A.task.push({ k: "rise", msg: `${s.name} rises to snap up a bug on the water` }); return; }
      if (act === "idle") { wait(rnd(2, 5), "hover", `${s.name} is resting in the pond`); return; }
      const p = spot(A, "water"); if (p) { go(p[0], p[1], s.sp * rnd(0.6, 1.2), "fish", `${s.name} is swimming in the pond`); A.task[A.task.length - 1].z = fishZ({ ...A, x: p[0], y: p[1] }); st.stats.swam++; } else wait(2, "hover", `${s.name} is resting in the pond`);
      return;
    }
    if (s.wader) return planWader(A, act);
    if ((s.plan === "bird" || s.plan === "hawk") && !s.walker) return planBird(A, act);
    if (s.plan === "duck") {
      const onW = waterAt(A.x, A.y) !== null;
      if (act === "eat") { if (onW) wait(rnd(3, 6), "dabble", `${s.name} is dabbling for pond weeds`); else wait(rnd(3, 6), "eat", `${s.name} is nibbling the grass`); st.stats.ate++; return; }
      if (act === "swim" && W.water.length) { const p = spot(A, "water"); if (p) { go(p[0], p[1], s.sp, "ground", `${s.name} is paddling across the pond`); st.stats.swam++; return; } }
      if (act === "walk") { const p = spot(A, "edge", 3000); if (p) { go(p[0], p[1], s.sp * 0.7, "ground", `${s.name} is waddling along the bank`); return; } }
      wait(rnd(2, 5), "idle", onW ? `${s.name} is floating on the pond` : `${s.name} is resting by the pond`); return;
    }
    // land animals
    if (act === "eat") return planEat(A);
    if (act === "tree" && W.trees.length && s.climbs && s.climbs.includes("tree")) return planTree(A);
    if (act === "house" && W.inHouse.length && W.top && s.climbs && s.climbs.includes("house")) return planHouse(A);
    if (act === "rock" && W.rocks.length) {
      const r = nearest(A, W.rocks);
      if (r && clear(A, r.x, r.y)) { const ex = r.x - Math.cos(A.hd) * 10; go(ex, r.y, s.sp, "ground", `${s.name} is heading for the ${r.k === "log" ? "log" : "rocks"}`); A.task.push({ k: "perch", z: r.z + r.h * 0.9, msg: s.plan === "turtle" ? `${s.name} is sunning itself on a ${r.k === "log" ? "log" : "rock"}` : `${s.name} is sitting up on a ${r.k === "log" ? "log" : "rock"}`, t: rnd(4, 9) }); st.stats.rock++; return; }
    }
    if (act === "swim" && W.water.length) { const p = spot(A, "water"); if (p) { go(p[0], p[1], s.sp * 0.8, "ground", `${s.name} is swimming in the pond`); st.stats.swam++; return; } }
    if (act === "idle") { wait(rnd(2, 6), "idle", s.plan === "turtle" ? `${s.name} is resting in the sun` : `${s.name} is sitting and looking around`); return; }
    const hopper = s.plan === "frog";
    const p = spot(A, s.edge && W.edge.length ? "edge" : "land", hopper ? 2500 : s.len * 12);
    if (p) go(p[0], p[1], s.sp * rnd(0.7, 1.1), hopper || s.plan === "hop" ? "hop" : "ground", `${s.name} is ${hopper || s.plan === "hop" ? "hopping" : "walking"} around`);
    else wait(2, "idle", `${s.name} is sitting and looking around`);
  }
  // flamingos, storks and cranes walk the edge of the water, fish in the shallows and fly now and then
  function planWader(A, act) {
    const s = A.s, high = A.z > ground(A.x, A.y) + 300;
    if (act === "fly" || high) {
      const q = W.edge.length ? pick(W.edge) : pick(W.land);
      if (q !== undefined) { const [x, y] = jit(q); if (!houseAt(x, y)) { A.task.push({ k: "fly", x, y, z: ground(x, y), msg: `${s.name} is flying` }); st.stats.flew++; return; } }
    }
    if (act === "eat") { const wet = W.edge.length && W.kind[cellOf(A.x, A.y)] === 3; A.task.push({ k: "wait", t: rnd(3, 7), pose: "eat", msg: wet ? `${s.name} is fishing for food in the shallows` : `${s.name} is looking for bugs in the grass` }); st.stats.ate++; return; }
    if (act === "wade") { const p = spot(A, W.water.length ? "water" : "land", 2500) || spot(A, "edge", 3000); if (p) { A.task.push({ k: "go", x: p[0], y: p[1], sp: s.len * 0.6, mode: "ground", msg: W.water.length ? `${s.name} is wading in the pond` : `${s.name} is walking around` }); return; } }
    A.task.push({ k: "wait", t: rnd(3, 7), pose: "idle", msg: s.id === "flamingo" ? `${s.name} is standing on one leg` : `${s.name} is standing still, watching the water` });
  }
  function nearest(A, arr, f) { let b = null, bd = Infinity; for (const p of arr) { if (f && !f(p)) continue; const d = Math.hypot(p.x - A.x, p.y - A.y) * rnd(0.6, 1.4); if (d < bd) { bd = d; b = p; } } return b; }
  // walk up to a plant (just outside it) and eat
  function planEat(A) {
    const s = A.s, e = s.eats;
    const want = (p) => (e.includes("leaves") && (TREES.has(p.k) || p.k === "bamboo")) || (e.includes("bamboo") && p.k === "bamboo") || (e.includes("plants") && BROWSE.has(p.k)) || (e.includes("garden") && GARDEN.has(p.k)) || (e.includes("fruit") && FRUIT.has(p.k)) || (e.includes("acorns") && NUT.has(p.k)) || (e.includes("seeds") && (SEEDS.has(p.k) || NUT.has(p.k)));
    const p = W.plants.length ? nearest(A, W.plants, want) : null;
    const hop = s.plan === "hop" || s.plan === "frog" ? "hop" : "ground";
    if (p && Math.random() < 0.85) {
      const a = Math.atan2(A.y - p.y, A.x - p.x), off = Math.min(1500, (TREES.has(p.k) ? 400 : 250) * (p.s || 1)) + s.len * 0.5, x = p.x + Math.cos(a) * off, y = p.y + Math.sin(a) * off;
      if (!houseAt(x, y) && clear(A, x, y)) {
        const nm = PNAME[p.k] || p.k.replace(/([a-z])([A-Z])/g, "$1 $2");
        const what = p.k === "bamboo" && (e.includes("bamboo") || e.includes("leaves")) ? "the bamboo" : TREES.has(p.k) && e.includes("leaves") ? "leaves from the " + nm : NUT.has(p.k) && e.includes("acorns") ? (p.k === "oak" ? "acorns under the oak tree" : "seeds under the " + nm) : FRUIT.has(p.k) ? "fallen fruit under the " + nm : SEEDS.has(p.k) && p.k === "birdbath" ? "a drink at the bird bath" : "the " + nm;
        A.task.push({ k: "go", x, y, sp: s.sp, mode: hop, msg: `${s.name} is heading for the ${nm}` });
        A.task.push({ k: "wait", t: rnd(3, 8), pose: "eat", plant: BROWSE.has(p.k) || GARDEN.has(p.k) ? p.idx : null, face: [p.x, p.y], msg: `${s.name} is eating ${what}` });
        st.stats.ate++;
        return;
      }
    }
    const food = (FOODS.find((f) => e.includes(f[0])) || [0, "some leaves"])[1];
    A.task.push({ k: "wait", t: rnd(3, 7), pose: "eat", msg: `${s.name} is eating ${food}` });
    st.stats.ate++;
  }
  // climb a tree: to the trunk, up into the branches, sit (maybe eat), back down
  function planTree(A, quick) {
    const s = A.s, t = quick ? nearest(A, W.trees) : pick(W.trees);
    if (!t) return false;
    const a = Math.atan2(A.y - t.y, A.x - t.x), tr = Math.max(60, t.h * 0.025), x = t.x + Math.cos(a) * (tr + s.len * 0.15), y = t.y + Math.sin(a) * (tr + s.len * 0.15);
    if (houseAt(x, y) || !clear(A, x, y)) return false;
    const nm = PNAME[t.k] || t.k, hz = t.z + t.h * rnd(0.35, s.plan === "bird" ? 0.6 : 0.62);
    A.task.push({ k: "go", x, y, sp: quick ? s.run : s.sp, mode: "ground", msg: quick ? `${s.name} runs for the ${nm}` : `${s.name} is heading for the ${nm}` });
    A.task.push({ k: "face", x: t.x, y: t.y });
    A.task.push({ k: "climb", z: hz, sp: s.climb || 800, msg: `${s.name} is climbing up the ${nm}` });
    A.task.push({ k: "wait", t: rnd(4, 10) * (s.treeStay || 1), pose: s.id === "woodpecker" ? "peck" : "cling", msg: s.id === "woodpecker" ? `${s.name} is drumming on the ${nm} for bugs` : s.treeMeal ? `${s.name} is ${s.treeMeal} the ${nm}` : NUT.has(t.k) && s.eats.includes("acorns") ? `${s.name} is eating ${t.k === "oak" ? "acorns" : "seeds"} up in the ${nm}` : `${s.name} is up in the ${nm}` });
    A.task.push({ k: "climb", z: null, sp: (s.climb || 800) * 1.2, msg: `${s.name} is climbing down the ${nm}` });
    if (NUT.has(t.k) && s.eats.includes("acorns")) st.stats.ate++;
    st.stats.tree++;
    return true;
  }
  // climb the house: to a wall, up onto the roof, walk about on it, sit, back down the same way
  function planHouse(A) {
    const s = A.s;
    for (let k = 0; k < 10; k++) {
      const q = pick(W.ring), [x, y] = cellXY(q);
      if (!clear(A, x, y)) continue;
      // the house cell next to it, and a spot on the roof
      const L = W.L, nb = [q - 1, q + 1, q - L.nx, q + L.nx].find((b) => b >= 0 && W.mask[b]);
      if (nb === undefined) continue;
      const [hx, hy] = cellXY(nb), tz = W.top(hx, hy);
      if (tz === null || tz === undefined) continue;
      const [rx, ry] = jit(pick(W.inHouse)), rz = W.top(rx, ry);
      A.task.push({ k: "go", x, y, sp: s.sp, mode: "ground", msg: `${s.name} is heading for the house` });
      A.task.push({ k: "face", x: hx, y: hy });
      A.task.push({ k: "climb", z: tz, sp: s.climb || 800, msg: `${s.name} is climbing up the house` });
      A.task.push({ k: "go", x: hx, y: hy, sp: s.sp * 0.6, mode: "roof" });
      if (rz !== null && rz !== undefined) A.task.push({ k: "go", x: rx, y: ry, sp: s.sp * 0.6, mode: "roof", msg: `${s.name} is walking on the roof` });
      A.task.push({ k: "wait", t: rnd(5, 12), pose: s.id === "cat" ? "loaf" : "idle", msg: s.id === "cat" ? `${s.name} is sunning itself on the roof` : `${s.name} is sitting on the roof` });
      A.task.push({ k: "go", x: hx, y: hy, sp: s.sp * 0.6, mode: "roof" });
      A.task.push({ k: "face", x, y, back: true });
      A.task.push({ k: "go", x, y, sp: s.sp, mode: "air", msg: `${s.name} is climbing down the house` });
      A.task.push({ k: "climb", z: null, sp: (s.climb || 800) * 1.3, msg: `${s.name} is climbing down the house` });
      st.stats.house++;
      return true;
    }
    return false;
  }
  // birds fly between perches (tree tops, the roof, the bird bath, the ground) and peck for food
  function planBird(A, act) {
    const s = A.s;
    if (s.plan === "hawk" && act === "soar") { A.task.push({ k: "soar", t: rnd(8, 16), msg: `${s.name} is soaring high over the yard` }); return; }
    if (s.climbs && act === "tree" && W.trees.length) {
      const t = pick(W.trees), a = rnd(0, 6.28), tr = Math.max(60, t.h * 0.025) + s.len * 0.2, hz = t.z + t.h * rnd(0.25, 0.5);
      A.task.push({ k: "fly", x: t.x + Math.cos(a) * tr, y: t.y + Math.sin(a) * tr, z: hz, msg: `${s.name} flies to the ${PNAME[t.k] || t.k}` });
      A.task.push({ k: "face", x: t.x, y: t.y });
      A.task.push({ k: "wait", t: rnd(4, 9), pose: "peck", msg: `${s.name} is drumming on the ${PNAME[t.k] || t.k} for bugs`, cling: 1 });
      A.task.push({ k: "climb", z: hz + rnd(300, 900), sp: s.climb || 300, msg: `${s.name} hops up the trunk` });
      st.stats.tree++; st.stats.ate++;
      return;
    }
    if (act === "eat" && s.eats.includes("nectar")) {
      const fl = W.plants.filter((q) => FLOWERS.has(q.k));
      if (fl.length) { const f = pick(fl); A.task.push({ k: "fly", x: f.x + rnd(-80, 80), y: f.y + rnd(-80, 80), z: f.z + f.h * 0.95, msg: `${s.name} zips over to the ${PNAME[f.k] || f.k}` }); A.task.push({ k: "wait", t: rnd(2, 5), pose: "hover", msg: `${s.name} is drinking nectar from the ${PNAME[f.k] || f.k}` }); st.stats.ate++; return; }
      act = "fly";
    }
    if (act === "eat" && s.eats.includes("fish") && W.water.length) {
      const [x, y] = jit(pick(W.water)), w = waterAt(x, y);
      if (w !== null) {
        A.task.push({ k: "fly", x, y, z: w, msg: `${s.name} swoops down to the pond` });
        const q = pick(W.trees.length ? W.trees : []) || null;
        if (q) A.task.push({ k: "fly", x: q.x, y: q.y, z: q.z + q.h * 0.9, msg: `${s.name} caught a fish!` });
        A.task.push({ k: "wait", t: rnd(4, 8), pose: "peck", msg: `${s.name} is eating a fish it caught` + (q ? ` in the ${PNAME[q.k] || q.k}` : "") });
        st.stats.ate++;
        return;
      }
    }
    if (act === "eat" || (s.plan === "hawk" && act === "eat")) {
      // down to the ground (near a seed plant or tree when it can) and peck
      let p = null;
      const want = (q) => (s.eats.includes("nectar") && FLOWERS.has(q.k)) || (s.eats.includes("seeds") && SEEDS.has(q.k)) || (s.eats.includes("acorns") && NUT.has(q.k)) || (s.eats.includes("fruit") && FRUIT.has(q.k));
      const f = W.plants.length ? nearest(A, W.plants, want) : null;
      if (f && Math.random() < 0.7) { const a = rnd(0, 6.28), d = f.k === "birdbath" ? 0 : rnd(300, 900); p = [f.x + Math.cos(a) * d, f.y + Math.sin(a) * d]; if (houseAt(p[0], p[1]) || waterAt(p[0], p[1]) !== null) p = null; }
      if (!p) { const q = pick(W.land); if (q !== undefined) p = jit(q); }
      if (!p || houseAt(p[0], p[1])) { A.task.push({ k: "wait", t: 2, pose: "idle" }); return; }
      const bath = f && f.k === "birdbath" && Math.hypot(p[0] - f.x, p[1] - f.y) < 10;
      const z = bath ? f.z + 900 * (f.s || 1) : ground(p[0], p[1]);
      const hunter = s.plan === "hawk" || s.eats.includes("mice");
      A.task.push({ k: "fly", x: p[0], y: p[1], z, msg: hunter ? `${s.name} swoops down on a mouse` : `${s.name} flies down to look for food` });
      const what = hunter ? "a mouse it caught" : bath ? "a drink and a bath at the bird bath" : s.eats.includes("worms") ? "worms from the lawn" : f && NUT.has(f.k) ? (f.k === "oak" ? "acorns" : "seeds") + " under the " + (PNAME[f.k] || f.k) : f && SEEDS.has(f.k) ? "seeds from the " + (PNAME[f.k] || f.k) : "seeds on the ground";
      A.task.push({ k: "wait", t: rnd(3, 7), pose: "peck", msg: `${s.name} is eating ${what}` });
      st.stats.ate++;
      return;
    }
    if (act === "fly" || act === "soar" || !A.perched) {
      // a perch: a tree top, the roof's ridge, a shrub or the ground
      const opts = [];
      if (W.trees.length) opts.push(() => { const t = pick(W.trees), a = rnd(0, 6.28), d = t.h * rnd(0.05, 0.18); return [t.x + Math.cos(a) * d, t.y + Math.sin(a) * d, t.z + t.h * rnd(0.82, 0.96), `${s.name} is perched in the ${PNAME[t.k] || t.k}`]; });
      if (W.inHouse.length && W.top) opts.push(() => { const [x, y] = jit(pick(W.inHouse)), z = W.top(x, y); return z === null || z === undefined ? null : [x, y, z, `${s.name} is perched on the roof`]; });
      const bushes = W.plants.filter((p) => BROWSE.has(p.k) && p.h > 600);
      if (bushes.length && s.plan !== "hawk") opts.push(() => { const b = pick(bushes); return [b.x, b.y, b.z + b.h * 0.95, `${s.name} is sitting on the ${PNAME[b.k] || b.k}`]; });
      opts.push(() => { const q = pick(W.land); if (q === undefined) return null; const [x, y] = jit(q); return houseAt(x, y) ? null : [x, y, ground(x, y), `${s.name} is hopping on the ground`]; });
      let p = null; for (let k = 0; k < 6 && !p; k++) p = pick(opts)();
      if (p) { A.task.push({ k: "fly", x: p[0], y: p[1], z: p[2], msg: `${s.name} is flying` }); A.task.push({ k: "wait", t: rnd(3, 8), pose: "idle", msg: p[3] }); A.perchMsg = p[3]; st.stats.flew++; return; }
    }
    A.task.push({ k: "wait", t: rnd(2, 5), pose: "idle", msg: A.perchMsg || `${s.name} is sitting and looking around` });
  }
  // how it holds itself: a meerkat sits up when it stops, a kangaroo always leans up
  const rest = (A, moving) => (A.s.stand && (A.s.standAlways || !moving) ? A.s.stand : 0);
  // ------------------------------------------------ moving, a little each frame
  function stepOne(A, dt) {
    const s = A.s;
    if (!A.task.length) plan(A);
    const T = A.task[0];
    if (!T) return;
    if (T.msg && !T.said) { say(A, T.msg); T.said = 1; }
    A.mv = 0; A.pose = "idle"; A.flying = false;
    const turn = (a, k = 8) => { A.hd += angDiff(A.hd, a) * Math.min(1, dt * k); };
    if (T.k === "go") {
      const dx = T.x - A.x, dy = T.y - A.y, d = Math.hypot(dx, dy);
      if (T.mode !== "air") turn(Math.atan2(dy, dx), T.mode === "fish" ? 3 : 8);
      const v = T.sp * dt;
      if (d <= v + 1) { A.x = T.x; A.y = T.y; A.task.shift(); }
      else { A.x += (dx / d) * v; A.y += (dy / d) * v; }
      A.mv = T.sp;
      if (T.mode === "roof") A.z = posZ(A, "roof");
      else if (T.mode === "air") { /* stays at the edge of the roof, then climbs down */ }
      else if (T.mode === "fish") { A.z += ((T.z ?? A.z) - A.z) * Math.min(1, dt * 1.5); A.pitch = 0; }
      else if (T.mode === "hop") { A.ph2 = (A.ph2 || 0) + dt * 3.5; A.z = posZ(A, "ground") + Math.abs(Math.sin(A.ph2 * Math.PI)) * s.len * 0.5; }
      else A.z = posZ(A, "ground");
      if (T.mode !== "climb") A.pitch += (rest(A, true) - A.pitch) * Math.min(1, dt * 6);
    } else if (T.k === "face") {
      const a = Math.atan2(T.y - A.y, T.x - A.x);
      turn(a, 10);
      if (Math.abs(angDiff(A.hd, a)) < 0.08) A.task.shift();
    } else if (T.k === "climb") {
      const gz = ground(A.x, A.y), target = T.z === null ? gz : T.z, dz = target - A.z, v = T.sp * dt;
      const up = dz > 0;
      A.pitch += ((up ? -1.35 : 1.35) - A.pitch) * Math.min(1, dt * 8);
      if (Math.abs(dz) <= v) { A.z = target; A.task.shift(); if (T.z === null) A.pitch = 0; } else A.z += Math.sign(dz) * v;
      A.mv = T.sp; A.climbing = true;
    } else if (T.k === "perch") {
      A.z += (T.z - A.z) * Math.min(1, dt * 6);
      T.t -= dt; A.pose = "idle";
      if (T.t <= 0) { A.task.shift(); A.task.unshift({ k: "climb", z: null, sp: 600 }); }
    } else if (T.k === "wait") {
      T.t -= dt; A.pose = T.pose;
      if (T.face) turn(Math.atan2(T.face[1] - A.y, T.face[0] - A.x), 6);
      if (T.pose !== "cling" && T.pose !== "peck") A.pitch += ((T.pose === "eat" ? 0 : rest(A, false)) - A.pitch) * Math.min(1, dt * 6);
      if (T.pose === "hover" && A.P.wings && A.P.wings.length) A.flying = true;
      if (T.cling || T.pose === "cling") A.pitch += (-1.35 - A.pitch) * Math.min(1, dt * 6);
      // the plant it's eating shakes a little
      if (T.plant !== null && T.plant !== undefined && W.plantGroup) { const o = W.plantGroup.children[T.plant]; if (o) { const p = W.plants[T.plant], k = 1 + 0.035 * Math.sin(st.t * 18); o.scale.set((p.s || 1) * k, (p.s || 1) * (2 - k), p.s || 1); A.wob = o; } }
      if (T.t <= 0) { if (A.wob) { const p = W.plants[T.plant]; if (p) A.wob.scale.setScalar(p.s || 1); A.wob = null; } A.task.shift(); }
      if (s.fish && T.pose === "hover") A.z += Math.sin(st.t * 2 + A.ph) * 5 * dt;
    } else if (T.k === "rise") {
      // a fish comes up to the surface, snaps a bug and goes back down
      const w = waterAt(A.x, A.y) ?? A.z;
      if (!T.ph) { T.ph = 1; T.z0 = A.z; }
      if (T.ph === 1) { A.z += (w - 15 - A.z) * Math.min(1, dt * 4); A.pitch = -0.5; if (Math.abs(w - 15 - A.z) < 10) { T.ph = 2; T.t = 0.5; st.stats.ate++; } }
      else if (T.ph === 2) { T.t -= dt; if (T.t <= 0) T.ph = 3; }
      else { A.z += (T.z0 - A.z) * Math.min(1, dt * 2); A.pitch *= 0.9; if (Math.abs(T.z0 - A.z) < 10) { A.pitch = 0; A.task.shift(); } }
      A.mv = s.sp * 0.4;
    } else if (T.k === "fly") {
      if (!T.f) { T.f = { x0: A.x, y0: A.y, z0: A.z, d: Math.hypot(T.x - A.x, T.y - A.y), k: 0 }; T.f.hz = Math.max(800, Math.min(4000, T.f.d * 0.3)) + Math.max(0, T.z - A.z) * 0.2; }
      const F = T.f, dur = Math.max(0.8, Math.hypot(F.d, T.z - F.z0) / s.sp);
      F.k = Math.min(1, F.k + dt / dur);
      const k = F.k, e = k * k * (3 - 2 * k);
      A.x = F.x0 + (T.x - F.x0) * e; A.y = F.y0 + (T.y - F.y0) * e; A.z = F.z0 + (T.z - F.z0) * e + Math.sin(Math.PI * k) * F.hz;
      if (F.d > 10) turn(Math.atan2(T.y - F.y0, T.x - F.x0), 10);
      A.flying = k < 0.97; A.mv = s.sp;
      A.pitch = 0;
      if (k >= 1) { A.task.shift(); A.perched = true; }
    } else if (T.k === "soar") {
      if (!T.c) { const q = pick(W.land) ?? 0, [cx, cy] = cellXY(q); const lim = Math.max(1500, Math.min(cx - W.L.x0, cy - W.L.y0, W.L.x0 + (W.L.nx - 1) * W.L.res - cx, W.L.y0 + (W.L.ny - 1) * W.L.res - cy)); T.c = { cx, cy, r: Math.min(lim, rnd(4000, 9000)), a: Math.atan2(A.y - cy, A.x - cx), z: Math.max(A.z, ground(cx, cy) + rnd(15000, 25000)), z0: A.z }; }
      const C = T.c; T.t -= dt;
      C.a += (s.sp * 0.5 * dt) / C.r;
      const tx = C.cx + Math.cos(C.a) * C.r, ty = C.cy + Math.sin(C.a) * C.r;
      A.x += (tx - A.x) * Math.min(1, dt * 1.5); A.y += (ty - A.y) * Math.min(1, dt * 1.5); A.z += (C.z - A.z) * Math.min(1, dt * 0.6);
      turn(C.a + Math.PI / 2, 4);
      A.flying = true; A.glide = true; A.mv = s.sp;
      if (T.t <= 0) { A.task.shift(); A.perched = false; }
    }
    if (T.k !== "climb") A.climbing = false;
  }
  // predators and the animals that run from them
  function threats() {
    for (const A of list) {
      if (!A.s.prey || A.none || A.fleeing > st.t) continue;
      const busyUp = A.task[0] && (A.task[0].k === "climb" || A.task[0].mode === "roof" || A.task[0].k === "fly" || A.task[0].mode === "air");
      if (busyUp || A.z - ground(A.x, A.y) > 200) continue;
      for (const B of list) {
        if (B === A || B.none || !A.s.prey.includes(B.id)) continue;
        const d = Math.hypot(B.x - A.x, B.y - A.y), near = B.id === "hawk" ? B.z - ground(B.x, B.y) < 3000 && d < 3000 : d < (A.s.wary || (A.id === "deer" ? 6000 : 2500));
        if (!near) continue;
        A.fleeing = st.t + 6; st.stats.fled++;
        // squirrels and chipmunks run up a tree; birds fly off; the rest run away
        A.task = [];
        if (A.s.wader) { planWader(A, "fly"); A.task[0].msg = `${A.s.name} flies away from the ${tag(B.s)}`; return; }
        if (A.s.plan === "bird" && !A.s.walker) { planBird(A, "fly"); say(A, `${A.s.name} flies away from the ${tag(B.s)}`); A.task[0].msg = A.msg; return; }
        if (A.s.climbs && A.s.climbs.includes("tree") && W.trees.length && planTree(A, true)) { A.task[0].msg = `${A.s.name} runs up a tree away from the ${tag(B.s)}`; return; }
        const a = Math.atan2(A.y - B.y, A.x - B.x);
        for (let k = 0; k < 8; k++) {
          const aa = a + rnd(-0.8, 0.8), dd = rnd(3000, 7000), x = A.x + Math.cos(aa) * dd, y = A.y + Math.sin(aa) * dd;
          if (cellOf(x, y) >= 0 && !houseAt(x, y) && clear(A, x, y)) { A.task.push({ k: "go", x, y, sp: A.s.run || A.s.sp * 3, mode: A.s.plan === "hop" ? "hop" : "ground", msg: `${A.s.name} runs away from the ${tag(B.s)}` }); break; }
        }
        // the hunter gives chase for a moment
        if (B.s.hunts && B.s.hunts.includes(A.id) && B.task[0] && B.task[0].k !== "go" && !B.none) { B.task = [{ k: "go", x: A.x, y: A.y, sp: B.s.run * 0.8, mode: "ground", msg: `${B.s.name} chases the ${tag(A.s)}` }]; }
        break;
      }
    }
  }
  // dogs and foxes go after the animals they hunt now and then
  function hunters() {
    for (const B of list) {
      if (!B.s.hunts || B.none || B.task.length > 1 || Math.random() > 0.02) continue;
      const prey = list.filter((A) => B.s.hunts.includes(A.id) && !A.none && A.z - ground(A.x, A.y) < 200 && Math.hypot(A.x - B.x, A.y - B.y) < 9000);
      if (!prey.length) continue;
      const A = pick(prey);
      if (clear(B, A.x, A.y)) B.task = [{ k: "go", x: A.x, y: A.y, sp: B.s.sp * 2, mode: "ground", msg: `${B.s.name} is sneaking up on the ${tag(A.s)}` }];
    }
  }
  // how it looks this frame: legs walk, wings flap, the head goes down to eat
  function pose(A, dt) {
    const P = A.P, s = A.s, sc = st.size;
    P.root.position.set(A.x, A.y, A.z + (s.fish ? 0 : 0));
    P.root.rotation.z = A.hd;
    P.root.scale.setScalar(sc);
    P.body.rotation.y = A.pitch;
    // a climber hangs on the outside of the trunk or wall: lift its body so its feet are on it
    P.body.position.z = A.climbing || Math.abs(A.pitch) > 0.6 ? (s.r || s.len * 0.2) * 0.5 : 0;
    A.ph += dt * (A.mv ? Math.min(14, 4 + A.mv / Math.max(60, s.len) * 2.5) : 0);
    const sw = A.mv ? 0.55 : 0;
    if ((s.plan === "bird" || s.plan === "penguin") && (s.walker || s.wader || s.plan === "penguin") && !A.flying) P.legs.forEach((l, i) => { l.rotation.y = (A.mv ? 0.5 : 0) * Math.sin(A.ph + i * Math.PI); });
    if (s.plan === "quad" || s.plan === "hop" || s.plan === "turtle" || s.plan === "low") P.legs.forEach((l, i) => { l.rotation.y = sw * Math.sin(A.ph + (i === 0 || i === 3 ? 0 : Math.PI)) * (s.plan === "hop" ? 0.4 : 1); });
    if (P.wings && P.wings.length) {
      const flap = A.flying ? (A.glide ? 0.15 * Math.sin(st.t * 2) : 0.9 * Math.sin(st.t * (s.plan === "hawk" ? 7 : 22))) : 0;
      for (const w of P.wings) w.rotation.x = w.userData.side * (A.flying ? flap + 0.1 : -0.15);
      for (const l of P.legs) l.visible = !A.flying;
      P.body.rotation.y = A.flying ? -0.1 : A.pose === "peck" && !A.task[0]?.cling ? 0.35 + 0.25 * Math.sin(st.t * 14) : A.pitch;
    }
    if (P.head) {
      const eat = A.pose === "eat" || A.pose === "dabble";
      P.head.rotation.y = eat ? 0.75 + 0.15 * Math.sin(st.t * 9) : A.pose === "peck" ? 0.3 * Math.sin(st.t * 16) : 0;
      P.head.rotation.z = !A.mv && !eat ? 0.5 * Math.sin(st.t * 0.7 + A.ph) : 0;
      if (A.pose === "dabble") P.body.rotation.y = 1.2 + 0.1 * Math.sin(st.t * 3);
    }
    if (P.tail) { const k = s.fish ? 0.45 : 0.2; P.tail.rotation.z = Math.sin(st.t * (s.fish ? 6 + A.mv / 100 : 3) + A.ph) * k * (s.fish || A.mv ? 1 : 0.5); }
    if (s.plan === "frog" && P.legs.length) for (const l of P.legs) l.rotation.y = A.mv ? -0.6 * Math.abs(Math.sin(A.ph)) : 0;
    if (A.pose === "loaf") P.body.position.z = -(s.leg || 0) * 0.7;
    if (s.plan === "penguin") { const inW = waterAt(A.x, A.y) !== null; P.body.rotation.y = inW ? 1.3 : 0; P.body.rotation.x = !inW && A.mv ? 0.12 * Math.sin(A.ph) : 0; }
  }
  function step(dt) {
    if (!W) return;
    st.t += dt;
    threatT -= dt;
    if (threatT <= 0) { threatT = 0.3; threats(); hunters(); }
    for (const A of list) { if (A.none) continue; stepOne(A, dt); pose(A, dt); }
    statusT -= dt;
    if (statusT <= 0) { statusT = 0.7; st.log = list.filter((A) => !A.none && A.msg).map((A) => A.msg); onStatus && onStatus(st.log); }
  }
  function frame(now) {
    raf = 0;
    if (!running()) return;
    if (last && now - last < 30) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.06, last ? (now - last) / 1000 : 0.016); last = now;
    step(dt);
    vp.request();
    raf = requestAnimationFrame(frame);
  }
  const visibleUp = () => { for (let o = g; o; o = o.parent) if (o.visible === false) return false; return true; };
  const running = () => st.on && list.length && W && visibleUp() && !document.hidden;
  function kick() { if (!raf && running()) { last = 0; raf = requestAnimationFrame(frame); } }
  return {
    state: st,
    get list() { return list; },
    // how many of each: { cat: 1, deer: 2, ... }
    setCounts(counts) {
      const want = counts || {};
      for (const A of [...list]) {
        const n = list.filter((B) => B.id === A.id).length;
        if (n > (want[A.id] || 0)) { g.remove(A.P.root); list.splice(list.indexOf(A), 1); }
      }
      for (const id in want) { if (!SPEC.has(id)) continue; let n = list.filter((B) => B.id === id).length; while (n < Math.min(12, want[id])) { list.push(make(id)); n++; } }
      for (const A of list) pose(A, 0);
      vp.request(); kick();
    },
    attach(o) { setWorld(o); for (const A of list) pose(A, 0); kick(); },
    set(o) { Object.assign(st, o); for (const A of list) pose(A, 0); vp.request(); kick(); },
    onStatus(f) { onStatus = f; },
    step, kick,
    show() { kick(); },
    hasWater: () => !!(W && W.water.length),
  };
}
