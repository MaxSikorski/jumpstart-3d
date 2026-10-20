# JumpStart 3D with local MCP

A local CAD workspace based on JumpStart 3D 2.0 where an AI agent can create and revise models in the
running browser editor. Describe a change to your agent, inspect its preview,
then apply it as an undoable edit and export the result for printing.

The agent connects through typed MCP tools that use JumpStart's document model
and CAD kernel. Native models retain their sketches and feature history.
Imported STL models remain meshes, with resizing kept distinct from parametric
feature editing.

## Start the app

Install Docker with Docker Compose and run this from the repository directory:

```sh
make up
```

This builds and starts the container, waits for it to become healthy, and prints:

[http://localhost:3210/?mcp=1](http://localhost:3210/?mcp=1)

Open that URL and keep the editor tab open while the agent works. The browser
runs the geometry worker; the local server connects the MCP client to it.

The status beside Save shows whether an AI client is connected and whether it
is reading, previewing, editing, saving, or exporting this document. Completed
edits remain visible briefly. A disconnected bridge and failed editor requests have
explicit labels. Reload the editor and reconnect your MCP client after updates
to load the indicator and client connection tracking.

## Connect your AI agent

For Codex, register the MCP server with:

```sh
make codex-install
```

This uses the installed Codex CLI to add or update the `jumpstart` server in
your Codex configuration. It requires `codex` and `docker` on PATH and records
Docker's absolute path. Run `make up` to start the container, then reconnect the
MCP server in Codex or restart Codex. Registration can be repeated.

For another MCP client, print the configuration:

```sh
make mcp-config
```

For a client that uses TOML configuration, the entry is:

```toml
[mcp_servers.jumpstart]
command = "docker"
args = ["exec", "-i", "jumpstart-3d", "node", "mcp/server/stdio-proxy.mjs"]
```

Start the container before connecting or reconnecting the MCP client. The client
must be able to run `docker`. If several editor tabs are open, have the agent
list editors and select the intended document.

See [mcp/README.md](mcp/README.md) for tool schemas, native startup without Docker, limits, and
example model plans.

## Everyday workflow

1. Open or import a model in the editor, or start with a blank document.
2. Ask the agent to read the document and its dimensions.
3. Ask for a preview. Check the returned image, dimensions, and geometry errors.
4. Apply the successful preview. Each application is one undoable edit.
5. Revise, undo, or export through the agent. Save the project in the browser to
   keep an editable copy.

Example requests:

- "Create a parametric keychain with the text MAYA, a rounded base, and a hole.
  Preview it and report the dimensions before applying."
- "Resize this imported lid to 100 mm across while keeping its height unchanged.
  Show the resulting dimensions before applying."
- "Increase the native model's wall thickness, regenerate it, and export STL
  and STEP if supported by this model."

For the yogurt lid, the reference mesh is approximately 99 × 99 × 5.5 units.
Treat those as nominal millimetres for this workflow. Resizing the mesh does not
recover its original sketches or prove that it fits a cup. Rim dimensions and
clearance still need to be measured and tested.

## Available MCP tools

| Tool | Purpose |
| --- | --- |
| `jumpstart_list_editors` | Find connected editor tabs. |
| `jumpstart_get_document` | Read the document, revision, units, and geometry. |
| `jumpstart_preview_model` | Preview a structured CAD plan with dimensions, errors, and an image. |
| `jumpstart_preview_resize_body` | Preview a body's target dimensions, including imported meshes. |
| `jumpstart_apply_model` | Apply a successful preview as one recoverable edit. |
| `jumpstart_undo` | Undo an edit against the expected document revision. |
| `jumpstart_export_model` | Export STL or supported STEP geometry. |
| `jumpstart_get_capabilities` | Discover schemas, examples, limits, and unsupported operations. |
| `jumpstart_preview_parameters` | Preview changes to a saved model's named parameters and dependencies. |
| `jumpstart_inspect_geometry` | Measure generated geometry, sections, channels, and mesh topology. |
| `jumpstart_select_geometry` | Find native edges or faces by geometric predicates, with ambiguity reporting. |
| `jumpstart_save_document` | Save the native project and parameter templates in browser-local storage. |
| `jumpstart_reopen_document` | Read back the current saved local project while preserving undo. |
| `jumpstart_preview_new_document` | Prepare a fresh document as an undoable preview. |

Plans support primitives, dimensioned circle and polygon sketches, extrude,
revolve, loft, transforms, rectangular and circular patterns, boolean joins and
cuts, and native fillet, shell, hole, thread, emboss, and scale operations.
Operation details and restrictions are in [mcp/README.md](mcp/README.md).

Parameterized plans can persist named values, arithmetic dependencies, bounds,
and comparison constraints. Previews return parameter and feature diffs, top,
side, and isometric images, plus a section image when requested. Geometry
inspection measures the generated tessellation separately from the plan's
claimed dimensions. Failed requested preview checks prevent apply.

Previews leave the saved design unchanged. Apply rejects stale document
revisions, and retrying the same preview does not duplicate the edit. The server
is exposed on loopback only, bounds tool inputs, and provides no arbitrary
JavaScript execution tool.

## Files and exports

Docker exports are written to the repository's `exports/` directory. A returned
container path such as `/app/exports/model-<hash>.stl` maps to
`exports/model-<hash>.stl` on the host.

Use the editor's Save action for an editable project. Browser project storage
and the export directory are separate; the container volume is not a backup of
the browser document. `make down` stops the service and preserves host exports.

## Verify the integration

For host development and verification, use Node.js 22, matching the container:

```sh
npm ci
npx playwright install chromium
npm test
```

With the app running, open a separate blank editor tab and run:

```sh
make benchmark
```

The MCP benchmark exercises the 16 tutorials covered before this upstream sync.
JumpStart 2.0 now has 19 tutorials; Spinning Top (`b-top`), Turned Cup (`a-cup`),
and Parametric Bracket (`a-params`) are not yet covered by MCP plans. The
benchmark checks geometry invariants, feature history, STL export,
and transactional behavior. Each case starts from a fresh document state and
is undone afterward. The runner refuses to use a populated document.

If multiple blank editors are connected, select one explicitly:

```sh
JUMPSTART_MCP_EDITOR_ID=<editor-id> make benchmark
```

This benchmark verifies tool and CAD execution using deterministic plans. It
does not measure how reliably an AI model translates new natural-language
requests into those plans. The imported-lid regression checks mesh resizing;
physical fit remains unverified.

The separate agent benchmark provides requests without prepared plans:

```sh
npm run benchmark:agent -- tasks
```

An agent supplies the plans and revisions, while the recorder captures tool
calls, images, independent measurements, exports, and recovery evidence. See
[mcp/README.md](mcp/README.md#agent-design-and-revision-benchmark) for the session commands.
The latest recorded observations are in
[mcp/benchmarks/verification-results.json](mcp/benchmarks/verification-results.json).

## Useful commands

| Command | Purpose |
| --- | --- |
| `make up` | Build and start Docker, wait for readiness, print the URL. |
| `make down` | Stop the container. |
| `make logs` | Follow server logs. |
| `make mcp-config` | Print the MCP client configuration. |
| `make codex-install` | Register or update JumpStart MCP in Codex. |
| `npm run build` | Rebuild the browser app from `src/`. |
| `npm test` | Build and run MCP unit, upstream editor, and MCP browser compatibility tests. |
| `npm run test:mcp` | Run the MCP Node contract and regression tests. |
| `npm run test:editor` | Run upstream Playwright regressions against both builds. |
| `npm run test:mcp:browser` | Run MCP browser compatibility regressions. |
| `make benchmark` | Run the tutorial benchmark against a connected blank editor. |

After changing app source, run `make up` again to rebuild the Docker image.

## Current limits

- MCP sketch plans support circles and polygons. They do not yet expose the
  native 2.0 constraint solver, arcs, splines, or Lathe operations.
- MCP parameter templates and native editor parameters remain separate.
  `get_document` exposes native definitions and sketch constraints for inspection;
  native parameter authoring through MCP is not part of this upgrade.
- Parameter units are explicit labels; expressions do not perform dimensional
  algebra. Native edits outside a saved parameter template must be reconciled
  before parameter regeneration, rather than silently overwritten.
- Face and edge selectors may need to be selected again after upstream geometry
  changes. Arbitrary mirror planes are not exposed.
- Imported mesh scaling is supported; reconstructing a parametric feature tree
  from an STL is not.
- MCP export supports STL and supported STEP geometry, not 3MF.
- Successful geometry and export checks do not prove printability, thread fit,
  or cup fit. Inspect the slicer output and perform physical fit tests.
- Section and mesh checks inspect tessellation at a reported tolerance. They do
  not detect every self-intersection or establish minimum thickness everywhere.

## Where the integration lives

| Path | Purpose |
| --- | --- |
| [mcp/README.md](mcp/README.md) | Detailed setup, protocol, examples, and limitations. |
| [mcp/browser/model-plan.js](mcp/browser/model-plan.js) | Model-plan validation and native operation mapping. |
| [mcp/browser/editor-bridge.js](mcp/browser/editor-bridge.js) | Live editor bridge, previews, transactions, and exports. |
| [mcp/browser/models.js](mcp/browser/models.js) | Saved parameter models and guarded regeneration. |
| [mcp/shared/parameters.js](mcp/shared/parameters.js) | Bounded arithmetic dependencies and constraints. |
| [mcp/browser/inspection.js](mcp/browser/inspection.js) | Independent measurements of generated geometry. |
| [mcp/server/](mcp/server/) | Local server, stdio proxy, and tool contracts. |
| [mcp/benchmarks/](mcp/benchmarks/) | Tasks, plans, runners, and invariant checks. |
| [mcp/tests/](mcp/tests/) | Contract and regression coverage. |
| [compose.yaml](compose.yaml) | Local container and export-volume configuration. |

JumpStart 3D was created by J.Siwek. This workspace builds on the
[MaxSikorski community repository](https://github.com/MaxSikorski/jumpstart-3d).
See [NOTICE.md](NOTICE.md) and [UPSTREAM-README.md](UPSTREAM-README.md) for upstream
credits and background.
