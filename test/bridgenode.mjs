// Loads src/bridge.js in Node with small stand-ins for the browser, so a node test can call window.JS3D
// without a browser: argument checks, error messages and the list of calls. Calls that need the geometry
// engine, the 3D view or a dialog are for the Playwright specs.
import { registerHooks } from "node:module";

const tp = new URL("../third_party/", import.meta.url).href;
// These module hooks apply to the whole test process.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "three") return { url: tp + "three/build/three.module.js", shortCircuit: true };
    if (spec === "opentype.js") return { url: "data:text/javascript,export default {parse(){throw new Error('no fonts in node')}};", shortCircuit: true };
    return next(spec, ctx);
  },
});

const stubEl = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, addEventListener() {}, appendChild() {}, append() {}, remove() {}, querySelector: () => null, getContext: () => null });
const memory = new Map();
globalThis.window ??= globalThis;
globalThis.document ??= { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: stubEl, addEventListener() {}, body: stubEl(), documentElement: stubEl() };
// Node 26 has its own experimental localStorage that warns when read: replace it outright
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) } });
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.location ??= { href: "http://localhost/", origin: "http://localhost", search: "", hash: "" };

const { initBridge } = await import("../src/bridge.js");
const { store, newDoc } = await import("../src/store.js");
const on = store.on;
let unsubscribers = [];
store.on = function (fn) {
  const unsubscribe = on.call(this, fn);
  unsubscribers.push(unsubscribe);
  return unsubscribe;
};

// A fresh window.JS3D on a blank design. `app` fields override the stand-in app (mode, scene, advanced, ...).
export function bridge(app = {}) {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  memory.clear();
  const toasts = [];
  const fake = {
    mode: "beginner",
    sel: [], select(ids) { this.sel = ids; }, exitSketch() {}, toast: (text, kind) => toasts.push([text, kind]),
    advanced: {}, projects: { saveNow() {}, newDesign() {} },
    scene: { errors: new Map(), views: new Map(), allBox: () => ({ isEmpty: () => true }) },
    vp: { setView() {}, isMoving: () => false },
    ...app,
  };
  store.load(newDoc());
  initBridge(fake);
  return { api: globalThis.window.JS3D, app: fake, store, toasts };
}
