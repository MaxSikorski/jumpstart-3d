// jumpstart-3d: backup reminder, single file only. Designs in the double-click file live in the browser's storage for local files, the most
// fragile place the app can keep them. When the browser says it is online (the `online` event or navigator.onLine: no request is made) and
// designs have changed since they were last backed up, a small dismissible note offers a backup file (Your designs › Back up all designs…)
// or copies into a folder (Save copies into a folder…). Rules: at most once a day; only when a design is new or changed since the last
// backup or the last answer; "Don't ask again" stays off until turned on again in Your designs. Nothing here loads Google code or makes a
// network call, and storage access never throws. `shouldAsk` is the whole rule as a pure function (test/backupnudge.test.mjs).
import { el } from "./util.js";

export const KEY = "jumpstart.backupnudge"; // { backedUp, answered, asked: ms times; never: bool }
export const TEST_KEY = "jumpstart.backupnudge.test"; // "1": a browser under automation may show the note at once (test/backupnudge.spec.mjs)
export const DAY = 24 * 3600 * 1000;
const START_MS = 6000, IDLE_MS = 3000, POLL_MS = 1000;
const plural = (n) => `${n} design${n === 1 ? "" : "s"}`;
const time = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

// designs: [{ id, updated }] (the list in Your designs); state: what KEY holds; folderFiles: { <design id>: { updated } } of the folder copies, or null.
// A design counts as changed when it is newer than the later of the last backup and the last answer, and no folder copy holds it as it is now.
// A design with no usable time counts as changed (better one question too many than a design never asked about).
export function shouldAsk({ now, online, designs, state, folderFiles }) {
  const st = state || {};
  if (!online || st.never === true || !designs || !designs.length) return { ask: false, n: 0, changed: 0 };
  const asked = time(st.asked);
  if (asked && asked <= now && now - asked < DAY) return { ask: false, n: designs.length, changed: 0 };
  const base = Math.max(time(st.backedUp), time(st.answered));
  const files = folderFiles || {};
  const changed = designs.filter((d) => {
    const u = Number(d.updated);
    if (!(Number.isFinite(u) && u > 0)) return true;
    if (u <= base) return false;
    const c = files[d.id];
    return !(c && Number(c.updated) >= u);
  }).length;
  return { ask: changed > 0, n: designs.length, changed };
}

export function readState(storage) {
  try {
    const j = JSON.parse(storage.getItem(KEY));
    if (!j || typeof j !== "object") return {};
    return { backedUp: time(j.backedUp), answered: time(j.answered), asked: time(j.asked), never: j.never === true };
  } catch (e) { return {}; }
}
export function writeState(storage, patch) {
  try { storage.setItem(KEY, JSON.stringify({ ...readState(storage), ...patch })); return true; } catch (e) { return false; }
}

const CSS = `
.backup-nudge { position: fixed; left: 12px; bottom: 44px; z-index: 30; max-width: min(460px, calc(100vw - 24px)); padding: 10px 14px; border-radius: 8px; background: var(--block); color: var(--block-ink); font-size: 12.5px; box-shadow: 0 6px 18px rgba(0,0,0,.25); display: flex; flex-direction: column; gap: 8px; }
.backup-nudge .nudge-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.backup-nudge button { font: inherit; font-size: 11.5px; min-height: 26px; padding: 2px 10px; border-radius: 5px; cursor: pointer; border: 1px solid currentColor; background: transparent; color: inherit; }
.backup-nudge button.primary { background: var(--block-ink, #fff); color: var(--block, #18202a); border-color: var(--block-ink, #fff); font-weight: 600; }
@media (pointer: coarse) { .backup-nudge button { min-height: 34px; } }
`;

// app.projects._store (the design list) and app.projects._folder (the folder copies) are the same hooks the tests read.
export function initBackupNudge(app) {
  if (typeof location === "undefined" || location.protocol !== "file:" || window.claude) return null; // the double-click file only
  const store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  if (!store) return null;
  const rd = (k) => { try { return store.getItem(k); } catch (e) { return null; } };
  const quick = rd(TEST_KEY) === "1";
  // Under automation the note stays away (so no spec has it over a click) unless that spec opts in.
  if (navigator.webdriver && !quick) return null;

  let bar = null, timer = null, busy = false, lastActive = Date.now();
  const touch = () => { lastActive = Date.now(); };
  for (const t of ["keydown", "wheel", "pointermove"]) window.addEventListener(t, touch, { passive: true, capture: true });
  window.addEventListener("pointerdown", () => { busy = true; touch(); }, { capture: true });
  for (const t of ["pointerup", "pointercancel", "blur"]) window.addEventListener(t, () => { busy = false; touch(); }, { capture: true });

  const quiet = () => document.visibilityState === "visible" && !busy && (quick || Date.now() - lastActive >= IDLE_MS);

  const hide = () => { clearTimeout(timer); timer = null; if (bar) { bar.remove(); bar = null; } };
  const answer = (patch) => { writeState(store, { answered: Date.now(), ...patch }); hide(); };

  async function evaluate() {
    const ps = app.projects._store, folder = app.projects._folder;
    const designs = await ps.list();
    const info = await folder.info();
    const state = readState(store);
    const r = shouldAsk({ now: Date.now(), online: navigator.onLine, designs, state, folderFiles: info.files });
    return { ...r, folder: info };
  }

  function show(r) {
    if (bar) return;
    if (!document.getElementById("backup-nudge-css")) { const s = el("style", { id: "backup-nudge-css" }); s.textContent = CSS; document.head.append(s); }
    const btn = (id, label, fn, cls) => el("button", { id, type: "button", class: cls || "", onclick: fn }, label);
    bar = el("div", { class: "backup-nudge", id: "backup-nudge", role: "region", "aria-label": "Backup reminder" },
      el("div", { id: "backup-nudge-text" }, `You're online. Back up your ${plural(r.n)}?`),
      el("div", { class: "nudge-btns" },
        btn("nudge-file", "Save a backup file", async () => { try { await app.projects.backupAll(); } catch (e) {} }, "primary"), // backupAll tells us when it worked ("js3d:backup-done")
        r.folder.supported && !r.folder.chosen ? btn("nudge-folder", "Save copies into a folder", async () => { try { if (await app.projects._folder.choose()) answer({}); } catch (e) {} }) : null,
        btn("nudge-later", "Not now", () => answer({})),
        btn("nudge-never", "Don't ask again", () => { answer({ never: true }); app.toast("No more backup reminders. You can turn them back on in Your designs."); })));
    document.body.append(bar);
    writeState(store, { asked: Date.now() }); // shown: the next time is a day away whatever happens
  }

  // Checks the rule, waits until nothing is being edited or dragged, checks again, then shows the note.
  async function run() {
    if (bar) return;
    try {
      if (!(await evaluate()).ask) return;
      if (!quiet()) { schedule(POLL_MS); return; }
      const r = await evaluate();
      if (r.ask && quiet()) show(r);
    } catch (e) {}
  }
  function schedule(delay) {
    if (bar) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; run(); }, delay);
  }

  window.addEventListener("online", () => schedule(quick ? 0 : POLL_MS));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && navigator.onLine) schedule(quick ? 0 : POLL_MS); });
  window.addEventListener("js3d:backup-done", (e) => { // from backupAll, wherever it was clicked
    writeState(store, { backedUp: time(e.detail && e.detail.at) || Date.now(), answered: Date.now() });
    hide();
  });
  if (navigator.onLine) schedule(quick ? 0 : START_MS);

  return {
    check: () => { clearTimeout(timer); timer = null; return run(); }, // resolves once the rule has been checked (and the note shown); the tests call it after changing designs
    // A line in Your designs when "Don't ask again" was chosen, so it can be turned back on.
    row() {
      if (!readState(store).never) return null;
      return el("div", { class: "backup-row", id: "nudge-row" },
        el("span", {}, "Backup reminders are off."),
        el("button", { class: "btn", id: "btn-nudge-on", onclick: (e) => { writeState(store, { never: false, asked: 0 }); e.target.closest("#nudge-row").remove(); app.toast("Backup reminders are on again."); } }, "Turn on"));
    },
  };
}
