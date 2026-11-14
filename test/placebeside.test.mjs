import { test } from "node:test";
import assert from "node:assert/strict";
import { besideSpot } from "../src/placebeside.js";

const box = { min: [-10, -10, 0], max: [10, 10, 20] };
const size = [20, 20, 20], at = [0, 0];
test("free spot stays unchanged", () => assert.equal(besideSpot(size, at, [], null), null));
test("places a shape beside a box", () => assert.deepEqual(besideSpot(size, at, [box], null), [25, 0]));
test("uses the rightmost box", () => assert.deepEqual(besideSpot(size, at, [box, { min: [20, -10, 0], max: [40, 10, 20] }], null), [55, 0]));
test("clamps to the plate", () => assert.deepEqual(besideSpot(size, at, [box], { w: 60, d: 60 }), [20, 0]));
test("touching is not overlap", () => assert.equal(besideSpot(size, [20, 0], [box], null), null));
test("a floating box does not overlap", () => assert.equal(besideSpot(size, at, [{ min: [-10, -10, 50], max: [10, 10, 70] }], null), null));
