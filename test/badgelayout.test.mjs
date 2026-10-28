// Where constraint badges go on screen (src/badgelayout.js, jumpstart-3d: badge layout, browser test F10), in Node with no browser.
import test from "node:test";
import assert from "node:assert/strict";
import { layoutBadges } from "../src/badgelayout.js";

const rects = (groups, pos) => groups.flatMap((g, i) => g.sizes.map(([w, h], j) => [pos[i][j][0], pos[i][j][1], pos[i][j][0] + w, pos[i][j][1] + h]));
const overlap = (a, b) => [Math.min(a[2], b[2]) - Math.max(a[0], b[0]), Math.min(a[3], b[3]) - Math.max(a[1], b[1])];

test("a lone badge on a horizontal line sits centred above its anchor, 8 px clear", () => {
  const [[p]] = layoutBadges([{ x: 100, y: 200, nx: 0, ny: -1, sizes: [[18, 18]] }], []);
  assert.deepEqual(p, [91, 174]); // box 91..109 x 174..192: bottom edge 8 px above the line
});

test("a crowded line plus singles with anchors within 6 px: no two badges overlap", () => {
  const groups = [{ x: 300, y: 300, nx: 0, ny: -1, sizes: Array(6).fill([18, 18]) }];
  for (let i = 0; i < 5; i++) groups.push({ x: 300 + i * 1.2, y: 300 + (i % 2) * 2, nx: i % 2 ? 0.7071 : -0.7071, ny: -0.7071, sizes: [[18, 18]] });
  const r = rects(groups, layoutBadges(groups, []));
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const [ox, oy] = overlap(r[i], r[j]); assert.ok(!(ox > 0.5 && oy > 0.5), `badges ${i} and ${j} overlap by ${ox} x ${oy}`); }
});

test("a badge whose preferred spot covers an obstacle moves off it", () => {
  const groups = [{ x: 100, y: 200, nx: 0, ny: -1, sizes: [[18, 18]] }], wall = [[80, 160, 120, 195]];
  const [b] = rects(groups, layoutBadges(groups, wall));
  const [ox, oy] = overlap(b, wall[0]);
  assert.ok(!(ox > 0.5 && oy > 0.5));
});

test("same input, same output; the inputs are not changed", () => {
  const groups = [{ x: 100, y: 200, nx: 0, ny: -1, sizes: [[18, 18], [20, 18]] }, { x: 104, y: 200, nx: 0.6, ny: -0.8, sizes: [[18, 18]] }];
  const obstacles = [[90, 160, 130, 190]];
  const before = JSON.stringify([groups, obstacles]);
  const a = layoutBadges(groups, obstacles), b = layoutBadges(groups, obstacles);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify([groups, obstacles]), before);
});

test("no free spot anywhere: still returns a spot for every badge and does not throw", () => {
  const groups = [{ x: 100, y: 200, nx: 0, ny: -1, sizes: [[18, 18], [18, 18]] }], wall = [[-1000, -1000, 1000, 1000]];
  const [[a, b]] = layoutBadges(groups, wall);
  assert.ok(a.every(Number.isFinite) && b.every(Number.isFinite));
});

test("far-away obstacles do not change where a badge goes", () => {
  const groups = [{ x: 100, y: 200, nx: 0, ny: -1, sizes: [[18, 18]] }];
  assert.deepEqual(layoutBadges(groups, [[5000, 5000, 5100, 5100]]), layoutBadges(groups, []));
});
