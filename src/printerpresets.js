// Printer catalog and the saved "Printer plate" choice (our addition).
// One list of printers, shared by the 3D Print Sim and the design plate (Printer plate… in the Settings menu).
// The rows below are the sim's own data, moved here unchanged; printsim.js imports and re-exports them.
//
// Evidence labels (bed sizes). A size is "vendor-verified" only when the maker's own page or guide gave this
// build volume for exactly this model on the date shown. Everything else stays "unverified": the number is the
// one the sim has always used, and nobody has checked it yet. Verifying a bed size does not verify the rest of a
// row (tool-change times, filament systems), and no size here has been tried on a physical printer.
// No browser or DOM code in this file, so Node can test it.

// Printers and how they handle more than one filament (like Orca Slicer's printer profiles):
//   tools.kind  "single"  one nozzle, one filament (swap by hand)
//               "mmu"     one nozzle fed by a spool switcher (AMS, CFS, Canvas, IFS, MMU3):
//                         every change unloads, loads and purges ("flushes") the old color
//               "heads"   independent toolheads / nozzles (tool changers, dual nozzle, Vortek):
//                         each filament keeps its own nozzle, so a change is a quick swap with
//                         only a small prime; more filaments than heads share a head (and flush)
//   heads: nozzles that can hold different filaments, slots: most filaments at once,
//   swap: seconds per head change, load: seconds to unload + load a spool (purge time is added),
//   prime: mm³ primed after a head swap, wSingle / wDual: printable width with one / both
//   nozzles (dual-nozzle printers), sys: what it's called.
export const PRINTERS = {
  // Bambu Lab
  a1mini: { brand: "Bambu Lab", name: "Bambu Lab A1 mini", w: 180, d: 180, h: 180, tools: { kind: "mmu", heads: 1, slots: 4, load: 30, sys: "AMS lite" } },
  a1: { brand: "Bambu Lab", name: "Bambu Lab A1", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 4, load: 30, sys: "AMS lite" } },
  a2l: { brand: "Bambu Lab", name: "Bambu Lab A2L", w: 330, d: 320, h: 325, tools: { kind: "mmu", heads: 1, slots: 19, load: 30, sys: "AMS lite + AMS units" } },
  p1s: { brand: "Bambu Lab", name: "Bambu Lab P1S / P1P", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 16, load: 25, sys: "AMS" } },
  p2s: { brand: "Bambu Lab", name: "Bambu Lab P2S", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 16, load: 22, sys: "AMS 2 Pro" } },
  x1: { brand: "Bambu Lab", name: "Bambu Lab X1 Carbon / X1E", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 16, load: 25, sys: "AMS" } },
  x2d: { brand: "Bambu Lab", name: "Bambu Lab X2D (dual nozzle)", w: 256, d: 256, h: 260, tools: { kind: "heads", heads: 2, slots: 16, swap: 12, prime: 30, load: 25, lr: true, sys: "dual nozzle + AMS" } },
  h2s: { brand: "Bambu Lab", name: "Bambu Lab H2S", w: 340, d: 320, h: 340, tools: { kind: "mmu", heads: 1, slots: 24, load: 25, sys: "AMS 2 Pro / AMS HT" } },
  h2d: { brand: "Bambu Lab", name: "Bambu Lab H2D / H2D Pro (dual nozzle)", w: 350, d: 320, h: 325, tools: { kind: "heads", heads: 2, slots: 24, swap: 12, prime: 30, load: 25, lr: true, wSingle: 325, wDual: 300, sys: "dual nozzle + AMS" } },
  h2c: { brand: "Bambu Lab", name: "Bambu Lab H2C (Vortek, 7 hotends)", w: 350, d: 320, h: 325, tools: { kind: "heads", heads: 7, slots: 24, swap: 25, prime: 15, load: 25, wSingle: 325, wDual: 300, sys: "Vortek hotend swapping (1 left + 6 right) + AMS" } },
  // Creality
  ender3: { brand: "Creality", name: "Creality Ender-3", w: 220, d: 220, h: 250, tools: { kind: "single" } },
  k1: { brand: "Creality", name: "Creality K1 / K1C / K1 SE", w: 220, d: 220, h: 250, tools: { kind: "single" } },
  k1max: { brand: "Creality", name: "Creality K1 Max", w: 300, d: 300, h: 300, tools: { kind: "single" } },
  k2se: { brand: "Creality", name: "Creality K2 SE", w: 220, d: 215, h: 245, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  k2: { brand: "Creality", name: "Creality K2", w: 260, d: 260, h: 260, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  k2pro: { brand: "Creality", name: "Creality K2 Pro", w: 300, d: 300, h: 300, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  k2plus: { brand: "Creality", name: "Creality K2 Plus", w: 350, d: 350, h: 350, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  // Elegoo
  cc: { brand: "Elegoo", name: "Elegoo Centauri Carbon", w: 256, d: 256, h: 256, tools: { kind: "single" } },
  cc2: { brand: "Elegoo", name: "Elegoo Centauri Carbon 2", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 4, load: 45, sys: "CANVAS" } },
  // Flashforge
  ff5m: { brand: "Flashforge", name: "Flashforge Adventurer 5M / 5M Pro", w: 220, d: 220, h: 220, tools: { kind: "single" } },
  ffad5x: { brand: "Flashforge", name: "Flashforge AD5X", w: 220, d: 220, h: 220, tools: { kind: "mmu", heads: 1, slots: 4, load: 45, sys: "IFS" } },
  creator5: { brand: "Flashforge", name: "Flashforge Creator 5 (4 toolheads)", w: 256, d: 256, h: 256, tools: { kind: "heads", heads: 4, slots: 4, swap: 10, prime: 15, sys: "4-toolhead tool changer" } },
  creator5pro: { brand: "Flashforge", name: "Flashforge Creator 5 Pro (4 toolheads)", w: 256, d: 256, h: 256, tools: { kind: "heads", heads: 4, slots: 4, swap: 10, prime: 15, sys: "4-toolhead tool changer, heated chamber" } },
  // Prusa
  mini: { brand: "Prusa", name: "Prusa MINI+", w: 180, d: 180, h: 180, tools: { kind: "single" } },
  mk4: { brand: "Prusa", name: "Prusa MK4S (+ MMU3)", w: 250, d: 210, h: 220, tools: { kind: "mmu", heads: 1, slots: 5, load: 30, sys: "MMU3" } },
  core1: { brand: "Prusa", name: "Prusa CORE One (+ MMU3)", w: 250, d: 220, h: 270, tools: { kind: "mmu", heads: 1, slots: 5, load: 30, sys: "MMU3" } },
  core1l: { brand: "Prusa", name: "Prusa CORE One L", w: 300, d: 300, h: 330, tools: { kind: "single" } },
  core1lindx4: { brand: "Prusa", name: "Prusa CORE One L INDX (4 tools)", w: 298, d: 275, h: 330, tools: { kind: "heads", heads: 4, slots: 4, swap: 12, prime: 10, sys: "INDX tool changer" } },
  core1lindx8: { brand: "Prusa", name: "Prusa CORE One L INDX (8 tools)", w: 298, d: 275, h: 330, tools: { kind: "heads", heads: 8, slots: 8, swap: 12, prime: 10, sys: "INDX tool changer" } },
  xl1: { brand: "Prusa", name: "Prusa XL (1 toolhead)", w: 360, d: 360, h: 360, tools: { kind: "single" } },
  xl2: { brand: "Prusa", name: "Prusa XL (2 toolheads)", w: 360, d: 360, h: 360, tools: { kind: "heads", heads: 2, slots: 2, swap: 10, prime: 15, sys: "tool changer" } },
  xl5: { brand: "Prusa", name: "Prusa XL (5 toolheads)", w: 360, d: 360, h: 360, tools: { kind: "heads", heads: 5, slots: 5, swap: 10, prime: 15, sys: "tool changer" } },
  // Snapmaker
  u1: { brand: "Snapmaker", name: "Snapmaker U1 (4 toolheads)", w: 270, d: 270, h: 270, tools: { kind: "heads", heads: 4, slots: 4, swap: 5, prime: 15, sys: "SnapSwap tool changer" } },
  // Voron
  voron: { brand: "Voron", name: "Voron 2.4 350", w: 350, d: 350, h: 340, tools: { kind: "single" } },
};

const CHECKED = "2026-10-23";
// Reviewed rows only. `label` is the name the Printer plate dialog shows. These are manufacturer-stated build
// volumes in millimetres (not the size of the removable plate); `physicalTest` stays "unverified" for all of them.
const VERIFIED = {
  a1: { label: "Bambu Lab A1", models: ["A1"], urls: ["https://cdn1.bambulab.com/documentation/quick-start-a75adcb1d5d5e/Quick%20Start%20Guide%20for%20A1.pdf"] },
  x1: { label: "Bambu Lab X1 / X1 Carbon", models: ["X1", "X1 Carbon"], notVerified: ["X1E"], urls: ["https://cdn1.bambulab.com/documentation/quick-start-2024-01-17/Quick-Start-X1%26X1C_en.pdf"] },
  p1s: { label: "Bambu Lab P1P / P1S", models: ["P1P", "P1S"], urls: ["https://bambulab.com/en-us/p1p", "https://cdn1.bambulab.com/documentation/quick-start-2024-01-17/Quick-Start-P1S_en.pdf"] },
  mk4: { label: "Original Prusa MK4 / MK4S", models: ["MK4", "MK4S"], urls: ["https://blog.prusa3d.com/announcing-original-prusa-mk4_76585/", "https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer-7/"] },
  mini: { label: "Original Prusa MINI+", models: ["MINI+"], notVerified: ["original MINI"], urls: ["https://www.prusa3d.com/en/product/original-prusa-mini-kit-6/"] },
  ender3: { label: "Creality Ender-3 (original model)", models: ["Ender-3"], notVerified: ["other Ender variants"], urls: ["https://store.creality.com/ca/blogs/all/ender-series-3d-printers-parameter-comparison"] },
  u1: { label: "Snapmaker U1", models: ["U1"], urls: ["https://wiki.snapmaker.com/en/FAQ/u1"] },
};
for (const [k, p] of Object.entries(PRINTERS)) {
  const v = VERIFIED[k];
  p.dimensionEvidence = v
    ? { status: "vendor-verified", checked: CHECKED, urls: v.urls, models: v.models, notVerified: v.notVerified || [] }
    : { status: "unverified", checked: null, urls: [], models: [], notVerified: [] };
  p.physicalTest = "unverified";
  p.plateLabel = v ? v.label : p.name;
}
// The named choices in the Printer plate dialog, in the order shown. Snapmaker means the U1 only: the Artisan and
// 2.0 machines have different usable areas per nozzle setup and are not added until each is sourced.
export const PLATE_PRINTERS = ["a1", "x1", "p1s", "mk4", "mini", "ender3", "u1"];
export const GENERIC_PLATE = { w: 256, d: 256, h: null }; // the design plate before this feature (Beginner's 256 × 256 mat)

// What the plate preference means in millimetres: null for "No printer boundary", the old square for "generic".
export function plateDims(choice) {
  if (choice === "none") return null;
  if (choice === "generic" || !PRINTERS[choice]) return { ...GENERIC_PLATE };
  const P = PRINTERS[choice];
  return { w: P.w, d: P.d, h: P.h };
}

// ---- the saved choice: a viewing preference, not part of a design (no undo step, no share payload)
export const PLATE_KEY = "jumpstart.printerplate.v1";
export const ANGLE_MIN = 10, ANGLE_MAX = 80, ANGLE_DEFAULT = 45;
const DEFAULT_PREF = { v: 1, printer: "generic", shade: false, angle: ANGLE_DEFAULT };
let pref = null;
const listeners = new Set();
function clean(o) {
  const p = { ...DEFAULT_PREF };
  if (o && typeof o === "object") {
    if (o.printer === "generic" || o.printer === "none" || (typeof o.printer === "string" && Object.prototype.hasOwnProperty.call(PRINTERS, o.printer))) p.printer = o.printer;
    p.shade = o.shade === true;
    const a = Math.round(+o.angle);
    if (a >= ANGLE_MIN && a <= ANGLE_MAX) p.angle = a;
  }
  return p;
}
export function getPlatePref() {
  if (!pref) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(PLATE_KEY)); } catch (e) {}
    pref = clean(raw && raw.v === 1 ? raw : null);
  }
  return { ...pref };
}
export function setPlatePref(patch) {
  const next = clean({ ...getPlatePref(), ...patch });
  const changed = JSON.stringify(next) !== JSON.stringify(pref);
  pref = next;
  try { localStorage.setItem(PLATE_KEY, JSON.stringify(next)); } catch (e) {}
  if (changed) for (const f of listeners) f({ ...next });
}
export const onPlatePref = (f) => { listeners.add(f); return () => listeners.delete(f); };
