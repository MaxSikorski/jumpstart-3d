import { ShapeUtils, Vector2 } from "../../third_party/three/build/three.module.js";

// Make a counterclockwise rectangle.
function rectangle(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

// Measure the exact area enclosed by a polygon.
function polygonArea(points) {
  let twiceArea = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    twiceArea += point[0] * next[1] - next[0] * point[1];
  });
  return Math.abs(twiceArea) / 2;
}

// Build a closed STL, stitching raised boxes into the plate's top face.
export function buildLidStl({ plate: { w, d, t }, openings, boxes = [] }) {
  const outer = rectangle(-w / 2, -d / 2, w / 2, d / 2);
  const triangles = [];
  const footprints = boxes.map(box => rectangle(box.x0, box.y0, box.x1, box.y1));

  // Triangulate a flat face around its holes.
  function face(outline, holes, height, flip = false) {
    const boundary = outline.map(point => new Vector2(...point));
    const cutouts = holes.map(hole => hole.map(point => new Vector2(...point)));
    const points = [...boundary, ...cutouts.flat()];
    for (const indices of ShapeUtils.triangulateShape(boundary, cutouts)) {
      const triangle = indices.map(index => [points[index].x, points[index].y, height]);
      if (flip) triangle.reverse();
      triangles.push(triangle);
    }
  }

  // Close the vertical sides of a polygon between two heights.
  function walls(points, bottom, top, flip = false) {
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      const corners = [[...point, bottom], [...next, bottom], [...next, top], [...point, top]];
      for (const indices of [[0, 1, 2], [0, 2, 3]]) {
        const triangle = indices.map(index => corners[index]);
        if (flip) triangle.reverse();
        triangles.push(triangle);
      }
    });
  }

  face(outer, [...openings, ...footprints], t);
  face(outer, openings, 0, true);
  walls(outer, 0, t);
  openings.forEach(points => walls(points, 0, t, true));
  boxes.forEach((box, index) => {
    walls(footprints[index], t, t + box.h);
    face(footprints[index], [], t + box.h);
  });
  const output = Buffer.alloc(84 + 50 * triangles.length);
  output.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, triangleIndex) => {
    triangle.forEach((point, pointIndex) => {
      point.forEach((value, axis) => {
        output.writeFloatLE(Math.fround(value), 84 + 50 * triangleIndex + 12 + 12 * pointIndex + 4 * axis);
      });
    });
  });
  return output;
}

// Approximate a five-millimetre round hole with a 32-sided polygon.
function roundHole(x, y) {
  return Array.from({ length: 32 }, (_, index) => [
    x + 2.5 * Math.cos(index * Math.PI / 16),
    y + 2.5 * Math.sin(index * Math.PI / 16),
  ]);
}

// Make a 12 by 3 mm slot with 16 segments around each rounded end.
function slot(x, y) {
  const points = [];
  for (const side of [1, -1]) {
    for (let index = 0; index <= 16; index++) {
      const angle = -side * Math.PI / 2 + index * Math.PI / 16;
      points.push([x + side * 4.5 + 1.5 * Math.cos(angle), y + 1.5 * Math.sin(angle)]);
    }
  }
  return points;
}

// Provide the small lid shared by the Node and browser outcome tests.
export function miniLid() {
  const plate = { w: 60, d: 40, t: 3 };
  const clip = { x0: 26, y0: -4, x1: 28, y1: 4, h: 5 };
  const entries = [
    ["hole1", "round", [-20, 10], roundHole(-20, 10)],
    ["hole2", "round", [-9, 10], roundHole(-9, 10)],
    ["hole3", "round", [2, 10], roundHole(2, 10)],
    ["slot1", "slot", [-18, -8], slot(-18, -8)],
    ["slot2", "slot", [-1, -8], slot(-1, -8)],
    ["rect", "rect", [16, 8], rectangle(11, 5, 21, 11)],
  ];
  const polygons = entries.map(entry => entry[3].map(point => point.map(Math.fround)));
  const openings = entries.map(([name, kind, c], index) => ({ name, kind, c, area: polygonArea(polygons[index]) }));
  const volumeFilled = plate.w * plate.d * plate.t + (clip.x1 - clip.x0) * (clip.y1 - clip.y0) * clip.h;
  return {
    stl: buildLidStl({ plate, openings: polygons, boxes: [clip] }),
    plate,
    openings,
    clip,
    solidPoint: [12, -15],
    volumeFilled,
    volumeAsIs: volumeFilled - openings.reduce((sum, opening) => sum + opening.area * plate.t, 0),
  };
}
