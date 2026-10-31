// jumpstart-3d: helper pages load on demand. The pages of Chisel, FlexiGen and Mesh to STEP (and the shared three.js they run on) are
// big, so the site does not put them in app.js: build.mjs writes them to helpers/ and this module fetches one the first time it is
// needed (the service worker has already saved them for offline). The single file keeps them inline, so nothing is fetched there.
// To add a page or a data file: list it in tools/helper-files.mjs (mode "precache" or "on-use"), import it below and add it to INLINE.
import CHISEL from "./chisel.html";
import FLEXIGEN from "./flexigen.html";
import MESHSTEP from "./meshstep.html";
import THREE from "./helper-three.html";
import { withFonts } from "./helperfonts.js";

// "" in the site build (build.mjs empties these imports), the whole text in the single file
const INLINE = { "chisel.html": CHISEL, "flexigen.html": FLEXIGEN, "meshstep.html": MESHSTEP, "helper-three.html": THREE };
const STAMP = /^js3d-build:([0-9a-f]+)\n/; // the first line of every file in helpers/ (build.mjs): which build wrote it
const loaded = new Map();

async function fetchAsset(file) {
  const url = new URL("helpers/" + file, document.baseURI).href;
  let text;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(+window.__JS3D_HELPER_TIMEOUT_MS || 30000) }); // the spec shortens the wait
    if (!r.ok) throw new Error("helpers/" + file + " answered " + r.status);
    text = await r.text();
  } catch (e) {
    // The first visit: the service worker has saved the file but does not control this page yet, so offline the fetch fails and the cache still has it.
    const hit = self.caches ? await caches.match(url).catch(() => null) : null;
    if (!hit) throw new Error("helpers/" + file + " could not be fetched (" + (e && e.message || e) + ")");
    text = await hit.text();
  }
  const m = STAMP.exec(text);
  if (!m) throw new Error("helpers/" + file + " is not a helper file");
  if (m[1] !== __HELPERS_ID__) throw Object.assign(new Error("helpers/" + file + " is from another build"), { skew: true });
  return text.slice(m[0].length);
}

// The text of helpers/<file>: inline in the single file, else fetched from the same origin once and kept in memory (a failed load is forgotten, so a retry starts fresh).
export function helperAsset(file) {
  if (INLINE[file]) return Promise.resolve(INLINE[file]);
  if (!loaded.has(file)) {
    const p = fetchAsset(file);
    p.catch(() => loaded.delete(file));
    loaded.set(file, p);
  }
  return loaded.get(file);
}

// A helper page ready for an iframe's srcdoc or a Blob: the page, the shared three.js and the fonts. name: "chisel", "flexigen" or "meshstep".
export async function helperPage(name) {
  const [page, three] = await Promise.all([helperAsset(name + ".html"), helperAsset("helper-three.html")]);
  return withFonts(page, three);
}

// "Loading…" with a Close button (and Escape) behind a helper's frame until its page arrives, so a slow download never traps the user.
// onClose does what closing the helper does; note.done() removes the note when the page is there.
export function helperLoadingNote(onClose) {
  const note = document.createElement("div");
  note.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;font:500 14px system-ui,sans-serif;pointer-events:none";
  const text = document.createElement("span");
  text.textContent = "Loading…";
  text.style.opacity = ".6";
  const close = document.createElement("button");
  close.className = "btn";
  close.textContent = "Close";
  close.style.pointerEvents = "auto";
  close.onclick = () => onClose();
  note.append(text, close);
  const onKey = (e) => {
    if (!note.isConnected) { document.removeEventListener("keydown", onKey, true); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  document.addEventListener("keydown", onKey, true);
  note.done = () => { document.removeEventListener("keydown", onKey, true); note.remove(); };
  return note;
}

export const helperFailText = (tool, e) => e && e.skew ? "A newer version was installed: reload the page to use " + tool + "." : tool + " needs a connection the first time. The downloaded single file has everything built in.";
