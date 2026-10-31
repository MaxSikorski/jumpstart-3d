// Needs a fresh `node build.mjs` (npm test's pretest runs it). The helper pages must be files on the site and inline in the single file only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const FILES = ["chisel.html", "flexigen.html", "meshstep.html", "helper-three.html"];
const site = read("docs/app.js"), single = read("dist/jumpstart-3d.html"), sw = read("docs/sw.js");

for (const f of FILES) {
  test(`${f}: a file on the site and in the service worker's list, inline only in the single file`, () => {
    const text = read("src/" + f);
    assert.equal(read("docs/helpers/" + f), text);
    // a run of plain characters from the middle of the page, so string escaping in the bundle cannot change it
    const mid = Math.floor(text.length / 2);
    const probe = text.slice(mid).match(/[A-Za-z0-9 _.,;:()=+-]{60}/)[0];
    assert.ok(!site.includes(probe), "docs/app.js must not carry " + f);
    assert.ok(single.includes(probe), "the single file must carry " + f);
    assert.ok(sw.includes('"helpers/' + f + '"'));
  });
}
