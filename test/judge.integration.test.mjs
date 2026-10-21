import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, fileKey, freecadBatch, resolveExecutable, isolatedEnvironment, sliceFile, child, requireChild, PRUSA_VERSION } from '../tools/judge-exports.mjs';

const fixtures = path.join(ROOT, 'test/fixtures/judge');

test('pinned native consumers accept closed controls and reject damaged inputs', { timeout: 180_000 }, async t => {
  const out = path.join(ROOT, 'test-results/judge-self-test');
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const env = isolatedEnvironment(path.join(out, 'home'));
  const executable = resolveExecutable(process.env.FREECAD_CMD || 'freecadcmd');
  const prusa = resolveExecutable(process.env.PRUSA_SLICER || 'prusa-slicer');
  const version = await child(prusa, ['--help'], { env, timeoutMs: 15_000, log: path.join(out, 'prusa-version') });
  requireChild(version); assert.ok(version.stdout.startsWith(`PrusaSlicer-${PRUSA_VERSION} `));
  const runId = 'native-controls', deadline = Date.now() + 150_000;
  const cases = [
    ['cube.stl', true], ['cube.3mf', true],
    ['open-cube.stl', false, /open_edges=4/], ['open-cube.3mf', false, /open_edges=4/],
    ['cube.step', true], ['open-shell.step', false, /open or missing STEP shell/],
    ['cube.step', false, /solid count 1, expected 2/, 2, 2000, 'dropped-body'],
    ['two-cubes.step', true, null, 2, 2000],
    ['two-cubes-and-shell.step', false, /open or missing STEP shell|non-solid STEP leaf/, 2, 2000],
    ['truncated.stl', false, /binary STL length\/count mismatch/],
    ['corrupt.3mf', false, /BadZipFile/],
  ];
  writeFileSync(path.join(out, 'truncated.stl'), readFileSync(path.join(fixtures, 'cube.stl')).subarray(0, 100));
  writeFileSync(path.join(out, 'corrupt.3mf'), 'not a ZIP');
  const files = cases.map(([name, , , expectedSolids = 1, expectedVolume = 1000, alias]) => {
    const format = name.split('.').pop(), fixture = (alias || name.slice(0, -(format.length + 1))) + `-${format}.json`;
    const item = { runId, build: 'controls', fixture, format, expectedSolids, expectedVolume, expectedObjects: 1, path: path.join(['truncated.stl', 'corrupt.3mf'].includes(name) ? out : fixtures, name) };
    return { ...item, key: fileKey(item) };
  });
  const batch = await freecadBatch(files, { executable, out: path.join(out, 'native'), env, runId, deadline });
  assert.deepEqual(batch.errors, [], 'Native protocol must complete even when geometry fails');
  for (const [i, [name, expected, reason]] of cases.entries()) await t.test(`${files[i].fixture}: native ${expected ? 'pass' : 'failure'}`, () => {
    const result = batch.results.get(files[i].key);
    assert.equal(result?.ok, expected, JSON.stringify(result));
    if (reason) assert.match(result.reason, reason);
    if (name.startsWith('open-cube')) {
      assert.equal(result.details.meshes[0].isSolid, false);
      assert.equal(result.details.meshes[0].open_edges, 4);
    }
    if (expected && files[i].format === 'step') {
      assert.equal(result.details.solids, files[i].expectedSolids);
      assert.ok(Math.abs(result.details.volume - files[i].expectedVolume) < 0.00001);
    }
  });
  for (const name of ['cube.stl', 'cube.3mf', 'open-cube.stl', 'open-cube.3mf']) await t.test(`${name}: actual slice produces layers`, async () => {
    const input = files.find(f => f.path === path.join(fixtures, name));
    const slice = await sliceFile(input, { executable: prusa, out: path.join(out, 'output'), logs: path.join(out, 'logs'), env, deadline });
    if (name.startsWith('cube.')) assert.equal(slice.ok, true, JSON.stringify(slice));
    assert.ok(slice.layers > 0 && slice.extrusionMoves > 0, JSON.stringify(slice));
    if (name.startsWith('open-cube')) assert.equal(batch.results.get(input.key).ok, false, 'A repaired slice must not rescue the original open mesh');
  });
  await t.test('malformed STEP cannot pass even if the process exits zero', async () => {
    const badPath = path.join(out, 'malformed.step'); writeFileSync(badPath, 'not a STEP document');
    const item = { ...files.find(f => f.format === 'step'), path: badPath, fixture: 'malformed.json' }; item.key = fileKey(item);
    const malformed = await freecadBatch([item], { executable, out: path.join(out, 'malformed'), env, runId, deadline });
    const result = malformed.results.get(item.key);
    assert.equal(result?.ok, false, JSON.stringify({ ...malformed, results: [...malformed.results] }));
    assert.match(result.reason, /STEP|null|read|invalid|file|shape/i);
    assert.ok(malformed.errors.every(e => /FreeCAD (?:stderr )?diagnostic/.test(e)), JSON.stringify(malformed.errors));
  });
  await t.test('zero exit and no output fails the production slicer checker', async () => {
    const stub = path.join(out, 'no-output'); writeFileSync(stub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const slice = await sliceFile(files[0], { executable: stub, out: path.join(out, 'no-output-result'), logs: path.join(out, 'no-output-logs'), env, deadline });
    assert.equal(slice.ok, false); assert.ok(slice.reasons.includes('missing G-code output'));
  });
});
