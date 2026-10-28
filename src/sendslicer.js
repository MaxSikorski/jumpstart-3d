// Send the exported 3MF to a share sheet or download, with a one-time slicer tip.
import { el } from "./util.js";

const TIP_KEY = "jumpstart.slicertip.v1";
const CSS = `
.toast.slicer-tip { pointer-events: auto; display: flex; flex-direction: column; gap: 6px; }
.slicer-tip p { margin: 0; }
body:has(#menu-export:not([hidden])) .slicer-tip { visibility: hidden; }
.slicer-tip button { align-self: flex-start; font: inherit; min-height: 30px; padding: 2px 8px; border-radius: 5px; cursor: pointer; border: 1px solid currentColor; background: transparent; color: inherit; }
`;

function system() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Mac/.test(ua)) return "mac";
  if (/Win/.test(ua)) return "windows";
  if (/Linux|CrOS|X11/.test(ua)) return "linux";
  return "other";
}

function showTip(filename, sys, shared) {
  try { if (localStorage.getItem(TIP_KEY) === "1") return false; } catch (e) {}
  if (document.getElementById("slicer-tip")) return true;
  let text;
  if (sys === "ios" || sys === "android") {
    text = shared
      ? "You shared it. Next, open it on your computer in OrcaSlicer, PrusaSlicer, Cura or Bambu Studio (save it to Files, or send it with AirDrop or Mail). Phones and tablets have no full slicer yet."
      : "It was saved to your downloads. Send it to your computer and open it there in OrcaSlicer, PrusaSlicer, Cura or Bambu Studio (for example with AirDrop or Mail, or share it from your downloads). Phones and tablets have no full slicer yet.";
  } else if (sys === "mac") {
    text = "To open .3mf files in your slicer with a double-click: in Finder select the file, File > Get Info, under Open with pick OrcaSlicer (or PrusaSlicer, Cura or Bambu Studio), then Change All.";
  } else if (sys === "windows") {
    text = "To open .3mf files in your slicer with a double-click: right-click the file, Open with > Choose another app, pick OrcaSlicer (or PrusaSlicer, Cura or Bambu Studio) and choose Always.";
  } else {
    text = "To open .3mf files in your slicer with a double-click: right-click the file in your file manager, Open With, pick OrcaSlicer (or PrusaSlicer, Cura or Bambu Studio) and make it the default.";
  }
  const printerText = "In the slicer, pick your printer, for example a Creality Ender-3 S1 running Klipper.";
  if (!document.getElementById("slicer-tip-css")) document.head.append(el("style", { id: "slicer-tip-css" }, CSS));
  const tip = el("div", { id: "slicer-tip", class: "toast slicer-tip", role: "note" },
    el("strong", {}, (shared ? "Sent: " : "Saved: ") + filename), el("p", {}, text), el("p", {}, printerText),
    el("button", { type: "button", onclick: () => tip.remove() }, "Got it"));
  document.getElementById("toasts").append(tip);
  try { localStorage.setItem(TIP_KEY, "1"); } catch (e) {}
  return true;
}

export async function handOff(app, filename, bytes, save) {
  const sys = system();
  const mobile = sys === "ios" || sys === "android";
  if (mobile && navigator.canShare && navigator.share) {
    try {
      const file = new File([bytes], filename, { type: "model/3mf" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        showTip(filename, sys, true);
        return true;
      }
    } catch (e) { if (e.name === "AbortError") return false; }
  }
  const how = await save(filename, bytes);
  if (!how) return false;
  if (how === "zip") return true;
  if (!showTip(filename, sys, false)) app.toast("Saved " + filename + (mobile ? "." : ". Open it to slice it in your slicer."));
  return true;
}
