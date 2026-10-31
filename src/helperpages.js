// jumpstart-3d: helper pages load on demand. The pages of Chisel, FlexiGen and Mesh to STEP (and the shared three.js they run on) are
// big, so the site does not put them in app.js: build.mjs writes them to helpers/ and this module fetches one the first time it is
// needed (the service worker has already saved them for offline). The single file keeps them inline, so nothing is fetched there.
// To add a page or a data file: add its name to HELPER_FILES in build.mjs, import it below and list it in INLINE.
import CHISEL from "./chisel.html";
import FLEXIGEN from "./flexigen.html";
import MESHSTEP from "./meshstep.html";
import THREE from "./helper-three.html";
import { withFonts } from "./helperfonts.js";

// "" in the site build (the plugin in build.mjs empties these imports), the whole text in the single file
const INLINE = { "chisel.html": CHISEL, "flexigen.html": FLEXIGEN, "meshstep.html": MESHSTEP, "helper-three.html": THREE };
const loaded = new Map();

// The text of helpers/<file>: inline in the single file, else fetched from the same origin once and kept in memory.
export function helperAsset(file) {
  if (INLINE[file]) return Promise.resolve(INLINE[file]);
  if (!loaded.has(file)) {
    const p = fetch(new URL("helpers/" + file, document.baseURI)).then((r) => {
      if (!r.ok) throw new Error("helpers/" + file + " answered " + r.status);
      return r.text();
    }, () => { throw new Error("helpers/" + file + " could not be fetched"); });
    p.catch(() => loaded.delete(file)); // a failed load can be tried again
    loaded.set(file, p);
  }
  return loaded.get(file);
}

// A helper page ready for an iframe's srcdoc or a Blob: the page, the shared three.js and the fonts. name: "chisel", "flexigen" or "meshstep".
export async function helperPage(name) {
  const [page, three] = await Promise.all([helperAsset(name + ".html"), helperAsset("helper-three.html")]);
  return withFonts(page, three);
}

// Shown behind a helper's frame until its page arrives (a frame with no page yet is see-through).
export function helperLoadingNote() {
  const note = document.createElement("div");
  note.textContent = "Loading…";
  note.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 14px system-ui,sans-serif;opacity:.6;pointer-events:none";
  return note;
}

export const helperFailText = (tool) => tool + " needs a connection the first time. The downloaded single file has everything built in.";
