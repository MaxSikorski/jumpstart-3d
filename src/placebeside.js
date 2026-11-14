// Find a spot beside existing bodies when the default spot overlaps one.
export function besideSpot(size, at, boxes, plate, gap = 5) {
  const [w, d, h] = size, [x, y] = at;
  const overlaps = boxes.some((b) => x + w / 2 > b.min[0] + 0.01 && x - w / 2 < b.max[0] - 0.01 && y + d / 2 > b.min[1] + 0.01 && y - d / 2 < b.max[1] - 0.01 && h > b.min[2] + 0.01 && 0 < b.max[2] - 0.01);
  if (!overlaps) return null;
  let nx = Math.max(...boxes.map((b) => b.max[0])) + gap + w / 2, ny = 0;
  if (plate) {
    nx = Math.max(-plate.w / 2 + w / 2, Math.min(plate.w / 2 - w / 2, nx));
    ny = Math.max(-plate.d / 2 + d / 2, Math.min(plate.d / 2 - d / 2, ny));
  }
  return [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000];
}
