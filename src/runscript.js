// jumpstart-3d: run script. "Run script…" in the Open/Export menu: pick a .js file and run it with
// JS3D (see BRIDGE.md) and app in scope, so nobody has to open the browser console. The file runs
// with the same trust as text pasted into the console: it is the user's own file, in their own page.
// The runner itself is JS3D.run (bridge.js). Nothing runs on its own: no URL parameter, no auto-run on load, no remembered file.
export function initRunScript(app) {
  const button = document.querySelector('#menu-export button[data-act="runscript"]');
  if (!button) return;
  const input = document.createElement("input");
  input.type = "file";
  input.id = "file-script";
  input.accept = ".js,text/javascript";
  input.hidden = true;
  document.body.append(input);

  let running = false;
  button.addEventListener("click", () => {
    if (running) { app.toast("A script is still running.", "err"); return; }
    input.click();
  });
  input.onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    running = true;
    app.toast(`Running ${file.name}…`);
    try {
      const result = await window.JS3D.run(await file.text());
      app.toast(result === undefined ? "Script finished" : "Script finished: " + oneLine(result));
    } catch (err) {
      app.toast("Script failed: " + ((err && err.message) || String(err)), "err");
    } finally { running = false; }
  };
}

function oneLine(value, max = 200) {
  let s;
  try { s = typeof value === "object" ? JSON.stringify(value) : String(value); } catch (e) { s = String(value); }
  s = String(s).replace(/\s+/g, " ");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
