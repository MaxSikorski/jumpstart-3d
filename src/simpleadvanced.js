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
  }
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
`; document.head.append(style);
  update();
}
