// The drawing bench's wrong parts in the real app, on both builds (test/drawbench/README.md): each deliberately wrong part
// fails exactly the checks its case lists, no more and no fewer, and scores below 100 %. The reference parts and other
// correct builds are in drawbench.spec.mjs. No AI and no key: recipes only.
import { test, expect } from "@playwright/test";
import { expectWrong } from "./drawbench/score.mjs";
import { scoreDesign } from "./drawbench/measure.mjs";
import { caseIds, failing, openCase, recipeOf } from "./drawbench/page.mjs";

// No trace and the bench's window size, as in drawbench.spec.mjs.
test.use({ trace: "off", viewport: { width: 1000, height: 700 } });

for (const id of caseIds) {
  test(`${id}: each wrong part fails exactly the checks its case lists`, async ({ page }, info) => {
    test.setTimeout(600_000);
    const { kase, truth, dir, call, truthBuild, errors } = await openCase(page, info, id);
    for (const w of kase.wrong) {
      const result = (await scoreDesign(call, { kase, truth, truthBuild, design: await recipeOf(dir, w.recipe) })).result;
      const verdict = expectWrong(result, w.fails);
      expect({ wrong: w.recipe, unexpected: verdict.unexpected, missing: verdict.missing }, failing(result).join("\n")).toEqual({ wrong: w.recipe, unexpected: [], missing: [] });
      expect(verdict.ok).toBe(true);
      expect(result.score.percent).toBeLessThan(100);
      if (w.fails.some((f) => result.checks.find((c) => c.id === f).gating)) expect(result.pass).toBe(false);
    }
    expect(errors).toEqual([]);
  });
}
