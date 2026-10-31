// The extra Text fonts load on first use (src/morefonts.js): J.Siwek's fonts_more.js is read as data, never run, and only a design
// with a font other than the classic three waits for it. The browser side (pickers, builds, the toast offline) is upstream2813.spec.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMoreFonts, usesMoreFonts } from "../src/morefonts.js";

test("all 42 fonts come out of his fonts_more.js with a name, a group and TrueType data", () => {
  const fonts = parseMoreFonts(readFileSync(new URL("../src/fonts_more.js", import.meta.url), "utf8"));
  assert.equal(fonts.length, 42);
  assert.equal(new Set(fonts.map((f) => f.key)).size, 42);
  for (const f of fonts) {
    assert.ok(f.name && f.group, f.key);
    assert.deepEqual([...Buffer.from(f.data, "base64").subarray(0, 4)], [0, 1, 0, 0], f.key + " is a TrueType font");
  }
  assert.ok(fonts.some((f) => f.key === "bangers" && /Bangers/.test(f.name)));
});

test("a damaged file is refused with a plain message", () => {
  assert.throws(() => parseMoreFonts("nothing here"), /no font list/);
  assert.throws(() => parseMoreFonts('export const MORE_FONTS = [{"key": "x", "name": "X", "group": "G"}];\nconst DATA = {\n};'), /no data for x/);
});

test("only text in a font other than sans, serif and mono needs the extra fonts", () => {
  const text = (font) => JSON.stringify({ t: "prim", kind: "text", p: { text: "Hi", font } });
  assert.equal(usesMoreFonts(text("sans")), false);
  assert.equal(usesMoreFonts(text("mono")), false);
  assert.equal(usesMoreFonts(JSON.stringify({ t: "prim", kind: "box", p: { w: 1 } })), false);
  assert.equal(usesMoreFonts(text("bangers")), true);
  assert.equal(usesMoreFonts(JSON.stringify({ mods: [{ t: "emboss", str: "A", font: "serif" }, { t: "emboss", str: "B", font: "lobster" }] })), true);
});
