# Local MCP modeling

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

For an MCP client, use the container's stdio with the configuration printed by
`make mcp-config`:

```toml
[mcp_servers.jumpstart]
command = "docker"
args = ["exec", "-i", "jumpstart-3d", "node", "scripts/jumpstart-mcp-stdio-proxy.mjs"]
```

Start the container before connecting the MCP client. The app and MCP bridge
share one service in the container. The stdio proxy forwards MCP requests to
that service over loopback HTTP, so disconnecting the MCP client leaves the app
running.

Codex configuration example:

```toml
[mcp_servers.jumpstart]
command = "node"
args = ["/absolute/path/to/jumpstart-3d/scripts/jumpstart-mcp-server.mjs"]
```

Restart the MCP client, open the local app URL printed to the server's stderr, then call `jumpstart_list_editors`. The `mcp=1` query keeps the viewport drawing buffer available for MCP preview screenshots. The app must stay open while the agent works. Set `JUMPSTART_MCP_PORT` to a free local port if `3210` is already in use.

## Agent workflow

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

## Tutorial benchmark

The benchmark has one natural-language prompt and a deterministic structured plan for each of the 16 built-in tutorials. It checks rejected-preview isolation, stale-preview rejection, duplicate-apply protection, real browser-kernel previews, document geometry and feature history, binary STL output, and undo back to an empty document. It exercises the MCP/model-plan path; the prompts are paired with fixed plans, so it does not measure a particular language model's ability to translate prose into CAD plans.

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
