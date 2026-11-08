// The pure part of jumpstart build: "$name" substitution and recipe checks. No browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STEPS, checkRecipe, isRecipe, substitute } from "../recipe.mjs";
import { safe, sameFile } from "../cli-utils.mjs";

test("stderr escaping keeps user text on one line", () => {
  assert.equal(safe("call\nnext\rreturn\ttab\x1b\x00\x7f"), "call\\nnext\\rreturn\\ttab\\u001b\\u0000\\u007f");
  assert.equal(safe("plain text"), "plain text");
});

test("file identity requires matching device and inode", () => {
  assert.equal(sameFile({ dev: 1, ino: 2 }, { dev: 1, ino: 2 }), true);
  assert.equal(sameFile({ dev: 1, ino: 2 }, { dev: 2, ino: 2 }), false);
  assert.equal(sameFile({ dev: 1, ino: 2 }, { dev: 1, ino: 3 }), false);
});

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

test("literal dollars, safe names, allowlist, versions and check outcomes", async () => {
  const { ALLOWED, checkOutcome, versionAtLeast } = await import("../recipe.mjs");
  const vars = Object.create(null); vars.__proto__ = { id: "safe" };
  assert.equal(substitute("$__proto__", vars), "safe");
  assert.equal(substitute("$$box", vars), "$box");
  assert.equal(substitute("$$$box", vars), "$$box");
  const recipe = (call, extra = {}) => ({ version: 1, steps: [{ call, ...extra }] });
  for (const call of ALLOWED) assert.doesNotThrow(() => checkRecipe(recipe(call)));
  for (const call of ["invoke", "run", "codeCad", "connect", "disconnect", "load", "newDesign"]) assert.throws(() => checkRecipe(recipe(call)), /recipes cannot use/);
  assert.throws(() => checkRecipe(recipe("filet")), /not allowed/);
  assert.throws(() => checkRecipe(recipe("bad\u001bcall")), /plain name/);
  assert.throws(() => checkRecipe(recipe("add", { as: "1x" })), /plain name/);
  assert.throws(() => checkRecipe({ ...recipe("add"), needs: "1.x" }), /major.minor/);
  assert.equal(versionAtLeast("1.10", "1.9"), true);
  assert.equal(versionAtLeast("1.8", "1.9"), false);
  assert.equal(versionAtLeast("2.0", "1.9"), true);
  assert.equal(versionAtLeast(undefined, "1.9"), false);
  assert.deepEqual(checkOutcome({ check: { ok: false } }), { exitCode: 3 });
  assert.deepEqual(checkOutcome({ check: { ok: true } }), { exitCode: 0 });
  assert.deepEqual(checkOutcome({}), { exitCode: 0 });
});
