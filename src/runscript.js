// jumpstart-3d: run script. "Run script…" in the Open/Export menu: pick a .js file and run it with
// JS3D (see BRIDGE.md) and app in scope, so nobody has to open the browser console. The file runs
// with the same trust as text pasted into the console: it is the user's own file, in their own page.
// Nothing runs on its own: no URL parameter, no auto-run on load, no remembered file.
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
      const result = await runScript(await file.text(), app);
      app.toast(result === undefined ? "Script finished" : "Script finished: " + oneLine(result));
    } catch (err) {
      app.toast("Script failed: " + ((err && err.message) || String(err)), "err");
    } finally { running = false; }
  };
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Two shapes of script are accepted. A plain script (like tools/bridge-demo.js, whose last statement is an
// async IIFE) is run with eval so the value of its last statement comes back and its promise is awaited.
// A script with top-level await or a trailing return does not parse as a plain script; it is run as the body
// of an async function instead. The eval lives in a string so the bundler never sees a direct eval.
async function runScript(text, app) {
  let began = false;
  const asScript = new AsyncFunction("JS3D", "app", "__src", "__began", "return eval('__began();\\n' + __src)");
  try {
    return await asScript(window.JS3D, app, text, () => { began = true; });
  } catch (e) {
    if (began || !(e instanceof SyntaxError)) throw e; // the script itself failed
  }
  return await new AsyncFunction("JS3D", "app", text)(window.JS3D, app);
}

function oneLine(value, max = 200) {
  let s;
  try { s = typeof value === "object" ? JSON.stringify(value) : String(value); } catch (e) { s = String(value); }
  s = String(s).replace(/\s+/g, " ");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
