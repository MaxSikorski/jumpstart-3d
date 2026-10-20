# JumpStart MCP integration

## Ownership and layout

All MCP implementation, tests, benchmark runners, fixtures, and status tokens
live under this directory. The upstream application keeps its existing layout.

```text
mcp/
  browser/     Editor bridge, native model mapping, inspection, and status UI
  server/      Local server, stdio proxy, presence, and tool contracts
  shared/      Parameter evaluator, geometry helpers, and input validation
  tests/       Contract and regression coverage
  benchmarks/  Tutorial and agent tasks, runners, and recorded results
  tokens/      AI status component tokens
```

`browser/` owns the dependency on JumpStart's document and scene APIs. `shared/`
contains helpers usable by both browser and Node code. `server/` has no dependency
on browser editor globals. This remains one repository and build, with no extra
package installation.

### Upstream integration hooks

Keep these edits small and review them when updating upstream:

| Upstream file | Fork integration |
| --- | --- |
| [src/app.js](../src/app.js) | Import and initialize `mcp/browser/editor-bridge.js`. |
| [src/index.html](../src/index.html) | Place the passive AI status element in the top bar. |
| [src/viewport.js](../src/viewport.js) | Enable the drawing buffer for MCP preview capture. |
| [src/projects.js](../src/projects.js) | Expose native local save and reopen operations. |
| [build.mjs](../build.mjs) | Include the AI status component CSS in the app shell. |
| [package.json](../package.json) | Keep the MCP launch and benchmark command aliases. |

Persistence stays with native projects because its storage keys, save state,
and undo behavior belong to JumpStart. Do not duplicate those internals in the
bridge. Native document nodes, kernel operations, and scene geometry remain
owned by the upstream application.

Root `Makefile`, Docker configuration, and npm commands are entry points. The
old `scripts/jumpstart-mcp-server.mjs`, `scripts/jumpstart-mcp-stdio-proxy.mjs`,
and benchmark scripts remain thin compatibility launchers. In particular,
installed Codex configurations can keep using the existing proxy path.
`MCP.md` at the repository root redirects to this guide.

### Updating from upstream

The upstream source is `https://github.com/MaxSikorski/jumpstart-3d.git`. Keep it
as the `upstream` remote; `origin` remains this fork. Fetch and inspect changes
before choosing a merge or rebase:

```sh
git fetch upstream
git log --oneline HEAD..upstream/main
git diff HEAD...upstream/main -- src build.mjs package.json
```

Merge source changes first and review the hooks above. Regenerate `docs/` with
`npm run build` rather than resolving minified JavaScript manually. Do not use
an automatic "ours" merge rule for generated bundles; it can hide missing
upstream changes. Keep the fork's local-workflow README intentional when merging
upstream documentation.

Before accepting an update, run `npm test`, rebuild the app and Docker image,
exercise the compatibility proxy, and run the tutorial benchmark against a
fresh document. Run the agent design/revision checks when document, kernel,
selector, persistence, or export contracts change. Preserve MCP tool names,
`/__mcp` routes, `mcpModels` metadata, and the root `exports/` location unless an
explicit migration accompanies the change.

## Local modeling

JumpStart exposes the running local editor through a stdio MCP server. The server binds its browser bridge to loopback and serves the built app at `http://localhost:3210/?mcp=1`.

## Start

Build the app, then add the MCP server to your client configuration:

```sh
npm install
npm run build
```

### Docker shortcut

With Docker Compose and `make` installed, start the app and its MCP bridge in a
local container:

```sh
make up
```

This builds and starts the container, then prints
`http://localhost:3210/?mcp=1`. The port is published on loopback only. MCP
exports are written to this checkout's `exports/` directory. Stop the container
with `make down`; use `make logs` to inspect its output.

For Codex, run `make codex-install` to register the Docker stdio proxy using the
installed Codex CLI. It adds or updates the `jumpstart` entry and records the
absolute Docker executable path. The command requires `codex` and `docker` on
PATH; it does not start Docker or change other MCP entries. Run `make up`, open
the editor, then reconnect the MCP server in Codex or restart Codex.

For other MCP clients, use the container's stdio with the configuration printed
by `make mcp-config`:

```toml
[mcp_servers.jumpstart]
command = "docker"
args = ["exec", "-i", "jumpstart-3d", "node", "mcp/server/stdio-proxy.mjs"]
```

Start the container before connecting the MCP client. The app and MCP bridge
share one service in the container. The stdio proxy forwards MCP requests to
that service over loopback HTTP, so disconnecting the MCP client leaves the app
running.

Codex configuration example:

```toml
[mcp_servers.jumpstart]
command = "node"
args = ["/absolute/path/to/jumpstart-3d/mcp/server/server.mjs"]
```

Restart the MCP client, open the local app URL printed to the server's stderr, then call `jumpstart_list_editors`. The `mcp=1` query keeps the viewport drawing buffer available for MCP preview screenshots. The app must stay open while the agent works. Set `JUMPSTART_MCP_PORT` to a free local port if `3210` is already in use.

## Agent workflow

The top-bar AI indicator distinguishes the browser bridge from an agent client.
The Docker stdio proxy maintains a client lease every five seconds; the server
expires missing leases after fifteen seconds and removes a clean disconnect
immediately. Browser heartbeats do not count as agent connections. Stateless
HTTP requests establish only recent activity, labeled accordingly. In-flight
activity is shown only in the editor executing the command. Completed edits
remain visible briefly, including through follow-up reads. Editor errors and bridge
loss are explicit; this passive status does not grant editing permissions.

1. Call `jumpstart_list_editors`; specify `editorId` if more than one editor is open.
2. Call `jumpstart_get_document({ includeGeometry: true })` to read the current revision, world bounds, body-local dimensions, sketches, feature nodes, and capped edge/face selectors.
3. Call `jumpstart_preview_model` with a typed plan. Plans support JumpStart primitives, explicit circle/polygon sketches, extrude/revolve/loft features, body transforms, linear/circular patterns, groups, booleans, and native fillet/shell/hole/thread/emboss/scale modifiers. They can add bodies or edit existing bodies by id. For a direct imported-body size change, `jumpstart_preview_resize_body` remains the shortest form.
4. Inspect preview validity, errors, dimensions, and the returned image before applying.
5. Call `jumpstart_apply_model` with the returned `previewId`. Applying the same id twice does not duplicate the edit.
6. Read the new revision before calling `jumpstart_undo`. The revision check prevents undoing a later user edit.
7. Call `jumpstart_export_model` with `format: "stl"` or `"step"`. Files are written under `exports/` with a content hash in the name.

All coordinates, radii, distances, and feature parameters are in millimeters. `units` in the document summary is only the app's display preference. A plan adds features to the open document; pass `replaceBodyIds` from a previous apply result to preview and replace those bodies as one undoable edit.

## Plan shape

A plan contains typed primitive bodies, sketches, CAD features, and operations. Sketches have a local plane (`XY`, `XZ`, or `YZ`), origin, and one closed circle or polygon profile; sketch coordinates and all feature parameters use millimeters. Features can extrude, revolve, or loft those profiles. Boolean joins/cuts can reference earlier bodies. Linear patterns use `count` as instances per side when `symmetric` is true, so count 4 creates 7 total instances. Circular patterns use `count` including the source; a partial total angle includes both endpoints, while 360 degrees spaces instances around the complete circle.

`jumpstart_preview_resize_body` changes the exact local X, Y, and/or Z size of an existing body by adding or updating JumpStart's native scale feature. It works on imported STL/3MF meshes and preserves their mesh source. Omitted dimensions stay unchanged. `base` keeps the bottom center fixed; `center` keeps the center fixed; `corner` keeps the minimum corner fixed. Imported meshes remain meshes: resize, placement, and feature-based cuts are editable, while the original triangle surface is not a parametric sketch or feature tree.

For fillet and shell, first preview the base shape or read an existing body with `includeGeometry: true`, then use the returned local edge/face signatures in the modifier. Hole positions/normals, thread face centers, and emboss face frames are also body-local. Preview again after an upstream feature change because edge and face references can change when geometry changes.

The current MCP sketch input uses explicit point coordinates and circle radii. It does not expose a sketch constraint solver, arcs, splines, arbitrary mirror planes, or a 3MF export. Preview validation reports OpenCascade build errors and mesh measurements; it does not prove a physical fit or replace a slicer/manifold check.

## Inspection and parameter revisions

Call `jumpstart_get_capabilities` for exact tool schemas, examples and budgets.
Tool inputs are validated at runtime, including unknown keys, numeric ranges,
payload sizes and array limits. Maximum tool arguments are 256 KiB. Inspection
is bounded to 200,000 triangles and an estimated eight million triangle visits;
split expensive inspection requests into smaller read-only calls.

### Named parameters

Add `modelId`, `parameters` and optional `constraints` to a model plan. Numeric
fields accept expression objects:

```json
{
  "modelId": "disk",
  "name": "Editable disk",
  "parameters": {
    "diameter": { "value": 100, "unit": "mm", "min": 10, "max": 500 },
    "radius": { "expression": "diameter / 2", "unit": "mm" },
    "height": { "value": 6, "unit": "mm", "min": 1 }
  },
  "primitives": [
    { "id": "disk", "kind": "cylinder", "parameters": {
      "w": { "$expr": "diameter" }, "d": { "$expr": "diameter" },
      "h": { "$expr": "height" }
    } }
  ]
}
```

Expressions support numbers, parameter names, `+`, `-`, `*`, `/`, unary signs
and parentheses. There is no executable code, property access or function
calling. Cycles, unknown names, invalid bounds, noninteger counts and derived
parameter overrides fail before preview. Units are `mm`, `deg`, `count`, or
`scalar`; these are labels, without dimensional algebra. Constraints use
`{ "id": "floor", "left": "height - depth", "operator": "gte", "right": "2" }`.

After applying, `jumpstart_get_document` returns `parametricModels`. Call
`jumpstart_preview_parameters` with `modelId`, `values`, and the current
`expectedRevision`. Preview returns changed parameters and feature ids. Apply
uses the existing transaction and undo path. Templates, values and native
features persist in ordinary project JSON. Unrelated bodies remain intact;
external dependencies and native edits to owned geometry cause a conflict
instead of being overwritten. Final body identities remain stable. Internal
feature nodes are regenerated from the saved template, not arbitrarily patched.
Direct mesh/body resizing invalidates that body's named-parameter record.

### Images, sections and measurements

Preview returns labeled top, side and isometric MCP image blocks. Pass
`section: { "axis": "X", "offset": 0 }` for an additional native section
image. Coordinates are world millimetres. Capture uses fitted orthographic
views and crops to the projected model bounds. Camera, projection, selection
appearance, grid and existing section state are restored, including on failure.
Each failed image has an explicit `imageErrors` entry. `get_document.viewport`
allows comparing camera state before and after preview.

Use `jumpstart_inspect_geometry` with a live `bodyId`, or add `previewId` to
inspect cached preview geometry without applying it. Optional arguments include:

- `section: { "axis": "X", "offset": 0 }`: generated mesh intersection segments.
- `samples: [{ "axis": "Z", "point": [0, 0, 0] }]`: actual line intersections
  and solid intervals, for measuring floors, walls, gaps and clearances along an axis.
- `checks: [{ "id": "width", "kind": "dimension", "axis": "X", "expected": 110,
  "tolerance": 0.05 }]`: expected versus measured tessellation dimensions.
- A `channels` check with `axis: "Y"`, `crossAt: 0`, and
  `expected: { "count": 9, "width": 4, "depth": 3, "floor": 3,
  "spacing": 11.75, "symmetric": true, "openEnds": true }`.

Channel checks infer floors and ridges from section triangles and line
intersections, never submitted primitive dimensions. They support straight,
axis-aligned, parallel channels with a common flat floor, at most 24 channels.
Unsupported or ambiguous geometry fails explicitly. Openness is sampled at
the probe height; this does not establish drainage performance.

Mesh checks report degenerate triangles, boundary and non-manifold edges,
inconsistent winding and connected components. The default weld tolerance is
0.0001 mm and is always reported. Results depend on tessellation and tolerance;
they do not prove absence of self-intersections, overlapping shells, minimum
wall thickness everywhere or physical printability. STL export reports its own
mesh checks; exports over the inspection budget are explicitly not checked.

The validation layers remain separate: schema validity, CAD construction,
requested geometric checks, export mesh checks, and unverified physical fit.
A failed requested check or mesh inspection on a preview blocks its apply.
Correct the model or resolve that inspection before applying. CAD-only previews
remain available when no independent checks are requested.

### Native geometry selection

`get_document(includeGeometry: true)` returns body-local signatures and their
fingerprint. `jumpstart_select_geometry` requires `bodyId`, `expectedRevision`,
`expectedFingerprint`, and a structured query. For example:

```json
{ "kind": "edge", "type": "CIRCLE", "axis": "Z", "extreme": "max" }
```

Queries can filter by coordinate, nearby point, planar normal, cylinder radius,
or `external: false` for an inner cylindrical face. They return candidates and
`selected`, `ambiguous`, `not_found`, or `incomplete`; ambiguous or capped data
never silently selects an element. Reselect after regeneration. These queries
do not provide persistent topological naming or infer design intent.

### Local save and reopen

`jumpstart_save_document({ expectedRevision })` writes the exact document to
the app's browser-local project store and verifies serialization readback.
It does not bump the version or invoke the remote save API.
`jumpstart_reopen_document({ documentId, expectedRevision })` reads only the
current project's saved local JSON and preserves the undo stack. Reopening an
identical snapshot adds no undo entry. A changed saved snapshot is restored as
one recoverable edit. Normal browser reload also preserves parameter templates,
but clears in-memory undo history and preview ids, as ordinary app startup does.

To prepare a fresh document entirely through MCP, call
`jumpstart_preview_new_document({ expectedRevision, name, mode })`, inspect its
new-document metadata and apply its `previewId`. This is one recoverable edit:
undo restores the previous document. Use this before a benchmark, then undo the
document creation after the benchmark has undone its model edits.

After updating the container, save and reload existing editor tabs to load the
new browser bridge. A running old tab cannot execute newly added tools.

## Agent design and revision benchmark

The deterministic tutorial benchmark below tests tool execution. The separate
agent task catalog contains requests and invariants, without prepared plans.
It covers the coaster revision, an unequal-compartment parts tray, and an
impossible-depth request followed by a valid correction.

```sh
npm run benchmark:agent -- tasks
node mcp/benchmarks/agent-runner.mjs begin exports/session.json coaster-revision EDITOR_ID
node mcp/benchmarks/agent-runner.mjs call exports/session.json TOOL_NAME exports/args.json
node mcp/benchmarks/agent-runner.mjs checkpoint exports/session.json candidate
node mcp/benchmarks/agent-runner.mjs checkpoint exports/session.json reopened
node mcp/benchmarks/agent-runner.mjs checkpoint exports/session.json undone
node mcp/benchmarks/agent-runner.mjs finish exports/session.json
```

Give the task to an actual agent. It must generate every tool argument and use
the `call` command for actions, inspections, save/reopen, retries and undo.
The recorder saves tool requests/results and preview images beside the session
file. `candidate` captures native feature readback and independently reads an
actual STL export. Record the `reopened` checkpoint after save and reopen, and
the `undone` checkpoint after undo restores the baseline. `finish` writes
`session.json.report.json` and exits nonzero for missing or failed evidence.

For the coaster, inspect baseline channel floor thickness before revising it.
Inspect the candidate's dimensions, channels, symmetry, openings and mesh.
Exercise duplicate apply and a separate stale preview. The harness checks the
trace against generated geometry, rather than accepting plan dimensions or
agent claims. It never chooses or clears an editor automatically.

The harness is repeatable evaluation infrastructure, not a bundled LLM runner.
Run-to-run model settings, prompts, errors and corrections should be retained
with each session. Development-agent results are integration evidence, not a
statistical general-design success rate. No fake CAD engine is used for
geometry acceptance.

## Implementation files

- `mcp/browser/editor-bridge.js`: editor commands, multi-view capture, preview inspection gates,
  transactions, exports and revision checks.
- `mcp/browser/models.js` and `mcp/shared/parameters.js`: owned native models, persistent
  templates, bounded arithmetic and guarded regeneration.
- `mcp/shared/geometry.js` and `mcp/browser/inspection.js`: independent tessellation
  measurements, semantic selection and bounded mesh checks.
- `mcp/shared/schema.js`, `mcp/server/tool-contracts.mjs` and
  `mcp/server/server.mjs`: runtime input validation, tool discovery,
  local dispatch and export checks.
- `src/projects.js`: native browser-local save and reopen operations.
- `mcp/benchmarks/agent-tasks.mjs`, `mcp/benchmarks/agent-runner.mjs` and
  `mcp/benchmarks/verification-results.json`: prompt-only tasks, trace recorder and
  recorded verification observations. Detailed session evidence stays in the
  ignored local `exports/` directory.
- `mcp/tests/mcp-parameters.test.mjs`, `mcp/tests/mcp-models.test.mjs`,
  `mcp/tests/mcp-geometry.test.mjs`, `mcp/tests/mcp-inspection.test.mjs`,
  `mcp/tests/mcp-server.test.mjs` and `mcp/tests/agent-benchmark.test.mjs`: contracts,
  negative cases and regression coverage.
- `package.json`, `README.md` and generated `docs/app.js`: commands,
  local workflow documentation and the rebuilt browser bundle.

## Tutorial benchmark

The benchmark has one natural-language prompt and a deterministic structured plan for 16 of the 19 upstream tutorials. It checks rejected-preview isolation, stale-preview rejection, duplicate-apply protection, real browser-kernel previews, document geometry and feature history, binary STL output, and undo back to an empty document. It exercises the MCP/model-plan path; the prompts are paired with fixed plans, so it does not measure a particular language model's ability to translate prose into CAD plans.

`npm test` also includes an imported yogurt-lid resize regression using the supplied STL's measured 99 × 99 × 5.5 mm bounds. It checks a resize from the reference dimensions to 100 mm, a second revision to 95 mm, preservation of the mesh asset, and immutability of the previous document snapshot. Cup fit remains unverified without the cup rim profile and clearance measurements.

Start a clean JumpStart tab at `http://localhost:3210/?mcp=1`, confirm its document is empty, then run:

```sh
make benchmark
```

If multiple editor tabs are connected, call `jumpstart_list_editors` and set `JUMPSTART_MCP_EDITOR_ID` to the clean tab's id. The runner refuses to start against a document containing bodies or sketches. Each successful case exports an STL to `exports/`, then undoes its edit before starting the next case.

## Lid prototype plan

This plan exercises the round cross-section, revolve, patterned cuts, preview, apply, and export path. The 1.7 mm center thickness is an inferred first pass, chosen to bring the model volume close to the supplied mesh; the underside profile and two cutouts are still approximations. This is not a verified fit for the cup.

```json
{
  "name": "Yogurt lid reference prototype (fit unverified)",
  "sketches": [
    {
      "id": "lid-section",
      "name": "Lid cross-section",
      "plane": "XZ",
      "origin": [0, 0, 0],
      "profile": {
        "type": "polygon",
        "points": [[0, 0], [49.5, 0], [49.5, 5.5], [45.5, 5.5], [45.5, 1.7], [0, 1.7]]
      }
    },
    {
      "id": "lock-relief",
      "name": "Opposed lock reliefs",
      "plane": "XY",
      "origin": [0, 0, 0],
      "profile": { "type": "polygon", "points": [[44, -3], [52, -3], [52, 3], [44, 3]] }
    }
  ],
  "features": [
    { "id": "lid", "name": "Lid body", "type": "revolve", "sketch": "lid-section", "axis": "Z", "angle": 360 },
    {
      "id": "reliefs",
      "name": "Opposed lock reliefs",
      "type": "extrude",
      "sketch": "lock-relief",
      "distance": 5.5,
      "operation": "cut",
      "target": "lid",
      "pattern": { "axis": "Z", "count": 2 }
    }
  ]
}
```

## Native 2.0 compatibility

The editor retains upstream's native scripting bridge and parameter system.
MCP reads native parameters through `nativeParameters` and sketch constraints
through geometry inspection. MCP model parameters in `mcpModels` remain separate;
MCP does not yet author native parameter bindings, solver constraints, arcs,
splines, or Lathe features. The uncovered tutorials are `b-top` (Spinning top),
`a-cup` (Turned cup), and `a-params` (Parametric bracket). The benchmark reports
these gaps separately from its implemented-plan pass count.

Legacy local snapshots without `params` reopen with an empty native parameter
list. The bridge activates on loopback HTTP pages served by the local MCP server,
or with explicit `?mcp=1`. Static and offline builds do not poll an absent broker.

After `npm ci`, install browser prerequisites with `npx playwright install chromium`.
`npm test` builds once and runs MCP contracts, upstream editor regressions for the
site and standalone artifact, then the MCP browser compatibility checks.

The regression harness isolates each golden export case in a fresh browser
context and blurs focused controls before loading a new test document. These
prevent repeated offline-download stalls and edits leaking between test cases;
upstream's expected geometry and export hashes remain unchanged.
