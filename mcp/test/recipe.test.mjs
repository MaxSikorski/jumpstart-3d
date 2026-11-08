// The pure part of jumpstart build: "$name" substitution and recipe checks. No browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STEPS, checkRecipe, isRecipe, substitute } from "../recipe.mjs";

test("$name becomes the saved result's id, $name.key a field, anywhere in nested args", () => {
  const vars = { box: { id: "b1", body: "b9", n: 4 }, plain: 7, list: [1, 2] };
  assert.equal(substitute("$box", vars), "b1");
  assert.equal(substitute("$box.body", vars), "b9");
  assert.equal(substitute("$box.n", vars), 4);
  assert.equal(substitute("$plain", vars), 7);
  assert.deepEqual(substitute("$list", vars), [1, 2]);
  assert.deepEqual(substitute(["$box", { ids: ["$box", "$box.body"], at: [0, "$plain"] }, 3, null], vars), ["b1", { ids: ["b1", "b9"], at: [0, 7] }, 3, null]);
});

test("only a whole-string match is replaced", () => {
  const vars = { box: { id: "b1" } };
  for (const s of ["a $box", "$box!", "$box.", "$", "$1x", "x$box", "edges of $box"]) assert.equal(substitute(s, vars), s);
});

test("an unknown name or field is a plain error", () => {
  assert.throws(() => substitute(["$nope"], {}), /no earlier step saved a result as "nope"/);
  assert.throws(() => substitute("$box.zip", { box: { id: "b1" } }), /has no "zip"/);
  assert.throws(() => substitute("$n.id", { n: 5 }), /has no "id"/);
});

test("the input is not changed", () => {
  const args = ["$a", { x: "$a" }];
  substitute(args, { a: { id: "q" } });
  assert.deepEqual(args, ["$a", { x: "$a" }]);
});

test("checkRecipe refuses code and bad steps, naming the step and call", () => {
  const r = (...steps) => ({ jumpstart: "recipe", version: 1, steps });
  assert.ok(isRecipe(r()));
  assert.ok(!isRecipe({ app: "jumpstart-3d" }));
  for (const c of ["run", "codeCad", "connect", "disconnect", "load", "newDesign"])
    assert.throws(() => checkRecipe(r({ call: "list" }, { call: c })), new RegExp(`step 2 \\(${c}\\): recipes cannot use ${c}`));
  assert.throws(() => checkRecipe({ ...r(), version: 2 }), /version must be 1/);
  assert.throws(() => checkRecipe({ jumpstart: "recipe", version: 1 }), /"steps"/);
  assert.throws(() => checkRecipe(r({ args: [] })), /step 1: needs a "call"/);
  assert.throws(() => checkRecipe(r({ call: "add", args: "box" })), /step 1 \(add\): "args" must be an array/);
  assert.throws(() => checkRecipe(r({ call: "add", as: "a b" })), /"as" must be a plain name/);
  assert.throws(() => checkRecipe(r(...Array.from({ length: MAX_STEPS + 1 }, () => ({ call: "list" })))), /at most 2000 steps/);
  assert.doesNotThrow(() => checkRecipe(r(...Array.from({ length: MAX_STEPS }, () => ({ call: "list" })))));
});
