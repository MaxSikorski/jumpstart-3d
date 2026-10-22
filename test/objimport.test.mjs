import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { objPositions } from "../src/objimport.js";
import { readMeshFile, meshBounds } from "../src/meshimport.js";

for (const [label, eol] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
  const encode = (lines) => new TextEncoder().encode(lines.join(eol));

  test(`${label}: continued vertex coordinates form one vertex`, () => {
    const pos = objPositions(encode(["v 0 \\", "0 \\", "0", "v 5 0 0", "v 0 5 0", "f 1 2 3"]));
    assert.deepEqual([...pos], [0, 0, 0, 5, 0, 0, 0, 5, 0]);
  });

  test(`${label}: a continued quad retains both triangles`, () => {
    const pos = objPositions(encode(["v 0 0 0", "v 5 0 0", "v 5 5 0", "v 0 5 0", "f 1 \\", "2 \\", "3 4"]));
    assert.deepEqual([...pos], [0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 0, 0, 5, 5, 0, 0, 5, 0]);
  });

  test(`${label}: continued cube imports closed at 5 mm without encoded units`, async () => {
    const text = readFileSync(new URL("./fixtures/obj/cube-continued.obj", import.meta.url), "utf8");
    const res = await readMeshFile(new TextEncoder().encode(text.replace(/\r?\n/g, eol)), "cube-continued.obj");
    assert.equal(res.format, "OBJ");
    assert.equal(res.unitFromFile, null);
    assert.equal(res.mesh.I.length / 3, 12);
    assert.equal(res.report.open, 0);
    assert.deepEqual(meshBounds(res.mesh).size, [5, 5, 5]);
  });

  test(`${label}: continued-record errors identify their first physical line`, () => {
    assert.throws(() => objPositions(encode(["# heading", "v 0 \\", "bad 0"])), /invalid vertex coordinates \(line 2\)/);
    assert.throws(() => objPositions(encode(["v 0 0 \\", "0", "v 5 0 0", "v 0 5 0", "f 1 \\", "2 99"])), /index out of range \(line 5\)/);
  });
}
