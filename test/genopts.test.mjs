import { test } from "node:test";
import assert from "node:assert/strict";
import { boxOptions, gearSetOptions, pairMatrix, textureOptions, drawingOptions, at3 } from "../src/genopts.js";
import { BIN_DEFAULTS, binSet } from "../src/bins.js";
import { GEAR_DEFAULTS } from "../src/gearlib.js";
import { LIB } from "../src/texture.js";
const fails = (fn, arg, message) => assert.throws(() => fn(arg), { message });
test("Box Maker defaults and door print layout", () => {
  const b = boxOptions({}); assert.deepEqual(b, { o: BIN_DEFAULTS, at: [0, 0, 0], name: null });
  assert.equal(binSet(b.o).parts.length, 1);
  const door = boxOptions({ style: "door", units: 2, across: 2, layout: "print" });
  assert.equal(door.o.layout, "print"); assert.equal(binSet(door.o).parts.length, 8);
  assert.equal(boxOptions({ layout: "assembled", name: "  Case  " }).name, "Case");
  assert.equal(boxOptions({ layout: "assembled" }).o.layout, "");
});
test("Box Maker exact validation errors", () => {
  for (const [o, e] of [[{ w: 5 }, 'w must be a number from 10 to 1000 (mm)'], [{ style: "box" }, 'style must be "bin", "drawer", "tilt" or "door"'], [{ units: 1.5 }, 'units must be a whole number from 1 to 8'], [{ scoop: "yes" }, 'scoop must be true or false'], [{ style: "drawer", cols: 13 }, 'cols must be a whole number from 1 to 12']]) fails(boxOptions, o, e);
  assert.throws(() => boxOptions({ colour: 1 }), /^Error: unknown option "colour"; options: style, w, d, h/);
});
test("Gear library defaults, strict keys and bore limits", () => {
  const g = gearSetOptions({}); assert.equal(g.lib, true);
  assert.equal(g.o.type, "pair"); assert.equal(g.o.m, 2); assert.equal(g.o.z, 20); assert.equal(g.o.z2, 40); assert.equal(g.o.bore, "none");
  assert.deepEqual(Object.keys(g.o), Object.keys(GEAR_DEFAULTS));
  for (const [o, e] of [[{ type: "ring", teeth: 20, teeth2: 25 }, 'a ring gear needs at least 8 more teeth than its pinion (teeth2 at least teeth + 8)'], [{ type: "bevel", sunTeeth: 18 }, 'sunTeeth is not used for type "bevel"'], [{ module: 1, teeth: 12, teeth2: 40, bore: 10 }, 'bore must be 0 (none) or from 0.5 to 7.5 mm for these gears'], [{ pressureAngle: 22 }, 'pressureAngle must be 14.5, 20 or 25 (degrees)'], [{ type: "helical", teeth2: 40 }, 'teeth2 must be a whole number from 12 to 30 for a helical gear']]) fails(gearSetOptions, o, e);
  assert.equal(gearSetOptions({ type: "helical", hand: "left" }).spec2.hand, "right");
  assert.equal(gearSetOptions({ type: "helical" }).spec2.hand, "left");
});
test("Bevel pitch circles and cone tips meet; even gears show a gap", () => {
  const m = pairMatrix("bevel", 2, 20, 31, 20, [0, 0, 0]);
  assert.deepEqual(m, [0,0,1,0, 0,1,0,0, -1,0,0,0, 20,0,31,1]);
  const apply = (p) => [0,1,2].map((i) => m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]);
  assert.deepEqual(apply([-31, 0, 0]), [20, 0, 0]); assert.deepEqual(apply([0, 0, 20]), [0, 0, 31]);
  const even = pairMatrix("bevel", 2, 20, 30, 20, [0,0,0]);
  assert.deepEqual(even.slice(0,3), [0, Math.round(Math.sin(Math.PI/30)*1e6)/1e6, Math.round(Math.cos(Math.PI/30)*1e6)/1e6]);
  const helix = pairMatrix("helical", 2, 20, 20, 20, [5,0,0]);
  assert.ok(Math.abs(helix[12] - (5+2/Math.cos(20*Math.PI/180)*20)) < 1e-6);
  assert.ok(Math.abs(helix[1] - Math.sin(Math.PI/20)) < 1e-6);
});
test("Texture defaults, library tile sizes and selectors", () => {
  assert.deepEqual(textureOptions({}), { layer: { tex: "knurl", size: 4, depth: 0.6, dir: "raise", rot: 0, mapping: "auto", falloff: 0, invert: false, once: false }, faces: "all" });
  assert.equal(textureOptions({ texture: "oak" }).layer.size, 20);
  fails(textureOptions, { texture: "nope" }, `unknown texture "nope"; list_textures (JS3D.textures()) gives the ${LIB.length} keys`);
  for (const faces of [[], 1.5, {}, "", -1]) fails(textureOptions, { faces }, 'faces must be "all", a face selector such as "top", a face index or a list of indices');
  for (const faces of ["top", 0, [0, 3], ["top", 1]]) assert.deepEqual(textureOptions({ faces }).faces, faces);
});
test("Drawing defaults, canonical view order and exact errors", () => {
  assert.deepEqual(drawingOptions({}), { ids: undefined, views: ["top", "front", "right"], scale: 1, units: "mm", dims: false });
  assert.deepEqual(drawingOptions({ views: ["right", "top"] }).views, ["top", "right"]);
  for (const views of [[], ["side"], ["top", "top"]]) fails(drawingOptions, { views }, 'views must be a list of "top", "front" and "right"');
  fails(drawingOptions, { scale: 0 }, 'scale must be a number from 0.01 to 100 (1 is full size)');
});
test("Positions are copied and reject non-finite coordinates", () => {
  const a = [1,2,3]; assert.deepEqual(at3(a), a); assert.notEqual(at3(a), a);
  assert.deepEqual(at3(null), [0,0,0]);
  for (const v of [[1,2], [1,2,Infinity], "1,2,3"]) fails(at3, v, 'at must be [x, y, z] in mm');
});
