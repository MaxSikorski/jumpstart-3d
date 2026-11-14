// A short, safe representation for an error message.
export function show(value) {
  try {
    if (value === undefined) return "undefined";
    if (typeof value === "function") return "function";
    if (typeof value === "bigint") return "bigint";
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    const s = JSON.stringify(value);
    if (typeof s !== "string") return typeof value;
    return s.length > 60 ? s.slice(0, 59) + "…" : s;
  } catch { return typeof value; }
}
