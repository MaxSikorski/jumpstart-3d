// jumpstart-3d: what counts as a near-empty solid left over by a cut (used by the kernel and by combinesplit.js)
// A film is judged by its thickness (2 x volume / surface area, exact for a plate), so a thin real shim or a small real pin stays.
export const MIN_THICKNESS = 1e-3, MIN_VOLUME = 1e-6; // mm, mm3
export function isNearEmpty(volume, area) {
  if (!(volume >= MIN_VOLUME)) return true;
  return area > 0 && 2 * volume / area < MIN_THICKNESS;
}
