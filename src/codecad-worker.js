// jumpstart-3d: Code CAD, worker side. Runs a replicad function body in a TEMPORARY worker (src/worker.js started
// by src/codecadclient.js), checks that it made one closed solid, writes it as STEP and proves the app can read that STEP
// back through the same step-body path the design will use. The temporary worker is thrown away afterwards, so code that
// misuses the engine cannot damage the design's own worker.
// Locked down (lockDown below, once, after the engine has loaded and before the first user code): no network (fetch, XMLHttpRequest,
// WebSocket, EventSource, WebTransport, sendBeacon), no browser storage (indexedDB, caches, navigator.storage), no other workers or
// scripts (Worker, SharedWorker, BroadcastChannel, importScripts, import()), and no code built from text (Function and its async and
// generator relatives, eval, setTimeout or setInterval with a string). That closes the doors the code could use; it is not a proof.
// Still NOT a sandbox guarantee: the code can use all the CPU and memory it likes (the timeout and Cancel on the page side stop a
// runaway worker, they do not limit it), and it can post any message (self.postMessage). The page never trusts the answer: it
// builds the STEP bytes again in the design's own worker before using them (src/codecad.js). Everything here is a friendly early check.
import * as replicad from "replicad";
import { errorText } from "./kernel.js";

const NO_CODE = "Code CAD cannot build new code from text.";
const NO_IMPORT = "Code CAD code cannot load other files (import). Everything it needs is in replicad.";
const makeFn = Function; // our own use (compiling the user's text); the global Function is replaced by lockDown()
// What the code must not reach. Each is hidden on the global object (and on its prototypes, where the browser keeps it).
const BLOCKED_GLOBALS = ["fetch", "Request", "XMLHttpRequest", "WebSocket", "WebSocketStream", "EventSource", "WebTransport", "RTCPeerConnection",
  "importScripts", "Worker", "SharedWorker", "BroadcastChannel", "indexedDB", "IDBFactory", "caches", "CacheStorage", "open",
  "webkitRequestFileSystem", "webkitRequestFileSystemSync", "requestFileSystemSync"];
const BLOCKED_NAVIGATOR = ["sendBeacon", "storage", "serviceWorker"];
// import( ... ) and import.meta, also with a comment between the word and the bracket or dot
const IMPORT_USE = /\bimport\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*[(.]/;

// The geometry engine (emscripten embind, third_party/replicad-opencascadejs) builds two kinds of small functions from text, the second
// one lazily, while geometry runs: the wrapper around each C++ method (craftInvokerFunction) and the caller for each C++-to-JS call
// (emval methodCaller). Without these the engine itself stops, so blocked() below lets exactly those two fixed shapes through: parameter
// names that are plain identifiers, and a body that matches the whole template with only identifiers and numbers in its gaps. Anything
// else, including every string the user's code could write that is not that exact text, is refused. Another engine build may use other
// shapes; every build would then fail with "cannot build new code from text", which the tests show at once.
const ID = "[A-Za-z_$][\\w$]*";
const WIRED = "(?:thisWired|arg\\d+Wired)";
const CALL = "(?:toValue\\(handle\\)(?:\\[getStringOrSymbol\\(methodName\\)\\])?|new \\(toValue\\(handle\\)\\))?\\((?:argFromPtr\\d+\\(args(?:\\+\\d+)?\\)(?:,argFromPtr\\d+\\(args(?:\\+\\d+)?\\))*)?\\)";
const ENGINE_BODIES = [
  new RegExp("^return function \\((?:arg\\d+(?:,arg\\d+)*)?\\) \\{\\n(?:var destructors = \\[\\];\\n)?(?:var thisWired = toClassParamWire\\((?:destructors|null), this\\);\\n)?"
    + "(?:var arg\\d+Wired = toArg\\d+Wire\\((?:destructors|null), arg\\d+\\);\\n)*(?:var rv = )?invoker\\(" + ID + "(?:," + ID + ")*\\);\\n"
    + "(?:runDestructors\\(destructors\\);\\n|(?:" + WIRED + "_dtor\\(" + WIRED + "\\);\\n)*)(?:var ret = fromRetWire\\(rv\\);\\nreturn ret;\\n)?\\}\\n$"),
  new RegExp("^return function \\(handle, methodName, destructorsRef, args\\) \\{\\n(?:return emval_returnValue\\(toReturnWire, destructorsRef, " + CALL + "\\)|" + CALL + ")\\n\\}$"),
];
const NAME = new RegExp("^" + ID + "$");
// args of an engine call: (array of identifiers, body text). Returns { names, body } as plain strings, or null. Strings are copied out
// of the arrays once here, so the array's own join() cannot add anything after the check.
function engineFunction(args) {
  if (args.length !== 2 || !Array.isArray(args[0]) || typeof args[1] !== "string") return null;
  const list = args[0], names = [];
  for (let i = 0, n = list.length; i < n; i++) {
    const name = list[i];
    if (typeof name !== "string" || !NAME.test(name)) return null;
    names.push(name);
  }
  return ENGINE_BODIES.some((re) => re.test(args[1])) ? { names: names.join(","), body: args[1] } : null;
}

let locked = false;
let lookedAt = ""; // the last blocked name the code touched, so an error like "x is not a function" can say what was not allowed

function hide(obj, name) {
  for (let o = obj; o; o = Object.getPrototypeOf(o)) {
    if (!Object.prototype.hasOwnProperty.call(o, name)) continue;
    try { Object.defineProperty(o, name, { get() { lookedAt = name; return undefined; }, set() {}, configurable: false }); }
    catch (e) { try { delete o[name]; } catch (e2) {} }
  }
}
function pin(obj, name, value) {
  Object.defineProperty(obj, name, { value, writable: false, configurable: false });
}

// Once per temporary worker: after the engine has loaded (loading it needs fetch) and before the first user code.
function lockDown() {
  if (locked) return;
  locked = true;
  const blocked = function (...args) {
    const shape = engineFunction(args);
    if (!shape) throw new Error(NO_CODE);
    return makeFn(shape.names, shape.body);
  };
  pin(blocked, "prototype", Function.prototype);
  const AsyncFunction = Object.getPrototypeOf(async function () {});
  const GeneratorFunction = Object.getPrototypeOf(function* () {});
  const AsyncGeneratorFunction = Object.getPrototypeOf(async function* () {});
  for (const proto of [Function.prototype, AsyncFunction, GeneratorFunction, AsyncGeneratorFunction]) pin(proto, "constructor", blocked);
  pin(self, "Function", blocked); // `Function("...")` itself, not only `x.constructor("...")`
  pin(self, "eval", blocked);
  for (const name of ["setTimeout", "setInterval"]) {
    const real = self[name];
    pin(self, name, function (handler, ...rest) {
      if (typeof handler !== "function") throw new Error(NO_CODE);
      return real.call(self, handler, ...rest);
    });
  }
  for (const name of BLOCKED_GLOBALS) hide(self, name);
  if (self.navigator) for (const name of BLOCKED_NAVIGATOR) hide(self.navigator, name);
}

const WRONG_TYPE = "The code must return one solid, not a drawing, sketch, face, line, list or nothing. Extrude or revolve a sketch to make a solid.";

function solidsOf(shape, OC) {
  const found = [];
  const ex = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try { for (; ex.More(); ex.Next()) found.push(replicad.cast(OC.TopoDS.Solid(ex.Current()))); }
  finally { ex.delete(); }
  return found;
}
function hasLooseFaces(shape, OC) {
  const ex = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_FACE, OC.TopAbs_ShapeEnum.TopAbs_SOLID);
  try { return ex.More(); } finally { ex.delete(); }
}

// code: a function body that gets `replicad` and `params` and returns one solid. params: { alias: millimetres }.
export async function runCodeCad({ code, params }) {
  if (IMPORT_USE.test(code)) throw new Error(NO_IMPORT); // building code from text is blocked, so reading the text is enough to catch import()
  lockDown();
  let fn;
  try { fn = new makeFn("replicad", "params", '"use strict";\n' + code); }
  catch (e) { throw new Error("The code has a syntax error: " + e.message); }
  let result;
  lookedAt = "";
  try { result = fn(replicad, Object.freeze({ ...params })); }
  catch (e) {
    const m = errorText(e);
    if (lookedAt) throw new Error(`The code stopped with an error: Code CAD code cannot use the network, browser storage or other workers (${lookedAt}). Everything it needs is in replicad. (${m})`);
    throw new Error("The code stopped with an error: " + (/^(Standard_|BRep|StdFail)/.test(m) ? `the geometry engine refused a step (${m}). Check for sizes of zero or less.` : m));
  }

  if (result && typeof result.then === "function") throw new Error("The code returned a promise. Return the solid itself (no async or await).");
  if (!replicad.isShape3D(result)) throw new Error(WRONG_TYPE);
  const OC = replicad.getOC();
  const solids = solidsOf(result, OC);
  if (!solids.length) throw new Error("The code returned a surface, not a closed solid. Close it, or extrude a sketch to make a solid.");
  if (solids.length > 1) throw new Error(`The code returned ${solids.length} separate pieces. Move them so they touch, then join them with .fuse().`);
  if (hasLooseFaces(result, OC)) throw new Error("The code returned a solid with loose surfaces next to it. Return the solid alone.");
  const solid = solids[0];
  const check = new OC.BRepCheck_Analyzer(solid.wrapped, true, false);
  let valid;
  try { valid = check.IsValid(); } finally { check.delete(); }
  if (!valid) throw new Error("The solid is not valid (it may have faces that cross each other or a gap). Simplify the shape or change a size.");
  const volume = replicad.measureVolume(solid);
  if (!(volume > 1e-6)) throw new Error("The solid has no volume (it is flat, empty, or turned inside out).");

  // The page does not trust this answer (the code above can post any message): it builds the bytes again in the design's own worker before using them.
  return { bytes: await solid.blobSTEP().arrayBuffer() };
}
