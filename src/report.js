// jumpstart-3d: report a problem. A dialog (Open/Export menu and About) that builds a link to a new bug
// report on GitHub with the app details already filled in. Nothing is sent by the app: the link is a plain
// anchor the person presses, and GitHub shows its own form first. The link never carries the design, its
// name, file names or paths, the page address, the raw browser string or anything stored in the browser.
import { el, IS_IOS, IS_IPHONE } from "./util.js";
import { ICON } from "./icons.js";
import { VERSION, BUILD } from "./version.js";

// A constant, not read from any response. A fork changes this one line.
const ISSUE_URL = "https://github.com/MaxSikorski/jumpstart-3d/issues/new";
const MAX_URL = 5999; // some servers refuse addresses of 6000 characters or more
const CUT = "…(cut here: paste the rest on GitHub)";
const COPY_NAME = "design-for-bug-report.json";
const PATHS = /\b(?:file|blob|data):\S+|https?:\/\/\S+|\/(?:Users|home)\/\S+|[A-Za-z]:\\\S+/g;

const BROWSERS = [["Edge", /Edg(?:e|A|iOS)?\/(\d+)/], ["Opera", /OPR\/(\d+)/], ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/], ["Chrome", /(?:Chrome|CriOS)\/(\d+)/], ["Safari", /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/]];
function browserName() {
  const ua = navigator.userAgent || "";
  const hit = BROWSERS.map(([name, re]) => [name, re.exec(ua)]).find(([, m]) => m);
  const os = IS_IPHONE ? "iPhone" : IS_IOS ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return (hit ? hit[0] + " " + hit[1][1] : "Unknown browser") + (os ? " on " + os : "");
}

const clean = (text) => String(text).replace(PATHS, "[path removed]").replace(/\s+/g, " ").trim().slice(0, 300);

export function initReport(app) {
  // the last error the person saw: an error toast (hook in app.toast) or an uncaught error, text only
  window.addEventListener("error", (e) => { if (e.message) app.lastError = e.message; });
  window.addEventListener("unhandledrejection", (e) => { app.lastError = (e.reason && e.reason.message) || String(e.reason); });

  function details() {
    const error = app.lastError ? clean(app.lastError) : "";
    return [
      "App details (added by JumpStart 3D):",
      `- Build: community build ${BUILD} (upstream ${VERSION})`,
      `- Where: ${document.getElementById("wp-occt") ? "the downloaded jumpstart-3d.html file" : "the website"}`, // the single file embeds the engine
      `- Browser: ${browserName()}`,
      `- Mode: ${app.mode.charAt(0).toUpperCase() + app.mode.slice(1)}`,
      ...(error ? [`- Last error shown: ${error}`] : []),
      "Design file: drag the saved .json here (optional).",
    ].join("\n");
  }

  const url = (steps, extra) => {
    const q = new URLSearchParams({ template: "bug_report.yml", browser: browserName() });
    if (steps) q.set("steps", steps);
    q.set("extra", extra);
    return ISSUE_URL + "?" + q.toString().replace(/\+/g, "%20");
  };
  // the longest start of the text that still gives a link under MAX_URL, with the cut note at its end
  function fit(text, make) {
    if (make(text).length <= MAX_URL) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (make(text.slice(0, mid) + CUT).length <= MAX_URL) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + CUT;
  }
  // what was typed is cut, never the app details, unless the details alone are too long
  function build(typed, edited) {
    if (url("", edited).length > MAX_URL) { const extra = fit(edited, (x) => url("", x)); return { href: url("", extra), cut: true }; }
    const steps = fit(typed, (s) => url(s, edited));
    return { href: url(steps, edited), cut: steps !== typed };
  }

  app.showReport = function () {
    const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
    const steps = el("textarea", { id: "rp-steps", rows: 3, oninput: refresh });
    const extra = el("textarea", { id: "rp-details", rows: 7, oninput: refresh });
    extra.value = details();
    const open = el("a", { class: "btn primary", id: "rp-open", target: "_blank", rel: "noopener noreferrer", onclick: () => { after.hidden = false; } }, "Open the report on GitHub");
    const cut = el("p", { class: "rp-note", id: "rp-cut", hidden: true }, "Your text was too long for a link, so the end was cut. Use “Copy the details” below and paste the rest on GitHub.");
    const after = el("p", { class: "rp-note", id: "rp-after", role: "status", hidden: true }, "Finish it on GitHub: pick where it happened, fill in “What happened” and “What should it end up as?”, then press Create.");
    function refresh() {
      const r = build(steps.value.trim(), extra.value.trim());
      open.href = r.href;
      cut.hidden = !r.cut;
    }
    async function copy() {
      try { await navigator.clipboard.writeText(extra.value); app.toast("Copied the details."); }
      catch (e) { extra.select(); app.toast("This browser did not allow copying. The details are selected: copy them yourself."); }
    }
    const modal = el("div", { class: "modal report", role: "dialog", "aria-label": "Report a problem" },
      el("header", {}, el("h2", {}, "Report a problem"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
      el("div", { class: "mbody" },
        el("p", {}, "This opens a new bug report on GitHub with the details below already filled in. Nothing is sent until you press Create on GitHub. You need a free GitHub account."),
        el("label", {}, "What did you do? (optional: you can also write it on GitHub)", steps),
        el("label", {}, "Details added to the report (change or delete anything you like)", extra),
        el("h3", {}, "Your design (optional)"),
        el("p", {}, "A copy of your design helps most. Save a copy, then drag the file into the report’s “Anything else” box. The file holds your whole design, including its name. Anyone can see it once it is attached."),
        el("button", { class: "btn", id: "rp-save", onclick: () => app.projects.saveCopy(COPY_NAME) }, "Save a copy of this design to attach"),
        cut,
        el("div", { class: "rp-actions" }, open, el("button", { class: "btn", id: "rp-copy", onclick: copy }, "Copy the details"), el("button", { class: "btn", onclick: () => back.remove() }, "Cancel")),
        after));
    refresh();
    back.append(modal);
    document.body.append(back);
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") back.remove(); });
    modal.querySelector(".xbtn").focus();
  };

  const entry = document.getElementById("btn-report");
  if (entry) entry.addEventListener("click", () => { document.getElementById("menu-export").hidden = true; app.showReport(); }); // no data-act: projects.js ignores it
}
