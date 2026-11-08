# The scripting bridge: `window.JS3D`

The app puts one object, `window.JS3D`, on the page. A script, the browser
console, a Playwright test or a tool server can use it to build shapes, change
them, read their size and volume, and export files, the same way a person does
with the mouse. It does nothing until something calls it.

It works the same in the website and in the single file
(`dist/jumpstart-3d.html`). The code is `src/bridge.js`; `tools/bridge-demo.js`
is a worked example; `test/bridge.spec.mjs` tests every call on both builds.

This file has two parts:

1. [The `JS3D` calls](#part-1-the-js3d-calls)
2. [The project file format](#part-2-the-project-file-format)

## Try it in two minutes

1. Open the app (https://maxsikorski.github.io/jumpstart-3d/ or the single file).
2. Save `tools/bridge-demo.js` to your computer (on GitHub, open the file and
   use the download button).
3. Open/Export › **Run script…** and pick that file. A block with a hole appears,
   and a message at the bottom says "Script finished" with the demo's summary
   (volume, file sizes, whether saving and reloading gave the same shape). The
   demo starts a new design, so run it on a fresh page.

A script run this way has `JS3D` and `app` in scope, can use `await` at the
top level and can end with `return` to show a value in the message. If it
fails, the error shows in red. It runs with the same trust as text pasted into
the browser console: it is your own file, running in your own page, and
nothing runs unless you pick a file (no web address parameter, no auto-run).

The console path still works, and is handy for single calls: open the browser
console (Chrome and Edge, F12 or Ctrl+Shift+J, Mac: Cmd+Option+J; Firefox,
Ctrl+Shift+K; Safari, turn on the Develop menu in Settings, then Cmd+Option+C),
paste the whole demo and press Enter, or type calls one at a time:

```js
const id = JS3D.add("box", { size: { w: 40, d: 30, h: 20 } });
await JS3D.ready();
JS3D.get(id).volume;        // 24000
```

## Part 1: The `JS3D` calls

### Conventions

- Lengths are in **mm**, angles in **degrees**, positions are `[x, y, z]`, z up.
  The page's mm/inch switch does not change anything here.
- An argument called `ids` takes one id (a string) or an array of ids.
- A call that names a body that does not exist throws `Error("no body <id>")`.
  Bad input throws an `Error` with a plain message that says what to change.
- While Chisel mode is open, every call that edits or loads throws `leave Chisel mode first` (`setMode` is how you leave it).
- Async calls are explicitly marked in the reference: ready, codeCad, holePattern, screenshot, screenshotDataURL, export, load, newDesign, run, invoke, sketch, extrude, revolve, fillet, chamfer, shell, hole, faces, edges, inspect, measure, printCheck, collisions, section, texture and drawing. Others are synchronous.
- Every edit is one undo step with a readable label (the Undo button and
  `JS3D.undo()` use it) and leaves the selection alone.
- **Shapes are built in the background.** After an edit, `volume` and `bbox`
  in `list()` are `null` until the geometry engine has finished. Call
  `await JS3D.ready()` before reading them. `export` and `screenshot` wait by
  themselves.
- A body's position is the translation in its matrix `m` (entries 12, 13, 14).
  A shape made by `add` sits with the middle of its footprint at x, y and its
  base at z. A **group**'s own position stays `[0, 0, 0]` when it is made (its
  parts keep their places inside it), so for where a group is, read `bbox`.


### Version and compatibility policy

`apiVersion` is `1.13.0`; `version` remains the derived two-component `1.13`. Patch releases change only apiVersion. appVersion and the project envelope version 1 are independent. SemVer applies to documented calls: minor adds calls/options/optional result fields; patch fixes behavior to this contract; major removes/renames, tightens valid inputs, changes defaults/units/types, or changes synchronous to asynchronous behavior. Existing scripts continue throughout 1.x; discovery schemas describe calls without adding a generic validator.

Promise resolution does not guarantee successful geometry: use ready and check list().error. Mesh triangulation, generated IDs, timestamps and raw document fields are not guaranteed identical across releases. Part 2 distinguishes observed and unchecked fields. internals, __app and __store are unsupported. Error messages remain plain strings across transports; catalogued messages are preserved, uncatalogued kernel diagnostic wording is not a stable discriminator.

Deprecations begin only in a minor release, with replacement, deprecatedSince and earliest removal in discovery, this reference and the API changelog. Old behavior stays for the entire major and at least 12 months and two minor releases; removal requires a new major. No repeated-call warnings or telemetry. Nothing is deprecated here; delete remains supported.

All calls are direct and invoke-accessible except invoke itself. postMessage is false for every call: PR A adds no embedding transport. Direct bytes are Uint8Array; invoke/WebSocket uses {$bytes:base64}. Direct void is undefined (returnsSchema null means no value schema, not a null result). WebSocket still omits undefined result fields. Optional positions can be omitted; JavaScript undefined is not JSON and must not be silently replaced with null.

## Per-area reference

Examples that use id, other or sk assume IDs/results from earlier calls in the same design. Inspect errors after ready before proceeding. Schema blocks describe JSON inputs; geometric/cross-field constraints remain in the prose and implementation.

## Properties

<!-- api:begin index:Properties -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.apiVersion` | stable property | Read-only access | [Value/reference](#api-apiVersion) |
| `JS3D.appVersion` | stable property | Read-only access | [Value/reference](#api-appVersion) |
| `JS3D.internals` | internal property | Read-only access | [Value/reference](#api-internals) |
| `JS3D.version` | stable property | Read-only access | [Value/reference](#api-version) |
<!-- api:end index:Properties -->

<a id="api-apiVersion"></a>
### JS3D.apiVersion

**Value**

Semantic version of documented bridge contract. Schema: `{"const":"1.13.0"}`.

**Returns**

Property value, synchronous.

**Errors**

None on property access.

**Effects/undo/storage**

None on access.

**Example**

`JS3D.apiVersion`

**Since/transports**

1.13.0; direct property only, never callable via invoke or postMessage.

<a id="api-appVersion"></a>
### JS3D.appVersion

**Value**

App release version, independently maintained. Schema: `{"type":"string"}`.

**Returns**

Property value, synchronous.

**Errors**

None on property access.

**Effects/undo/storage**

None on access.

**Example**

`JS3D.appVersion`

**Since/transports**

Legacy 1.x; direct property only, never callable via invoke or postMessage.

<a id="api-internals"></a>
### JS3D.internals

**Value**

Unsupported live app/store internals. __app and __store are also unsupported. Schema: `{"type":"object","description":"Opaque unsupported app/store references; never serialized by discovery."}`.

**Returns**

Opaque live object; unsupported.

**Errors**

None on property access.

**Effects/undo/storage**

None on access.

**Example**

`JS3D.internals`

**Since/transports**

Legacy 1.x; direct property only, never callable via invoke or postMessage.

<a id="api-version"></a>
### JS3D.version

**Value**

Two-component compatibility version, derived from apiVersion. Schema: `{"const":"1.13"}`.

**Returns**

Property value, synchronous.

**Errors**

None on property access.

**Effects/undo/storage**

None on access.

**Example**

`JS3D.version`

**Since/transports**

Legacy 1.x; direct property only, never callable via invoke or postMessage.

## Shapes

<!-- api:begin index:Shapes -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.add(kind, opts?)` | json; synchronous | [Effects/errors](#api-add) | [Example/reference](#api-add) |
| `JS3D.codeCad(opts)` | json; Promise; see waiting rule | [Effects/errors](#api-codeCad) | [Example/reference](#api-codeCad) |
| `JS3D.fastener(opts)` | json; synchronous | [Effects/errors](#api-fastener) | [Example/reference](#api-fastener) |
| `JS3D.gear(opts)` | json; synchronous | [Effects/errors](#api-gear) | [Example/reference](#api-gear) |
| `JS3D.holePattern(opts)` | json; Promise; see waiting rule | [Effects/errors](#api-holePattern) | [Example/reference](#api-holePattern) |
| `JS3D.knurl(opts?)` | json; synchronous | [Effects/errors](#api-knurl) | [Example/reference](#api-knurl) |
| `JS3D.namePlate(opts)` | json; synchronous | [Effects/errors](#api-namePlate) | [Example/reference](#api-namePlate) |
| `JS3D.spring(opts?)` | json; synchronous | [Effects/errors](#api-spring) | [Example/reference](#api-spring) |
<!-- api:end index:Shapes -->

<a id="api-add"></a>
### JS3D.add

**Signature**

`JS3D.add(kind, opts?)`.

**Arguments/defaults/units**

Adds a primitive centred in x/y with its base at z. Consult kinds() for shape sizes. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Adds a primitive centred in x/y with its base at z. Consult kinds() for shape sizes.

**Errors**

`unknown kind "<kind>"; valid kinds: <kinds>`; `color must look like "#rrggbb"`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.add("box", {size:[40,30,20]});
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:add -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "kind",
        "type": "string"
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "size": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              },
              {
                "type": "object",
                "additionalProperties": {
                  "anyOf": [
                    {
                      "type": "number"
                    },
                    {
                      "type": "string"
                    }
                  ]
                },
                "description": "Only keys returned by kinds() for this shape; w/d/h/size >= 0.01, sides/points integer >= 3, other numbers >= 0."
              }
            ]
          },
          "at": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3,
            "default": [
              0,
              0,
              0
            ]
          },
          "hole": {
            "type": "boolean",
            "default": false
          },
          "color": {
            "type": "string",
            "pattern": "^#[0-9a-fA-F]{6}$"
          },
          "name": {
            "type": "string"
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:add -->

<a id="api-codeCad"></a>
### JS3D.codeCad

**Signature**

`JS3D.codeCad(opts)`.

**Arguments/defaults/units**

Builds one replicad solid in a temporary worker; waits for rebuild. bodyId updates a body. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Builds one replicad solid in a temporary worker; waits for rebuild. bodyId updates a body.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
await JS3D.codeCad({code:"return replicad.makeBox([0,0,0],[20,20,20]);"});
```

**Since/transports**

1.7.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:codeCad -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100000
          },
          "bindings": {
            "type": "object",
            "maxProperties": 20,
            "additionalProperties": {
              "type": "string",
              "minLength": 1
            },
            "propertyNames": {
              "pattern": "^[A-Za-z_$][A-Za-z0-9_$]{0,39}$",
              "not": {
                "const": "__proto__"
              }
            }
          },
          "name": {
            "type": "string"
          },
          "bodyId": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "code"
        ],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:codeCad -->

<a id="api-fastener"></a>
### JS3D.fastener

**Signature**

`JS3D.fastener(opts)`.

**Arguments/defaults/units**

Threaded fastener, size-dependent length (3–150 turns). Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Threaded fastener, size-dependent length (3–150 turns).

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.fastener({type:"bolt",size:"M3",length:12});
```

**Since/transports**

1.2.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:fastener -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "type": {
            "enum": [
              "bolt",
              "nut",
              "rod",
              "cutter"
            ]
          },
          "size": {
            "type": "string"
          },
          "length": {
            "type": "number"
          },
          "clear": {
            "type": "number",
            "minimum": -1,
            "maximum": 0,
            "default": 0
          },
          "left": {
            "type": "boolean",
            "default": false
          },
          "at": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3,
            "default": [
              0,
              0,
              0
            ]
          },
          "name": {
            "type": "string"
          }
        },
        "required": [
          "type",
          "size"
        ],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:fastener -->

<a id="api-gear"></a>
### JS3D.gear

**Signature**

`JS3D.gear(opts)`.

**Arguments/defaults/units**

Gear or rack. Teeth ranges depend on kind; bevel width and bore constrained by geometry. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Gear or rack. Teeth ranges depend on kind; bevel width and bore constrained by geometry.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.gear({module:2,teeth:20});
```

**Since/transports**

1.5.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:gear -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "kind": {
            "anyOf": [
              {
                "enum": [
                  "spur",
                  "helical",
                  "bevel",
                  "rack"
                ],
                "default": "spur"
              },
              {
                "type": "null"
              }
            ],
            "default": "spur"
          },
          "module": {
            "type": "number",
            "minimum": 0.3,
            "maximum": 10
          },
          "teeth": {
            "type": "integer",
            "minimum": 0
          },
          "width": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "angle": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 5,
                "maximum": 30,
                "default": 20
              },
              {
                "type": "null"
              }
            ],
            "default": 20
          },
          "hand": {
            "anyOf": [
              {
                "enum": [
                  "right",
                  "left"
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "mate": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0
              },
              {
                "type": "null"
              }
            ]
          },
          "base": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "bore": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "keyway": {
            "anyOf": [
              {
                "type": "boolean"
              },
              {
                "type": "null"
              }
            ]
          },
          "clear": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "at": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3,
                "default": [
                  0,
                  0,
                  0
                ]
              },
              {
                "type": "null"
              }
            ],
            "default": [
              0,
              0,
              0
            ]
          },
          "name": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "module",
          "teeth"
        ],
        "additionalProperties": true,
        "description": " Optional null-valued keys use defaults; required fields still need valid values. Unknown keys are ignored."
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:gear -->

<a id="api-holePattern"></a>
### JS3D.holePattern

**Signature**

`JS3D.holePattern(opts)`.

**Arguments/defaults/units**

Waits for target, then drills a grid/circle; omitted holes that do not fit are counted in dropped. Does not wait for final rebuild. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits for target, then drills a grid/circle; omitted holes that do not fit are counted in dropped. Does not wait for final rebuild.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
await JS3D.holePattern({body:id,face:"+z",layout:{type:"grid",cols:2,rows:2},hole:{dia:3}});
```

**Since/transports**

1.3.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:holePattern -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "body": {
            "type": "string"
          },
          "face": {
            "enum": [
              "+x",
              "-x",
              "+y",
              "-y",
              "+z",
              "-z"
            ]
          },
          "layout": {
            "type": "object",
            "properties": {
              "type": {
                "enum": [
                  "grid",
                  "circle"
                ]
              },
              "cols": {
                "type": "integer",
                "minimum": 0
              },
              "rows": {
                "type": "integer",
                "minimum": 0
              },
              "pitch": {
                "anyOf": [
                  {
                    "type": "number"
                  },
                  {
                    "type": "array",
                    "items": {
                      "type": "number"
                    },
                    "minItems": 2,
                    "maxItems": 2
                  }
                ]
              },
              "margin": {
                "type": "number"
              },
              "stagger": {
                "type": "boolean"
              },
              "angle": {
                "type": "number"
              },
              "count": {
                "type": "integer",
                "minimum": 0
              },
              "radius": {
                "type": "number"
              },
              "start": {
                "type": "number"
              },
              "center": {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              }
            },
            "required": [],
            "additionalProperties": true
          },
          "hole": {
            "type": "object",
            "properties": {
              "kind": {
                "enum": [
                  "simple",
                  "cbore",
                  "csink",
                  "tapped"
                ],
                "default": "simple"
              },
              "size": {
                "type": "string"
              },
              "dia": {
                "anyOf": [
                  {
                    "type": "number",
                    "exclusiveMinimum": 0
                  },
                  {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  }
                ]
              },
              "depth": {
                "anyOf": [
                  {
                    "type": "number",
                    "exclusiveMinimum": 0
                  },
                  {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  }
                ]
              },
              "tip": {
                "type": "number"
              },
              "cbDia": {
                "anyOf": [
                  {
                    "type": "number",
                    "exclusiveMinimum": 0
                  },
                  {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  }
                ]
              },
              "cbDepth": {
                "anyOf": [
                  {
                    "type": "number",
                    "exclusiveMinimum": 0
                  },
                  {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  }
                ]
              },
              "csDia": {
                "anyOf": [
                  {
                    "type": "number",
                    "exclusiveMinimum": 0
                  },
                  {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  }
                ]
              },
              "csAngle": {
                "type": "number"
              },
              "pitch": {
                "anyOf": [
                  {
                    "type": "number",
                    "exclusiveMinimum": 0
                  },
                  {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  }
                ]
              },
              "clear": {
                "type": "number"
              },
              "shape": {
                "enum": [
                  "round",
                  "square",
                  "hex",
                  "slot"
                ]
              },
              "width": {
                "type": "number"
              },
              "length": {
                "type": "number"
              }
            },
            "required": [],
            "additionalProperties": true
          }
        },
        "required": [
          "body",
          "face",
          "layout",
          "hole"
        ],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "holes": {
        "type": "integer",
        "minimum": 0
      },
      "dropped": {
        "type": "integer",
        "minimum": 0
      },
      "sketch": {
        "type": "string"
      }
    },
    "required": [
      "id",
      "holes",
      "dropped"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:holePattern -->

<a id="api-knurl"></a>
### JS3D.knurl

**Signature**

`JS3D.knurl(opts?)`.

**Arguments/defaults/units**

Cylinder with straight V grooves and optional round, hex or D bore. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Cylinder with straight V grooves and optional round, hex or D bore.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.knurl({diameter:20,length:15,grooves:24,depth:1});
```

**Since/transports**

1.7.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:knurl -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "diameter": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 6,
                "maximum": 150,
                "default": 20
              },
              {
                "type": "null"
              }
            ],
            "default": 20
          },
          "length": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 1,
                "maximum": 200,
                "default": 15
              },
              {
                "type": "null"
              }
            ],
            "default": 15
          },
          "grooves": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 8,
                "maximum": 120
              },
              {
                "type": "null"
              }
            ]
          },
          "depth": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.1
              },
              {
                "type": "null"
              }
            ]
          },
          "bore": {
            "anyOf": [
              {
                "enum": [
                  "none",
                  "round",
                  "hex",
                  "d"
                ],
                "default": "none"
              },
              {
                "type": "null"
              }
            ],
            "default": "none"
          },
          "boreSize": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 1
              },
              {
                "type": "null"
              }
            ]
          },
          "at": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3,
                "default": [
                  0,
                  0,
                  0
                ]
              },
              {
                "type": "null"
              }
            ],
            "default": [
              0,
              0,
              0
            ]
          },
          "name": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [],
        "additionalProperties": true,
        "description": " Optional null-valued keys use defaults; required fields still need valid values. Unknown keys are ignored."
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:knurl -->

<a id="api-namePlate"></a>
### JS3D.namePlate

**Signature**

`JS3D.namePlate(opts)`.

**Arguments/defaults/units**

Plate sized to one line of text; font/layout constraints apply. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Plate sized to one line of text; font/layout constraints apply.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.namePlate({text:"Hello"});
```

**Since/transports**

1.6.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:namePlate -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "font": {
            "anyOf": [
              {
                "enum": [
                  "sans",
                  "serif",
                  "mono"
                ],
                "default": "sans"
              },
              {
                "type": "null"
              }
            ],
            "default": "sans"
          },
          "size": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 2,
                "maximum": 100,
                "default": 10
              },
              {
                "type": "null"
              }
            ],
            "default": 10
          },
          "style": {
            "anyOf": [
              {
                "enum": [
                  "raised",
                  "cut"
                ],
                "default": "raised"
              },
              {
                "type": "null"
              }
            ],
            "default": "raised"
          },
          "depth": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.2,
                "maximum": 10,
                "default": 1
              },
              {
                "type": "null"
              }
            ],
            "default": 1
          },
          "thickness": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.6,
                "maximum": 20,
                "default": 3
              },
              {
                "type": "null"
              }
            ],
            "default": 3
          },
          "margin": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 1.5,
                "maximum": 20,
                "default": 3
              },
              {
                "type": "null"
              }
            ],
            "default": 3
          },
          "shape": {
            "anyOf": [
              {
                "enum": [
                  "rounded",
                  "pill"
                ],
                "default": "rounded"
              },
              {
                "type": "null"
              }
            ],
            "default": "rounded"
          },
          "holes": {
            "anyOf": [
              {
                "enum": [
                  "none",
                  "hang",
                  "screws"
                ],
                "default": "hang"
              },
              {
                "type": "null"
              }
            ],
            "default": "hang"
          },
          "holeDia": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 1
              },
              {
                "type": "null"
              }
            ]
          },
          "color": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "textColor": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "at": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3,
                "default": [
                  0,
                  0,
                  0
                ]
              },
              {
                "type": "null"
              }
            ],
            "default": [
              0,
              0,
              0
            ]
          },
          "name": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "text"
        ],
        "additionalProperties": true,
        "description": " Optional null-valued keys use defaults; required fields still need valid values. Unknown keys are ignored."
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "plate": {
        "type": "string"
      },
      "textBody": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "size": {
        "type": "array",
        "items": {
          "type": "number"
        },
        "minItems": 3,
        "maxItems": 3
      }
    },
    "required": [
      "plate",
      "textBody",
      "size"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:namePlate -->

<a id="api-spring"></a>
### JS3D.spring

**Signature**

`JS3D.spring(opts?)`.

**Arguments/defaults/units**

Compression spring; finite dimensions must give a feasible spring. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Compression spring; finite dimensions must give a feasible spring.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.spring({wire:2,outside:20,freeLength:40,turns:6});
```

**Since/transports**

1.8.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:spring -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "wire": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.4,
                "maximum": 10,
                "default": 2
              },
              {
                "type": "null"
              }
            ],
            "default": 2
          },
          "outside": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 2,
                "maximum": 200,
                "default": 20
              },
              {
                "type": "null"
              }
            ],
            "default": 20
          },
          "freeLength": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 1,
                "maximum": 300,
                "default": 30
              },
              {
                "type": "null"
              }
            ],
            "default": 30
          },
          "turns": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 2,
                "maximum": 10,
                "multipleOf": 0.5,
                "default": 5
              },
              {
                "type": "null"
              }
            ],
            "default": 5
          },
          "hand": {
            "anyOf": [
              {
                "enum": [
                  "right",
                  "left"
                ],
                "default": "right"
              },
              {
                "type": "null"
              }
            ],
            "default": "right"
          },
          "ends": {
            "anyOf": [
              {
                "enum": [
                  "open",
                  "flat"
                ],
                "default": "open"
              },
              {
                "type": "null"
              }
            ],
            "default": "open"
          },
          "color": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "at": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3,
                "default": [
                  0,
                  0,
                  0
                ]
              },
              {
                "type": "null"
              }
            ],
            "default": [
              0,
              0,
              0
            ]
          },
          "name": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [],
        "additionalProperties": true,
        "description": " Optional null-valued keys use defaults; required fields still need valid values. Unknown keys are ignored."
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:spring -->

## Parameters

<!-- api:begin index:Parameters -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.bind(id, key, expr)` | json; synchronous | [Effects/errors](#api-bind) | [Example/reference](#api-bind) |
| `JS3D.removeParam(name)` | json; synchronous | [Effects/errors](#api-removeParam) | [Example/reference](#api-removeParam) |
| `JS3D.setParam(name, expr, opts?)` | json; synchronous | [Effects/errors](#api-setParam) | [Example/reference](#api-setParam) |
<!-- api:end index:Parameters -->

<a id="api-bind"></a>
### JS3D.bind

**Signature**

`JS3D.bind(id, key, expr)`.

**Arguments/defaults/units**

Binds primitive numeric size or frees with null; returns current size. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Binds primitive numeric size or frees with null; returns current size.

**Errors**

`bind works on plain shapes`; `no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.bind(id,"w","W");
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:bind -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "key",
        "type": "string"
      },
      {
        "title": "expr",
        "anyOf": [
          {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "number"
              }
            ]
          },
          {
            "type": "null"
          }
        ]
      }
    ],
    "minItems": 3,
    "maxItems": 3,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "number"
  }
}
```
<!-- api:end schema:bind -->

<a id="api-removeParam"></a>
### JS3D.removeParam

**Signature**

`JS3D.removeParam(name)`.

**Arguments/defaults/units**

Removes named parameter and reports freed bindings. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Removes named parameter and reports freed bindings.

**Errors**

`no parameter <name>`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.removeParam("W");
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:removeParam -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "name",
        "type": "string"
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "integer",
    "minimum": 0
  }
}
```
<!-- api:end schema:removeParam -->

<a id="api-setParam"></a>
### JS3D.setParam

**Signature**

`JS3D.setParam(name, expr, opts?)`.

**Arguments/defaults/units**

Sets parameter; expressions must evaluate. Invalid expression leaves document/history untouched. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Sets parameter; expressions must evaluate. Invalid expression leaves document/history untouched.

**Errors**

`expression is empty`; `expression did not evaluate`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.setParam("W","40");
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:setParam -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "name",
        "type": "string"
      },
      {
        "title": "expr",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "number"
          }
        ]
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "unit": {
            "enum": [
              "mm",
              "in"
            ],
            "default": "mm"
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 2,
    "maxItems": 3,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "number"
  }
}
```
<!-- api:end schema:setParam -->

## Generators

<!-- api:begin index:Generators -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.boxMaker(opts?)` | json; synchronous | [Effects/errors](#api-boxMaker) | [Example/reference](#api-boxMaker) |
| `JS3D.drawing(opts?)` | bytes; Promise; see waiting rule | [Effects/errors](#api-drawing) | [Example/reference](#api-drawing) |
| `JS3D.gearSet(opts?)` | json; synchronous | [Effects/errors](#api-gearSet) | [Example/reference](#api-gearSet) |
| `JS3D.hardware(opts)` | json; synchronous | [Effects/errors](#api-hardware) | [Example/reference](#api-hardware) |
| `JS3D.texture(id, opts?)` | json; Promise; see waiting rule | [Effects/errors](#api-texture) | [Example/reference](#api-texture) |
| `JS3D.textures()` | json; synchronous | [Effects/errors](#api-textures) | [Example/reference](#api-textures) |
<!-- api:end index:Generators -->

<a id="api-boxMaker"></a>
### JS3D.boxMaker

**Signature**

`JS3D.boxMaker(opts?)`.

**Arguments/defaults/units**

Uses Box Maker structures; dependent dimensions/style limits checked. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Uses Box Maker structures; dependent dimensions/style limits checked.

**Errors**

`unknown option "<key>"; options: <keys>`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.boxMaker({style:"drawer"});
```

**Since/transports**

1.11.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:boxMaker -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "style": {
            "anyOf": [
              {
                "enum": [
                  "bin",
                  "drawer",
                  "tilt",
                  "door"
                ],
                "default": "bin"
              },
              {
                "type": "null"
              }
            ],
            "default": "bin"
          },
          "w": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 10,
                "maximum": 1000,
                "default": 120
              },
              {
                "type": "null"
              }
            ],
            "default": 120
          },
          "d": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 10,
                "maximum": 1000,
                "default": 80
              },
              {
                "type": "null"
              }
            ],
            "default": 80
          },
          "h": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 5,
                "maximum": 1000,
                "default": 40
              },
              {
                "type": "null"
              }
            ],
            "default": 40
          },
          "units": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 8,
                "default": 1
              },
              {
                "type": "null"
              }
            ],
            "default": 1
          },
          "across": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 8,
                "default": 1
              },
              {
                "type": "null"
              }
            ],
            "default": 1
          },
          "cols": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 20,
                "default": 3
              },
              {
                "type": "null"
              }
            ],
            "default": 3
          },
          "rows": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 20,
                "default": 2
              },
              {
                "type": "null"
              }
            ],
            "default": 2
          },
          "shape": {
            "anyOf": [
              {
                "enum": [
                  "square",
                  "round",
                  "hex"
                ],
                "default": "square"
              },
              {
                "type": "null"
              }
            ],
            "default": "square"
          },
          "wall": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.4,
                "maximum": 20,
                "default": 1.6
              },
              {
                "type": "null"
              }
            ],
            "default": 1.6
          },
          "divider": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.4,
                "maximum": 20,
                "default": 1.2
              },
              {
                "type": "null"
              }
            ],
            "default": 1.2
          },
          "floor": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.4,
                "maximum": 20,
                "default": 1.2
              },
              {
                "type": "null"
              }
            ],
            "default": 1.2
          },
          "radius": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 100,
                "default": 4
              },
              {
                "type": "null"
              }
            ],
            "default": 4
          },
          "inner": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 50,
                "default": 2
              },
              {
                "type": "null"
              }
            ],
            "default": 2
          },
          "scoop": {
            "anyOf": [
              {
                "type": "boolean",
                "default": true
              },
              {
                "type": "null"
              }
            ],
            "default": true
          },
          "scoopR": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 1,
                "maximum": 100,
                "default": 10
              },
              {
                "type": "null"
              }
            ],
            "default": 10
          },
          "label": {
            "anyOf": [
              {
                "type": "boolean",
                "default": false
              },
              {
                "type": "null"
              }
            ],
            "default": false
          },
          "labelW": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 2,
                "maximum": 100,
                "default": 10
              },
              {
                "type": "null"
              }
            ],
            "default": 10
          },
          "stack": {
            "anyOf": [
              {
                "type": "boolean",
                "default": false
              },
              {
                "type": "null"
              }
            ],
            "default": false
          },
          "foot": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 1,
                "maximum": 50,
                "default": 3
              },
              {
                "type": "null"
              }
            ],
            "default": 3
          },
          "lid": {
            "anyOf": [
              {
                "type": "boolean",
                "default": false
              },
              {
                "type": "null"
              }
            ],
            "default": false
          },
          "clear": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 2,
                "default": 0.25
              },
              {
                "type": "null"
              }
            ],
            "default": 0.25
          },
          "lock": {
            "anyOf": [
              {
                "enum": [
                  "dovetail",
                  "pegs",
                  "none"
                ],
                "default": "dovetail"
              },
              {
                "type": "null"
              }
            ],
            "default": "dovetail"
          },
          "sideLock": {
            "anyOf": [
              {
                "enum": [
                  "dovetail",
                  "pegs",
                  "none"
                ],
                "default": "dovetail"
              },
              {
                "type": "null"
              }
            ],
            "default": "dovetail"
          },
          "caseT": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 1.2,
                "maximum": 20,
                "default": 2.4
              },
              {
                "type": "null"
              }
            ],
            "default": 2.4
          },
          "pull": {
            "anyOf": [
              {
                "enum": [
                  "bar",
                  "knob",
                  "notch"
                ],
                "default": "bar"
              },
              {
                "type": "null"
              }
            ],
            "default": "bar"
          },
          "hinge": {
            "anyOf": [
              {
                "enum": [
                  "left",
                  "right"
                ],
                "default": "left"
              },
              {
                "type": "null"
              }
            ],
            "default": "left"
          },
          "doorPull": {
            "anyOf": [
              {
                "enum": [
                  "knob",
                  "hole",
                  "bar"
                ],
                "default": "knob"
              },
              {
                "type": "null"
              }
            ],
            "default": "knob"
          },
          "doorCatch": {
            "anyOf": [
              {
                "enum": [
                  "none",
                  "light",
                  "firm"
                ],
                "default": "light"
              },
              {
                "type": "null"
              }
            ],
            "default": "light"
          },
          "layout": {
            "anyOf": [
              {
                "enum": [
                  "assembled",
                  "print"
                ],
                "default": "assembled"
              },
              {
                "type": "null"
              }
            ],
            "default": "assembled"
          },
          "at": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3,
                "default": [
                  0,
                  0,
                  0
                ]
              },
              {
                "type": "null"
              }
            ],
            "default": [
              0,
              0,
              0
            ]
          },
          "name": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [],
        "additionalProperties": false,
        "description": "Null option values select defaults. Case styles require w/d >=30, h >=20; drawer cols/rows <=12, tilt cols <=8. Full defaults and geometric constraints in generator reference. Optional null-valued keys use defaults; required fields still need valid values. Unknown keys are rejected."
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "parts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "kind": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "name"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "cell": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "w": {
                "type": "number"
              },
              "d": {
                "type": "number"
              },
              "h": {
                "type": "number"
              }
            },
            "required": [
              "w",
              "d",
              "h"
            ],
            "additionalProperties": false
          },
          {
            "type": "null"
          }
        ]
      },
      "info": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 0
          }
        ]
      }
    },
    "required": [
      "id",
      "parts",
      "cell",
      "info"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:boxMaker -->

<a id="api-drawing"></a>
### JS3D.drawing

**Signature**

`JS3D.drawing(opts?)`.

**Arguments/defaults/units**

Waits; returns DXF bytes; selected shown solids only, canonical view ordering. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to Uint8Array. Waits; returns DXF bytes; selected shown solids only, canonical view ordering.

**Errors**

`nothing to draw: holes and hidden shapes are left out`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only.

**Example**

```js
await JS3D.drawing({views:["top"]});
```

**Since/transports**

1.11.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:drawing -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "ids": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "minItems": 1
              }
            ]
          },
          "views": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "enum": [
                    "top",
                    "front",
                    "right"
                  ]
                },
                "minItems": 1,
                "maxItems": 3,
                "uniqueItems": true,
                "default": [
                  "top",
                  "front",
                  "right"
                ]
              },
              {
                "type": "null"
              }
            ],
            "default": [
              "top",
              "front",
              "right"
            ]
          },
          "scale": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.01,
                "maximum": 100,
                "default": 1
              },
              {
                "type": "null"
              }
            ],
            "default": 1
          },
          "units": {
            "anyOf": [
              {
                "enum": [
                  "mm",
                  "in"
                ],
                "default": "mm"
              },
              {
                "type": "null"
              }
            ],
            "default": "mm"
          },
          "dims": {
            "anyOf": [
              {
                "type": "boolean",
                "default": false
              },
              {
                "type": "null"
              }
            ],
            "default": false
          }
        },
        "required": [],
        "additionalProperties": false,
        "description": " Optional null-valued keys use defaults; required fields still need valid values. Unknown keys are rejected."
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "bytes",
  "returnsSchema": {
    "type": "string",
    "contentEncoding": "base64",
    "description": "Direct: Uint8Array. invoke/WebSocket: {$bytes:base64}; this schema describes the encoded payload."
  }
}
```
<!-- api:end schema:drawing -->

<a id="api-gearSet"></a>
### JS3D.gearSet

**Signature**

`JS3D.gearSet(opts?)`.

**Arguments/defaults/units**

Library assemblies or bevel/helical pair; joints for library sets by default. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Library assemblies or bevel/helical pair; joints for library sets by default.

**Errors**

`<key> is not used for type "<type>"`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.gearSet({type:"pair"});
```

**Since/transports**

1.11.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:gearSet -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "type": {
            "anyOf": [
              {
                "enum": [
                  "pair",
                  "rack",
                  "ring",
                  "planet",
                  "bevel",
                  "helical"
                ],
                "default": "pair"
              },
              {
                "type": "null"
              }
            ],
            "default": "pair"
          },
          "module": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.3,
                "maximum": 10,
                "default": 2
              },
              {
                "type": "null"
              }
            ],
            "default": 2
          },
          "teeth": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0
              },
              {
                "type": "null"
              }
            ]
          },
          "teeth2": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0
              },
              {
                "type": "null"
              }
            ]
          },
          "sunTeeth": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 8,
                "maximum": 200
              },
              {
                "type": "null"
              }
            ]
          },
          "planetTeeth": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 8,
                "maximum": 200
              },
              {
                "type": "null"
              }
            ]
          },
          "planets": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 2,
                "maximum": 6
              },
              {
                "type": "null"
              }
            ]
          },
          "width": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.5,
                "maximum": 200
              },
              {
                "type": "null"
              }
            ]
          },
          "bore": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0
              },
              {
                "type": "null"
              }
            ]
          },
          "boreShape": {
            "anyOf": [
              {
                "enum": [
                  "round",
                  "d",
                  "hex",
                  "key"
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "backlash": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              {
                "type": "null"
              }
            ]
          },
          "pressureAngle": {
            "anyOf": [
              {
                "enum": [
                  14.5,
                  20,
                  25
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "rackLength": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 2000
              },
              {
                "type": "null"
              }
            ]
          },
          "rackHeight": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 2,
                "maximum": 100
              },
              {
                "type": "null"
              }
            ]
          },
          "joints": {
            "anyOf": [
              {
                "type": "boolean",
                "default": true
              },
              {
                "type": "null"
              }
            ],
            "default": true
          },
          "clear": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "angle": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 5,
                "maximum": 30
              },
              {
                "type": "null"
              }
            ]
          },
          "hand": {
            "anyOf": [
              {
                "enum": [
                  "right",
                  "left"
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "at": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3,
                "default": [
                  0,
                  0,
                  0
                ]
              },
              {
                "type": "null"
              }
            ],
            "default": [
              0,
              0,
              0
            ]
          }
        },
        "required": [],
        "additionalProperties": false,
        "description": "Null selects defaults. Type-specific keys enforced. Library teeth 6–300/400, bevel 12–90, helical 12–30. Ring needs teeth2 >= teeth+8; planet assembly/clearance and bore limits depend on dimensions. Optional null-valued keys use defaults; required fields still need valid values. Unknown keys are rejected."
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "parts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "kind": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "name"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "info": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 0
          }
        ]
      }
    },
    "required": [
      "id",
      "parts",
      "info"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:gearSet -->

<a id="api-hardware"></a>
### JS3D.hardware

**Signature**

`JS3D.hardware(opts)`.

**Arguments/defaults/units**

Size must exist for part; length/threads only on supported parts; clear defaults to design offset. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Size must exist for part; length/threads only on supported parts; clear defaults to design offset.

**Errors**

`length is not used for part "<part>"`; `part "<part>" has no thread`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.hardware({part:"shcs",size:"M3",length:10});
```

**Since/transports**

1.11.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:hardware -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "part": {
            "enum": [
              "hexbolt",
              "shcs",
              "button",
              "flat",
              "set",
              "wood",
              "rod",
              "nut",
              "nyloc",
              "sqnut",
              "washer",
              "lockw",
              "insert",
              "dowel"
            ]
          },
          "size": {
            "type": "string"
          },
          "length": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 1,
                "maximum": 300
              },
              {
                "type": "null"
              }
            ]
          },
          "threads": {
            "anyOf": [
              {
                "type": "boolean",
                "default": false
              },
              {
                "type": "null"
              }
            ],
            "default": false
          },
          "clear": {
            "anyOf": [
              {
                "type": "number",
                "minimum": -1,
                "maximum": 0
              },
              {
                "type": "null"
              }
            ]
          },
          "left": {
            "anyOf": [
              {
                "type": "boolean",
                "default": false
              },
              {
                "type": "null"
              }
            ],
            "default": false
          },
          "at": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3,
                "default": [
                  0,
                  0,
                  0
                ]
              },
              {
                "type": "null"
              }
            ],
            "default": [
              0,
              0,
              0
            ]
          },
          "name": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "part",
          "size"
        ],
        "additionalProperties": false,
        "description": " Optional null-valued keys use defaults; required fields still need valid values. Unknown keys are rejected."
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:hardware -->

<a id="api-texture"></a>
### JS3D.texture

**Signature**

`JS3D.texture(id, opts?)`.

**Arguments/defaults/units**

Waits for base, resolves faces once, changes mesh only (not STEP/solid volume). Does not wait for final rebuild. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits for base, resolves faces once, changes mesh only (not STEP/solid volume). Does not wait for final rebuild.

**Errors**

`<name> changed while the texture was being prepared; try again`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
await JS3D.texture(id,{texture:"knurl",faces:"top"});
```

**Since/transports**

1.11.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:texture -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "texture": {
            "anyOf": [
              {
                "type": "string",
                "default": "knurl"
              },
              {
                "type": "null"
              }
            ],
            "default": "knurl"
          },
          "faces": {
            "anyOf": [
              {
                "anyOf": [
                  {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 500,
                    "description": "World-space selector expressions; see Selectors. Resolved once; indices expire at the next edit."
                  },
                  {
                    "type": "integer",
                    "minimum": 0
                  },
                  {
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "minItems": 1
                  }
                ],
                "default": "all"
              },
              {
                "type": "null"
              }
            ],
            "default": "all"
          },
          "size": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.5,
                "maximum": 100
              },
              {
                "type": "null"
              }
            ]
          },
          "depth": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0.05,
                "maximum": 3,
                "default": 0.6
              },
              {
                "type": "null"
              }
            ],
            "default": 0.6
          },
          "dir": {
            "anyOf": [
              {
                "enum": [
                  "raise",
                  "engrave",
                  "both"
                ],
                "default": "raise"
              },
              {
                "type": "null"
              }
            ],
            "default": "raise"
          },
          "rotation": {
            "anyOf": [
              {
                "type": "number",
                "minimum": -180,
                "maximum": 180,
                "default": 0
              },
              {
                "type": "null"
              }
            ],
            "default": 0
          },
          "mapping": {
            "anyOf": [
              {
                "enum": [
                  "auto",
                  "planar",
                  "cylindrical",
                  "triplanar"
                ],
                "default": "auto"
              },
              {
                "type": "null"
              }
            ],
            "default": "auto"
          },
          "edgeBlend": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0,
                "maximum": 10,
                "default": 0
              },
              {
                "type": "null"
              }
            ],
            "default": 0
          },
          "invert": {
            "anyOf": [
              {
                "type": "boolean",
                "default": false
              },
              {
                "type": "null"
              }
            ],
            "default": false
          },
          "once": {
            "anyOf": [
              {
                "type": "boolean",
                "default": false
              },
              {
                "type": "null"
              }
            ],
            "default": false
          }
        },
        "required": [],
        "additionalProperties": false,
        "description": " Optional null-valued keys use defaults; required fields still need valid values. Unknown keys are rejected."
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "body": {
        "type": "string"
      },
      "texture": {
        "type": "string"
      },
      "faces": {
        "anyOf": [
          {
            "const": "all"
          },
          {
            "type": "integer",
            "minimum": 0
          }
        ]
      }
    },
    "required": [
      "body",
      "texture",
      "faces"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:texture -->

<a id="api-textures"></a>
### JS3D.textures

**Signature**

`JS3D.textures()`.

**Arguments/defaults/units**

Available texture keys and default tile sizes. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Available texture keys and default tile sizes.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.textures();
```

**Since/transports**

1.11.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:textures -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "size": {
          "type": "number"
        }
      },
      "required": [
        "key",
        "name",
        "category",
        "size"
      ],
      "additionalProperties": false
    },
    "minItems": 0
  }
}
```
<!-- api:end schema:textures -->

## Advanced CAD

<!-- api:begin index:Advanced CAD -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.chamfer(id, edges, d)` | json; Promise; see waiting rule | [Effects/errors](#api-chamfer) | [Example/reference](#api-chamfer) |
| `JS3D.edges(id, selector?)` | json; Promise; see waiting rule | [Effects/errors](#api-edges) | [Example/reference](#api-edges) |
| `JS3D.extrude(opts)` | json; Promise; see waiting rule | [Effects/errors](#api-extrude) | [Example/reference](#api-extrude) |
| `JS3D.faces(id, selector?)` | json; Promise; see waiting rule | [Effects/errors](#api-faces) | [Example/reference](#api-faces) |
| `JS3D.fillet(id, edges, r)` | json; Promise; see waiting rule | [Effects/errors](#api-fillet) | [Example/reference](#api-fillet) |
| `JS3D.hole(id, opts)` | json; Promise; see waiting rule | [Effects/errors](#api-hole) | [Example/reference](#api-hole) |
| `JS3D.pattern(id, opts)` | json; synchronous | [Effects/errors](#api-pattern) | [Example/reference](#api-pattern) |
| `JS3D.revolve(opts)` | json; Promise; see waiting rule | [Effects/errors](#api-revolve) | [Example/reference](#api-revolve) |
| `JS3D.shell(id, opts)` | json; Promise; see waiting rule | [Effects/errors](#api-shell) | [Example/reference](#api-shell) |
| `JS3D.sketch(opts)` | json; Promise; see waiting rule | [Effects/errors](#api-sketch) | [Example/reference](#api-sketch) |
<!-- api:end index:Advanced CAD -->

<a id="api-chamfer"></a>
### JS3D.chamfer

**Signature**

`JS3D.chamfer(id, edges, d)`.

**Arguments/defaults/units**

Waits for target; adds feature, not final rebuild. Oversized radius/distance can produce later list().error. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits for target; adds feature, not final rebuild. Oversized radius/distance can produce later list().error.

**Errors**

`no edges match "<text>" on <name>`; `no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
await JS3D.chamfer(id,"edges of top",1);
```

**Since/transports**

1.9.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:chamfer -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "edges",
        "$ref": "#/$defs/selector"
      },
      {
        "title": "d",
        "anyOf": [
          {
            "type": "number",
            "exclusiveMinimum": 0
          },
          {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        ]
      }
    ],
    "minItems": 3,
    "maxItems": 3,
    "$defs": {
      "selector": {
        "anyOf": [
          {
            "type": "string",
            "minLength": 1,
            "maxLength": 500,
            "description": "World-space selector expressions; see Selectors. Resolved once; indices expire at the next edit."
          },
          {
            "type": "integer",
            "minimum": 0
          },
          {
            "type": "array",
            "items": {
              "type": "integer",
              "minimum": 0
            },
            "minItems": 1
          }
        ]
      }
    },
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "body": {
        "type": "string"
      },
      "feature": {
        "type": "string"
      },
      "edges": {
        "type": "integer",
        "minimum": 0
      }
    },
    "required": [
      "body",
      "feature",
      "edges"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:chamfer -->

<a id="api-edges"></a>
### JS3D.edges

**Signature**

`JS3D.edges(id, selector?)`.

**Arguments/defaults/units**

Waits for target and returns world-space topology; indices valid until next edit. No matches throws; never an empty success. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits for target and returns world-space topology; indices valid until next edit. No matches throws; never an empty success.

**Errors**

`no <kind>s match "<text>" on <name>`; `no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

No document write; cancels active command via edit guard.

**Example**

```js
await JS3D.edges(id,"all");
```

**Since/transports**

1.9.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:edges -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "selector",
        "anyOf": [
          {
            "type": "string",
            "minLength": 1,
            "maxLength": 500,
            "description": "World-space selector expressions; see Selectors. Resolved once; indices expire at the next edit."
          },
          {
            "type": "integer",
            "minimum": 0
          },
          {
            "type": "array",
            "items": {
              "type": "integer",
              "minimum": 0
            },
            "minItems": 1
          }
        ],
        "default": "all"
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "index": {
          "type": "integer",
          "minimum": 0
        },
        "type": {
          "enum": [
            "line",
            "circle",
            "ellipse",
            "other"
          ]
        },
        "start": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "end": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "mid": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "center": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "direction": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "length": {
          "type": "number"
        },
        "radius": {
          "anyOf": [
            {
              "type": "number"
            },
            {
              "type": "null"
            }
          ]
        },
        "faces": {
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 0
          },
          "minItems": 0
        }
      },
      "required": [
        "index",
        "type",
        "start",
        "end",
        "mid",
        "center",
        "length",
        "faces"
      ],
      "additionalProperties": false
    },
    "minItems": 0
  }
}
```
<!-- api:end schema:edges -->

<a id="api-extrude"></a>
### JS3D.extrude

**Signature**

`JS3D.extrude(opts)`.

**Arguments/defaults/units**

New body or join/cut feature; join/cut require body and forbid name. Profiles [] means defaults. Returns before resulting geometry rebuild; through extrusion waits for target. Revolve axis must lie in sketch plane. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. New body or join/cut feature; join/cut require body and forbid name. Profiles [] means defaults. Returns before resulting geometry rebuild; through extrusion waits for target. Revolve axis must lie in sketch plane.

**Errors**

`no sketch <id>`; `body is only for op "join" or "cut"`; `dist2 is only for mode "two"`; `give dist or through, not both`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
await JS3D.extrude({sketch:sk.sketch,dist:20});
```

**Since/transports**

1.9.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:extrude -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "sketch": {
            "type": "string"
          },
          "profiles": {
            "type": "array",
            "items": {
              "type": "array",
              "items": {
                "type": "number"
              },
              "minItems": 2,
              "maxItems": 2
            },
            "minItems": 0
          },
          "op": {
            "enum": [
              "new",
              "join",
              "cut"
            ],
            "default": "new"
          },
          "body": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "dist": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "description": "Parameter/sketch expression; evaluated value must satisfy the call constraints."
              }
            ]
          },
          "through": {
            "type": "boolean"
          },
          "mode": {
            "enum": [
              "one",
              "sym",
              "two"
            ],
            "default": "one"
          },
          "dist2": {
            "anyOf": [
              {
                "type": "number",
                "exclusiveMinimum": 0
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            ]
          }
        },
        "required": [
          "sketch"
        ],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "body": {
        "type": "string"
      },
      "feature": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "body",
      "feature"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:extrude -->

<a id="api-faces"></a>
### JS3D.faces

**Signature**

`JS3D.faces(id, selector?)`.

**Arguments/defaults/units**

Waits for target and returns world-space topology; indices valid until next edit. No matches throws; never an empty success. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits for target and returns world-space topology; indices valid until next edit. No matches throws; never an empty success.

**Errors**

`no <kind>s match "<text>" on <name>`; `no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

No document write; cancels active command via edit guard.

**Example**

```js
await JS3D.faces(id,"all");
```

**Since/transports**

1.9.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:faces -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "selector",
        "anyOf": [
          {
            "type": "string",
            "minLength": 1,
            "maxLength": 500,
            "description": "World-space selector expressions; see Selectors. Resolved once; indices expire at the next edit."
          },
          {
            "type": "integer",
            "minimum": 0
          },
          {
            "type": "array",
            "items": {
              "type": "integer",
              "minimum": 0
            },
            "minItems": 1
          }
        ],
        "default": "all"
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "index": {
          "type": "integer",
          "minimum": 0
        },
        "type": {
          "enum": [
            "plane",
            "cylinder",
            "cone",
            "sphere",
            "torus",
            "other"
          ]
        },
        "center": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "normal": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "area": {
          "type": "number"
        },
        "radius": {
          "type": "number"
        },
        "axis": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "hole": {
          "type": "boolean"
        },
        "edgeCount": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "index",
        "type",
        "center",
        "area",
        "edgeCount"
      ],
      "additionalProperties": false
    },
    "minItems": 0
  }
}
```
<!-- api:end schema:faces -->

<a id="api-fillet"></a>
### JS3D.fillet

**Signature**

`JS3D.fillet(id, edges, r)`.

**Arguments/defaults/units**

Waits for target; adds feature, not final rebuild. Oversized radius/distance can produce later list().error. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits for target; adds feature, not final rebuild. Oversized radius/distance can produce later list().error.

**Errors**

`no edges match "<text>" on <name>`; `no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
await JS3D.fillet(id,"edges of top",1);
```

**Since/transports**

1.9.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:fillet -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "edges",
        "$ref": "#/$defs/selector"
      },
      {
        "title": "r",
        "anyOf": [
          {
            "type": "number",
            "exclusiveMinimum": 0
          },
          {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        ]
      }
    ],
    "minItems": 3,
    "maxItems": 3,
    "$defs": {
      "selector": {
        "anyOf": [
          {
            "type": "string",
            "minLength": 1,
            "maxLength": 500,
            "description": "World-space selector expressions; see Selectors. Resolved once; indices expire at the next edit."
          },
          {
            "type": "integer",
            "minimum": 0
          },
          {
            "type": "array",
            "items": {
              "type": "integer",
              "minimum": 0
            },
            "minItems": 1
          }
        ]
      }
    },
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "body": {
        "type": "string"
      },
      "feature": {
        "type": "string"
      },
      "edges": {
        "type": "integer",
        "minimum": 0
      }
    },
    "required": [
      "body",
      "feature",
      "edges"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:fillet -->

<a id="api-hole"></a>
### JS3D.hole

**Signature**

`JS3D.hole(id, opts)`.

**Arguments/defaults/units**

Waits for one flat face. Projects points to face. Round holes only; omit depth for through. Fits/overlap/count checked. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits for one flat face. Projects points to face. Round holes only; omit depth for through. Fits/overlap/count checked.

**Errors**

`hole makes round holes; use holePattern for square, hex or slot holes`; `no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
await JS3D.hole(id,{face:"top",points:[[0,0,0]],dia:3});
```

**Since/transports**

1.9.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:hole -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "face": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 500,
                "description": "World-space selector expressions; see Selectors. Resolved once; indices expire at the next edit."
              },
              {
                "type": "integer",
                "minimum": 0
              },
              {
                "type": "array",
                "items": {
                  "type": "integer",
                  "minimum": 0
                },
                "minItems": 1
              }
            ]
          },
          "points": {
            "type": "array",
            "items": {
              "type": "array",
              "items": {
                "type": "number"
              },
              "minItems": 3,
              "maxItems": 3
            },
            "minItems": 1
          },
          "kind": {
            "enum": [
              "simple",
              "cbore",
              "csink",
              "tapped"
            ],
            "default": "simple"
          },
          "size": {
            "type": "string"
          },
          "dia": {
            "anyOf": [
              {
                "type": "number",
                "exclusiveMinimum": 0
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            ]
          },
          "depth": {
            "anyOf": [
              {
                "type": "number",
                "exclusiveMinimum": 0
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            ]
          },
          "tip": {
            "type": "number"
          },
          "cbDia": {
            "anyOf": [
              {
                "type": "number",
                "exclusiveMinimum": 0
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            ]
          },
          "cbDepth": {
            "anyOf": [
              {
                "type": "number",
                "exclusiveMinimum": 0
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            ]
          },
          "csDia": {
            "anyOf": [
              {
                "type": "number",
                "exclusiveMinimum": 0
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            ]
          },
          "csAngle": {
            "type": "number"
          },
          "pitch": {
            "anyOf": [
              {
                "type": "number",
                "exclusiveMinimum": 0
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            ]
          },
          "clear": {
            "type": "number"
          }
        },
        "required": [
          "face",
          "points"
        ],
        "additionalProperties": true
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "body": {
        "type": "string"
      },
      "feature": {
        "type": "string"
      },
      "holes": {
        "type": "integer",
        "minimum": 0
      }
    },
    "required": [
      "body",
      "feature",
      "holes"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:hole -->

<a id="api-pattern"></a>
### JS3D.pattern

**Signature**

`JS3D.pattern(id, opts)`.

**Arguments/defaults/units**

Rect counts 1–200; circle 2–360; max 2000 including original. Nonzero spacing for repeated directions; axis2 required if count2 > 1. Only supported feature types or ["shape"]. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Rect counts 1–200; circle 2–360; max 2000 including original. Nonzero spacing for repeated directions; axis2 required if count2 > 1. Only supported feature types or ["shape"].

**Errors**

`features must be a list of feature ids, or ["shape"]`; `the pattern makes no copies; give count or count2 of 2 or more`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.pattern(id,{features:["shape"],type:"rect",axis:"x",count:2,spacing:40});
```

**Since/transports**

1.9.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:pattern -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "features": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          },
          "type": {
            "enum": [
              "rect",
              "circle"
            ]
          },
          "axis": {
            "anyOf": [
              {
                "enum": [
                  "x",
                  "y",
                  "z",
                  "X",
                  "Y",
                  "Z"
                ]
              },
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              }
            ]
          },
          "count": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "description": "Parameter/sketch expression; evaluated value must satisfy the call constraints."
              }
            ]
          },
          "spacing": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "description": "Parameter/sketch expression; evaluated value must satisfy the call constraints."
              }
            ]
          },
          "axis2": {
            "anyOf": [
              {
                "enum": [
                  "x",
                  "y",
                  "z",
                  "X",
                  "Y",
                  "Z"
                ]
              },
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              }
            ]
          },
          "count2": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "description": "Parameter/sketch expression; evaluated value must satisfy the call constraints."
              }
            ],
            "default": 1
          },
          "spacing2": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "description": "Parameter/sketch expression; evaluated value must satisfy the call constraints."
              }
            ]
          },
          "both": {
            "type": "boolean",
            "default": false
          },
          "angle": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "description": "Parameter/sketch expression; evaluated value must satisfy the call constraints."
              }
            ],
            "default": 360
          },
          "center": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3,
            "default": [
              0,
              0,
              0
            ]
          }
        },
        "required": [
          "features",
          "type",
          "axis",
          "count"
        ],
        "additionalProperties": true
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "body": {
        "type": "string"
      },
      "feature": {
        "type": "string"
      },
      "copies": {
        "type": "integer",
        "minimum": 0
      }
    },
    "required": [
      "body",
      "feature",
      "copies"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:pattern -->

<a id="api-revolve"></a>
### JS3D.revolve

**Signature**

`JS3D.revolve(opts)`.

**Arguments/defaults/units**

New body or join/cut feature; join/cut require body and forbid name. Profiles [] means defaults. Returns before resulting geometry rebuild; through extrusion waits for target. Revolve axis must lie in sketch plane. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. New body or join/cut feature; join/cut require body and forbid name. Profiles [] means defaults. Returns before resulting geometry rebuild; through extrusion waits for target. Revolve axis must lie in sketch plane.

**Errors**

`no sketch <id>`; `body is only for op "join" or "cut"`; `dist2 is only for mode "two"`; `give dist or through, not both`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
await JS3D.revolve({sketch:sk.sketch,axis:"X"});
```

**Since/transports**

1.9.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:revolve -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "sketch": {
            "type": "string"
          },
          "profiles": {
            "type": "array",
            "items": {
              "type": "array",
              "items": {
                "type": "number"
              },
              "minItems": 2,
              "maxItems": 2
            },
            "minItems": 0
          },
          "op": {
            "enum": [
              "new",
              "join",
              "cut"
            ],
            "default": "new"
          },
          "body": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "axis": {
            "type": "string"
          },
          "angle": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 5e-324,
                "maximum": 360
              },
              {
                "type": "string"
              }
            ],
            "default": 360
          }
        },
        "required": [
          "sketch",
          "axis"
        ],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "body": {
        "type": "string"
      },
      "feature": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "body",
      "feature"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:revolve -->

<a id="api-shell"></a>
### JS3D.shell

**Signature**

`JS3D.shell(id, opts)`.

**Arguments/defaults/units**

Waits for target, adds shell. Omitted/null/[] open means closed hollow. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits for target, adds shell. Omitted/null/[] open means closed hollow.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
await JS3D.shell(id,{th:2,open:"top"});
```

**Since/transports**

1.9.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:shell -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "th": {
            "anyOf": [
              {
                "type": "number",
                "exclusiveMinimum": 0
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            ]
          },
          "open": {
            "anyOf": [
              {
                "anyOf": [
                  {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 500,
                    "description": "World-space selector expressions; see Selectors. Resolved once; indices expire at the next edit."
                  },
                  {
                    "type": "integer",
                    "minimum": 0
                  },
                  {
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "minItems": 1
                  }
                ]
              },
              {
                "type": "null"
              },
              {
                "type": "array",
                "items": {
                  "type": "integer",
                  "minimum": 0
                },
                "minItems": 0,
                "maxItems": 0
              }
            ]
          },
          "dir": {
            "enum": [
              "in",
              "out",
              "both"
            ],
            "default": "in"
          }
        },
        "required": [
          "th"
        ],
        "additionalProperties": true
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "body": {
        "type": "string"
      },
      "feature": {
        "type": "string"
      },
      "open": {
        "type": "integer",
        "minimum": 0
      }
    },
    "required": [
      "body",
      "feature",
      "open"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:shell -->

<a id="api-sketch"></a>
### JS3D.sketch

**Signature**

`JS3D.sketch(opts)`.

**Arguments/defaults/units**

Creates fully dimensioned shapes; face plane waits for built target. Geometry constraints listed in shapes schema. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Creates fully dimensioned shapes; face plane waits for built target. Geometry constraints listed in shapes schema.

**Errors**

`shapes must be a list of 1 to 200 shapes`; `on takes plane (and offset) or body and face, not both`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
await JS3D.sketch({shapes:[{type:"rect",size:[40,30]}]});
```

**Since/transports**

1.9.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:sketch -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "on": {
            "anyOf": [
              {
                "enum": [
                  "XY",
                  "XZ",
                  "YZ",
                  "xy",
                  "xz",
                  "yz"
                ]
              },
              {
                "type": "object",
                "properties": {
                  "plane": {
                    "enum": [
                      "XY",
                      "XZ",
                      "YZ",
                      "xy",
                      "xz",
                      "yz"
                    ]
                  },
                  "offset": {
                    "type": "number",
                    "default": 0
                  }
                },
                "required": [
                  "plane"
                ],
                "additionalProperties": true
              },
              {
                "type": "object",
                "properties": {
                  "body": {
                    "type": "string"
                  },
                  "face": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "integer",
                        "minimum": 0
                      }
                    ]
                  }
                },
                "required": [
                  "body",
                  "face"
                ],
                "additionalProperties": true
              }
            ],
            "default": "XY"
          },
          "name": {
            "type": "string"
          },
          "shapes": {
            "type": "array",
            "items": {
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "type": {
                      "const": "rect"
                    },
                    "center": {
                      "type": "array",
                      "items": {
                        "type": "number"
                      },
                      "minItems": 2,
                      "maxItems": 2,
                      "default": [
                        0,
                        0
                      ]
                    },
                    "size": {
                      "type": "array",
                      "items": {
                        "anyOf": [
                          {
                            "type": "number",
                            "exclusiveMinimum": 0
                          },
                          {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200
                          }
                        ]
                      },
                      "minItems": 2,
                      "maxItems": 2
                    }
                  },
                  "required": [
                    "type",
                    "size"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "type": {
                      "const": "roundrect"
                    },
                    "center": {
                      "type": "array",
                      "items": {
                        "type": "number"
                      },
                      "minItems": 2,
                      "maxItems": 2,
                      "default": [
                        0,
                        0
                      ]
                    },
                    "size": {
                      "type": "array",
                      "items": {
                        "anyOf": [
                          {
                            "type": "number",
                            "exclusiveMinimum": 0
                          },
                          {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200
                          }
                        ]
                      },
                      "minItems": 2,
                      "maxItems": 2
                    },
                    "radius": {
                      "anyOf": [
                        {
                          "type": "number",
                          "exclusiveMinimum": 0
                        },
                        {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        }
                      ]
                    }
                  },
                  "required": [
                    "type",
                    "size",
                    "radius"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "type": {
                      "const": "circle"
                    },
                    "center": {
                      "type": "array",
                      "items": {
                        "type": "number"
                      },
                      "minItems": 2,
                      "maxItems": 2,
                      "default": [
                        0,
                        0
                      ]
                    },
                    "diameter": {
                      "anyOf": [
                        {
                          "type": "number",
                          "exclusiveMinimum": 0
                        },
                        {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        }
                      ]
                    }
                  },
                  "required": [
                    "type",
                    "diameter"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "type": {
                      "const": "slot"
                    },
                    "center": {
                      "type": "array",
                      "items": {
                        "type": "number"
                      },
                      "minItems": 2,
                      "maxItems": 2,
                      "default": [
                        0,
                        0
                      ]
                    },
                    "length": {
                      "anyOf": [
                        {
                          "type": "number",
                          "exclusiveMinimum": 0
                        },
                        {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        }
                      ]
                    },
                    "width": {
                      "anyOf": [
                        {
                          "type": "number",
                          "exclusiveMinimum": 0
                        },
                        {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        }
                      ]
                    },
                    "angle": {
                      "enum": [
                        0,
                        90
                      ],
                      "default": 0
                    }
                  },
                  "required": [
                    "type",
                    "length",
                    "width"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "type": {
                      "const": "polygon"
                    },
                    "center": {
                      "type": "array",
                      "items": {
                        "type": "number"
                      },
                      "minItems": 2,
                      "maxItems": 2,
                      "default": [
                        0,
                        0
                      ]
                    },
                    "sides": {
                      "type": "integer",
                      "minimum": 3,
                      "maximum": 64
                    },
                    "diameter": {
                      "anyOf": [
                        {
                          "type": "number",
                          "exclusiveMinimum": 0
                        },
                        {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 200
                        }
                      ]
                    }
                  },
                  "required": [
                    "type",
                    "sides",
                    "diameter"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "type": {
                      "const": "polyline"
                    },
                    "points": {
                      "type": "array",
                      "items": {
                        "type": "array",
                        "items": {
                          "type": "number"
                        },
                        "minItems": 2,
                        "maxItems": 2
                      },
                      "minItems": 2,
                      "maxItems": 200
                    },
                    "closed": {
                      "type": "boolean",
                      "default": true
                    }
                  },
                  "required": [
                    "type",
                    "points"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "type": {
                      "const": "line"
                    },
                    "from": {
                      "type": "array",
                      "items": {
                        "type": "number"
                      },
                      "minItems": 2,
                      "maxItems": 2
                    },
                    "to": {
                      "type": "array",
                      "items": {
                        "type": "number"
                      },
                      "minItems": 2,
                      "maxItems": 2
                    },
                    "construction": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "type",
                    "from",
                    "to"
                  ],
                  "additionalProperties": false
                }
              ],
              "description": "1–200 shapes; at most 2000 points/entities. No zero-length sides; closed polylines need 3 points; slot length > width; radius < half smaller side."
            },
            "minItems": 1,
            "maxItems": 200
          },
          "hidden": {
            "type": "boolean",
            "default": false
          }
        },
        "required": [
          "shapes"
        ],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "sketch": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "plane": {
        "type": "object",
        "properties": {
          "o": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "x": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "y": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "n": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          }
        },
        "required": [
          "o",
          "x",
          "y",
          "n"
        ],
        "additionalProperties": false
      },
      "shapes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type": {
              "type": "string"
            },
            "ents": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "minItems": 0
            },
            "center": {
              "type": "array",
              "items": {
                "type": "number"
              },
              "minItems": 2,
              "maxItems": 2
            }
          },
          "required": [
            "type",
            "ents"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "profiles": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "pt": {
              "type": "array",
              "items": {
                "type": "number"
              },
              "minItems": 2,
              "maxItems": 2
            },
            "area": {
              "type": "number"
            }
          },
          "required": [
            "pt",
            "area"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "dof": {
        "type": "integer",
        "minimum": 0
      },
      "dims": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "value": {
              "type": "number"
            },
            "expr": {
              "type": "string"
            }
          },
          "required": [
            "name",
            "value"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      }
    },
    "required": [
      "sketch",
      "name",
      "plane",
      "shapes",
      "profiles",
      "dof",
      "dims"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:sketch -->

## Checkpoints

<!-- api:begin index:Checkpoints -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.checkpoint(label?)` | json; synchronous | [Effects/errors](#api-checkpoint) | [Example/reference](#api-checkpoint) |
| `JS3D.checkpoints()` | json; synchronous | [Effects/errors](#api-checkpoints) | [Example/reference](#api-checkpoints) |
| `JS3D.diff(fromId, toId?)` | json; synchronous | [Effects/errors](#api-diff) | [Example/reference](#api-diff) |
| `JS3D.rollback(id)` | json; synchronous | [Effects/errors](#api-rollback) | [Example/reference](#api-rollback) |
<!-- api:end index:Checkpoints -->

<a id="api-checkpoint"></a>
### JS3D.checkpoint

**Signature**

`JS3D.checkpoint(label?)`.

**Arguments/defaults/units**

Captures whole document; metadata copy only. Latest 20 FIFO; page memory, lost on reload. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Captures whole document; metadata copy only. Latest 20 FIFO; page memory, lost on reload.

**Errors**

`checkpoint label must be a string`; `checkpoint label must be 200 characters or fewer`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Adds snapshot only; no undo or persistent write; edit guards apply.

**Example**

```js
JS3D.checkpoint("Before shell");
```

**Since/transports**

1.12.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:checkpoint -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "label",
        "type": "string",
        "maxLength": 200,
        "default": ""
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^c[1-9][0-9]*$"
      },
      "label": {
        "type": "string"
      },
      "bodies": {
        "type": "integer",
        "minimum": 0
      },
      "at": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "label",
      "bodies",
      "at"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:checkpoint -->

<a id="api-checkpoints"></a>
### JS3D.checkpoints

**Signature**

`JS3D.checkpoints()`.

**Arguments/defaults/units**

Retained metadata, including earlier designs until eviction. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Retained metadata, including earlier designs until eviction.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.checkpoints();
```

**Since/transports**

1.12.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:checkpoints -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^c[1-9][0-9]*$"
        },
        "label": {
          "type": "string"
        },
        "bodies": {
          "type": "integer",
          "minimum": 0
        },
        "at": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "label",
        "bodies",
        "at"
      ],
      "additionalProperties": false
    },
    "minItems": 0,
    "maxItems": 20
  }
}
```
<!-- api:end schema:checkpoints -->

<a id="api-diff"></a>
### JS3D.diff

**Signature**

`JS3D.diff(fromId, toId?)`.

**Arguments/defaults/units**

Compares to now or second checkpoint. Actual integrated 9.4a refuses either checkpoint from another design. At most 200 lines/20 KB; identical gives No changes. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Compares to now or second checkpoint. Actual integrated 9.4a refuses either checkpoint from another design. At most 200 lines/20 KB; identical gives No changes.

**Errors**

`no checkpoint "<id>"; <retained ids or instructions>`; `checkpoint <id> belongs to another design; checkpoints are kept per design`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only.

**Example**

```js
JS3D.diff(JS3D.checkpoints()[0].id);
```

**Since/transports**

1.12.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:diff -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "fromId",
        "type": "string",
        "pattern": "^c[1-9][0-9]*$",
        "description": "Retained page-local ID. Latest 20 only, serial increases across designs."
      },
      {
        "title": "toId",
        "type": "string",
        "pattern": "^c[1-9][0-9]*$",
        "description": "Retained page-local ID. Latest 20 only, serial increases across designs."
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:diff -->

<a id="api-rollback"></a>
### JS3D.rollback

**Signature**

`JS3D.rollback(id)`.

**Arguments/defaults/units**

Restores same-design checkpoint, preserves current mode; synchronous, ready required for rebuilt geometry. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Restores same-design checkpoint, preserves current mode; synchronous, ready required for rebuilt geometry.

**Errors**

`checkpoint <id> belongs to another design; checkpoints are kept per design`; `undo is off in the 3D Print Sim`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.rollback(JS3D.checkpoints()[0].id);
```

**Since/transports**

1.12.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:rollback -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string",
        "pattern": "^c[1-9][0-9]*$",
        "description": "Retained page-local ID. Latest 20 only, serial increases across designs."
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^c[1-9][0-9]*$"
      },
      "label": {
        "type": "string"
      },
      "bodies": {
        "type": "integer",
        "minimum": 0
      },
      "at": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "label",
      "bodies",
      "at"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:rollback -->

## Inspection

<!-- api:begin index:Inspection -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.collisions(opts?)` | json; Promise; see waiting rule | [Effects/errors](#api-collisions) | [Example/reference](#api-collisions) |
| `JS3D.inspect(ids?, opts?)` | json; Promise; see waiting rule | [Effects/errors](#api-inspect) | [Example/reference](#api-inspect) |
| `JS3D.measure(a, b)` | json; Promise; see waiting rule | [Effects/errors](#api-measure) | [Example/reference](#api-measure) |
| `JS3D.printCheck(opts?)` | json; Promise; see waiting rule | [Effects/errors](#api-printCheck) | [Example/reference](#api-printCheck) |
| `JS3D.section(plane, opts?)` | json; Promise; see waiting rule | [Effects/errors](#api-section) | [Example/reference](#api-section) |
<!-- api:end index:Inspection -->

<a id="api-collisions"></a>
### JS3D.collisions

**Signature**

`JS3D.collisions(opts?)`.

**Arguments/defaults/units**

Waits; at most 50 bodies; 90-second budget, at most 20 overlap probes. Empty pairs is valid; partial overlap gives null and note/error. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits; at most 50 bodies; 90-second budget, at most 20 overlap probes. Empty pairs is valid; partial overlap gives null and note/error.

**Errors**

`gap must be a number of mm from 0 to 50`; `collisions takes at most 50 bodies at a time (got <n>); pass ids`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only.

**Example**

```js
await JS3D.collisions({gap:1});
```

**Since/transports**

1.10.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:collisions -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "ids": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "minItems": 1
              }
            ]
          },
          "gap": {
            "type": "number",
            "minimum": 0,
            "maximum": 50,
            "default": 0
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "pairs": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "a": {
              "type": "string"
            },
            "b": {
              "type": "string"
            },
            "aName": {
              "type": "string"
            },
            "bName": {
              "type": "string"
            },
            "distance": {
              "type": "number"
            },
            "state": {
              "enum": [
                "overlap",
                "touch",
                "near"
              ]
            },
            "overlap": {
              "anyOf": [
                {
                  "type": "number"
                },
                {
                  "type": "null"
                }
              ]
            },
            "error": {
              "type": "string"
            },
            "note": {
              "type": "string"
            }
          },
          "required": [
            "a",
            "b",
            "aName",
            "bName",
            "distance",
            "state",
            "overlap"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "checked": {
        "type": "integer",
        "minimum": 0
      },
      "skipped": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "error": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "name",
            "error"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      }
    },
    "required": [
      "pairs",
      "checked",
      "skipped"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:collisions -->

<a id="api-inspect"></a>
### JS3D.inspect

**Signature**

`JS3D.inspect(ids?, opts?)`.

**Arguments/defaults/units**

Waits; omitted/null/[] IDs selects shown solids. Density overrides material; mm³/mm²/grams. Per-body errors and zero wire volumes; totals count built solids. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits; omitted/null/[] IDs selects shown solids. Density overrides material; mm³/mm²/grams. Per-body errors and zero wire volumes; totals count built solids.

**Errors**

`density must be a number of g/cm3 from 0.1 to 25`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only.

**Example**

```js
await JS3D.inspect([], {material:"pla"});
```

**Since/transports**

1.10.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:inspect -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "minItems": 1
              }
            ]
          },
          {
            "type": "null"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 0,
            "maxItems": 0
          }
        ]
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "material": {
            "enum": [
              "pla",
              "plaplus",
              "petg",
              "abs",
              "asa",
              "nylon",
              "pc",
              "cfpla",
              "cfnylon",
              "peek",
              "tpu"
            ],
            "default": "pla"
          },
          "density": {
            "type": "number",
            "minimum": 0.1,
            "maximum": 25
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 0,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "material": {
        "type": "object",
        "properties": {
          "key": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "density": {
            "type": "number"
          }
        },
        "required": [
          "key",
          "name",
          "density"
        ],
        "additionalProperties": false
      },
      "bodies": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "hole": {
              "type": "boolean"
            },
            "hidden": {
              "type": "boolean"
            },
            "bbox": {
              "anyOf": [
                {
                  "type": "object",
                  "properties": {
                    "min": {
                      "type": "array",
                      "items": {
                        "type": "number"
                      },
                      "minItems": 3,
                      "maxItems": 3
                    },
                    "max": {
                      "type": "array",
                      "items": {
                        "type": "number"
                      },
                      "minItems": 3,
                      "maxItems": 3
                    }
                  },
                  "required": [
                    "min",
                    "max"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "null"
                }
              ]
            },
            "size": {
              "anyOf": [
                {
                  "type": "array",
                  "items": {
                    "type": "number"
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                {
                  "type": "null"
                }
              ]
            },
            "volume": {
              "anyOf": [
                {
                  "type": "number"
                },
                {
                  "type": "null"
                }
              ]
            },
            "volumeFrom": {
              "anyOf": [
                {
                  "enum": [
                    "solid",
                    "mesh"
                  ]
                },
                {
                  "type": "null"
                }
              ]
            },
            "area": {
              "anyOf": [
                {
                  "type": "number"
                },
                {
                  "type": "null"
                }
              ]
            },
            "weight": {
              "anyOf": [
                {
                  "type": "number"
                },
                {
                  "type": "null"
                }
              ]
            },
            "solids": {
              "anyOf": [
                {
                  "type": "integer",
                  "minimum": 0
                },
                {
                  "type": "null"
                }
              ]
            },
            "error": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "note": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "name",
            "hole",
            "hidden",
            "bbox",
            "size",
            "volume",
            "volumeFrom",
            "area",
            "weight",
            "solids",
            "error"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "total": {
        "type": "object",
        "properties": {
          "bodies": {
            "type": "integer",
            "minimum": 0
          },
          "bbox": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "min": {
                    "type": "array",
                    "items": {
                      "type": "number"
                    },
                    "minItems": 3,
                    "maxItems": 3
                  },
                  "max": {
                    "type": "array",
                    "items": {
                      "type": "number"
                    },
                    "minItems": 3,
                    "maxItems": 3
                  }
                },
                "required": [
                  "min",
                  "max"
                ],
                "additionalProperties": false
              },
              {
                "type": "null"
              }
            ]
          },
          "size": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              },
              {
                "type": "null"
              }
            ]
          },
          "volume": {
            "type": "number"
          },
          "area": {
            "type": "number"
          },
          "weight": {
            "type": "number"
          }
        },
        "required": [
          "bodies",
          "bbox",
          "size",
          "volume",
          "area",
          "weight"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "material",
      "bodies",
      "total"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:inspect -->

<a id="api-measure"></a>
### JS3D.measure

**Signature**

`JS3D.measure(a, b)`.

**Arguments/defaults/units**

Waits; point/body/face/near targets. body pairs and parallel planes exact; other distances mesh-based. Angle 0–90 degrees for two flat faces. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits; point/body/face/near targets. body pairs and parallel planes exact; other distances mesh-based. Angle 0–90 degrees for two flat faces.

**Errors**

`a and b are the same body`; `<a or b> must be a point [x, y, z], a body id, or {body, face} or {body, near}`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only.

**Example**

```js
await JS3D.measure([0,0,0],[3,4,0]);
```

**Since/transports**

1.10.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:measure -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "a",
        "anyOf": [
          {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          {
            "type": "string"
          },
          {
            "type": "object",
            "properties": {
              "body": {
                "type": "string"
              },
              "face": {
                "type": "integer",
                "minimum": 0
              }
            },
            "required": [
              "body",
              "face"
            ],
            "additionalProperties": true
          },
          {
            "type": "object",
            "properties": {
              "body": {
                "type": "string"
              },
              "near": {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              }
            },
            "required": [
              "body",
              "near"
            ],
            "additionalProperties": true
          },
          {
            "type": "object",
            "properties": {
              "body": {
                "type": "string"
              }
            },
            "required": [
              "body"
            ],
            "additionalProperties": true
          }
        ]
      },
      {
        "title": "b",
        "anyOf": [
          {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          {
            "type": "string"
          },
          {
            "type": "object",
            "properties": {
              "body": {
                "type": "string"
              },
              "face": {
                "type": "integer",
                "minimum": 0
              }
            },
            "required": [
              "body",
              "face"
            ],
            "additionalProperties": true
          },
          {
            "type": "object",
            "properties": {
              "body": {
                "type": "string"
              },
              "near": {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              }
            },
            "required": [
              "body",
              "near"
            ],
            "additionalProperties": true
          },
          {
            "type": "object",
            "properties": {
              "body": {
                "type": "string"
              }
            },
            "required": [
              "body"
            ],
            "additionalProperties": true
          }
        ]
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "a": {
        "type": "object",
        "properties": {
          "point": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "body": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "face": {
            "type": "integer",
            "minimum": 0
          },
          "type": {
            "type": "string"
          },
          "center": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "normal": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "nearDistance": {
            "type": "number"
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "b": {
        "type": "object",
        "properties": {
          "point": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "body": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "face": {
            "type": "integer",
            "minimum": 0
          },
          "type": {
            "type": "string"
          },
          "center": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "normal": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "nearDistance": {
            "type": "number"
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "distance": {
        "type": "number"
      },
      "exact": {
        "type": "boolean"
      },
      "kind": {
        "enum": [
          "point-point",
          "body-body",
          "planes",
          "mesh"
        ]
      },
      "from": {
        "type": "array",
        "items": {
          "type": "number"
        },
        "minItems": 3,
        "maxItems": 3
      },
      "to": {
        "type": "array",
        "items": {
          "type": "number"
        },
        "minItems": 3,
        "maxItems": 3
      },
      "delta": {
        "type": "array",
        "items": {
          "type": "number"
        },
        "minItems": 3,
        "maxItems": 3
      },
      "angle": {
        "type": "number"
      },
      "parallel": {
        "type": "boolean"
      }
    },
    "required": [
      "a",
      "b",
      "distance",
      "exact",
      "kind"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:measure -->

<a id="api-printCheck"></a>
### JS3D.printCheck

**Signature**

`JS3D.printCheck(opts?)`.

**Arguments/defaults/units**

Waits; printer/angle default to saved settings (initial generic/45). Checks plate, height, overhangs and contact, not wall thickness. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits; printer/angle default to saved settings (initial generic/45). Checks plate, height, overhangs and contact, not wall thickness.

**Errors**

`angle must be a number of degrees from 10 to 80`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only.

**Example**

```js
await JS3D.printCheck();
```

**Since/transports**

1.10.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:printCheck -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "ids": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "minItems": 1
              }
            ]
          },
          "printer": {
            "type": "string"
          },
          "angle": {
            "type": "number",
            "minimum": 10,
            "maximum": 80
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "ok": {
        "type": "boolean"
      },
      "summary": {
        "type": "string"
      },
      "issues": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "level": {
              "enum": [
                "error",
                "warn"
              ]
            },
            "code": {
              "enum": [
                "empty",
                "wire_only",
                "build_error",
                "floating",
                "below_plate",
                "outside_bed",
                "too_tall",
                "overhang",
                "small_contact"
              ]
            },
            "id": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "name": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "text": {
              "type": "string"
            }
          },
          "required": [
            "level",
            "code",
            "id",
            "name",
            "text"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "bodies": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "bbox": {
              "type": "object",
              "properties": {
                "min": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "max": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  },
                  "minItems": 3,
                  "maxItems": 3
                }
              },
              "required": [
                "min",
                "max"
              ],
              "additionalProperties": false
            },
            "minZ": {
              "type": "number"
            },
            "contactArea": {
              "type": "number"
            },
            "overhangArea": {
              "type": "number"
            },
            "overhangTriangles": {
              "type": "integer",
              "minimum": 0
            },
            "fits": {
              "anyOf": [
                {
                  "type": "boolean"
                },
                {
                  "type": "null"
                }
              ]
            }
          },
          "required": [
            "id",
            "name",
            "bbox",
            "minZ",
            "contactArea",
            "overhangArea",
            "overhangTriangles",
            "fits"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "ignored": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "why": {
              "enum": [
                "hole",
                "hidden"
              ]
            }
          },
          "required": [
            "id",
            "name",
            "why"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "printer": {
        "type": "string"
      },
      "bed": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "w": {
                "type": "number"
              },
              "d": {
                "type": "number"
              },
              "h": {
                "anyOf": [
                  {
                    "type": "number"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "required": [
              "w",
              "d",
              "h"
            ],
            "additionalProperties": false
          },
          {
            "type": "null"
          }
        ]
      },
      "angle": {
        "type": "number"
      }
    },
    "required": [
      "ok",
      "summary",
      "issues",
      "bodies",
      "ignored",
      "printer",
      "bed",
      "angle"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:printCheck -->

<a id="api-section"></a>
### JS3D.section

**Signature**

`JS3D.section(plane, opts?)`.

**Arguments/defaults/units**

Waits; mesh cut, empty bodies allowed. 5000 point cap; plane on vertex shifts .0001 mm. Nonzero normal required. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits; mesh cut, empty bodies allowed. 5000 point cap; plane on vertex shifts .0001 mm. Nonzero normal required.

**Errors**

`normal must not be [0, 0, 0]`; `section pictures need Beginner or Advanced mode (now <mode>)`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; picture temporarily sets section/camera and restores them.

**Example**

```js
await JS3D.section({axis:"z",at:10});
```

**Since/transports**

1.10.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:section -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "plane",
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "axis": {
                "enum": [
                  "x",
                  "y",
                  "z"
                ]
              },
              "at": {
                "type": "number"
              }
            },
            "required": [
              "axis",
              "at"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "origin": {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              },
              "normal": {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              }
            },
            "required": [
              "origin",
              "normal"
            ],
            "additionalProperties": false
          }
        ]
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "ids": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "minItems": 1
              }
            ]
          },
          "points": {
            "type": "boolean",
            "default": false
          },
          "picture": {
            "type": "boolean",
            "default": false
          },
          "width": {
            "type": "number",
            "minimum": 1,
            "maximum": 8192,
            "default": 800
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "plane": {
        "type": "object",
        "properties": {
          "origin": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "normal": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "u": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          "v": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          }
        },
        "required": [
          "origin",
          "normal",
          "u",
          "v"
        ],
        "additionalProperties": false
      },
      "shifted": {
        "type": "number"
      },
      "area": {
        "type": "number"
      },
      "bodies": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "area": {
              "type": "number"
            },
            "loops": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "area": {
                    "type": "number"
                  },
                  "perimeter": {
                    "type": "number"
                  },
                  "hole": {
                    "type": "boolean"
                  },
                  "closed": {
                    "type": "boolean"
                  },
                  "min": {
                    "type": "array",
                    "items": {
                      "type": "number"
                    },
                    "minItems": 2,
                    "maxItems": 2
                  },
                  "max": {
                    "type": "array",
                    "items": {
                      "type": "number"
                    },
                    "minItems": 2,
                    "maxItems": 2
                  },
                  "points": {
                    "type": "array",
                    "items": {
                      "type": "array",
                      "items": {
                        "type": "number"
                      },
                      "minItems": 2,
                      "maxItems": 2
                    },
                    "minItems": 0
                  }
                },
                "required": [
                  "area",
                  "perimeter",
                  "hole",
                  "closed",
                  "min",
                  "max"
                ],
                "additionalProperties": false
              },
              "minItems": 0
            }
          },
          "required": [
            "id",
            "name",
            "area",
            "loops"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "skipped": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "error": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "name",
            "error"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "truncated": {
        "type": "boolean"
      },
      "dataURL": {
        "type": "string"
      }
    },
    "required": [
      "plane",
      "shifted",
      "area",
      "bodies",
      "skipped"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:section -->

## Scripts and agent

<!-- api:begin index:Scripts and agent -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.connect(url?)` | void; synchronous | [Effects/errors](#api-connect) | [Example/reference](#api-connect) |
| `JS3D.connection()` | json; synchronous | [Effects/errors](#api-connection) | [Example/reference](#api-connection) |
| `JS3D.disconnect()` | void; synchronous | [Effects/errors](#api-disconnect) | [Example/reference](#api-disconnect) |
| `JS3D.invoke(call, args?)` | json; Promise; see waiting rule | [Effects/errors](#api-invoke) | [Example/reference](#api-invoke) |
| `JS3D.run(text)` | any; Promise; see waiting rule | [Effects/errors](#api-run) | [Example/reference](#api-run) |
<!-- api:end index:Scripts and agent -->

<a id="api-connect"></a>
### JS3D.connect

**Signature**

`JS3D.connect(url?)`.

**Arguments/defaults/units**

Connects/retries WebSocket every 3 seconds. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Connects/retries WebSocket every 3 seconds.

**Errors**

`url must be a ws:// or wss:// address`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Network connection; no undo.

**Example**

```js
JS3D.connect();
```

**Since/transports**

1.1.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:connect -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "url",
        "type": "string",
        "default": "ws://127.0.0.1:8822"
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:connect -->

<a id="api-connection"></a>
### JS3D.connection

**Signature**

`JS3D.connection()`.

**Arguments/defaults/units**

Reads current link state. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Reads current link state.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.connection();
```

**Since/transports**

1.1.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:connection -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "on": {
        "type": "boolean"
      },
      "url": {
        "type": "string"
      },
      "state": {
        "enum": [
          "off",
          "waiting",
          "connected"
        ]
      }
    },
    "required": [
      "on",
      "url",
      "state"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:connection -->

<a id="api-disconnect"></a>
### JS3D.disconnect

**Signature**

`JS3D.disconnect()`.

**Arguments/defaults/units**

Closes socket and stops retries. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Closes socket and stops retries.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Network state only.

**Example**

```js
JS3D.disconnect();
```

**Since/transports**

1.1.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:disconnect -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:disconnect -->

<a id="api-invoke"></a>
### JS3D.invoke

**Signature**

`JS3D.invoke(call, args?)`.

**Arguments/defaults/units**

Calls an own function except invoke; top-level Uint8Array becomes {$bytes:base64}. Void remains undefined, omitted by WebSocket JSON serialization. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Calls an own function except invoke; top-level Uint8Array becomes {$bytes:base64}. Void remains undefined, omitted by WebSocket JSON serialization.

**Errors**

`unknown call "<call>"`; `args must be an array`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Effects of target call.

**Example**

```js
await JS3D.invoke("list",[]);
```

**Since/transports**

1.1.0; direct: yes; invoke: no; postMessage: no. No deprecation.

<!-- api:begin schema:invoke -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "call",
        "type": "string"
      },
      {
        "title": "args",
        "type": "array",
        "items": {},
        "minItems": 0,
        "default": []
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": true,
        "description": "Raw project payload: observed fields, not a stable exhaustive schema; see Part 2 project format."
      },
      {
        "type": "array",
        "items": {},
        "minItems": 0
      },
      {
        "type": "string"
      },
      {
        "type": "number"
      },
      {
        "type": "boolean"
      },
      {
        "type": "null"
      }
    ]
  }
}
```
<!-- api:end schema:invoke -->

<a id="api-run"></a>
### JS3D.run

**Signature**

`JS3D.run(text)`.

**Arguments/defaults/units**

Trusted script with JS3D/app scope; returns last expression or explicit return, awaiting promises. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the script value (any JavaScript value). Trusted script with JS3D/app scope; returns last expression or explicit return, awaiting promises.

**Errors**

`run needs the script as text`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Arbitrary script effects; console-level trust.

**Example**

```js
await JS3D.run("JS3D.list()");
```

**Since/transports**

1.1.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:run -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "text",
        "type": "string"
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "any",
  "returnsSchema": {}
}
```
<!-- api:end schema:run -->

## Editing

<!-- api:begin index:Editing -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.delete(ids)` | json; synchronous | [Effects/errors](#api-delete) | [Example/reference](#api-delete) |
| `JS3D.duplicate(ids, offset?)` | json; synchronous | [Effects/errors](#api-duplicate) | [Example/reference](#api-duplicate) |
| `JS3D.group(ids, opts?)` | json; synchronous | [Effects/errors](#api-group) | [Example/reference](#api-group) |
| `JS3D.move(ids, delta)` | void; synchronous | [Effects/errors](#api-move) | [Example/reference](#api-move) |
| `JS3D.moveTo(id, pos)` | void; synchronous | [Effects/errors](#api-moveTo) | [Example/reference](#api-moveTo) |
| `JS3D.remove(ids)` | json; synchronous | [Effects/errors](#api-remove) | [Example/reference](#api-remove) |
| `JS3D.rename(id, name)` | void; synchronous | [Effects/errors](#api-rename) | [Example/reference](#api-rename) |
| `JS3D.resize(id, size)` | void; synchronous | [Effects/errors](#api-resize) | [Example/reference](#api-resize) |
| `JS3D.rotate(ids, axis, degrees, opts?)` | void; synchronous | [Effects/errors](#api-rotate) | [Example/reference](#api-rotate) |
| `JS3D.scale(ids, k, opts?)` | void; synchronous | [Effects/errors](#api-scale) | [Example/reference](#api-scale) |
| `JS3D.setColor(ids, color)` | void; synchronous | [Effects/errors](#api-setColor) | [Example/reference](#api-setColor) |
| `JS3D.setHidden(ids, hidden)` | void; synchronous | [Effects/errors](#api-setHidden) | [Example/reference](#api-setHidden) |
| `JS3D.setHole(ids, hole)` | void; synchronous | [Effects/errors](#api-setHole) | [Example/reference](#api-setHole) |
| `JS3D.ungroup(id)` | json; synchronous | [Effects/errors](#api-ungroup) | [Example/reference](#api-ungroup) |
<!-- api:end index:Editing -->

<a id="api-delete"></a>
### JS3D.delete

**Signature**

`JS3D.delete(ids)`; alias of [remove](#api-remove).

**Arguments/defaults/units**

Supported alias; identical function to remove. No deprecation. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Supported alias; identical function to remove. No deprecation.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.delete(id);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:delete -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          }
        ]
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "integer",
    "minimum": 0
  }
}
```
<!-- api:end schema:delete -->

<a id="api-duplicate"></a>
### JS3D.duplicate

**Signature**

`JS3D.duplicate(ids, offset?)`.

**Arguments/defaults/units**

Copies bodies with translation offset. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Copies bodies with translation offset.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.duplicate(id,[40,0,0]);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:duplicate -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          }
        ]
      },
      {
        "title": "offset",
        "type": "array",
        "items": {
          "type": "number"
        },
        "minItems": 3,
        "maxItems": 3,
        "default": [
          0,
          0,
          0
        ]
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "items": {
      "type": "string"
    },
    "minItems": 0
  }
}
```
<!-- api:end schema:duplicate -->

<a id="api-group"></a>
### JS3D.group

**Signature**

`JS3D.group(ids, opts?)`.

**Arguments/defaults/units**

At least two bodies; default join; cut subtracts from first body. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. At least two bodies; default join; cut subtracts from first body.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.group([id,other]);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:group -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          }
        ]
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "op": {
            "enum": [
              "intersect",
              "cut"
            ]
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:group -->

<a id="api-move"></a>
### JS3D.move

**Signature**

`JS3D.move(ids, delta)`.

**Arguments/defaults/units**

Translates bodies in world mm. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Translates bodies in world mm.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.move(id,[10,0,0]);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:move -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          }
        ]
      },
      {
        "title": "delta",
        "type": "array",
        "items": {
          "type": "number"
        },
        "minItems": 3,
        "maxItems": 3
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:move -->

<a id="api-moveTo"></a>
### JS3D.moveTo

**Signature**

`JS3D.moveTo(id, pos)`.

**Arguments/defaults/units**

Sets body matrix translation. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Sets body matrix translation.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.moveTo(id,[0,0,0]);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:moveTo -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "pos",
        "type": "array",
        "items": {
          "type": "number"
        },
        "minItems": 3,
        "maxItems": 3
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:moveTo -->

<a id="api-remove"></a>
### JS3D.remove

**Signature**

`JS3D.remove(ids)`.

**Arguments/defaults/units**

Deletes bodies; returns count. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Deletes bodies; returns count.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.remove(id);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:remove -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          }
        ]
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "integer",
    "minimum": 0
  }
}
```
<!-- api:end schema:remove -->

<a id="api-rename"></a>
### JS3D.rename

**Signature**

`JS3D.rename(id, name)`.

**Arguments/defaults/units**

Trims a nonempty body name. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Trims a nonempty body name.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.rename(id,"Bracket");
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:rename -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "name",
        "type": "string",
        "minLength": 1
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:rename -->

<a id="api-resize"></a>
### JS3D.resize

**Signature**

`JS3D.resize(id, size)`.

**Arguments/defaults/units**

Plain primitive only; clears parameter bindings on changed sizes. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Plain primitive only; clears parameter bindings on changed sizes.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.resize(id,{w:40});
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:resize -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      },
      {
        "title": "size",
        "anyOf": [
          {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          },
          {
            "type": "object",
            "additionalProperties": {
              "anyOf": [
                {
                  "type": "number"
                },
                {
                  "type": "string"
                }
              ]
            },
            "description": "Only keys returned by kinds() for this shape; w/d/h/size >= 0.01, sides/points integer >= 3, other numbers >= 0."
          }
        ]
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:resize -->

<a id="api-rotate"></a>
### JS3D.rotate

**Signature**

`JS3D.rotate(ids, axis, degrees, opts?)`.

**Arguments/defaults/units**

Rotates about world point; default centre of built bounds. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Rotates about world point; default centre of built bounds.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.rotate(id,"z",45,{about:[0,0,0]});
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:rotate -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          }
        ]
      },
      {
        "title": "axis",
        "anyOf": [
          {
            "enum": [
              "x",
              "y",
              "z",
              "X",
              "Y",
              "Z"
            ]
          },
          {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          }
        ]
      },
      {
        "title": "degrees",
        "type": "number"
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "about": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 3,
    "maxItems": 4,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:rotate -->

<a id="api-scale"></a>
### JS3D.scale

**Signature**

`JS3D.scale(ids, k, opts?)`.

**Arguments/defaults/units**

Positive scale in local axes, about built bounds centre by default. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Positive scale in local axes, about built bounds centre by default.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.scale(id,2,{about:[0,0,0]});
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:scale -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          }
        ]
      },
      {
        "title": "k",
        "anyOf": [
          {
            "type": "number",
            "exclusiveMinimum": 0
          },
          {
            "type": "array",
            "items": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "minItems": 3,
            "maxItems": 3
          }
        ]
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "about": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "minItems": 3,
            "maxItems": 3
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 2,
    "maxItems": 3,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:scale -->

<a id="api-setColor"></a>
### JS3D.setColor

**Signature**

`JS3D.setColor(ids, color)`.

**Arguments/defaults/units**

Sets display color. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Sets display color.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.setColor(id,"#ff8800");
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:setColor -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          }
        ]
      },
      {
        "title": "color",
        "type": "string",
        "pattern": "^#[0-9a-fA-F]{6}$"
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:setColor -->

<a id="api-setHidden"></a>
### JS3D.setHidden

**Signature**

`JS3D.setHidden(ids, hidden)`.

**Arguments/defaults/units**

Hides or shows bodies. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Hides or shows bodies.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.setHidden(id,true);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:setHidden -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          }
        ]
      },
      {
        "title": "hidden",
        "type": "boolean"
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:setHidden -->

<a id="api-setHole"></a>
### JS3D.setHole

**Signature**

`JS3D.setHole(ids, hole)`.

**Arguments/defaults/units**

Marks bodies as cutters. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Marks bodies as cutters.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.setHole(id,true);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:setHole -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1
          }
        ]
      },
      {
        "title": "hole",
        "type": "boolean"
      }
    ],
    "minItems": 2,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:setHole -->

<a id="api-ungroup"></a>
### JS3D.ungroup

**Signature**

`JS3D.ungroup(id)`.

**Arguments/defaults/units**

Only groups with no features except a compatible scale can split. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Only groups with no features except a compatible scale can split.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.ungroup(id);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:ungroup -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "items": {
      "type": "string"
    },
    "minItems": 0
  }
}
```
<!-- api:end schema:ungroup -->

## Discovery and waiting

<!-- api:begin index:Discovery and waiting -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.describe()` | json; synchronous | [Effects/errors](#api-describe) | [Example/reference](#api-describe) |
| `JS3D.ready(timeoutMs?)` | void; Promise; see waiting rule | [Effects/errors](#api-ready) | [Example/reference](#api-ready) |
| `JS3D.supports(call)` | json; synchronous | [Effects/errors](#api-supports) | [Example/reference](#api-supports) |
<!-- api:end index:Discovery and waiting -->

<a id="api-describe"></a>
### JS3D.describe

**Signature**

`JS3D.describe()`.

**Arguments/defaults/units**

Fresh JSON-safe deep copy of the static contract, sorted by name, with no live state or credentials. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Fresh JSON-safe deep copy of the static contract, sorted by name, with no live state or credentials.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.describe();
```

**Since/transports**

1.13.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:describe -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "apiVersion": {
        "type": "string"
      },
      "version": {
        "type": "string"
      },
      "appVersion": {
        "type": "string"
      },
      "schemaVersion": {
        "const": 1
      },
      "calls": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "area": {
              "type": "string"
            },
            "since": {
              "type": "string"
            },
            "async": {
              "type": "boolean"
            },
            "argsSchema": {
              "type": "object",
              "properties": {},
              "required": [],
              "additionalProperties": true
            },
            "returnsSchema": {
              "anyOf": [
                {
                  "type": "object",
                  "properties": {},
                  "required": [],
                  "additionalProperties": true
                },
                {
                  "type": "null"
                }
              ]
            },
            "returnsKind": {
              "enum": [
                "json",
                "void",
                "bytes",
                "any"
              ]
            },
            "errors": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "minItems": 0
            },
            "effects": {
              "type": "string"
            },
            "transports": {
              "type": "object",
              "properties": {
                "direct": {
                  "type": "boolean"
                },
                "invoke": {
                  "type": "boolean"
                },
                "postMessage": {
                  "type": "boolean"
                }
              },
              "required": [
                "direct",
                "invoke",
                "postMessage"
              ],
              "additionalProperties": false
            },
            "docAnchor": {
              "type": "string"
            },
            "aliasOf": {
              "type": "string"
            },
            "deprecatedSince": {
              "type": "string"
            },
            "replacement": {
              "type": "string"
            },
            "earliestRemoval": {
              "type": "string"
            },
            "example": {
              "type": "string"
            },
            "description": {
              "type": "string"
            }
          },
          "required": [
            "name",
            "area",
            "since",
            "async",
            "argsSchema",
            "returnsSchema",
            "returnsKind",
            "errors",
            "effects",
            "transports",
            "docAnchor"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      },
      "properties": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "stability": {
              "enum": [
                "stable",
                "internal"
              ]
            },
            "valueSchema": {
              "type": "object",
              "properties": {},
              "required": [],
              "additionalProperties": true
            },
            "docAnchor": {
              "type": "string"
            },
            "description": {
              "type": "string"
            }
          },
          "required": [
            "name",
            "stability",
            "valueSchema",
            "docAnchor"
          ],
          "additionalProperties": false
        },
        "minItems": 0
      }
    },
    "required": [
      "apiVersion",
      "version",
      "appVersion",
      "schemaVersion",
      "calls",
      "properties"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:describe -->

<a id="api-ready"></a>
### JS3D.ready

**Signature**

`JS3D.ready(timeoutMs?)`.

**Arguments/defaults/units**

Waits until geometry is built or has an error; inspect list().error afterward. Timeout is milliseconds. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to undefined. Waits until geometry is built or has an error; inspect list().error afterward. Timeout is milliseconds.

**Errors**

`JS3D.ready timed out after <timeoutMs> ms; still building: <names>`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Waits only.

**Example**

```js
await JS3D.ready();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:ready -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "timeoutMs",
        "type": "number",
        "default": 90000
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:ready -->

<a id="api-supports"></a>
### JS3D.supports

**Signature**

`JS3D.supports(call)`.

**Arguments/defaults/units**

Exact own callable name in both manifest and installed API. Non-strings, inherited names and properties return false. Never invokes the target. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Exact own callable name in both manifest and installed API. Non-strings, inherited names and properties return false. Never invokes the target.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.supports("sketch");
```

**Since/transports**

1.13.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:supports -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "call"
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "boolean"
  }
}
```
<!-- api:end schema:supports -->

## Reading

<!-- api:begin index:Reading -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.doc()` | json; synchronous | [Effects/errors](#api-doc) | [Example/reference](#api-doc) |
| `JS3D.get(id)` | json; synchronous | [Effects/errors](#api-get) | [Example/reference](#api-get) |
| `JS3D.kinds()` | json; synchronous | [Effects/errors](#api-kinds) | [Example/reference](#api-kinds) |
| `JS3D.list()` | json; synchronous | [Effects/errors](#api-list) | [Example/reference](#api-list) |
| `JS3D.mode()` | json; synchronous | [Effects/errors](#api-mode) | [Example/reference](#api-mode) |
| `JS3D.params()` | json; synchronous | [Effects/errors](#api-params) | [Example/reference](#api-params) |
| `JS3D.save()` | json; synchronous | [Effects/errors](#api-save) | [Example/reference](#api-save) |
| `JS3D.selection()` | json; synchronous | [Effects/errors](#api-selection) | [Example/reference](#api-selection) |
<!-- api:end index:Reading -->

<a id="api-doc"></a>
### JS3D.doc

**Signature**

`JS3D.doc()`.

**Arguments/defaults/units**

Deep document snapshot without transient body _key; see Part 2. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Deep document snapshot without transient body _key; see Part 2.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.doc();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:doc -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": true,
    "description": "Raw project payload: observed fields, not a stable exhaustive schema; see Part 2 project format."
  }
}
```
<!-- api:end schema:doc -->

<a id="api-get"></a>
### JS3D.get

**Signature**

`JS3D.get(id)`.

**Arguments/defaults/units**

Body summary plus copied raw node and column-major matrix. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Body summary plus copied raw node and column-major matrix.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only.

**Example**

```js
JS3D.get(JS3D.list()[0].id);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:get -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "id",
        "type": "string"
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "kind": {
        "type": "string"
      },
      "hole": {
        "type": "boolean"
      },
      "hidden": {
        "type": "boolean"
      },
      "locked": {
        "type": "boolean"
      },
      "color": {
        "type": "string"
      },
      "position": {
        "type": "array",
        "items": {
          "type": "number"
        },
        "minItems": 3,
        "maxItems": 3
      },
      "bbox": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "min": {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              },
              "max": {
                "type": "array",
                "items": {
                  "type": "number"
                },
                "minItems": 3,
                "maxItems": 3
              }
            },
            "required": [
              "min",
              "max"
            ],
            "additionalProperties": false
          },
          {
            "type": "null"
          }
        ]
      },
      "volume": {
        "anyOf": [
          {
            "type": "number"
          },
          {
            "type": "null"
          }
        ]
      },
      "error": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "children": {
        "type": "integer",
        "minimum": 0
      },
      "node": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": true,
        "description": "Raw project payload: observed fields, not a stable exhaustive schema; see Part 2 project format."
      },
      "m": {
        "type": "array",
        "items": {
          "type": "number"
        },
        "minItems": 16,
        "maxItems": 16
      }
    },
    "required": [
      "id",
      "name",
      "kind",
      "hole",
      "hidden",
      "locked",
      "color",
      "position",
      "bbox",
      "volume",
      "error",
      "node",
      "m"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:get -->

<a id="api-kinds"></a>
### JS3D.kinds

**Signature**

`JS3D.kinds()`.

**Arguments/defaults/units**

Primitive names and copies of their default size fields. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Primitive names and copies of their default size fields.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.kinds();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:kinds -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string"
        },
        "defaults": {
          "type": "object",
          "properties": {},
          "required": [],
          "additionalProperties": true,
          "description": "Raw project payload: observed fields, not a stable exhaustive schema; see Part 2 project format."
        }
      },
      "required": [
        "kind",
        "defaults"
      ],
      "additionalProperties": false
    },
    "minItems": 0
  }
}
```
<!-- api:end schema:kinds -->

<a id="api-list"></a>
### JS3D.list

**Signature**

`JS3D.list()`.

**Arguments/defaults/units**

Top-level body summaries; bbox and volume null while unbuilt or failed. Volume mm³. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Top-level body summaries; bbox and volume null while unbuilt or failed. Volume mm³.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.list();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:list -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "kind": {
          "type": "string"
        },
        "hole": {
          "type": "boolean"
        },
        "hidden": {
          "type": "boolean"
        },
        "locked": {
          "type": "boolean"
        },
        "color": {
          "type": "string"
        },
        "position": {
          "type": "array",
          "items": {
            "type": "number"
          },
          "minItems": 3,
          "maxItems": 3
        },
        "bbox": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "min": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "max": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  },
                  "minItems": 3,
                  "maxItems": 3
                }
              },
              "required": [
                "min",
                "max"
              ],
              "additionalProperties": false
            },
            {
              "type": "null"
            }
          ]
        },
        "volume": {
          "anyOf": [
            {
              "type": "number"
            },
            {
              "type": "null"
            }
          ]
        },
        "error": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "children": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "id",
        "name",
        "kind",
        "hole",
        "hidden",
        "locked",
        "color",
        "position",
        "bbox",
        "volume",
        "error"
      ],
      "additionalProperties": false
    },
    "minItems": 0
  }
}
```
<!-- api:end schema:list -->

<a id="api-mode"></a>
### JS3D.mode

**Signature**

`JS3D.mode()`.

**Arguments/defaults/units**

Current app mode (may include helper modes, beyond setMode inputs). Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Current app mode (may include helper modes, beyond setMode inputs).

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.mode();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:mode -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:mode -->

<a id="api-params"></a>
### JS3D.params

**Signature**

`JS3D.params()`.

**Arguments/defaults/units**

Parameters; failed expressions have null value. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Parameters; failed expressions have null value.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.params();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:params -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "expr": {
          "type": "string"
        },
        "value": {
          "anyOf": [
            {
              "type": "number"
            },
            {
              "type": "null"
            }
          ]
        },
        "unit": {
          "enum": [
            "mm",
            "in"
          ]
        }
      },
      "required": [
        "name",
        "expr",
        "value",
        "unit"
      ],
      "additionalProperties": false
    },
    "minItems": 0
  }
}
```
<!-- api:end schema:params -->

<a id="api-save"></a>
### JS3D.save

**Signature**

`JS3D.save()`.

**Arguments/defaults/units**

Project envelope with independent version 1; does not write a file. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Project envelope with independent version 1; does not write a file.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.save();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:save -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "app": {
        "const": "jumpstart-3d"
      },
      "version": {
        "const": 1
      },
      "doc": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": true,
        "description": "Raw project payload: observed fields, not a stable exhaustive schema; see Part 2 project format."
      }
    },
    "required": [
      "app",
      "version",
      "doc"
    ],
    "additionalProperties": false
  }
}
```
<!-- api:end schema:save -->

<a id="api-selection"></a>
### JS3D.selection

**Signature**

`JS3D.selection()`.

**Arguments/defaults/units**

Copy of selected body IDs. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Copy of selected body IDs.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; no undo or storage changes.

**Example**

```js
JS3D.selection();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:selection -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "items": {
      "type": "string"
    },
    "minItems": 0
  }
}
```
<!-- api:end schema:selection -->

## Files

<!-- api:begin index:Files -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.export(kind, opts?)` | bytes; Promise; see waiting rule | [Effects/errors](#api-export) | [Example/reference](#api-export) |
| `JS3D.load(json, opts?)` | void; Promise; see waiting rule | [Effects/errors](#api-load) | [Example/reference](#api-load) |
| `JS3D.newDesign(mode?)` | void; Promise; see waiting rule | [Effects/errors](#api-newDesign) | [Example/reference](#api-newDesign) |
<!-- api:end index:Files -->

<a id="api-export"></a>
### JS3D.export

**Signature**

`JS3D.export(kind, opts?)`.

**Arguments/defaults/units**

JSON is immediate; geometry exports wait for ready and omit hidden/hole bodies. Returns bytes without download. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to Uint8Array. JSON is immediate; geometry exports wait for ready and omit hidden/hole bodies. Returns bytes without download.

**Errors**

`nothing to export: holes and hidden shapes are left out`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Read-only; export quality follows app preferences.

**Example**

```js
await JS3D.export("stl");
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:export -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "kind",
        "enum": [
          "stl",
          "obj",
          "3mf",
          "glb",
          "step",
          "json"
        ]
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "ids": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "minItems": 1
              }
            ]
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "bytes",
  "returnsSchema": {
    "type": "string",
    "contentEncoding": "base64",
    "description": "Direct: Uint8Array. invoke/WebSocket: {$bytes:base64}; this schema describes the encoded payload."
  }
}
```
<!-- api:end schema:export -->

<a id="api-load"></a>
### JS3D.load

**Signature**

`JS3D.load(json, opts?)`.

**Arguments/defaults/units**

Accepts serialized or parsed project envelope/raw document; validates essential body structure, waits for ready. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to undefined. Accepts serialized or parsed project envelope/raw document; validates essential body structure, waits for ready.

**Errors**

`not a JumpStart 3D project`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Replaces document, clears selection and history, saves immediately in browser storage.

**Example**

```js
await JS3D.load(JS3D.save());
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:load -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "json",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": true,
            "description": "Raw project payload: observed fields, not a stable exhaustive schema; see Part 2 project format."
          }
        ]
      },
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "keepId": {
            "type": "boolean",
            "default": false
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 1,
    "maxItems": 2,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:load -->

<a id="api-newDesign"></a>
### JS3D.newDesign

**Signature**

`JS3D.newDesign(mode?)`.

**Arguments/defaults/units**

New project through project subsystem; waits for ready. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to undefined. New project through project subsystem; waits for ready.

**Errors**

`mode must be "beginner" or "advanced"`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Replaces document, clears history; normal project storage applies.

**Example**

```js
await JS3D.newDesign("advanced");
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:newDesign -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "mode",
        "enum": [
          "beginner",
          "advanced"
        ],
        "default": "beginner"
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:newDesign -->

## History and view

<!-- api:begin index:History and view -->
| Name/signature | Returns and waiting | Effects/errors | Example/reference |
|---|---|---|---|
| `JS3D.fit()` | void; synchronous | [Effects/errors](#api-fit) | [Example/reference](#api-fit) |
| `JS3D.redo()` | json; synchronous | [Effects/errors](#api-redo) | [Example/reference](#api-redo) |
| `JS3D.screenshot(opts?)` | bytes; Promise; see waiting rule | [Effects/errors](#api-screenshot) | [Example/reference](#api-screenshot) |
| `JS3D.screenshotDataURL(opts?)` | json; Promise; see waiting rule | [Effects/errors](#api-screenshotDataURL) | [Example/reference](#api-screenshotDataURL) |
| `JS3D.select(ids?)` | void; synchronous | [Effects/errors](#api-select) | [Example/reference](#api-select) |
| `JS3D.setMode(mode)` | void; synchronous | [Effects/errors](#api-setMode) | [Example/reference](#api-setMode) |
| `JS3D.undo()` | json; synchronous | [Effects/errors](#api-undo) | [Example/reference](#api-undo) |
<!-- api:end index:History and view -->

<a id="api-fit"></a>
### JS3D.fit

**Signature**

`JS3D.fit()`.

**Arguments/defaults/units**

Frames selection, or all bodies if none selected. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Frames selection, or all bodies if none selected.

**Errors**

No additional catalogued errors; underlying operation failures remain plain Error messages. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Camera only.

**Example**

```js
JS3D.fit();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:fit -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:fit -->

<a id="api-redo"></a>
### JS3D.redo

**Signature**

`JS3D.redo()`.

**Arguments/defaults/units**

Returns history label or null; schedules rebuild. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Returns history label or null; schedules rebuild.

**Errors**

`undo is off in the 3D Print Sim`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.redo();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:redo -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "null"
      }
    ]
  }
}
```
<!-- api:end schema:redo -->

<a id="api-screenshot"></a>
### JS3D.screenshot

**Signature**

`JS3D.screenshot(opts?)`.

**Arguments/defaults/units**

Waits for ready, renders PNG; URL form starts data:image/png;base64,. Width preserves aspect ratio. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to Uint8Array. Waits for ready, renders PNG; URL form starts data:image/png;base64,. Width preserves aspect ratio.

**Errors**

`width must be a number of pixels between 1 and 8192`; `the 3D view has no size to draw (is the tab hidden?)`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Optional fit changes camera; no undo.

**Example**

```js
await JS3D.screenshot({fit:true,width:800});
```

**Since/transports**

1.1.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:screenshot -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "fit": {
            "type": "boolean",
            "default": false
          },
          "width": {
            "type": "number",
            "minimum": 1,
            "maximum": 8192
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "bytes",
  "returnsSchema": {
    "type": "string",
    "contentEncoding": "base64",
    "description": "Direct: Uint8Array. invoke/WebSocket: {$bytes:base64}; this schema describes the encoded payload."
  }
}
```
<!-- api:end schema:screenshot -->

<a id="api-screenshotDataURL"></a>
### JS3D.screenshotDataURL

**Signature**

`JS3D.screenshotDataURL(opts?)`.

**Arguments/defaults/units**

Waits for ready, renders PNG; URL form starts data:image/png;base64,. Width preserves aspect ratio. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Promise resolving to the JSON value described below. Waits for ready, renders PNG; URL form starts data:image/png;base64,. Width preserves aspect ratio.

**Errors**

`width must be a number of pixels between 1 and 8192`; `the 3D view has no size to draw (is the tab hidden?)`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Optional fit changes camera; no undo.

**Example**

```js
await JS3D.screenshotDataURL({fit:true,width:800});
```

**Since/transports**

1.1.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:screenshotDataURL -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "opts",
        "type": "object",
        "properties": {
          "fit": {
            "type": "boolean",
            "default": false
          },
          "width": {
            "type": "number",
            "minimum": 1,
            "maximum": 8192
          }
        },
        "required": [],
        "additionalProperties": true
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "string"
  }
}
```
<!-- api:end schema:screenshotDataURL -->

<a id="api-select"></a>
### JS3D.select

**Signature**

`JS3D.select(ids?)`.

**Arguments/defaults/units**

Select IDs; omitted, null or [] clears selection. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Select IDs; omitted, null or [] clears selection.

**Errors**

`no body <id>`; `no body ids given`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

Selection only; no undo.

**Example**

```js
JS3D.select([]);
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:select -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "ids",
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 0
          },
          {
            "type": "null"
          }
        ]
      }
    ],
    "minItems": 0,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:select -->

<a id="api-setMode"></a>
### JS3D.setMode

**Signature**

`JS3D.setMode(mode)`.

**Arguments/defaults/units**

Switches mode; arch hides solid bodies. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous undefined. Switches mode; arch hides solid bodies.

**Errors**

`mode must be "beginner", "advanced" or "arch" (Architect)`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

May persist project mode; no geometry waiting.

**Example**

```js
JS3D.setMode("advanced");
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:setMode -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [
      {
        "title": "mode",
        "enum": [
          "beginner",
          "advanced",
          "arch"
        ]
      }
    ],
    "minItems": 1,
    "maxItems": 1,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "void",
  "returnsSchema": null
}
```
<!-- api:end schema:setMode -->

<a id="api-undo"></a>
### JS3D.undo

**Signature**

`JS3D.undo()`.

**Arguments/defaults/units**

Returns history label or null; schedules rebuild. Lengths in mm, angles in degrees unless stated otherwise. Positional arguments and defaults are detailed in the schema below and the preserved feature notes.

**Returns**

Synchronous the JSON value described below. Returns history label or null; schedules rebuild.

**Errors**

`undo is off in the 3D Print Sim`. See preserved feature notes for geometric constraints and diagnostic catalogues.

**Effects/undo/storage**

One labelled undo step; schedules geometry rebuild; call ready before reading geometry. Normal project autosave applies. Edit guards refuse Chisel, CosForge and Chip Carving.

**Example**

```js
JS3D.undo();
```

**Since/transports**

1.0.0; direct: yes; invoke: yes; postMessage: no. No deprecation.

<!-- api:begin schema:undo -->
```json
{
  "argsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "array",
    "prefixItems": [],
    "minItems": 0,
    "maxItems": 0,
    "$defs": {},
    "description": "Positional arguments. Optional trailing positions may be omitted; direct JavaScript undefined selects defaults. Null and empty arrays are only interchangeable where explicitly described."
  },
  "returnsKind": "json",
  "returnsSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "anyOf": [
      {
        "type": "string"
      },
      {
        "type": "null"
      }
    ]
  }
}
```
<!-- api:end schema:undo -->

## Feature details and examples

<a id="reading"></a>
### Reading

| Call | Returns |
|---|---|
| `JS3D.version` | `"1.13"`, derived from apiVersion. See the version and compatibility policy. |
| `JS3D.appVersion` | The app's version, such as `"2.0"`. |
| `JS3D.kinds()` | `[{ kind, defaults }]`: the 20 shape kinds `add` accepts and their default sizes (`box`, `cylinder`, `sphere`, `cone`, `pyramid`, `wedge`, `torus`, `tube`, `hemisphere`, `prism`, `text`, `star`, `heart`, `roof`, `roundroof`, `paraboloid`, `gem`, `spring`, `capsule`, `arrow`). |
| `JS3D.list()` | The top-level bodies: `[{ id, name, kind, hole, hidden, locked, color, position, bbox, volume, error, children? }]`. `kind` is the shape kind for a basic shape and `"group"`, `"extrude"`, `"revolve"`... for the rest. `bbox` is the world box `{ min: [x,y,z], max: [x,y,z] }` and `volume` is in mm³; both are `null` until built (and while an error is shown). `error` is the geometry engine's message or `null`. `children` is the number of parts in a group. |
| `JS3D.get(id)` | The same entry plus `node` (a copy of the body's definition) and `m` (its 16-number matrix). |
| `JS3D.params()` | `[{ name, expr, value, unit }]`. `value` is mm (`null` when the expression fails), `unit` is `"mm"` or `"in"`. |
| `JS3D.doc()` | A copy of the whole design document. |
| `JS3D.save()` | `{ app: "jumpstart-3d", version: 1, doc }`: what the Export menu's project file holds. Nothing is downloaded or stored. See [Part 2](#part-2-the-project-file-format). |
| `JS3D.mode()` | `"beginner"`, `"advanced"`, `"arch"` (Architect) or `"chisel"`. |
| `JS3D.selection()` | The selected ids. |
| `JS3D.internals` | `{ app, store }`, the same objects as `window.__app` and `window.__store`, for people who know the code. |

<a id="waiting"></a>
### Waiting

`await JS3D.ready(timeoutMs = 90000)` resolves when the geometry engine is
idle and every visible body has been built (or has an error). It checks every
50 ms. If time runs out it throws and names the bodies still building. A body whose definition cannot be read at all (a hand-written file with a broken node) is never sent to the geometry engine; `ready` does not wait for it, and `list()` shows its `error`.

<a id="inspecting-and-checking"></a>
### Inspecting and checking

These five calls check a design without a picture. Each waits for the shapes to build (like `ready`), then reads them. They change nothing: no undo step, the selection stays as it was, nothing is saved. A call refuses while the design shows a preview or an earlier step (see the errors below), so every number comes from one design. Lengths are mm, areas mm², volumes mm³, weights grams, angles degrees. A call with no `ids` uses every top-level body that is not a hole and not hidden; with `ids` it uses those bodies (a missing one throws `no body <id>`). A body that has not built shows its build error; a hidden body that was never built says `<name> is hidden and has not been built; show it first`.

| Call | Result | Exact or mesh |
|---|---|---|
| `inspect(ids?, {material, density})` | `{ material: {key, name, density}, bodies: [{ id, name, hole, hidden, bbox: {min, max}, size: [x, y, z], volume, volumeFrom, area, weight, solids, error }], total: { bodies, bbox, size, volume, area, weight } }`. `material` is a filament key (`pla` by default; `pla`, `plaplus`, `petg`, `abs`, `asa`, `nylon`, `pc`, `cfpla`, `cfnylon`, `peek`, `tpu`); `density` (g/cm³, 0.1 to 25) overrides it and the key is then `"custom"`. `weight` is a solid part (100 % infill); a slicer's estimate is lower. A body with an `error` has null numbers and is left out of `total`. A wire-only body (curves, no surface) comes back with bbox null, volume 0, area 0 and a `note`. | `bbox`, `size`: exact box of the mesh. `volume`: the exact solid (`volumeFrom: "solid"`), else the mesh (`"mesh"`). `area`: the mesh (within about 0.5 %, a little low on curved faces). |
| `measure(a, b)` | `{ distance, exact, kind, from?, to?, delta?, angle?, parallel?, a, b }`. A target is a point `[x, y, z]`, a body id, `{body, face}` (a face number) or `{body, near: [x, y, z]}` (the face nearest that point; the result's `a.face` tells you its number). Kinds: `point-point` (with `delta`), `body-body` (shortest distance between the surfaces, 0 when they touch or overlap), `planes` (two flat parallel faces: the distance between their planes, such as a wall's thickness), `mesh`. Two flat faces also give `angle` (0 to 90). | `point-point`, `body-body`, `planes`: exact. `mesh`: `exact: false`, from the display mesh; crossing meshes do not report 0. |
| `printCheck({ids, printer, angle})` | `{ ok, summary, printer, bed: {w, d, h} or null, angle, issues: [{level, code, id, name, text}], bodies: [{ id, name, bbox, minZ, contactArea, overhangArea, overhangTriangles, fits }], ignored: [{id, name, why}] }`. `printer` is `generic` (256 x 256 mm, no height limit), `none` (no plate), or `a1`, `x1`, `p1s`, `mk4`, `mini`, `ender3`, `u1`; the default is the plate chosen in Settings. `angle` 10 to 80 (default the angle saved in Settings, 45 at first). Errors (`ok` false): `empty`, `build_error`, `wire_only`, `floating`, `below_plate`, `outside_bed`, `too_tall`. Warnings: `overhang` (more than 1 mm² of underside leaning out past `angle`), `small_contact` (less than a tenth of the footprint on the plate). Holes and hidden bodies go to `ignored`. | Mesh rules. Wall thickness is not checked. |
| `collisions({ids, gap})` | `{ pairs: [{ a, b, aName, bName, distance, state, overlap }], checked, skipped: [{id, name, error}] }`. `state` is `overlap`, `touch` (distance 0) or `near` (closer than `gap`, default 0). `overlap` is the shared volume; for `near` it is null. At most 50 bodies; the shared volume is worked out for the first 20 touching or overlapping pairs (later ones say `note`). A pair is listed when its distance is at most `gap` plus a 0.001 mm contact tolerance; 0.001 mm or less counts as touching. All distances and overlaps are worked out from one snapshot of the bodies taken at the start. The whole call has 90 seconds: pairs whose shared volume is not reached in time get `note: "not measured (the 90 second time limit was used up)"`. | Distances: exact solids. |
| `section(plane, {ids, points, picture, width})` | `plane` is `{axis: "x"|"y"|"z", at}` or `{origin, normal}`. `{ plane: {origin, normal, u, v}, shifted, area, bodies: [{ id, name, area, loops: [{ area, perimeter, hole, closed, min, max, points? }] }], skipped, truncated?, dataURL? }`. Loop coordinates are 2D, along `plane.u` and `plane.v` from `plane.origin`. `area` is the net area (outer loops minus holes), summed over bodies. A plane that passes exactly through a vertex moves 0.0001 mm (`shifted`). `points: true` adds each loop's points (over 5000 in all: `truncated`). `picture: true` adds `dataURL`, a PNG of the 3D view with the camera's side cut away (Beginner or Advanced mode; `width` default 800); the section view and the camera are put back as they were (the picture is always taken from the Home view). A cut of more than 200000 segments or 2000 outlines is refused. | Mesh cut (areas within the mesh's accuracy). |

Errors, word for word (a call that throws leaves the design as it was):

| Call | Text |
|---|---|
| any with `ids` | `no body <id>`, `no body ids given` |
| any, a body without a mesh | its build error, or `<name> is hidden and has not been built; show it first` |
| any | `the design is showing a preview; finish or cancel it first`, `the design is rolled back to an earlier step; return to the latest step first` |
| `measure`, `section`, `collisions` | `<name> is a wire-only shape (lines, no surface); it has no volume, area or faces to measure` (a body made only of curves, such as a wire from a STEP file; `measure` throws it, `section` and `collisions` list it in `skipped`) |
| `section` | `the cut has more than 200000 line segments; cut fewer or simpler bodies (pass ids)`, `the cut has more than 2000 separate outlines; cut fewer or simpler bodies (pass ids)` |
| `collisions` | `The geometry engine did not answer in time.` (the distances took longer than the 90 second limit) |
| `inspect` | `unknown material "<m>"; valid materials: pla, plaplus, petg, abs, asa, nylon, pc, cfpla, cfnylon, peek, tpu` |
| `inspect` | `density must be a number of g/cm3 from 0.1 to 25` |
| `measure` | `<a or b> must be a point [x, y, z], a body id, or {body, face} or {body, near}` |
| `measure` | `<a or b> must be [x, y, z] in mm` (a point or `near` that is not three numbers; `near` says `near must be ...`) |
| `measure` | `face must be a whole number from 0 to <n-1> (<name> has <n> faces)` |
| `measure` | `<name> has no face list; measure the body or a point instead` |
| `measure` | `a and b are the same body` |
| `measure` | `the geometry engine could not measure between <name> and <name>` |
| `measure` | `these two are too finely meshed to measure here (<n> vertex-triangle pairs, at most 40000000); measure between two points or two whole bodies instead` |
| `printCheck` | `unknown printer "<p>"; valid: generic, none, a1, x1, p1s, mk4, mini, ender3, u1 (or any 3D Print Sim printer id)` |
| `printCheck` | `angle must be a number of degrees from 10 to 80` |
| `collisions` | `gap must be a number of mm from 0 to 50` |
| `collisions` | `collisions takes at most 50 bodies at a time (got <n>); pass ids` |
| `section` | `give axis ("x", "y" or "z") and at, or origin [x, y, z] and normal [x, y, z]` (neither, both, or a bad axis) |
| `section` | `at must be a number (mm along <axis>)` |
| `section` | `origin must be [x, y, z] in mm`, `normal must be [x, y, z] in mm` |
| `section` | `normal must not be [0, 0, 0]` |
| `section` | `section pictures need Beginner or Advanced mode (now <mode>)` |
| `section` | `width must be a number of pixels between 1 and 8192` |

An example, on an open box:

```js
const outer = JS3D.add("box", { size: [60, 40, 25], name: "Box" });
const cavity = JS3D.add("box", { size: [56, 36, 25], at: [0, 0, 2], hole: true });
const box = JS3D.group([outer, cavity], { name: "Box" });
await JS3D.ready();
(await JS3D.inspect([box])).bodies[0].weight;                      // grams of PLA
(await JS3D.printCheck()).summary;                                 // "Ready to print: 1 part, no problems found."
JS3D.add("box", { size: [60, 40, 3], at: [0, 0, 26], name: "Lid" });
await JS3D.ready();
(await JS3D.collisions()).pairs;                                   // [] (1 mm apart); {gap: 2} lists them as "near"
(await JS3D.measure({ body: box, near: [30, 0, 12] }, { body: box, near: [28, 0, 12] })).distance; // 2, a wall's thickness
(await JS3D.section({ axis: "z", at: 10 })).bodies[0].area;        // 384
```

<a id="making-and-changing-shapes"></a>
### Making and changing shapes

| Call | What it does |
|---|---|
| `JS3D.add(kind, opts)` → id | Adds a shape. `opts`: `size` (`{w, d, h, ...}` or `[w, d, h]`; keys other than the ones `kinds()` lists for that kind are refused; `w`, `d`, `h` and `size` must be at least 0.01; `sides` and `points` whole numbers of at least 3), `at` (`[x, y, z]`, default `[0, 0, 0]`), `hole` (true makes it a hole), `color` (`"#rrggbb"`), `name`. An unknown kind throws and lists the valid ones. Undo label `Add box` (and so on). |
| `JS3D.fastener(opts)` → id | Adds a threaded fastener as one body. `opts`: `type` (`"bolt"`, `"nut"`, `"rod"` or `"cutter"`), `size` (metric `M2.5 M3 M4 M5 M6 M8 M10 M12`, or inch `#6-32 #8-32 #10-24 #10-32 1/4-20 1/4-28 5/16-18 5/16-24 3/8-16 3/8-24 1/2-13 1/2-20`), `length` (mm; for a bolt it is the length under the head; not used for a nut; at least 3 thread turns, at most 150), `clear` (print offset in mm, `-1` to `0`, default `0`; `-0.2` suits most printers; the offset is capped per part, a bolt at 0.07 and a nut at 0.15 of the pitch, so a small thread stops loosening early), `left` (true for a left-hand thread), `at` (`[x, y, z]`, default `[0, 0, 0]`; the base of the part sits at z), `name`. A bolt is a group of a hex head and a shank with a Thread feature; a nut is a hex prism with a hole and a Thread feature; a rod is a cylinder with a Thread feature; a cutter is a rod that is a hole and is built wider instead of thinner: its diameter grows by twice the print offset, so the hole it cuts is as loose as a nut with that offset, and the Thread print offset tool leaves it alone. Grouping it with a solid cuts a threaded hole. Building takes a few seconds: `await JS3D.ready()`. Bad input throws a plain message (`unknown size "M7"; sizes: ...`). Undo label `Add M8×30 bolt` (and so on). |
| `await JS3D.holePattern({ body, face, layout, hole })` → `{ id, holes, dropped }` (and `sketch` for the shapes) | Drills round holes into one flat face of a body, as ONE Hole feature (a single `hole` mod with every position, so the Hole dialog edits it), or cuts square, hex or slot holes there, as ONE sketch with an outline per hole and ONE Extrude cut (`hole.shape`, below). Async: it waits for the shapes to be built first. `face` is the world direction the face looks: `"+x"`, `"-x"`, `"+y"`, `"-y"`, `"+z"` or `"-z"`; it picks the body's flat face within 1° of that direction that lies farthest along it (on a tie the larger one). Sloped faces can only be reached in the dialog. Columns run along the face's longest straight edge (on a box top, the longer side), rows across it; `angle` and `start` are measured from that edge, turning counter-clockwise seen from outside the face. `layout`: `{ type: "grid", cols, rows, pitch, margin = 0, stagger = false, angle = 0 }` (`cols` and `rows` whole numbers 1 to 200; `pitch` a number for both directions or `[column pitch, row pitch]`, leave it out to spread the holes over the face; `stagger` shifts every other row by half a column pitch and makes it one hole shorter; `angle` turns the grid on the face, degrees) or `{ type: "circle", count, radius, start = 0, center, margin = 0 }` (`count` 2 to 200; `start` the first hole's angle from the face's first axis; `center` a world `[x, y, z]` moved onto the face, default the middle of the face). `margin` is the space between a hole's edge and the face's outline (outer edges and any holes already in it). Holes that would not fit are left out: `holes` counts the ones made, `dropped` the ones left out. `hole`: `{ kind = "simple", size, dia, depth, tip, cbDia, cbDepth, csDia, csAngle, pitch, clear }` with `kind` `"simple"`, `"cbore"`, `"csink"` or `"tapped"`; `size` (such as `"M3"` or `"#8"`) fills the diameter and the bore, sink or thread the way the Hole dialog does, and numbers you give override it; leave `depth` out for a through hole; `clear` (tapped only) defaults to the design's Thread print offset. `hole.shape` is `"round"` (the default, everything above), `"square"`, `"hex"` or `"slot"`; the shapes take `hole.width` (the square's side, the hex's width across flats, the slot's width, mm), `hole.length` (slots only: overall length, end to end, more than the width) and `hole.depth`, and none of the round-only keys (`kind`, `size`, `dia`, `tip`, `cbDia`, `cbDepth`, `csDia`, `csAngle`, `pitch`, `clear`). A hex has a flat facing along the row and a corner across it, so stagger with a row pitch of 0.866 × the column pitch makes a honeycomb. Each outline turns with the layout: in a grid by `angle` (angle 90 puts slots along the other axis), in a circle by its own polar angle (slots point at the centre). A shape's sketch is hidden and sits on the body (named `Square holes (N)`, `Hex holes (N)` or `Slots (N)`), its plane is the one a hand-made face sketch gets (x along world X, or Y on a face looking along X), and the cut is one `bool` mod on the named body only. A through cut is a number worked out from the body as it is now (the far side plus 1 mm), so a body made thicker later is no longer cut through, and a body made taller on the face's side leaves the cut starting at the old face (an internal pocket), as with any face-sketch cut; the depth is edited in the Extrude dialog, the outlines in the sketch. Moving or resizing the pattern means undo and run the call again. `id` is the cut's id and `sketch` the sketch's. At most 200 plain, square, hex or slot holes, 130 counterbores or countersinks, 8 tapped (a tapped hole takes about 2 seconds to build, measured in a 6 mm plate; thicker plates take longer). Errors are plain and nothing is added: `hole.shape must be "round", "square", "hex" or "slot"`, `hole.<key> is only for round holes`, `hole.width and hole.length are only for square, hex and slot holes`, `hole.width must be a positive number of mm (...)`, `hole.length must be a number of mm, more than hole.width`, `hole.length is only for slots`, `Pitch must leave a wall between holes: at least 6.1 mm along a row and 6.1 mm between rows.`, `A slot's length must be more than its width.`, `Some outlines overlap. Use a larger pitch or radius, or a smaller hole.`, `face must be "+x", ...`, `<name> has no flat face facing +z`, `layout.type must be "grid" or "circle"`, `unknown size "M7"; sizes: ...`, `Pitch must be at least the hole's width (3 mm).`, `Too many holes (225; the most is 200 for plain holes). ...`, `No holes fit on this face with these settings.` Undo labels `Hole pattern (12 holes)`, `Hole pattern (24 hex holes)`, `Hole pattern (24 square holes)`, `Hole pattern (24 slots)`; one undo removes the sketch and the cut together. |
| `JS3D.gear(opts)` → id | Adds a spur gear, a helical gear, a straight bevel gear or a rack as one body, with its hidden sketch(es) (two for a bevel gear). `opts`: `kind` (`"spur"` default, `"helical"`, `"bevel"` or `"rack"`), `module` (mm, 0.3 to 10, any number; required; for a helical gear it is the normal module), `teeth` (whole number, required: spur 12 to 200, helical 12 to 30, bevel 12 to 90, rack 2 to 100), `angle` (helical only: the helix angle, degrees, 5 to 30, default 20), `hand` (helical only: `"right"` default or `"left"`; a partner of the same module and angle needs the opposite hand to mesh on parallel shafts), `width` (mm, default 6; a bevel gear's default is 6 or a third of the way to the cone's tip (`module × mate / 6`), whichever is smaller, rounded down to 0.1 mm, and it may not exceed that third), `mate` (bevel only: the partner gear's teeth, 12 to 200, default the same as `teeth`; it sets where the cone's tip is, `module × mate / 2` above the big end), `base` (rack only: the solid strip under the teeth, mm, default 5), `bore` (spur, helical and bevel: shaft hole diameter, mm; 0 or leave out for none, else 1 mm or more, leaving at least `max(1, module)` mm under the teeth), `keyway` (spur only: a DIN 6885 groove for a bore of 6 to 58 mm, notch toward +y), `clear` (print clearance, mm, taken off every tooth at the pitch line, half from each flank; default 0.1 or a quarter of the module if that is smaller; 0 up to the smaller of 0.5 and a quarter of the module), `at` (`[x, y, z]`, default `[0, 0, 0]`), `name`. A key counts as given when it is not `null` or `undefined`. The teeth are the ISO 53 basic rack at a fixed 20° (addendum 1 module, dedendum 1.25, no root fillet, no profile shift), drawn as straight lines with eight points a flank; fewer than 17 teeth are drawn plain, not undercut. A spur gear or bevel gear lies flat with its axis along z through `at`, its base on `at`'s z and tooth 0 pointing along +x; a rack starts at `at`, runs along +x for `teeth × π × module` and ends in half gaps (racks lay end to end), with its pitch line through `at` and its teeth pointing +y. The sketches sit at the world origin and the body's matrix carries `at`. A spur gear or rack is one sketch and one Extrude (its width is the Extrude's distance, so it can be bound to a parameter); a bevel gear is a big-end sketch at z = 0 and a small-end sketch at z = `width` (the same outline scaled toward the cone's tip) with a straight Loft between them, and its bore is a through Hole feature: this is the usual CAD approximation, not a spherical involute. A helical gear is the spur outline of the transverse module `module / cos(angle)` turned a little at each of several sections and joined by straight Lofts (a very wide one is refused: `width must be a positive number of mm, at most N for this helical gear (...)`); the teeth turn a right-hand way for `"right"`. Module and teeth cannot be edited afterwards: undo and call again. Two spur gears of one module mesh with their centres `module × (teeth1 + teeth2) / 2` apart; when the second has an even tooth count, turn it by `180 / teeth2` degrees about its own axis. Two bevel gears of one module, `teeth` and `mate` swapped between them, mesh at 90° when the second is built the same way, turned (when its teeth are even) by `180 / teeth` degrees about z, then by −90° about y (both about the origin), then moved by `[module × teeth1 / 2, 0, module × teeth2 / 2]`. Bad input throws a plain message and adds nothing: `kind must be "spur", "helical", "bevel" or "rack"`, `module must be a number from 0.3 to 10 (mm)`, `teeth must be a whole number from 12 to 200 for a spur gear` (`from 12 to 30 for a helical gear`, `from 12 to 90 for a bevel gear`, `from 2 to 100 for a rack`), `width must be a positive number of mm` (for a bevel gear `..., at most 10 for this bevel gear (a third of the way to the cone's tip)`), `mate must be a whole number from 12 to 200 (the partner bevel gear's teeth)`, `angle and hand are only for helical gears`, `angle must be a number from 5 to 30 (degrees of helix angle)`, `hand must be "right" or "left"`, `mate is only for bevel gears`, `base must be a positive number of mm`, `base is only for racks`, `bore and keyway are not used for a rack`, `bore must be 0 (none) or from 1 to 31 mm for this gear (it leaves 2 mm under the teeth)` (or `this gear is too small for a bore`), `keyway must be true or false`, `keyway is for spur gears only`, `keyway needs a bore from 6 to 58 mm (DIN 6885)`, `the keyway does not fit: it must leave 2 mm under the teeth`, `clear must be a number from 0 to 0.5 mm for module 2`, `at must be [x, y, z] in mm`. Undo label `Add Spur gear 20 teeth m2` (and `Bevel gear ...`, `Rack ...`). |
| `JS3D.namePlate(opts)` → `{plate, textBody, size}` | Adds a flat plate sized to one line of text, with the text raised on it as a second body or cut into it. `opts`: `text` (required; trimmed, one line, 1 to 40 characters, every character must be in the chosen font), `font` (`"sans"` default, `"serif"` or `"mono"`; all three are bold and cover English and Western European letters, digits and common symbols, and a character they lack is refused, not dropped), `size` (the height of a capital letter, mm, 2 to 100, default 10), `style` (`"raised"` default, or `"cut"`), `depth` (how far the letters stand up or are cut in, mm, 0.2 to 10, default 1; for `"cut"` at most `thickness − 0.6`), `thickness` (the plate, mm, 0.6 to 20, default 3; `"cut"` needs 0.8 or more), `margin` (text to the plate's edge, mm, 1.5 to 20, default 3), `shape` (`"rounded"` default, corner radius = `margin`, or `"pill"`, fully round ends), `holes` (`"hang"` default: one hole at the left end; `"none"`; `"screws"`: one at each end), `holeDia` (mm, default 5 for `"hang"` and 3.5 for `"screws"`, from 1 up to the plate's depth minus 3 so 1.5 mm of plate is left round it; not with `"none"`), `color` (the plate, default `"#2b7bb9"`), `textColor` (raised letters only, default `"#ffffff"`), `at` (`[x, y, z]`: the plate's centre in x and y and its base at z, default `[0, 0, 0]`), `name` (default `Name plate <text>`; the raised text body is named the same plus ` text`). A key counts as given when it is not `null` or `undefined`. The text runs along +x, read from above. The plate is the text's measured box (width `tw`, height `th`, from the same outlines the drawing code uses) plus `margin` all round: depth `th + 2 × margin`; a hole adds `holeDia + margin` (rounded) or `holeDia / 2 + margin` (pill) of length at its end and sits `margin` from the text, and with one hole the text shifts away from it. `size` in the result is `[width, depth, height]` in mm (height = thickness plus the letters' height for `"raised"`, the thickness for `"cut"`). One hidden sketch (the outline and the holes) and one Extrude make the plate, its thickness the Extrude's distance. Raised letters are a Text shape sitting on the plate's top face with its own colour (the 3MF export keeps both colours; on a one-nozzle printer a filament change at the plate's top prints two); `textBody` is `null` for `"cut"`, whose letters are the app's Deboss text feature on the plate. Keep the two bodies separate: grouping them fuses them into one colour. The plate does not follow later text edits: to fit new text, undo and call again. Bad input throws a plain message and adds nothing: `text must be a non-empty string`, `text must be one line, without line breaks or tabs`, `text can have at most 40 characters (this has 41)`, `font must be "sans", "serif" or "mono"`, `text has characters the fonts do not have: "Ł", "ж". The fonts cover English and Western European letters, digits and common symbols.`, `size must be a number from 2 to 100 (mm, the height of a capital letter)`, `style must be "raised" or "cut"`, `depth must be a number from 0.2 to 10 (mm)`, `thickness must be a number from 0.6 to 20 (mm)`, `the plate is too thin to cut text into (make it at least 0.8 mm)`, `depth must be at most 2.4 mm here, so 0.6 mm of plate stays under the letters`, `margin must be a number from 1.5 to 20 (mm)`, `shape must be "rounded" or "pill"`, `holes must be "none", "hang" or "screws"`, `holeDia is only for holes "hang" or "screws"`, `the text is too small for a hole here: use a larger margin, or holes "none"`, `holeDia must be a number from 1 to 13 mm for this plate (it leaves 1.5 mm of plate round the hole)`, `color must look like "#rrggbb"`, `textColor is only for raised text (cut-in letters are part of the plate)`, `textColor must look like "#rrggbb"`, `at must be [x, y, z] in mm`. Undo label `Add Name plate <text>`. |
| `JS3D.knurl(opts)` → id | Adds a knurled knob: a cylinder with straight V grooves all round and an optional bore. `opts`: `diameter` (outside, to the groove tips, mm, 6 to 150, default 20), `length` (mm, 1 to 200, default 15), `grooves` (a whole number, 8 to 120; default about one per mm of circumference, `round(π × diameter)` kept between 8 and 120), `depth` (mm, 0.1 up to a quarter of the diameter, and at least `radius × (1 − cos(π / grooves))` so that the groove roots lie inside the chord between two tips; default a 90° V, `π × diameter / grooves / 2`), `bore` (`"none"` default; the dialog starts with a 5 mm round bore, `"round"`, `"hex"` or `"d"`), `boreSize` (mm, from 1 to the largest that leaves 1 mm under the groove roots; the diameter for `"round"` and `"d"`, across flats for `"hex"`; default 5, hex 8; not with `"none"`), `at` (`[x, y, z]`: the axis passes through x and y, the base is at z, default `[0, 0, 0]`), `name` (default `Knurled knob <diameter> x <length>`). A key counts as given when it is not `null` or `undefined`. One hidden sketch (2 × `grooves` straight lines alternating between the tip radius and the root radius, tooth 0 pointing along +x, plus the bore) and one Extrude, so the result is a true solid that exports to STEP. A `"d"` bore has its flat on the +x side, 0.4 × `boreSize` from the centre. The knurl is straight only; for a diamond pattern use the Texture tool, which works on the mesh and is not kept in a STEP file. Bad input throws a plain message and adds nothing: `diameter must be a number from 6 to 150 (mm)`, `length must be a number from 1 to 200 (mm)`, `grooves must be a whole number from 8 to 120`, `depth must be a number from 0.1 to 5 mm for this diameter (the grooves can reach at most half way to the middle)`, `depth must be at least 0.762 mm for 8 grooves on this diameter; shallower grooves vanish`, `bore must be "none", "round", "hex" or "d"`, `boreSize is only for a bore "round", "hex" or "d"`, `this knob is too small for a bore: use a larger diameter, or bore "none"`, `boreSize must be a number from 1 to 16.952 mm for this knob (it leaves 1 mm under the grooves)` (a hex adds `, measured across flats`), `at must be [x, y, z] in mm`. Undo label `Add <name>`. |
| `await JS3D.codeCad({code, bindings, name, bodyId})` → id | Builds ONE solid from replicad code in a temporary worker and adds it as an ordinary STEP body that keeps its code (`body.codeCad`). `code` is a function body that gets `replicad` and `params` and returns one closed solid (millimetres; not a drawing, surface, list or promise), at most 100,000 characters. `bindings` (optional) links names the code reads as `params.<name>` to named parameters: `{ width: "Width" }` (a parameter's name or id; saved by id, so renaming it changes nothing). With `bodyId` the body made earlier is updated in place (same id, position and later features; a new STEP file). Nothing runs when a design is opened or a parameter changes: the code runs only on a call like this or the dialog's Build and Update. The work stops after 25 seconds. The file that comes back is built again in the design's own worker and must be one closed solid before it is used. The result is one undo step, or nothing at all: a failed or cancelled build changes nothing, and a result is thrown away if another design was opened, a linked parameter changed or the body being updated changed while the code ran. The code is trusted JavaScript, not a sandbox: it can use the network, the browser's saved designs and caches, and other workers, and the time limit does not limit memory. Errors are plain messages (`The code has a syntax error: …`, `The code stopped with an error: …`, `The code must return one solid …`, `The code returned 2 separate pieces …`). The dialog is Open/Export > Code CAD…. |
| `JS3D.spring(opts)` → id | Adds a compression spring of round wire as one body (the app's Coil, with two Split body planes for flat ends). `opts`: `wire` (the wire's thickness, mm, 0.4 to 10, default 2), `outside` (outside diameter, mm, 2 to 200 and at least five wire diameters, default 20), `freeLength` (the spring's height, mm, 1 to 300, default 30), `turns` (total turns, 2 to 10 in steps of a half, default 5), `hand` (`"right"` default or `"left"`), `ends` (`"open"` default, or `"flat"`), `color` (default `"#7d8a96"`), `at` (`[x, y, z]`: the axis passes through x and y, the base is at z, default `[0, 0, 0]`), `name` (default `Spring <outside> x <freeLength>`). A key counts as given when it is not `null` or `undefined`. The wire starts on +x at the bottom and turns counter-clockwise going up for a right-hand spring. `"open"`: the wire just stops, cut square to itself, and the pitch is solved so the whole spring is exactly `freeLength` high (`freeLength = turns × pitch + wire × cos(helix angle)`). `"flat"`: the pitch is `freeLength / turns` and the first and last bit of wire is cut off by a horizontal plane, so both ends are flat and the height is exactly `freeLength`; the two planes stay where they are if the Coil is edited later, so undo and call again to change the length. Closed (squared) end turns are not made. The gap between coils, along the axis, must be at least 5 % of the wire, and the pitch at most 1.5 times the circumference of the wire's centre line (`The spring is too steep. Use more turns, a shorter free length or a larger outside diameter.`). No live preview. Bad input throws a plain message and adds nothing: `wire must be a number from 0.4 to 10 (mm)`, `outside must be a number from 2 to 200 (mm)`, `outside must be at least five wire diameters (25 mm for this wire)`, `freeLength must be a number from 1 to 300 (mm)`, `turns must be a number from 2 to 10, in steps of a half`, `hand must be "right" or "left"`, `ends must be "open" or "flat"`, `color must look like "#rrggbb"`, `at must be [x, y, z] in mm`, `The coils would touch. Increase the free length, use fewer turns, or use thinner wire.`, `This spring needs too much wire to build. Use fewer turns, a shorter free length, a smaller outside diameter or thicker wire.` (the wire's length may be at most 600 wire thicknesses; a 20 × 30 mm spring of 5 turns is 142, of 10 turns 283). Undo label `Add <name>`. |
| `JS3D.remove(ids)` → count | Deletes bodies and returns how many. `JS3D.delete` is the same call. Sketches only they used go too. |
| `JS3D.duplicate(ids, offset)` → new ids | Copies bodies, moved by `offset` (default `[0,0,0]`). |
| `JS3D.move(ids, [dx, dy, dz])` | Moves by that much along the world axes. |
| `JS3D.moveTo(id, [x, y, z])` | Puts the body's position (its matrix translation) at that point. |
| `JS3D.rotate(ids, axis, degrees, opts)` | Turns about a world axis, `"x"`, `"y"`, `"z"` or `[x, y, z]`, right-hand rule. `opts.about` is the point to turn around. The default is the middle of the bodies' world box, which needs them built: without `opts.about`, a body still being built throws `<name> is still being built: await JS3D.ready() first, or pass opts.about`, so the result never depends on timing. |
| `JS3D.resize(id, { w, d, h, ... })` | Sets the sizes of a **plain** shape (a basic shape with no features). Same checks as `add`. A torus keeps its depth equal to its width. A size that was tied to a parameter is freed. On anything else it throws `resize works on plain shapes; use scale`. |
| `JS3D.scale(ids, k, opts)` | Stretches any body. `k` is one number or `[kx, ky, kz]`; an array is along **each body's own axes**, not the world's (they differ on a turned body). `opts.about` is the point that stays put (default the middle of the bodies' world box; same rule as `rotate` for bodies still being built). It adds, or folds into, a `scale` feature on the body, the way the Beginner size boxes do. Scaling back by `1/k` about the same point removes the feature again. After a scale the body is no longer a plain shape, so `resize` and `bind` refuse it until you undo or scale back. |
| `JS3D.setHole(ids, bool)` | `bool` must be `true` or `false` (same for `setHidden`). Makes bodies holes (cut away what they overlap in a group, not exported on their own) or solids. |
| `JS3D.setColor(ids, "#rrggbb")` | |
| `JS3D.rename(id, name)` | |
| `JS3D.setHidden(ids, bool)` | A hidden body stays in `list()` with `hidden: true`, is not drawn and is left out of exports. |
| `JS3D.group(ids, { name, op })` → id | Combines two or more bodies into one: solids joined, holes cut out. `op: "intersect"` keeps only what all of them share; `op: "cut"` cuts the others out of the first. |
| `JS3D.ungroup(id)` → new ids | Splits a group back into its parts, in the same places. Throws if the body is not a group; throws `this group has features (fillets, holes...); remove them before ungrouping` when the group carries features (they would be lost); throws `this group was stretched at an angle, so it cannot be split back into shapes` when a resize cannot be pushed down into turned parts. Nothing changes when it throws. |

Locks (`locked` in `list()`) are a guard for the mouse; the bridge does not
check them.

<a id="advanced-cad-sketches-features-and-selectors"></a>
### Advanced CAD: sketches, features and selectors

These calls make the same sketches and features the Advanced dialogs make, so a person can open the feature tree, the dialogs and the
sketch editor on the result. Each is one undo step. They work in a design of any mode (`newDesign("advanced")` is the natural start).
Every one starts like the other edits (Chisel, CosForge and Chip Carving refuse), a missing body throws `no body <id>`, and nothing is
added when a call throws. The geometry calls wait for the shapes to build themselves (`ready`), then refuse a body that is marked as a
hole (`<name> is marked as a hole; features go on solid bodies`), has a build error (`<name> has a build error: <message>`), or is hidden
and so was never built (`<name> is hidden and has not been built; show it first`). A "length" is a number of mm more than 0 (or an
expression); an **expression** is text such as `"W/2"` or `"d1 + 2"` that can use parameters and sketch dimensions. A value given as an
expression is kept as one, so it follows the parameter: `exprs` on the feature (Part 2).

| Call | What it does |
|---|---|
| `await JS3D.sketch({ on, name, shapes, hidden })` → `{ sketch, name, plane, shapes, profiles, dof, dims }` | Adds a sketch of fully dimensioned shapes (every shape has degrees of freedom 0; `dof` says so). `on`: `"XY"` (default), `"XZ"` (the Front plane), `"YZ"` (the Right plane), `{ plane, offset }` (offset in mm along the plane's normal: XY +z, XZ -y, YZ +x) or `{ body, face }` (`face`: a face selector or index that gives exactly one flat face). `shapes`: 1 to 200 objects, see below. `name` defaults to `Sketch N`; `hidden` to `false`. The result's `plane` is `{ o, x, y, n }` in the world, `shapes` lists each shape's `type`, `ents` (entity ids) and `center`, `profiles` the closed regions (`pt` inside each, `area`), `dims` the named dimensions (`name`, `value`, `expr`). Label `Create sketch`. The face's outline is not copied into the sketch: only the shapes you give are in it. |
| `await JS3D.extrude({ sketch, profiles, dist, through, mode, dist2, op, body, name })` → `{ body, feature }` | Pushes closed profiles of a sketch along its normal. `dist` is a number of mm, not 0 (or an expression; negative goes the other way, into the body for a face sketch). `profiles`: points `[x, y]` in the sketch, each picks the region holding it; the default is every profile that does not lie inside an odd number of others (a rectangle with a circle in it gives the ring; separate shapes all of them). `mode`: `"one"` (default), `"sym"` (dist split both ways) or `"two"` (also `dist2`, more than 0, the other way). `op`: `"new"` (default: a new body, named `name` or `Body N`; `feature` is `null`), `"join"` or `"cut"` (both need `body`, a solid body: the extrude becomes a feature of it). `through: true` (cut only, instead of `dist`) cuts right through the body: the distance is worked out at the call, from the body's size then, like the hole pattern's. The sketch is hidden, as the dialog's OK does. Labels `Extrude`, `Extrude join`, `Extrude cut`. |
| `await JS3D.revolve({ sketch, profiles, axis, angle, op, body, name })` → `{ body, feature }` | Turns profiles about `axis`: `"X"`, `"Y"` or `"Z"` (a world axis through the origin that lies in the sketch's plane) or the id of a `line` of the sketch. `angle` is degrees, more than 0 and at most 360 (default 360; or an expression). The rest as `extrude`. Label `Revolve`. A profile that crosses the axis builds with the geometry engine's own error in `list()`. |
| `await JS3D.fillet(id, edges, r)` → `{ body, feature, edges }` | Rounds the edges `edges` picks (a selector, an index or a list of indices) with radius `r` (a length or expression). Exactly those edges: no growing along tangent chains. A radius that is too large is not checked here: the body shows the engine's message in `list()` (`Fillet radius 5 mm is too large ... about 4.8 mm`). Label `Fillet`. |
| `await JS3D.chamfer(id, edges, d)` → `{ body, feature, edges }` | The same with a bevel of distance `d`. Label `Chamfer`. |
| `await JS3D.shell(id, { th, open, dir })` → `{ body, feature, open }` | Hollows the body to walls `th` thick (a length or expression). `open`: a face selector, index or list for the faces to take away (`"top"` makes an open box); left out or `[]` makes a closed hollow. `dir`: `"in"` (default), `"out"` or `"both"`. Labels `Shell` and `Hollow`. |
| `await JS3D.hole(id, { face, points, kind, size, dia, depth, tip, cbDia, cbDepth, csDia, csAngle, pitch, clear })` → `{ body, feature, holes }` | Round holes at world points `[x, y, z]` on one flat face (`face` must give exactly one flat face: `a hole needs exactly one`). Each point is moved onto the face along its normal. One `hole` feature for all of them. `kind`, `size`, `dia`, `depth` and the rest are the Hole dialog's, checked as `holePattern` checks them (leave `depth` out for a through hole). Errors: `point 2 [22, 12, 0] is not on the face, or the hole there runs over its edge`, `holes 1 and 3 overlap (centres 2.5 mm apart; each is 3.4 mm wide)`, `Too many holes (N; the most is M for plain holes).`, and `hole makes round holes; use holePattern for square, hex or slot holes` when `shape` is given. Label `Hole (4 holes)`. |
| `JS3D.pattern(id, { features, type, axis, count, spacing, axis2, count2, spacing2, both, angle, center })` → `{ body, feature, copies }` | Repeats features of the body (this call is synchronous). `features`: ids of holes, extrude, revolve and sweep cuts or joins, and embossed text on the body, or `["shape"]` for the whole body (copies joined). `type`: `"rect"` (`count` 1 to 200 along `axis`, `spacing` mm apart, not 0 when `count` is more than 1; optionally `axis2`, `count2`, `spacing2`, not 0 when `count2` is more than 1 and ignored at `count2` 1, so `spacing2: 0` with `count2: 1` is accepted; `both` spreads the copies to both sides) or `"circle"` (`count` 2 to 360 copies over `angle` degrees, default 360, about `axis` through `center`, default the origin). `axis` is `"x"`, `"y"`, `"z"` or `[x, y, z]`, in the world. `count`, `spacing`, `angle` may be expressions. Label `Pattern`. `copies` is the number of new copies, at most 1999 (the original and its copies together are at most 2000, a `both` direction counting 2n - 1): more is refused with `this pattern would make 159200 copies; the most is 1999 (counting the original, 2000 in all)`. |
| `await JS3D.faces(id, selector)` / `await JS3D.edges(id, selector)` → list | The faces or edges of the built body that the selector picks (default `"all"`; also a whole number or a list of them), in world mm, sorted by index. A face: `index`, `type` (`plane`, `cylinder`, `cone`, `sphere`, `torus`, `other`), `center`, `normal` (planes), `area`, `radius` and `axis` (cylinders), `hole` (a cylinder that is a hole wall), `edgeCount`. An edge: `index`, `type` (`line`, `circle`, `ellipse`, `other`), `start`, `end`, `mid`, `center`, `direction` (lines), `length`, `radius` (circles), `faces` (the faces it joins). Seams and smooth joins are not edges. **Indices belong to the shape as built now and are valid until the next edit**; selectors are what to keep. Errors: `Body 1 has no face 17 (it has 0 to 9)`, `Body 1 has no edge 40 (it has 0 to 23; seams and smooth joins are not edges)`, `no faces match "cone" on Body 1`. |

**Shapes** for `sketch` (sizes may be expressions, positions are numbers; coordinates are the sketch's own x, y: world x, y on XY and on a
face looking up, x, z on XZ, y, z on YZ, and for any face the returned `plane` says which world directions they are):

| `type` | Keys |
|---|---|
| `rect` | `center` (default `[0, 0]`), `size` `[w, h]` |
| `roundrect` | `center`, `size`, `radius` (more than 0, less than half the smaller side) |
| `circle` | `center`, `diameter` |
| `slot` | `center`, `length` (overall, more than `width`), `width`, `angle` (0 or 90) |
| `polygon` | `center`, `sides` (3 to 64), `diameter` (across the corners; the first side is flat at the bottom) |
| `polyline` | `points` `[[x, y], ...]` (2 to 200; 3 or more when `closed`, which is the default), straight sides only |
| `line` | `from`, `to`, `construction` (a revolve axis, or a guide line left out of the profiles) |

Each shape carries the dimensions and constraints the sketcher's own tools give (a rectangle: horizontal and vertical sides, two
dimensions, a construction diagonal with a centre point), plus a position from the origin, so the sketch reads like one drawn by hand;
dimensions are named `d1`, `d2`, ... and can be used in expressions. Errors: `shapes[2].type must be one of rect, roundrect, circle, slot,
polygon, polyline, line`; `shapes[0].size must be [w, h] in mm, each more than 0`; `shapes[1].diameter must be a number of mm more than 0,
or an expression`; `shapes[0].radius must be more than 0 and less than half the smaller side (12.5 mm here)`; `shapes[3].length must be
more than its width`; `shapes[3].angle must be 0 or 90 (for other angles use a polyline)`; `shapes[4].sides must be a whole number from 3
to 64`; `shapes[5].points must be 2 to 200 [x, y] points in mm (3 or more when closed)`; `shapes[5] has a zero-length side at point 3`;
`shapes[0] has an unknown key "corner"; it takes center, size`; `shapes[0].center must be [x, y] in mm (numbers; expressions are for
sizes)`. **Size limit:** one `sketch` call may make at most 2000 points and 2000 entities in all, counted before anything is built: `this sketch would have 40000 points; the most is 2000 per call — split it into several sketches` (or `entities`). An expression (any length or angle given as text) is at most 200 characters: `shapes[0].diameter is too long; an expression can have at most 200 characters`. A number or expression that cannot be used: `shapes[1].diameter "W/0" does not give a usable number`. `on` errors: `on must be
"XY", "XZ", "YZ", {plane, offset} or {body, face}`, `on takes plane (and offset) or body and face, not both`, `offset must be a number of
mm`, `face "top" on Body 1 matches 3 faces; a sketch needs exactly one`, `face "hole" on Body 1 is not flat (it is a cylinder)`.

#### Selectors

A selector is at most 500 characters: `a selector can be at most 500 characters; this one has 507`. A word that is not in the grammar, such as `constructor`, gives the ordinary `unknown word` error.

A selector is text that picks faces (for `faces`, `shell`, `hole`, `sketch`) or edges (for `edges`, `fillet`, `chamfer`) by where they are,
in **world** coordinates, so "top" means up on the screen also for a body that was moved or turned.

```
selector := chain ( "or" chain )*
chain    := item ( "and" item )*
item     := "not" item | primary
primary  := "(" selector ")"
          | "edges of" item                  edge selectors only; the item is a face selector
          | "face" N | "edge" N              their own kind only
          | (">" | "<") AXIS [ "[" N "]" ]
          | ("|" | "#") AXIS
          | ("+" | "-") AXIS                 face selectors only
          | ALIAS [ "[" N "]" ]
          | TYPE | "all"
AXIS  := x | y | z            ALIAS := top (>Z) | bottom (<Z) | front (<Y) | back (>Y) | left (<X) | right (>X)
TYPE (faces) := plane | cylinder | cone | sphere | torus | other | hole       TYPE (edges) := line | circle | ellipse | other
```

- Case does not matter and spaces around the operators are optional (`> z`, `TOP`). Front is **-Y**: the app's XZ plane is the Front plane and looks along -Y.
- A chain starts from all faces (or all drawn edges) and each item narrows the set, left to right. `or` joins chains. `not X` removes what X picks from the current set; brackets work on the current set.
- `>Z` keeps the items whose centre is highest (within 0.01 mm); `<Z` the lowest. `>Z[1]` is the second level from the top (items whose centres differ by less than 0.01 mm are one level); a negative number counts from the other end, so `>Z[-1]` is the lowest level.
- `|Z` keeps flat faces whose normal, or straight edges whose direction, is within 1 degree of parallel to the axis; `#Z` within 1 degree of perpendicular. `+Z` and `-Z` (faces) keep flat faces that face that way.
- `plane`, `cylinder`, ... keep that type; `hole` keeps cylinder faces that are the wall of a hole; `all` keeps what there is.
- `edges of <face selector>` keeps the edges of those faces (it is evaluated on all the faces, then intersected with the current set of edges).
- `face 3` and `edge 3` pick an index (see `faces`, `edges`).
- An empty result throws `no faces match "<text>" on <name>` (or edges). Other errors: `empty selector`, `unexpected "<token>" at character <n> in "<text>"`, `unknown word "<word>"; use top, bottom, front, back, left, right, >Z, <Z, |Z, #Z, +Z, -Z, <types>, all, not, and, or, (, ), edges of, face N, edge N`, `"edges of" is for edges; this call takes faces`, `"circle" is an edge type; face types are plane, cylinder, cone, sphere, torus, other, hole` (and the mirror), `+Z and -Z are for faces; for edges use |Z or >Z`, `an index [n] only follows >X, <X ... or top, bottom, front, back, left, right`, `missing ")" in "<text>"`.

Example: `"edges of top and (>x or <x or >y or <y)"` is the four outer edges of the rim of a shelled box (the inner four of the ring are not the farthest in any direction).

#### What survives an edit

A selector is resolved **once, when you call**, against the shape as built, and the result is stored the way the app stores it: a
fillet's edges as the edge signatures the Fillet dialog stores, a shell's open faces as face centres, a hole's points in the body's own
coordinates. The selector text is not stored (a project file and a share link have no room for it, and every Advanced dialog rewrites its
feature from scratch). After an edit upstream, the engine finds the stored edges again by its own rules: first by the exact middle point,
else by the same position relative to the body's box and the same type, within 4 % of the box. A box whose width is bound to a parameter
and goes from 60 to 80 keeps its four outer top edges filleted, a shell's open face is the nearest face centre (within 5 % of the
diagonal: still the top), a hole keeps its place. What can fail: an edge whose place relative to the box moves by more than 4 % (an edge near a
hole at a fixed distance from a corner, after a large resize) can be lost (`Fillet: its edges no longer exist`) or move to a neighbour. Then undo and
call again, or call again with the same selector (keep your selectors, not your indices). After a parameter change, look at `faces` and `edges` again.

#### Example: a closed enclosure

```js
await JS3D.newDesign("advanced");
const sk = await JS3D.sketch({ on: "XY", name: "Base", shapes: [{ type: "rect", center: [0, 0], size: [60, 40] }] });
const { body } = await JS3D.extrude({ sketch: sk.sketch, dist: 25, name: "Enclosure" });
await JS3D.shell(body, { th: 2, open: "top" });
const f = await JS3D.fillet(body, "edges of top and (>X or <X or >Y or <Y)", 1);   // f.edges === 4
await JS3D.hole(body, { face: "bottom", points: [[-22, -12, 0], [22, -12, 0], [-22, 12, 0], [22, 12, 0]], size: "M3" });
await JS3D.ready();
```

The volume to expect: the box is 60 x 40 x 25 = 60000 mm3; the 2 mm shell with the top open takes out 56 x 36 x 23 = 46368, leaving 13632. A
fillet of radius 1 on the four outer rim edges takes r^2 (1 - pi/4) = 0.2146 mm3 per mm over 2 x 60 + 2 x 40 = 200 mm, 42.92, and the two
fillets at each of the 4 corners overlap in r^3 (1 - pi/2 + 2/3) = 0.0959, so the net is 42.92 - 0.38 = 42.54. The four M3 clearance holes (3.4 mm)
through the 2 mm floor take 4 x pi x 1.7^2 x 2 = 72.63. Total **13516.83 mm3**; the box stays `[-30, -20, 0]` to `[30, 20, 25]`.

<a id="parameters"></a>
### Parameters

| Call | What it does |
|---|---|
| `JS3D.setParam(name, expr, { unit })` → value | Adds the parameter, or changes it when the name exists (any capitals). `expr` is text such as `"40"`, `"w / 2"` or `"1in"`; `unit` is `"mm"` or `"in"` (what a bare number is read in). Returns the value in mm. Like the sidebar, an edit sets the unit afresh: leave `unit` out and the parameter is in mm, even if it was made in inches. Sizes whose new value is out of range (below 0.01 mm, for example) keep their last number, as in the app. A bad name throws the app's own message (for example `"d1" is a dimension name.`); an expression that does not give a number throws `expression did not evaluate` and nothing changes, not even the undo history. |
| `JS3D.removeParam(name)` → count | Deletes it. Sizes that used its name keep their value and lose the expression; the count is how many were freed. |
| `JS3D.bind(id, key, expr)` → size | Ties a plain shape's size (`key` is `"w"`, `"d"`, `"h"`...) to an expression, or frees it with `null`. Returns the size in mm after binding. |

<a id="history-selection-and-view"></a>
### History, selection and view

| Call | What it does |
|---|---|
| `JS3D.undo()` / `JS3D.redo()` → label or `null` | One step. Refused in Chisel mode. |
| `JS3D.select(ids)` | Selects bodies (`[]` clears). |
| `JS3D.fit()` | Frames the selection, or everything when nothing is selected. |
| `JS3D.setMode("beginner" \| "advanced" \| "arch")` | Switches the mode. `"arch"` is Architect; the building is kept in the design (`doc.arch`) and the other modes keep their shapes, but the bridge has no calls for walls and openings yet. Since 2.4, leaving Architect for Beginner or Advanced also brings a drawn house along as shapes in the design (scaled down to fit the 256 mm build plate) and sends the camera back to the home view, so the body list can hold shapes you did not add. `"chisel"` is refused here. |
| `await JS3D.screenshot(opts)` → `Uint8Array` | A PNG of the 3D view, after waiting for `ready`. `opts.fit: true` frames everything shown first (ignoring the selection). `opts.width` (1 to 8192) makes the picture that many pixels wide with the same shape, drawn in the same step as the render; without it the picture is the size of the 3D view. |
| `await JS3D.screenshotDataURL(opts)` → string | The same (`fit` and `width` too) as a `data:image/png;base64,...` string (also async). In a background tab the browser runs no animation frames; the camera move for `fit` is then jumped to its end. |

<a id="checkpoints"></a>
### Checkpoints

`JS3D.checkpoint(label?)` saves the whole document in page memory and returns
`{id, label, bodies, at}`: a `c1`, `c2`, ... id, label (default empty), body count,
and ISO time. `JS3D.checkpoints()` lists this metadata. Only the latest 20 are
kept; checkpoints live in page memory only, so a reload loses them. Labels are
at most 200 characters. Checkpoint is refused in Chisel mode (`leave Chisel mode
first`) like other calls. Returned metadata cannot edit a snapshot.

`JS3D.diff(fromId, toId?)` returns readable lines comparing a checkpoint to now,
or to another checkpoint of the same design: bodies, features and their types, sketches, parameter
expressions, translation deltas in mm, colors, holes and visibility, and
added, removed or changed assets and media by id. Large other parts of the
document only say `Design <key> changed`. Output is at most 200 lines and 20 KB,
values are cut at 200 characters, and a long diff ends `...and N more changes`.
Identical designs return `No changes.`.

`JS3D.rollback(id)` restores the complete document as one undo step and returns
the checkpoint metadata. It is synchronous; call `ready()` before inspecting
geometry. Undo restores the newer state. Rollback keeps the current mode, is refused in the
3D Print Sim (`undo is off in the 3D Print Sim`), and overwrites a newer copy of
the design that was reloaded from another tab (undo in this tab brings it back).
The usual edit guards apply, including
`leave Chisel mode first`. A checkpoint from another design cannot be restored;
its metadata remains listed until eviction. Missing ids report the retained ids.
Checkpoint before risky edits, inspect the diff, and roll back on failure.

<a id="files"></a>
### Files

| Call | What it does |
|---|---|
| `await JS3D.export(kind, opts)` → `Uint8Array` | `kind` is `"stl"`, `"obj"`, `"3mf"`, `"glb"`, `"step"` or `"json"` (`"glb"` is binary glTF 2.0: one mesh and one base colour per body, in metres with Y up, the units stated in `asset.extras`). Waits for `ready` first. By default it exports every shown solid, like the Export menu with nothing selected; `opts.ids` names the bodies instead. STL, OBJ, 3MF and GLB bytes are identical to the menu's download; STEP bytes differ in the time stamp and an export counter inside the file (the tests blank both before comparing). Holes and hidden bodies are left out, also when named in `opts.ids`. It throws when there is nothing to export, and when a body has a build error (the menu would export its last good shape). `"json"` is `JSON.stringify(save(), null, 1)` as UTF-8 and ignores `ids`. |
| `await JS3D.load(json, { keepId })` | Opens a project (each `load` and `newDesign` adds an entry to "Your designs" in this browser, because the app saves the design it opens): `json` is the file's text, the parsed object, or a bare `doc`. It replaces the open design the way opening a project file does (new design id unless `keepId`, undo history cleared, saved in this browser), then waits for `ready`. A file that is not a project throws `not a JumpStart 3D project`. A body that would break the 3D view (no `id`, no `node`, no 16-number `m`) throws the same message with the reason. Nothing is changed when it throws. |
| `await JS3D.newDesign(mode)` | Starts an empty design (and adds an entry to "Your designs"), `"beginner"` (default) or `"advanced"` (not `"arch"`: switch with `setMode` afterwards). |

Bridge STL and 3MF exports follow the Export menu's quality setting, saved in localStorage as `jumpstart.exportQuality` and defaulting to Fine. They can therefore take longer: a very detailed design at Fine can take a couple of minutes. The app may show its "Making a smooth mesh…" toast, and falls back to the view mesh after 240 seconds. The MCP server's browser starts with a fresh profile, so it exports at Fine. OBJ, GLB and STEP exports are unchanged.

Example, the whole loop:

```js
const box  = JS3D.add("box", { size: [40, 30, 20] });
const hole = JS3D.add("cylinder", { size: [8, 8, 30], at: [0, 0, -5], hole: true });
const part = JS3D.group([box, hole], { name: "Block with hole" });
await JS3D.ready();
JS3D.get(part).volume;                       // 22994.69...
const stl  = await JS3D.export("stl");       // Uint8Array, 84 bytes + 50 per triangle
const file = await JS3D.export("json");      // the project file, as bytes
await JS3D.load(new TextDecoder().decode(file));
```

To save an export from the console, wrap the bytes in a download:
`const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([stl])), download: "part.stl" }); a.click();`

<a id="generators-box-maker-gear-sets-hardware-textures-and-drawings"></a>
### Generators: Box Maker, gear sets, hardware, textures and drawings

All lengths are mm, angles degrees. Omitted or null settings use defaults. `at` is three finite numbers, default `[0,0,0]`; `name` is trimmed. Each edit is one undo step and leaves the selection alone. Validation happens before the edit, so a refused call adds nothing. Call `await JS3D.ready()` before reading built sizes.

| Call and return | Options, defaults and errors | Undo label |
|---|---|---|
| `JS3D.boxMaker(opts = {})` → `{id, parts, cell, info}`; each part is `{id, name, kind}` | `style`: bin (default), drawer, tilt, door. `w` 10–1000 (120), `d` 10–1000 (80), `h` 5–1000 (40); for drawer, tilt and door cases the minima are 30, 30 and 20 mm respectively; `units`, `across` integers 1–8 (1). `cols` 1–20 for bin/door, 1–12 drawer, 1–8 tilt (3); `rows` 1–20 except drawer 1–12 (2). `shape`: square (default), round, hex. `wall`, `divider`, `floor` 0.4–20 (1.6, 1.2, 1.2); `radius` 0–100 (4), `inner` 0–50 (2); `scoop` true, `scoopR` 1–100 (10), `label` false, `labelW` 2–100 (10); `stack` false, `foot` 1–50 (3), `lid` false; `clear` 0–2 (0.25), `caseT` 1.2–20 (2.4). `lock`, `sideLock`: dovetail (default), pegs, none; `pull`: bar (default), knob, notch; `hinge`: left (default), right; `doorPull`: knob (default), hole, bar; `doorCatch`: none, light (default), firm. `layout`: assembled (default), print. Also `at`, `name`. Range, choice and flag errors follow the exact forms below. Too-small cells throw the library's `The compartments are too small: ...` message unchanged. | `Bin` |
| `JS3D.gearSet(opts = {})` → `{id, parts, info}`; each part is `{id, name}` | `type`: pair (default), rack, ring, planet, bevel, helical. `module` 0.3–10 (2), `width` 0.5–200 (8 for library types; bevel/helical use `JS3D.gear` defaults), `bore` 0 for none; `at`. Library types: `teeth` integer 6–300 (20), `teeth2` integer 6–400 (40); planet uses `sunTeeth`, `planetTeeth` integers 8–200 (18,12), `planets` integer 2–6 (3). `backlash` 0–1 (0.15), `pressureAngle` 14.5,20,25 (20), `boreShape` round (default), d, hex, key; `joints` true. Rack alone: `rackLength` 0–2000 (0 gives max(8,teeth) teeth), `rackHeight` 2–100 (8). Pair/ring take teeth and teeth2; rack takes teeth; planet takes its three planet settings. Bevel/helical take teeth and teeth2 (default 20 and the same as teeth), `clear` as `JS3D.gear`; helical also takes `angle` 5–30 (20), `hand` right (default) or left; the second gets the opposite hand. Errors: `<k> is not used for type "<type>"`; `pressureAngle must be 14.5, 20 or 25 (degrees)`; `a ring gear needs at least 8 more teeth than its pinion (teeth2 at least teeth + 8)`; `bore must be 0 (none) or from 0.5 to <max> mm for these gears` or `bore must be 0 (none): these gears are too small for a bore`. Here max is the smaller of module × (smallest relevant tooth count − 4.5) and 1.6 times its root radius, rounded down to 0.1 mm; planetary sets also limit the bore to half the planet root diameter. Planet sets require sun + ring teeth divisible by the planet count and more than 0.5 mm clearance between adjacent planet tips. Bevel/helical: `<teeth or teeth2> must be a whole number from 12 to 90 for a bevel gear` or `... from 12 to 30 for a helical gear`; all other `JS3D.gear` errors above pass through unchanged. | `Gears`, `Bevel gear pair`, `Helical gear pair` |
| `JS3D.hardware(opts = {})` → id | Required `part`: hexbolt, shcs, button, flat, set, wood, rod, nut, nyloc, sqnut, washer, lockw, insert, dowel; required `size` from that part's metric or inch list (`M3`, `1/4-20`; the latter is stored as `1/4"-20`). `length` 1–300, default the library's roughly three diameters, only for screws/rods/dowels. `threads` false, `clear` −1–0 (design's thread offset), `left` false; `at`, `name`. The lowest point rests on at's z. Errors: `part must be one of: <ids joined by comma and space>`; `unknown size "<size>" for part "<part>"; sizes: <available sizes>`; `length is not used for part "<part>"`; `length must be a number from 1 to 300 (mm)`; `part "<part>" has no thread`; `threads must be true or false`; `left must be true or false`; `clear must be a number from -1 to 0 (mm)`; `Too many turns (<n>; the most is 150). Make it shorter or pick a larger size.` | `Add fastener` |
| `JS3D.textures()` → `[{key, name, category, size}]` | Lists every built-in texture and its default tile size. No options or edits. | none |
| `await JS3D.texture(id, opts = {})` → `{body, texture, faces}` | `texture` key (knurl); `faces` "all" (default), a non-empty selector such as "top", an index ≥0, or a non-empty list of selectors/indices. `size` 0.5–100 (texture's size, otherwise 4), `depth` 0.05–3 (0.6), `dir`: raise (default), engrave, both; `rotation` −180–180 (0), `mapping`: auto (default), planar, cylindrical, triplanar; `edgeBlend` 0–10 (0), `invert`, `once` false. Returns faces "all" or the number chosen; texture is the new layer id. Errors: `unknown texture "<key>"; list_textures (JS3D.textures()) gives the <count> keys`; `faces must be "all", a face selector such as "top", a face index or a list of indices`; `<name> is marked as a hole; textures go on solid bodies`; `<name> has a build error: <msg>`; `<name> could not be built`; `faces <JSON selector> matches no face of <name>`. Selector errors pass through from `JS3D.faces`. | `Texture` |
| `await JS3D.drawing(opts = {})` → DXF `Uint8Array` | `ids` limits bodies (one id or a list); holes and hidden bodies are omitted. `views` is a non-empty list of distinct top/front/right, default all three, always drawn in that order; Top above Front, Right beside it. `scale` 0.01–100 (1 full size), `units` mm (default) or in; `dims` false adds overall size lines when true. Errors: `views must be a list of "top", "front" and "right"`; `scale must be a number from 0.01 to 100 (1 is full size)`; `units must be "mm" or "in"`; `dims must be true or false`; `nothing to draw: holes and hidden shapes are left out`; `"<name>" has a build error (<msg>); fix it before drawing`; `could not draw: <names joined by comma and space>`; `Drawings need CAD bodies: <names> came from a mesh (STL/3MF/OBJ). Leave them out of the selection, or use Mesh to STEP first.`; `Nothing to draw.`; `Cancelled.`. Geometry-engine errors pass through unchanged. | none |

Unknown options throw `unknown option "<k>"; options: <keys joined by comma and space>`. The option order is: boxMaker `style, w, d, h, units, across, cols, rows, shape, wall, divider, floor, radius, inner, scoop, scoopR, label, labelW, stack, foot, lid, clear, lock, sideLock, caseT, pull, hinge, doorPull, doorCatch, layout, at, name`; gearSet `type, module, teeth, teeth2, sunTeeth, planetTeeth, planets, width, bore, boreShape, backlash, pressureAngle, rackLength, rackHeight, joints, clear, angle, hand, at`; hardware `part, size, length, threads, clear, left, at, name`; texture `texture, faces, size, depth, dir, rotation, mapping, edgeBlend, invert, once`; drawing `ids, views, scale, units, dims`.

For the ranges in the table the exact numeric error is `<key> must be a number from <min> to <max> (mm)`; rotation uses `(degrees)`. Counts use `<key> must be a whole number from <min> to <max>`. Flags use `<key> must be true or false`. Choices use `<key> must be "first", "second" or "last"` in the order listed (two choices have only `or`); for example `style must be "bin", "drawer", "tilt" or "door"`. Positions use `at must be [x, y, z] in mm`. Missing bodies use `no body <id>`. The existing mode and body-id checks still apply.

The saved parts use the dialog's own structures: double-click to edit Box Maker or hardware parts; library gear sets open in the Gears dialog. Bevel and helical pairs use the existing sketch/Loft builder; change their tooth settings by undoing and calling again. Textures change only the mesh: STL, 3MF, OBJ and GLB include them; STEP and measured solid volumes do not. A textured design cannot go in a share link yet. Chosen texture faces use 9.1's selectors, resolved once into body-local face signatures; indices are valid until the next edit.

```js
const drawers = JS3D.boxMaker({ style: "drawer" });
const rack = JS3D.gearSet({ type: "rack", at: [160, 0, 0] });
const screw = JS3D.hardware({ part: "shcs", size: "M3", length: 10 });
const box = JS3D.add("box", { size: [40, 30, 20] });
await JS3D.texture(box, { texture: "knurl", faces: "top" });
const dxf = await JS3D.drawing({ views: ["top"] });
```

This adds no `code_cad` MCP tool (`run_script` can reach `JS3D.codeCad`), set-update call, Quick Hinge call, picture texture, texture-removal call or `export("dxf")`. Undo and call again, or use the dialogs, to change sets; hubs and lightening holes stay off in calls and can be added in the Gears dialog. Use `rotate_bodies` to turn sets. The tap cutter stays in `JS3D.fastener`; `hardware` is separate. Texture share links and textured STEP are outside this change.

<a id="scripts-and-the-link-to-a-tool-server"></a>
### Scripts, and the link to a tool server

| Call | What it does |
|---|---|
| `await JS3D.run(text)` → value | Runs script text with `JS3D` and `app` in scope and returns what the script returns: the last statement's value of a plain script (a promise is awaited), or the `return` value of a script with top-level `await`. It is what Open/Export › Run script… uses. Same trust as the console. |
| `JS3D.connect(url = "ws://127.0.0.1:8822")` | Opens a WebSocket to a tool server on this computer (`mcp/server.mjs`, see `mcp/README.md`), answers its calls and retries every 3 seconds while on. Throws if `url` is not `ws://` or `wss://`. |
| `JS3D.disconnect()` | Closes the link and stops retrying. |
| `JS3D.connection()` → `{ on, url, state }` | `state` is `"off"`, `"waiting"` (on, no server yet) or `"connected"`. |
| `await JS3D.invoke(call, args)` | Plumbing: runs `JS3D[call](...args)` and returns the result, with a `Uint8Array` as `{"$bytes": base64}`. Refuses `internals`, itself and anything that is not a call. The WebSocket link and the server's headless browser both go through it. |

Nothing connects unless asked: the page makes no connection until `connect` is called or the **Connect to AI agent** row in the theme menu (◐) is turned on. That row is remembered in this browser (`jumpstart.agent`, "on" or "off", off by default) and connects to the default address when the page loads. There is no web address parameter.

<a id="the-whole-loop-for-an-agent"></a>
### The whole loop for an agent

Call these MCP tools in order (use the id returned by `add_shape` as `id`):

1. `new_design`: `{"mode":"advanced"}`; then `add_shape`: `{"kind":"box","size":[60,40,25],"at":[0,0,0]}`.
2. `shell_body`: `{"id":id,"th":2,"open":"top"}`; then `fillet_edges`: `{"id":id,"edges":"edges of top and (>x or <x or >y or <y)","r":1}`.
3. `add_holes`: `{"id":id,"face":"bottom","points":[[-22,-12,0],[22,-12,0],[-22,12,0],[22,12,0]],"size":"M3"}`. Leaving depth out makes the holes through.
4. `inspect_bodies` with `{"material":"pla"}` should report bounds [-30,-20,0] to [30,20,25], volume about 13516.83 mm³ and weight about 16.76 g at 100% infill. `check_print` should have no problems (review any warnings); `check_collisions` should have no pairs. `section_view` with `{"axis":"z","at":10}` should report about 384 mm².
5. `export_file` with `{"kind":"stl","path":"/path/to/enclosure.stl"}` writes the result.

Check each tool result for an error before continuing. The headless end-to-end test is `mcp/test/proof.test.mjs`.

## WebSocket

The link, in text frames of JSON: the page sends `{"hello":"jumpstart-3d","version":"1.13","apiVersion":"1.13.0","app":"2.0","url":<page address>}` once it is open. The server sends `{"id":1,"call":"add","args":["box",{"size":[40,30,20]}]}`; the page answers `{"id":1,"result":...}` or `{"id":1,"error":"message"}`. Calls run one at a time, in the order they arrive. A `Uint8Array` result is `{"$bytes": base64}`. The server accepts one page at a time: a second page that says hello is closed with code 4001, and the page then switches its link off and does not retry (the remembered setting stays on). Recent Chrome and Edge ask before the website may reach a program on this computer ("local network access"); allow it. The single file is not asked.


The apiVersion hello field is optional for older consumers. No negotiation is required.

## Embedding

PR A exposes no postMessage control. An iframe isolation/consent protocol is planned separately; no hosted framing support or deployed headers have been verified. Direct scripting and the WebSocket bridge retain their existing trust model.

## Limitations

<a id="what-the-bridge-does-not-do"></a>
### What the bridge does not do

- It does not check wall thickness or slice; `printCheck` is a quick check, not a slicer.
- It builds Beginner shapes (the 20 kinds), groups, scale and parameters, and the Advanced calls above (sketches, extrude, revolve,
  fillet, chamfer, shell, holes, patterns). Sweeps, lofts, mirrors, split, emboss, threads, construction planes and sketch
  constraints other than the ones the shapes make have no call yet: write or generate a project file (Part 2) and `load` it, or use `run`.
  The fillet and shell selections are stored the way the app stores them, not as selector text.
- It does not push, publish or save anything outside this browser. `load`
  does save the opened design in this browser's storage, as opening a file does.


## API changelog

### 1.13.0 — discovery and contract

Adds apiVersion, supports and describe, frozen schemas, complete reference anchors and runtime/docs gates. Keeps two-component version, delete alias, plain errors and WebSocket behavior; optional apiVersion in hello. No deprecations. Prior additions: 1.9 Advanced CAD, 1.10 inspection, 1.11 generators, 1.12 page-memory checkpoints. Plugin 0.2.18. Migration: `if (JS3D.supports("sketch")) { const contract = JS3D.describe(); }`. Future API-affecting PRs must add version, additions/changes/deprecations and a migration example when needed, newest first here, independently of the session CHANGELOG.

Checkpoint reconciliation: the supplied 9.5 design anticipated cross-design diff; the integrated 9.4a implementation refuses it (and rollback). This reference follows the implemented behavior.

### Historical notes — superseded statements

Earlier async list (superseded; omitted async generator and inspection calls):

- Everything is synchronous except `ready`, `export`, `screenshot`,
  `screenshotDataURL`, `load`, `newDesign`, `run`, `invoke`, `sketch`, `extrude`, `revolve`, `fillet`, `chamfer`, `shell`, `hole`, `faces` and `edges`, which return promises.

Earlier version table row (superseded by SemVer policy):

| `JS3D.version` | `"1.11"`. The last number goes up when calls are added; the first changes when a call changes shape. |

Original WebSocket paragraph (superseded hello example):

The link, in text frames of JSON: the page sends `{"hello":"jumpstart-3d","version":"1.11","app":"2.0","url":<page address>}` once it is open. The server sends `{"id":1,"call":"add","args":["box",{"size":[40,30,20]}]}`; the page answers `{"id":1,"result":...}` or `{"id":1,"error":"message"}`. Calls run one at a time, in the order they arrive. A `Uint8Array` result is `{"$bytes": base64}`. The server accepts one page at a time: a second page that says hello is closed with code 4001, and the page then switches its link off and does not retry (the remembered setting stays on). Recent Chrome and Edge ask before the website may reach a program on this computer ("local network access"); allow it. The single file is not asked.



Earlier WebSocket hello example (existing fields retained; optional apiVersion added):

`{"hello":"jumpstart-3d","version":"1.11","app":"2.0","url":<page address>}`

## Part 2: The project file format

A project is one JSON document. This part was written by looking at real files:
the 38 designs in `test/projects/`, designs built with `JS3D` and saved with
`JS3D.save()`, and what the app does with each file after `JS3D.load` and a
save. Each table says what was seen; **not checked** marks what was not.

### The file

```json
{ "app": "jumpstart-3d", "version": 1, "doc": { ... } }
```

The Export menu and `JS3D.save()` write this envelope (the menu indents with one
space). Opening a file accepts either the envelope or the bare `doc`: the app
reads `file.doc` if there is one, else the whole file. All 38 designs in
`test/projects/` are bare docs. `version` is always 1 in what the app writes;
nothing reads it (not checked beyond the code that writes and opens files).

To be opened, the `doc` must have a `bodies` array and a `sketches` array
(`[]` is fine). Anything else missing is filled in.

### The design (`doc`)

| Key | Meaning |
|---|---|
| `v` | Always `1`. |
| `id` | The design's id (a string). Opening a file gives it a new one (`load` keeps it with `keepId`). |
| `name` | Title. `"Untitled"` when missing. |
| `mode` | `"beginner"`, `"advanced"` or `"chisel"`; the mode the design opens in. When missing, a design with sketches or with `extrude`, `revolve`, `fillet`, `chamfer`, `hole`, `shell` or `bool` in it counts as `"advanced"` and anything else `"beginner"`. |
| `created` | Milliseconds since 1970. |
| `seq` | A counter. Each new body, sketch or feature takes the next number as its `seq`. |
| `grid` | `1`. |
| `bodies` | The shapes, see below. |
| `sketches` | Sketches, see below. `[]` for a Beginner design. |
| `planes`, `joints` | Construction planes and joints. `[]` in every test design. Their fields: **not checked**. |
| `params` | Named parameters `[{ id, name, expr, value }]` and `unit: "in"` when typed in inches. `id` is any unique string (the app makes `q…`); `value` is the cached result in mm (the app recomputes it on load). Parameters are evaluated top to bottom: each sees only the ones above it. Added as `[]` when missing. |
| `ver` | Optional. The Save button's version counter. |
| `assets` | Optional. Imported files: `{ "<id>": { kind: "step", name, data } }`, `data` being the file in base64. A `mesh` or `step` node points at one. Seen for one STEP design; the STL form: **not checked**. |
| `texImages` | Optional, texture pictures. **Not checked.** |

Loading a file and saving it again changed only three things across all 31
test designs: `params: []` was added where missing, sketch dimensions without a
`name` were given `d1`, `d2`..., and a `_key` was added to each body (next
section). Nothing else moved.

### A body (`doc.bodies[]`)

| Key | Meaning |
|---|---|
| `id` | String, unique in the design. **Required.** |
| `node` | What the body is, see below. **Required.** |
| `m` | 16 numbers, three.js column-major, the body's place: `[r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, x, y, z, 1]`. Translation is entries 12, 13, 14; the identity is `[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]`. **Required** (a body without one makes the 3D view throw; `JS3D.load` refuses it). A turn of 30° about z gives `[0.866, 0.5, 0, 0, -0.5, 0.866, 0, 0, 0, 0, 1, 0, x, y, z, 1]`. |
| `name` | Shown in lists. Optional (a body with none loads). |
| `color` | `"#rrggbb"`. When missing the body is grey (`#a7b0ba`). |
| `hole` | `true`: it cuts instead of adding (inside a group, and it is never exported on its own). |
| `hidden` | `true`: not drawn, not exported. |
| `seq` | Creation order, see `doc.seq`. Optional. |
| `locked` | Optional, `true` makes the mouse tools leave it alone. |
| `brick` | Optional, `{ layer, size }` on a body made with the brick tool (seen: `{"layer":0,"size":"2x2"}`). |
| `appearance`, `textures`, `sculpt` | Optional looks and Chisel data. **Not checked.** |
| `_key` | **Not part of the design.** The app caches the kernel's name for the built shape here (it is the body's `node` as text). Files from the Export menu contain it, which makes them larger; it can be deleted. `JS3D.save()` and `JS3D.doc()` leave it out. |

A hand-written minimal body, as the test helpers write them (`test/helpers.mjs`
`body()` and `prim()`):

```json
{ "id": "b1", "name": "Box", "seq": 1, "color": "#3b82c4", "hole": false, "hidden": false,
  "m": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  "node": { "t": "prim", "kind": "box", "p": { "w": 20, "d": 20, "h": 20, "r": 0, "c": 0 }, "mods": [] } }
```

Seen to work (loaded, built, volume right): leaving out `name`, `color`,
`hole`, `hidden`, `seq`, `mods`, and the `r`, `c` of a box or cylinder. Seen to
break or be wrong: no `m` (the view throws), no `node` (throws), a node
without `p` (builds a zero-size shape, no error), an unknown shape `kind` (the
body shows the error `Unknown shape: teapot`; nothing else is affected), and
an `m` shorter than 16 (loads, but it is not a valid place).

A minimal whole file:

```json
{ "bodies": [ { "id": "b1", "m": [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
                "node": { "t": "prim", "kind": "box", "p": { "w": 20, "d": 20, "h": 20 } } } ],
  "sketches": [] }
```

(Loaded as Beginner, called `Untitled`, a 20 mm cube. Seen with the loader's
fill-ins: `v`, `id`, `name`, `mode`, `created`, `seq`, `grid`, `planes`, `joints`
and `params` all appear after loading.)

### A node (`body.node`, and a group child's `node`)

Every node has `t`, its type, and `mods`, the list of features applied to it
in order (an empty list, or absent, for none). Types seen in the test designs:

| `t` | Fields | Notes |
|---|---|---|
| `prim` | `kind`, `p`, `mods`, optional `exprs`, `exprUnits` | A Beginner shape. `kind` is one of the 20 in `JS3D.kinds()` (the test designs use `box`, `cylinder`, `sphere`, `cone`, `text`). `p` holds the sizes; the keys for each kind are the `defaults` that `kinds()` returns (`w`, `d`, `h` plus extras such as `r`, `c` for a box's corner round and chamfer, `top` for a cone, `sides` for a pyramid or prism, `wall` for a tube, `tube` for a torus, `turns`, `wire` for a spring; `text` uses `text`, `size`, `h`, `font`). The shape is built upward from z = 0, centred on x and y. A torus keeps `d` equal to `w`. `exprs` ties a size to an expression: `{ "w": "w", "h": "w2 + 1" }` (the value in `p` is then recomputed from the parameters). `exprUnits` is `{ "w": "in" }` for a bare number typed in inches. |
| `group` | `children: [{ node, m, hole, name, color }]`, `mods`, optional `op` | A combination. Each child is a node with its own matrix `m` and `hole` flag; the group's `m` on the body is usually the identity. Solids are joined and holes cut out. `op: "intersect"` keeps what the children share. (The `JS3D.group` option `"cut"` makes the first child a solid and the others holes; it is saved as exactly that.) |
| `extrude` | `sketch`, `profiles`, `dist`, `mode`, `dist2`, `mods`, optional `exprs` | `sketch` is a sketch id. `profiles` lists the closed regions of that sketch to extrude: `{ key, pt }`, where `key` is the region's entity ids sorted and joined with commas (`"e0,e1,e2,e3"`) and `pt` is a point `[x, y]` inside it in sketch coordinates. One test design uses hand-made keys (`"lens"`, `"rect-only"`); how a key that matches no region is handled: **not checked**. `mode` is `"one"` (distance `dist` along the sketch normal, the default), `"sym"` (`dist` split both ways) or `"two"` (`dist` one way and `dist2` the other), from `kernel.js`. |
| `revolve` | `sketch`, `profiles`, `axis`, `angle`, `mods` | `axis` is `"X"`, `"Y"`, `"Z"` (world axes; the ones seen) or the id of a line in the sketch (from `store.js` resolveNode). `angle` in degrees (360 seen). |
| `sweep` | `sketch`, `profiles`, `path: { sketch, ents }`, `orient`, `dist`, `taper`, `twist`, `chain`, `mods` | One design. `path.ents` are entity ids in the path sketch. Meanings of `orient`, `taper`, `twist`, `chain`: **not checked** (seen `"perp"`, 0, 0, true). |
| `loft` | `sections: [{ sketch, ref: {key, pt} }]`, `rail`, `ruled`, `closed`, `mods` | One design. **Other fields not checked.** |
| `pipe` | `section`, `size`, `edgeSegs` or `path`, `hollow`, `wall`, `mods` | A tube along a path. **Not checked beyond the one design.** |
| `coil` | `d`, `turns`, `mode`, `h`, `pitch`, `angle`, `section`, `size`, `pos`, `left`, `mods` | One design (`mode: "height"`). **Not checked beyond that.** |
| `mirror` | `srcBody`, `plane: { o, n }`, `mods` | A live mirror of another body, by id. |
| `mesh`, `step` | `asset`, `k`, `mods` | An imported STL or STEP. `asset` is a key of `doc.assets`. |

### Features (`node.mods[]`)

Each is `{ id, seq, t, ... }`: `id` (a string, unique in the body; the app
makes `f…`) and `seq`. `t` is the type. What was seen in the test designs:

| `t` | Fields seen |
|---|---|
| `fillet` | `r` (radius, mm), `edges: [{ a, b, m, n, t }]` (each edge is described by its end points, middle point, a normal-like vector and a curve type such as `"LINE"`, in the body's own coordinates, and is matched against the shape's edges by position; when none match the body shows the error `Fillet: its edges no longer exist`), optional `exprs`. The kernel also reads `sets` when present (a list of `{ edges, r, ... }`). |
| `chamfer` | `d`, `edges` (as for fillet). |
| `hole` | `kind` (`"simple"`, `"csink"` seen), `dia`, `through`, `depth`, `tapped`, `pitch`, `clear`, `tip`, `at: [{ p, n }]` (point and direction for each hole, in the body's coordinates), and for `csink` also `cbDia`, `cbDepth`, `csDia`, `csAngle`. Optional `exprs`. |
| `shell` | `th` (wall thickness), `faces` (faces to open, `[{ c: [x, y, z] }]`, a point on each). Optional `exprs`. |
| `emboss` | `str`, `size`, `font`, `depth`, `mode` (`"emboss"` seen; the kernel also reads `"deboss"`), `kind` (`"plane"` seen), `p`, `n`. |
| `thread` | `face: { c, t: "CYLINDRE" }`, `pitch`, `length`, `flip`, `left`, `clear`. |
| `bool` | `op` (`"cut"` seen; the kernel also reads `"intersect"`, and anything else means join), `tool` (a node), `m` (the tool's matrix). |
| `scale` | `k: [kx, ky, kz]`, `o: [ox, oy, oz]`: a stretch of the body in its own frame, `x' = k·x + o`. The kernel stretches most shapes exactly; for the ones it cannot restretch (a torus, text or spring stretched unevenly, for example) it falls back to a faceted copy. |
| `pattern` | Documented in `test/README.md` (rectangular and circular, `what: "feats"` or `"shape"`, `feats` the ids of earlier mods repeated). Seen in `advanced-pattern-mod.json`. |
| `offset`, `halfspace` (Split with a plane), `sketchsplit` (Split with a sketch) | The kernel reads them (`kernel.js`), but no test design has one. **Not checked.** |

Features that ask for a value can carry `exprs` (and `exprUnits`) as for a
shape's `p`: `{ "exprs": { "dist": "t" } }` on an extrude or revolve (keys
`dist`, `dist2`, `angle`), `r`, `d`, `dia`, `depth`, `th` on the others, and
`n1`, `s1`, `n2`, `s2`, `cn`, `angle` on a pattern. The stored number is
recomputed from the parameters on every load and edit; a binding that gives
an unusable number is skipped and the stored number stays.

### Sketches (`doc.sketches[]`)

| Key | Meaning |
|---|---|
| `id`, `name`, `seq` | As for bodies. |
| `plane` | `{ o: [x,y,z], x: [..], n: [..] }`: origin, the sketch's x direction and its normal, in world coordinates. The sketch's y direction is `n × x`: with `n = [0,0,1]` and `x = [1,0,0]` the sketch lies on the floor; with `n = [0,-1,0]` it stands up in the x–z plane with y pointing up. |
| `pts` | `[{ id, x, y }]` points in sketch coordinates (mm). |
| `ents` | Shapes drawn on the points: `{ id, t: "line", a, b }`, `{ id, t: "circle", c, r }` `{ id, t: "arc", c, a, b }` (counter-clockwise from `a` to `b`) and `{ id, t: "point", p }` (`a`, `b`, `c`, `p` are point ids; a circle's `r` is a number). `cons: true` on an entity makes it construction (a guide: left out of the profiles). Other entity types (splines, text, ...): **not checked**. |
| `cons` | Optional constraints: `{ id, t: "origin", p }`, `fixed`, `horizontal` and `vertical` (`{ e1 }` or `{ p1, p2 }`), `parallel`, `perpendicular` and `equal` (`{ e1, e2 }`), `coincident` and `midpoint` (`{ p, e }`), `tangent` (`{ e1, e2 }`), and a dimension `{ id, t: "dim", k, ..., v, off, expr }` with `k` `"dist"` (`p1`, `p2`, `o` `"h"`, `"v"` or `"a"`), `"pl"`, `"ll"` (`e1`, `e2`), `"dia"`, `"rad"` (`e1`) or `"ang"`. `v` is the value in mm; `expr` is optional text using parameters, and `name` (`d1`, `d2`... added when missing) lets other expressions use the dimension. `JS3D.sketch` writes the kinds above. Anything else in the file, and how the solver reads `o`, `off`: **not checked**. |
| `hidden` | `true` hides the sketch lines. |

A sketch ties to a body only through the `sketch` id in an extrude, revolve,
sweep or loft node. Deleting a body (`JS3D.remove`) also deletes the sketches
that only it used.

### What to remember when writing a file by hand

- Required: `bodies` and `sketches` arrays on the doc; `id`, `node` and a
  16-number `m` on each body; for a `prim`, `kind` and `p` with `w`, `d`, `h`.
- Give every body and every feature its own `id`; the extrude's `sketch` and a
  group child's references use ids.
- Sizes are mm, angles degrees, the up direction is +z.
- Check the result with `await JS3D.load(json)` then `JS3D.list()`: a body that
  the geometry engine rejects shows its message in `error`.
