// jumpstart-3d: load. The geometry engine's download shows as a small note over the 3D view instead of a full-screen splash; the splash goes as soon as the workspace is built. The hosted site registers sw.js once the engine is ready, so the next visit loads from this computer and works offline. Never the single file (opened from disk, engine embedded).
const $ = (id) => document.getElementById(id);

export function initLoadUI(app) {
  const box = $("engine"), msg = $("engine-msg"), bar = $("engine-bar");
  const got = {};
  let registered = false;
  box.hidden = false;
  const sw = swAvailable() ? navigator.serviceWorker : null;
  const had = !!sw?.controller; // the first install takes no page over: no message then
  sw?.addEventListener("controllerchange", () => { if (had) app.toast("A new version of JumpStart 3D is ready. Reload the page to use it."); });
  return {
    progress(m, total) {
      box.hidden = false; box.classList.remove("err");
      if (m.phase === "compile") { msg.textContent = "Starting the geometry engine…"; bar.style.width = "100%"; return; }
      got[m.part] = m.got;
      const sum = Object.values(got).reduce((a, b) => a + b, 0);
      const pct = Math.min(99, Math.floor((sum / (total || m.size || 1)) * 100));
      msg.textContent = `Loading the geometry engine… ${pct}%`;
      bar.style.width = pct + "%";
    },
    ready() {
      box.hidden = true; box.classList.remove("err");
      if (sw && !registered) { registered = true; sw.register("sw.js").catch(() => {}); } // refused (private window, test browser): the site works as before
    },
    fail(why) {
      box.hidden = false; box.classList.add("err");
      msg.textContent = `The geometry engine couldn't start: ${why}. Reload the page to try again.`;
      app.toast("The geometry engine couldn't start. Reload the page to try again.", "err");
    },
    hideSplash() {
      const s = $("loading");
      s.classList.add("done");
      setTimeout(() => { s.hidden = true; }, 450);
    },
  };
}

// the hosted site only: not the single file (opened from disk, engine embedded)
const swAvailable = () => "serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !document.getElementById("wp-occt");
