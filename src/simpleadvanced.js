import { ICON } from "./icons.js";
import { store } from "./store.js";

export function initSimpleAdvanced(app, plate, collapse) {
  const $ = id => document.getElementById(id), root = document.documentElement;
  const work = document.querySelector('main.work'), browser = $('browser'), timeline = $('timeline');
  const positions = [browser, timeline].map(el => { const mark = document.createComment(`${el.id} position`); el.after(mark); return { el, parent: el.parentNode, mark }; });
  const panel = document.createElement('aside'); panel.id = 'simple-adv-panel'; panel.setAttribute('aria-label', 'Browser and Timeline');
  panel.innerHTML = '<button id="sap-sheet" type="button" aria-expanded="false"><span class="sap-grip" aria-hidden="true"></span><span class="sap-sheet-label">Browser · Timeline</span></button><div id="sap-note" role="status" hidden></div><section id="sap-browser"><button class="sap-head" type="button" aria-expanded="true" aria-controls="sap-browser-slot"><span class="sap-count">Browser (0)</span> <span class="sap-arrow" aria-hidden="true">▾</span></button><div id="sap-browser-slot" class="sap-slot"></div></section><section id="sap-timeline"><button class="sap-head" type="button" aria-expanded="true" aria-controls="sap-timeline-slot"><span class="sap-count">Timeline (0)</span> <span class="sap-arrow" aria-hidden="true">▾</span></button><div id="sap-timeline-slot" class="sap-slot"></div></section>';
  work.append(panel);
  const sheet = $('sap-sheet'), handle = $('simple-collapse-panel');
  let sections = { browser: true, timeline: true };
  try { const saved = JSON.parse(localStorage.getItem('jumpstart.simple.adv.sections')); for (const key of Object.keys(sections)) if (typeof saved?.[key] === 'boolean') sections[key] = saved[key]; } catch (e) { /* storage may be unavailable */ }
  function setSection(key, open) {
    sections[key] = open; const section = $('sap-' + key), head = section.querySelector('.sap-head');
    head.setAttribute('aria-expanded', String(open)); head.querySelector('.sap-arrow').textContent = open ? '▾' : '▸'; section.querySelector('.sap-slot').hidden = !open;
    try { localStorage.setItem('jumpstart.simple.adv.sections', JSON.stringify(sections)); } catch (e) { /* storage may be unavailable */ }
  }
  for (const key of Object.keys(sections)) { setSection(key, sections[key]); $('sap-' + key).querySelector('.sap-head').onclick = () => setSection(key, !sections[key]); }
  function setSheet(open) { panel.classList.toggle('expanded', open); sheet.setAttribute('aria-expanded', String(open)); sheet.setAttribute('aria-label', open ? 'Close Browser and Timeline' : 'Show Browser and Timeline'); }
  setSheet(false);
  sheet.onclick = () => setSheet(!panel.classList.contains('expanded'));
  panel.addEventListener('keydown', e => { if (e.target.matches('.sap-head, #sap-sheet') && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation(); });
  const active = () => root.dataset.face === 'simple' && app.mode === 'advanced';
  function update() {
    const on = active(), move = on && app.advanced.workspace !== 'print' && !document.body.classList.contains('ps-orca');
    positions.forEach(({ el, parent, mark }) => { const slot = $(el === browser ? 'sap-browser-slot' : 'sap-timeline-slot'); if (move && el.parentNode !== slot) slot.append(el); else if (!move && el.parentNode !== parent) parent.insertBefore(el, mark); });
    $('sap-browser').querySelector('.sap-count').textContent = `Browser (${(store.doc.bodies || []).length + (store.doc.sketches || []).length})`;
    $('sap-timeline').querySelector('.sap-count').textContent = `Timeline (${timeline.querySelectorAll('.tl-item').length})`;
    handle.setAttribute('aria-controls', on ? 'simple-adv-panel' : 'simple-panel');
    const label = (handle.getAttribute('aria-expanded') === 'false' ? 'Show the ' : 'Hide the ') + (on ? 'Browser and Timeline' : 'shape panel');
    handle.setAttribute('aria-label', label); handle.title = label;
    if (!on) setSheet(false);
    updateRail();
  }
  const rail = $('simple-rail'), more = $('simple-more'), sar = document.createElement('div');
  sar.id = 'sar'; $('sr-more').before(sar);
  const sets = {
    design: [['ad-sketch','Sketch','sketch',1],['ad-extrude','Extrude','extrude',1],['ad-revolve','Revolve','revolve',1,'ad-features'],['ad-edge','Fillet','fillet',1],['ad-hole','Hole','hole',1],['ad-shell','Shell','shell',1],['ad-pattern','Pattern','pattern'],['ad-measure','Measure','measure']],
    sketch: [['sk-line','Line','line',1],['sk-rect','Rectangle','rect',1],['sk-circle','Circle','circle',1],['sk-arc3','Arc','arc3'],['sk-dim','Dimension','dim',1],['sk-constraints','Constraints','constraints',1],['sk-trim','Trim','trim'],['sk-extrude','Extrude','extrude'],['sk-finish','Finish','finish',1]],
    print: [['ws-design','Design','back',1],['ps-r-auto','Auto orient','printer3d',1],['ps-r-lay','Lay on face','drop',1],['ps-r-arrange','Arrange','pattern',1],['ps-r-slice','Slice','printsim',1],['ps-r-play','Play','motion',1],['ps-r-gcode','G-code','archExport']],
    simulate: [['ws-design','Design','back',1],['sim-joint','Joint','joint',1],['sim-drive','Drive','drive',1],['sim-motion','Motion','motion',1],['sim-stress','Stress','stress',1],['sim-render','Render','render',1],['sim-reset','Reset pose','clearSim'],['sim-apply','Apply pose','move']]
  };
  const groups = [
    ['Workspaces', [['ws-design','Design'],['ws-print','3D Print Sim'],['ws-simulate','Simulate']]],
    ['Create', [['ad-sketch3d','3D Sketch'], ...'sweep pipe coil loft rib keyhole mirror holepattern thread thread-offset'.split(' ').map(x => ['ad-'+x, null, 'ad-features'])]],
    ['Primitives', 'box cyl sphere torus prism cone pyramid tube capsule text3d'.split(' ').map(x => ['ad-'+x, null, 'ad-prims'])],
    ['Modify', [['ad-moverot'],['ad-fillopen'], ...['fillet','chamfer'].map(x => ['ad-'+x,null,'ad-edge-more']), ...'offset clearance combine splitbody splitface'.split(' ').map(x => ['ad-'+x,null,'ad-advmod']), ...'move scale align'.split(' ').map(x => ['ad-'+x,null,'ad-transform'])]],
    ['Decorate', 'texture facepat emboss appearance'.split(' ').map(x => ['ad-'+x,null,'ad-decorate'])],
    ['Planes', 'plane-off plane-ang plane-mid'.split(' ').map(x => ['ad-'+x,null,'ad-construct'])],
    ['Insert', 'svg dxf img model realpart'.split(' ').map(x => ['ad-ins-'+x,null,'ad-insert'])],
    ['Parts', 'fasteners hinge gear gears nameplate knurl spring'.split(' ').map(x => ['ad-'+x,x === 'gears' ? 'Gear library' : null,'ad-features'])],
    ['Inspect', [['ad-section']]], ['Workshop', 'jigs chipcarve lathe'.split(' ').map(x => ['ad-'+x,null,'ad-workshop'])],
    ['Simulate', 'joint drive motion stress print render reset apply'.split(' ').map(x => ['sim-'+x,null,'ws-simulate'])],
    ['Studios', [...'meshstep bricks cam voxel bins cosforge layerscape helmet flexigen neon sglass'.split(' ').map(x => ['sim-'+x,null,'ws-simulate']), ...'fasteners hinge gears chipcarve lathe'.split(' ').map(x => ['sim-'+x])]],
    ['3D Print Sim', 'prepare preview rx ry model strength'.split(' ').map(x => ['ps-r-'+x])],
    ['Sketch', [...'arcc polygon spline point text cons mirror select cpin'.split(' ').map(x => ['sk-'+x]), ...['rect3','rectc'].map(x => ['sk-'+x,null,'sk-rect-more']), ...['svg','dxf','img'].map(x => ['sk-ins-'+x,null,'sk-insert'])]],
    ['Constraints', 'coincident horizontal vertical parallel perpendicular tangent concentric equal midpoint fixed'.split(' ').map(x => ['sk-c-'+x,null,'sk-constraints'])]
  ];
  const friendly = id => ({cyl:'Cylinder',text3d:'3D text',holepattern:'Hole pattern',thread:'Thread', 'thread-offset':'Thread offset',moverot:'Move / rotate',fillopen:'Fill openings',splitbody:'Split body',splitface:'Split face',facepat:'Face pattern',realpart:'Real part',nameplate:'Name plate',chipcarve:'Chip carving',arcc:'Center arc',cons:'Construction',cpin:'Pin',rect3:'3-point rectangle',rectc:'Center rectangle',rx:'Rotate X',ry:'Rotate Y',sglass:'Stained glass'})[id.split('-').slice(1).join('-')] || id.split('-').slice(1).join(' ').replace(/\b\w/g, c => c.toUpperCase());
  const back = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg>';
  function button(id, label, icon, via) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.for = id; if (via) b.dataset.via = via;
    b.innerHTML = (icon === 'back' ? back : ICON[icon] || '') + '<span></span>'; b.querySelector('span').textContent = label || friendly(id); return b;
  }
  for (const [set, items] of Object.entries(sets)) for (const [id,label,icon,phone,via] of items) {
    const b = button(id,label,icon,via); b.id = 'sar-' + id; b.dataset.set = set; if (phone) b.dataset.phone = 'true'; sar.append(b);
  }
  // Design appears in two sets but must have a unique id.
  sar.querySelectorAll('#sar-ws-design')[1].removeAttribute('id');
  const ai = more.querySelector('.simple-ai');
  function section(name, cls = '') { const s = document.createElement('section'); s.className = 'sadv-group ' + cls; const h = document.createElement('h3'); h.textContent = name; const grid = document.createElement('div'); grid.className = 'simple-grid'; s.append(h,grid); ai.before(s); return s; }
  for (const [name, items] of groups) { const s = section(name); s.dataset.group = name; for (const [id,label,via] of items) s.lastChild.append(button(id,label,'',via)); }
  const onrail = section('On the rail','simple-arrange sadv-onrail');
  for (const [set,items] of Object.entries(sets)) for (const [id,label,icon,phone,via] of items) { const b = button(id,label,icon,via); b.dataset.set = set; if (phone) b.dataset.phone = 'true'; onrail.lastChild.append(b); }
  const aliases = section('Aliases','sadv-alias');
  for (const [id,via] of [['ad-hole-m','ad-features'],['ad-fastbtn'],['ad-ins-fast','ad-insert'],['ad-ins-hinge','ad-insert'],['ad-ins-gear','ad-insert']]) aliases.lastChild.append(button(id,null,'',via));
  const other = section('Other','sadv-other');
  const titles = {'ws-design':'Design: sketch, extrude, pattern and measure','ws-print':'3D Print Sim: orient, arrange, slice and G-code','ws-simulate':'Simulate: joint, motion, stress and voxel'};
  let previousSet = '', menuFromRail = false, ignoreClick = false;
  window.addEventListener('pointerdown', e => { if (root.dataset.face === 'simple' && e.target.closest?.('#sar [data-for="sk-constraints"]') && menuFromRail && $('ribbon-menu')) { ignoreClick = true; e.stopPropagation(); } }, true);
  sar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.dataset.for !== 'sk-constraints') return;
    if (ignoreClick) { ignoreClick = false; e.stopImmediatePropagation(); menuFromRail = false; document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); b.focus(); return; }
    // The delegated handler opens the original menu after this listener.
    queueMicrotask(() => { const menu = $('ribbon-menu'); if (!menu) return; menuFromRail = true; const r = b.getBoundingClientRect(); if (matchMedia('(max-width: 640px)').matches) { menu.style.left = '0px'; menu.style.width = '100%'; menu.style.top = Math.max(0, rail.getBoundingClientRect().top - menu.offsetHeight) + 'px'; } else { menu.style.left = Math.min(r.right + 6, innerWidth - menu.offsetWidth) + 'px'; menu.style.top = Math.max(0, Math.min(r.top, innerHeight - menu.offsetHeight)) + 'px'; } });
  });
  window.addEventListener('keydown', e => { if (root.dataset.face !== 'simple' || e.key !== 'Escape' || !menuFromRail || !$('ribbon-menu')) return; e.preventDefault(); e.stopImmediatePropagation(); menuFromRail = false; document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); $('sar-sk-constraints')?.focus(); }, true);
  function updateRail() {
    if (root.dataset.face !== 'simple') return;
    const set = app.sketcher?.active ? 'sketch' : app.mode === 'advanced' ? app.advanced.workspace : '';
    const focused = sar.contains(document.activeElement); rail.dataset.set = set;
    for (const b of sar.querySelectorAll('button')) b.hidden = b.dataset.set !== set;
    if (focused && previousSet !== set) requestAnimationFrame(() => [...sar.querySelectorAll('button:not([hidden]):not(:disabled)')].find(b => b.getClientRects().length)?.focus()); previousSet = set;
    $('sap-note').hidden = set !== 'sketch'; $('sap-note').textContent = $('sk-note')?.textContent || '';
    for (const b of [...sar.querySelectorAll('button'), ...more.querySelectorAll('.sadv-group button')]) {
      const original = $(b.dataset.for); if (original) {
        b.disabled = original.disabled; const pressed = original.getAttribute('aria-pressed') ?? original.getAttribute('aria-selected'); if (pressed !== null) b.setAttribute('aria-pressed', pressed); else b.removeAttribute('aria-pressed');
        if (!titles[b.dataset.for]) b.title = original.title || original.textContent.trim();
        if (['ad-edge','sk-rect'].includes(b.dataset.for)) { const svg = original.querySelector('svg'), old = b.querySelector('svg'); if (svg && old) old.replaceWith(svg.cloneNode(true)); }
        if (['ad-edge','sk-cpin'].includes(b.dataset.for)) b.querySelector('span').textContent = original.querySelector('span')?.textContent.trim() || original.textContent.trim();
      } else b.disabled = false;
      if (titles[b.dataset.for]) b.title = titles[b.dataset.for];
    }
    for (const original of document.querySelectorAll('#ribbon button[id]')) {
      if (original.hasAttribute('aria-haspopup') || more.querySelector(`[data-for="${original.id}"]`) || sar.querySelector(`[data-for="${original.id}"]`)) continue;
      const b = button(original.id, original.getAttribute('aria-label') || original.textContent.trim()); b.title = original.title; other.lastChild.append(b);
    }
  }
  new MutationObserver(updateRail).observe($('ribbon'), {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['aria-pressed','disabled','aria-selected']});

  let timelineCount = timeline.querySelectorAll('.tl-item').length;
  new MutationObserver(() => {
    const count = timeline.querySelectorAll('.tl-item').length, slot = $('sap-timeline-slot');
    if (count > timelineCount && timeline.parentNode === slot && !timeline.querySelector('.tl-now') && matchMedia('(min-width: 641px)').matches) slot.scrollTop = slot.scrollHeight;
    timelineCount = count; update();
  }).observe(timeline, { childList: true });
  const refresh = app.refreshUI; app.refreshUI = function (...args) { const result = refresh.apply(this, args); update(); return result; };
  const layout = plate.layout; plate.layout = (...args) => { const result = layout(...args); update(); return result; };
  const workspace = app.advanced.setWorkspace; app.advanced.setWorkspace = function (...args) { const result = workspace.apply(this, args); update(); return result; };
  const reveal = collapse.reveal; collapse.reveal = function (el) {
    if (active() && el?.closest('#simple-adv-panel')) {
      if (root.dataset.simpleHide?.split(/\s+/).includes('panel')) handle.click();
      const section = el.closest('#sap-browser, #sap-timeline'); if (section) setSection(section.id.slice(4), true);
      if (matchMedia('(max-width: 640px)').matches) setSheet(true);
    }
    return reveal.call(this, el);
  };
  handle.addEventListener('click', () => update());
  new MutationObserver(update).observe(handle, { attributes: true, attributeFilter: ['aria-expanded'] });
  document.addEventListener('click', e => { if (active() && e.target.closest('#ribbon .panel-toggle')) { e.preventDefault(); e.stopPropagation(); const hidden = root.dataset.simpleHide?.split(/\s+/).includes('panel'), phone = matchMedia('(max-width: 640px)').matches, collapsed = phone && !panel.classList.contains('expanded'); if (hidden) handle.click(); setSection('browser', hidden || collapsed || !sections.browser); if (phone) setSheet(true); } }, true);
  // Print Sim also closes through its own callback, without calling the public workspace setter.
  new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const style = document.createElement('style'); style.id = 'simpleadvanced-css'; style.textContent = `
#simple-adv-panel { display: none; }
html[data-face="simple"] #app[data-mode="advanced"] .work { --sap-rail-w: 0px; --sap-panel-w: 280px; grid-template-columns: var(--sap-rail-w) minmax(0, 1fr) var(--sap-panel-w); }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel { display: flex; grid-column: 3; grid-row: 1; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; background: var(--panel); color: var(--ink); border-left: 1px solid var(--line); font-family: var(--f-ui); }
html[data-face="simple"][data-simple-hide~="panel"] #app[data-mode="advanced"] .work, html[data-face="simple"] body.ps-orca #app[data-mode="advanced"] .work { --sap-panel-w: 0px; }
html[data-face="simple"][data-simple-hide~="panel"] #app[data-mode="advanced"] #simple-adv-panel, html[data-face="simple"] body.ps-orca #app[data-mode="advanced"] #simple-adv-panel { display: none; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel section { display: flex; flex-direction: column; min-height: 0; flex: 1 1 0; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel section:has(.sap-slot[hidden]) { flex: none; }
html[data-face="simple"] #app[data-mode="advanced"] .sap-head, html[data-face="simple"] #app[data-mode="advanced"] #sap-sheet { flex: none; width: 100%; min-height: 44px; padding: 0 12px; border: 0; border-bottom: 1px solid var(--line); background: var(--panel-2); color: var(--ink); font: 600 14px var(--f-ui); text-align: left; cursor: pointer; }
html[data-face="simple"] #app[data-mode="advanced"] .sap-head .sap-arrow { float: right; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel :is(.sap-head, #sap-sheet):focus-visible { outline-offset: -2px; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel :is(.sap-head, #sap-sheet):hover { background: var(--accent-soft); }
html[data-face="simple"] #app[data-mode="advanced"] .sap-slot:not([hidden]) { min-height: 0; overflow: auto; flex: 1; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel #browser { display: block; position: static; width: 100%; height: auto; min-height: 0; box-sizing: border-box; box-shadow: none; border: 0; overflow: visible; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel #browser > h3, html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel .tl-title { display: none; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel #timeline { position: static; display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; width: auto; height: auto; max-width: none; overflow: visible; border: 0; border-radius: 0; box-shadow: none; background: var(--panel); }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel #timeline :is(.tl-item, .empty) { flex: 1 0 100%; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel .tl-ctls { align-self: flex-start; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel .tl-item { display: flex; align-items: center; gap: 8px; width: 100%; height: auto; min-height: 32px; padding: 5px 8px; text-align: left; box-sizing: border-box; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel .tl-item::after { content: attr(aria-label); overflow-wrap: anywhere; }
#sap-sheet { display: none; }
@media (min-width: 641px) {
 html[data-face="simple"] #app[data-mode="advanced"] #sap-browser-slot:not([hidden]) { display: flex; flex-direction: column; overflow: hidden; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel #browser { display: flex; flex-direction: column; flex: 1; min-height: 0; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel #browser .tree { flex: 1 1 auto; min-height: 72px; overflow: auto; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel #browser .props { flex: none; max-height: 60%; overflow: auto; }
}
@media (pointer: coarse) {
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel .tl-item { min-height: 44px; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel .tl-ctl { width: 44px; height: 44px; }
}
@media (min-width: 641px) and (max-width: 1100px) { html[data-face="simple"] #app[data-mode="advanced"] .work { --sap-panel-w: 236px; } html[data-face="simple"][data-simple-hide~="panel"] #app[data-mode="advanced"] .work, html[data-face="simple"] body.ps-orca #app[data-mode="advanced"] .work { --sap-panel-w: 0px; } }
@media (max-width: 640px) {
 html[data-face="simple"] #app[data-mode="advanced"] .work { --sap-panel-w: 0px; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel { position: relative; z-index: 35; grid-column: 1 / -1; grid-row: 1; align-self: end; height: 44px; border: 1px solid var(--line); border-radius: 12px 12px 0 0; box-shadow: 0 -4px 16px #0002; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel.expanded { height: 50%; overflow-y: auto; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel.expanded section { flex: none; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel.expanded .sap-slot:not([hidden]) { overflow: visible; }
 html[data-face="simple"] #app[data-mode="advanced"] #sap-sheet { display: flex; flex-direction: column; align-items: center; justify-content: center; position: sticky; top: 0; z-index: 2; height: 44px; background: var(--panel); }
 html[data-face="simple"] #app[data-mode="advanced"] #sap-sheet .sap-grip { display: block; width: 36px; height: 4px; flex: none; border-radius: 2px; background: var(--line); }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel.expanded #sap-sheet .sap-sheet-label { display: none; }
 /* PR 2 removes: leave room for Simple's More button while collapsed. */
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel:not(.expanded) #sap-sheet { padding-left: 64px; }
 /* PR 2 removes: move Simple's More button aside while the sheet is open. */
 html[data-face="simple"] #app[data-mode="advanced"] .work:has(#simple-adv-panel.expanded) #simple-rail { display: none; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel:not(.expanded) > :not(#sap-sheet) { display: none; }
 html[data-face="simple"]:not([data-simple-hide~="panel"]) #app[data-mode="advanced"] #simple-collapse-panel { display: none; }
}
html[data-face="simple"] #app[data-mode="advanced"] { grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr) auto; }
html[data-face="simple"] #app[data-mode="advanced"] > .topbar { grid-column: 1; grid-row: 1; }
html[data-face="simple"] #app[data-mode="advanced"] > .work { grid-column: 1; grid-row: 2; grid-template-columns: 80px minmax(0,1fr) 280px; }
html[data-face="simple"] #app[data-mode="advanced"] > .status { grid-column: 1; grid-row: 3; }
html[data-face="simple"] #app[data-mode="advanced"] #ribbon { display:none; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-rail { display:flex; grid-column:1; grid-row:1; width:80px; min-height:0; box-sizing:border-box; flex-direction:column; overflow-y:auto; background:var(--panel); border-right:1px solid var(--line); }
html[data-face="simple"] #app[data-mode="advanced"] #simple-rail > button:not(#sr-more), html[data-face="simple"] #simple-rail[data-set="sketch"] > button:not(#sr-more) { display:none; }
html[data-face="simple"] #sar { display:none; }
html[data-face="simple"] #simple-rail[data-set]:not([data-set=""]) #sar { display:contents; }
html[data-face="simple"] #sar [data-for="sk-finish"] { color:var(--accent); }
html[data-face="simple"] #app[data-mode="advanced"] #simple-more:not([hidden]) { display:block; position:absolute; left:80px; bottom:0; z-index:40; width:min(380px, calc(100% - 80px)); box-sizing:border-box; max-height:100%; overflow:auto; padding:14px; background:var(--panel); color:var(--ink); border:1px solid var(--line); border-radius:0 10px 10px 0; box-shadow:0 8px 24px #0003; }
html[data-face="simple"] #app[data-mode="beginner"] .sadv-group:not([data-group="Sketch"]):not([data-group="Constraints"]):not(.sadv-onrail), html[data-face="simple"] #app[data-mode="beginner"] #simple-rail:not([data-set="sketch"]) ~ #simple-more .sadv-group, html[data-face="simple"] .sadv-alias { display:none !important; }
html[data-face="simple"] #simple-rail:not([data-set="sketch"]) ~ #simple-more :is([data-group="Sketch"],[data-group="Constraints"]), html[data-face="simple"] #simple-rail:not([data-set="print"]) ~ #simple-more [data-group="3D Print Sim"] { display:none; }
html[data-face="simple"] #simple-more .sadv-onrail button { display:none; }
html[data-face="simple"] #simple-rail[data-set="design"] ~ #simple-more .sadv-onrail [data-set="design"], html[data-face="simple"] #simple-rail[data-set="sketch"] ~ #simple-more .sadv-onrail [data-set="sketch"], html[data-face="simple"] #simple-rail[data-set="print"] ~ #simple-more .sadv-onrail [data-set="print"], html[data-face="simple"] #simple-rail[data-set="simulate"] ~ #simple-more .sadv-onrail [data-set="simulate"] { display:flex; }
html[data-face="simple"] #app[data-mode="advanced"] #simple-more :is([data-for="simple-run-rib"],[data-for="simple-run-keyhole"],[data-for="simple-run-jigs"],[data-for="simple-run-helmet"]) { display:none; }
html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="advanced"] #simple-rail { display:none; }
html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="advanced"] .work { grid-template-columns:0 minmax(0,1fr) 280px; }
html[data-face="simple"][data-simple-hide~="panel"] #app[data-mode="advanced"] .work, html[data-face="simple"] body.ps-orca #app[data-mode="advanced"] .work { grid-template-columns:80px minmax(0,1fr) 0; }
html[data-face="simple"][data-simple-hide~="rail"][data-simple-hide~="panel"] #app[data-mode="advanced"] .work, html[data-face="simple"][data-simple-hide~="rail"] body.ps-orca #app[data-mode="advanced"] .work { grid-template-columns:0 minmax(0,1fr) 0; }
@media (min-width:641px) and (max-width:1100px) { html[data-face="simple"] #app[data-mode="advanced"] .work { grid-template-columns:80px minmax(0,1fr) 236px; } html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="advanced"] .work { grid-template-columns:0 minmax(0,1fr) 236px; } html[data-face="simple"][data-simple-hide~="panel"] #app[data-mode="advanced"] .work, html[data-face="simple"] body.ps-orca #app[data-mode="advanced"] .work { grid-template-columns:80px minmax(0,1fr) 0; } }
@media (max-width:640px) {
 html[data-face="simple"] #app[data-mode="advanced"] .work, html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="advanced"] .work, html[data-face="simple"][data-simple-hide~="panel"] #app[data-mode="advanced"] .work, html[data-face="simple"] body.ps-orca #app[data-mode="advanced"] .work { grid-template-columns:0 minmax(0,1fr) 0; grid-template-rows:minmax(0,1fr) auto 58px; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-rail { grid-column:1 / -1; grid-row:3; width:100%; flex-direction:row; overflow:hidden; border-right:0; border-top:1px solid var(--line); }
 html[data-face="simple"] #simple-rail[data-set] #sar button:not([data-phone]) { display:none; }
 html[data-face="simple"] #simple-more:not(.searching) .sadv-onrail button[data-phone] { display:none; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-more:not([hidden]) { left:0; right:0; top:auto; bottom:58px; width:100%; max-height:min(70vh,calc(100% - 58px)); border-radius:10px 10px 0 0; }
 html[data-face="simple"] #app[data-mode="advanced"] .work:has(#simple-adv-panel.expanded) #simple-rail { display:flex; }
}
`; document.head.append(style);
  update();
}
