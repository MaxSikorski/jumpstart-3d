// Built bodies remembered in this browser (IndexedDB), so a design opens at once the next time
// instead of rebuilding every body in the geometry engine (a body with spiral cuts can take
// minutes). Only bodies that took a while to build are kept; the newest 250 stay.
// Every call fails quietly: without storage the app simply builds as before.
// jumpstart-3d: embedded geometry never reaches persistent storage.
import { embedActive } from "./embedmode.js";
const DB = "jumpstart3d-meshes", STORE = "m", MAX = 250;
let dbp = null;
function open(version) {
  // jumpstart-3d: embed cache
  if (embedActive()) return Promise.resolve(null);
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { const s = rq.result.createObjectStore(STORE, { keyPath: "k" }); s.createIndex("t", "t"); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
      setTimeout(() => resolve(null), 3000);
    } catch (e) { resolve(null); }
  });
  return dbp;
}
// A body's recipe with its decimals rounded to 6 places (a millionth of a mm). The same design
// worked out in another browser (Safari, Chrome) or on another computer can differ in the last
// digits of a number (12.185732119529888 / 12.18573211952989), and built shapes saved in this
// browser or in a project file must still be found.
export function looseKey(key) {
  return String(key).replace(/-?\d+\.\d+(?:e[-+]?\d+)?|-?\d+e[-+]?\d+/gi, (t) => {
    const v = Math.round(parseFloat(t) * 1e6) / 1e6;
    return Object.is(v, -0) ? "0" : String(v);
  });
}
// a short name for a long body key (the key is the body's whole recipe)
export function hashKey(version, key) {
  key = looseKey(key);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const s = version + "|" + key;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + ":" + s.length;
}
export async function diskGet(version, key) {
  // jumpstart-3d: embed cache
  if (embedActive()) return null;
  const db = await open(version);
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite"), st = tx.objectStore(STORE);
      const k = hashKey(version, key);
      const rq = st.get(k);
      rq.onsuccess = () => {
        const r = rq.result;
        if (r && looseKey(r.key) === looseKey(key)) { r.t = Date.now(); try { st.put(r); } catch (e) {} resolve({ mesh: r.mesh, ms: r.ms || 0 }); }
        else resolve(null);
      };
      rq.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
export async function diskPut(version, key, mesh, ms = 0) {
  // jumpstart-3d: embed cache
  if (embedActive()) return;
  const db = await open(version);
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite"), st = tx.objectStore(STORE);
    st.put({ k: hashKey(version, key), key, t: Date.now(), mesh, ms });
    const cnt = st.count();
    cnt.onsuccess = () => {
      let extra = cnt.result - MAX;
      if (extra <= 0) return;
      const cur = st.index("t").openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c && extra-- > 0) { c.delete(); c.continue(); } };
    };
  } catch (e) {}
}
