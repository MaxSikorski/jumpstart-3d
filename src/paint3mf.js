// jumpstart-3d: pre-painted 3MF (our addition; not in the author's source).
// The 3D Print Sim lets a body, or single faces of it, print in a chosen filament. This module keeps that in
// the design (doc.printPaint, so it is saved and survives a reload) and turns it into the per-triangle paint
// the slicers read: Orca, Snapmaker Orca and Prusa read `slic3rpe:mmu_segmentation`, Bambu Studio reads
// `paint_color`; both take the same string.
//
// doc.printPaint = { slots: ["#rrggbb", ...], of: { bodyId: slot }, faces: { bodyId: { n: faceCount, f: { face: slot } } } }
// Slots count from 0 (F1). `n` is the body's face count when it was painted: if the body has since been
// edited into another number of faces, the face indexes mean nothing and its face paint is skipped.

export const PAINT_NS = "http://schemas.slic3r.org/3mf/2017/06";
export const MAX_SLOTS = 15; // the encoding below holds filament numbers 1 to 15

// The text a slicer wants for one whole triangle in filament slot s. Filament 1 is "4", 2 is "8"; from 3 up the
// state is "C" (3) plus one more hex digit for the rest, and the string is stored back to front: 3 is "0C",
// 4 is "1C", 5 is "2C" ... 15 is "CC". Null for a slot outside 1 to 15.
export function paintCode(slot) {
  const n = slot + 1;
  if (!Number.isInteger(slot) || n < 1 || n > MAX_SLOTS) return null;
  return n < 3 ? (n * 4).toString(16).toUpperCase() : (n - 3).toString(16).toUpperCase() + "C";
}

// For the sim's state: what to store in the design, or null when fewer than two filaments are in use
// (one filament needs no paint). `faceCount(id)` is the number of faces of the body's built shape.
export function packPaint(st, bodyIds, faceCount) {
  const of = {}, faces = {}, used = new Set(), n = st.faceN || (st.faceN = new Map()); // n: counted once, when the body is first painted (a later edit must not refresh it)
  for (const id of bodyIds) {
    if (!st.slotOf.has(id)) continue;
    of[id] = st.slotOf.get(id);
    used.add(of[id]);
    const m = st.paint.get(id);
    if (!m || !m.size) n.delete(id);
    else {
      if (!n.has(id)) n.set(id, faceCount(id));
      faces[id] = { n: n.get(id), f: Object.fromEntries(m) };
      for (const s of m.values()) used.add(s);
    }
  }
  if (used.size < 2) return null;
  return { slots: st.slots.map((q) => q.color), of, faces };
}

const validPaint = (pp) => !!pp && Array.isArray(pp.slots) && !!pp.of && typeof pp.of === "object"
  && Object.values(pp.faces || {}).every((e) => e && typeof e.f === "object" && e.f);

// The other way: fill the sim's state from the design (or empty it when the design has none).
export function unpackPaint(pp, st) {
  if (!validPaint(pp)) pp = null; // a hand-edited or damaged file must not break the sim
  st.slots = pp ? pp.slots.map((color) => ({ color })) : [];
  st.slotOf = new Map(pp ? Object.entries(pp.of) : []);
  st.faceN = new Map(pp ? Object.entries(pp.faces || {}).map(([id, e]) => [id, e.n]) : []);
  st.paint = new Map(pp ? Object.entries(pp.faces || {}).map(([id, e]) => [id, new Map(Object.entries(e.f).map(([f, s]) => [+f, s]))]) : []);
}

// The paint code of every triangle of one built body (index = triangle number), or null when none of its
// triangles needs one. Filament 1 is what a slicer uses for an object without paint, so it gets no attribute.
export function triangleCodes(pp, id, data) {
  if (!validPaint(pp)) return null;
  const groups = data.faceGroups || [], T = data.triangles.length / 3, slot = new Array(T).fill(pp.of[id] ?? 0);
  const fp = pp.faces && pp.faces[id];
  if (fp && fp.n === groups.length) {
    groups.forEach(([start, count], f) => {
      const s = fp.f[f];
      if (s != null) for (let t = start / 3; t < (start + count) / 3; t++) slot[t] = s;
    });
  }
  const codes = slot.map((s) => (s === 0 ? null : paintCode(s)));
  return codes.some(Boolean) ? codes : null;
}

export const paintAttrs = (code) => ` slic3rpe:mmu_segmentation="${code}" paint_color="${code}"`;
