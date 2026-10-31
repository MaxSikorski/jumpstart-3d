/* ===== JumpStart 3D add-ons: quick save, My plans, autosave, and step-by-step tutorials =====
   (built into the Floor Planner by make_floorplan.py, after fp_tutorials.js) */
(function () {
  const $1 = (s, r) => (r || document).querySelector(s);
  const mk = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e[k] = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } for (const c of kids) if (c != null) e.append(c); return e; };
  const lsG = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const escH = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const FPB = window.__fpb || (window.__fpb = { dl: [], r3: 0, views: new Set(), shots: 0 });
  FPB.saved = false;

  /* ---------------------------------------------------------------- styles (like JumpStart 3D's) */
  const css = `
  .jt, .jt * { box-sizing: border-box; }
  .jt { --p: #ffffff; --p2: #f5f7fa; --ink: #18202a; --ink2: #4b5563; --ink3: #6b7280; --ln: #d8dde3; --ln2: #e7eaee; --ac: #1f4fa8;
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); }
  .jt button { font: inherit; }
  .jt-btn { border: 1px solid var(--ln); background: var(--p); color: var(--ink); border-radius: 7px; padding: 6px 12px; cursor: pointer; font-weight: 600; }
  .jt-btn:hover { border-color: var(--ac); }
  .jt-btn.pri { background: var(--ac); border-color: var(--ac); color: #fff; }
  .jt-btn:disabled { opacity: .5; cursor: default; }
  .jt-back { position: fixed; inset: 0; background: rgba(10, 20, 35, .55); display: grid; place-items: center; z-index: 60; padding: 16px; }
  .jt-modal { background: var(--p); border-radius: 10px; width: min(780px, 100%); max-height: min(660px, 92vh); display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
  .jt-modal.sm { width: min(480px, 100%); }
  .jt-modal header { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--ln2); background: none; border-top: 0; }
  .jt-modal header h2 { margin: 0; flex: 1; font: 600 20px/1 system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: var(--ink); }
  .jt-x { border: 0; background: none; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; color: var(--ink3); font-size: 18px; }
  .jt-x:hover { background: var(--ln2); color: var(--ink); }
  .jt-body { padding: 14px 18px 18px; overflow: auto; }
  .jt-intro { color: var(--ink2); margin: 0 0 10px; }
  .jt-remind { background: var(--p2); border: 1px solid var(--ln); border-left: 4px solid #e8a317; border-radius: 6px; padding: 8px 12px; margin: 0 0 12px; color: var(--ink2); line-height: 1.5; }
  .jt-tabs { display: inline-flex; border: 1px solid var(--ln); border-radius: 8px; overflow: hidden; margin-bottom: 12px; }
  .jt-tabs button { border: 0; background: var(--p); padding: 6px 14px; cursor: pointer; color: var(--ink2); border-right: 1px solid var(--ln); }
  .jt-tabs button:last-child { border-right: 0; }
  .jt-tabs button[aria-pressed="true"] { background: var(--ac); color: #fff; font-weight: 600; }
  .jt-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .jt-card { text-align: left; border: 1px solid var(--ln); border-radius: 10px; background: var(--p); padding: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; color: var(--ink); }
  .jt-card:hover { border-color: var(--ac); box-shadow: 0 4px 14px rgba(0,0,0,.12); }
  .jt-card b { font-size: 15px; } .jt-card p { margin: 0; color: var(--ink2); font-size: 12.5px; line-height: 1.45; }
  .jt-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .jt-time, .jt-learn { font-size: 11.5px; color: var(--ink3); } .jt-prog { font-size: 11.5px; color: var(--ac); font-weight: 600; }
  .jt-level { font: 700 10.5px/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; border-radius: 999px; padding: 4px 8px; color: #fff; }
  .jt-level.easy { background: #2e9d57; } .jt-level.proficient { background: #d08a12; } .jt-level.advanced { background: #c0392b; }
  .jt-panel { position: fixed; z-index: 50; width: min(340px, calc(100vw - 16px)); max-height: calc(100vh - 70px); overflow: auto; background: var(--p); border: 1px solid var(--ln); border-radius: 12px; box-shadow: 0 12px 34px rgba(0,0,0,.35); }
  .jt-panel.mini { width: min(300px, calc(100vw - 16px)); }
  .jt-head { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px; cursor: move; background: var(--p2); border-bottom: 1px solid var(--ln); border-radius: 12px 12px 0 0; touch-action: none; }
  .jt-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .jt-ic { border: 0; background: transparent; color: var(--ink2); width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 16px; line-height: 1; }
  .jt-ic:hover { background: var(--ln); }
  .jt-bar { height: 4px; background: var(--ln2); } .jt-bar i { display: block; height: 100%; background: #2e9d57; transition: width .3s; }
  .jt-mini { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 9px 12px; color: var(--ink); cursor: pointer; }
  .jt-step { padding: 10px 14px 4px; }
  .jt-no { display: flex; align-items: center; justify-content: space-between; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); }
  .jt-ok { color: #2e9d57; font-weight: 700; text-transform: none; letter-spacing: 0; font-size: 12px; }
  .jt-step h3 { margin: 4px 0 8px; font-size: 16px; color: var(--ink); font-family: inherit; letter-spacing: 0; }
  .jt-tool { display: flex; align-items: center; gap: 10px; background: var(--p2); border: 1px solid var(--ln); border-radius: 8px; padding: 6px 8px; }
  .jt-tool-ic { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 7px; background: var(--p); border: 1px solid var(--ln); color: var(--ac); }
  .jt-tool-ic svg { width: 20px; height: 20px; }
  .jt-tool > span:nth-child(2) { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .jt-tool small { font-size: 10.5px; color: var(--ink3); text-transform: uppercase; letter-spacing: .06em; }
  .jt-sub { margin: 10px 0 2px; font: 600 11px/1.2 system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase; color: var(--ac); }
  .jt-how { margin: 0; padding-left: 20px; line-height: 1.5; } .jt-how li { margin: 3px 0; }
  .jt-when, .jt-tip { margin: 8px 0 4px; padding: 7px 9px; border-radius: 7px; line-height: 1.45; font-size: 12.5px; }
  .jt-when { background: rgba(45, 99, 200, .09); } .jt-tip { background: rgba(232, 163, 23, .13); }
  .jt-nav { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-top: 1px solid var(--ln); position: sticky; bottom: 0; background: var(--p); }
  .jt-mark { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 12px; margin: 0; color: var(--ink2); }
  .jt-mark input { width: auto; }
  .jt-check { padding: 2px 14px 10px; } .jt-check summary { cursor: pointer; font-weight: 600; color: var(--ink2); padding: 6px 0; }
  .jt-list { list-style: none; margin: 0; padding: 0; }
  .jt-list button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; background: transparent; padding: 4px; border-radius: 6px; cursor: pointer; color: var(--ink2); }
  .jt-list button:hover { background: var(--p2); } .jt-list li.cur button { background: rgba(45,99,200,.1); color: var(--ink); font-weight: 600; }
  .jt-list li.done button { color: var(--ink3); }
  .jt-box { width: 16px; height: 16px; flex: none; border: 1.5px solid var(--ln); border-radius: 4px; display: grid; place-items: center; font-size: 11px; color: #fff; }
  .jt-list li.done .jt-box { background: #2e9d57; border-color: #2e9d57; }
  .jt-spot { outline: 3px solid #e8a317 !important; outline-offset: 2px; animation: jtSpot 1s ease-in-out infinite; position: relative; z-index: 5; }
  @keyframes jtSpot { 50% { outline-color: #ffd24a; outline-offset: 5px; } }
  .jt-bubble { position: fixed; z-index: 55; background: #1f2a37; color: #fff; border-radius: 9px; padding: 9px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.3); font: 13px/1.4 system-ui, sans-serif; display: flex; flex-direction: column; gap: 2px; pointer-events: none; }
  .jt-bubble b { color: #ffd66b; }
  .jt-pulse { animation: jtPulse .9s ease-in-out 3; } @keyframes jtPulse { 50% { box-shadow: 0 0 0 6px rgba(46,157,87,.35); } }
  .jt-field { display: block; margin: 8px 0 2px; font-weight: 600; color: var(--ink2); font-size: 12px; }
  .jt input[type=text] { width: 100%; background: #fff; color: var(--ink); border: 1px solid var(--ln); border-radius: 6px; padding: 7px 8px; font: inherit; }
  .jt-n3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .jt-plans { list-style: none; margin: 8px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .jt-plans li { display: flex; align-items: center; gap: 8px; border: 1px solid var(--ln); border-radius: 8px; padding: 8px 10px; }
  .jt-plans li.cur { border-color: var(--ac); background: rgba(45,99,200,.06); }
  .jt-plans .nm2 { flex: 1; min-width: 0; } .jt-plans .nm2 b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .jt-plans small { color: var(--ink3); }
  .jt-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .jt-err { color: #c0392b; min-height: 16px; margin: 6px 0 0; }
  #fp-saved { font: 12px ui-monospace, monospace; color: #9fd0ff; align-self: center; }
  #fp-resume { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 8; background: #fff; color: #18202a; border-radius: 10px; padding: 10px 14px; box-shadow: 0 8px 24px rgba(0,0,0,.35); display: flex; gap: 10px; align-items: center; font: 13px system-ui, sans-serif; }
  `;
  document.head.append(mk('style', { id: 'jt-css', html: css }));

  /* ---------------------------------------------------------------- the plan as data */
  function snapPlan() {
    try { syncLv(); } catch (e) {}
    const F = typeof FLR === 'object' && FLR ? FLR : { 0: { rooms, items } };
    return { v: 1, app: 'Blueprint Floorplanner', FLR: JSON.parse(JSON.stringify(F)), curL: typeof curL === 'number' ? curL : 0, FH: typeof FH === 'object' ? { ...FH } : null, STD: typeof STD === 'string' ? STD : 'up', ROOF: { ...ROOF }, S: { ...S }, rid, uid: typeof uid === 'number' ? uid : 0 };
  }
  const hasWork = () => { try { syncLv(); return lvs().some((n) => FLR[n].rooms.length || FLR[n].items.length); } catch (e) { return rooms.length > 0 || items.length > 0; } };
  function loadPlan(d) {
    if (!d || !d.FLR) throw new Error('This is not a Floor Planner plan file.');
    if (typeof EX !== 'undefined' && EX) exStop();
    if (typeof JOB !== 'undefined' && JOB) { JOB = null; jstash = null; ARCH_HIDE = false; }
    const F = {};
    for (const [k, v] of Object.entries(d.FLR)) F[+k] = { rooms: v.rooms || [], items: v.items || [] };
    if (!F[0]) F[0] = { rooms: [], items: [] };
    FLR = F; curL = F[d.curL] ? d.curL : 0; rooms = FLR[curL].rooms; items = FLR[curL].items;
    if (d.FH) Object.assign(FH, d.FH);
    STD = d.STD || 'up'; CAMS = {}; cam = null;
    Object.assign(ROOF, d.ROOF || {}); Object.assign(S, d.S || {});
    rid = Math.max(d.rid || 1, ...Object.values(F).flatMap((L) => L.rooms.map((r) => r.id + 1)), 1);
    if (typeof uid === 'number') uid = Math.max(uid, d.uid || 0, ...Object.values(F).flatMap((L) => L.items.map((t) => t.id || 0)));
    sel = selI = null; path = null; drag = null; armI = armF = armW = null; hist = []; hi = -1;
    if (mode === 'tut') setMode('sketch'); else { buildLeft(); list(); }
  }

  /* ---------------------------------------------------------------- saving */
  const PLANS = 'fpPlans', AUTO = 'fpAutosave';
  let curName = lsG('fpCurName', '');
  const stamp = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const plans = () => lsG(PLANS, {});
  function savedMsg(txt) { const e = $1('#fp-saved'); if (e) { e.textContent = txt; clearTimeout(savedMsg.t); savedMsg.t = setTimeout(() => { e.textContent = curName ? '📄 ' + curName : ''; }, 4000); } }
  function saveAs(name) {
    name = name.trim(); if (!name) return false;
    const all = plans(); all[name.toLowerCase()] = { name, t: Date.now(), data: snapPlan() };
    if (!lsS(PLANS, all)) { alertBox('This browser would not save the plan (its storage is full or turned off). Use <b>Save to a file</b> instead.'); return false; }
    curName = name; lsS('fpCurName', name); FPB.saved = true;
    if (typeof STU !== 'undefined' && STU && typeof saveStu === 'function') { try { saveStu(); } catch (e) {} }
    savedMsg('✓ Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    return true;
  }
  function quickSave() { if (curName && plans()[curName.toLowerCase()]) saveAs(curName); else nameDialog(); }
  function nameDialog(copy) {
    const parts = (curName || '').split(',').map((x) => x.trim());
    const d = modal(copy ? 'Save a copy' : 'Save your plan', `<p class="jt-intro">Name your plan <b>Last name, First name, Plan name</b> so you (and your teacher) can find it.</p>
      <div class="jt-n3"><input type="text" id="jn1" placeholder="Last name" value="${escH(parts[0] || '')}"><input type="text" id="jn2" placeholder="First name" value="${escH(parts[1] || '')}"><input type="text" id="jn3" placeholder="Plan name" value="${escH(copy ? (parts[2] || '') + ' copy' : parts[2] || '')}"></div>
      <p class="jt-err" id="jnerr"></p><div class="jt-row"><button class="jt-btn pri" id="jnok">💾 Save</button><button class="jt-btn" id="jncx">Cancel</button></div>`, true);
    const go = () => { const v = ['#jn1', '#jn2', '#jn3'].map((s) => $1(s, d).value.trim()); if (!v[0] || !v[2]) { $1('#jnerr', d).textContent = 'Type at least your last name and a plan name.'; return; } const nm = v.filter(Boolean).join(', '); if (saveAs(nm)) d.remove(); };
    $1('#jnok', d).onclick = go; $1('#jncx', d).onclick = () => d.remove();
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); });
    setTimeout(() => $1(parts[0] ? '#jn3' : '#jn1', d).focus(), 30);
  }
  function fileName() { return (curName || 'floor plan').replace(/[\\/:*?"<>|]+/g, '').trim() + '.floorplan.json'; }
  function saveFile() { const b = new Blob([JSON.stringify({ name: curName, t: Date.now(), data: snapPlan() })], { type: 'application/json' }); dlBlob(b, fileName()); FPB.saved = true; savedMsg('✓ Saved to a file'); }
  function openFile() {
    const inp = mk('input', { type: 'file', accept: '.json,application/json' });
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { const o = JSON.parse(await f.text()); loadPlan(o.data || o); curName = o.name || f.name.replace(/\.floorplan\.json$|\.json$/i, ''); lsS('fpCurName', curName); savedMsg('📂 Opened ' + curName); $1('.jt-back') && $1('.jt-back').remove(); } catch (e) { alertBox('That file could not be opened: ' + escH(e.message)); } };
    inp.click();
  }
  function plansDialog() {
    const all = Object.values(plans()).sort((a, b) => b.t - a.t);
    const d = modal('My plans', `<p class="jt-intro">Plans saved in this browser on this computer. To move a plan to another computer, use <b>Save to a file</b> and open it there.</p>
      <ul class="jt-plans">${all.length ? all.map((p) => `<li class="${p.name === curName ? 'cur' : ''}" data-k="${escH(p.name.toLowerCase())}"><span class="nm2"><b>${escH(p.name)}</b><small>Saved ${stamp(p.t)} · ${Math.round(p.data && p.data.FLR ? Object.values(p.data.FLR).reduce((s, L) => s + L.rooms.length, 0) : 0)} rooms</small></span><button class="jt-btn pri" data-a="open">Open</button><button class="jt-btn" data-a="del" title="Delete this saved plan">🗑</button></li>`).join('') : '<li><span class="nm2">No saved plans yet. Click 💾 Save to save this one.</span></li>'}</ul>
      <div class="jt-row"><button class="jt-btn pri" id="jpsave">💾 Save${curName ? ' (' + escH(curName) + ')' : ''}</button><button class="jt-btn" id="jpcopy">Save as a new plan…</button><button class="jt-btn" id="jpfile">⬇ Save to a file</button><button class="jt-btn" id="jpopen">📂 Open a file…</button><button class="jt-btn" id="jpnew">New blank plan</button></div>`);
    d.querySelector('.jt-plans').onclick = (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return; const li = b.closest('li'), p = plans()[li.dataset.k]; if (!p) return;
      if (b.dataset.a === 'open') { if (hasWork() && !confirmBox('Open “' + p.name + '”? Save first if you want to keep the plan you have now.')) return; loadPlan(p.data); curName = p.name; lsS('fpCurName', curName); d.remove(); savedMsg('📂 Opened ' + p.name); }
      else if (confirmBox('Delete the saved plan “' + p.name + '”? This cannot be undone.')) { const all2 = plans(); delete all2[li.dataset.k]; lsS(PLANS, all2); if (curName === p.name) { curName = ''; lsS('fpCurName', ''); } d.remove(); plansDialog(); }
    };
    $1('#jpsave', d).onclick = () => { d.remove(); quickSave(); };
    $1('#jpcopy', d).onclick = () => { d.remove(); nameDialog(true); };
    $1('#jpfile', d).onclick = () => saveFile();
    $1('#jpopen', d).onclick = () => openFile();
    $1('#jpnew', d).onclick = () => { if (hasWork() && !confirmBox('Start a blank plan? Save first if you want to keep this one.')) return; loadPlan({ FLR: { 0: { rooms: [], items: [] } }, ROOF: { st: 'gable', rg: 'side', pt: 6, peaks: 0, porch: 'none', dorm: 0 }, S: { snap: 1, plot: false, lim: false } }); curName = ''; lsS('fpCurName', ''); d.remove(); savedMsg('New plan'); };
  }
  // the planner keeps the last plan by itself (and offers to continue it next time)
  let autoT = 0;
  const _list = list;
  list = function () { const r = _list.apply(this, arguments); clearTimeout(autoT); autoT = setTimeout(() => { if (!tour() && hasWork()) lsS(AUTO, { name: curName, t: Date.now(), data: snapPlan() }); }, 1200); return r; };
  const tour = () => typeof stash !== 'undefined' && !!stash; // its own animated tour is playing
  // header buttons
  const hb = mk('div', { class: 'g', id: 'fp-saveg' },
    mk('button', { class: 'b', id: 'fp-save', title: 'Save this plan (Ctrl+S). The first time, give it a name.', onclick: () => quickSave() }, '💾 Save'),
    mk('button', { class: 'b', id: 'fp-plans', title: 'Your saved plans: open, copy, delete, save to a file or open a file', onclick: () => plansDialog() }, '📂 My plans'),
    mk('button', { class: 'b', id: 'fp-tuts', title: 'Step-by-step Floor Planner projects', onclick: () => chooser() }, '🎓 Tutorials'),
    mk('span', { id: 'fp-saved' }, curName ? '📄 ' + curName : ''));
  const calcB = $1('#calcb'); (calcB ? calcB.parentElement : $1('header')).insertBefore(hb, calcB || null);
  { const mt = $1('#m-tut'); if (mt) { mt.textContent = 'Quick tour'; mt.title = 'The animated tour of every feature'; } }
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); e.stopPropagation(); quickSave(); } }, true);
  // offer the last plan
  { const a = lsG(AUTO, null); if (a && a.data && a.data.FLR && Object.values(a.data.FLR).some((L) => L.rooms.length)) {
    const bar = mk('div', { id: 'fp-resume' }, mk('span', { html: `Continue your last plan${a.name ? ' <b>' + escH(a.name) + '</b>' : ''}? <small style="color:#6b7280">(${stamp(a.t)})</small>` }),
      mk('button', { class: 'jt-btn pri', onclick: () => { loadPlan(a.data); curName = a.name || ''; lsS('fpCurName', curName); bar.remove(); savedMsg(curName ? '📄 ' + curName : 'Plan restored'); } }, 'Continue'),
      mk('button', { class: 'jt-btn', onclick: () => bar.remove() }, 'Start fresh'));
    bar.classList.add('jt'); wrap.appendChild(bar); setTimeout(() => bar.isConnected && bar.remove(), 30000);
  } }

  /* ---------------------------------------------------------------- small dialogs */
  function modal(title, html, small) {
    const back = mk('div', { class: 'jt jt-back' }), m = mk('div', { class: 'jt-modal' + (small ? ' sm' : ''), role: 'dialog' });
    m.innerHTML = `<header><h2>${title}</h2><button class="jt-x" aria-label="Close">✕</button></header><div class="jt-body">${html}</div>`;
    back.append(m); document.body.append(back);
    m.querySelector('.jt-x').onclick = () => back.remove();
    back.addEventListener('pointerdown', (e) => { if (e.target === back) back.remove(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') back.remove(); e.stopPropagation(); });
    return back;
  }
  function alertBox(html) { const d = modal('Floor Planner', `<p>${html}</p><div class="jt-row"><button class="jt-btn pri">OK</button></div>`, true); d.querySelector('.jt-row .jt-btn').onclick = () => d.remove(); }
  function confirmBox(msg) { try { return confirm(msg); } catch (e) { return true; } }

  /* ---------------------------------------------------------------- tutorials */
  const LV = { Easy: 0, Proficient: 1, Advanced: 2 };
  const ICS = { rect: IC10.rect, line: IC10.line, arc: IC10.arc, archDoor: IC10.door, archWindow: IC10.win, archRaise: IC10.stairs, move: IC10.select, eye: IC10.cam, measure: IC10.calc,
    text: SVGI('<path d="M4 5h12M10 5v11M7 16h6"/>'), box: SVGI('<rect x="4" y="6" width="12" height="9" rx="1"/><path d="M4 9h12"/>'), texture: SVGI('<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M3 8h14M3 13h14M8 3v14M13 3v14"/>'),
    archRoof: SVGI('<path d="M2 11l8-7 8 7"/><path d="M5 9v8h10V9"/>'), finish: SVGI('<path d="M10 3v9M6 8l4 4 4-4M4 16h12"/>'), save: SVGI('<path d="M4 3h10l3 3v11H4z"/><path d="M7 3v5h6V3M7 17v-5h7v5"/>') };
  const T = {
    fp: () => window.__fp.state(), fpOpen: () => true, fpMode: (m) => mode === m,
    fpRect: (w, d, tol = 0.05) => T.fp().rooms.find((r) => r.rect && r.dims && ((Math.abs(r.dims[0] - w) < tol && Math.abs(r.dims[1] - d) < tol) || (Math.abs(r.dims[0] - d) < tol && Math.abs(r.dims[1] - w) < tol))) || null,
    fpItems: (f) => T.fp().items.filter(f),
  };
  const passes = (s) => { if (!s.check) return false; try { return !!s.check(T); } catch (e) { return false; } };
  const LSK = 'fpTut.';
  let cur = null, panel = null, bubble = null, spot = null, timer = 0, bubT = 0;
  function chooser(level) {
    const want = level || 'All';
    const d = modal('Tutorials', `<p class="jt-intro">Pick a project. Each one walks you through the real tools, step by step, to plan a real home or room. Most take 5-12 minutes; the bigger ones about 15.</p>
      <div class="jt-remind"><b>Always save your work: </b>💾 Save (or Ctrl+S), named <b>Last name, First name, Plan name</b> <span style="color:#6b7280">(Lopez, Maria, Apartment)</span>.<br><b>Finish by downloading your plan </b>(Download plan → PDF, PNG or JPEG) to keep it or hand it in.</div>
      <div class="jt-tabs" role="tablist"></div><div class="jt-cards" id="jt-cards"></div>`);
    const tabs = d.querySelector('.jt-tabs'), list2 = d.querySelector('#jt-cards');
    const show = (lv) => {
      tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.l === lv)));
      list2.innerHTML = '';
      FP_TUTORIALS.filter((t) => lv === 'All' || t.level === lv).sort((a, b) => LV[a.level] - LV[b.level]).forEach((t) => {
        const p = lsG(LSK + t.id, null), n = p && p.done ? p.done.length : 0;
        const c = mk('button', { class: 'jt-card', id: 'jt-' + t.id, onclick: () => { d.remove(); start(t.id); } },
          mk('div', { class: 'jt-top' }, mk('span', { class: 'jt-level ' + t.level.toLowerCase() }, t.level), mk('span', { class: 'jt-time' }, `${t.minutes} min · ${t.steps.length} steps`)),
          mk('b', {}, t.title), mk('p', {}, t.blurb), mk('div', { class: 'jt-learn' }, "You'll use: " + t.learn.join(', ')),
          n ? mk('div', { class: 'jt-prog' }, n >= t.steps.length ? '✓ Finished before' : `${n} of ${t.steps.length} steps done`) : null);
        list2.append(c);
      });
    };
    for (const lv of ['All', 'Easy', 'Proficient', 'Advanced']) tabs.append(mk('button', { 'data-l': lv, id: 'jt-tab-' + lv.toLowerCase(), onclick: () => show(lv) }, lv));
    show(want);
  }
  function start(id) {
    const t = FP_TUTORIALS.find((x) => x.id === id); if (!t) return;
    stop();
    if (typeof stash !== 'undefined' && stash) try { endTut(); } catch (e) {}
    if (typeof EX !== 'undefined' && EX && id !== 'fp-class') try { exStop(); } catch (e) {}
    if (id !== 'fp-class' && typeof JOB !== 'undefined' && JOB) try { exitJob(); } catch (e) {}
    // a fresh plan for the project (the current one is kept as the autosave and in My plans)
    if (hasWork()) { if (curName) saveAs(curName); else lsS(AUTO, { name: '', t: Date.now(), data: snapPlan() }); }
    if (id !== 'fp-class') loadPlan({ FLR: { 0: { rooms: [], items: [] } }, ROOF: { st: 'gable', rg: 'side', pt: 6, ov: 1.5, peaks: 0, porch: 'none', dorm: 0 }, S: { snap: 1, plot: false, lim: false } });
    curName = ''; lsS('fpCurName', ''); savedMsg('');
    FPB.saved = false; FPB.dl.length = 0; FPB.r3 = 0; FPB.shots = 0; FPB.views.clear(); cam = null;
    if (mode !== 'tut') setMode('tut');
    cur = { t, i: 0, done: new Set(), mini: false };
    lsS(LSK + id, null);
    build(); render();
    clearInterval(timer); timer = setInterval(tick, 700);
    setTimeout(() => showMe(false), 350);
  }
  function stop() { clearInterval(timer); hideSpot(); if (panel) panel.remove(); panel = null; cur = null; }
  const saveP = () => { if (cur) lsS(LSK + cur.t.id, { i: cur.i, done: [...cur.done] }); };
  function tick() {
    if (!cur || !panel) return;
    let ch = false;
    cur.t.steps.forEach((s, k) => { if (k <= cur.i && !cur.done.has(k) && passes(s)) { cur.done.add(k); ch = true; } });
    if (ch) { saveP(); render(); if (cur.done.has(cur.i)) { const nx = $1('#jt-next', panel); if (nx) { nx.classList.remove('jt-pulse'); void nx.offsetWidth; nx.classList.add('jt-pulse'); } } }
  }
  function go(i) { if (!cur) return; cur.i = Math.max(0, Math.min(cur.t.steps.length - 1, i)); saveP(); render(); hideSpot(); setTimeout(() => showMe(false), 120); }
  function build() {
    panel = mk('aside', { class: 'jt jt-panel', id: 'jt-panel', role: 'complementary', 'aria-label': 'Tutorial' });
    document.body.append(panel);
    const right = $1('#right'), rw = right && right.offsetWidth ? right.offsetWidth : 250;
    panel.style.left = Math.max(8, innerWidth - rw - Math.min(340, innerWidth - 16) - 14) + 'px';
    panel.style.top = (innerWidth < 800 ? Math.max(60, innerHeight - 340) : 150) + 'px';
    panel.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.jt-head'); if (!h || e.target.closest('button')) return;
      const r = panel.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = (ev) => { panel.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - ox)) + 'px'; panel.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - oy)) + 'px'; };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up); e.preventDefault();
    });
  }
  function render() {
    if (!panel || !cur) return;
    const { t, i } = cur, s = t.steps[i], n = t.steps.length, dn = cur.done.size, isDone = cur.done.has(i);
    panel.classList.toggle('mini', cur.mini); panel.innerHTML = '';
    panel.append(mk('div', { class: 'jt-head' }, mk('span', { class: 'jt-level ' + t.level.toLowerCase() }, t.level), mk('b', { class: 'jt-title' }, t.title),
      mk('button', { class: 'jt-ic', id: 'jt-min', title: cur.mini ? 'Show the steps' : 'Make this small', onclick: () => { cur.mini = !cur.mini; render(); } }, cur.mini ? '▢' : '–'),
      mk('button', { class: 'jt-ic', id: 'jt-close', title: 'Close the tutorial (your plan stays)', onclick: () => stop() }, '✕')),
      mk('div', { class: 'jt-bar' }, mk('i', { style: `width:${Math.round((100 * dn) / n)}%` })));
    if (cur.mini) { panel.append(mk('button', { class: 'jt-mini', onclick: () => { cur.mini = false; render(); } }, `Step ${i + 1} of ${n}: ${s.title}${isDone ? ' ✓' : ''}`)); return; }
    const st = mk('div', { class: 'jt-step' },
      mk('div', { class: 'jt-no' }, mk('span', {}, `Step ${i + 1} of ${n}`), isDone ? mk('span', { class: 'jt-ok' }, '✓ Done') : null),
      mk('h3', {}, s.title),
      mk('div', { class: 'jt-tool' }, mk('span', { class: 'jt-tool-ic', html: ICS[s.icon] || ICS.box }), mk('span', {}, mk('small', {}, 'Tool'), mk('b', {}, s.tool)),
        s.show ? mk('button', { class: 'jt-btn', id: 'jt-show', onclick: () => showMe(true) }, 'Show me') : null),
      mk('div', { class: 'jt-sub' }, 'How'), mk('ol', { class: 'jt-how', html: s.how.map((h) => `<li>${h}</li>`).join('') }),
      s.when ? mk('div', { class: 'jt-when', html: '<b>When to use it:</b> ' + s.when }) : null,
      s.tip ? mk('div', { class: 'jt-tip', html: '<b>Tip:</b> ' + s.tip }) : null);
    const mark = mk('label', { class: 'jt-mark' }, mk('input', { type: 'checkbox', id: 'jt-check', onchange: (e) => { if (e.target.checked) cur.done.add(i); else cur.done.delete(i); saveP(); render(); } }), 'I did this');
    mark.querySelector('input').checked = isDone;
    const last = i === n - 1;
    const nav = mk('div', { class: 'jt-nav' }, mk('button', { class: 'jt-btn', id: 'jt-prev', disabled: i === 0, onclick: () => go(i - 1) }, '← Back'), mark,
      mk('button', { class: 'jt-btn pri', id: 'jt-next', onclick: () => (last ? finish() : go(i + 1)) }, last ? 'Finish ✓' : 'Next →'));
    const lst = mk('ol', { class: 'jt-list' });
    t.steps.forEach((x, k) => lst.append(mk('li', { class: (k === i ? 'cur ' : '') + (cur.done.has(k) ? 'done' : '') }, mk('button', { onclick: () => go(k) }, mk('span', { class: 'jt-box' }, cur.done.has(k) ? '✓' : ''), x.title))));
    const det = mk('details', { class: 'jt-check' }, mk('summary', {}, `Checklist · ${dn} of ${n} done`), lst); if (innerWidth > 700) det.open = true;
    panel.append(st, nav, det);
  }
  function finish() {
    const t = cur.t, n = cur.done.size, all = t.steps.length; saveP(); stop();
    const d = modal('Project done', `<p style="font-size:15px"><b>${escH(t.title)}</b>: ${n} of ${all} steps done${n >= all ? ' 🎉' : ''}.</p><p class="jt-intro">${curName ? 'Your plan is saved as <b>' + escH(curName) + '</b>.' : 'Remember to 💾 Save your plan.'} Try another project, or keep designing.</p><div class="jt-row"><button class="jt-btn pri" id="jfmore">More tutorials</button><button class="jt-btn" id="jfok">Keep designing</button></div>`, true);
    $1('#jfmore', d).onclick = () => { d.remove(); chooser(); }; $1('#jfok', d).onclick = () => d.remove();
  }
  function hideSpot() { clearTimeout(bubT); if (spot) spot.classList.remove('jt-spot'); spot = null; if (bubble) bubble.remove(); bubble = null; }
  function showMe(loud) {
    if (!cur || !panel || cur.mini) return;
    const s = cur.t.steps[cur.i]; hideSpot(); if (!s.show || !s.show.fp) return;
    const el = window.__fp.el(s.show.fp);
    if (!el) { if (loud) savedMsg('ⓘ It appears when the step before is done (or in another mode).'); return; }
    spot = el; el.classList.add('jt-spot');
    const r = el.getBoundingClientRect();
    bubble = mk('div', { class: 'jt-bubble', role: 'status' }, mk('b', {}, s.tool), mk('span', {}, /#ir-|\.nm|#pw|#pd|#sq|#sgt/.test(s.show.fp) ? 'Type it in this box.' : 'Click here.'));
    document.body.append(bubble);
    const bw = Math.min(240, innerWidth - 16), below = r.bottom + 100 < innerHeight;
    bubble.style.width = bw + 'px'; bubble.style.left = Math.max(8, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2)) + 'px';
    bubble.style.top = (below ? r.bottom + 12 : Math.max(8, r.top - 70)) + 'px';
    bubT = setTimeout(hideSpot, loud ? 6000 : 4500);
  }
  addEventListener('pointerdown', (e) => { if (bubble && !e.target.closest('#jt-show')) { clearTimeout(bubT); bubT = setTimeout(hideSpot, 900); } }, true);
  window.__fpTut = { start, stop, chooser, get current() { return cur ? { id: cur.t.id, step: cur.i, done: [...cur.done] } : null; }, T, steps: (id) => FP_TUTORIALS.find((x) => x.id === id).steps };
  window.__fpSave = { quickSave, saveAs, plans, loadPlan, snapPlan, saveFile, plansDialog, get name() { return curName; } };
})();
