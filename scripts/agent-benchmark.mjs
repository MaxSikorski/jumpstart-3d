#!/usr/bin/env node
// A trace recorder for a real agent, not a scripted CAD-plan benchmark.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { AGENT_TASKS, agentTask } from "../benchmarks/agent-tasks.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAX_BYTES = 32 * 1024 * 1024;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const near = (actual, expected, tolerance = 0.15) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;

export function inspectStl(bytes) {
  if (bytes.length < 134 || bytes.length > MAX_BYTES || bytes.length !== 84 + bytes.readUInt32LE(80) * 50) throw new Error("Invalid bounded binary STL");
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let degenerate = 0;
  for (let offset = 84; offset < bytes.length; offset += 50) {
    const points = Array.from({ length: 3 }, (_, vertex) => Array.from({ length: 3 }, (_, axis) => bytes.readFloatLE(offset + 12 + vertex * 12 + axis * 4)));
    for (const point of points) for (let axis = 0; axis < 3; axis++) {
      if (!Number.isFinite(point[axis])) throw new Error("Non-finite STL coordinate");
      min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]);
    }
    const u = points[1].map((v, i) => v - points[0][i]), v = points[2].map((v, i) => v - points[0][i]);
    if (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) <= 1e-12) degenerate++;
  }
  return { triangles: bytes.readUInt32LE(80), byteLength: bytes.length, degenerate, dimensions: Object.fromEntries(["x", "y", "z"].map((axis, i) => [axis, max[i] - min[i]])) };
}

// Evaluates captured readbacks, never the submitted plan's asserted dimensions.
export function evaluateSession(session) {
  const task = agentTask(session.taskId), candidate = session.checkpoints?.candidate;
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  check("candidate-captured", candidate?.document?.bodies?.length === 1, "Exactly one final model is required");
  check("kernel-errors", candidate?.document?.bodies?.length > 0 && candidate.document.bodies.every((body) => !body.error && body.volume > 0), "Live kernel readback must report valid nonempty solids");
  for (const [axis, expected] of Object.entries(task.dimensions)) check(`export-dimension-${axis}`, near(candidate?.stl?.dimensions?.[axis], expected), { expected, measured: candidate?.stl?.dimensions?.[axis], tolerance: 0.15 });
  check("stl-finite-nondegenerate", candidate?.stl?.triangles > 0 && candidate.stl.degenerate === 0, candidate?.stl || "No live export captured");
  const meshInspection = (session.calls || []).find((call) => call.name === "jumpstart_inspect_geometry" && !call.error && call.result?.revision === candidate?.document?.revision && call.result?.meshValidation);
  check("mesh-topology", meshInspection?.result?.meshValidation?.valid === true, meshInspection?.result?.meshValidation || "Capture live mesh topology inspection; a finite STL alone does not establish manifoldness");
  check("editable-history", candidate?.document?.bodies?.every((body) => body.featureTree && body.featureTree.t !== "mesh"), "Native feature readback required; mesh scaling is a separate test");
  const calls = session.calls || [];
  const successful = (name) => calls.filter((call) => call.name === name && !call.error);
  const previews = [...successful("jumpstart_preview_model"), ...successful("jumpstart_preview_parameters")].filter((call) => call.result?.valid);
  const applies = successful("jumpstart_apply_model");
  check("preview-before-apply", applies.length > 0 && applies.every((apply) => previews.some((preview) => preview.result.previewId === apply.args.previewId && preview.sequence < apply.sequence)), "Every recorded apply must follow its successful preview");
  for (const requirement of task.requires) {
    if (requirement === "undo") check("undo-restores-baseline", session.checkpoints?.undone?.document?.revision === session.baseline.revision && successful("jumpstart_undo").length > 0, "Capture checkpoint 'undone' after restoring the baseline");
    else if (requirement === "images") check("preview-images", previews.some((call) => call.images >= 4 && ["top", "side", "isometric", "section"].every((view) => call.result.images?.some((image) => image.view === view))), "Actual top, side, isometric and section images must be returned");
    else if (requirement === "retry") {
      const retry = applies.some((call, i) => applies.slice(0, i).some((prior) => prior.args.previewId === call.args.previewId && prior.result.revision === call.result.revision));
      check("idempotent-retry", retry, "Repeat the same successful preview ID and verify its returned revision stays unchanged");
    } else if (requirement === "stale") check("stale-rejected", calls.some((call) => call.name === "jumpstart_apply_model" && /document changed|changed after preview/i.test(call.error || "")), "An outdated preview must be rejected by the server");
    else if (requirement === "rejected-request") check("invalid-request-preserves-document", calls.some((call) => (call.error || call.result?.valid === false) && call.beforeRevision === call.afterRevision), "Record an actual rejected request and unchanged live revision");
    else if (requirement === "reopen") check("save-reopen", session.checkpoints?.reopened?.document?.revision === candidate?.document?.revision && successful("jumpstart_save_document").length > 0 && successful("jumpstart_reopen_document").length > 0, "Requires recorded native save/open operations and a matching 'reopened' checkpoint");
    else if (requirement === "parameters") check("persistent-parameters", Array.isArray(candidate?.document?.parametricModels) && candidate.document.parametricModels.length > 0, "Named parameters must appear in live document readback");
    else if (requirement === "channels") {
      const inspection = successful("jumpstart_inspect_geometry").filter((call) => call.result?.revision === candidate?.document?.revision);
      const channelCheck = inspection.flatMap((call) => (call.result?.checks || []).map((result) => ({ result, requested: call.args.checks?.find((entry) => entry.id === result.id) }))).find(({ result, requested }) => result.pass === true && requested?.kind === "channels" && requested.expected?.count === task.channelRequirements.count && requested.expected?.width === task.channelRequirements.width && requested.expected?.depth === task.channelRequirements.depth);
      check("channels-measured", !!channelCheck, "Live section measurements must independently verify count, width and depth on the candidate revision");
      const measured = channelCheck?.result?.measured;
      check("channel-dimensions-independent", measured?.count === task.channelRequirements.count && near(measured?.width, task.channelRequirements.width) && near(measured?.depth, task.channelRequirements.depth), { expected: task.channelRequirements, measured });
      const spacings = measured?.spacings;
      check("channel-spacing-uniform", Array.isArray(spacings) && spacings.length === task.channelRequirements.count - 1 && spacings.every((spacing) => spacing > 0 && near(spacing, spacings[0], 0.05)), { measured: spacings, tolerance: 0.05 });
      check("channels-open-symmetric", measured?.openEnds === true && measured?.symmetric === true, "Section measurements must establish both open ends and symmetry; unreported means unverified");
      const baselineInspection = successful("jumpstart_inspect_geometry").find((call) => call.result?.revision === session.baseline.revision);
      const baselineFloor = baselineInspection?.result?.checks?.find((entry) => entry.measured?.floor !== undefined)?.measured.floor;
      check("floor-preserved", near(measured?.floor, baselineFloor, 0.05), { baseline: baselineFloor, candidate: measured?.floor, tolerance: 0.05 });
    } else if (requirement === "corrected-depth") {
      const inspections = successful("jumpstart_inspect_geometry").filter((call) => call.result?.revision === candidate?.document?.revision);
      const channelMeasurements = inspections.flatMap((call) => call.result?.checks || []).map((entry) => entry.measured).filter(Boolean);
      check("corrected-depth-and-floor", channelMeasurements.some((measured) => near(measured.depth, 3, 0.05) && measured.floor >= 1.95), "Actual corrected geometry must have 3 mm channel depth and at least 2 mm floor");
    } else if (requirement === "tray-sections") {
      const inspections = successful("jumpstart_inspect_geometry").filter((call) => call.result?.revision === candidate?.document?.revision);
      const samples = inspections.flatMap((call) => call.result?.measurements?.samples || call.result?.samples || []);
      const lengths = (sample) => (sample.intervals || []).map(([a,b]) => b-a);
      const gaps = (sample) => (sample.intervals || []).slice(1).map(([a],i) => a-sample.intervals[i][1]);
      const sampleMatches = (axis, solid, empty) => samples.some((sample) => !sample.ambiguous && sample.axis?.toUpperCase() === axis && lengths(sample).length === solid.length && lengths(sample).every((value,i) => near(value,solid[i],0.05)) && gaps(sample).every((value,i) => near(value,empty[i],0.05)));
      check("tray-walls-divider-compartments", sampleMatches("X", [2,2,2], [25,52]) || sampleMatches("X", [2,2,2], [52,25]), "An X section through the cavities must measure 2 mm walls/divider and 25/52 mm clear lengths");
      check("tray-short-axis-walls", sampleMatches("Y", [2,2], [53]), "A Y section through a cavity must measure 2 mm walls and 53 mm clearance");
      check("tray-floor-and-height", sampleMatches("Z", [2], []) && sampleMatches("Z", [12], []), "Vertical samples must establish a 2 mm floor and a 12 mm full-height wall or divider");
    } else check(requirement, false, "Not independently measured by this runner yet; plan values and agent claims are not evidence");
  }
  return { taskId: task.id, pass: checks.every((entry) => entry.pass), checks, agentReasoning: "External agent supplied every tool argument; this recorder does not generate plans or score reasoning from model identity", recordedCalls: calls.length };
}

async function boundedJson(path) {
  const bytes = await readFile(path);
  if (bytes.length > MAX_BYTES) throw new Error("JSON file exceeds 32 MiB");
  return JSON.parse(bytes.toString("utf8"));
}
async function request(endpoint, name, args) {
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), signal: AbortSignal.timeout(180000) });
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("MCP response exceeds 32 MiB");
  const envelope = JSON.parse(text);
  if (!response.ok || envelope.error) throw new Error(envelope.error?.message || `HTTP ${response.status}`);
  const result = envelope.result;
  const block = result?.content?.find((entry) => entry.type === "text");
  const value = block ? JSON.parse(block.text) : result;
  if (result?.isError) throw new Error(value?.error || "MCP tool failed");
  const imageBlocks = result?.content?.filter((entry) => entry.type === "image") || [];
  return { value, images: imageBlocks.length, imageBlocks };
}
async function main(argv) {
  const [command, sessionPath, ...args] = argv;
  if (command === "tasks") { process.stdout.write(`${JSON.stringify(AGENT_TASKS, null, 2)}\n`); return; }
  if (!sessionPath || !["begin", "call", "checkpoint", "finish"].includes(command)) throw new Error("Usage: agent-benchmark.mjs tasks | begin SESSION TASK EDITOR_ID | call SESSION TOOL ARGS.json | checkpoint SESSION candidate|reopened|undone | finish SESSION");
  const path = resolve(sessionPath);
  let session;
  const endpoint = process.env.JUMPSTART_MCP_HTTP_URL || "http://127.0.0.1:3210/__mcp/rpc";
  if (command === "begin") {
    const task = agentTask(args[0]);
    if (!args[1]) throw new Error("Explicit editor ID required; this runner never chooses or clears a user's editor");
    const baseline = (await request(endpoint, "jumpstart_get_document", { editorId: args[1], includeGeometry: true })).value;
    if (task.id !== "coaster-revision" && (baseline.bodies.length || baseline.sketches.length)) throw new Error("This task requires an empty document; existing models are never overwritten automatically");
    if (task.id === "coaster-revision" && baseline.bodies.length !== 1) throw new Error("Coaster revision needs exactly one baseline model");
    session = { version: 1, taskId: task.id, request: task.request, editorId: args[1], endpoint, startedAt: new Date().toISOString(), baseline, calls: [], checkpoints: {} };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${task.request}\nSession: ${path}\n`); return;
  }
  session = await boundedJson(path);
  const call = async (name, input) => request(session.endpoint, name, ["jumpstart_get_capabilities", "jumpstart_list_editors"].includes(name) ? input : { ...input, editorId: session.editorId });
  if (command === "call") {
    if (!/^jumpstart_[a-z_]+$/.test(args[0] || "")) throw new Error("Expected a named JumpStart MCP tool");
    const input = await boundedJson(args[1]);
    if (input.editorId && input.editorId !== session.editorId) throw new Error("Cannot change editor within a session");
    const before = (await call("jumpstart_get_document", { includeGeometry: false })).value;
    const entry = { sequence: session.calls.length + 1, name: args[0], args: input, beforeRevision: before.revision, at: new Date().toISOString() };
    try {
      const response = await call(args[0], input); entry.result = response.value; entry.images = response.images;
      entry.imagePaths = [];
      for (let i = 0; i < response.imageBlocks.length; i++) {
        const image = response.imageBlocks[i];
        const imagePath = `${path}.call-${entry.sequence}.view-${i}.${image.mimeType === "image/png" ? "png" : "jpg"}`;
        await writeFile(imagePath, Buffer.from(image.data, "base64")); entry.imagePaths.push(imagePath);
      }
    }
    catch (error) { entry.error = error.message; }
    entry.afterRevision = (await call("jumpstart_get_document", { includeGeometry: false })).value.revision;
    session.calls.push(entry);
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  } else if (command === "checkpoint") {
    if (!["candidate", "reopened", "undone"].includes(args[0])) throw new Error("Unknown checkpoint label");
    const document = (await call("jumpstart_get_document", { includeGeometry: true })).value;
    const checkpoint = { document, capturedAt: new Date().toISOString(), traceLength: session.calls.length };
    if (args[0] === "candidate") {
      const exported = (await call("jumpstart_export_model", { format: "stl", name: `agent-${session.taskId}` })).value;
      const bytes = await readFile(join(ROOT, "exports", basename(exported.path)));
      checkpoint.stl = inspectStl(bytes); checkpoint.export = exported;
      checkpoint.stl.sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    session.checkpoints[args[0]] = checkpoint;
    process.stdout.write(`${JSON.stringify({ checkpoint: args[0], revision: document.revision })}\n`);
  } else {
    const report = evaluateSession(session);
    report.traceSha256 = digest(session);
    await writeFile(`${path}.report.json`, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exitCode = 1;
    return;
  }
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
