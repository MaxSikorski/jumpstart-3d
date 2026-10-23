# JumpStart 3D: press fact sheet

For journalists, YouTubers and bloggers. Every fact here comes from the repository and the
latest release (v2.3 community build 22, 23 October 2026). Last checked 23 October 2026.

## What it is

JumpStart 3D is a free 3D CAD program that runs in a web browser. There is nothing to install and
no account to make. You can drag simple shapes together in Beginner mode, or sketch, extrude,
fillet and shell real solids in Advanced mode. It sits somewhere between Tinkercad and a full CAD
program. Designs can be exported for 3D printing and for CNC machines.

## Credit

JumpStart 3D was created by **J.Siwek**, who publishes it under the MIT License. Please credit him
first.

- Official site: https://classyapps.org/ (his own downloads)
- Source repository: https://github.com/classyapps2026/jumpstart3d
- His video introducing version 2.0: https://youtu.be/OmoVmYzoIsk

This repository is a **community fork** maintained by **Max Sikorski** with the JumpStart 3D
community. When the original download went offline in October 2026, the fork put the app back
online. It follows each new version of J.Siwek's release and adds its own features, listed below.

## Key facts

- **Price:** free. No account needed. Optional support goes to the maintainer's hosting (see the README).
- **Licence:** MIT, for both J.Siwek's code and the community additions.
- **Runs in:** any current browser on Mac, Windows, Linux, Chromebook, iPad and iPhone.
- **Offline:** after the first visit the website keeps a copy and works without internet. The
  single file needs no internet at all.
- **Download size:** the single file `jumpstart-3d.html` is about 16 MB (15.9 MB in build 22).
  Double-click it to open.
- **Modes:**
  - **Beginner:** drag shapes, group them and cut holes on a 256 × 256 mm build plate.
  - **Advanced:** sketches, extrude, revolve, loft, sweep, fillet, chamfer, shell, patterns and a
    feature timeline, using the OpenCascade CAD kernel.
  - **Chisel:** clay-style sculpting with a puppet animator.
  - **Architechies** (new in 2.2): floor plans, walls, doors, windows and roofs, sent to Beginner
    or Advanced as editable shapes.
  - **CAM Studio** (new in 2.3): plan and simulate CNC router, mill or laser cuts, and save G-code.
- **Export formats:** STL, 3MF, STEP and DXF. Chisel also exports OBJ. glTF (.glb) and OBJ export
  are in the community build.
- **Import formats:** OBJ import in Beginner and Advanced. Mesh to STEP turns STL or 3MF meshes into
  editable solids.
- **AI support:**
  - A built-in chat (the **AI** button) works with a local model (Ollama, LM Studio) or a hosted
    one (OpenAI-style services, Anthropic). The model edits the open design through the same
    tools as the agent server, and every step shows in the chat.
  - An MCP server lets agents such as Claude Code, Codex and Gemini CLI build and edit designs,
    with 38 tools.
  - A Claude Code plugin is included in the repository.

## What's new in the community build

- **Named parameters:** type `w` or `w/2` instead of a number, and everything follows when it
  changes.
- **Bolts, nuts, gears, hole patterns and name plates**, ready to drop into a design.
- **Turning shapes** by typed angle, in 15° steps or freely, around a pivot you can move.
- **Printer plate:** pick your printer's build area, and steep undersides are shaded red for
  overhang. Build sizes are the makers' stated volumes, checked against their pages and not yet
  tried on real printers.
- **Pre-painted 3MF:** the colours you choose in the print simulator are written into the 3MF file.
- **Backup and storage:** back up all designs, save copies into a folder you pick, or keep designs
  on your own WebDAV server (Nextcloud, a NAS).
- **Share link:** a small design can be sent as a web address. Nothing is uploaded or stored on a
  server.
- **Tutorials:** 75 step-by-step lessons in all. Thirty-one were added by the community build.

The full list is in the README under "What this repository adds on top of the original":
https://github.com/MaxSikorski/jumpstart-3d#what-this-repository-adds-on-top-of-the-original

## Links

- Open it in the browser: https://maxsikorski.github.io/jumpstart-3d/
- Download the single file: https://github.com/MaxSikorski/jumpstart-3d/releases/latest/download/jumpstart-3d.html
- Source code and README: https://github.com/MaxSikorski/jumpstart-3d
- Discussions (questions, pictures, announcements): https://github.com/MaxSikorski/jumpstart-3d/discussions
- r/Jumpstart3D (questions, prints, ideas, run by community members): https://www.reddit.com/r/Jumpstart3D/
- Community page (videos and posts about the app): https://github.com/MaxSikorski/jumpstart-3d/blob/main/COMMUNITY.md
- Licence and credit: https://github.com/MaxSikorski/jumpstart-3d/blob/main/NOTICE.md

## Screenshots

The repository has no app screenshots yet. The only picture is the link-preview card, an
illustration made for the site, not a screen capture.

![JumpStart 3D link-preview card: a blue bracket with two holes and the modes Beginner, Advanced and Chisel](src/og-image.png)

*Link-preview card used when the site is shared (`src/og-image.png`).*

Wanted, not yet in the repository (to be added as PNG files):

- Beginner mode with a few grouped shapes and a hole.
- Advanced mode with a sketch, an extrude and the feature timeline.
- Chisel sculpting with the puppet animator.
- An Architechies floor plan.
- CAM Studio with a simulated toolpath.
- The print simulator showing overhang shading.
- The Your designs dialog with backup and server options.

## Contact

Please ask questions and request interviews in GitHub Discussions:
https://github.com/MaxSikorski/jumpstart-3d/discussions
