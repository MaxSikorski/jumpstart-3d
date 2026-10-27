// The small subset of threadprofile.test.mjs that pretest runs (about 20 s): the M8 pair at print offset None against the ISO basic profile,
// and the M3 bolt and nut at offsets 0 and -0.2 for valid solids with no sliver edges. The full file is run by hand (test/README.md).
import { test } from "node:test";
import { checkNone, checkSlivers } from "./threadprofile-lib.mjs";

test("M8: ISO basic profile at print offset None, bolt and nut do not overlap", { timeout: 240000 }, () => checkNone("M8"));
test("no sliver edges: M3 bolt and nut at offsets 0 and -0.2", { timeout: 240000 }, () => checkSlivers(["M3"], [0, -0.2]));
