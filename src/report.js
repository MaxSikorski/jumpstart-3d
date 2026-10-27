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

const BROWSERS = [["Edge", /Edg(?:e|A|iOS)?\/(\d+)/], ["Opera", /OPR\/(\d+)/], ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/], ["Chrome", /(?:Chrome|CriOS)\/(\d+)/], ["Safari", /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/]];
function browserName() {
  const ua = navigator.userAgent || "";
  const hit = BROWSERS.map(([name, re]) => [name, re.exec(ua)]).find(([, m]) => m);
  const os = IS_IPHONE ? "iPhone" : IS_IOS ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return (hit ? hit[0] + " " + hit[1][1] : "Unknown browser") + (os ? " on " + os : "");
}

// Error text can hold names, places and addresses, so it only goes into the report when the person ticks the box and sees it there.
// This takes out what it can recognise (quoted names, addresses with or without a scheme, paths, emails, keys); it is a second net, not the first.
// No lookbehind: older Safari fails to parse it, and that would stop the whole app.
const NOT_PATH_BEFORE = "(^|[^\\w.~\\/-])"; // a colon may come before a path ("Failed:/Users/bob/x"); a scheme's own // is taken out by the rule above
const SCRUB = [
  [/„[^“”]*[“”]|«[^»]*»|`[^`]*`|“[^”]*”|"[^"]*"|‘[^’]*’/g, "[name removed]"],
  [/(^|[^\w'])'[^'\n]+'(?!\w)/g, "$1[name removed]"], // 'single quotes' only where they open a word, so "it's" and "isn't" stay
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+|\b(?:file|blob|data|mailto):\S+/gi, "[path removed]"],
  [/\b[A-Za-z]:[\\/].*|\\\\.*|~[\\/].*/g, "[path removed]"], // Windows, network and home paths may hold spaces: to the end of the line
  [new RegExp(NOT_PATH_BEFORE + "\\/(?:Users|home|Volumes|private|mnt|media)\\/.*", "g"), "$1[path removed]"],
  [new RegExp(NOT_PATH_BEFORE + "\\/[^\\s/]+(?:\\/\\S*)+", "g"), "$1[path removed]"],
  [/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*\/\S*/gi, "[address removed]"], // any host with a path, whatever the ending (example.co.uk/x)
  // a relative path may hold spaces too ("Clients/Acme Corp/x.stl"): from its first word to the end of the line. It needs a letter in the first part and
  // a second slash (not one that starts a date) or a file ending after it (at most one space before the ending), so "1/2", "10/12/2025", "read/write" and "and/or" stay.
  [/(?:^|[\s(])(?=[^\s/]*[A-Za-z])[^\s/]+\/(?:[\p{L}\p{N}_ .-]*\/(?!\d{1,4}(?:[\s/]|$))|[\p{L}\p{N}_.-]*(?: [\p{L}\p{N}_.-]+)?\.[A-Za-z][A-Za-z0-9]{0,4}(?![.\w])).*/gu, " [path removed]"],
  [/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email removed]"],
  [/\b(?:(?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|auth|sig|signature)\s*=|(?:password|passwd|pwd|secret|api[_-]?key)\s*:)\s*\S+/gi, "[key removed]"], // the colon form only for words that are rarely ordinary ("Auth: failed" stays)
  [/\bBearer\s+\S+|\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[a-z])[-_][\w-]{8,}|\b[\w-]{32,}\b/g, "[key removed]"],
  [/\[[0-9a-f:.]*:[0-9a-f:.]*\](?::\d+)?|(?:^|[^\w:])(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?(?:%\w+)?|(?:^|[^\w:])::[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}|\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi, " [address removed]"], // IPv6, bracketed, with :: or in full
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b|\b(?=[^\s:]*[a-z])(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+|localhost):\d{2,5}\b|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|app|me|co|us|uk|de|local|lan|home|internal)\b(?:\/\S*)?/gi, "[address removed]"],
];
const clean = (text) => SCRUB.reduce((t, [re, to]) => t.replace(re, to), String(text)).replace(/\s+/g, " ").trim().slice(0, 300);

export function initReport(app) {
  // the last error the person saw: an error toast (hook in app.toast) or an uncaught error, text only
  window.addEventListener("error", (e) => { if (e.message && !/^ResizeObserver loop/.test(e.message)) app.lastError = e.message; }); // jumpstart-3d: Safari reports the harmless ResizeObserver note as an error
  window.addEventListener("unhandledrejection", (e) => { app.lastError = (e.reason && e.reason.message) || String(e.reason); });

  function details() {
    return [
      "App details (added by JumpStart 3D):",
      `- Build: community build ${BUILD} (upstream ${VERSION})`,
      `- Where: ${document.getElementById("wp-occt") ? "the downloaded jumpstart-3d.html file" : "the website"}`, // the single file embeds the engine
      `- Browser: ${browserName()}`,
      `- Mode: ${app.mode.charAt(0).toUpperCase() + app.mode.slice(1)}`,
      "Design file: drag the saved .json here (optional).",
    ].join("\n");
  }

  // the browser field follows the "- Browser:" line of the details, so deleting or changing that line changes the link
  const url = (steps, extra) => {
    const browser = /^- Browser: (.+)$/m.exec(extra);
    const q = new URLSearchParams({ template: "bug_report.yml" });
    if (browser && !browser[1].endsWith(CUT)) q.set("browser", browser[1].trim());
    if (steps) q.set("steps", steps);
    q.set("extra", extra);
    return ISSUE_URL + "?" + q.toString().replace(/\+/g, "%20");
  };
  // the longest start of the text that still gives a link under MAX_URL, with the cut note at its end ("" when not even the note fits)
  function fit(text, make) {
    if (make(text).length <= MAX_URL) return text;
    if (make(CUT).length > MAX_URL) return "";
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (make(text.slice(0, mid) + CUT).length <= MAX_URL) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + CUT;
  }
  // what was typed is cut, never the app details, unless the details alone are too long (then the typed steps are left out of the link)
  function build(typed, edited) {
    const href = url("", edited).length > MAX_URL ? url("", fit(edited, (x) => url("", x))) : url(fit(typed, (s) => url(s, edited)), edited);
    return { href: href.length > MAX_URL ? url("", "") : href, cut: href !== url(typed, edited) };
  }

  app.showReport = function () {
    const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
    const steps = el("textarea", { id: "rp-steps", rows: 3, oninput: refresh });
    const extra = el("textarea", { id: "rp-details", rows: 7, oninput: refresh });
    extra.value = details();
    const open = el("a", { class: "btn primary", id: "rp-open", target: "_blank", rel: "noopener noreferrer", onclick: () => { after.hidden = false; } }, "Open the report on GitHub");
    const cut = el("p", { class: "rp-note", id: "rp-cut", hidden: true }, "Your text was too long for a link, so some of it is left out or cut off. “Copy the details” copies everything you wrote: paste the rest on GitHub.");
    const include = el("input", { type: "checkbox", id: "rp-error", onchange: () => { toggleError(); refresh(); } });
    const errorRow = el("label", { class: "rp-check", hidden: !app.lastError }, include, "Include the last error message (it goes into the details above: check it first)");
    const after = el("p", { class: "rp-note", id: "rp-after", role: "status", hidden: true }, "Finish it on GitHub: pick where it happened, fill in “What happened” and “What should it end up as?”, then press Create.");
    function refresh() {
      const r = build(steps.value.trim(), extra.value.trim());
      open.href = r.href;
      cut.hidden = !r.cut;
    }
    function toggleError() {
      const rest = extra.value.split("\n").filter((l) => !l.startsWith("- Last error:"));
      const at = rest.findIndex((l) => l.startsWith("Design file:"));
      if (include.checked) rest.splice(at < 0 ? rest.length : at, 0, "- Last error: " + clean(app.lastError));
      extra.value = rest.join("\n");
    }
    async function copy() {
      const typed = steps.value.trim();
      try { await navigator.clipboard.writeText((typed ? typed + "\n\n" : "") + extra.value); app.toast("Copied the details."); }
      catch (e) { extra.select(); app.toast("This browser did not allow copying. The details are selected: copy them yourself."); }
    }
    const modal = el("div", { class: "modal report", role: "dialog", "aria-label": "Report a problem" },
      el("header", {}, el("h2", {}, "Report a problem"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
      el("div", { class: "mbody" },
        el("p", {}, "This opens a new bug report on GitHub with the details below already filled in. Nothing is sent until you press Create on GitHub. You need a free GitHub account."),
        el("label", {}, "What did you do? (optional: you can also write it on GitHub)", steps),
        el("label", {}, "Details added to the report (change or delete anything you like)", extra),
        errorRow,
        el("h3", {}, "Your design (optional)"),
        el("p", {}, "A copy of your design helps most. Save a copy, then drag the file into the report’s “Anything else” box. The file holds your whole design, including its name. Anyone can see it once it is attached."),
        el("button", { class: "btn", id: "rp-save", onclick: () => app.projects.saveCopy(COPY_NAME) }, "Save a copy of this design to attach"),
        cut,
        el("div", { class: "rp-actions" }, open, el("button", { class: "btn", id: "rp-copy", onclick: copy }, "Copy the details"), el("button", { class: "btn", onclick: () => back.remove() }, "Cancel")),
        after));
    refresh();
    back.append(modal);
    document.body.append(back);
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); back.remove(); } }); // jumpstart-3d: closing the dialog must not change the selection or sketch tool
    modal.querySelector(".xbtn").focus();
  };

  const entry = document.getElementById("btn-report");
  if (entry) entry.addEventListener("click", () => { document.getElementById("menu-export").hidden = true; app.showReport(); }); // no data-act: projects.js ignores it
}
