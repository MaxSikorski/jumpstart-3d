import { VERSION, BUILD } from "./version.js";

export function showSimpleAbout(app, trigger) {
  if (document.querySelector(".modal-back")) return;
  const make = (tag, text, cls) => { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; };
  const back = make("div", "", "modal-back"), modal = make("div", "", "modal about"), header = make("header"), body = make("div", "", "mbody");
  modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-label", "JumpStart 3D Community Build");
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  const close = () => { back.remove(); trigger.focus(); };
  const x = make("button", "×", "xbtn"); x.type = "button"; x.setAttribute("aria-label", "Close"); x.onclick = close;
  header.append(make("h2", "JumpStart 3D Community Build"), x);
  body.append(make("p", `Version ${VERSION} · build ${BUILD}`), make("p", "Max Sikorski's community build: free 3D design in your browser, from first shapes to real CAD and 3D printing."));
  const actions = make("div", "", "sa-actions"), button = (label, id, fn) => { const b = make("button", label, "btn"); b.type = "button"; b.id = id; b.onclick = fn; return b; };
  const link = (label, href) => { const a = make("a", label); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; return a; };
  const repo = "https://github.com/MaxSikorski/jumpstart-3d", discussions = repo + "/discussions";
  actions.append(button("Check for updates", "sa-check", e => app.checkForUpdates(e.currentTarget)), button("Report a problem", "sa-report", () => { close(); app.showReport(); }), link("Request a feature", discussions), link("Get help", discussions), link("Community build on GitHub", repo));
  const status = make("p", "", "ab-upmsg"); status.id = "ab-upmsg"; status.setAttribute("role", "status"); status.hidden = true;
  const support = make("p"); support.append(link("One-time", "https://buy.stripe.com/28E4gydyeetR0S9aNb0gw08"), " · ", link("Monthly", "https://buy.stripe.com/7sYcN479Q71p44l1cB0gw09"), " · ", link("GitHub Sponsors", "https://github.com/sponsors/MaxSikorski"));
  const footer = make("p"); footer.append("License: ", link("AGPL-3.0", repo + "/blob/main/LICENSE"), ". Free software, with no warranty. ", link("Source code", repo));
  body.append(actions, status, make("h3", "Support Max"), make("p", "Building this takes time and money. If it helps you, you can chip in:"), support, footer);
  actions.style.cssText = "display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:4px 0 8px";
  modal.append(header, body); back.append(modal); document.body.append(back);
  back.addEventListener("click", e => { if (e.target === back) close(); });
  back.addEventListener("keydown", onKey); // on its own backdrop: an Escape from elsewhere is sent here by escapekey.js
  x.focus();
}
