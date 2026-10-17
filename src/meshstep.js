// Mesh to STEP Helper: turns STL/3MF meshes into editable STEP solids. It runs in its own
// window over the app; "Open in JumpStart 3D" hands the STEP straight into the design.
import HELPER_HTML from "./meshstep.html";

export function initMeshStep(app) {
  let frame = null;
  window.__JS3D_STEP_CLOSE__ = () => close();
  window.__JS3D_STEP_IMPORT__ = (bytes, filename) => {
    close();
    app.advanced.importModel({ name: filename }, bytes);
  };
  // file: optional { bytes, name } to load straight into the helper
  function open(file) {
    close();
    frame = document.createElement("div");
    frame.className = "flexigen meshstep";
    const ifr = document.createElement("iframe");
    ifr.title = "Mesh to STEP Helper";
    ifr.onload = () => {
      const t = document.documentElement.getAttribute("data-ui") || "light";
      try { ifr.contentWindow.__meshstep && ifr.contentWindow.__meshstep.theme(t === "light" ? "light" : "dark"); } catch (e) {}
    };
    // a file to open straight away: the helper picks it up when it starts
    window.__JS3D_STEP_PENDING__ = file && file.bytes ? { buf: file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength), name: file.name } : null;
    ifr.srcdoc = HELPER_HTML;
    // a pop-out copy in its own browser tab (where allowed); downloads work there
    const pop = document.createElement("button");
    pop.className = "btn meshstep-pop";
    pop.textContent = "Open in a new tab ↗";
    pop.title = "Open the helper in its own browser tab. To bring a STEP back, download it there, then use Import in JumpStart 3D.";
    pop.onclick = () => {
      const url = URL.createObjectURL(new Blob([HELPER_HTML], { type: "text/html" }));
      const w = window.open(url, "_blank");
      if (!w) app.toast("Your browser blocked the new tab. The helper still works right here.", "err");
      else { close(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    };
    frame.append(ifr, pop);
    document.body.append(frame);
  }
  function close() { if (frame) { frame.remove(); frame = null; } }
  return { open, close, get isOpen() { return !!frame; } };
}
