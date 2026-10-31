import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const placeholder = "<script>/*js3d:three*/</script>";
const builds = ["tools/three-global.min.js", "tools/three-global-orbit.min.js"]
  .map((path) => read(path).replaceAll("</script", "<\\/script"));

for (const page of ["chisel", "flexigen", "meshstep"]) {
  test(`${page} has one placeholder and no embedded three.js`, () => {
    const html = read(`src/${page}.html`);
    assert.equal(html.split(placeholder).length - 1, 1);
    for (const build of builds) {
      const middle = Math.floor(build.length / 2);
      assert.ok(!html.includes(build.slice(middle, middle + 200)));
      assert.ok(build.includes("REVISION:()=>"));
    }
    assert.ok(!html.includes("REVISION:()=>"));
  });
}

test("shared fragment matches the orbit build exactly", () => {
  assert.equal(read("src/helper-three.html"), "<script>" + builds[1] + "</script>");
});

test("shared fragment has only its final closing script tag", () => {
  const html = read("src/helper-three.html");
  assert.equal(html.indexOf("</script"), html.length - "</script>".length);
  assert.ok(html.endsWith("</script>"));
});
