# Regression tests

Playwright drives the real app in headless Chromium: the site build in `docs/`,
served locally, and the single file `dist/jumpstart-3d.html`, opened from disk
the way users open it. `npm test` rebuilds both and runs the chat scorer's Node unit tests first.

On the single file, Chromium on the Linux CI runner now and then starts a reloaded page with empty storage (seen on CI from 2026-10-21, never locally, not tied to how soon the reload comes). Tests that reload after saving something use `reload()` or `boot()` from `test/helpers.mjs`: a marker key written just before the reload tells the browser losing everything apart from the app getting its own key wrong. On a loss the helper puts the storage back exactly as it was and reloads again, up to three times, and prints a `storage-lost` line in the log. If the marker is gone but every saved localStorage key is still there with its saved value (IndexedDB is not checked), nothing was lost: the helper does not reload again and prints a `storage-kept` line, with the marker value it saw, to show how often that happens. A key the app wrote or read wrong still fails the test.

```
npm test              both builds
npm run test:site     docs/ only (fastest while working)
npm run test:single   dist/ only
npm run test:mobile   the phone budget only
```

First time: `npm install`, then `npx playwright install chromium`. Set `JS3D_PORT` (default 8765) to serve the site build on another port, so two checkouts can run the tests at the same time. The same
suite runs on GitHub Actions: the smoke and golden specs gate every pull request (`.github/workflows/test.yml`) and the rest runs nightly (`.github/workflows/nightly.yml`).

## How CI runs it

The merge gate (`.github/workflows/test.yml`) is small on purpose: it builds both outputs, then runs the smoke spec and the golden exports on each, and takes about 3 minutes. Everything slower runs every night (see below). The jobs:

- `changes` looks at what a pull request touched. If every changed file is a Markdown file in the repository root (`README.md`, `NOTICE.md`, `CHANGELOG.md` and so on), only the MCP tests run (they read the README), and the pull request is done in about a minute. The lane is only for pull requests into `main` (a pull request into another branch always runs the whole gate, so a green check that came from that branch stays a full run when the pull request is later retargeted to `main`). Anything else, an empty list, a deleted or renamed non-Markdown file, a push to `main` or a manual run means the full gate; a git error fails the job and so the whole run. It uses plain `git` and no extra actions.
- `gate (site, smoke)`, `gate (site, golden)`, `gate (single, smoke)` and `gate (single, golden)`, side by side: `npm test -- test/<spec>.spec.mjs --project=<build>`. `pretest` builds both outputs and runs the Node unit tests first. The single file from the `single` job is uploaded as `jumpstart-3d-single-file` when it passed (14 days), so someone who reported an issue can try a pull request's file before a release exists. A failed job uploads `gate-report-<build>-<spec>`.
- `mcp server`: its own `npm ci`, Chromium and `npm run test:mcp` (under a minute, in parallel with the gate).
- `test`: waits for all of the above and is the one check this workflow adds to the branch rules on `main` (CodeQL's `analyze` and `CodeQL` are the others), because the other jobs report under other names. It passes only when `changes` and the MCP tests succeeded and either the gate succeeded, or the pull request was docs-only and the gate jobs were exactly "skipped". A failed or cancelled job always fails it.

### Nightly

`.github/workflows/nightly.yml` runs every day at 07:00 UTC and on `workflow_dispatch`. It holds everything the gate leaves out:

- `playwright (1/8)` to `(8/8)`: the whole suite on both builds (`--shard=N/8`, one worker each). Playwright splits by spec file and build. The golden spec and the chat judge run in their own jobs (`JS3D_SKIP_GOLDEN=1`, `JS3D_SKIP_CHATJUDGE=1`; only the value `1` counts, see `playwright.config.mjs`).
- `golden exports (site)` and `(single)`, then `export judge`: the golden spec with `JUDGE_EXPORTS=1`, then the judge downloads both builds' exports, installs the two consumer tools and checks all 216 files (see "Slicer and STEP judge").
- `chat judge`: `npm run test:chat-judge`, both builds in one job, because its eight-minute mock clock is shared across both builds and only one runner can hold one clock.
- `fuzz`: `FUZZ_RUNS=50 npm run fuzz`, only when `test/fuzz.spec.mjs` and the `fuzz` script exist (the step skips cleanly before then).
- `firefox` and `webkit` (job `cross`): the suite on the site and the single file, 3 parts each, through the `site-firefox`, `single-firefox`, `site-webkit` and `single-webkit` projects (they exist only with `JS3D_CROSS=1`, which the job sets; locally run `npx playwright install firefox webkit` first). **Not blocking yet:** the job has `continue-on-error`, so its failures never make the run red and never open an issue by themselves; they are listed in their own section of the "Nightly failures" issue whenever something else opens it, and the full list is in the run's `results-cross-*` artifacts. The golden exports and the chat judge stay Chromium only. When the list is short enough to fix, drop `continue-on-error` and set `CROSS_BLOCKING=1` on the `report` job.
- `report`: if a blocking job failed, `tools/nightly-issue.mjs` opens (or updates) one open issue titled **Nightly failures** with the failing specs (read from each job's Playwright JSON report, `PLAYWRIGHT_JSON_OUTPUT_NAME`), the run link and the quarantined tests. It uses the run's `GITHUB_TOKEN` (`issues: write` on that job only), edits the existing issue rather than adding a second, and closes nothing: the maintainer closes it once the cause is fixed.

Run it by hand on any branch, a pull request's too, with `gh workflow run nightly.yml --ref <branch>` (the workflow must exist on that branch; GitHub only lists a manual run for a workflow file that is on the default branch). A run on a branch also writes the issue if it fails. No secrets and no model are involved.

### Flaky tests are quarantined, not merge blockers

A flaky test does not block a merge: the gate is only smoke and golden, and everything else is the nightly's to find. When a test flakes, quarantine it in the same piece of work that saw it: change `test(` to `test.skip(` (or tag it `@quarantined` and exclude it) and put a comment on the line above that starts `// quarantined:` and gives an issue link or the reason. The nightly issue lists every `// quarantined:` comment under `test/`, `grep -rn "quarantined:" test` finds them, and each one is on the fix list until its cause is fixed and the skip removed. Never quarantine a smoke or golden test to get a merge through; if one of those flakes, fix it first (they are the gate).


If a gate job fails, `gh run rerun --failed` reruns only that job (the gate jobs do not depend on each other). Chromium comes from `npx playwright install chromium` (about 10 seconds; a cache was not worth it).

The config sets `serviceWorkers: "block"` for every spec, because a service worker would answer `page.reload()` from its cache; only `load.spec.mjs` allows one, in its own context. Your own browser on `http://127.0.0.1:8765/` keeps the service worker, so after a rebuild the first reload shows the old build and the "new version" message, and the second reload shows the new one.

## What runs

- `tutorials.spec.mjs`: the app's built-in tutorials as tests (how many there are is `smoke.spec.mjs`'s check of the About text). Each one is opened from the Tutorials button and every step is visited as a student would: "Show me" must highlight the element the step asks for (the selector, the tile kind and hole flag, or a menu's button and then, with the menu open, the item itself; steps that need a sketch, the Lathe or a selected body get that set up through the real buttons first). The name step is filled and must tick; Save makes a new version; Export is clicked for real in the first tutorial of each mode (after the meshes are built, and the file must be exactly `Lopez, Maria, <item> v1.stl`); Next and Finish walk through to the finished pop-up. Every step's check runs on an empty design and on 12 real designs from `test/projects` (groups with holes, sketches, extrudes with join/cut, fillets, threads, text) and must never throw. A last test lists every visible toolbar and menu button (Beginner and Advanced, sketch, print and simulate toolbars, ribbon drop-downs and the top-bar Export and Settings menus; a button with no id is keyed by its data-act or text, such as `export:stl`) and compares it with what the tutorials point at. `tutorial-gaps.json` lists today's buttons without a tutorial: a NEW button with no tutorial fails the test, and a gap a tutorial now covers must be deleted from the list. The report is also written to `test-results/tutorial-coverage-<build>.json`. About 90 seconds per build, of which the two Lathe tutorials take about 20 and the real-design checks about 10; `--repeat-each` works.
- `smoke.spec.mjs`: the app boots with the kernel ready and no console errors; the tab icons are files on the site and data URIs in the single file;
  the About dialog keeps the author's credit; dragging a shape tile makes a
  body; a fillet and a chamfer build (the kernel works), once from a document
  and once through the Fillet tool with a click on the edge; Mesh detail
  changes the triangle count; STL, OBJ, STEP and the project file download;
  FlexiGen, Mesh to STEP and Chisel open and render, and Mesh to STEP's
  pop-out tab boots on its own; a saved design is back after a reload.
  Six parameter tests load `projects/parametric-plate.json` (named parameters
  driving sketch dimensions): changing `w` changes the volume and the STL hash
  and undo restores both, a bad expression keeps the last good shape, the
  sidebar adds a parameter, opening in inches does not rescale a design typed
  in mm (a bare number next to a name is plain, a lone number typed in inches is
  read as inches), renaming a parameter
  follows it into other parameters and dimensions, and a dimension's value box
  takes an expression. Nine more load `projects/parametric-features.json`
  (feature values following parameters): changing `t`, `d` or `f` moves the
  extrude distance, hole and fillet and the STL hash with undo restoring it,
  a bad expression keeps the last shape, renaming and deleting a parameter
  follow into features, the Extrude, Fillet and Hole dialogs take an expression
  typed into their value box, and a revolve angle, a chamfer (with a sets list)
  and a shell thickness follow too, a plain number typed over a bound box removes the binding, and the copy kept by Mirror with Join follows a parameter and its renames. Eleven more load `projects/parametric-beginner.json` (Beginner box and hole sizes following parameters): changing `w` and `h` moves the volume and the STL with undo restoring both, a bad expression keeps the shape, renaming and deleting a parameter follow into the sizes, an expression typed into the inspector's Width box binds it and a number unbinds it, a size typed on the shape (Tab) drops only that binding, the bindings survive a switch to Advanced mode and the Advanced Box dialog shows them, the inspector's Parameters list adds a parameter, a resize-handle drag frees only the stretched size, ungrouping a stretched group frees the sizes it stretched, undoing a bind redraws the box, a size below 0.01 mm is skipped, and the Advanced Box dialog takes an expression. Fifteen more load `projects/advanced-pattern-mod.json` (Pattern as an editable feature: a rectangular pattern of a hole and a circular pattern of a shape): `n` and `sp` change the number of holes and the STL with one undo restoring both, double-clicking Pattern in the timeline opens Edit Pattern with the count bound and a typed number removes the binding, editing or deleting the source hole changes or empties every copy, the pattern follows a moved and turned body and still edits with its saved axis, the circular pattern stays one body and follows its count and a parameter, the dialog makes a Pattern feature (not baked copies) in Advanced, saves a world axis in the body's own axes on a turned body, and makes one shape Pattern for "Join copies", Beginner and Advanced bodies without Join still bake separate bodies, an extrude cut is repeated, a circular pattern made with Feature center saves its centre in the body's own coordinates, a partial circle and a two-direction both-sides pattern count their copies, a runaway count is clamped (and an out-of-range parameter skipped), and a mirrored body turns the copies the same way as an unmirrored one (checked on the STL bounding box). Twelve more cover the visible proof: the degrees-of-freedom count (a repeated perpendicular does not close the last freedom; too many constraints give a warning), the check mark and its ribbon note, dimension names `d1`, `d2`… in expressions (old files get names on load, a later dimension feeds an earlier one, a loop between dimensions is put back and reported, a deleted dimension's name or a parameter's name is never given to a new one, a parameter named `d7` is refused), the parameters CSV export and import (one undo step, bad rows skipped, errors counted, BOM and CRLF files, the Beginner inspector's buttons), the Parameters tutorial's checks and the About text.
- `combine-split.spec.mjs`: new pieces from Advanced Cut/Intersect and Beginner groups with holes become separate bodies; Join and existing disconnected solids stay together, while connected cuts stay whole; checks selection and movement, one-step undo/redo, saving and reopening, Keep tools, stable piece ordering, and that existing saved multi-solid bodies remain unchanged.
- `viewfit.spec.mjs`: the camera after a design is opened, on both builds. A design opened again whose shapes were built earlier in the page is framed at once, and a width change made after the user zoomed out leaves the camera where it was (it used to jump back to the framed view); the same holds for Duplicate and for a script or chat load (`JS3D.load`); opening other designs right after one (also A then B then A) leaves exactly one delayed framing, the last one's; a cached design with every body hidden does not leave the camera armed to jump.
- `combinesplit.test.mjs`: Node decision, deletion-guard and real-kernel regressions (via `combinesplit-geometry.mjs`) for Group baselines, Combine edits, surfaces and stable piece ordering. A mocked-worker case also verifies Group commits 161 pieces despite a 160-mesh cache; `npm test` runs it in `pretest`.
- `upstream-merge.test.mjs` (`node --test test/upstream-merge.test.mjs`, no browser; part of `npm test`'s pretest list): the tool that brings a new JumpStart 3D source release from J.Siwek into the fork (`tools/upstream-merge.mjs`). Made-up repos check each kind of change it sorts (clean merge, conflict with file and line, CRLF markers, new, deleted, moved files, executable bits, binary, network code that merges cleanly, outside src/), that nothing is written through a symbolic link, and that a failed run leaves no branch or worktree. The replay of the real v2.1.3 port runs only when `JS3D_UPSTREAM_ZIPS` names a folder holding `JumpStart-3D-v2.0-full-source.zip` and `JumpStart-3D-v2.1.3-full-source.zip` (`gh release download upstream-originals -p '<name>' -D <folder>`), so CI downloads nothing. It uses base = the 2.0 zip, new = the 2.1.3 zip, ours = main just before PR #82. It expects the five conflict hunks the session saw, the update check's network lines flagged, and the changed lines against what shipped pinned per file (count and hash). Those are the hand-resolved hunks and the community changes made on top.
- `booleans.spec.mjs`: what a user sees after Group, Join, Cut and Intersect, on both builds: a torus grouped with a box, with another torus, or beside a hole that misses it keeps its bounding box and its triangles (the STL is closed and encloses the summed volume, read by a small reader in the spec), including through the Group button; two 20 mm spheres 6 mm and 5.66 mm apart intersect to the lens volume, cut both ways to the rest, and join plus intersect equals both spheres; an intersect of two separate boxes and a box cut by a bigger hole say "Nothing is left" with no "[object" in any error. A STEP import holding only a circle (`fixtures/wire-circle.step`, made with the app's own kernel) still builds as lines and stays in the STEP export beside a box.
- `bridge.spec.mjs`: the scripting bridge (`window.JS3D`, documented in `BRIDGE.md`), on both builds. The calls run inside the page: adding, moving, turning, resizing, scaling, grouping and ungrouping shapes, holes, remove/duplicate/rename/colour/hide, parameters (a bound size follows its parameter, bad names and expressions are refused and leave the history alone, binding works with the page in inches), undo and redo, selection and mode, every export kind (the bytes are checked and the STL, OBJ and 3MF hashes equal what the Export menu gives for the same design), `save` and `load` (the same STL hash comes back; garbage and bodies that would break the 3D view are refused; `projects/advanced-hole.json` gives the volume and STL hash recorded in `golden.json`), screenshots (a PNG whose middle really shows the red box, not a blank canvas), the guards (a group with features refuses to ungroup, and so does one stretched at an angle; turning or scaling a shape before it is built is refused unless a point is given; a parameter made in inches edited without a unit means mm; a body whose definition cannot be read does not stall `ready()`), and the demo script `tools/bridge-demo.js`, which is run as text and its summary checked. A first test checks that loading the app edits nothing. It adds no designs to `golden.json`.
- `fasteners.spec.mjs`: the Fastener dialog and `JS3D.fastener`, on both builds. Advanced › Create › Advanced Create › Fastener makes an M8×30 bolt in one undo step and an M8 nut (no length row); threaded rods in metric, inch and left hand build to the expected volume; a tap cutter is a hole that cuts a threaded hole when grouped with a block, and a print offset makes the hole wider; the turns guard (a hint at 64 turns, a refusal and a disabled Create at 160, the same refusal from the bridge); every bridge error text; the Beginner button, Ungroup refusing a bolt and the size boxes adding a Scale; inch units; and the golden `fasteners.json` exported to STEP as four true solids.
- `holepattern.spec.mjs`: the Hole pattern dialog and `JS3D.holePattern`, on both builds. A 4 × 3 grid from the dialog is one hole feature with 12 positions, the right volume and one undo step; a staggered grid has alternate rows one hole shorter, half a pitch off; Fit to face with a margin keeps every hole that far from the edges and reports the ones left out; a turned plate grouped with another shape and a side face get holes along their own edges and in the right plane; a circle sits at the right radius and "Where I clicked" snaps to a hole's centre; the hole-count warning and refusal (in the dialog and the bridge, which adds nothing), every bridge error text, and the golden `holepattern.json` exported to STEP as one true solid. Phase 3 step 2b adds square, hex and slot holes: a hex pattern from the dialog is one hidden sketch (72 lines, named `Hex holes (12)`) and one Extrude cut with 12 profiles in one undo step; the right volume for each shape; slots turn with the grid angle and point at the centre in a circle; a hex measures 3 and 3.464 from the centre in the mesh (sized across flats); moving a sketch point keeps the cut and the Extrude cut edit dialog shows every profile; margins in Fit to face and a long slot on a narrow face; slots and hexes on a mirrored body (matrix determinant -1) and hexes on the turned plate grouped with another shape, with no error and the right volume; every new error text, the overlap refusal (a toast, the dialog stays open) and nothing added; and the golden `holepattern-shapes.json` (four sketches, four cuts, one body) exported to STEP as one true solid.
- `gears.spec.mjs`: the Gear dialog and `JS3D.gear`, on both builds. A 20-tooth module-2 spur gear from the dialog is one hidden sketch of 360 lines and one Extrude, the volume equals the stored outline's area times the width (read back from `JS3D.doc().sketches`) and lies between the root and tip discs, and one undo removes both; the tooth form (2 z points on the tip circle and 40 on the root circle for 20 teeth, 18 lines a tooth up to 41 teeth and 16 from 42); the clearance thins tooth 0 by exactly the clearance at the pitch radius (clear 0 against 0.2, within 1e-3); a bore and a DIN 6885 keyway take their exact area off; a 12-tooth pinion against a 30-tooth gear at the standard centre distance, the second turned half a tooth, shares under 0.01 mm³, and without the turn over 100; the undercut warning at 12 teeth; a rack's volume, length, tooth pitch and the exact loss from a larger clearance; a bevel gear's two sketches, straight Loft and frustum volume, its bore, and a placed bevel pair whose meshed loss (one gear minus the other cut from it, because an empty intersect makes the kernel throw) is under a tenth of the overlap of the same pair with the turn missed, which is over 50 mm³; the warnings and refusals in the dialog and every bridge error text, each adding nothing; the Beginner button; and the golden `gears.json` exported to STEP as three true solids.
- `nameplate.spec.mjs`: the Name plate dialog and `JS3D.namePlate`, on both builds. The text oracle is independent of the app (opentype.js on the bundled fonts, contours as `textgeo.js` draws them). "Max" from the dialog gives two bodies in two colours, one hidden sketch (4 lines, 4 arcs, 1 circle), the plate volume and the letters' volume equal to the formula within 0.1 %, the text centred in the plate with at least the margin all round, one undo step and one undo removing everything; hole positions for rounded and pill, hanging and screws; the 3MF with two objects and two `displaycolor`s; cut-in text (one body, a Deboss feature, the exact volume loss); every bridge error text, each adding nothing; the dialog's refusal of a character the fonts lack and its two warnings; the Beginner button; and the golden `nameplate.json` exported to STEP as five true solids (two plates and the letters M, a and x).
- `report.spec.mjs`: Open/Export › Report a problem (and the same entry in About), on both builds, with GitHub stubbed. Every request the page makes to any host is recorded for the whole file: nothing leaves before the link is pressed, each press is one plain GET navigation to github.com, and nothing is ever uploaded. The details block holds the build, where (site or file), a short browser name and the mode, and none of the design name, `file://`, `/Users` or the page address. The last error is only offered (a box, unticked): the link has none of it until the box is ticked, and then 13 hostile error texts (Windows, network, home and Volumes paths with spaces, emails, addresses with and without a scheme in any case, API keys, quoted folder and design names) come out with their personal parts removed. The link goes to `/MaxSikorski/jumpstart-3d/issues/new` with `template=bug_report.yml`, the typed steps and the edited details, a `browser` field that follows its line, and never `outcome`, `expected` or a title. Long text is cut under 6000 characters of link with a note, also with details that nearly fill it. Copy the details copies the steps and the details (the clipboard is read back), also when the link had to leave the steps out. "Save a copy" downloads `design-for-bug-report.json` (parses, same body count, no version bump, opens again), and a design over 25 MB in bytes (not characters) gets the zip advice. `bug_report.yml` still has the field ids the link fills in. `mobile.spec.mjs` checks the menu entry is visible at 375 px, where About is hidden.
- `runscript.spec.mjs`: the Open/Export › Run script… entry, on both builds: the entry and its hidden `.js` picker exist, `tools/bridge-demo.js` handed to the picker ends with one "Block with hole" body and a "Script finished" message carrying its summary, a script that throws (or does not parse) shows a red message and leaves the design and its undo history unchanged, and a script with top-level `await` and a `return` shows the returned value in the message.
- `backup.spec.mjs`: Your designs › Back up all designs… and Restore from backup…, on both builds: the two buttons and the hidden `#file-backup` picker exist, a backup of two designs downloads as `jumpstart-3d-backup-<date>.json`, restoring it after the storage keys are cleared brings the list, documents and version counters back byte for byte (read through the app's storage hook, `app.projects._store`), restoring it again says "already here" and adds nothing, a changed design is kept next to a "(restored)" copy, a garbage or project file is refused and changes nothing, and a store that reports "did not fit" is counted, not added.
- `storage.spec.mjs`: where designs are kept, on both builds, each case in a fresh browser context: a saved design is in the `jumpstart3d-projects` IndexedDB (document string with `_updated`, list entry) and not in localStorage; designs, a stray document and the version counter seeded in the old localStorage keys are copied over once (byte for byte, old copies left in place; a change to an old document alone does not rerun the merge, but a changed old list does: the newer copy wins and the older version is kept once as "(before fallback)"); a design saved while IndexedDB hangs (a 3 second wait, then the older storage) is back in IndexedDB on the next normal visit (the renamed one wins, the earlier version is kept once as "(before fallback)", and a further visit adds no second copy); when IndexedDB refuses to open, a saved design comes back from localStorage after a reload; the edit made just before the tab closes is written to a rescue key (the `beforeunload` event is dispatched) and a newer rescue key found at the next start is applied with the thumbnail kept (two separate halves, since a reload right after the write would race it); on the older storage a restore whose list cannot be saved says "did not fit" and leaves no new document or version keys. `boot()` in `helpers.mjs` also waits for `app.projects.started`.
- `folder.spec.mjs`: Your designs › Save copies into a folder…, on both builds, each case in a fresh browser context. A fake folder picker hands out a real directory from the browser's private file system (OPFS) in place of a folder on disk, and OPFS never asks for permission, so a lapsed permission is stubbed. Cases: no row without the picker, none on the older storage; choosing a folder writes one project file per design (`<name>-<id>.json`, the exported project-file format, no `_updated`) and an edit reaches its file after the quiet pause, not at once; a rename replaces only the file the app wrote and leaves other files in the folder alone, and deleting a design leaves its file; a lapsed permission shows the waiting note and an Allow button (one "paused" toast), saving still works, and Allow catches up; a failing write shows in the row, saving still works, and the next run catches up; the folder is remembered after a reload; Stop copying removes the record and keeps the files; a copy opens through Open > Project file as a new design. Seven of the nine cases are skipped on the single file, because Chromium has no OPFS on file:// (the OPFS test folder is also case-sensitive, so a case-only rename is not tested).
- `restorefolder.spec.mjs`: Your designs › Restore from a folder…, on both builds. Real temporary folders are written with Node and handed to the hidden `#file-folder` input (a directory path works for a `webkitdirectory` input). Cases: the button and hidden folder picker exist; a folder of two project files is added with its ids, file times and version counters while the open design and last-open pointer stay; the same folder again says "already here" and changes nothing; a design changed since gets a "(restored)" copy and is left untouched; notes, foreign JSON, broken JSON, backup files, files without bodies and subfolders are ignored or counted as unreadable; a file without an id inside takes it from its `-<id>.json` name; a folder with no design says so; of two files with one id the newest keeps it; and, on the site only (no OPFS on file://), a restored design reaches the copies folder and is not rewritten after the copier's 5 s quiet period (its file time stays put).
- `remote.spec.mjs`: Your designs › Your server, on both builds. A fake WebDAV server kept in the spec and attached with `page.route` (Nextcloud-, Apache- and unprefixed-style answers, Basic login, `If-Match`, a request log) stands in for a real one. Cases: the two tabs (This browser unchanged, every opening starts there); `storage.json` fills the address once per page load and only where no address is saved (the single file never asks); the address rules and the red texts for a `user:pass@` address and missing fields; Connect lists the `.json` files newest first with the right PROPFIND request, the password is kept only when Remember is ticked and survives a reload; Open brings a design in with its id and the server's time, and a file that is not a design changes nothing; Open never overwrites (a design changed on both sides opens as a "(from server)" copy, an untouched one takes the server's newer copy, a changed one is kept); Save writes the folder's project-file format and skips the pre-check only when the stamp matches; JPEG previews persist as `.json.thumb` sidecars, match the browser thumbnail and return after reconnecting without fetching full designs, while older files list blank and still open; a rename replaces only its own file; a server copy changed elsewhere stops Save until Replace it; Delete asks first and touches only the server; a wrong password makes one request and writes nothing; a server that is down changes nothing; a missing folder is made only when its Create the folder button is clicked; Test connection reports refused, missing, unreachable and fine without keeping anything; a short address such as `designs/` is taken from the page's own address (and is no address on a file); a file that already has the name Save would write, or a local copy Open cannot read, is never overwritten; a refused PUT (412) shows the conflict row once and a refused Replace it says so; a 401 on a remembered password drops it; and no tab or request inside claude.ai. CORS is not tested: Playwright answers the preflight itself and adds the headers, so the README's recipes are the only cover for it. The browser prints a "Failed to load resource" line for each 401, 404, 412 or refused request, so this spec skips console lines from the fake server and `storage.json`.
- `load.spec.mjs`: the workspace opening before the geometry engine is ready, the install manifest and icons, and the offline site. Six cases: on both builds, the engine's note and the splash are gone once the kernel is ready; on the site, with the engine download held back by the test, the splash is gone, the note shows, Beginner and Advanced switch with the mouse, a box added meanwhile has no mesh until the download is let go and then appears; on the site, with the engine answering 404, the note and a red message say it couldn't start and the workspace still works; on the site, the manifest is valid JSON and every icon loads at its declared PNG size (or, for the SVG, with nonzero dimensions); on the single file, no manifest link is present; on the site, in a context that allows a service worker and a private server, a first visit installs the worker and fills one cache with four files named after the build, then with the server closed and the browser offline a reload still loads, builds a box, and shows no "new version" message.
- `mobile.spec.mjs` (its own project, `mobile`): a first-time visitor on a 375 px touch phone (Pixel 7 profile) over a simulated 4G link (9 Mbit/s, 150 ms), served with gzip like GitHub Pages (`test/serve.mjs ... gzip`, port `JS3D_PORT` + 2). From the first load it taps a box, a cylinder hole, types the hole's width and depth, pans with two fingers (the settings panel covers new shapes on a narrow screen), turns on Multi-select, taps the box, groups and exports an STL. It fails when the workspace takes over 5 s to be usable, the engine over 18 s, the download over 25 s, or the site sends over 9.3 MB; each run prints a `mobile-budget` line with the numbers. CPU slowdown is not emulated (Chromium's does not reach the geometry engine's worker).
- `agent.spec.mjs`: the link to a tool server and the other additions of the MCP step, on both builds. A tiny WebSocket server started by the test (the `ws` package, a free port) stands in for `mcp/server.mjs`: with the setting off the page opens no WebSocket in 2 seconds; `JS3D.connect` sends the hello, `list` round-trips, `export` comes back as `$bytes` and decodes to a valid STL, unknown calls and `internals` and calls that throw come back as errors, calls run in order, `disconnect` closes and nothing reconnects; when the server goes away the state is "waiting" and a new server gets a new hello within 5 seconds; a close with code 4001 switches the link off; calls queued on a closed link are dropped, and the slow `export` sent first also answers first. The menu row (the real port, 8822, is answered by a mock inside the page, so a real server on your computer is never touched) turns the setting on and off, and "on" reconnects after a reload. `JS3D.run` runs the demo text and returns its summary, and `screenshot({width: 300})` is 300 pixels wide (read from the PNG header).
- `chat.spec.mjs`: the chat panel, on both builds. A stand-in model server (`mockmodel.mjs`, started by the test on a free port, answering from a script in the Ollama, OpenAI and Anthropic shapes, with CORS headers because the single file is opened from disk) replaces a real model. A block with a hole is built through five tool calls over the Anthropic shape (the solid's volume is checked, the assistant message is sent back unchanged with matching tool ids, and the screenshot reaches the model as an image); the OpenAI shape sends the key in the `Authorization` header and the Ollama shape sends `stream: false`, a large context and `tool_name`; settings persist and the key is stored only when Remember is ticked (and opening the panel sends nothing); a server that is not there shows the error and the `OLLAMA_ORIGINS` hint; Stop ends a run; a model that never stops is cut off after 30 tool calls; `run_script` is refused until Allow scripts is ticked.
- `chatjudge.spec.mjs`: the chat geometry scorer, on both builds: five scripted mock plans drive the real panel and a Node judge scores the geometry; see [Chat geometry benchmark](#chat-geometry-benchmark).
- `mcp/test/` (run with `npm run test:mcp`, after a build; it builds `docs/` first): `server.test.mjs` starts `mcp/server.mjs` over stdio with the MCP SDK's client in headless mode on `docs/` (no tool's input schema has a `$ref` or a tuple, a block of 24000 mm³, an 800 pixel PNG, `screenshot` with a `path` writes a PNG of the asked width and answers with text, an STL on disk, save then load keeps the STL hash, the demo script, errors with the page's message, `--help`); `tab.test.mjs` connects a Playwright page to the server's WebSocket (any free port) and checks that tools edit that page, that a second tab is refused while the first is live and connects after it has gone, that a session stays with its tab (a lost tab is an error after 5 seconds, never a headless browser) and ignores a tab that arrives once it is headless, that other sites' `Origin` headers are refused, that the https site's origin works (routed to `docs/`, with Playwright's `local-network-access` permission granted), and that a taken port is reported; `server.test.mjs` also covers bad `JS3D_WS_PORT`/`JS3D_MODE` values and the static server's answer to a broken address. These suites use free ports, so they can run beside `npm test`. `cli.test.mjs` spawns `mcp/cli.mjs` (run prints the demo's summary with `sameShape: true`, export writes an STL whose triangle count matches its size, shot `--width 400` writes a 400 pixel PNG, status prints the versions, bad usage exits 1 or 2 with nothing on stdout); `plugin.test.mjs` checks that `plugin.json`, `.mcp.json`, the marketplace file and the skill's frontmatter agree, that `skills/jumpstart-3d/SKILL.md` at the repository root is byte-identical to `mcp/skills/jumpstart-3d/SKILL.md` (edit one, copy it over the other; the test fails when they differ), that the one-line setup prompt is the same text in both READMEs and the About dialog (`src/app.js`), that `mcp/AGENT-SETUP.md` stays within 140 lines, and that every Chromium install line in the docs names the pinned Playwright version; `chat.test.mjs` compares the tools the in-app chat offers (`src/chattools.js`) with this server's list: same names in the same order, same descriptions and parameter names for all but the six that differ on purpose (`status`, `screenshot`, `export_file`, `save_project`, `load_project`, `run_script`), and no `anyOf`, `oneOf`, `$ref`, `default` or `additionalProperties` in the chat's schemas; `install.test.mjs` copies `mcp/` to a scratch folder, runs `npm ci --ignore-scripts` there as Claude Code does, and starts the copy's server (it needs the npm registry or a warm npm cache). `mcp/` has its own `package.json` and lockfile: run `npm ci` inside it once before `npm run test:mcp`; the root `npm ci` does not install it.
- `golden.spec.mjs`: every design in `projects/` is loaded, exported as STL,
  OBJ, 3MF and STEP (and DXF when it has sketches) through the real menu, and the bytes are hashed against
  `golden.json` (the STEP file is cleaned first: the time it was written and the
  running numbers OpenCascade puts in product names and in the links between
  bodies, which depend on how many STEP exports the page did before, are blanked). The entry also keeps
  each body's volume and the STL triangle count, so a mismatch says whether
  the shape changed or only its tessellation.

When a hash moves and the change was intended, re-record:

```
npm run test:update
```

and commit the new `golden.json` with the change that caused it. (The script
sets `UPDATE_GOLDEN=1` and records from the site build; in PowerShell run
`$env:UPDATE_GOLDEN=1; npx playwright test --project=site` instead.)

<!-- J1: Consumer checks require original downloads and separately reviewed expectations. -->
## Slicer and STEP judge

The nightly golden jobs collect the normal golden run's original STL, 3MF
and STEP downloads from **both** builds. Playwright streams the downloads;
there is no object-URL interception or second export pass. `JUDGE_EXPORTS=1`
requires a nonempty `JUDGE_RUN_ID` and refuses `UPDATE_GOLDEN`.

```sh
JUDGE_EXPORTS=1 JUDGE_RUN_ID=local npm test
npm run test:judge:unit
JUDGE_RUN_ID=local npm run test:judge   # needs the Linux consumers below
npm run test:judge:integration          # same
```

Mac contributors can collect exports and run the Node unit tests without
native consumers. The full consumer judge is **CI-only**: the pinned Linux
AppImages and console launcher are not a supported Mac installation. The
nightly workflow runs it (07:00 UTC and manual dispatch); there is no
successful skip for missing tools. A failure opens or updates the "Nightly failures" issue.

Inputs live in `test-results/judge/site/` and `test-results/judge/single/`.
Each build clears only its own directory. Only a complete successful golden
run writes its `manifest.json`: schema, run/build IDs, baseline and project
digests, exact filenames, raw hashes and byte lengths. A filtered run cannot
supply a complete manifest. STEP bytes on disk remain unmodified; only the
golden hash comparison normalizes timestamps and export counters. The judge
requires exact coverage of the discovered projects in both manifests,
`golden.json` and `judge-solids.json`, and checks all hashes before consuming
files. CI uses the same `${{ github.run_id }}` in
collection and judging.

Pinned consumers are **PrusaSlicer 2.8.1+linux-x64-GTK3-202409181416** and
**FreeCAD 1.1.4**, on `ubuntu-24.04`. `tools/install-judge-tools.sh` downloads
both release AppImages, verifies their SHA-256, extracts them with
`--appimage-extract` (no FUSE) and sets `PRUSA_SLICER` and `FREECAD_CMD` to
executable paths without flags. FreeCAD runs through the extracted
`AppRun --console` with a Python script, since its GUI version flags crash
headlessly, and (unlike a standalone Python) runs a script file under a name
other than `__main__`. A fresh HOME/config directory keeps inherited slicer
presets and post-processing scripts out. There is no cache: both downloads
take 3 and 12 seconds including extraction, and a cache restore cost as much
(measured: install 27 s without, 27 to 32 s with a warm cache).

`tools/judge-prusa.ini` fixes a virtual 1000 x 1000 x 1000 mm build space,
0.4 mm nozzle, 1.75 mm filament, 0.2 mm layers, two perimeters, three top and
bottom layers, 10% rectilinear infill, no supports/brim/skirt, and plain-text
Marlin 2 G-code with relative extrusion (PrusaSlicer refuses relative
extrusion without `G92 E0` in the layer G-code). The remaining values are the
version's built-in defaults; the resolved profile is saved. The profile is an
export compatibility check, not a printer recommendation.

FreeCAD checks the **original triangles**, before accepting a slice: exact
STL layout, finite coordinates/normals, no degenerate/duplicate triangles,
closed oppositely directed edges, a single face-link cycle at each vertex,
and FreeCAD Mesh solidity, non-manifold, orientation and component
self-intersection checks. 3MF must use the app's direct mesh objects in mm,
with all visible non-hole bodies represented and only identity transforms;
components and other package layouts need an explicit checker extension.
No repair, fill or reorientation is allowed. FreeCAD's Mesh checks treat
vertices a fraction of a micrometre apart as one point, so such a pair (a
sliver triangle) can fail `isSolid` or self-intersection even though the
exact edges close.

The slices keep PrusaSlicer's default drop-to-bed, so each object sits on the
bed and the relative placement between objects is not preserved.

Prusa must exit successfully on `--info` (complete object reports, `manifold
= yes`, no repair counters) and on the slice, with no repair/error text, and
produce fresh G-code with a `;LAYER_CHANGE` and an XY extrusion move after
it. Exit zero and quiet logs are not enough: the probe's holed STL sliced
silently to the same G-code as the closed cube, so manifoldness comes from
FreeCAD and the original-triangle checks, and the slicer supplies evidence of
a real toolpath. Three slicer inputs run at once, one thread each, after one
FreeCAD batch for the whole corpus. A 3MF with several objects is sliced one
object at a time (the macro writes one single-object copy per build item;
`--info` still reads the original file): PrusaSlicer 2.8.1 reports "gcode path
conflicts" and then crashes (SIGSEGV) whenever separate objects of one file
overlap, as raised text does on its plate, and refuses an object that floats
above the bed, which is how bricks, name plates and patterns are exported.

STEP uses `Part.read`, requires valid positive-volume solids with closed
shells, and refuses loose faces/wires/shells beside otherwise good solids.
`test/judge-solids.json` is a separately reviewed solid count per fixture,
not a count of app bodies: text letters, patterns and groups give several
solids, and each count was checked against the raw `MANIFOLD_SOLID_BREP`
records and the design (3D sketch tube 2 pipes; pattern-mod 7 = bar + ring of
6; text "Hi" 3 = H, i stem, i dot; name plates 5 = plate, 3 letters, plate
with cut text). Every added design needs an actual FreeCAD import count
checked the same way. `test:update` never approves these counts or external
validity. While `judge-solids.json` is missing or incomplete the judge still
runs every check and prints a `MEASURED` line per file and a
`JUDGE_SOLIDS_MEASURED` object to copy, but fails those STEP files. STEP
volume must be within **0.5% relative** of the sum of visible non-hole
bodies' golden volumes multiplied by their absolute outer-matrix
determinants; there is no absolute floor or per-design exception (all 36 are
within 0.01%). Mesh volume is not compared to B-rep volume.

Two softenings keep the judge honest about what is a print problem. When
FreeCAD says `isSolid=false` but every edge closes exactly and the slicer
calls the mesh manifold, or FreeCAD reports a self-crossing of at most 0.01 mm,
the cause is a vertex pair about 1e-4 mm apart (FreeCAD's merge tolerance) and
the file gets a **WARN** line instead of a failure. A crossing longer than
0.01 mm (or one FreeCAD cannot measure), an open edge, a degenerate triangle or any slicer failure still fails. A zero-area triangle is reported but left out of the other checks, so it cannot hide another defect.
`test/judge-known.json` lists the files that fail for a named defect with a
follow-up (`match` is a regex that each single failure must match, plus `defect` and
`followUp`): such a file passes with a WARN line naming the entry, and a listed
file that passes fails the judge with "remove it from judge-known.json", so the
list can only shrink. There is no other skip list. The summary prints the
warning and known-defect counts.

Each expected file gets a PASS/FAIL line, then `MEASURED` lines, then a
six-row build/format table that is also appended to the Actions step summary
(seconds in its rows are summed per-file work; wall time is reported
separately). Complete stdout/stderr, protocol, request, resolved profile,
`measurements.json` and `summary.json` stay under `test-results/judge/`;
failure artifacts keep all `test-results/` for seven days. Limits: install 8
minutes, controls 5, judge 10 (process deadline 8), job 30. The FreeCAD batch
has a 60-second startup and 20-second progress limit; slicer info/slice limits
are 15/60 seconds. Tool, download, version, protocol and missing-output
failures fail the existing check. Geometry failures never rewrite the
baseline; they need a separate geometry/export fix.

`test/fixtures/judge/` holds closed and holed mesh controls, four STEP
controls and saved probe logs. `test:judge:unit` checks manifests, parsers,
volumes, process failures, timeouts, per-object slicing and stale-output
rejection without native tools. `test:judge:integration` runs the production
checker with the real consumers: closed/open STL and 3MF, closed/open-shell
STEP, a dropped-solid expectation, a two-solid compound, a compound plus a
loose shell, malformed files, and zero-status missing G-code. Expected
failures must match their specific reasons; missing tools fail this suite
rather than skip it.

Measured on `ubuntu-24.04` (runner image 20261012.334.1), 36 designs, 216
files (144 slices, 72 STEP imports): install 27 s (apt libraries 11 s,
PrusaSlicer 3 s, FreeCAD 12 s), unit tests 2 s, native controls 2 s, judge
113 s (the one FreeCAD batch for all 216 files 28 s, then the slices). That is
about 2.4 minutes, now its own job after the four test parts. One STEP import with checks takes up to
1.2 s, one mesh check up to 1.9 s, and one slice (info plus G-code) up to 9.7 s;
the 144 slices add up to 251 s, three at a time.

Not covered: physical prints or fit, filament and colour mapping, support or
bed readiness, OBJ/DXF consumers, arbitrary user files, other parameters,
assembly collisions, GUI FreeCAD, Safari/Firefox/phones, and the manual
double-click of the single-file app. FreeCAD and the app share OpenCascade
heritage, so this is not a wholly independent geometry kernel.
<!-- J1 end. -->

## Chat geometry benchmark

`npm run test:chat-judge` builds both products, runs `node --test test/bench/*.test.mjs`, then runs `test/chatjudge.spec.mjs` on both Playwright projects. The nightly Actions workflow runs the same checks in its `chat judge` job (`npm run test:chat-judge`; `npm test` in the parallel parts skips the file, and pull requests do not run it); it needs no model or secret. The five positive mock plans are J3-001 (box), J3-003 (grouped cylinder cutter), J3-005 (two-hole pattern), J3-007 (tube), and J3-008 (side hole pattern). The real panel builds the geometry; the judge reads it through `JS3D`. The mock tests the scorer, not how well a model understands a request. Browser negatives cover empty geometry, spare hidden/cutter bodies, equal-volume wrong hole count, shifted bounds, terminal errors, deadlines and fresh-context isolation. The Node suite audits every expected record independently, tests topology refusals, and checks reporting and CLI setup with local HTTP stubs.

The literal fixture is [`bench/chat-cases.json`](bench/chat-cases.json): `{version:1, preamble, tolerance, cases}` with exactly 50 ordered IDs, J3-001 through J3-050, in ten families of five numerical variants. Each case has `id`, `family`, `request`, `expected:{bodies,volumeMm3,bboxMm:{min,max},holes}`, and a readable, substituted `calculation`. Expected numbers come from the request's algebra, never recorded app output; calculation text is never executed. The full fixture is validated even for a subset: unknown/missing fields, changed preamble/tolerances, invalid geometry, duplicate IDs and family counts fail before any Send. Fixture size is limited to 1 MiB and request/calculation strings to 2,000 characters. Only the exact preamble, newline and request reach the model, never IDs, expectations or calculations.

Every selected case gets one attempt and one Send, in fixture order, with a new browser context, empty Beginner design, Mesh detail Normal, scripts/vision off and no saved key. There are no retries, follow-up hints, geometry repairs or changes to the app's system text, tools or provider defaults. Ollama receives `stream:false` and `num_ctx:32768`. The driver observes Send becoming disabled synchronously, then waits for Send enabled/Stop disabled and a final non-empty assistant row. Recovered tool errors are recorded separately; terminal errors/limits invalidate the case even when geometry happens to match. Contexts are closed after every case, including timeouts.

A pass requires exactly one top-level body counting hidden bodies and cutters, visible and solid, with no build error, finite positive volume, finite world bounds, and one valid connected STL boundary. Volume error is at most `max(1 mm³, 0.001 × expected volume)`; each of six bbox coordinates is within **0.1 mm**, inclusively; hole count must match exactly. Metrics remain separate and unmeasured metrics are null. Body/flag or metric mismatches are `fail`; missing/build-error geometry, unmeasurable topology, terminal chat/page errors and deadlines are `error`. Unstarted rows remain `not_run`; none are removed from the denominator.

Holes mean independent through-tunnels, computed as boundary genus `(2 − (V − E + F)) / 2` from binary STL exported by `JS3D`, not feature names, cutter flags or child counts. The intended domain is one connected solid with one connected boundary, no enclosed cavity, and separate round through-bores. A tube has one hole; a blind pocket has zero. This is not a blind-hole or general CAD hole recogniser. **Volume, world bounds and genus are a geometry signature, not proof of exact shape, bore diameter/location or edit history.** The topology code requires exact STL length and finite coordinates, welds within 0.00001 mm by checking a hash cell and its 26 neighbours, and drops only repeated-index triangles while reporting their count. It rejects other zero-area or duplicate triangles, open/non-manifold edges, inconsistent winding, non-cycle vertex links, multiple boundary components (including cavities), and non-integer/negative genus. Reports include V/E/F, Euler characteristic, component count and discarded degenerates. No invalid export is repaired or silently scored as zero holes.

Time caps: boot 120 s; Send through export 90 s mock / 300 s real; each provider request 120 s (also bounded by the case); post-chat readiness 60 s; export 30 s. The app's 30-tool cap remains, and the judge caps provider POSTs at 31. Cases run sequentially. Both mock builds share an 8-minute wall deadline; real runs, including `--build both`, share 60 minutes. STL is limited to 200,000 triangles / 10,000,084 bytes. On a deadline the driver uses Stop if available and closes the context. Provider token usage is `not_collected`; tool counts are not token estimates.

For a real run, install/start Ollama and pull `qwen3:14b` yourself; the runner never downloads a model. Enable browser access using the existing [Chat inside the app instructions](../README.md#chat-inside-the-app): on macOS, `launchctl setenv OLLAMA_ORIGINS "*"`, then quit and reopen Ollama. Leave the Mac awake. Start with an explicitly labelled smoke subset:

```sh
npm run bench:chat -- --cases J3-001,J3-003
npm run bench:chat
npm run bench:chat -- --build both
```

The second command measures 50/site; `--build both` runs site then the actual `file://.../dist/jumpstart-3d.html`, with separate scores. Accepted flags are only `--build site|single|both` (default site), `--model TAG` (default `qwen3:14b`), `--cases ID,ID` (unique known IDs), and `--help`. `JS3D_BENCH_URL` defaults to `http://127.0.0.1:11434`; only HTTP `localhost`, `127.0.0.1` or `[::1]` origins are accepted, without credentials, query, fragment or paths beyond `/`. There is no API-key, output-path, real-test switch, mock fallback or hosted endpoint. The CLI starts and stops its own free-port loopback static server and one Chromium browser. A 5-second Node preflight checks `/api/version` and `/api/tags`, requires the exact installed tag and full digest, and records them. That does not prove browser access: the panel still exercises browser CORS without a proxy or fulfilled routes.

Both modes write `score.json` (version 1) and a readable `score.md`, also printed to stdout, under ignored `chat-bench-results/<UTC-YYYYMMDDTHHmmssSSSZ>-<pid>-<mode>-<build>/`. Directories are created without overwriting prior runs. All planned rows are persisted first and each case is saved using temporary files plus rename, so partial/interrupted runs remain visible. Metadata includes model tag/full digest, Ollama/app/bridge versions, build/fixture SHA256, hashes of the actual first outgoing system text and tool schema, offered tool count, settings, limits, tolerances, timing and coverage. Unavailable hashes are null with setup errors reported. Per-case rows retain expected/observed metrics, topology, tool/provider counts, recoverable tool errors and redacted terminal diagnostics. No API payloads, conversations/thinking, screenshots, projects or STL files are saved by default; nothing is uploaded.

The table ends `Passed P/N (X.X%); failed F; errors E; not run R; coverage N/50.` A two-case run has denominator 2 and coverage 2/50; the five-case mock report is 5/50 coverage, never 50-case model accuracy. A real CLI exit of **0** means every selected case was measured as pass/fail, even at 0% accuracy; **2** means invalid setup, infrastructure/measurement error, partial run or report-write failure; **130** means Ctrl-C, with remaining rows retained. The mock regression requires all five to pass per build.

J3-003 (a block with a central bore) is the worked example in the app's system text, so a real model's score on it is inflated; the later tuning work must not copy benchmark cases into the system text.

A full 50-case run with a 14B thinking model on a laptop will likely hit the 60-minute cap and show `not_run` rows. Warm the model first (`ollama run qwen3:14b` once, then leave it) so the first case does not pay the load time. Exit 2 on such a run means partial, not broken; the finished rows are kept.

This is on-demand Ollama support, not a measured real-model baseline or a nightly job. No second local model, LM Studio, hosted model/API secret or nightly coverage is provided; a GitHub runner's localhost is not this Mac. Model memory/latency must be verified by the actual run. The corpus covers only these numerical templates. The judge does not establish Safari/Firefox, phones/slow-device budgets, real printing/slicing/STEP import, production local-network permission prompts, or a user's disk double-click behavior; automated file-URL Chromium evidence is narrower.

## Measuring load time

`node tools/measure-load.mjs [folder=docs] [runs=3]` serves a built copy of the site like GitHub Pages does (compressed files, ten minutes of caching), slows Chromium to about 10 Mbit with 40 ms delay, and visits twice in the same browser. The table has the median of the runs for each visit: **DOMContentLoaded** is when the app's script has loaded and run, **workspace usable** is when the loading splash no longer blocks the mouse, **kernel ready** is when the geometry engine can build shapes, and **network bytes** is what that visit downloaded from the site (an answer from the service worker or the browser's cache counts as zero; the service worker's own downloads are printed under the table). To compare a change, put the old build in a folder first (`git archive <commit> docs | tar -x -C <folder>`), measure that folder, then run `node build.mjs` and measure `docs`. Within ten minutes of a first visit the browser's own cache can serve a second visit even without a service worker, so the service worker's gain shows after ten minutes and offline. `tools/measure-load.mjs` is the hand tool for comparing builds at 10 Mbit; the phone budget in `mobile.spec.mjs` runs in every `npm test`.

## Adding a design

Drop a project file in `projects/` (Export > Save Project File, or a
hand-written document like the existing ones) and re-record. Keep designs
small: each one is built, exported as STL, OBJ, 3MF and STEP, plus DXF when it has sketches, and hashed on every run.
A design can carry `params` (`[{ id, name, expr, value }]`, plus `unit: "in"` when typed in inches) and sketch dimensions with an `expr`, as `parametric-plate.json` does. A feature (extrude or revolve node, fillet, chamfer, hole or shell mod) can carry `exprs: { dist: "t" }` (keys `dist`, `dist2`, `angle`, `r`, `d`, `dia`, `depth`, `th`; plus `exprUnits` when typed in inches), as `parametric-features.json` does; leave `exprs` out when nothing is bound. A Beginner shape (`t: "prim"` node, also inside a group) can carry `exprs: { w: "w", d: "w/2", h: "h" }` for its sizes, stored in `p`, as `parametric-beginner.json` does.
A `pattern` mod (`kind: "rect"` with `ax1`, `n1`, `s1`, optional `ax2`, `n2`, `s2`, `sym`; or `kind: "circ"` with `cax`, `center`, `cn`, `angle`) repeats either earlier mods of the same body named in `feats` (`what: "feats"`) or the whole shape so far (`what: "shape"`). Its vectors are in the body's own coordinates, not the world's, and it can carry `exprs` for `n1`, `s1`, `n2`, `s2`, `cn`, `angle`; see `advanced-pattern-mod.json`. The three older pattern designs are baked copies and stay as they are.

## How the tests reach the app

`src/app.js` ends with three lines that put `app`, `store` and `findBody` on
`window`, exactly what the author's `app/test/dbg.js` did for his own
Playwright scripts (in the v1.94 source zip on the `upstream-originals`
release). The helpers in `helpers.mjs` load a design with `__store.load`, wait
until the kernel queue is empty and every body has a mesh, read volumes from
`__app.scene.views`, and catch downloads from the Export menu.

`JS3D.group` in `src/bridge.js` keeps one group body; automatic piece splitting applies to the UI Group command only.
