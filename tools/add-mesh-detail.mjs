// Adds our Mesh detail setting (Normal / Fine / Extra fine, plus a custom
// level slider with a triangle-count box) to a freshly extracted src/ tree.
// Run after tools/extract.mjs; running it twice is refused.
//
//   node tools/add-mesh-detail.mjs
//
// The geometry worker already accepts a `quality` number on each build
// request (it divides the tessellation tolerances by it) but upstream never
// sends one. This patch sends it, folds it into the mesh cache key so a
// change re-meshes every body, and adds the menu, the saved preference,
// a warning dialog above 500,000 estimated triangles, and a line in the
// About dialog. Triangle counts on curved faces grow with the square of the
// level, which is what the estimate uses.

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../src/", import.meta.url).pathname;
let app = readFileSync(root + "app.js", "utf8");
let shell = readFileSync(root + "index.html", "utf8");
if (app.includes("Ae.setMeshDetail=")) throw new Error("Mesh detail is already applied");

const patch = (text, from, to, label) => {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, found ${n}`);
  return text.replace(from, () => to);
};

// Worker queue: send the quality with every build and give finer builds a longer watchdog.
app = patch(
  app,
  `this.worker.postMessage({type:"build",req:t,bodies:e.map(r=>({id:r.id,rev:r.key,node:r.node}))})`,
  `this.worker.postMessage({type:"build",req:t,quality:this.quality||1,bodies:e.map(r=>({id:r.id,rev:r.key,node:r.node}))})`,
  "build message"
);
app = patch(
  app,
  `this.watchdog=setTimeout(()=>this.stalled(e),n?12e4:25e3)`,
  `this.watchdog=setTimeout(()=>this.stalled(e),(n?12e4:25e3)*(this.quality||1))`,
  "build watchdog"
);

// Scene sync: the cache key includes the quality, so changing it requests new meshes
// and switching back finds the old ones still cached.
app = patch(
  app,
  `s=Ms(r.node,e),a=hl(s)}catch{this.errors.set(r.id,"Couldn't read this body's sketch");continue}`,
  `s=Ms(r.node,e),a=hl(s)+(this.kernel.quality>1?"@q"+this.kernel.quality:"")}catch{this.errors.set(r.id,"Couldn't read this body's sketch");continue}`,
  "mesh cache key"
);

// Theme menu: preset clicks, and refresh the triangle counts whenever the menu opens.
app = patch(
  app,
  `p=d?.dataset.perf;u?(Ae.setTheme(u),o.hidden=!0):p&&(Ae.setPerf(p),o.hidden=!0)`,
  `p=d?.dataset.perf,jsDetail=d?.dataset.detail;u?(Ae.setTheme(u),o.hidden=!0):jsDetail?(Ae.setMeshDetail(jsDetail),o.hidden=!0):p&&(Ae.setPerf(p),o.hidden=!0)`,
  "menu click handler"
);
app = patch(
  app,
  `Xt("btn-theme").onclick=()=>{o.hidden=!o.hidden}`,
  `Xt("btn-theme").onclick=()=>{o.hidden=!o.hidden,o.hidden||Ae.syncMeshDetailUI&&Ae.syncMeshDetailUI()}`,
  "menu open refresh"
);

// Startup: restore the saved level before the first document is built, then wire the slider.
app = patch(
  app,
  `Ae.setPerf(e,!0),Ae.vp.onSlow=cP`,
  `Ae.setPerf(e,!0),Ae.setMeshDetail(null,!0),jsMeshWire(),Ae.vp.onSlow=cP`,
  "startup restore"
);

// The setting itself, defined next to Ae.setPerf. Readable here; whitespace is harmless in the bundle.
const setter = `
var jsMeshDetail={normal:{q:1,label:"Normal"},fine:{q:2,label:"Fine"},extra:{q:4,label:"Extra fine"}},jsMeshMax=32,jsMeshWarn=5e5,jsMeshTimer=0,jsMeshDialog=null,jsMeshApply=0;
function jsMeshQ(i){if(jsMeshDetail[i])return jsMeshDetail[i].q;let m=/^custom:([\\d.]+)$/.exec(i||"");return m?Math.min(jsMeshMax,Math.max(1,Math.round((+m[1]||1)*2)/2)):1}
function jsMeshNow(){return Ae.kernel&&Ae.kernel.quality||1}
function jsMeshTris(){let n=0;if(Ae.scene&&Ae.scene.doc)for(let b of Ae.scene.doc.bodies){let v=Ae.scene.views.get(b.id);v&&v.data&&(n+=v.data.triangles.length/3)}return n}
function jsMeshEstimate(q){return Math.round(jsMeshTris()*(q/jsMeshNow())**2)}
function jsMeshLabel(i){return jsMeshDetail[i]?jsMeshDetail[i].label:"Custom "+jsMeshQ(i)+"\\u00D7"}
function jsMeshWarnDialog(est,q,go){jsMeshDialog&&jsMeshDialog.remove();let back=jsMeshDialog=E("div",{class:"modal-back"}),close=()=>{back.remove(),jsMeshDialog===back&&(jsMeshDialog=null),Ae.syncMeshDetailUI&&Ae.syncMeshDetailUI()},
m=E("div",{class:"modal chisel-intro",role:"alertdialog","aria-modal":"true"},
E("header",{},E("h2",{},"That's a lot of triangles")),
E("div",{class:"mbody"},E("p",{class:"ci-lead"},"About "+est.toLocaleString()+" triangles at "+q+"\\u00D7."),
E("p",{},"Building could take several minutes, the view may get slow, and STL, OBJ and 3MF exports will be large. Your design itself is not changed, and you can pick a lower level at any time."),
E("div",{class:"ci-acts",style:{gap:"8px"}},E("button",{class:"btn",onclick:close},"Keep the current level"),E("button",{class:"btn primary",onclick:()=>{close(),go()}},"Build it anyway"))));
back.append(m),back.addEventListener("click",ev=>{ev.target===back&&close()}),document.body.append(back)}
function jsMeshReport(label){clearInterval(jsMeshTimer);let t0=Date.now();jsMeshTimer=setInterval(()=>{if(!Ae.scene||Ae.scene.busy()&&Date.now()-t0<jsMeshMax*3e4)return;clearInterval(jsMeshTimer);let n=jsMeshTris();n&&Ae.toast(label+": "+n.toLocaleString()+" triangles in this design."),Ae.syncMeshDetailUI&&Ae.syncMeshDetailUI()},500)}
Ae.setMeshDetail=function(i,e,force){if(!i)try{i=localStorage.getItem("jumpstart.meshdetail")}catch{}
jsMeshDetail[i]||/^custom:/.test(i||"")||(i="normal");let q=jsMeshQ(i);jsMeshDetail[i]||(i="custom:"+q);
if(!e&&!force){let est=jsMeshEstimate(q);if(est>jsMeshWarn&&q>jsMeshNow()){jsMeshWarnDialog(est,q,()=>Ae.setMeshDetail(i,e,!0));return}}
Ae.meshDetail=i;let n=Ae.kernel,label=jsMeshLabel(i);
n&&(n.quality||1)!==q&&(n.quality=q,Ae.scene&&Ae.scene.doc&&(Ae.scene.sync(Ae.scene.doc),e||jsMeshReport(label))),Ae.syncMeshDetailUI&&Ae.syncMeshDetailUI();
if(!e){try{localStorage.setItem("jumpstart.meshdetail",i)}catch{}
Ae.toast(label+" mesh detail: "+(i==="normal"?"the quickest to build.":i==="fine"?"smoother curves in the view and in STL, OBJ and 3MF exports.":i==="extra"?"the smoothest preset; big or detailed designs take longer to build.":"building\\u2026 the finished triangle count will show when it's done."))}};
function jsMeshWire(){let r=document.getElementById("detail-range"),t=document.getElementById("detail-tris"),lv=document.getElementById("detail-level"),es=document.getElementById("detail-est");if(!r||!t)return;
let show=q=>{lv.textContent=q+"\\u00D7";let a=jsMeshTris();t.value=a?jsMeshEstimate(q):"",t.disabled=!a,es.textContent=a?Ae.scene.busy()?"building\\u2026":q===jsMeshNow()?"now":"estimate":"add a shape first"};
r.oninput=()=>show(+r.value),r.onchange=()=>{clearTimeout(jsMeshApply),jsMeshApply=setTimeout(()=>Ae.setMeshDetail("custom:"+ +r.value),400)};
t.onchange=()=>{let a=jsMeshTris(),n=+t.value;if(!a||!(n>0))return show(+r.value);let q=Math.min(jsMeshMax,Math.max(1,Math.round(jsMeshNow()*Math.sqrt(n/a)*2)/2));r.value=q,Ae.setMeshDetail("custom:"+q)};
Ae.syncMeshDetailUI=()=>{let i=Ae.meshDetail||"normal",q=jsMeshQ(i);document.querySelectorAll("#menu-theme button[data-detail]").forEach(n=>n.setAttribute("aria-checked",n.dataset.detail===i)),r.value=q,show(q)};
Ae.syncMeshDetailUI()}
`;
app = patch(app, `Ae.setPerf=function(i,e){`, setter + `Ae.setPerf=function(i,e){`, "setter definition");

// About dialog.
app = patch(
  app,
  `Auto picks a mode for the computer and steps down if things get slow."]`,
  `Auto picks a mode for the computer and steps down if things get slow."],["Mesh detail:","Normal, Fine, Extra fine or a custom level up to 32\\u00D7 in the theme menu (\\u25D0): how finely curved surfaces are divided into triangles, in the view and in STL, OBJ and 3MF exports. STEP is exact at every level. The menu shows the triangle count of your design and estimates it for other levels; above 500,000 it asks first, because building can take minutes."]`,
  "about dialog"
);

// Menu markup and styling.
shell = patch(shell, `title="Theme and performance"`, `title="Theme, performance and mesh detail"`, "theme button title");
shell = patch(
  shell,
  `        <div class="menu-note">Every tool works the same in every mode; only how the view is drawn changes.</div>\n`,
  `        <div class="menu-note">Every tool works the same in every mode; only how the view is drawn changes.</div>\n` +
    `        <hr>\n` +
    `        <div class="menu-head">Mesh detail</div>\n` +
    `        <button data-detail="normal" role="menuitemradio" title="The quickest to build">Normal <small>1× · quickest</small></button>\n` +
    `        <button data-detail="fine" role="menuitemradio" title="Smoother curves in the view and in STL, OBJ and 3MF exports">Fine <small>2× · smoother curves</small></button>\n` +
    `        <button data-detail="extra" role="menuitemradio" title="The smoothest preset; big or detailed designs take longer to build">Extra fine <small>4× · slower to build</small></button>\n` +
    `        <div class="menu-custom">\n` +
    `          <label class="mc-row" title="Drag for finer triangles; let go to build"><span>Custom</span><input type="range" id="detail-range" min="1" max="32" step="0.5" value="1"><b id="detail-level">1×</b></label>\n` +
    `          <label class="mc-row" title="Type the triangle count you want for the whole design and press Enter"><span>Triangles</span><input type="number" id="detail-tris" min="1" step="1" inputmode="numeric"><small id="detail-est"></small></label>\n` +
    `        </div>\n` +
    `        <div class="menu-note">Applies to the view and to STL, OBJ and 3MF exports. STEP is exact at every level. Above 500,000 triangles you are asked first; very fine levels can take many minutes to build.</div>\n`,
  "menu markup"
);
shell = patch(
  shell,
  `.menu hr { border: 0; border-top: 1px solid var(--line-2); margin: 4px 2px; }\n`,
  `.menu hr { border: 0; border-top: 1px solid var(--line-2); margin: 4px 2px; }\n` +
    `.menu .menu-custom { display: grid; gap: 6px; padding: 4px 10px 6px; }\n` +
    `.menu .mc-row { display: grid; grid-template-columns: 58px 1fr 54px; gap: 8px; align-items: center; font-size: 12.5px; color: var(--ink-2); }\n` +
    `.menu .mc-row b { font-size: 12px; text-align: right; color: var(--ink); }\n` +
    `.menu .mc-row small { margin: 0; text-align: right; }\n` +
    `.menu .mc-row input[type=number] { width: 100%; min-width: 0; font: inherit; font-size: 12.5px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); color: var(--ink); }\n` +
    `.menu .mc-row input[type=number]:disabled { opacity: .5; }\n`,
  "menu CSS"
);

writeFileSync(root + "app.js", app);
writeFileSync(root + "index.html", shell);
console.log("Mesh detail setting added");
