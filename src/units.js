// Display units for the whole app: millimetres or inches. The model itself always stays
// in millimetres; this only changes what people see and type.
import { fmt, parseLength } from "./util.js";

let unit = (() => { try { return localStorage.getItem("js3d-skunit") === "in" ? "in" : "mm"; } catch (e) { return "mm"; } })();
const subs = new Set();

export const getUnit = () => unit;
export function setUnit(u) {
  u = u === "in" ? "in" : "mm";
  if (u === unit) return;
  unit = u;
  try { localStorage.setItem("js3d-skunit", unit); } catch (e) {}
  for (const f of subs) { try { f(unit); } catch (e) { console.error(e); } }
}
export const onUnit = (f) => { subs.add(f); return () => subs.delete(f); };
export const isInch = () => unit === "in";
// mm -> number in the current unit, and back
export const toU = (mm) => (unit === "in" ? mm / 25.4 : mm);
export const fromU = (v) => (unit === "in" ? v * 25.4 : v);
// "12.5" in mm, "0.492" in inches (one more decimal for inches)
export const showLen = (mm, dp = 2) => fmt(toU(mm), unit === "in" ? dp + 1 : dp);
export const withUnit = (mm, dp = 2) => showLen(mm, dp) + (unit === "in" ? " in" : " mm");
// typed text -> mm; a bare number is read in the current unit, "25mm" / "1in" still work
export const parseLen = (s) => parseLength(s, unit);
export const unitName = () => (unit === "in" ? "in · inches" : "mm · millimetres");

// snap / grid sizes offered for each unit (values in mm)
export const SNAP_SIZES = {
  mm: [[0.1, "0.1 mm"], [0.25, "0.25 mm"], [0.5, "0.5 mm"], [1, "1 mm"], [2, "2 mm"], [5, "5 mm"], [10, "10 mm"]],
  in: [[25.4 / 64, "1/64 in"], [25.4 / 32, "1/32 in"], [25.4 / 16, "1/16 in"], [25.4 / 8, "1/8 in"], [25.4 / 4, "1/4 in"], [25.4 / 2, "1/2 in"], [25.4, "1 in"]],
};
