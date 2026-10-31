// Floor Planner: the Blueprint Floorplanner, opened from Architect in its own window over the app.
// It keeps running while hidden, so a plan is still there when it's opened again (until the page
// closes). Saving goes through JumpStart 3D, and the tutorials read its state through __fp.
// jumpstart-3d: the Floor Planner page (1 MB) loads the first time it is opened (helperpages.js), with a Loading note and Close until then
import { helperAsset, helperLoadingNote, helperFailText } from "./helperpages.js";
let FP_HTML = "";

export function initFloorPlan(app) {
  let frame = null, ifr = null, ready = false;
  const waiters = [];
  window.__JS3D_FP_CLOSE__ = () => close();
  window.__JS3D_FP_TAB__ = () => {
    const url = URL.createObjectURL(new Blob([FP_HTML], { type: "text/html" }));
    const w = window.open(url, "_blank");
    if (!w) app.toast("Your browser blocked the new tab. The Floor Planner still works right here.", "err");
    else setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  window.__JS3D_FP_READY__ = () => { ready = true; while (waiters.length) waiters.shift()(); };
  if (!window.__JS3D_SAVE__) window.__JS3D_SAVE__ = (filename, bytes) => app.projects.saveModel(filename, bytes);

  function open() {
    if (!frame) {
      frame = document.createElement("div");
      frame.className = "floorplan";
      frame.id = "floorplan";
      ifr = document.createElement("iframe");
      ifr.title = "Floor Planner";
      ifr.id = "floorplan-frame";
      ready = false;
      // jumpstart-3d: the page arrives on first use; a failed download closes the planner with a toast and is tried again next time
      const note = helperLoadingNote(() => close());
      note.style.color = "#fff";
      ifr.style.visibility = "hidden";
      const mine = frame;
      helperAsset("floorplan.html").then((html) => {
        if (frame !== mine) return;
        FP_HTML = html; note.done(); ifr.style.visibility = ""; ifr.srcdoc = html;
      }, (e) => {
        if (frame !== mine) return;
        note.done(); close(); frame.remove(); frame = ifr = null;
        app.toast(helperFailText("the Floor Planner", e), "err");
      });
      frame.append(ifr, note);
      // end jumpstart-3d
      document.body.append(frame);
    }
    frame.hidden = false;
    document.body.classList.add("fp-on");
    app.floorPlanOpen = true;
    try { ifr.contentWindow.focus(); } catch (e) {}
  }
  function close() {
    if (frame) frame.hidden = true;
    document.body.classList.remove("fp-on");
    app.floorPlanOpen = false;
  }
  const api = () => { try { return ifr && ifr.contentWindow && ifr.contentWindow.__fp; } catch (e) { return null; } };
  return {
    open, close,
    get isOpen() { return !!frame && !frame.hidden; },
    get ready() { return ready && !!api(); },
    whenReady: (f) => (ready ? f() : waiters.push(f)),
    // for the tutorials: the planner's state, and an element inside it
    state() { const a = api(); try { return a ? a.state() : null; } catch (e) { return null; } },
    el(sel) { const a = api(); return a ? a.el(sel) : null; },
    frame: () => ifr,
  };
}
