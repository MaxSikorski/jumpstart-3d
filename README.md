# JumpStart 3D with local MCP

A local CAD workspace where an AI agent can create and revise models in the
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

## Connect your AI agent

Print the MCP client configuration:

```sh
make mcp-config
```

For a client that uses TOML configuration, the entry is:

```toml
[mcp_servers.jumpstart]
command = "docker"
args = ["exec", "-i", "jumpstart-3d", "node", "scripts/jumpstart-mcp-stdio-proxy.mjs"]
```

Start the container before connecting or reconnecting the MCP client. The client
must be able to run `docker`. If several editor tabs are open, have the agent
list editors and select the intended document.

See [MCP.md](MCP.md) for tool schemas, native startup without Docker, limits, and
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

Plans support primitives, dimensioned circle and polygon sketches, extrude,
revolve, loft, transforms, rectangular and circular patterns, boolean joins and
cuts, and native fillet, shell, hole, thread, emboss, and scale operations.
Operation details and restrictions are in [MCP.md](MCP.md).

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
npm test
```

With the app running, open a separate blank editor tab and run:

```sh
make benchmark
```

The benchmark exercises one task and a fixed model plan for each of the 16
built-in tutorials. It checks geometry invariants, feature history, STL export,
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

## Useful commands

| Command | Purpose |
| --- | --- |
| `make up` | Build and start Docker, wait for readiness, print the URL. |
| `make down` | Stop the container. |
| `make logs` | Follow server logs. |
| `make mcp-config` | Print the MCP client configuration. |
| `npm run build` | Rebuild the browser app from `src/`. |
| `npm test` | Run contract and regression tests. |
| `make benchmark` | Run the tutorial benchmark against a connected blank editor. |

After changing app source, run `make up` again to rebuild the Docker image.

## Current limits

- Sketch input supports circles and polygons, without a general constraint
  solver, arcs, or splines.
- Face and edge selectors may need to be selected again after upstream geometry
  changes. Arbitrary mirror planes are not exposed.
- Imported mesh scaling is supported; reconstructing a parametric feature tree
  from an STL is not.
- MCP export supports STL and supported STEP geometry, not 3MF.
- Successful geometry and export checks do not prove printability, thread fit,
  or cup fit. Inspect the slicer output and perform physical fit tests.

## Where the integration lives

| Path | Purpose |
| --- | --- |
| [MCP.md](MCP.md) | Detailed setup, protocol, examples, and limitations. |
| [src/mcp-plan.js](src/mcp-plan.js) | Model-plan validation and native operation mapping. |
| [src/mcp.js](src/mcp.js) | Live editor bridge, previews, transactions, and exports. |
| [scripts/](scripts/) | Local server, stdio proxy, and benchmark runner. |
| [benchmarks/](benchmarks/) | Tutorial tasks, plans, and invariant checks. |
| [tests/](tests/) | Contract and regression coverage. |
| [compose.yaml](compose.yaml) | Local container and export-volume configuration. |

JumpStart 3D was created by J.Siwek. This workspace builds on the
[MaxSikorski community repository](https://github.com/MaxSikorski/jumpstart-3d).
See [NOTICE.md](NOTICE.md) and [UPSTREAM-README.md](UPSTREAM-README.md) for upstream
credits and background.
