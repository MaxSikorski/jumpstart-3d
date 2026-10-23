// The size budget for docs/app.js (Phase 7 step 3). build.mjs calls this after bundling: the gzipped app may grow at most 5 %
// over the number recorded in size-budget.json; a deliberate growth is recorded with `node build.mjs --bump-budget`.
import { gzipSync } from "node:zlib";

export const HEADROOM = 0.05;
export const gzipSize = (text) => gzipSync(text, { level: 9 }).length;

// recorded: the number in size-budget.json (undefined when the file is missing). Returns { ok, limit, message }.
export function checkBudget(size, recorded) {
  if (!Number.isInteger(recorded) || recorded <= 0) return { ok: false, limit: 0, message: "size-budget.json has no recorded size for docs/app.js; run node build.mjs --bump-budget once to record it." };
  const limit = Math.floor(recorded * (1 + HEADROOM));
  const pct = ((size - recorded) / recorded * 100).toFixed(1);
  if (size > limit) return { ok: false, limit, message: `docs/app.js is ${size} bytes gzipped, ${pct}% over the recorded ${recorded} (limit ${limit}). If the growth is intended, run node build.mjs --bump-budget and say why in the PR.` };
  return { ok: true, limit, message: `docs/app.js ${size} bytes gzipped, ${pct}% against the recorded ${recorded} (limit ${limit})` };
}
