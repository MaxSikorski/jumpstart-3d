// jumpstart-3d: Code CAD. Open/Export > Code CAD… (and JS3D.codeCad): write replicad code, build ONE solid from it in a temporary
// worker (src/codecadclient.js, src/codecad-worker.js), and add it to the design as an ordinary STEP body. The code is kept on the
// body as inert text (body.codeCad = { version, code, bindings, lastValues }): opening a design, remeshing, exporting and working
// offline use the saved STEP, and the code runs again only when the user presses Update (or a script calls build). Named parameters
// are linked by id (params.width -> a parameter), so renaming a parameter needs no change to the code; changing one only marks the
// body "Update needed". A build changes the design in one undoable step, or not at all.
import { store, findBody, nextSeq, IDENTITY } from "./store.js";
import { uid, el, nextColor } from "./util.js";
import { nextName } from "./ops.js";
import { toB64 } from "./meshimport.js";
import { ICON } from "./icons.js";
import { runCodeJob, LIMITS } from "./codecadclient.js";

export const VERSION = 1;
const MAX_CODE = 100000;
const MAX_LINKS = 20;
const ALIAS = /^[A-Za-z_$][A-Za-z0-9_$]{0,39}$/;

export const EXAMPLES = [
  { title: "L bracket with two screw holes", name: "L bracket", code: [
    "// An L-shaped bracket. Sizes are in millimetres.",
    "const { makeBox, makeCylinder } = replicad;",
    "const base = makeBox([0, 0, 0], [60, 30, 4]);",
    "const wall = makeBox([0, 0, 0], [60, 4, 30]);",
    "let part = base.fuse(wall);",
    "for (const x of [12, 48]) part = part.cut(makeCylinder(3, 10, [x, 18, -1]));",
    "return part;" ].join("\n") },
  { title: "Plate that follows parameters", name: "Plate", code: [
    "// Link params.width, params.depth, params.thickness and params.hole to named parameters below.",
    "// A name that is not linked uses the number after ??",
    "const w = params.width ?? 40;",
    "const d = params.depth ?? 25;",
    "const t = params.thickness ?? 5;",
    "const hole = params.hole ?? 8;",
    "const plate = replicad.drawRoundedRectangle(w, d, 3).sketchOnPlane(\"XY\").extrude(t);",
    "return plate.cut(replicad.makeCylinder(hole / 2, t + 2, [0, 0, -1]));" ].join("\n") },
];

// ---------------------------------------------------------------- the request and its parameter links
function resolveSpec(spec) {
  spec = spec ?? {};
  const code = spec.code;
  if (typeof code !== "string" || !code.trim()) throw new Error("code must be the replicad code as text");
  if (code.length > MAX_CODE) throw new Error(`code can be at most ${MAX_CODE.toLocaleString("en-US")} characters (this has ${code.length.toLocaleString("en-US")})`);
  const bindings = spec.bindings ?? {};
  if (typeof bindings !== "object" || Array.isArray(bindings)) throw new Error('bindings must be an object like { width: "Width" }: the name the code uses, then the parameter');
  const entries = Object.entries(bindings);
  if (entries.length > MAX_LINKS) throw new Error(`bindings can have at most ${MAX_LINKS} links`);
  for (const [alias, ref] of entries) {
    if (!ALIAS.test(alias) || alias === "__proto__") throw new Error(`"${alias}" cannot be used as params.${alias}: use letters, digits, _ or $, starting with a letter`);
    if (typeof ref !== "string" || !ref) throw new Error(`params.${alias} must be linked to a parameter (its name or id)`);
  }
  const name = spec.name == null ? "" : String(spec.name).trim().slice(0, 80);
  if (spec.bodyId != null && typeof spec.bodyId !== "string") throw new Error("bodyId must be a body id");
  return { code, bindings: Object.fromEntries(entries), name, bodyId: spec.bodyId ?? null };
}
const paramFor = (doc, ref) => (doc.params || []).find((p) => p.id === ref) || (doc.params || []).find((p) => p.name.toLowerCase() === String(ref).toLowerCase());
// { ids: alias -> parameter id, values: alias -> mm } or an error that says what to fix
function resolveLinks(doc, bindings) {
  const ids = {}, values = {};
  for (const [alias, ref] of Object.entries(bindings)) {
    const p = paramFor(doc, ref);
    if (!p) throw new Error(`params.${alias} is linked to a parameter that does not exist (any more). Link it to another parameter, or remove the link.`);
    if (!isFinite(p.value)) throw new Error(`Parameter "${p.name}" (params.${alias}) has no valid value right now. Fix it in Parameters first.`);
    ids[alias] = p.id;
    values[alias] = p.value;
  }
  return { ids, values };
}

// does any node in the value (a body's node tree, tools and children included) point at this asset?
const usesAsset = (v, id) => !!v && typeof v === "object" && (v.asset === id || Object.values(v).some((x) => usesAsset(x, id)));

export function initCodeCad(app) {
  let job = null, working = false, loads = 0; // job: the temporary worker while the code runs; working: until the result is in the design or refused
  store.on((kind) => { if (kind === "load") loads++; }); // a design opened or started over: a result made for the one before is not used

  // what a parameter change did to a body's recipe: { needsUpdate, why[] }, or null for a body that has none
  function status(bodyId) {
    const b = findBody(store.doc, bodyId);
    if (!b || !b.codeCad) return null;
    const why = [];
    for (const [alias, ref] of Object.entries(b.codeCad.bindings || {})) {
      const p = paramFor(store.doc, ref);
      if (!p) why.push(`params.${alias} is linked to a parameter that was deleted`);
      else if (!isFinite(p.value)) why.push(`${p.name} has no valid value`);
      else if (Math.abs(p.value - (b.codeCad.lastValues || {})[alias]) > 1e-9) why.push(`${p.name} changed`);
    }
    return { needsUpdate: why.length > 0, why };
  }

  // spec: { code, bindings?: { alias: parameter name or id }, name?, bodyId? } -> the body's id. With bodyId the body is updated in place.
  async function build(spec) {
    const s = resolveSpec(spec);
    if (working) throw new Error("A Code CAD build is already running. Cancel it or wait for it to finish.");
    working = true;
    try { return await run(s); } finally { working = false; }
  }
  async function run(s) {
    if (!app.kernel || !app.kernel.ready) throw new Error("The geometry engine is still starting. Try again in a moment.");
    const doc = store.doc;
    const target = s.bodyId ? findBody(doc, s.bodyId) : null;
    if (s.bodyId && !(target && target.codeCad)) throw new Error("bodyId must be a body made with Code CAD");
    if (target && target.locked) throw new Error("This body is locked. Unlock it to update it.");
    const start = resolveLinks(doc, s.bindings), gen = loads;
    const mine = (job = runCodeJob(app.kernel, { code: s.code, params: start.values }, LIMITS));
    let out;
    try { out = await mine.done; } finally { if (job === mine) job = null; }

    // What came back is not trusted (the code ran in that worker and can post anything): the design's own worker builds the file as a
    // step body first, and it must be one solid with a volume.
    const asset = uid("a"); // a new id each time: an asset id always means the same bytes
    app.kernel.addAsset(asset, "step", out.bytes);
    const node = { t: "step", asset, keepPos: true, mods: [] };
    const seen = await app.kernel.probe({ id: asset, key: "codecad:" + asset, node });
    if (!seen.ok || seen.mesh.solidCount !== 1 || seen.mesh.hasNonSolidFaces || !(seen.mesh.volume > 1e-6)) {
      app.kernel.dropAsset(asset);
      throw new Error("The result could not be read back as one closed solid" + (seen.ok ? "." : ": " + seen.error));
    }

    // and it is only used if the design and the inputs are still the ones it was made for
    const stale = () => { app.kernel.dropAsset(asset); return new Error("The design changed while the code was running, so nothing was changed. Run it again."); };
    if (store.doc.id !== doc.id || loads !== gen) throw stale();
    let again;
    try { again = resolveLinks(store.doc, s.bindings); } catch (e) { throw stale(); }
    if (JSON.stringify([again.ids, again.values]) !== JSON.stringify([start.ids, start.values])) throw stale();
    if (target) {
      const now = findBody(store.doc, target.id);
      if (!now || now.locked || now.node.asset !== target.node.asset || JSON.stringify(now.codeCad) !== JSON.stringify(target.codeCad)) throw stale();
    }

    let id, dropped = null;
    const recipe = { version: VERSION, code: s.code, bindings: start.ids, lastValues: start.values };
    store.update((d) => {
      d.assets = d.assets || {};
      if (target) {
        const b = findBody(d, target.id), old = b.node.asset;
        d.assets[asset] = { kind: "step", name: b.name, data: toB64(out.bytes) };
        b.node.asset = asset;
        b.codeCad = recipe;
        id = b.id;
        if (!d.bodies.some((x) => usesAsset(x.node, old))) { delete d.assets[old]; dropped = old; } // undo brings it back with the older design
      } else {
        const label = s.name || "Code CAD";
        d.assets[asset] = { kind: "step", name: label, data: toB64(out.bytes) };
        d.bodies.push({ id: (id = uid("b")), name: nextName(d, label), seq: nextSeq(d), color: nextColor(), hole: false, hidden: false, m: IDENTITY.slice(), node, codeCad: recipe });
      }
    }, target ? "Update " + target.name : "Add " + (s.name || "Code CAD"));
    if (dropped) app.kernel.dropAsset(dropped);
    app.select([id]);
    return id;
  }

  // ---------------------------------------------------------------- the dialog
  function open(opts = {}) {
    if (document.querySelector(".modal-back.codecad")) return;
    const body = opts.bodyId ? findBody(store.doc, opts.bodyId) : null;
    if (opts.bodyId && !(body && body.codeCad)) { app.toast("That body was not made with Code CAD.", "err"); return; }
    const first = EXAMPLES[0];
    const st = body
      ? { code: body.codeCad.code, links: Object.entries(body.codeCad.bindings || {}).map(([alias, id]) => ({ alias, id })) }
      : { code: first.code, links: [] };
    let closed = false, building = false; // building: this dialog started the build that is running

    const close = () => { closed = true; if (building) api.cancel(); back.remove(); };
    const back = el("div", { class: "modal-back codecad", onclick: (e) => { if (e.target === back) close(); } });
    const err = el("div", { class: "err-msg", id: "cc-err", role: "alert", hidden: true, style: { marginTop: "8px", whiteSpace: "pre-wrap" } });
    const showErr = (text) => { err.textContent = text; err.hidden = !text; };
    const name = el("input", { class: "num", id: "cc-name", value: body ? body.name : first.name, "aria-label": "Name", style: { fontFamily: "var(--f-ui)" } });
    const example = el("select", { class: "num", id: "cc-example", "aria-label": "Start from an example" },
      el("option", { value: "" }, "Start from an example…"), ...EXAMPLES.map((x, i) => el("option", { value: String(i) }, x.title)));
    const code = el("textarea", { id: "cc-code", rows: 14, spellcheck: "false", autocapitalize: "off", autocomplete: "off", "aria-label": "Code",
      style: { width: "100%", boxSizing: "border-box", fontFamily: "var(--f-mono)", fontSize: "12.5px", lineHeight: "1.4", tabSize: 2, resize: "vertical" } });
    code.value = st.code;
    code.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") e.stopPropagation(); // typing here is not a shortcut for the 3D view
      if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); document.execCommand("insertText", false, "  "); }
    });
    code.addEventListener("input", () => { st.code = code.value; renderHints(); });
    const links = el("div", { id: "cc-links", style: { display: "grid", gap: "6px" } });
    const hints = el("div", { class: "hint", id: "cc-hints", style: { padding: 0, marginTop: "6px" } });
    const state = el("div", { class: "hint", id: "cc-state", role: "status", style: { padding: 0, marginTop: "8px" } });
    const run = el("button", { class: "btn primary", id: "cc-run", onclick: () => go() }, body ? "Update" : "Build");
    const cancel = el("button", { class: "btn", id: "cc-cancel", hidden: true, onclick: () => api.cancel() }, "Cancel build");
    const add = el("button", { class: "btn", id: "cc-add-link", style: { marginTop: "6px" }, onclick: () => { if (st.links.length < MAX_LINKS) { st.links.push({ alias: "", id: "" }); renderLinks(); } } }, "Link a parameter");
    const shut = el("button", { class: "btn", id: "cc-close", onclick: close }, "Close");

    example.onchange = () => {
      const x = EXAMPLES[+example.value];
      example.value = "";
      if (!x) return;
      code.value = st.code = x.code;
      if (!body) name.value = x.name;
      renderHints();
    };
    function renderLinks() {
      links.replaceChildren(...st.links.map((l, i) => {
        const p = (store.doc.params || []).find((q) => q.id === l.id);
        const pick = el("select", { class: "num", "aria-label": "Parameter", onchange: () => { l.id = pick.value; renderHints(); } },
          el("option", { value: "" }, "Choose a parameter…"),
          ...(l.id && !p ? [el("option", { value: l.id, selected: true }, "(deleted parameter)")] : []),
          ...(store.doc.params || []).map((q) => el("option", { value: q.id, selected: q.id === l.id }, `${q.name} = ${isFinite(q.value) ? +q.value.toFixed(4) : "?"}`)));
        const alias = el("input", { class: "num", value: l.alias, placeholder: "name in code", "aria-label": "Name in the code", style: { maxWidth: "9em" }, oninput: (e) => { l.alias = e.target.value.trim(); renderHints(); } });
        alias.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); });
        return el("div", { class: "cc-link", style: { display: "flex", gap: "6px", alignItems: "center" } }, "params.", alias, pick,
          el("button", { class: "xbtn", "aria-label": "Remove link", html: ICON.close, onclick: () => { st.links.splice(i, 1); renderLinks(); renderHints(); } }));
      }));
    }
    function renderHints() {
      const used = [...new Set([...st.code.matchAll(/\bparams\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
      const unlinked = used.filter((a) => !st.links.some((l) => l.alias === a));
      const lines = [];
      if (unlinked.length) lines.push(`The code reads ${unlinked.map((a) => "params." + a).join(", ")}, which ${unlinked.length > 1 ? "are" : "is"} not linked to a parameter yet.`);
      const s = body && api.status(body.id);
      if (s && s.needsUpdate) lines.push("Update needed: " + s.why.join("; ") + ".");
      hints.textContent = lines.join(" ");
      hints.hidden = !lines.length;
    }
    function busy(on) {
      run.disabled = on;
      cancel.hidden = !on;
      for (const x of [name, example, code, add, ...links.querySelectorAll("input, select, button")]) x.disabled = on;
      state.textContent = on ? "Starting a fresh geometry engine and running the code… this can take several seconds." : "";
    }
    async function go() {
      showErr("");
      const bindings = {};
      for (const l of st.links) {
        if (!l.alias && !l.id) continue;
        if (!l.alias || !l.id) { showErr("Each link needs both the name the code uses and a parameter."); return; }
        if (Object.hasOwn(bindings, l.alias)) { showErr(`params.${l.alias} is linked twice.`); return; }
        bindings[l.alias] = l.id;
      }
      busy(true);
      building = true;
      try {
        await api.build({ code: code.value, bindings, name: name.value, bodyId: body ? body.id : null });
        if (closed) return;
        closed = true; back.remove();
        app.toast(body ? "Updated " + body.name + "." : "Built " + (name.value.trim() || "Code CAD") + ". Press Update after you change its code or parameters.");
      } catch (e) {
        if (!closed) { busy(false); showErr(e.message || String(e)); }
      } finally { building = false; }
    }

    const field = (label, ...kids) => el("label", { style: { display: "block", marginTop: "10px", fontSize: "12.5px" } }, label, ...kids);
    const modal = el("div", { class: "modal", role: "dialog", "aria-label": "Code CAD", style: { width: "min(720px, 100%)" } },
      el("header", {}, el("h2", {}, "Code CAD"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: close })),
      el("div", { class: "mbody" },
        el("div", { class: "hint", style: { padding: 0 } }, "Write replicad code. It is the body of a function that gets ", el("code", {}, "replicad"), " and ", el("code", {}, "params"), " and returns one closed solid, in millimetres. The solid is added as a STEP body and the code is kept with it; press Update to run the code again."),
        body ? el("div", { style: { marginTop: "10px", fontSize: "12.5px" } }, "Body: ", el("b", {}, body.name)) : field("Name", name),
        field("Example", example),
        field("Code", code),
        el("div", { style: { marginTop: "10px", fontSize: "12.5px" } }, "Parameters the code can read"),
        links,
        add,
        hints,
        el("div", { class: "hint", id: "cc-trust", style: { padding: 0, marginTop: "10px" } }, el("b", {}, "Only run code you trust. "), "It runs as written in a background worker, which is not a sandbox: the code can use the network, this site's saved designs and caches in the browser, and start other workers. The time limit stops a loop that never ends; it does not limit memory. Nothing runs when a design is opened."),
        err,
        el("div", { style: { display: "flex", gap: "8px", marginTop: "12px" } }, run, cancel, shut),
        state));
    back.append(modal);
    document.body.append(back);
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    renderLinks();
    renderHints();
    code.focus();
  }

  const api = { build, open, status, cancel() { if (job) job.cancel(); }, get busy() { return working; }, examples: EXAMPLES, limits: LIMITS }; // limits: the time limits, which tests lower
  app.codeCad = api;
  const entry = document.querySelector('#menu-export button[data-act="codecad"]'); // projects.js closes the menu for any data-act
  // a selected Code CAD body opens its own recipe (that is where Update is); anything else starts a new one
  if (entry) entry.addEventListener("click", () => { const mine = app.sel.length === 1 && findBody(store.doc, app.sel[0]); open(mine && mine.codeCad ? { bodyId: mine.id } : {}); });
  return api;
}
