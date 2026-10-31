// jumpstart-3d: the 42 extra Text fonts (J.Siwek's fonts_more.js, 1.9 MB) are not part of the app: helperAsset gives his file as text
// (inline in the single file; on the site from helpers/, which the service worker saves quietly once the engine is ready, so they work
// offline after the first visit). It is read here as data, never run as code. The page reads them when a font picker is built (the
// picker lists them once they are in) and before any build or STEP export of a body whose text uses a font other than the three
// classic ones (opening a file included); other bodies do not wait. If they cannot be had, one toast says so and the text builds in
// Rounded sans; when a later picker gets them, that text is built again in its own font.
import { FONT_DATA, registerFont, extraFonts, fontSelect } from "./fonts.js";

// [{ key, name, group, data (base64) }] from the text of fonts_more.js
export function parseMoreFonts(text) {
  const list = /^export const MORE_FONTS = (\[.*\]);$/m.exec(text);
  if (!list) throw new Error("fonts_more.js has no font list");
  const data = new Map();
  for (const m of text.matchAll(/^ {2}([a-z0-9]+): "([A-Za-z0-9+/=]+)",?$/gm)) data.set(m[1], m[2]);
  const fonts = JSON.parse(list[1]).map((f) => ({ key: String(f.key), name: String(f.name), group: String(f.group), data: data.get(f.key) }));
  const missing = fonts.filter((f) => !f.data).map((f) => f.key);
  if (missing.length) throw new Error("fonts_more.js has no data for " + missing.join(", "));
  return fonts;
}

// does this text (a node or a set of bodies as JSON) use a font other than the classic three?
const CLASSIC = new Set(Object.keys(FONT_DATA));
export const usesMoreFonts = (json) => { for (const m of json.matchAll(/"font":"([^"]*)"/g)) if (!CLASSIC.has(m[1])) return true; return false; };

// helperAsset and helperFailText come from helperpages.js (passed in, so Node tests can import the parser above)
export function initMoreFonts(app, { helperAsset, helperFailText }) {
  let state = "none", pending = null, toasted = false; // state: none | loading | ready | failed
  const memo = new Map(); // body key -> uses an extra font
  const uses = (it) => {
    const key = it.key;
    if (key && memo.has(key)) return memo.get(key);
    const v = usesMoreFonts(key || JSON.stringify(it.node || it));
    if (key) { if (memo.size > 2000) memo.clear(); memo.set(key, v); }
    return v;
  };

  // load, register on this page and send to the geometry worker; always settles: true when the fonts are in, false (after one toast
  // per session) when not
  function load() {
    if (state === "ready") return Promise.resolve(true);
    if (pending) return pending;
    const late = state === "failed"; // text has been built in Rounded sans meanwhile
    state = "loading";
    pending = helperAsset("fonts_more.js").then((text) => {
      for (const f of parseMoreFonts(text)) registerFont(f.key, f.data, f.name, f.group);
      for (const [k, b] of extraFonts()) app.kernel.addAsset("font:" + k, "font", b);
      state = "ready";
      if (late) rebuildText();
      return true;
    }).catch((e) => {
      state = "failed";
      if (!toasted) { toasted = true; app.toast(e && e.skew ? helperFailText("the extra fonts", e) : "The extra fonts need a connection the first time, so text in them uses Rounded sans for now.", "err"); }
      return false;
    }).finally(() => { pending = null; });
    return pending;
  }

  // the fonts came in after text in them was built in Rounded sans: forget those meshes (here and in the worker) and build them again
  function rebuildText() {
    const k = app.kernel;
    for (const key of [...k.meshes.keys()]) if (uses({ key })) k.meshes.delete(key);
    if (k.worker) k.worker.postMessage({ type: "clear" });
    if (!app.scene) return;
    for (const v of app.scene.views.values()) if (v.key && uses({ key: v.key })) v.key = null; // a view redraws only when its key changes
    if (app.scene.doc) app.scene.sync(app.scene.doc);
  }

  // a body whose text uses an extra font waits for the fonts (kernelClient.js pump and step); after a failed load it goes ahead in
  // Rounded sans, and only a font picker tries again
  app.kernel.waitFor = (it) => (state === "ready" || state === "failed" || !uses(it) ? null : load());

  // a font picker starts the load and gets the extra fonts once they are in; it keeps the font it was made with (a body's own extra
  // font is not among its options until then) unless the user picked another meanwhile
  fontSelect.onBuild = (s, value) => {
    if (state === "ready") return;
    const wait = document.createElement("option");
    wait.disabled = true; wait.textContent = "More fonts: loading…"; wait.id = s.id + "-more";
    s.append(wait);
    let touched = false;
    s.addEventListener("change", () => { touched = true; });
    load().then((ok) => {
      if (!s.isConnected) return;
      if (!ok) { wait.remove(); return; }
      const keep = touched ? s.value : value;
      s.replaceChildren(...fontSelect(s.id, keep).childNodes);
      s.value = keep;
    });
  };

  return { load, get state() { return state; } };
}
