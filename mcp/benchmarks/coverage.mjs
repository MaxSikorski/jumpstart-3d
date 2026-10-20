import { TUTORIALS } from "../../src/tutorial_data.js";
import { TUTORIAL_CASES } from "./tutorial-cases.mjs";

export function tutorialCoverage() {
  const implemented = new Set(TUTORIAL_CASES.map(({ id }) => id));
  return {
    total: TUTORIALS.length,
    implemented: TUTORIALS.filter(({ id }) => implemented.has(id)).length,
    missing: TUTORIALS.filter(({ id }) => !implemented.has(id)).map(({ id, title }) => ({ id, title })),
    obsolete: [...implemented].filter(id => !TUTORIALS.some(tutorial => tutorial.id === id)),
  };
}
