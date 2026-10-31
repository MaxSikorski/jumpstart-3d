// jumpstart-3d: the 42 extra Text fonts (J.Siwek's fonts_more.js, 1.9 MB) load on first use, not with the app. helperAsset gives his
// file as text (inline in the single file, fetched once from helpers/ on the site); it is read here as data, never run as code.
// They load when a font picker is built (the picker lists them once they are in), and before any build or STEP export of a design
// that uses a font other than the three classic ones (opening a file included). If they cannot be fetched (offline, never loaded),
// a toast says so and the text builds in Rounded sans.
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
  let state = "none", pending = null; // none | loading | ready | failed

  // load, register on this page and send to the geometry worker; resolves true when the fonts are in, false (after a toast) when not
  function load() {
    if (state === "ready") return Promise.resolve(true);
    if (pending) return pending;
    state = "loading";
    pending = helperAsset("fonts_more.js").then((text) => {
      for (const f of parseMoreFonts(text)) registerFont(f.key, f.data, f.name, f.group);
      for (const [k, b] of extraFonts()) app.kernel.addAsset("font:" + k, "font", b);
      state = "ready";
      return true;
    }, (e) => {
      state = "failed";
      app.toast(e && e.skew ? helperFailText("the extra fonts", e) : "The extra fonts need a connection the first time, so text in them uses Rounded sans for now.", "err");
      return false;
    }).finally(() => { pending = null; });
    return pending;
  }

  // builds and STEP exports of text in an extra font wait for the fonts; after a failure they go ahead in Rounded sans
  app.kernel.waitFor = (items) => {
    if (state === "ready" || state === "failed") return null;
    return items.some((it) => usesMoreFonts(JSON.stringify(it.node || it))) ? load() : null;
  };

  // a font picker starts the load (a failed one is tried again) and gets the extra fonts once they are in
  const refill = (s) => {
    const value = s.value;
    const fresh = fontSelect(s.id, value);
    s.replaceChildren(...fresh.childNodes);
    s.value = value;
  };
  fontSelect.onBuild = (s) => {
    if (state === "ready") return;
    const wait = document.createElement("option");
    wait.disabled = true; wait.textContent = "More fonts: loading…"; wait.id = s.id + "-more";
    s.append(wait);
    load().then((ok) => { if (!s.isConnected) return; if (ok) refill(s); else wait.remove(); });
  };

  return { load, get state() { return state; } };
}
