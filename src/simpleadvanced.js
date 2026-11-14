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
    design: [['ad-prims','Primitives','box',1],['ad-sketch','Sketch','sketch',1],['ad-extrude','Extrude','extrude',1],['ad-revolve','Revolve','revolve',0,'ad-features'],['ad-edge','Fillet','fillet',1],['ad-hole','Hole','hole',1],['ad-shell','Shell','shell',1],['ad-pattern','Pattern','pattern'],['ad-measure','Measure','measure']],
    sketch: [['sk-line','Line','line',1],['sk-rect','Rectangle','rect',1],['sk-circle','Circle','circle',1],['sk-arc3','Arc','arc3'],['sk-dim','Dimension','dim',1],['sk-constraints','Constraints','constraints',1],['sk-trim','Trim','trim'],['sk-extrude','Extrude','extrude'],['sk-finish','Finish','finish',1]],
    print: [['ws-design','Design','back',1],['ps-r-auto','Auto orient','printer3d',1],['ps-r-lay','Lay on face','drop',1],['ps-r-arrange','Arrange','pattern',1],['ps-r-slice','Slice','printsim',1],['ps-r-play','Play','motion',1],['ps-r-gcode','G-code','archExport']],
    simulate: [['ws-design','Design','back',1],['sim-joint','Joint','joint',1],['sim-drive','Drive','drive',1],['sim-motion','Motion','motion',1],['sim-stress','Stress','stress',1],['sim-render','Render','render',1],['sim-reset','Reset pose','clearSim'],['sim-apply','Apply pose','move']]
  };
  const groups = [
    ["Workspaces", [
      ["ws-design","Design",null,"sketch","Design"],
      ["ws-print","3D Print Sim",null,"printsim","3D Print Sim"],
      ["ws-simulate","Simulate",null,"motion","Simulate"]
    ]],
    ["Create", [
      ["ad-sketch3d","3D Sketch",null,"spline","Draw lines in 3D on a body, a virtual sphere or cube, or in the air, with a split camera view. Works with touch, pen, mouse and trackpad."],
      ["ad-sweep","Sweep","ad-features","sweep","Sweep a profile along a path"],
      ["ad-pipe","Pipe","ad-features","pipe","A round, square or triangular tube along a path"],
      ["ad-coil","Coil","ad-features","coil","Springs and spirals"],
      ["ad-loft","Loft","ad-features","loft","Blend between profiles on different planes (square to circle, to a point, along a centerline…)"],
      ["ad-rib","Rib","ad-features","rib","Reinforce: straight ribs or corner gussets standing on a flat face"],
      ["ad-keyhole","Keyhole slot","ad-features","keyhole","Cut keyhole slots in a face so the part hangs on screws"],
      ["ad-mirror","Mirror","ad-features","mirror","Mirror bodies across a plane or flat face"],
      ["ad-holepattern","Hole pattern","ad-features","hole","Rows, staggered rows or a circle of round, square, hex or slot holes on a flat face"],
      ["ad-thread","Thread","ad-features","thread","Modeled metric (ISO) and inch (UNC / UNF) threads on round faces"],
      ["ad-thread-offset","Thread print offset…","ad-features","thread","Loosen printed threads"]
    ]],
    ["Primitives", [
      ["ad-box","Box","ad-prims","box","Box"],
      ["ad-cyl","Cylinder","ad-prims","cylinder","Cylinder"],
      ["ad-sphere","Sphere","ad-prims","sphere","Sphere"],
      ["ad-torus","Torus","ad-prims","torus","Torus"],
      ["ad-prism","Prism","ad-prims","prism","Prism with 3 to 24 sides"],
      ["ad-cone","Cone","ad-prims","cone","Cone"],
      ["ad-pyramid","Pyramid","ad-prims","pyramid","Pyramid"],
      ["ad-tube","Tube","ad-prims","tube","Tube"],
      ["ad-capsule","Capsule","ad-prims","capsule","Capsule"],
      ["ad-text3d","3D text","ad-prims","text","Text that sits on any face or the workplane: drag it into place"]
    ]],
    ["Modify", [
      ["ad-moverot","Move / Rotate",null,"move","Move or turn the selected shape in 3D: drag an arrow to move, a ring to turn, or type exact values"],
      ["ad-fillopen","Fill openings",null,"fillOpen","Make the openings in a flat face solid (vents, slots, holes, logos)"],
      ["ad-fillet","Fillet","ad-edge-more","fillet","Round edges (F)"],
      ["ad-chamfer","Chamfer","ad-edge-more","chamfer","Bevel edges (C)"],
      ["ad-offset","Offset face","ad-advmod","offset","Offset face / press pull (Q): click faces, or drag a box around a whole body"],
      ["ad-clearance","Clearance","ad-advmod","joint","Give moving parts room: finds bodies that touch or overlap and cuts a small gap (0.2-0.5 mm) so they don't print fused"],
      ["ad-combine","Combine","ad-advmod","combine","Combine: group join cut subtract or intersect bodies (B)"],
      ["ad-splitbody","Split body","ad-advmod","splitBody","Cut a body into pieces with a plane, a face or another body"],
      ["ad-splitface","Split face","ad-advmod","splitFace","Divide faces with a plane or sketch curve (the shape stays the same)"],
      ["ad-move","Move/Copy","ad-transform","move","Move / Copy (M)"],
      ["ad-scale","Scale","ad-transform","scale","Scale a body by typed factors (or drag its white handles)"],
      ["ad-align","Align","ad-transform","align","Align (A)"]
    ]],
    ["Decorate", [
      ["ad-texture","Texture","ad-decorate","texture","Surface texture (T)"],
      ["ad-facepat","Pattern on face","ad-decorate","facePattern","Raise or cut a hexagon, diamond plate, screen mesh or other pattern on a flat face"],
      ["ad-emboss","Emboss text","ad-decorate","emboss","Raise or cut text on a flat or curved face"],
      ["ad-appearance","Appearance","ad-decorate","appearance","Colors and materials for bodies or faces (display only)"]
    ]],
    ["Planes", [
      ["ad-plane-off","Offset plane","ad-construct","planeOffset","Offset plane parallel to a plane or face"],
      ["ad-plane-ang","Angled plane","ad-construct","planeAngle","Plane through an axis or edge at an angle"],
      ["ad-plane-mid","Mid plane","ad-construct","planeMid","Plane halfway between two faces"]
    ]],
    ["Insert", [
      ["ad-ins-svg","SVG drawing","ad-insert","svgfile","Insert an SVG drawing as a sketch"],
      ["ad-ins-dxf","DXF drawing","ad-insert","dxffile","Insert a DXF drawing as a sketch"],
      ["ad-ins-img","Import image","ad-insert","image","Insert a picture (PNG, JPG) to trace or emboss"],
      ["ad-ins-model","Import model","ad-insert","import","Insert a 3D model file (STL, 3MF, OBJ, STEP)"],
      ["ad-ins-realpart","Real part from a supplier…","ad-insert","import","Find a supplier part and import its downloaded model"]
    ]],
    ["Parts", [
      ["ad-fasteners","Fasteners","ad-features","thread","Parts library: bolts, screws, nuts, washers, heat-set inserts and pins (metric and inch), with optional modeled threads"],
      ["ad-hinge","Quick Hinge","ad-features","hinge","Ready-made hinges: print-in-place, pin (filament, screw or printed pin) or living hinges, laid on any face"],
      ["ad-gear","Gear","ad-features","gear","Spur gears, bevel gears and racks by module and tooth count"],
      ["ad-gears","Gear library","ad-features","gear","Gear library: involute spur gears, pairs, ring gears, rack and pinion and planetary sets, with joints for a motion study"],
      ["ad-nameplate","Name plate","ad-features","tag","A tag or name plate sized to its text, with raised or cut-in letters"],
      ["ad-knurl","Knurled knob","ad-features","knurl","A knob or grip with straight V grooves all round and an optional round, hex or D bore"],
      ["ad-spring","Spring","ad-features","spring","A compression spring of round wire, with open ends or ends cut flat"]
    ]],
    ["Inspect", [
      ["ad-section","Section Analysis",null,"section","Cut the view with a plane to look inside your design (the design doesn't change)"]
    ]],
    ["Workshop", [
      ["ad-jigs","Jig Maker","ad-workshop","jig","Woodworking jigs: miter box, dowel and pocket-hole jigs, square, angle templates, drill guide, and jigs for dovetails, box joints, mortise and tenon and lap joints, all honeycombed inside to save plastic"],
      ["ad-chipcarve","Chip Carving","ad-workshop","chipcarve","Chip carve a board, plate, log or a shape from your design with knives; pen pressure sets the depth. The result is a mesh body."],
      ["ad-lathe","Lathe","ad-workshop","lathe","Turn a body or a wood blank on a virtual lathe with chisels (Space is the pedal), then hollow it out. The result is a mesh body."],
      ["simple-run-litho","Colour lithophane",null,"image","Turn a photo into a full-colour lithophane"],
      ["exp-laser-svg","Laser cut file",null,"layerscape","Export flat parts as a laser cut file"]
    ]],
    ["Simulate", [
      ["sim-joint","Joint","ws-simulate","joint","Connect two parts so one can turn or slide"],
      ["sim-drive","Drive","ws-simulate","drive","Move a joint by hand"],
      ["sim-motion","Motion study","ws-simulate","motion","Animate joints and check for collisions"],
      ["sim-stress","Stress test","ws-simulate","stress","Load or pressure test: stress, deflection and safety factor"],
      ["sim-print","Print strength","ws-simulate","printer3d","3D-print strength by filament and print orientation"],
      ["sim-render","Render","ws-simulate","render","Make a photo-style picture of your design (PNG)"],
      ["sim-reset","Reset pose","ws-simulate","clearSim","Put moved parts back"],
      ["sim-apply","Apply pose","ws-simulate","move","Keep the moved positions in the design"]
    ]],
    ["Studios", [
      ["sim-meshstep","Mesh to STEP","ws-simulate","import","Mesh to STEP Helper: turn an STL or 3MF mesh into an editable STEP solid, then open it here"],
      ["sim-bricks","Jump Brick Builder","ws-simulate","bricks","Rebuild the selected objects (or all) out of stud-and-tube building bricks you can print, press together and take apart"],
      ["sim-cam","CAM Studio","ws-simulate","cam","Plan and simulate cutting the design on a CNC router, mill or laser, then save or send the G-code (your design is not changed)"],
      ["sim-voxel","Voxel Studio","ws-simulate","voxel","Turn the selected objects (or all) into cubes you can paint face by face, then export STL or 3MF or add them to the design (your design is not changed until you add it)"],
      ["sim-bins","Bin & Box Maker","ws-simulate","box","Make part bins and organiser boxes: open bins, drawers, tilt-out bins and door cabinets, stacked and interlocking, with compartments, scoops, label lips and lids"],
      ["sim-cosforge","CosForge","ws-simulate","cosforge","Design cosplay costumes: a mannequin from your measurements, themed parts to shape, sculpt and fit, then cut into printable pieces with joints (opens in its own window)"],
      ["sim-layerscape","Layerscape","ws-simulate","layerscape","Layerscape: turn a photo into a layered, slot-together diorama: pick the pieces, check the build in 3D, then export laser-cut sheets, printable art or a 3D print kit, or add the finished diorama to your design (opens in its own window)"],
      ["sim-helmet","Helmet Maker","ws-simulate","helmet","Build a contemporary sci-fi helmet sized to the wearer's head: templates, a traced or drawn visor, details, finishes and a rendered picture, then cut it for printing (opens in its own window)"],
      ["sim-flexigen","FlexiGen","ws-simulate","flexigen","Turn one object into a print-in-place articulated flexi model (your design is not changed)"],
      ["sim-neon","Neon Sign Builder","ws-simulate","neon","Neon Sign Builder: glowing text, shapes and traced images as 3D-printed shells for LED strips, with a snap-in backing, cut into pieces for your printer, and a light show"],
      ["sim-sglass","Stained Glass","ws-simulate","stainedglass","Turn an object or a lamp shade into stained glass (a Tiffany-style lamp or a glass statue): glass and frame thickness, painting, STL / 3MF / OBJ export"],
      ["sim-fasteners","Fasteners",null,"thread","Parts library: bolts, screws, nuts, washers, heat-set inserts and pins (metric and inch)"],
      ["sim-hinge","Quick Hinge",null,"hinge","Ready-made hinges: print-in-place, pin or living hinges, without FlexiGen"],
      ["sim-gears","Gear library",null,"gear","Gear library: involute spur gears, pairs, ring gears, rack and pinion and planetary sets, with joints for a motion study"],
      ["sim-chipcarve","Chip Carving",null,"chipcarve","Chip carve a board, plate, log or a shape from your design with chip knives, a stab knife, pencil and sanding block. Pen pressure sets the depth. Add it to the design or export STL, 3MF or OBJ."],
      ["sim-lathe","Lathe",null,"lathe","Turn a body or a wood blank on a virtual lathe"]
    ]],
    ["3D Print Sim", [
      ["ps-r-prepare","Prepare",null,"body","Prepare"],
      ["ps-r-preview","Preview",null,"pattern","Preview"],
      ["ps-r-rx","Rotate X",null,"revolve","Turn 90° about X"],
      ["ps-r-ry","Rotate Y",null,"revolve","Turn 90° about Y"],
      ["ps-r-model","Model",null,"body","Part, overhangs and supports"],
      ["ps-r-layers","Layers",null,"pattern","Layer-by-layer print preview"],
      ["ps-r-strength","Strength",null,"stress","Strong and weak spots of the print"]
    ]],
    ["Sketch", [
      ["sk-arcc","Center arc",null,"more","Center arc"],
      ["sk-polygon","Polygon",null,"more","Polygon"],
      ["sk-spline","Spline",null,"more","Spline"],
      ["sk-point","Point",null,"more","Point"],
      ["sk-text","Text",null,"more","Text"],
      ["sk-cons","Construction",null,"construction","Toggle construction (X)"],
      ["sk-mirror","Mirror",null,"more","Mirror"],
      ["sk-select","Select",null,"more","Select"],
      ["sk-cpin","Pin",null,"more","Pin"],
      ["sk-rect","2-point rectangle","sk-rect-more","rect","Draw a rectangle using two points"],
      ["sk-rect3","3-point rectangle","sk-rect-more","rect3","Draw a rectangle using three points"],
      ["sk-rectc","Center rectangle","sk-rect-more","rectc","Draw a rectangle from its center"],
      ["sk-ins-svg","SVG drawing","sk-insert","svgfile","Insert an SVG drawing into this sketch"],
      ["sk-ins-dxf","DXF drawing","sk-insert","dxffile","Insert a DXF drawing into this sketch"],
      ["sk-ins-img","Image to trace","sk-insert","image","Place a picture on this sketch plane to trace over"]
    ]],
    ["Constraints", [
      ["sk-c-coincident","Coincident","sk-constraints","cCoincident","Coincident"],
      ["sk-c-horizontal","Horizontal","sk-constraints","cHorizontal","Horizontal"],
      ["sk-c-vertical","Vertical","sk-constraints","cVertical","Vertical"],
      ["sk-c-parallel","Parallel","sk-constraints","cParallel","Parallel"],
      ["sk-c-perpendicular","Perpendicular","sk-constraints","cPerpendicular","Perpendicular"],
      ["sk-c-tangent","Tangent","sk-constraints","cTangent","Tangent"],
      ["sk-c-concentric","Concentric","sk-constraints","cConcentric","Concentric"],
      ["sk-c-equal","Equal","sk-constraints","cEqual","Equal"],
      ["sk-c-midpoint","Midpoint","sk-constraints","cMidpoint","Midpoint"],
      ["sk-c-fixed","Fixed","sk-constraints","lock","Fixed"]
    ]]
  ];
  const back = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg>';
  function button(id, label, icon, via) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.for = id; if (via) b.dataset.via = via;
    if (!ICON[icon] && icon !== 'back') b.dataset.iconFallback = 'true';
    b.innerHTML = (icon === 'back' ? back : ICON[icon] || ICON.select) + '<span></span>'; b.querySelector('span').textContent = label; return b;
  }
  for (const [set, items] of Object.entries(sets)) for (const [id,label,icon,phone,via] of items) {
    const b = button(id,label,icon,via); b.id = 'sar-' + id; b.dataset.set = set; if (phone) b.dataset.phone = 'true'; if (set === 'sketch' && ({'sk-rect':'Rect','sk-dim':'Dim','sk-constraints':'Constr.'})[id]) { b.dataset.shortLabel = ({'sk-rect':'Rect','sk-dim':'Dim','sk-constraints':'Constr.'})[id]; b.setAttribute('aria-label', label); } sar.append(b);
  }
  // Design appears in two sets but must have a unique id.
  sar.querySelectorAll('#sar-ws-design')[1].removeAttribute('id');
  const ai = more.querySelector('.simple-ai');
  function section(name, cls = '') { const s = document.createElement('section'); s.className = 'sadv-group ' + cls; const h = document.createElement('h3'); h.textContent = name; const grid = document.createElement('div'); grid.className = 'simple-grid'; s.append(h,grid); ai.before(s); return s; }
  for (const [name, items] of groups) { const s = section(name, ['Sketch','Constraints'].includes(name) ? '' : 'sadv-advanced-only'); s.dataset.group = name; for (const [id,label,via,icon,title] of items) { const b = button(id,label,icon,via); b.title = title; s.lastChild.append(b); } }
  const onrail = section('Main tools','simple-arrange sadv-onrail'); more.insertBefore(onrail, more.querySelector('section'));
  for (const [set,items] of Object.entries(sets)) for (const [id,label,icon,phone,via] of items) { const b = button(id,label,icon,via); b.dataset.set = set; if (phone) b.dataset.phone = 'true'; onrail.lastChild.append(b); }
  const aliases = section('Aliases','sadv-alias');
  for (const [id,via] of [['ad-hole-m','ad-features'],['ad-fastbtn'],['ad-ins-fast','ad-insert'],['ad-ins-hinge','ad-insert'],['ad-ins-gear','ad-insert'],['ps-r-litho']]) aliases.lastChild.append(button(id,id,'more',via));
  const other = section('Other','sadv-other');
  const titles = Object.fromEntries(groups.flatMap(([, items]) => items.map(([id,, , , title]) => [id, title]))); Object.assign(titles, {'ws-design':'Design: sketch, extrude, pattern and measure','ws-print':'3D Print Sim: orient, arrange, slice and G-code','ws-simulate':'Simulate: joint, motion, stress and voxel', 'ad-edge':'Round (fillet) or bevel (chamfer) edges; switch between them in More › Modify', 'ad-shell':'Shell: hollow out a body, leaving walls', 'ad-prims':'Primitives: shapes box cylinder'});
  let previousSet = '', menuFromRail = null, ignoreClick = false, lastRailFocus = null, restoreSketchFocus = false;
  rail.addEventListener('focusin', e => { lastRailFocus = e.target.closest('button'); });
  document.addEventListener('focusin', e => { if (!rail.contains(e.target)) lastRailFocus = null; });
  document.addEventListener('pointerdown', e => { if (!rail.contains(e.target)) lastRailFocus = null; }, true);
  const proxyFor = plate.proxyFor;
  const canonical = {'ad-hole-m':'ad-hole', 'ad-fastbtn':'ad-fasteners', 'ad-ins-fast':'ad-fasteners', 'ad-ins-hinge':'ad-hinge', 'ad-ins-gear':'ad-gears', 'ps-r-litho':'simple-run-litho'};
  plate.proxyFor = id => proxyFor(canonical[id] || id);
  rail.addEventListener('keydown', e => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) || !e.target.closest('button')) return;
    e.preventDefault(); e.stopPropagation();
    const buttons = [...rail.querySelectorAll('button')].filter(b => !b.disabled && b.getClientRects().length);
    const step = ['ArrowRight','ArrowDown'].includes(e.key) ? 1 : -1;
    buttons[(buttons.indexOf(e.target.closest('button')) + step + buttons.length) % buttons.length]?.focus();
  });
  more.addEventListener('keydown', e => {
    if (e.target.id !== 'simple-find' || e.key !== 'Enter' || !active()) return;
    const q = e.target.value.trim().toLowerCase();
    const buttons = [...more.querySelectorAll('button[data-for]')].filter(b => !b.disabled && b.getClientRects().length);
    const label = b => b.textContent.trim().toLowerCase();
    const best = buttons.find(b => label(b) === q) || buttons.find(b => label(b).startsWith(q)) || buttons.find(b => label(b).includes(q)) || buttons.find(b => b.title.toLowerCase().includes(q));
    if (best) { e.preventDefault(); e.stopPropagation(); best.click(); }
  }, true);
  more.addEventListener('click', e => {
    const b = e.target.closest('button[data-for="sk-rect"][data-via="sk-rect-more"]');
    if (!b) return;
    e.stopPropagation(); $('sr-more').click(); $('sk-rect-more')?.click();
    document.querySelector('#ribbon-menu #sk-rect')?.click();
  }, true);
  window.addEventListener('pointerdown', e => { if (root.dataset.face === 'simple' && e.target.closest?.('#sar button') === menuFromRail && menuFromRail && $('ribbon-menu')) { ignoreClick = true; e.stopPropagation(); } }, true);
  sar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (root.dataset.face === 'simple' && app.mode === 'beginner' && app.sketcher?.active && ['sk-finish','sk-extrude'].includes(b.dataset.for)) {
      restoreSketchFocus = true;
      queueMicrotask(() => { restoreSketchFocus = false; });
    }
    if (app.sketcher?.active && b.getAttribute('aria-pressed') === 'true' && !$(b.dataset.for)?.hasAttribute('aria-haspopup') && b.dataset.for !== 'sk-finish') { e.stopImmediatePropagation(); app.sketcher.setTool('select'); app.refreshUI(); return; }
    if (!$(b.dataset.for)?.hasAttribute('aria-haspopup')) return;
    if (ignoreClick) { ignoreClick = false; e.stopImmediatePropagation(); menuFromRail = null; document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); b.focus(); return; }
    // The delegated handler opens and places the original menu after this listener.
    const observer = new MutationObserver(() => {
      const menu = $('ribbon-menu'); if (!menu) return;
      observer.disconnect(); menuFromRail = b;
      const r = b.getBoundingClientRect();
      if (matchMedia('(max-width: 640px)').matches) { menu.style.left = '0px'; menu.style.width = '100%'; menu.style.top = Math.max(0, rail.getBoundingClientRect().top - menu.offsetHeight) + 'px'; }
      else { menu.style.left = Math.max(0, Math.min(r.right + 6, innerWidth - menu.offsetWidth)) + 'px'; menu.style.top = Math.max(0, Math.min(r.top, innerHeight - menu.offsetHeight)) + 'px'; }
    });
    observer.observe(document.body, {childList:true});
    requestAnimationFrame(() => observer.disconnect());
  });
  window.addEventListener('keydown', e => { if (root.dataset.face !== 'simple' || e.key !== 'Escape' || !menuFromRail || !$('ribbon-menu')) return; e.preventDefault(); e.stopImmediatePropagation(); const target = menuFromRail; menuFromRail = null; document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); target.focus(); }, true);
  function updateRail() {
    if (root.dataset.face !== 'simple') return;
    const set = app.sketcher?.active ? 'sketch' : app.mode === 'advanced' ? app.advanced.workspace : '';
    const focused = rail.contains(document.activeElement) || (document.activeElement === document.body && lastRailFocus && !lastRailFocus.getClientRects().length); rail.dataset.set = set; rail.setAttribute('aria-label', ({design:'Design tools', sketch:'Sketch tools', print:'3D Print Sim tools', simulate:'Simulate tools'})[set] || 'Simple tools');
    for (const b of sar.querySelectorAll('button')) b.hidden = b.dataset.set !== set;
    if (focused && previousSet !== set) requestAnimationFrame(() => { if (document.querySelector('.modal-back') || (document.activeElement !== document.body && !rail.contains(document.activeElement))) return; if (app.mode === 'beginner') plate.sync(); [...rail.querySelectorAll('button:not([hidden]):not(:disabled)')].find(b => b.getClientRects().length)?.focus(); }); previousSet = set;
    const note = $('sap-note'), noteText = $('sk-note')?.textContent || ''; note.hidden = set !== 'sketch'; if (note.textContent !== noteText) note.textContent = noteText;
    for (const b of [...sar.querySelectorAll('button'), ...more.querySelectorAll('.sadv-group button')]) {
      const original = $(b.dataset.for); if (original) {
        if (b.dataset.iconFallback && original.querySelector('svg')) { b.querySelector('svg')?.remove(); b.prepend(original.querySelector('svg').cloneNode(true)); }
        b.disabled = original.disabled; const pressed = b.dataset.for === 'ws-design' && b.closest('#sar') ? null : original.getAttribute('aria-pressed') ?? original.getAttribute('aria-selected'); if (pressed !== null) b.setAttribute('aria-pressed', pressed); else b.removeAttribute('aria-pressed');
        if (original.hasAttribute('aria-haspopup')) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', original.getAttribute('aria-expanded') || 'false'); } else { b.removeAttribute('aria-haspopup'); b.removeAttribute('aria-expanded'); }
        if (!titles[b.dataset.for]) b.title = original.title || original.textContent.trim();
        if (['ad-edge','sk-rect'].includes(b.dataset.for)) { const svg = original.querySelector('svg'), old = b.querySelector('svg'); if (svg && old) old.replaceWith(svg.cloneNode(true)); }
        if (['ad-edge','sk-cpin'].includes(b.dataset.for)) b.querySelector('span').textContent = original.querySelector('span')?.textContent.trim() || original.textContent.trim();
      } else b.disabled = false;
      if (titles[b.dataset.for]) b.title = titles[b.dataset.for]; if (b.dataset.for === 'ws-design' && b.closest('#sar')) b.title = 'Back to Design';
    }
    if (app.mode !== 'advanced') other.lastChild.replaceChildren();
    if (app.mode === 'advanced') for (const original of document.querySelectorAll('#ribbon button[id]')) {
      if (original.hasAttribute('aria-haspopup') || more.querySelector(`[data-for="${original.id}"]`) || sar.querySelector(`[data-for="${original.id}"]`)) continue;
      const b = button(original.id, original.getAttribute('aria-label') || original.textContent.trim()); b.title = original.title; other.lastChild.append(b);
    }
  }
  new MutationObserver(updateRail).observe($('ribbon'), {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['aria-pressed','disabled','aria-selected','aria-expanded']});

  let timelineCount = timeline.querySelectorAll('.tl-item').length;
  new MutationObserver(() => {
    const count = timeline.querySelectorAll('.tl-item').length, slot = $('sap-timeline-slot');
    if (count > timelineCount && timeline.parentNode === slot && !timeline.querySelector('.tl-now') && matchMedia('(min-width: 641px)').matches) slot.scrollTop = slot.scrollHeight;
    timelineCount = count; update();
  }).observe(timeline, { childList: true });
  const refresh = app.refreshUI; app.refreshUI = function (...args) {
    const result = refresh.apply(this, args); update();
    if (restoreSketchFocus && !app.sketcher?.active) {
      restoreSketchFocus = false;
      const focus = document.activeElement;
      if (root.dataset.face === 'simple' && app.mode === 'beginner' && !document.querySelector('.modal-back') && !focus?.closest?.('#cmd, input, textarea, select, [contenteditable]:not([contenteditable="false"])') && (!focus || focus === document.body || !focus.getClientRects().length)) {
        [...rail.querySelectorAll('button:not([hidden]):not(:disabled)')].find(b => b.getClientRects().length)?.focus();
      }
    }
    return result;
  };
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
#sap-note { padding: 8px 12px; font: 13px/1.35 var(--f-ui); color: var(--ink-2); background: var(--panel-2); border-bottom: 1px solid var(--line); }
html[data-face="simple"] .simple-panel button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
html[data-face="simple"] #simple-rail[data-set="sketch"] ~ #simple-more [data-group="Workshop"] { display: none; }
html[data-face="simple"] #app[data-mode="advanced"] .work { --sap-rail-w: 80px; --sap-panel-w: 280px; grid-template-columns: var(--sap-rail-w) minmax(0, 1fr) var(--sap-panel-w); }
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
 html[data-face="simple"] #app[data-mode="advanced"] #simple-adv-panel:not(.expanded) > :not(#sap-sheet) { display: none; }
 html[data-face="simple"]:not([data-simple-hide~="panel"]) #app[data-mode="advanced"] #simple-collapse-panel { display: none; }
}
html[data-face="simple"] #app[data-mode="advanced"] { grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr) auto; }
html[data-face="simple"] #app[data-mode="advanced"] > .topbar { grid-column: 1; grid-row: 1; }
html[data-face="simple"] #app[data-mode="advanced"] > .work { grid-column: 1; grid-row: 2; }
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
html[data-face="simple"] #app[data-mode="advanced"] #simple-more section:not(.sadv-group):has(.simple-grid [data-for="simple-run-rib"]) { display:none; }
html[data-face="simple"] #app[data-mode="beginner"] #simple-more .sadv-advanced-only { display:none !important; }
html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="advanced"] #simple-rail { display:none; }
html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="advanced"] .work { --sap-rail-w: 0px; }
@media (max-width:640px) {
 html[data-face="simple"] #app[data-mode="advanced"] .work, html[data-face="simple"][data-simple-hide~="rail"] #app[data-mode="advanced"] .work, html[data-face="simple"][data-simple-hide~="panel"] #app[data-mode="advanced"] .work, html[data-face="simple"] body.ps-orca #app[data-mode="advanced"] .work { --sap-rail-w:0px; grid-template-rows:minmax(0,1fr) auto 58px; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-rail { grid-column:1 / -1; grid-row:3; width:100%; flex-direction:row; overflow:hidden; border-right:0; border-top:1px solid var(--line); }
 html[data-face="simple"] #simple-rail[data-set] #sar button:not([data-phone]) { display:none; }
 html[data-face="simple"] #simple-more .sadv-onrail button[data-phone] { display:none; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-more:not([hidden]) { left:0; right:0; top:auto; bottom:58px; width:100%; max-height:min(70vh,calc(100% - 58px)); border-radius:10px 10px 0 0; }
 html[data-face="simple"] #app[data-mode="advanced"] #simple-collapse-rail { display:none; }
 html[data-face="simple"] #app[data-mode="advanced"] .work:not(:has(#simple-adv-panel.expanded)) #viewport > .simple-collapse { bottom:44px; }
 html[data-face="simple"] #app[data-mode="advanced"] .work:has(#simple-adv-panel.expanded) #viewport > .simple-collapse { bottom:50%; }
 html[data-face="simple"] #simple-rail #sar button[data-short-label] span { font-size:0; }
 html[data-face="simple"] #simple-rail #sar button[data-short-label]::after { content:attr(data-short-label); font-size:10px; }
 html[data-face="simple"] #app[data-mode="advanced"] .work:has(#simple-adv-panel.expanded) #simple-rail { display:flex; }
}
`; document.head.append(style);
  update();
}
