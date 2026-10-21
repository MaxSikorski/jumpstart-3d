import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync, rmSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, normalizeStep } from '../test/helpers.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const BUILDS = ['site', 'single'];
export const FORMATS = ['3mf', 'step', 'stl'];
export const PRUSA_VERSION = '2.8.1+linux-x64-GTK3-202409181416';
export const FREECAD_VERSION = '1.1.4';
const profile = path.join(ROOT, 'tools/judge-prusa.ini');
const macro = path.join(ROOT, 'tools/judge-freecad.py');
const check = (condition, reason) => { if (!condition) throw new Error(reason); };
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const fileKey = ({ build, fixture, format }) => `${build}/${fixture.replace(/\.json$/, '')}.${format}`;
const sameKeys = (value, expected, label) => check(value && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label}: missing or extra keys`);

export function worldExpectation(project, golden) {
  const bodies = (project.doc || project).bodies;
  check(Array.isArray(bodies), 'missing bodies');
  const selected = bodies.filter(b => !b.hidden && !b.hole);
  let expectedVolume = 0;
  for (const b of selected) {
    const m = b.m, v = golden.volumes?.[`${b.id} ${b.name}`];
    check(Array.isArray(m) && m.length === 16 && m.every(Number.isFinite), `${b.id}: missing/nonfinite matrix`);
    check(Number.isFinite(v) && v > 0, `${b.id}: missing/nonfinite/nonpositive baseline volume`);
    const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
    check(Number.isFinite(det) && det !== 0, `${b.id}: singular/nonfinite transform`);
    expectedVolume += v * Math.abs(det);
  }
  check(Number.isFinite(expectedVolume) && expectedVolume > 0, 'nonpositive/nonfinite expected world volume');
  return { expectedVolume, expectedObjects: selected.length };
}

export function discover(root = ROOT) {
  return readdirSync(path.join(root, 'test/projects')).filter(f => f.endsWith('.json')).sort();
}

// measure: a missing or incomplete judge-solids.json leaves expectedSolids null, so every other check still runs and the solid counts are only measured.
export function validateInputs(root, runId, { measure = false } = {}) {
  check(typeof runId === 'string' && runId.trim(), 'JUDGE_RUN_ID is required');
  const files = discover(root), base = path.join(root, 'test-results/judge');
  check(files.length > 0, 'no golden designs discovered');
  const goldenBytes = readFileSync(path.join(root, 'test/golden.json'));
  const solidsFile = path.join(root, 'test/judge-solids.json');
  const golden = JSON.parse(goldenBytes), solids = measure && !existsSync(solidsFile) ? {} : json(solidsFile);
  sameKeys(golden, files, 'golden.json');
  if (measure) check(Object.keys(solids).every(k => files.includes(k)), 'judge-solids.json: extra keys');
  else sameKeys(solids, files, 'judge-solids.json');
  const inputs = [];
  for (const build of BUILDS) {
    const dir = path.join(base, build), manifest = json(path.join(dir, 'manifest.json'));
    check(!lstatSync(dir).isSymbolicLink() && realpathSync(dir) === dir, `${build}: symlink input directory`);
    check(manifest.schema === 1 && manifest.runId === runId && manifest.build === build, `${build}: schema/run/build mismatch`);
    check(manifest.goldenSha256 === sha256(goldenBytes), `${build}: baseline digest mismatch`);
    sameKeys(manifest.fixtures, files, `${build} manifest`);
    const expectedPaths = ['manifest.json'];
    for (const fixture of files) {
      check(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(fixture), `unsafe fixture name: ${fixture}`);
      const reviewed = Number.isSafeInteger(solids[fixture]) && solids[fixture] > 0;
      check(reviewed || (measure && !(fixture in solids)), `${fixture}: invalid expected solid count`);
      const projectBytes = readFileSync(path.join(root, 'test/projects', fixture));
      const entry = manifest.fixtures[fixture];
      check(entry.projectSha256 === sha256(projectBytes), `${build}/${fixture}: project digest mismatch`);
      const expectation = worldExpectation(JSON.parse(projectBytes), golden[fixture]);
      sameKeys(entry.exports, FORMATS, `${build}/${fixture} exports`);
      for (const format of FORMATS) {
        const name = fixture.replace(/\.json$/, `.${format}`), exportInfo = entry.exports[format];
        expectedPaths.push(name);
        check(exportInfo.path === name, `${build}/${fixture}: unexpected export path`);
        const input = path.join(dir, name), stat = lstatSync(input);
        check(stat.isFile() && !stat.isSymbolicLink() && realpathSync(input) === input, `${input}: not a regular input file`);
        const bytes = readFileSync(input);
        check(Number.isSafeInteger(exportInfo.bytes) && exportInfo.bytes > 0 && bytes.length === exportInfo.bytes, `${input}: empty/length mismatch`);
        check(sha256(bytes) === exportInfo.sha256, `${input}: raw digest mismatch`);
        check(sha256(format === 'step' ? normalizeStep(bytes) : bytes) === golden[fixture][format], `${input}: golden hash mismatch`);
        inputs.push({ key: fileKey({ build, fixture, format }), runId, build, fixture, format, path: input, expectedSolids: reviewed ? solids[fixture] : null, ...expectation });
      }
    }
    check(JSON.stringify(readdirSync(dir).sort()) === JSON.stringify(expectedPaths.sort()), `${build}: missing or extra export files`);
  }
  return inputs;
}

export function slicerDiagnostics(text) {
  return text.split(/\r?\n/).filter(line => /non[- ]?manifold|\brepair(?:ed|ing)?\b|nothing to print|\berror:|\[error\]|\bfatal\b/i.test(line));
}

export function parseInfo(text, expectedObjects) {
  const problems = slicerDiagnostics(text);
  check(problems.length === 0, `slicer diagnostic: ${problems.join(' | ')}`);
  const objects = [];
  let current;
  for (const line of text.split(/\r?\n/)) {
    if (/^\[[^\]]+\]$/.test(line.trim())) { current = {}; objects.push(current); continue; }
    const field = /^\s*([a-z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!field) continue;
    check(current, 'info field outside object block');
    check(!Object.hasOwn(current, field[1]), `duplicate info field: ${field[1]}`);
    current[field[1]] = field[2];
  }
  check(objects.length === expectedObjects, `info object count ${objects.length}, expected ${expectedObjects}`);
  for (const obj of objects) {
    for (const key of ['number_of_facets', 'number_of_parts', 'volume']) {
      const n = Number(obj[key]);
      check(Number.isFinite(n) && n > 0 && (key === 'volume' || Number.isSafeInteger(n)), `incomplete/invalid info ${key}`);
    }
    check(obj.manifold === 'yes', 'info manifold is not yes');
    for (const key of ['open_edges', 'degenerate_facets', 'edges_fixed', 'facets_removed', 'facets_reversed', 'backwards_edges']) {
      if (Object.hasOwn(obj, key)) check(/^0(?:\.0+)?$/.test(obj[key]), `info ${key}=${obj[key]}`);
    }
  }
  return objects;
}

export function parseGcode(text) {
  check(text.length > 0 && !/[^\x09\x0a\x0d\x20-\x7e]/.test(text), 'empty or non-plain-text G-code');
  let layers = 0, extrusionMoves = 0, relativeE = false, relativeXY = false;
  let x = 0, y = 0, e = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (/^;\s*prusaslicer_config\s*=\s*begin/.test(raw)) break;
    if (raw === ';LAYER_CHANGE') { layers++; continue; }
    const line = raw.split(';')[0].trim();
    const command = /^(G\d+|M\d+)\b/.exec(line)?.[1];
    const args = Object.fromEntries([...line.matchAll(/([XYZE])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)].map(m => [m[1], Number(m[2])]));
    if (command === 'M82') relativeE = false;
    if (command === 'M83') relativeE = true;
    if (command === 'G90') relativeXY = false;
    if (command === 'G91') relativeXY = true;
    if (command === 'G92') { x = args.X ?? x; y = args.Y ?? y; e = args.E ?? e; }
    if (!['G0', 'G00', 'G1', 'G01'].includes(command)) continue;
    const nx = args.X === undefined ? x : args.X + (relativeXY ? x : 0);
    const ny = args.Y === undefined ? y : args.Y + (relativeXY ? y : 0);
    const ne = args.E === undefined ? e : args.E + (relativeE ? e : 0);
    if (layers > 0 && ['G1', 'G01'].includes(command) && (nx !== x || ny !== y) && ne > e) extrusionMoves++;
    x = nx; y = ny; e = ne;
  }
  check(layers > 0, 'G-code has no layer markers');
  check(extrusionMoves > 0, 'G-code has no XY extrusion after a layer marker');
  return { layers, extrusionMoves };
}

export function resolveExecutable(name) {
  const candidates = name.includes(path.sep) ? [path.resolve(name)] : (process.env.PATH || '').split(path.delimiter).map(p => path.resolve(p, name));
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); if (lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink()) return candidate; } catch { /* A PATH entry may not contain this executable. */ }
  }
  throw new Error(`executable not found: ${name} (supply a single executable path, without flags)`);
}

export function child(executable, args, { env, timeoutMs, startupMs, progressMs = 20_000, deadline = Infinity, log, cwd = ROOT } = {}) {
  const started = performance.now();
  mkdirSync(path.dirname(log), { recursive: true });
  const stdoutFile = `${log}.stdout`, stderrFile = `${log}.stderr`;
  writeFileSync(stdoutFile, ''); writeFileSync(stderrFile, '');
  return new Promise(resolve => {
    let stdout = '', stderr = '', error, pending = '', timer;
    const proc = spawn(executable, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const stop = (reason) => {
      error = reason;
      try { if (process.platform !== 'win32') process.kill(-proc.pid, 'SIGKILL'); else proc.kill('SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') error += `; kill: ${e.message}`; }
    };
    const arm = ms => { clearTimeout(timer); timer = setTimeout(() => stop(Date.now() >= deadline ? 'total judge deadline exceeded' : 'child timeout/no progress'), Math.max(1, Math.min(ms, deadline - Date.now()))); };
    arm(startupMs ?? timeoutMs);
    proc.stdout.on('data', data => {
      const s = data.toString(); stdout += s; appendFileSync(stdoutFile, data);
      if (startupMs) {
        pending += s;
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) if (/^JUDGE_(?:BEGIN|RESULT|COMPLETE|VERSION) /.test(line)) arm(progressMs);
      }
    });
    proc.stderr.on('data', data => { stderr += data.toString(); appendFileSync(stderrFile, data); });
    proc.on('error', e => { error = `spawn error: ${e.message}`; });
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, error, stdout, stderr, elapsedMs: performance.now() - started, log });
    });
  });
}

export function requireChild(result) {
  check(!result.error && result.code === 0 && !result.signal, result.error || `child exit=${result.code} signal=${result.signal}`);
}

export function parseFreecad(result, request) {
  const results = new Map(), begins = new Set(), errors = [], completions = [], versions = [];
  let active;
  try { requireChild(result); } catch (e) { errors.push(e.message); }
  const expected = new Map(request.files.map(f => [f.key, f]));
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^JUDGE_(BEGIN|RESULT|COMPLETE|VERSION) (.*)$/.exec(line);
    if (!match) {
      if (/Error|Exception|Traceback \(most recent call last\)|Standard_Failure|BRep_API: command not done/i.test(line)) errors.push(`FreeCAD diagnostic: ${line}`);
      continue;
    }
    try {
      if (match[1] === 'BEGIN') {
        check(expected.has(match[2]) && !begins.has(match[2]) && !active, `unexpected/duplicate BEGIN: ${match[2]}`);
        active = match[2]; begins.add(active); continue;
      }
      const value = JSON.parse(match[2]);
      if (match[1] === 'VERSION') { versions.push(value); continue; }
      if (match[1] === 'COMPLETE') { completions.push(value); continue; }
      const key = fileKey(value), input = expected.get(key);
      check(input && key === active && !results.has(key), `unexpected/duplicate result: ${key}`);
      check(value.runId === request.runId && value.build === input.build && value.fixture === input.fixture && value.format === input.format, `result identity mismatch: ${key}`);
      check(typeof value.ok === 'boolean' && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0, `invalid result: ${key}`);
      check(value.ok ? value.details && typeof value.details === 'object' : typeof value.reason === 'string', `incomplete result: ${key}`);
      results.set(key, value); active = undefined;
    } catch (e) { errors.push(e.message); }
  }
  if (/Error|Exception|Traceback \(most recent call last\)|Standard_Failure|BRep_API: command not done/i.test(result.stderr)) errors.push(`FreeCAD stderr diagnostic: ${result.stderr.trim()}`);
  if (versions.length !== 1 || versions[0].version !== FREECAD_VERSION) errors.push(`FreeCAD version mismatch: ${JSON.stringify(versions)}`);
  const done = completions[0], passed = [...results.values()].filter(r => r.ok).length;
  if (completions.length !== 1 || done.runId !== request.runId || done.count !== expected.size || done.passed !== passed || done.failed !== expected.size - passed || results.size !== expected.size || active) errors.push('missing/inconsistent FreeCAD completion or results');
  return { results, errors, version: versions[0] };
}

export function isolatedEnvironment(dir) {
  mkdirSync(dir, { recursive: true });
  const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: path.join(dir, 'config'), XDG_CACHE_HOME: path.join(dir, 'cache'), XDG_DATA_HOME: path.join(dir, 'data'), LC_ALL: 'C', LANG: 'C', QT_QPA_PLATFORM: 'offscreen' };
  delete env.PYTHONPATH; delete env.PYTHONHOME;
  return env;
}

export async function freecadBatch(files, { executable, out, env, runId, deadline = Infinity, startupMs = 60_000, progressMs = 20_000 }) {
  mkdirSync(out, { recursive: true });
  const request = { schema: 1, runId, files: files.map(f => f.format === '3mf' ? { ...f, splitDir: path.join(out, 'split') } : f) }, requestPath = path.join(out, 'request.json');
  writeFileSync(requestPath, JSON.stringify(request, null, 2) + '\n');
  const processResult = await child(executable, [macro], { env: { ...env, JUDGE_REQUEST: requestPath }, startupMs, progressMs, deadline, log: path.join(out, 'freecad') });
  const protocol = parseFreecad(processResult, request);
  writeFileSync(path.join(out, 'protocol.json'), JSON.stringify({ ...protocol, results: [...protocol.results.values()], process: { ...processResult, stdout: undefined, stderr: undefined } }, null, 2) + '\n');
  return { ...protocol, elapsedMs: processResult.elapsedMs };
}

// The whole file gets the --info report. A 3MF with several objects is sliced one object at a time (input.slicePaths, written by the FreeCAD macro):
// PrusaSlicer 2.8.1 crashes (SIGSEGV) after its "gcode path conflicts" error whenever separate objects of one file overlap, as raised text on its plate does.
export async function sliceFile(input, { executable, out, logs, env, deadline = Infinity }) {
  const started = performance.now(), reasons = [], log = path.join(logs, input.key);
  mkdirSync(path.dirname(path.join(out, input.key)), { recursive: true });
  const info = await child(executable, ['--threads', '1', '--info', input.path], { env, timeoutMs: 15_000, deadline, log: `${log}.info` });
  let objects, layers = 0, extrusionMoves = 0, sliceExit = 0;
  const outputs = [], texts = [info.stdout, info.stderr];
  try { requireChild(info); objects = parseInfo(info.stdout + '\n' + info.stderr, input.format === 'stl' ? 1 : input.expectedObjects); } catch (e) { reasons.push(e.message); }
  const parts = input.slicePaths?.length ? input.slicePaths : [input.path], many = parts.length > 1;
  for (const [i, part] of parts.entries()) {
    const label = many ? `object ${i + 1}: ` : '', output = path.join(out, `${input.key}${many ? `.object${i + 1}` : ''}.gcode`);
    rmSync(output, { force: true });
    outputs.push(output);
    const slice = await child(executable, ['--threads', '1', '--load', profile, '--center', '0,0', '--dont-arrange', '--export-gcode', '--output', output, part], { env, timeoutMs: 60_000, deadline, log: `${log}${many ? `.object${i + 1}` : ''}.slice` });
    texts.push(slice.stdout, slice.stderr);
    sliceExit = slice.code ?? slice.signal ?? sliceExit;
    try {
      requireChild(slice);
      const diagnostics = slicerDiagnostics(slice.stdout + '\n' + slice.stderr);
      check(diagnostics.length === 0, `slicer diagnostic: ${diagnostics.join(' | ')}`);
      check(lstatSync(output).isFile() && !lstatSync(output).isSymbolicLink(), 'missing regular G-code output');
      const gcode = parseGcode(readFileSync(output, 'utf8'));
      layers += gcode.layers; extrusionMoves += gcode.extrusionMoves;
    } catch (e) { reasons.push(label + (e.code === 'ENOENT' ? 'missing G-code output' : e.message)); }
  }
  return { ok: reasons.length === 0, reasons, objects, infoExit: info.code, sliceExit, layers: layers || undefined, extrusionMoves: extrusionMoves || undefined, sliced: parts.length, elapsedMs: performance.now() - started, log, output: outputs[0], warnings: texts.join('\n').split('\n').filter(l => /warning/i.test(l)) };
}

export function summaryTable(results) {
  const lines = ['| Build | Format | Files | Pass | Fail | Seconds |', '| --- | --- | ---: | ---: | ---: | ---: |'];
  for (const build of BUILDS) for (const format of FORMATS) {
    const rows = results.filter(r => r.build === build && r.format === format), pass = rows.filter(r => r.ok).length;
    lines.push(`| ${build} | ${format} | ${rows.length} | ${pass} | ${rows.length - pass} | ${(rows.reduce((s, r) => s + r.elapsedMs, 0) / 1000).toFixed(2)} |`);
  }
  const pass = results.filter(r => r.ok).length;
  lines.push(`| Total | | ${results.length} | ${pass} | ${results.length - pass} | ${(results.reduce((s, r) => s + r.elapsedMs, 0) / 1000).toFixed(2)} |`);
  return lines.join('\n');
}

// A FreeCAD self-crossing of at most 0.01 mm only comes from near-duplicate vertices and warns; a longer one fails. An empty, missing or nonfinite
// measurement never passes. Each failure is its own list entry, so a known-defect exemption can only clear the failure it names.
export const CROSSING_LIMIT_MM = 0.01;
export function classifyCrossings(crossings = []) {
  const failures = [], warnings = [];
  for (const c of crossings) {
    const where = `mesh ${c.mesh ?? 0} component ${c.component}`;
    if (!Number.isFinite(c.count) || c.count <= 0 || c.finite !== true || !Number.isFinite(c.longest_mm)) failures.push(`FreeCAD self-intersection without a usable measurement (${where})`);
    else if (c.longest_mm > CROSSING_LIMIT_MM) failures.push(`FreeCAD self-intersection longer than ${CROSSING_LIMIT_MM} mm (${c.longest_mm.toFixed(4)} mm, ${where})`);
    else warnings.push(`FreeCAD self-intersection of at most ${c.longest_mm.toFixed(6)} mm (${where}; near-duplicate vertices)`);
  }
  return { failures, warnings };
}
export function nativeVerdict(result) {
  if (!result) return { failures: ['missing FreeCAD result'], warnings: [] };
  const details = result.details || {}, crossing = classifyCrossings(details.crossings);
  const failures = result.ok ? [] : (Array.isArray(details.failures) && details.failures.length ? [...details.failures] : [result.reason]);
  return { failures: [...failures, ...crossing.failures], warnings: [...(details.warnings || []), ...crossing.warnings] };
}

// test/judge-known.json lists files that fail for a named defect that has a follow-up. A listed file that fails only for that defect passes with a warning;
// a listed file that passes fails the judge, so the list can only shrink. entry: { match (regex every failure reason must match), defect, followUp }.
export function readKnown(root = ROOT) {
  const file = path.join(root, 'test/judge-known.json');
  return existsSync(file) ? json(file) : {};
}
export function knownName(row) { return row.fixture.replace(/\.json$/, '') + '.' + row.format; }
export function applyKnown(results, known) {
  const problems = [], names = new Set(results.map(knownName));
  for (const [name, entry] of Object.entries(known)) {
    if (![entry?.match, entry?.defect, entry?.followUp].every(v => typeof v === 'string' && v)) problems.push(`judge-known.json: ${name} needs match, defect and followUp`);
    if (!names.has(name)) problems.push(`judge-known.json: ${name} is not a golden file; remove it`);
  }
  for (const row of results) {
    row.warnings ||= [];
    const name = knownName(row), entry = known[name];
    if (!entry || problems.length) continue;
    if (row.reasons.length === 0) { row.reasons.push(`${name} is listed in test/judge-known.json but passes; remove it from judge-known.json`); continue; }
    const pattern = new RegExp(entry.match, 'i');
    if (row.reasons.every(reason => pattern.test(reason))) {
      row.known = entry; row.warnings.push(`known defect: ${entry.defect}; follow-up: ${entry.followUp}`); row.reasons = [];
    }
  }
  return problems;
}

// Every file's measured values are printed pass or fail, so a first run with no reviewed solid counts can be copied into judge-solids.json after review.
export function measurements(results, inputs = []) {
  const lines = [], rows = [], solids = {}, disagree = [];
  for (const row of results) {
    const d = row.native?.details, s = row.slicer, expected = inputs.find(i => i.key === row.key);
    const m = { key: row.key, ok: row.ok };
    if (row.format === 'step') {
      Object.assign(m, { solids: d?.solids, valid: d?.valid, closed: d?.closed, shells: d?.shells, shellsClosed: d?.shellsClosed, solidChecks: d?.solidChecks, volume: d?.volume, expectedVolume: expected?.expectedVolume, deltaPercent: d?.deltaPercent });
      if (Number.isInteger(d?.solids)) {
        if (solids[row.fixture] !== undefined && solids[row.fixture] !== d.solids) disagree.push(row.fixture);
        solids[row.fixture] ??= d.solids;
      }
      lines.push(`MEASURED ${row.key} solids=${d?.solids} valid=${d?.valid} closed=${d?.closed} shells_closed=${JSON.stringify(d?.shellsClosed)} volume=${d?.volume?.toFixed(3)} expected=${expected?.expectedVolume?.toFixed(3)} delta=${d?.deltaPercent?.toFixed(4)}%`);
    } else {
      Object.assign(m, { meshes: d?.meshes, infoExit: s?.infoExit, sliceExit: s?.sliceExit, layers: s?.layers, extrusionMoves: s?.extrusionMoves, infoObjects: s?.objects, warnings: s?.warnings });
      const meshes = (d?.meshes || []).map(x => `facets=${x.facets} open=${x.open_edges} nonmanifold=${x.nonmanifold_edges} isSolid=${x.isSolid} components=${x.components}`).join(' | ');
      lines.push(`MEASURED ${row.key} ${meshes} info_exit=${s?.infoExit} slice_exit=${s?.sliceExit} layers=${s?.layers} info_volume=${(s?.objects || []).map(o => o.volume).join(',')}`);
    }
    rows.push(m);
  }
  if (disagree.length) lines.push(`MEASURED solid counts differ between builds: ${disagree.join(', ')}`);
  return { solids: Object.fromEntries(Object.entries(solids).sort()), disagree, lines, rows };
}

export async function main() {
  const start = performance.now(), deadline = Date.now() + 8 * 60_000, runId = process.env.JUDGE_RUN_ID;
  const base = path.join(ROOT, 'test-results/judge');
  mkdirSync(base, { recursive: true });
  for (const name of ['output', 'logs', 'run']) { rmSync(path.join(base, name), { recursive: true, force: true }); mkdirSync(path.join(base, name)); }
  rmSync(path.join(base, 'summary.json'), { force: true });
  const files = discover(), errors = [], versions = {}, results = [];
  for (const build of BUILDS) for (const fixture of files) for (const format of FORMATS) results.push({ key: fileKey({ build, fixture, format }), build, fixture, format, ok: false, reasons: [], elapsedMs: 0 });
  results.sort((a, b) => a.key.localeCompare(b.key));
  console.log(`Export judge: run=${runId || '(missing)'} designs=${files.length} profile_sha256=${sha256(readFileSync(profile))}`);
  let inputs;
  try { inputs = validateInputs(ROOT, runId, { measure: true }); } catch (e) { errors.push(e.message); }
  const env = isolatedEnvironment(path.join(base, 'run/home'));
  let prusa, freecad;
  try { prusa = resolveExecutable(process.env.PRUSA_SLICER || 'prusa-slicer'); } catch (e) { errors.push(e.message); }
  try { freecad = resolveExecutable(process.env.FREECAD_CMD || 'freecadcmd'); } catch (e) { errors.push(e.message); }
  if (prusa) {
    try {
      const version = await child(prusa, ['--help'], { env, timeoutMs: 15_000, deadline, log: path.join(base, 'logs/prusa-version') });
      requireChild(version);
      versions.prusa = version.stdout.split('\n')[0];
      console.log(versions.prusa);
      check(versions.prusa === `PrusaSlicer-${PRUSA_VERSION} based on Slic3r (with GUI support)`, 'unpinned PrusaSlicer version');
      const resolved = path.join(base, 'run/resolved-prusa.ini');
      const saved = await child(prusa, ['--threads', '1', '--load', profile, '--save', resolved], { env, timeoutMs: 15_000, deadline, log: path.join(base, 'logs/prusa-profile') });
      requireChild(saved);
      check(readFileSync(resolved).length > 0 && slicerDiagnostics(saved.stdout + '\n' + saved.stderr).length === 0, 'invalid resolved profile');
    } catch (e) { errors.push(e.message); prusa = undefined; }
  }
  if (inputs && freecad) {
    const batch = await freecadBatch(inputs, { executable: freecad, out: path.join(base, 'run'), env, runId, deadline });
    versions.freecad = batch.version;
    console.log(`FreeCAD: ${JSON.stringify(batch.version)}`);
    errors.push(...batch.errors);
    for (const row of results) {
      const result = batch.results.get(row.key);
      row.native = result;
      const split = result?.details?.splitFiles;
      if (split) inputs.find(i => i.key === row.key).slicePaths = split;
      row.elapsedMs += result?.elapsedMs || 0;
      const verdict = nativeVerdict(result);
      row.reasons.push(...verdict.failures);
      row.warnings = verdict.warnings;
      const wanted = inputs.find(i => i.key === row.key).expectedSolids;
      if (row.format === 'step' && result?.ok && wanted === null) row.reasons.push(`no reviewed solid count in test/judge-solids.json (measured ${result.details.solids})`);
    }
  }
  if (inputs && prusa) {
    const queue = inputs.filter(f => f.format !== 'step');
    await Promise.all([0, 1, 2].map(async () => {
      while (queue.length) {
        const input = queue.shift(), row = results.find(r => r.key === input.key);
        if (Date.now() >= deadline) { row.reasons.push('total judge deadline exceeded'); continue; }
        try {
          row.slicer = await sliceFile(input, { executable: prusa, out: path.join(base, 'output'), logs: path.join(base, 'logs'), env, deadline });
          row.elapsedMs += row.slicer.elapsedMs;
          row.reasons.push(...row.slicer.reasons);
        } catch (e) { row.reasons.push(e.message); }
      }
    }));
  }
  if (Date.now() >= deadline) errors.push('total judge deadline exceeded');
  let known = {};
  try { known = readKnown(); } catch (e) { errors.push(`judge-known.json: ${e.message}`); }
  for (const row of results) {
    row.reasons.push(...errors);
    if (!row.native) row.reasons.push('native check unavailable');
    if (row.format !== 'step' && !row.slicer) row.reasons.push('slicer check unavailable');
  }
  const knownProblems = applyKnown(results, known);
  for (const problem of knownProblems) console.log(`FAIL ${problem}`);
  for (const row of results) {
    row.ok = row.reasons.length === 0;
    const d = row.native?.details, expected = inputs?.find(i => i.key === row.key);
    const detail = row.ok ? row.format === 'step'
      ? `solids=${d.solids}/${expected.expectedSolids} volume=${d.volume.toFixed(2)} expected=${expected.expectedVolume.toFixed(2)} delta=${d.deltaPercent.toFixed(3)}%`
      : `raw_topology=OK slicer=OK layers=${row.slicer.layers}` : row.reasons.join('; ');
    console.log(`${row.ok ? 'PASS' : 'FAIL'}${row.known ? ' (known defect)' : ''} ${row.key} ${row.ok && row.known ? '' : detail} ${(row.elapsedMs / 1000).toFixed(2)}s log=${row.slicer?.log || path.join(base, 'run/freecad')}`);
  }
  for (const row of results) for (const warning of row.warnings || []) console.log(`WARN ${row.key} ${warning}`);
  const warningCount = results.reduce((n, r) => n + (r.warnings || []).length, 0), knownCount = results.filter(r => r.known).length;
  const measured = measurements(results, inputs);
  console.log(`\nMEASURED values, one line per file (also in test-results/judge/measurements.json):`);
  for (const line of measured.lines) console.log(line);
  console.log(`JUDGE_SOLIDS_MEASURED ${JSON.stringify(measured.solids)}`);
  writeFileSync(path.join(base, 'measurements.json'), JSON.stringify(measured, null, 2) + '\n');
  const table = summaryTable(results), elapsedMs = performance.now() - start;
  console.log(`\n${table}\nWarnings: ${warningCount}; known defects (test/judge-known.json, must only shrink): ${knownCount} files\nWall seconds: ${(elapsedMs / 1000).toFixed(2)} (deadline: 480)`);
  writeFileSync(path.join(base, 'summary.json'), JSON.stringify({ runId, versions, profileSha256: sha256(readFileSync(profile)), designs: files.length, elapsedMs, errors, knownProblems, warningCount, knownCount, results }, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nExport judge: ${runId}; ${files.length} designs; wall ${(elapsedMs / 1000).toFixed(2)} s; ${warningCount} warnings; ${knownCount} known-defect files.\n\n${table}\n`);
  return results.length > 0 && results.every(r => r.ok) && knownProblems.length === 0 && errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(`Export judge failed: ${error.stack}`); process.exitCode = 1; });
}
