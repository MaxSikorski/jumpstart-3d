// jumpstart-3d: designs on your own server. Your designs gets a second tab, "Your server": the designs in a folder on a
// WebDAV server (Nextcloud, a NAS, Apache, nginx), listed, opened, saved and deleted by hand as the same project files
// the folder copies use (<name>-<id>.json holding { app, version, doc }). Nothing runs by itself.
// A matching .json.thumb holds the browser's JPEG data URI so listing never needs the full design.
// The address, user and files live in localStorage "jumpstart.remote":
// { url, user, remember, pass?, files: { <design id>: { file, tag, sum } } } where tag is the server's version stamp
// and sum a fingerprint of the content both sides held at the last Open or Save.
// The rule: a design is replaced only when its side has not changed since then; if both sides changed, nothing is
// overwritten (Open makes a copy, Save asks). Nothing here throws into the app or writes to the console.
import { el, uid } from "./util.js";
import { store } from "./store.js";

const KEY = "jumpstart.remote", WAIT = 30_000, DAV = "DAV:";
const plural = (n) => `${n} design${n === 1 ? "" : "s"}`;
const PROPFIND = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>';
const T = {
  intro: "Keep designs in a folder on your own WebDAV server (Nextcloud, a NAS, Apache or nginx) and open them on any device.",
  bad: "That isn't a folder address. It starts with https:// and ends with the folder, for example https://cloud.example.com/remote.php/dav/files/you/JumpStart/",
  creds: "Leave the user name and password out of the address and type them in the fields below.",
  mixed: "This page is on https, so the browser won't let it reach an http:// server. Use the server's https:// address, or put this page on the server next to the folder (see “Setting up your server” in the README).",
  moved: "The server sent this address somewhere else (a redirect). Type the address it moves to.",
  missing: "Type your user name and password (on Nextcloud, an app password).",
  denied: "The server refused that user name or password. Check them (on Nextcloud, use an app password) and click Connect again.",
  forbidden: "The server refused access to this folder (403).",
  nolist: "The server can't list this folder (it doesn't answer PROPFIND). Check the address; on nginx, listing needs the dav-ext module.",
  gone: "The folder wasn't found on the server (404). Check the address, or create it:",
  goneTest: "The folder wasn't found on the server (404): check the address.",
  space: "The server is out of space.",
  unreadable: "The server's answer couldn't be read as a WebDAV folder list. Check the address.",
  net: "Could not reach the server. The usual causes: the server doesn't allow this page yet (see “Setting up your server” in the README), the address is wrong, the server is off or asleep, its certificate isn't trusted yet (open the address in a new tab once), you're offline, or the browser blocked a local-network address.",
  file: " Opened from a file, the page also needs the server to allow every origin (*).",
  slow: "The server didn't answer within 30 seconds.",
  full: "This browser's storage is full, so the design couldn't be added. Free space or delete designs first.",
  refused: "The server refused to replace it (412). Open the server's copy and save again.",
  kept: "Not saved to the server. Open the server's copy to see it; your design here is unchanged.",
  note: "The password is sent only to this address. Without the tick it is forgotten when you close the page. The server has to allow this page: see “Setting up your server” in the README.",
};
class Err extends Error {}

// the same design apart from save time and the bodies' internal keys (the rule of restoreDesigns' same())
const norm = ({ _updated, bodies, ...r }) => JSON.stringify({ ...r, bodies: (bodies || []).map(({ _key, ...x }) => x) });
const sum = (doc) => {
  const s = norm(doc);
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + "." + s.length;
};
const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return null; } };
const sameName = (a, b) => a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase(); // Mac and Windows disks ignore case
const shown = (file) => file.replace(/(?:-d[a-z0-9]{7,})?\.json$/i, "");
const mk = (user, pass) => "Basic " + btoa(String.fromCharCode(...new TextEncoder().encode(user + ":" + pass)));

// Returns { url } with a trailing slash, or { error }. protocol is the page's own (location.protocol).
// On a served page a typed address may also start with /, ./ or ../ and is then taken from the page's own address (a bare
// "nas/share/" is refused: it would go to the page's server, password and all). lenient is for storage.json, which the
// site's operator wrote, so "designs/" is fine there. From a file nothing relative is an address.
function check(typed, protocol, page = location.href, { lenient = false } = {}) {
  let u;
  const t = String(typed).trim();
  if (!lenient && !/^(https?:\/\/|\/|\.\.?\/)/i.test(t)) return { error: T.bad };
  try { u = new URL(t, protocol === "file:" ? undefined : page); } catch (e) { return { error: T.bad }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { error: T.bad };
  if (u.username || u.password) return { error: T.creds };
  if (protocol === "https:" && u.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return { error: T.mixed };
  u.hash = ""; u.search = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return { url: u.href };
}

// The files of a PROPFIND answer: { file, id, etag, mtime, tag }, newest first. Namespace-aware (Nextcloud d:, Apache D:/lp1:, none).
function parse(text, base) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length || xml.documentElement.localName !== "multistatus") throw new Err(T.unreadable);
  const first = (p, n) => p.getElementsByTagNameNS(DAV, n)[0];
  const basePath = dec(new URL(base).pathname.replace(/\/$/, ""));
  const out = [], previews = new Map();
  for (const r of xml.getElementsByTagNameNS(DAV, "response")) try {
    const href = first(r, "href"), p = {};
    if (!href) continue;
    for (const ps of r.getElementsByTagNameNS(DAV, "propstat")) {
      const st = first(ps, "status");
      if (st && !/\s2\d\d(\s|$)/.test(st.textContent)) continue;
      for (const n of ["getlastmodified", "getetag", "resourcetype"]) if (!p[n] && first(ps, n)) p[n] = first(ps, n);
    }
    const path = new URL(href.textContent.trim(), base).pathname.replace(/\/$/, "");
    if ((p.resourcetype && p.resourcetype.getElementsByTagNameNS(DAV, "collection").length) || dec(path) === basePath) continue;
    const file = dec(path.split("/").pop());
    if (!file || file.startsWith(".")) continue;
    const etag = p.getetag ? p.getetag.textContent.trim() : "", mod = p.getlastmodified ? p.getlastmodified.textContent.trim() : "";
    if (file.endsWith(".json.thumb")) { previews.set(file, etag || mod); continue; }
    if (!/\.json$/i.test(file)) continue;
    out.push({ file, id: (/-(d[a-z0-9]{7,})\.json$/i.exec(file) || [])[1] || null, etag, mtime: Date.parse(mod) || 0, tag: etag || mod });
  } catch (e) { /* a response we can't read is skipped */ }
  return out.sort((a, b) => b.mtime - a.mtime).map((item) => ({ ...item, preview: previews.has(item.file + ".thumb"), previewTag: previews.get(item.file + ".thumb") || item.tag }));
}

export function initRemote({ ps, toast, fileSafe, open, thumbnail }) {
  let rec = null, auth = null, base = "", items = null, conflict = null, busy = false, tried = false, dflt = "", pend = null;
  let previewRun = 0, previewActive = 0, previewQueue = [];
  const thumbButtons = new WeakMap();
  let status = { text: T.intro, red: false }, panel = null, closeModal = () => {};
  try { const j = JSON.parse(localStorage.getItem(KEY)), c = j && typeof j.url === "string" ? check(j.url, location.protocol) : {}; if (c.url && j.files && typeof j.files === "object") rec = { url: c.url, user: String(j.user || ""), remember: !!j.remember, pass: typeof j.pass === "string" ? j.pass : undefined, files: j.files }; } catch (e) {}
  const writeRec = () => { try { localStorage.setItem(KEY, JSON.stringify({ url: rec.url, user: rec.user, remember: rec.remember, ...(rec.remember && rec.pass ? { pass: rec.pass } : {}), files: rec.files })); } catch (e) {} };
  const host = () => new URL(base).host;

  const lead = () => el("p", { class: "hint", id: "remote-status", style: { margin: "0 0 12px", color: status.red ? "var(--danger)" : "var(--ink-3)" } }, status.text,
    status.mkcol ? el("button", { class: "btn", id: "btn-remote-mkcol", style: { marginLeft: "8px" }, onclick: () => act(mkcol) }, "Create the folder") : null);
  const say = (text, red = false, mkcol = false) => {
    status = { text, red, mkcol };
    const s = panel && panel.querySelector("#remote-status");
    if (s) s.replaceWith(lead());
  };
  const lock = (on) => { if (panel) for (const b of panel.querySelectorAll("button")) b.disabled = on; };
  // one action at a time; nothing is retried
  async function act(fn) {
    if (busy) return;
    busy = true; lock(true);
    try { await fn(); }
    catch (e) {
      say(e instanceof Err ? e.message : "Something went wrong: " + ((e && e.message) || e), true, !!(e && e.missing));
      if (!auth && panel && !panel.querySelector("#remote-form")) render(); // signed out while connected
    } finally { busy = false; lock(false); }
  }

  // name "" is the folder. A status outside 2xx throws its text, except those in allow (true: all).
  // A 401 signs out except for optional previews, which may have different permissions from the designs.
  async function call(method, name, { body, headers, allow, probe, preview } = {}) { // probe: a test that must not touch the saved record
    if (!auth) throw new Err(T.denied);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), WAIT);
    try {
      let r, text = "";
      try {
        r = await fetch(base + (name ? encodeURIComponent(name) : ""), { method, headers: { Authorization: auth, ...headers }, body, credentials: "omit", cache: "no-store", redirect: "manual", signal: ctl.signal });
        if (method === "GET" || method === "PROPFIND") text = await r.text();
      } catch (e) { // fetch fails with a TypeError for CORS, DNS, TLS, offline and the like
        if (e && e.name === "AbortError") throw new Err(T.slow);
        throw e instanceof TypeError ? new Err(T.net + (location.protocol === "file:" ? T.file : "")) : e;
      }
      const s = r.status;
      if (r.type === "opaqueredirect" || (s >= 300 && s < 400)) throw new Err(T.moved); // a redirect would send the password on
      if (s === 401 && !preview) { auth = null; if (rec && !probe) { delete rec.pass; writeRec(); } }
      if (s === 401 || !((s >= 200 && s < 300) || allow === true || (allow || []).includes(s))) {
        throw new Err(s === 401 ? T.denied : s === 403 ? T.forbidden : s === 405 && method === "PROPFIND" ? T.nolist : s === 507 ? T.space : `The server answered with error ${s}.`);
      }
      return { status: s, text };
    } finally { clearTimeout(timer); }
  }
  // Keep the limit across refreshes too: old requests finish before taking new queue entries.
  function loadPreviews() {
    while (previewActive < 4 && previewQueue.length) {
      const { item, run } = previewQueue.shift();
      previewActive++;
      (async () => {
        try {
          const g = await call("GET", item.file + ".thumb", { preview: true });
          if (run !== previewRun || !auth || !items?.includes(item)) return;
          if (g.text.length <= 200_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(g.text)) {
            item.thumb = g.text;
            const button = thumbButtons.get(item);
            if (button) button.style.backgroundImage = `url(${item.thumb})`;
          }
        } catch (e) { /* previews are optional; the card remains usable */ }
        finally { previewActive--; loadPreviews(); }
      })();
    }
  }
  async function list(withPreviews = true, saved = null) {
    let run = previewRun;
    let r;
    try { r = await call("PROPFIND", "", { headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, body: PROPFIND, allow: [404] }); }
    catch (e) { if (run !== previewRun) return null; throw e; }
    if (run !== previewRun) return null;
    if (r.status === 404) throw Object.assign(new Err(T.gone), { missing: true }); // never created by itself: a typo must not make folders
    const found = parse(r.text, base);
    if (!withPreviews) return found;
    run = ++previewRun;
    const previous = new Map((items || []).map((item) => [item.file, item]));
    for (const item of found) {
      const cached = previous.get(item.file);
      if (saved && item.file === saved.file) item.thumb = saved.thumb;
      else if (item.preview && cached && item.previewTag && item.previewTag === cached.previewTag) item.thumb = cached.thumb;
    }
    items = found;
    previewQueue = items.filter((item) => item.preview && !item.thumb && !(saved && item.file === saved.file)).map((item) => ({ item, run }));
    loadPreviews();
    return items;
  }
  const hello = () => say(`Connected to ${host()}: ${plural(items.length)} there.`);

  // the form's fields as { url, user, pass, remember }, or null after saying what is wrong
  function fields() {
    const f = (n) => panel.querySelector("#remote-" + n), user = f("user").value.trim(), pass = f("pass").value;
    const c = check(f("url").value, location.protocol);
    if (c.error) return void say(c.error, true);
    if (!user || !pass) return void say(T.missing, true);
    return { url: c.url, user, pass, remember: f("remember").checked };
  }
  async function attempt(c) {
    previewRun++; previewQueue = []; items = null;
    base = c.url; auth = mk(c.user, c.pass);
    say(`Connecting to ${host()}…`);
    try { if (!await list()) return; } catch (e) { auth = null; pend = e.missing ? c : null; throw e; }
    pend = null;
    rec = { url: c.url, user: c.user, remember: c.remember, pass: c.pass, files: rec && rec.url === c.url ? rec.files : {} };
    writeRec(); render(); hello();
  }
  const connect = () => { const c = fields(); return c && act(() => attempt(c)); };
  // Test connection: the same checks and the same listing, but nothing is kept
  const trial = () => {
    const c = fields();
    return c && act(async () => {
      base = c.url; auth = mk(c.user, c.pass);
      try {
        const r = await call("PROPFIND", "", { headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, body: PROPFIND, allow: [404], probe: true });
        if (r.status === 404) return say(T.goneTest, true);
        say(`The server answered: the folder has ${plural(parse(r.text, base).length)}. Click Connect to use it.`);
      } finally { auth = null; }
    });
  };
  async function mkcol() { // only from the button after a 404
    const c = pend || rec;
    if (!c || !c.pass) return;
    const was = { auth, base }; // a failed MKCOL must not sign out a connected user
    base = c.url; auth = mk(c.user, c.pass);
    try {
      const r = await call("MKCOL", "", { allow: true });
      if (r.status < 200 || r.status >= 300) throw new Err(`The folder can't be made there (${r.status}). Check the address.`);
    } catch (e) { if (auth) ({ auth, base } = was); throw e; }
    toast(`Created the folder “${dec(new URL(base).pathname.replace(/\/$/, "").split("/").pop())}” on the server.`);
    await attempt(c);
  }
  async function fillDefault() { // storage.json beside the page: only a default for a browser with no address
    if (tried || (rec && rec.url) || !/^https?:$/.test(location.protocol)) return;
    tried = true;
    try {
      const r = await fetch("storage.json", { cache: "no-store" });
      const j = r.status === 200 ? await r.json() : null, c = j && typeof j.webdav === "string" ? check(j.webdav, location.protocol, location.href, { lenient: true }) : null, f = panel && panel.querySelector("#remote-url");
      if (c && c.url) { dflt = c.url; if (f && !f.value) f.value = c.url; }
    } catch (e) {}
  }
  async function show() {
    if (!panel || !panel.isConnected) return; // the modal is gone
    conflict = null; pend = null;
    if (!auth && rec && rec.pass) { base = rec.url; auth = mk(rec.user, rec.pass); }
    if (!auth) { say(T.intro); render(); fillDefault(); return; }
    if (!busy) say(`Connecting to ${host()}…`);
    render();
    await act(async () => { if (!await list()) return; render(); hello(); });
  }
  function forget() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    previewRun++; previewQueue = [];
    rec = null; auth = null; items = null; conflict = null;
    show();
  }

  async function openItem(item) {
    const g = await call("GET", item.file);
    if (!rec) return; // forgotten meanwhile
    let j = null;
    try { j = JSON.parse(g.text); } catch (e) {}
    const raw = j && j.app === "jumpstart-3d" && !j.backup && j.doc, id = raw && (raw.id || item.id);
    if (!raw || !Array.isArray(raw.bodies) || !Array.isArray(raw.sketches) || !id) throw new Err(`“${item.file}” isn't a JumpStart 3D design file.`);
    const doc = { ...raw, id }, nm = doc.name || "Untitled", t = item.mtime || Date.now(), ssum = sum(doc), had = rec.files[id];
    // the base of the put is the stamp read here, not the page-wide one that another read in this tab may have moved on
    // only "no entry and nothing stored" means no local copy; a copy that can't be read must not be replaced
    let local = null, odd = false;
    try { const s = await ps.get(id); local = s ? JSON.parse(s) : null; } catch (e) { odd = true; }
    if (odd || (!local && (await ps.list()).some((e) => e.id === id)) || (local && typeof local !== "object")) odd = true;
    const put = async (did, d) => { if (!await ps.put(did, JSON.stringify({ ...d, id: did, _updated: t }), { id: did, name: d.name || "Untitled", ver: d.ver || 0, mode: d.mode, updated: t, thumb: item.thumb || null }, did === id && local ? +local._updated || 0 : 0)) throw new Err(T.full); };
    let go = id, mark = true, msg = `Opened “${nm}” from the server.`;
    if (!odd && !local) await put(id, doc);
    else if (!odd && sum(local) === ssum) { /* already the same */ }
    else if (!odd && had && sum(local) === had.sum) await put(id, doc); // unchanged here since the last Open or Save: nothing of ours is lost
    else if (!odd && had && ssum === had.sum) { mark = false; msg = `Opened “${nm}”: the copy in this browser has changes the server doesn't have yet. Save it to the server to send them.`; }
    else { // both changed, never met, or unreadable here: keep both
      go = uid("d"); mark = false;
      const copy = nm + " (from server)";
      await put(go, { ...doc, name: copy });
      msg = odd ? `This browser's copy of “${nm}” couldn't be read, so the server's copy opened as “${copy}”. Yours is unchanged.` : `“${nm}” was changed here and on the server, so the server's copy opened as “${copy}”. Yours is unchanged.`;
    }
    if (mark) { rec.files[id] = { file: item.file, tag: item.tag, sum: ssum }; writeRec(); }
    closeModal();
    await open(go);
    toast(msg);
  }

  async function save(force) {
    conflict = null;
    const doc = JSON.parse(JSON.stringify(store.doc)), name = (fileSafe(doc.name || "").slice(0, 70) || "design") + "-" + doc.id + ".json", lsum = sum(doc), old = rec.files[doc.id];
    const text = JSON.stringify({ app: "jumpstart-3d", version: 1, doc }, null, 1);
    const thumb = thumbnail();
    const record = rec;
    const found = await list(false);
    if (!found || rec !== record) return; // forgotten meanwhile: stop quietly
    const srv = found.find((i) => old && i.file === old.file) || found.find((i) => i.id === doc.id);
    const hit = found.find((i) => sameName(i.file, name)); // a file already called what we would write
    const hold = () => { conflict = { name: doc.name || "Untitled" }; render(); };
    // a server file we have not seen in its current state is compared by content before it can be replaced
    for (const s of force ? [] : [srv, hit !== srv && hit]) {
      if (!s || (old && s.file === old.file && s.tag && s.tag === old.tag)) continue;
      const g = await call("GET", s.file);
      if (rec !== record) return;
      let ssum = null;
      try { ssum = sum(JSON.parse(g.text).doc); } catch (e) {}
      if (ssum !== lsum && (!old || ssum !== old.sum)) return hold();
    }
    const strong = hit && hit.file === name && hit.etag && !/^W\//.test(hit.etag);
    const r = await call("PUT", name, { body: text, headers: { "Content-Type": "application/json", ...(strong ? { "If-Match": hit.etag } : {}) }, allow: [412] });
    if (rec !== record) return;
    if (r.status === 412) { // an answer to Replace it must not bring the same question back
      if (!force) return hold();
      render(); return say(T.refused, true);
    }
    let previewNote = "";
    try {
      if (thumb) await call("PUT", name + ".thumb", { body: thumb, headers: { "Content-Type": "text/plain" }, preview: true });
      else await call("DELETE", name + ".thumb", { allow: [404], preview: true });
    } catch (e) { if (!(e instanceof Err)) throw e; previewNote = " The design is saved, but its preview could not be updated."; }
    if (rec !== record) return;
    if (srv && !sameName(srv.file, name)) {
      if (srv.preview) await call("DELETE", srv.file + ".thumb", { allow: [404], preview: true });
      if (rec !== record) return;
      await call("DELETE", srv.file, { allow: [404] });
    }
    if (rec !== record) return;
    let tag = "";
    try { tag = ((await list(true, previewNote ? null : { file: name, thumb })).find((i) => i.file === name) || {}).tag || ""; } catch (e) {}
    if (rec !== record) return;
    rec.files[doc.id] = { file: name, tag, sum: lsum };
    writeRec(); render();
    say(`Saved “${doc.name || "Untitled"}” to ${host()}.` + previewNote);
    toast(`Saved “${doc.name || "Untitled"}” to the server.`);
  }
  async function remove(item) {
    const record = rec;
    if (item.preview) await call("DELETE", item.file + ".thumb", { allow: [404], preview: true });
    if (rec !== record) return;
    await call("DELETE", item.file, { allow: [404] });
    if (rec !== record) return;
    items = items.filter((i) => i !== item);
    if (item.id && rec.files[item.id] && rec.files[item.id].file === item.file) delete rec.files[item.id];
    writeRec(); render(); hello();
    toast(`Deleted “${shown(item.file)}” from the server. A copy in this browser, if any, stays.`);
  }

  function card(item) {
    const name = shown(item.file), go = () => act(() => openItem(item));
    const acts = el("div", { class: "acts" }, el("button", { class: "open", onclick: go }, "Open"), el("button", { class: "del" }, "Delete"));
    acts.querySelector(".del").onclick = () => {
      const row = el("div", { class: "confirm-row" }, "Delete from the server for good?",
        el("button", { class: "btn danger", style: { padding: "3px 8px" }, onclick: () => act(() => remove(item)) }, "Delete"),
        el("button", { class: "btn", style: { padding: "3px 8px" }, onclick: () => row.replaceWith(acts) }, "Keep"));
      acts.replaceWith(row);
    };
    const when = item.mtime ? new Date(item.mtime).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    const button = el("button", { class: "thumb", style: { backgroundImage: item.thumb ? `url(${item.thumb})` : "none", border: 0, cursor: "pointer" }, "aria-label": "Open " + name, onclick: go });
    thumbButtons.set(item, button);
    return el("div", { class: "pcard" + (item.id && item.id === store.doc.id ? " current" : "") },
      button,
      el("div", { class: "meta" }, el("b", {}, name), el("span", {}, when)), acts);
  }
  function render() {
    if (!panel) return;
    if (!auth) {
      const field = (id, label, attrs) => el("label", {}, label, el("input", { class: "num", id: "remote-" + id, spellcheck: "false", autocomplete: "off", ...attrs }));
      panel.replaceChildren(lead(), el("div", { class: "remote-form", id: "remote-form" },
        field("url", "Server folder address (WebDAV)", { type: "url", placeholder: "https://cloud.example.com/remote.php/dav/files/you/JumpStart/", value: rec ? rec.url : dflt }),
        field("user", "User name", { value: rec ? rec.user : "" }),
        field("pass", "Password or app password", { type: "password" }),
        el("label", { class: "chk" }, el("input", { type: "checkbox", id: "remote-remember", checked: !!(rec && rec.remember) }), "Remember the password in this browser"),
        el("div", { class: "backup-row" }, el("button", { class: "btn", id: "btn-remote-test", title: "Check the address, user name and password without saving anything", onclick: trial }, "Test connection"), el("button", { class: "btn primary", id: "btn-remote-connect", onclick: connect }, "Connect")),
        el("div", { class: "menu-note" }, T.note)));
    } else panel.replaceChildren(lead(),
      el("div", { class: "backup-row" },
        el("button", { class: "btn", id: "btn-remote-save", title: "Upload the design you have open as a project file", onclick: () => act(() => save(false)) }, "Save the open design to the server"),
        el("button", { class: "btn", id: "btn-remote-forget", title: "Forget the address and password in this browser; the files on the server stay", onclick: forget }, "Forget this server")),
      conflict ? el("div", { class: "confirm-row", id: "remote-conflict" }, `The server's copy of “${conflict.name}” changed since this browser last saw it.`,
        el("button", { class: "btn danger", id: "btn-remote-replace", onclick: () => act(() => save(true)) }, "Replace it"),
        el("button", { class: "btn", id: "btn-remote-keep", onclick: () => { conflict = null; say(T.kept); render(); } }, "Keep the server's")) : null,
      !items ? null : items.length ? el("div", { class: "projgrid", id: "remote-grid" }, items.map(card)) : el("div", { class: "empty" }, "No designs on the server yet. Save the open design to put it there."));
    lock(busy); // a redraw while an action runs keeps the buttons off
  }

  return {
    // called by Your designs each time it opens; adds the two tabs unless the page runs inside claude.ai
    tabs(mbody, close) {
      panel = null;
      if (window.claude) return;
      closeModal = close;
      const tab = (id, label, on, title) => el("button", { id, role: "tab", "aria-selected": on, title, onclick: () => pick(id === "tab-remote") }, label);
      const local = tab("tab-local", "This browser", true), remote = tab("tab-remote", "Your server", false, "Designs in a folder on your own WebDAV server");
      const mine = (panel = el("div", { id: "designs-remote", role: "tabpanel" }));
      const pick = (on) => {
        mbody.classList.toggle("remote-on", on);
        local.setAttribute("aria-selected", String(!on));
        remote.setAttribute("aria-selected", String(on));
        if (on) { panel = mine; show(); }
      };
      mbody.prepend(el("div", { class: "dtabs", id: "designs-tabs", role: "tablist" }, local, remote));
      mbody.append(panel);
    },
    check, // for tests
    forget, // for tests (the button does the same)
    state: () => ({ url: rec ? rec.url : "", user: rec ? rec.user : "", remember: !!(rec && rec.remember), connected: !!auth, files: rec ? rec.files : {} }), // for tests, never the password
  };
}
