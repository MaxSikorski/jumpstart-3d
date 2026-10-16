# Contributing to JumpStart 3D

Thanks for helping. This page covers three things: reporting a bug, asking
for a feature, and changing the code. If you only want to use the app, you
do not need any of this; see the [README](README.md).

## Reporting a bug

Open an issue at https://github.com/MaxSikorski/jumpstart-3d/issues and
include:

1. **Which version.** The website, or the downloaded file? If the file,
   which release you got it from (the app itself does not show a version
   number).
2. **Browser and computer.** For example "Chrome 130 on Windows 11" or
   "Safari on an iPad". The app runs entirely in the browser, so this is
   usually the key detail.
3. **Steps to reproduce.** What you clicked, in order, starting from a new
   design if possible.
4. **What happened and what you expected.** A screenshot or short screen
   recording helps a lot.
5. **A project file, if you can.** Open/Export, then "Project file" saves a
   `.json` you can attach. It lets us see exactly what you were building.
6. **Anything in the browser console.** Press F12 (or Cmd+Option+J on Mac),
   click Console, and copy any red text.

One bug per issue. If you are not sure it is a bug, open the issue anyway.

## Asking for a feature

Open an issue and describe the problem you are trying to solve, not only the
feature you have in mind. "I can't line up holes evenly along an edge" tells
us more than "add a linear pattern option". If another CAD program does it
well, say which one and how.

Keep in mind the app's purpose: a simple CAD tool that runs in a browser
with no install. Ideas that need a server, an account, or a plugin system
are unlikely to fit.

## Changing the code

### How the code is laid out

The app is one big minified JavaScript bundle with lines over a megabyte
long. It cannot be edited on the GitHub website (the editor blanks the
file), so the repository keeps it split into pieces and rebuilds it with one
command. The README's "I want to change it or contribute" section explains
the folders and the build. Read that first.

### The short version

1. Fork the repository and clone your fork.
2. Make a branch for your change.
3. Edit. `src/index.html` is plain HTML and CSS; change it directly.
   `src/app.js` is minified, so change it with a small script that finds an
   anchor string exactly once and replaces it (see `tools/add-obj-export.mjs`
   for the pattern). Never open `src/app.js` or `docs/app.js` in a web
   editor.
4. Run `node build.mjs`.
5. Test both outputs: serve `docs/` and try it in a browser, and open
   `dist/jumpstart-3d.html` from disk by double-clicking it. At minimum,
   drag a box, run a fillet in Advanced mode, export an STL, and open each
   of the three helpers (Chisel, FlexiGen, Mesh to STEP). Check the browser
   console for errors.
6. Commit the rebuilt `docs/` together with your change. Do not commit
   `dist/`.
7. Open a pull request. Say what you changed, why, and what you tested.

### Things we will ask you to keep

- **The credit.** "Created by J.Siwek" in the About dialog stays. Our own
  additions are listed in the README, not claimed as the original.
- **One file, no install.** Any change must still work from the single
  offline file as well as the website.
- **Small, focused pull requests.** One fix or one feature per PR is much
  easier to review and to revert if something goes wrong.
- **Plain English** in commit messages and PR descriptions. Many of the
  people here are makers, not professional developers.

### Updating to a new upstream version

If a newer original single-file build appears, do not edit it by hand.
Put it in the repository root, run

```
node tools/extract.mjs jumpstart_3d_vX.Y.Z.html
node tools/add-obj-export.mjs
node build.mjs
```

and test as above. The extract script finds the embedded helper pages by
their titles, and the OBJ script finds its anchors by pattern, so they
should cope with the minifier renaming things. If either script stops with
an error, open an issue with the message; do not try to force it.

## Questions

If something here is unclear, open an issue with the "question" label. An
unclear guide is a bug too.
