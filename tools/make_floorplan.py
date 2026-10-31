import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
TP = _os.environ.get('THIRD_PARTY') or _os.path.join(ROOT, '..', 'third_party')
# Builds src/floorplan.html from the Blueprint Floorplanner source: it runs inside JumpStart 3D's
# Architect mode as the "Floor Planner", in its own window over the app.
src = open(ROOT + '/tools/floorplanner-source.html', encoding='utf-8').read()
s = src
def R(a, b, count=1):
    global s
    assert a in s, a[:100]
    s = s.replace(a, b, count)
# its own copy of three.js r128 (the version it was made with), so it works with no network
three = open(_os.path.join(TP, 'three-r128', 'three.min.js'), encoding='utf-8').read().replace('</script', '<\\/script')
R('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', '<script>' + three + '</script>')
R("$('#p3m').textContent='The 3D engine could not load (internet connection needed).'", "$('#p3m').textContent='The 3D engine could not start in this browser.'")
# the classroom payment check is play money: no real bank details on it
R("T('Member FDIC \\u00b7 1 Architects Plaza',w/2,80,'13px Georgia','#2a4a6a','center');", "T('Classroom play money \\u00b7 not a real bank',w/2,80,'13px Georgia','#2a4a6a','center');")
R("T(':071000013:   4829\\u20111174   '+String(no).padStart(4,'0'),28,424,'20px ui-monospace,monospace','#222')}",
  "T('SAMPLE \\u00b7 PLAY MONEY \\u00b7 NOT NEGOTIABLE   No. '+String(no).padStart(4,'0'),28,424,'18px ui-monospace,monospace','#8a1c1c');q.save();q.translate(w/2,h/2);q.rotate(-.18);q.font='bold 86px Georgia';q.fillStyle='rgba(138,28,28,.10)';q.textAlign='center';q.fillText('PLAY MONEY',0,30);q.restore()}")
# JumpStart 3D bridge: saving through the app, a close button, and the state the tutorials check
bridge = r'''<script>
/* ===== JumpStart 3D bridge ===== */
(function(){const P=(()=>{try{return window.parent!==window?window.parent:null}catch(e){return null}})();
const FPB=window.__fpb={dl:[],r3:0,views:new Set(),shots:0};
const _dl=dlBlob;dlBlob=function(b,name){FPB.dl.push(name);
if(P&&P.__JS3D_SAVE__){b.arrayBuffer().then(buf=>P.__JS3D_SAVE__(name,new Uint8Array(buf)));return}return _dl(b,name)};
const _r3=render3;render3=function(){FPB.r3++;const v=document.querySelector('#vw');FPB.views.add(v?v.value:'in');return _r3.apply(this,arguments)};
{const sb=document.querySelector('#shot');if(sb){const o=sb.onclick;sb.onclick=function(e){FPB.shots++;render3();const c=document.querySelector('#c3');c.toBlob(b=>dlBlob(b,'floorplan-3d.png'),'image/png')}}}
const st=document.createElement('style');st.textContent='.tut-spot{outline:3px solid #e8a317!important;outline-offset:2px;animation:tutSpotFP 1s ease-in-out infinite;position:relative;z-index:5}@keyframes tutSpotFP{50%{outline-color:#ffd24a;outline-offset:5px}}#js3d-close{margin-left:auto;border-color:#ffd24a;color:#ffd24a;font-weight:700}';document.head.appendChild(st);
if(P&&P.__JS3D_FP_CLOSE__){const h=document.querySelector('header');const g=document.createElement('div');g.className='g';g.style.marginLeft='auto';
g.innerHTML=(P.__JS3D_FP_TAB__?'<button class="b" id="js3d-tab" title="Open the Floor Planner in its own browser tab">Open in a new tab ↗</button>':'')+'<button class="b" id="js3d-close" title="Close the Floor Planner and go back to Architect. Your plan stays here until you close JumpStart 3D.">✕ Back to Architect</button>';h.appendChild(g);
g.querySelector('#js3d-close').onclick=()=>P.__JS3D_FP_CLOSE__();const tb=g.querySelector('#js3d-tab');if(tb)tb.onclick=()=>P.__JS3D_FP_TAB__()}
const isR=r=>typeof isRect==='function'&&isRect(r);
const dimsOf=r=>{if(!isR(r))return null;const xs=r.v.map(p=>p.x),ys=r.v.map(p=>p.y);return[Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)]};
window.__fp={
 state(){let levels=[0];try{syncLv();levels=lvs()}catch(e){}
  const all=[];try{for(const n of levels)for(const r of FLR[n].rooms)all.push({n,r})}catch(e){rooms.forEach(r=>all.push({n:0,r}))}
  const itemsAll=[];try{for(const n of levels)for(const t of FLR[n].items)itemsAll.push({n,t})}catch(e){items.forEach(t=>itemsAll.push({n:0,t}))}
  return{mode,tool,armed:!!(armI||armF||armW),curL:typeof curL==='number'?curL:0,levels,
   rooms:all.map(({n,r})=>({lvl:n,id:r.id,name:r.name,type:typeof typeOf==='function'?typeOf(r):'',area:area(r),rect:isR(r),dims:dimsOf(r),edges:r.v.length,arcs:r.c.filter(Boolean).length,floor:r.floor?{t:r.floor.t,n:r.floor.n}:null,wall:r.wall?{...r.wall}:null,ext:!!(r.out||(r.ew&&Object.values(r.ew).some(e=>e.out))),extK:[r.out,...Object.values(r.ew||{}).map(e=>e.out)].filter(Boolean).map(x=>x.k),inEw:!!(r.ew&&Object.values(r.ew).some(e=>e.in))})),
   items:itemsAll.map(({n,t})=>({lvl:n,k:t.k,n:t.n,sh:t.sh,r:t.r||0,on:!!t.on,col:t.col||null,txt:t.txt||null,dir:t.dir||null,fy:!!t.fy,fx:!!t.fx,w:t.w,h:t.h})),
   total:all.reduce((s,x)=>s+area(x.r),0),roof:{...ROOF},cam:!!cam,pop:!pop.hidden,r3:FPB.r3,views:[...FPB.views],shots:FPB.shots,dl:FPB.dl.slice(),
   calc:typeof calc!=='undefined'&&!calc.hidden,saved:!!FPB.saved,edu:!!EDU,job:JOB?{kind:JOB.kind,ex:!!JOB.c.ex}:null,done:{...DONE},stu:!!STU,ex:EX?{kind:EX.kind,i:EX.i}:null,plot:!!S.plot,lim:!!S.lim,step:typeof step==='number'?step:0,snap:S.snap,cat:typeof cat==='string'?cat:''}},
 el(sel){for(const q of sel.split(',').map(x=>x.trim())){const e=document.querySelector(q);if(e&&e.getClientRects().length)return e}return null},
 mode(n){setMode(n)}};
if(P&&P.__JS3D_FP_READY__)P.__JS3D_FP_READY__();})();
</script>
'''
# the step-by-step tutorials (fp_tutorials.js) and quick save / My plans / autosave (fp_addons.js)
tuts = open(ROOT + '/tools/fp_tutorials.js', encoding='utf-8').read().replace('export const FP_TUTORIALS', 'const FP_TUTORIALS')
tuts = 'const FP_TUTORIALS = (() => {\n' + tuts + '\nreturn FP_TUTORIALS;\n})();'
addons = open(ROOT + '/tools/fp_addons.js', encoding='utf-8').read()
for part in (tuts, addons): assert '</script' not in part.lower()
R('</body></html>', bridge + '<script>\n' + tuts + '\n</script>\n<script>\n' + addons + '\n</script>\n</body></html>')
out = s
assert '071000013' not in out and 'Member FDIC' not in out
open(ROOT + '/src/floorplan.html', 'w', encoding='utf-8').write(out)
print('floorplan.html', len(out))
