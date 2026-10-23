// Evidence labels for the printer list, and the saved "Printer plate" choice (our addition).
// The printer rows themselves stay in printsim.js exactly as J.Siwek wrote them (so upstream edits to that table still
// merge); printsim.js hands them to registerPrinters() right after the table, which adds the labels below to each row.
//
// Evidence labels (bed sizes). A size is "vendor-verified" only when the maker's own page or guide gave this
// build volume for exactly this model on the date shown. Everything else stays "unverified": the number is the
// one the sim has always used, and nobody has checked it yet. Verifying a bed size does not verify the rest of a
// row (tool-change times, filament systems), and no size here has been tried on a physical printer.
// No browser or DOM code in this file, so Node can test it (tests load the rows through test/printsim-rows.mjs).

// The rows: the same object printsim.js exports. Empty until printsim.js has run its registerPrinters() call, which is
// before anything here is used (app.js loads printsim.js first).
export let PRINTERS = {};

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
export function registerPrinters(rows) {
  PRINTERS = rows;
  for (const [k, p] of Object.entries(rows)) {
    const v = VERIFIED[k];
    p.dimensionEvidence = v
      ? { status: "vendor-verified", checked: CHECKED, urls: v.urls, models: v.models, notVerified: v.notVerified || [] }
      : { status: "unverified", checked: null, urls: [], models: [], notVerified: [] };
    p.physicalTest = "unverified";
    p.plateLabel = v ? v.label : p.name;
  }
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
