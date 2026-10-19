// Tutorials: a chooser (Beginner / Advanced, five each, marked Easy / Proficient / Advanced) and a
// guide panel that walks through one item step by step. Each step says which tool to use, how,
// and when it's the right tool; "Show me" points at the real button, tile or field with a pulsing
// ring and a pop-up. Steps tick themselves off when the design shows they're done (or by hand).
import * as THREE from "three";
import { TUTORIALS } from "./tutorial_data.js";
import { store } from "./store.js";
import { el } from "./util.js";
import { ICON } from "./icons.js";
import { animSVG, animFor } from "./tutorial_anims.js";

const LS = "jumpstart3d.tutorial.";
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(LS + k) || "null"); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };
const LEVEL_ORDER = { Easy: 0, Proficient: 1, Advanced: 2 };

export function initTutorials(app) {
  let cur = null; // { tut, i, done: Set, startVer, exported: Set }
  let panel = null, bubble = null, spot = null, timer = 0, bubbleT = 0;

  // ---------------------------------------------------------------- what the design looks like
  const walk = (node, fn, hole = false) => {
    fn(node, hole);
    for (const c of node.children || []) walk(c.node, fn, !!c.hole);
    for (const m of node.mods || []) if (m.tool) walk(m.tool, fn);
  };
  const near = (a, b, tol = 0.6) => Math.abs((+a || 0) - b) <= tol;
  const T = {
    near,
    doc: () => store.doc,
    bodies: () => store.doc.bodies || [],
    nameOk: () => {
      const parts = (store.doc.name || "").split(",").map((s) => s.trim()).filter(Boolean);
      return parts.length >= 3 && !/^untitled/i.test(parts[0]);
    },
    prim: (kind, hole = false) => T.bodies().filter((b) => b.node.t === "prim" && b.node.kind === kind && !!b.hole === hole),
    box(id) {
      const b = app.scene.bodyTightBox(id);
      if (!b || b.isEmpty()) return null;
      return { min: b.min, max: b.max, center: b.getCenter(new THREE.Vector3()), size: b.getSize(new THREE.Vector3()) };
    },
    groups: () => T.bodies().filter((b) => b.node.t === "group"),
    childKinds(g) { const out = []; walk(g.node, (n) => { if (n.t === "prim") out.push(n.kind); }); return out; },
    countHoles(g) { let n = 0; const go = (node) => { for (const c of node.children || []) { if (c.hole) n++; go(c.node); } }; go(g.node); return n; },
    hasHole: (g) => T.countHoles(g) > 0,
    countMods(t) { let n = 0; for (const b of T.bodies()) walk(b.node, (node) => { for (const m of node.mods || []) if (m.t === t) n++; }); return n; },
    hasMod: (t) => T.countMods(t) > 0,
    hasCombine(op) {
      let ok = false;
      for (const b of T.bodies()) walk(b.node, (node) => { for (const m of node.mods || []) if (m.t === "bool" && m.src === "combine" && (op === "join" ? !m.op || m.op === "join" : m.op === op)) ok = true; });
      return ok;
    },
    sketches: () => store.doc.sketches || [],
    sketchCircle: (r) => T.sketches().some((s) => s.ents.some((e) => e.t === "circle" && near(e.r, r, 0.6))),
    sketchLines: (n, z = null) => T.sketches().some((s) => s.ents.filter((e) => e.t === "line" && !e.construction).length >= n && (z == null || near(s.plane.o[2], z, 0.6))),
    sketchOn: (pl) => T.sketches().some((s) => { const n = s.plane.n; return pl === "XZ" ? Math.abs(n[1]) > 0.99 : pl === "YZ" ? Math.abs(n[0]) > 0.99 : Math.abs(n[2]) > 0.99; }),
    // a rectangle of about w × h drawn in some sketch (optionally on a plane at height z)
    sketchRect: (w, h, z = null) => T.sketches().some((s) => {
      const P = new Map(s.pts.map((q) => [q.id, q]));
      const ls = s.ents.filter((e) => e.t === "line" && !e.proj && !e.construction);
      if (ls.length < 4 || (z != null && !near(s.plane.o[2], z, 0.6))) return false;
      const xs = [], ys = [];
      for (const e of ls) for (const id of [e.a, e.b]) { const q = P.get(id); if (q) { xs.push(q.x); ys.push(q.y); } }
      const W = Math.max(...xs) - Math.min(...xs), Hh = Math.max(...ys) - Math.min(...ys);
      return (near(W, w, 0.6) && near(Hh, h, 0.6)) || (near(W, h, 0.6) && near(Hh, w, 0.6));
    }),
    feat: (t) => T.bodies().filter((b) => b.node.t === t),
    // a sketch extruded into a body that was already there (join or cut)
    extrudeMod(op) { let ok = false; for (const b of T.bodies()) walk(b.node, (node) => { for (const m of node.mods || []) if (m.t === "bool" && m.tool && m.tool.t === "extrude" && (m.op || "join") === op) ok = true; }); return ok; },
    // the Lathe: what's on it, how fast it's turning, and the turned parts it has made
    lathe: () => (app.lathe && app.lathe.active ? app.lathe._ui() : null),
    turned: () => T.bodies().filter((b) => b.turned),
    latheOpen: () => !!T.lathe() || T.turned().length > 0,
    latheWork(fn) { const u = T.lathe(); if (!u || !u.work) return T.turned().length > 0; try { return !!fn(u.work, u.st); } catch (e) { return false; } },
    latheSpinning: () => { const u = T.lathe(); return u ? u.rpmNow > 300 : T.turned().length > 0; },
    // the work's radius at a fraction of its length (0 = headstock end, 1 = tailstock end)
    rAt: (w, f) => w.rowMax[Math.max(0, Math.min(w.N - 1, Math.round(f * (w.N - 1))))],
    roundness(w) { let n = 0; for (let i = 0; i < w.N; i++) { let lo = Infinity, hi = 0; for (let j = 0; j < 96; j++) { const r = w.r[i * 96 + j]; lo = Math.min(lo, r); hi = Math.max(hi, r); } if (hi - lo < 0.3) n++; } return n / w.N; },
    saved: () => !!cur && app.projects.version() > cur.startVer,
    exported: (ext) => !!cur && cur.exported.has(ext),
  };
  const passes = (step) => { if (!step.check) return false; try { return !!step.check(T); } catch (e) { return false; } };

  // the app reports saves and exports
  const prevExport = app.onExport;
  app.onExport = (ext) => { prevExport && prevExport(ext); if (cur) { cur.exported.add(ext); tick(); } };

  // ---------------------------------------------------------------- the chooser
  function openChooser(mode) {
    const want = mode || (app.mode === "advanced" ? "advanced" : "beginner");
    const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
    const list = el("div", { class: "tut-cards", id: "tut-cards" });
    const tabs = el("div", { class: "seg tut-tabs", role: "tablist" });
    const show = (m) => {
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === m)));
      list.innerHTML = "";
      const items = TUTORIALS.filter((t) => t.mode === m).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
      for (const t of items) {
        const prog = lsGet("p." + t.id);
        const doneN = prog && prog.done ? prog.done.length : 0;
        list.append(el("button", { class: "tut-card", id: "tut-" + t.id, onclick: () => { back.remove(); start(t.id); } },
          el("div", { class: "tut-card-top" }, el("span", { class: "tut-level " + t.level.toLowerCase() }, t.level), el("span", { class: "tut-time" }, `${t.minutes} min · ${t.steps.length} steps`)),
          el("b", {}, t.title),
          el("p", {}, t.blurb),
          el("div", { class: "tut-learn" }, "You'll use: " + t.learn.join(", ")),
          doneN ? el("div", { class: "tut-prog" }, doneN >= t.steps.length ? "✓ Finished before" : `${doneN} of ${t.steps.length} steps done`) : null));
      }
    };
    for (const [m, label] of [["beginner", "Beginner"], ["advanced", "Advanced"]]) tabs.append(el("button", { "data-m": m, id: "tut-tab-" + m, onclick: () => show(m) }, label));
    const modal = el("div", { class: "modal tut-modal", role: "dialog", "aria-label": "Tutorials" },
      el("header", {}, el("h2", {}, "Tutorials"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
      el("div", { class: "mbody" },
        el("p", { class: "tut-intro" }, "Pick a project. Each one walks you through real tools to make a real, printable item. The short ones take 5-10 minutes; the bigger projects take 10-15."),
        el("div", { class: "tut-remind" }, el("b", {}, "Always start by naming your design: "), "Last name, First name, Item name ", el("span", { class: "tut-eg" }, "(Lopez, Maria, Keychain)"),
          el("br"), el("b", {}, "Always finish by saving "), "(Save or Ctrl+S: v1, v2…) ", el("b", {}, "and exporting an STL "), "(Export → STL)."),
        tabs, list));
    back.append(modal);
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") back.remove(); });
    document.body.append(back);
    show(want);
    modal.querySelector(".xbtn").focus();
  }

  // ---------------------------------------------------------------- running a tutorial
  function start(id, resume = false) {
    const tut = TUTORIALS.find((t) => t.id === id);
    if (!tut) return;
    close(true);
    const prog = resume ? lsGet("p." + id) : null;
    if (!resume) {
      // a fresh design for the project (the current one is already saved), in the right mode
      if (app.mode !== tut.mode) app.setMode(tut.mode);
      app.projects.newDesign(tut.mode);
      lsSet("p." + id, null);
    }
    cur = { tut, i: prog ? Math.min(prog.i || 0, tut.steps.length - 1) : 0, done: new Set(prog ? prog.done || [] : []), startVer: app.projects.version(), exported: new Set() };
    lsSet("active", { id, doc: store.doc.id });
    buildPanel();
    render();
    clearInterval(timer);
    timer = setInterval(tick, 700);
    setTimeout(() => showMe(false), 350);
  }
  function save() { if (cur) lsSet("p." + cur.tut.id, { i: cur.i, done: [...cur.done] }); }
  function close(quiet) {
    clearInterval(timer);
    hideSpot();
    if (panel) panel.remove();
    panel = null;
    if (cur && !quiet) lsSet("active", null);
    cur = null;
  }
  // ticks the current step (and any earlier ones) off when the design shows they're done
  function tick() {
    if (!cur || !panel) return;
    if (cur.tut.mode !== app.mode && app.mode !== "chisel") { /* the student switched modes: keep going */ }
    let changed = false;
    cur.tut.steps.forEach((s, k) => { if (k <= cur.i && !cur.done.has(k) && passes(s)) { cur.done.add(k); changed = true; } });
    if (changed) { save(); render(); if (cur.done.has(cur.i)) cheer(); }
  }
  function cheer() {
    const nx = panel && panel.querySelector("#tut-next");
    if (nx) { nx.classList.remove("pulse"); void nx.offsetWidth; nx.classList.add("pulse"); }
  }
  function go(i) {
    if (!cur) return;
    cur.i = Math.max(0, Math.min(cur.tut.steps.length - 1, i));
    save(); render(); hideSpot();
    setTimeout(() => showMe(false), 120);
  }

  function buildPanel() {
    panel = el("aside", { class: "tut-panel", id: "tut-panel", role: "complementary", "aria-label": "Tutorial" });
    document.body.append(panel);
    // start at the left of the 3D view, below the toolbar
    const vpR = document.getElementById("viewport").getBoundingClientRect();
    const small = innerWidth < 700;
    panel.style.left = (small ? 8 : Math.max(8, vpR.left + 10)) + "px";
    panel.style.top = (small ? Math.max(60, innerHeight - 330) : Math.max(56, vpR.top + 10)) + "px";
    // drag by the header
    panel.addEventListener("pointerdown", (e) => {
      const h = e.target.closest(".tut-head");
      if (!h || e.target.closest("button")) return;
      const r = panel.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = (ev) => {
        panel.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - ox)) + "px";
        panel.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - oy)) + "px";
      };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); fit(); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
      e.preventDefault();
    });
  }

  // keep the panel above Beginner's shape strip and the status bar
  function fit() {
    if (!panel) return;
    const top = panel.getBoundingClientRect().top;
    const dock = document.getElementById("shapes"), st = document.querySelector(".status");
    let bottom = st ? st.getBoundingClientRect().top - 6 : innerHeight - 6;
    if (dock && !dock.hidden && dock.getClientRects().length) { const r = dock.getBoundingClientRect(); if (r.height > 20 && r.top > top + 160) bottom = Math.min(bottom, r.top - 6); }
    panel.style.maxHeight = Math.max(140, bottom - top) + "px";
  }
  function render() {
    if (!panel || !cur) return;
    requestAnimationFrame(fit);
    const { tut, i } = cur, step = tut.steps[i], n = tut.steps.length;
    const doneN = cur.done.size, isDone = cur.done.has(i);
    panel.classList.toggle("mini", !!cur.mini);
    panel.innerHTML = "";
    const head = el("div", { class: "tut-head" },
      el("span", { class: "tut-level " + tut.level.toLowerCase() }, tut.level),
      el("b", { class: "tut-title" }, tut.title),
      el("button", { class: "tut-icon", id: "tut-min", title: cur.mini ? "Show the steps" : "Make this small", "aria-label": cur.mini ? "Expand" : "Minimize", onclick: () => { cur.mini = !cur.mini; render(); } }, cur.mini ? "▢" : "–"),
      el("button", { class: "tut-icon", id: "tut-close", title: "Close the tutorial (your design stays)", "aria-label": "Close tutorial", html: ICON.close, onclick: () => { close(); } }));
    const bar = el("div", { class: "tut-bar" }, el("i", { style: { width: Math.round((100 * doneN) / n) + "%" } }));
    panel.append(head, bar);
    if (cur.mini) {
      panel.append(el("button", { class: "tut-mini-line", onclick: () => { cur.mini = false; render(); } }, `Step ${i + 1} of ${n}: ${step.title}`, isDone ? " ✓" : ""));
      return;
    }
    // the current step
    const tool = el("div", { class: "tut-tool" },
      el("span", { class: "tut-tool-ic", html: ICON[step.icon] || ICON.select || "" }),
      el("span", {}, el("small", {}, "Tool"), el("b", {}, step.tool)),
      step.show ? el("button", { class: "btn tut-show", id: "tut-show", onclick: () => showMe(true) }, "Show me") : null);
    // a little looping animation of the step (like an animated GIF)
    const an = animFor(step), animOff = !!lsGet("animOff");
    let anim = null;
    if (an) {
      const svg = animOff ? null : animSVG(an);
      anim = el("div", { class: "tut-anim" + (animOff ? " off" : ""), id: "tut-anim" },
        svg ? el("div", { class: "tut-anim-box", html: svg }) : null,
        el("button", { class: "tut-anim-tog", id: "tut-anim-tog", title: animOff ? "Show the animation for each step" : "Hide the animations", onclick: () => { lsSet("animOff", !animOff); render(); } }, animOff ? "▶ Show animation" : "Hide animation"));
      const sv = anim.querySelector("svg");
      if (sv && matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) setTimeout(() => { try { sv.pauseAnimations(); sv.setCurrentTime(4.2); } catch (e) {} }, 0);
    }
    const card = el("section", { class: "tut-step" + (isDone ? " done" : "") },
      el("div", { class: "tut-stepno" }, `Step ${i + 1} of ${n}`, isDone ? el("span", { class: "tut-ok" }, "✓ Done") : null),
      el("h3", {}, step.title),
      tool,
      anim,
      el("div", { class: "tut-sub" }, "How"),
      el("ol", { class: "tut-how" }, ...step.how.map((h) => el("li", { html: h }))),
      el("div", { class: "tut-when" }, el("b", {}, "When to use it: "), step.when),
      step.tip ? el("div", { class: "tut-tip" }, el("b", {}, "Tip: "), step.tip) : null);
    // naming helper: quick boxes that fill in "Last, First, Item" (also handy on phones)
    if (step.show && step.show.name) {
      const parts = (store.doc.name || "").split(",").map((s) => s.trim());
      const named = T.nameOk();
      const last = el("input", { class: "num", id: "tut-last", placeholder: "Last name", value: named ? parts[0] : "" });
      const first = el("input", { class: "num", id: "tut-first", placeholder: "First name", value: named ? parts[1] : "" });
      const item = el("input", { class: "num", id: "tut-item", placeholder: "Item name", value: named ? parts.slice(2).join(", ") : tut.item });
      for (const f of [last, first, item]) f.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") apply.click(); });
      const apply = el("button", { class: "btn primary", id: "tut-name-apply", onclick: () => {
        const v = [last.value, first.value, item.value].map((s) => s.trim().replace(/,/g, " "));
        if (!v[0] || !v[1] || !v[2]) { app.toast("Fill in your last name, first name and the item name."); return; }
        store.update((d) => { d.name = v.join(", "); }, "Rename");
        tick();
      } }, "Use this name");
      card.append(el("div", { class: "tut-namebox" }, el("div", { class: "tut-sub" }, "Quick name"), el("div", { class: "tut-name3" }, last, first, item), apply));
    }
    panel.append(card);
    // navigation
    panel.append(el("div", { class: "tut-nav" },
      el("button", { class: "btn", id: "tut-back", disabled: i === 0, onclick: () => go(i - 1) }, "← Back"),
      el("label", { class: "check tut-mark" }, el("input", { type: "checkbox", id: "tut-check", checked: isDone, onchange: (e) => { if (e.target.checked) cur.done.add(i); else cur.done.delete(i); save(); render(); } }), "I did this"),
      i < n - 1
        ? el("button", { class: "btn primary" + (isDone ? " ready" : ""), id: "tut-next", onclick: () => { cur.done.add(i); go(i + 1); } }, "Next →")
        : el("button", { class: "btn primary" + (isDone ? " ready" : ""), id: "tut-next", onclick: () => finish() }, "Finish ✓")));
    // the checklist of every step
    const list = el("ol", { class: "tut-list", id: "tut-list" });
    tut.steps.forEach((s, k) => list.append(el("li", { class: (k === i ? "cur " : "") + (cur.done.has(k) ? "done" : "") },
      el("button", { onclick: () => go(k) }, el("span", { class: "tut-box", "aria-hidden": "true" }, cur.done.has(k) ? "✓" : ""), s.title))));
    panel.append(el("details", { class: "tut-check", open: !innerWidth || innerWidth > 700 }, el("summary", {}, `Checklist · ${doneN} of ${n} done`), list));
  }
  function finish() {
    if (!cur) return;
    cur.done.add(cur.i); save();
    const t = cur.tut, all = cur.done.size >= t.steps.length;
    close();
    const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
    back.append(el("div", { class: "modal tut-modal tut-done", role: "dialog", "aria-label": "Tutorial finished" },
      el("header", {}, el("h2", {}, all ? "Nice work! 🎉" : "Tutorial closed"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
      el("div", { class: "mbody" },
        el("p", {}, all ? `You made the ${t.item.toLowerCase()}. Your design is saved as "${app.projects.versionName()}".` : "Some steps aren't ticked yet. Your design is kept; you can open the tutorial again to continue."),
        el("p", { class: "tut-intro" }, "Ideas: change a size and save again (it becomes the next version), or try a harder tutorial."),
        el("div", { class: "tut-done-btns" },
          el("button", { class: "btn", onclick: () => { back.remove(); openChooser(t.mode); } }, "More tutorials"),
          el("button", { class: "btn primary", onclick: () => back.remove() }, "Keep designing")))));
    document.body.append(back);
  }

  // ---------------------------------------------------------------- "Show me": point at the tool
  function target(show) {
    if (show.tile) return app.beginner && app.beginner.showTile ? app.beginner.showTile(show.tile, !!show.hole) : null;
    for (const s of show.sel.split(",").map((x) => x.trim())) {
      const e = document.querySelector(s);
      if (e && e.getClientRects().length) return e;
    }
    if (show.via) { const v = document.querySelector(show.via); if (v && v.getClientRects().length) return v; }
    return null;
  }
  function hideSpot() {
    clearTimeout(bubbleT);
    if (spot) spot.classList.remove("tut-spot");
    spot = null;
    if (bubble) bubble.remove();
    bubble = null;
  }
  function showMe(loud) {
    if (!cur || !panel || cur.mini) return;
    const step = cur.tut.steps[cur.i];
    hideSpot();
    if (!step.show) return;
    const t = target(step.show);
    if (!t) { if (loud) app.toast(step.show.via ? "Find it in the toolbar menus." : cur.tut.mode === "beginner" && app.mode !== "beginner" ? "Switch to Beginner mode to see this." : "It appears when the step before is done."); return; }
    spot = t;
    t.classList.add("tut-spot");
    const r = t.getBoundingClientRect();
    const via = step.show.via && t.matches(step.show.via);
    bubble = el("div", { class: "tut-bubble", id: "tut-bubble", role: "status" },
      el("b", {}, step.tool), el("span", {}, via ? "Open this menu, then pick it from the list." : step.show.name ? "Click here and type your name." : bubbleText(step)));
    document.body.append(bubble);
    // below the target when there's room, otherwise above
    const bw = Math.min(260, innerWidth - 16), below = r.bottom + 120 < innerHeight;
    bubble.style.width = bw + "px";
    bubble.style.left = Math.max(8, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2)) + "px";
    bubble.style.top = (below ? r.bottom + 12 : Math.max(8, r.top - 12 - 70)) + "px";
    bubble.classList.add(below ? "below" : "above");
    bubble.style.setProperty("--ax", Math.max(14, Math.min(bw - 14, r.left + r.width / 2 - parseFloat(bubble.style.left))) + "px");
    bubbleT = setTimeout(hideSpot, loud ? 6000 : 4500);
  }
  function bubbleText(step) {
    if (step.show.tile) return step.show.hole ? "Click this hole tile (Holes tab)." : "Click this tile to add it.";
    if (/^#insp-|^#pr-|^#ex-/.test(step.show.sel || "")) return "Type the numbers in these boxes.";
    return "Click here.";
  }
  addEventListener("pointerdown", (e) => { if (bubble && !e.target.closest("#tut-show")) { clearTimeout(bubbleT); bubbleT = setTimeout(hideSpot, 900); } }, true);
  addEventListener("resize", () => { if (panel) { fit(); const r = panel.getBoundingClientRect(); if (r.left > innerWidth - 80) panel.style.left = Math.max(0, innerWidth - r.width - 8) + "px"; if (r.top > innerHeight - 40) panel.style.top = Math.max(0, innerHeight - 200) + "px"; } });

  // reopen a tutorial that was running on this design when the page closed
  function resumeIfAny() {
    const a = lsGet("active");
    if (a && a.doc === store.doc.id && TUTORIALS.some((t) => t.id === a.id)) start(a.id, true);
  }
  return { open: openChooser, start, close, resumeIfAny, get current() { return cur ? { id: cur.tut.id, step: cur.i, done: [...cur.done] } : null; }, list: TUTORIALS, T };
}
