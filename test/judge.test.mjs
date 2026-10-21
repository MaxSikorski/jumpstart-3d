import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { BUILDS, FORMATS, ROOT, fileKey, worldExpectation, validateInputs, parseInfo, slicerDiagnostics, parseGcode, parseFreecad, child, requireChild, resolveExecutable, isolatedEnvironment, sliceFile, summaryTable, measurements, applyKnown } from '../tools/judge-exports.mjs';
import { sha256, normalizeStep, IDENTITY } from './helpers.mjs';

const fixtures = path.join(ROOT, 'test/fixtures/judge');
const sampleInfo = '[cube.stl]\nsize_x = 10.000000\nnumber_of_facets = 12\nmanifold = yes\nnumber_of_parts = 1\nvolume = 1000.000000\n';
const sampleGcode = 'M83\nG1 X0 Y0\n;LAYER_CHANGE\nG1 X10 E1\n';
const temporary = t => {
  mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
  const dir = mkdtempSync(path.join(ROOT, 'test-results/judge-unit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

function corpus(root) {
  mkdirSync(path.join(root, 'test/projects'), { recursive: true });
  const project = { bodies: [{ id: 'b', name: 'Box', m: IDENTITY }] };
  const projectBytes = Buffer.from(JSON.stringify(project));
  writeFileSync(path.join(root, 'test/projects/box.json'), projectBytes);
  const bytes = { stl: Buffer.from('binary-stl-placeholder'), '3mf': Buffer.from('zip-placeholder'), step: Buffer.from("FILE_NAME('','2026-10-21T12:00:00');\nSTEP translator 8.0 1'\n") };
  const golden = { 'box.json': { volumes: { 'b Box': 1000 }, ...Object.fromEntries(FORMATS.map(f => [f, sha256(f === 'step' ? normalizeStep(bytes[f]) : bytes[f])])) } };
  const goldenBytes = JSON.stringify(golden);
  writeFileSync(path.join(root, 'test/golden.json'), goldenBytes);
  writeFileSync(path.join(root, 'test/judge-solids.json'), '{"box.json":1}');
  for (const build of BUILDS) {
    const dir = path.join(root, 'test-results/judge', build);
    mkdirSync(dir, { recursive: true });
    const exports = {};
    for (const format of FORMATS) {
      writeFileSync(path.join(dir, `box.${format}`), bytes[format]);
      exports[format] = { path: `box.${format}`, bytes: bytes[format].length, sha256: sha256(bytes[format]) };
    }
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schema: 1, build, runId: 'unit', goldenSha256: sha256(goldenBytes), fixtures: { 'box.json': { projectSha256: sha256(projectBytes), exports } } }));
  }
}

function changeManifest(root, change) {
  const file = path.join(root, 'test-results/judge/site/manifest.json');
  const data = JSON.parse(readFileSync(file)); change(data); writeFileSync(file, JSON.stringify(data));
}

test('world volume applies outer determinant and ignores hidden/hole bodies', () => {
  const m = [...IDENTITY]; m[0] = -2; m[5] = 3; m[10] = 4;
  const result = worldExpectation({ doc: { bodies: [{ id: 'x', name: 'Scaled', m }, { hidden: true }, { hole: true }] } }, { volumes: { 'x Scaled': 10 } });
  assert.deepEqual(result, { expectedVolume: 240, expectedObjects: 1 });
});

test('world volume rejects missing/null/nonfinite values and singular matrices', () => {
  for (const v of [null, undefined, NaN, Infinity, -1, 0]) assert.throws(() => worldExpectation({ bodies: [{ id: 'b', name: 'Box', m: IDENTITY }] }, { volumes: { 'b Box': v } }), /baseline volume/);
  for (const m of [undefined, [1], IDENTITY.map(() => 0), IDENTITY.map((x, i) => i === 0 ? Infinity : x)]) assert.throws(() => worldExpectation({ bodies: [{ id: 'b', name: 'Box', m }] }, { volumes: { 'b Box': 1 } }), /matrix|transform/);
  assert.throws(() => worldExpectation({ bodies: [] }, {}), /expected world volume/);
});

test('both complete manifests validate and raw STEP differs from normalized hash', t => {
  const root = temporary(t); corpus(root);
  const inputs = validateInputs(root, 'unit');
  assert.equal(inputs.length, 6);
  assert.deepEqual(new Set(inputs.map(x => x.build)), new Set(BUILDS));
  assert.equal(inputs[1].expectedVolume, 1000);
  assert.throws(() => validateInputs(root, ''), /JUDGE_RUN_ID/);
});

test('measure mode accepts a missing or empty solid file as unreviewed counts and still rejects extra keys', t => {
  const root = temporary(t); corpus(root);
  rmSync(path.join(root, 'test/judge-solids.json'));
  assert.throws(() => validateInputs(root, 'unit'), /ENOENT/);
  assert.ok(validateInputs(root, 'unit', { measure: true }).every(x => x.expectedSolids === null));
  writeFileSync(path.join(root, 'test/judge-solids.json'), '{"box.json":2}');
  assert.ok(validateInputs(root, 'unit', { measure: true }).every(x => x.expectedSolids === 2));
  writeFileSync(path.join(root, 'test/judge-solids.json'), '{"box.json":0}');
  assert.throws(() => validateInputs(root, 'unit', { measure: true }), /invalid expected solid count/);
  writeFileSync(path.join(root, 'test/judge-solids.json'), '{"other.json":1}');
  assert.throws(() => validateInputs(root, 'unit', { measure: true }), /extra keys/);
});

test('measurements copy solid counts per fixture and flag build disagreement', () => {
  const step = (build, solids) => ({ key: `${build}/a.step`, build, fixture: 'a.json', format: 'step', ok: false, native: { details: { solids, valid: true, closed: true, shellsClosed: [true], volume: 8, deltaPercent: 0 } } });
  const same = measurements([step('single', 3), step('site', 3)]);
  assert.deepEqual(same.solids, { 'a.json': 3 }); assert.deepEqual(same.disagree, []);
  assert.match(same.lines[0], /^MEASURED single\/a.step solids=3 valid=true closed=true/);
  assert.deepEqual(measurements([step('single', 3), step('site', 2)]).disagree, ['a.json']);
});

for (const [name, mutate, pattern] of [
  ['wrong run', m => { m.runId = 'stale'; }, /run\/build/],
  ['wrong build', m => { m.build = 'single'; }, /run\/build/],
  ['wrong schema', m => { m.schema = 2; }, /schema/],
  ['baseline digest', m => { m.goldenSha256 = 'bad'; }, /baseline digest/],
  ['project digest', m => { m.fixtures['box.json'].projectSha256 = 'bad'; }, /project digest/],
  ['missing fixture', m => { delete m.fixtures['box.json']; }, /missing or extra/],
  ['extra fixture', m => { m.fixtures.extra = {}; }, /missing or extra/],
  ['missing format', m => { delete m.fixtures['box.json'].exports.stl; }, /missing or extra/],
  ['empty export', m => { m.fixtures['box.json'].exports.stl.bytes = 0; }, /empty\/length/],
  ['raw digest', m => { m.fixtures['box.json'].exports.stl.sha256 = 'bad'; }, /raw digest/],
  ['directory escape', m => { m.fixtures['box.json'].exports.stl.path = '../box.stl'; }, /export path/],
]) test(`manifest rejects ${name}`, t => { const root = temporary(t); corpus(root); changeManifest(root, mutate); assert.throws(() => validateInputs(root, 'unit'), pattern); });

for (const [name, action, pattern] of [
  ['missing file', r => rmSync(path.join(r, 'test-results/judge/site/box.stl')), /ENOENT/],
  ['extra file', r => writeFileSync(path.join(r, 'test-results/judge/site/extra.stl'), 'x'), /extra export files/],
  ['missing solids', r => writeFileSync(path.join(r, 'test/judge-solids.json'), '{}'), /judge-solids/],
  ['extra golden', r => { const p = path.join(r, 'test/golden.json'), g = JSON.parse(readFileSync(p)); g.extra = {}; writeFileSync(p, JSON.stringify(g)); }, /golden.json/],
  ['symlink export', r => { const p = path.join(r, 'test-results/judge/site/box.stl'); rmSync(p); symlinkSync('../single/box.stl', p); }, /regular input file/],
  ['hash not golden', r => { const p = path.join(r, 'test-results/judge/site/box.stl'); writeFileSync(p, 'wrong'); changeManifest(r, m => { m.fixtures['box.json'].exports.stl.bytes = 5; m.fixtures['box.json'].exports.stl.sha256 = sha256('wrong'); }); }, /golden hash/],
]) test(`coverage rejects ${name}`, t => { const root = temporary(t); corpus(root); action(root); assert.throws(() => validateInputs(root, 'unit'), pattern); });

test('Prusa info grammar accepts complete multi-object reports and rejects partial reports', () => {
  assert.equal(parseInfo(sampleInfo + sampleInfo, 2).length, 2);
  for (const key of ['number_of_facets', 'number_of_parts', 'volume', 'manifold']) assert.throws(() => parseInfo(sampleInfo.replace(new RegExp(`^${key}.*\\n`, 'm'), ''), 1), /info/);
  assert.throws(() => parseInfo(sampleInfo, 2), /object count/);
  assert.throws(() => parseInfo(sampleInfo.replace('yes', 'no'), 1), /manifold/);
  assert.throws(() => parseInfo(sampleInfo.replace('1000.000000', 'nan'), 1), /volume/);
  assert.throws(() => parseInfo(sampleInfo + 'volume = 1\n', 1), /duplicate/);
});

for (const counter of ['open_edges', 'degenerate_facets', 'edges_fixed', 'facets_removed', 'facets_reversed', 'backwards_edges']) test(`Prusa ${counter}: zero passes, positive/malformed fails`, () => {
  assert.equal(parseInfo(sampleInfo + `${counter} = 0\n`, 1).length, 1);
  for (const n of ['1', '-1', 'nan', '']) assert.throws(() => parseInfo(sampleInfo + `${counter} = ${n}\n`, 1), new RegExp(counter));
});

for (const diagnostic of ['WARNING: repaired mesh', 'repair needed', 'repairing', 'non-manifold', 'non manifold', 'nonmanifold', 'Nothing to print', 'Error: bad', '[error] bad', 'fatal error']) test(`forbidden diagnostic: ${diagnostic}`, () => {
  assert.equal(slicerDiagnostics(diagnostic).length, 1);
  assert.throws(() => parseInfo(sampleInfo + diagnostic, 1), /diagnostic/);
});

test('real probe silently slices the hole; G-code success alone cannot pass a mesh', () => {
  const stdout = readFileSync(path.join(fixtures, 'probe-open.stdout'), 'utf8');
  const stderr = readFileSync(path.join(fixtures, 'probe-open.stderr'), 'utf8');
  assert.deepEqual(slicerDiagnostics(stdout + stderr), []);
  const gcode = parseGcode(readFileSync(path.join(fixtures, 'probe-open.gcode'), 'utf8'));
  assert.equal(gcode.layers, 66);
  assert.ok(gcode.extrusionMoves > 0);
  const record = readFileSync(path.join(fixtures, 'probe-freecad.stdout'), 'utf8').split('\n').find(l => l.startsWith('PROBE_JSON ') && l.includes('bad_mesh'));
  const bad = JSON.parse(record.slice('PROBE_JSON '.length));
  assert.equal(bad.isSolid, false); assert.equal(bad.boundary_edges, 4); assert.equal(bad.hasNonManifolds, false);
});

test('G-code requires both a layer and XY extrusion, ignoring footer configuration', () => {
  for (const text of ['', ';comment\n', ';LAYER_CHANGE\n', ';LAYER_CHANGE\nG1 E1\n', ';LAYER_CHANGE\nG1 Z2 E1\n', 'G1 X2 E1\n;LAYER_CHANGE\n', '; prusaslicer_config = begin\n;LAYER_CHANGE\nG1 X2 E1\n', ';LAYER_CHANGE\nG0 X2 E1\n', '\0' + sampleGcode]) assert.throws(() => parseGcode(text), /G-code/);
  assert.equal(parseGcode(sampleGcode).extrusionMoves, 1);
  assert.equal(parseGcode('M82\nG92 E100\n;LAYER_CHANGE\nG1 X2 E99\nG1 X3 E100\nG92 E0\nG1 X4 E1').extrusionMoves, 2);
  assert.equal(parseGcode('M83\n;LAYER_CHANGE\nG1 X2 E1\nG1 X3 E-1\nG92 E0\nG1 X4 E1').extrusionMoves, 2);
  assert.equal(parseGcode('M83\nG91\n;LAYER_CHANGE\nG1 X2 E1\nG1 X2 E1\nG90\nG1 X4 E1').extrusionMoves, 2);
});

const request = { runId: 'unit', files: [{ key: 'site/cube.stl', build: 'site', fixture: 'cube.json', format: 'stl' }] };
const native = { runId: 'unit', build: 'site', fixture: 'cube.json', format: 'stl', ok: true, details: { meshes: [] }, elapsedMs: 1 };
function protocol(result = native) {
  return `JUDGE_VERSION {"version":"1.1.4"}\nJUDGE_BEGIN site/cube.stl\nJUDGE_RESULT ${JSON.stringify(result)}\nJUDGE_COMPLETE ${JSON.stringify({ runId: 'unit', count: 1, passed: result.ok ? 1 : 0, failed: result.ok ? 0 : 1 })}\n`;
}
const nativeProcess = stdout => ({ stdout, stderr: '', code: 0, signal: null });

test('FreeCAD protocol accepts explicit negative verdict despite zero process status', () => {
  assert.deepEqual(parseFreecad(nativeProcess(protocol()), request).errors, []);
  const bad = parseFreecad(nativeProcess(protocol({ ...native, ok: false, reason: 'open_edges=4' })), request);
  assert.deepEqual(bad.errors, []); assert.equal(bad.results.get('site/cube.stl').ok, false);
});

for (const [name, mutate] of [
  ['missing completion', s => s.replace(/JUDGE_COMPLETE[^\n]*\n/, '')],
  ['missing result', s => s.replace(/JUDGE_RESULT[^\n]*\n/, '')],
  ['duplicate result', s => s.replace('JUDGE_COMPLETE', `JUDGE_RESULT ${JSON.stringify(native)}\nJUDGE_COMPLETE`)],
  ['duplicate completion', s => s + 'JUDGE_COMPLETE {}\n'],
  ['wrong run', s => s.replace('"runId":"unit"', '"runId":"stale"')],
  ['wrong identity', s => s.replace('"fixture":"cube.json"', '"fixture":"other.json"')],
  ['wrong version', s => s.replace('1.1.4', '1.0.2')],
  ['truncated JSON', s => s.replace('"ok":true', '"ok":')],
  ['unreported import error', s => s + 'BRep_API: command not done\n'],
]) test(`FreeCAD protocol rejects ${name}`, () => assert.ok(parseFreecad(nativeProcess(mutate(protocol())), request).errors.length));

test('FreeCAD stderr errors and nonzero process status cannot be hidden by valid records', () => {
  for (const patch of [{ stderr: 'Exception: bad' }, { code: 1 }, { signal: 'SIGABRT' }, { error: 'timeout' }]) assert.ok(parseFreecad({ ...nativeProcess(protocol()), ...patch }, request).errors.length);
});

test('child captures stdout/stderr, exit status, missing executable, signal and timeout', async t => {
  const out = temporary(t), env = isolatedEnvironment(path.join(out, 'home'));
  const run = (script, options = {}) => child(process.execPath, ['-e', script], { env, timeoutMs: 1000, log: path.join(out, String(Math.random())), ...options });
  const good = await run('console.log("out");console.error("warn")');
  requireChild(good); assert.equal(good.stdout, 'out\n'); assert.equal(good.stderr, 'warn\n');
  assert.throws(() => requireChild({ ...good, code: 1 }), /exit=1/);
  assert.throws(() => resolveExecutable(path.join(out, 'absent')), /executable not found/);
  const missing = await child(path.join(out, 'absent'), [], { env, timeoutMs: 500, log: path.join(out, 'missing') });
  assert.throws(() => requireChild(missing), /spawn error/);
  const signal = await run('process.kill(process.pid, "SIGTERM")');
  assert.throws(() => requireChild(signal), /signal=SIGTERM/);
  const timeout = await run('setInterval(()=>{},100)', { timeoutMs: 50 });
  assert.throws(() => requireChild(timeout), /timeout/);
  const noProgress = await run('console.log("JUDGE_BEGIN site/cube.stl");setInterval(()=>console.log("noise"),10)', { startupMs: 1000, progressMs: 50 });
  assert.throws(() => requireChild(noProgress), /progress/);
  const deadline = await run('setInterval(()=>{},100)', { deadline: Date.now() + 50 });
  assert.throws(() => requireChild(deadline), /deadline/);
});

for (const [mode, reason] of [['missing', /missing G-code/], ['nonzero', /exit=9/], ['stderr', /slicer diagnostic/], ['good', null]]) test(`slicer child ${mode}, stale outputs never count`, async t => {
  const dir = temporary(t), executable = path.join(dir, 'prusa-stub');
  writeFileSync(executable, `#!${process.execPath}\nimport fs from 'node:fs';\nconst a=process.argv.slice(2);\nif(a.includes('--info')){console.log(${JSON.stringify(sampleInfo)});}else{${mode !== 'missing' ? `fs.writeFileSync(a[a.indexOf('--output')+1],${JSON.stringify(sampleGcode)});` : ''}${mode === 'nonzero' ? 'process.exit(9);' : ''}${mode === 'stderr' ? 'console.error("Warning: repaired mesh");' : ''}}\n`, { mode: 0o755 });
  const input = { ...request.files[0], path: path.join(dir, 'cube.stl'), expectedObjects: 1 };
  mkdirSync(path.join(dir, 'output/site'), { recursive: true });
  writeFileSync(path.join(dir, 'output/site/cube.stl.gcode'), sampleGcode);
  const result = await sliceFile(input, { executable, out: path.join(dir, 'output'), logs: path.join(dir, 'logs'), env: isolatedEnvironment(path.join(dir, 'home')) });
  assert.equal(result.ok, mode === 'good', JSON.stringify(result));
  if (reason) assert.match(result.reasons.join('; '), reason);
  if (mode === 'missing') assert.equal(existsSync(path.join(dir, 'output/site/cube.stl.gcode')), false);
});

test('a multi-object 3MF is sliced object by object and one bad object fails the file', async t => {
  const dir = temporary(t), executable = path.join(dir, 'prusa-stub');
  writeFileSync(executable, `#!${process.execPath}\nimport fs from 'node:fs';\nconst a=process.argv.slice(2);\nif(a.includes('--info')){console.log(${JSON.stringify(sampleInfo + sampleInfo)});}else{if(a.at(-1).endsWith('bad.3mf'))process.exit(9);fs.writeFileSync(a[a.indexOf('--output')+1],${JSON.stringify(sampleGcode)});}\n`, { mode: 0o755 });
  const input = { ...request.files[0], format: '3mf', key: 'site/two.3mf', path: path.join(dir, 'two.3mf'), expectedObjects: 2 };
  const run = slicePaths => sliceFile({ ...input, slicePaths }, { executable, out: path.join(dir, 'output'), logs: path.join(dir, 'logs'), env: isolatedEnvironment(path.join(dir, 'home')) });
  const good = await run([path.join(dir, 'a.3mf'), path.join(dir, 'b.3mf')]);
  assert.equal(good.ok, true, JSON.stringify(good)); assert.equal(good.sliced, 2); assert.equal(good.layers, 2);
  assert.ok(existsSync(path.join(dir, 'output/site/two.3mf.object2.gcode')));
  const bad = await run([path.join(dir, 'a.3mf'), path.join(dir, 'bad.3mf')]);
  assert.equal(bad.ok, false); assert.match(bad.reasons.join('; '), /object 2: child exit=9/);
});

test('known defects: a failing listed file warns, a passing listed file fails, unlisted and unmatched failures stay failures', () => {
  const row = (fixture, format, reasons, warnings) => ({ fixture, format, reasons, native: { details: { warnings } } });
  const known = { 'a.stl': { match: 'zero-area', defect: 'two degenerate triangles', followUp: 'drop them' } };
  const run = rows => ({ rows, problems: applyKnown(rows, known) });
  let { rows } = run([row('a.json', 'stl', ['ValueError: zero-area triangle']), row('a.json', '3mf', ['open edges']), row('b.json', 'stl', [], ['near-duplicate vertices'])]);
  assert.equal(rows[0].reasons.length, 0); assert.match(rows[0].warnings[0], /known defect: two degenerate triangles; follow-up: drop them/);
  assert.deepEqual(rows[1].reasons, ['open edges']);
  assert.deepEqual(rows[2].warnings, ['near-duplicate vertices']);
  ({ rows } = run([row('a.json', 'stl', [])]));
  assert.match(rows[0].reasons[0], /remove it from judge-known.json/);
  ({ rows } = run([row('a.json', 'stl', ['ValueError: zero-area triangle', 'info open_edges=4'])]));
  assert.deepEqual(rows[0].reasons, ['ValueError: zero-area triangle', 'info open_edges=4']);
  assert.match(applyKnown([row('b.json', 'stl', [])], known)[0], /not a golden file/);
  assert.match(applyKnown([row('a.json', 'stl', [])], { 'a.stl': { match: 'x' } })[0], /needs match, defect and followUp/);
});

test('summary has all six build/format rows, failures included', () => {
  const table = summaryTable([{ build: 'site', format: 'stl', ok: false, elapsedMs: 100 }]);
  assert.equal(table.split('\n').length, 9); assert.match(table, /\| Total \| \| 1 \| 0 \| 1 \|/);
  assert.equal(fileKey({ build: 'site', fixture: 'advanced-text.json', format: 'step' }), 'site/advanced-text.step');
});

test('golden collector rejects missing run ID and baseline-update mode before running tests', async t => {
  const out = temporary(t);
  for (const [name, settings] of [
    ['no-run-id', { JUDGE_EXPORTS: '1', JUDGE_RUN_ID: '', UPDATE_GOLDEN: '' }],
    ['update', { JUDGE_EXPORTS: '1', JUDGE_RUN_ID: 'unit', UPDATE_GOLDEN: '1' }],
  ]) {
    const result = await child(process.execPath, [path.join(ROOT, 'node_modules/playwright/cli.js'), 'test', 'test/golden.spec.mjs', '--list'], {
      env: { ...process.env, ...settings }, timeoutMs: 15_000, log: path.join(out, name),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /JUDGE_EXPORTS requires JUDGE_RUN_ID and forbids UPDATE_GOLDEN/);
  }
});
