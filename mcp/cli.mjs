#!/usr/bin/env node
// jumpstart: run scripts and make files with JumpStart 3D from a terminal. Headless only: it starts its own invisible
// browser through session.mjs, never the MCP server and never the WebSocket port, so it cannot touch a tab or a running server.
// stdout carries the JSON result and nothing else; progress and errors go to stderr.
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Session } from "./session.mjs";
import { save, where } from "./tools.mjs";
import { MAX_BYTES, checkRecipe, isRecipe, substitute } from "./recipe.mjs";

const USAGE = `jumpstart: run scripts and make files with JumpStart 3D, in a headless browser.

Usage:
  jumpstart run <script.js> [--app <url|file|dir>]        run a script (JS3D in scope); prints its return value as JSON
  jumpstart export <project.json> <out.stl|obj|3mf|glb|step>  open a project and write an export file
  jumpstart build <design.json> [--export stl|obj|3mf|glb|step|json] [--out <file>] [--check] [--app ...]
                                                          build a project file or a recipe, then check it (--check) and export it
  jumpstart shot <project.json> <out.png> [--width N]     write a picture of the 3D view (default 800 pixels wide)
  jumpstart status [--app <url|file|dir>]                 start the app and print its versions and design as JSON

--app (or the JS3D_APP variable) is what to open: a web address, a .html file or a folder with the built site.
Without it: the docs/ folder of this checkout, else https://maxsikorski.github.io/jumpstart-3d/.
JS3D_VIEWPORT sets the window size (default 1000x700). Needs Chromium: npx playwright@1.62.1 install chromium

build takes a project file (as Save writes it) or a recipe: {"jumpstart":"recipe","version":1,"steps":[{"call":"add","args":["box",{"size":[60,40,25]}],"as":"box"}, ...]}.
"$box" in a later step's args is that step's result (its id; "$box.key" is a field). --check runs JS3D.printCheck().
Results are JSON on stdout. Exit codes: 0 ok, 1 the script, a recipe step or the app failed, 2 bad usage, 3 --check found problems.`;

const LONG = { timeoutMs: 600_000 }; // exports, pictures and scripts of big designs can take minutes
const KINDS = new Set(["stl", "obj", "3mf", "glb", "step"]);
const BUILD_KINDS = new Set([...KINDS, "json"]);
const ARITY = { run: 1, export: 2, build: 1, shot: 2, status: 0 }; // how many arguments each command takes

class Usage extends Error {} // bad usage: exit 2
class BuildFail extends Error { // a recipe step failed: exit 1, with {ok:false, step, call, error} on stdout
  constructor(step, call, error, named = true) { super(`step ${step}${named ? ` (${call})` : ""}: ${error}`); this.step = step; this.call = call; this.error = error; }
}

function parse(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const eq = /^--[^=]+=/.test(argv[i]) ? argv[i].indexOf("=") : -1; // --app=URL as well as --app URL
    const a = eq < 0 ? argv[i] : argv[i].slice(0, eq);
    if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--check") flags.check = true;
    else if (a === "--app" || a === "--width" || a === "--export" || a === "--out") {
      if (eq < 0 && i + 1 >= argv.length) throw new Usage(`${a} needs a value`);
      flags[a.slice(2)] = eq < 0 ? argv[++i] : argv[i].slice(eq + 1);
    } else if (a.startsWith("--")) throw new Usage(`unknown option ${a}`);
    else rest.push(a);
  }
  return { flags, rest };
}

// each command checks its arguments and reads its input before any browser starts, then returns the work to do
const COMMANDS = {
  async run([script]) {
    if (!script) throw new Usage("run needs a script file");
    const source = await readFile(where(script), "utf8");
    return (s) => s.call("run", [source], LONG);
  },
  async export([project, out]) {
    if (!project || !out) throw new Usage("export needs a project file and an output file");
    const kind = extname(out).slice(1).toLowerCase();
    if (!KINDS.has(kind)) throw new Usage(`export writes .stl, .obj, .3mf, .glb or .step, not "${extname(out) || out}"`);
    const text = await readFile(where(project), "utf8");
    return async (s) => { await s.call("load", [text], LONG); return save(out, await s.call("export", [kind, {}], LONG)); };
  },
  async build([file], flags) {
    if (!file) throw new Usage("build needs a design file (a project or a recipe)");
    const kind = flags.export === undefined ? undefined : String(flags.export).toLowerCase();
    if (kind !== undefined && !BUILD_KINDS.has(kind)) throw new Usage("--export must be stl, obj, 3mf, glb, step or json");
    if (flags.out !== undefined && kind === undefined) throw new Usage("--out needs --export");
    const path = where(file);
    const text = await readFile(path, "utf8");
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`${file} is larger than 5 MB`);
    let design;
    try { design = JSON.parse(text); } catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
    const recipe = isRecipe(design) ? checkRecipe(design) : null;
    const out = kind && (flags.out ?? join(dirname(path), basename(path, extname(path)) + "." + kind));
    return async (s) => {
      if (recipe) {
        const names = await s.call("run", ["return Object.keys(JS3D).filter((k) => typeof JS3D[k] === 'function' && k !== 'invoke')"]);
        const vars = {};
        for (const [i, st] of recipe.steps.entries()) {
          if (!names.includes(st.call)) throw new BuildFail(i + 1, st.call, `unknown call "${st.call}"; calls: ${names.join(", ")}`, false);
          try { const r = await s.call(st.call, substitute(st.args ?? [], vars), LONG); if (st.as !== undefined) vars[st.as] = r; }
          catch (e) { throw new BuildFail(i + 1, st.call, (e && e.message) || String(e)); }
        }
      } else await s.call("load", [text], LONG);
      await s.call("ready", [], LONG);
      const result = { ok: true, bodies: (await s.call("list")).map(({ id, name, bbox, volume }) => ({ id, name, bbox, volume })) };
      if (flags.check) {
        const has = await s.call("run", ["return typeof JS3D.printCheck === 'function'"]);
        result.check = has ? await s.call("printCheck", [], LONG) : { ok: null, note: "check needs bridge 1.10 (this app has no JS3D.printCheck)" };
      }
      if (kind) result.file = await save(out, await s.call("export", [kind, {}], LONG));
      if (result.check && result.check.ok === false) result.exitCode = 3; // read by main, never printed
      return result;
    };
  },
  async shot([project, out], flags) {
    if (!project || !out) throw new Usage("shot needs a project file and a .png output file");
    if (extname(out).toLowerCase() !== ".png") throw new Usage("shot writes a .png file");
    const width = flags.width === undefined ? 800 : Number(flags.width);
    if (!Number.isInteger(width) || width < 1 || width > 8192) throw new Usage("--width must be a whole number from 1 to 8192");
    const text = await readFile(where(project), "utf8");
    return async (s) => { await s.call("load", [text], LONG); return save(out, await s.call("screenshot", [{ fit: true, width }], LONG)); };
  },
  async status() {
    return async (s) => {
      await s.call("ready"); // the first call starts the browser
      const { app, js3d, design, designMode, bodies, url } = await s.status();
      return { app, js3d, design, designMode, bodies, url };
    };
  },
};

let stopping = false; // Ctrl-C: Playwright closes the browser itself, so the call in flight fails; that is not an error to report

async function main() {
  const { flags, rest } = parse(process.argv.slice(2));
  if (flags.help) { console.log(USAGE); return 0; }
  const [name, ...args] = rest;
  if (!name) { console.error(USAGE); return 2; }
  if (!Object.hasOwn(COMMANDS, name)) throw new Usage(`unknown command "${name}"`);
  if (args.length > ARITY[name]) throw new Usage(`${name} takes ${ARITY[name]} argument${ARITY[name] === 1 ? "" : "s"}, but got ${args.length}: ${args.join(" ")}`);
  const work = await COMMANDS[name](args, flags);
  const session = new Session({ mode: "headless", app: flags.app || process.env.JS3D_APP || undefined, viewport: process.env.JS3D_VIEWPORT || undefined, log: (m) => console.error("jumpstart: " + m) });
  const stop = async () => { stopping = true; await session.close().catch(() => {}); process.exit(130); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const result = await work(session);
    const code = (result && result.exitCode) || 0;
    if (code) delete result.exitCode;
    console.log(JSON.stringify(result === undefined ? null : result));
    return code;
  } finally {
    await session.close().catch(() => {});
  }
}

main().then(process.exit, (e) => {
  if (e instanceof BuildFail) console.log(JSON.stringify({ ok: false, step: e.step, call: e.call, error: e.error }));
  if (stopping) { console.error("jumpstart: stopped"); process.exit(130); }
  console.error("jumpstart: " + ((e && e.message) || e) + (e instanceof Usage ? "\nRun jumpstart --help for the commands." : ""));
  process.exit(e instanceof Usage ? 2 : 1);
});
