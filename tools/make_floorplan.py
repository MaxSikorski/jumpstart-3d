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
# more: a third floor, floor openings, L/U/spiral stairs and steps, railings, porches, arched doors
R("const elevOf=n=>n>=1?hOf(0)+SLAB:n<0?-(hOf(-1)+SLAB):0", "const elevOf=n=>{if(n<0)return-(hOf(-1)+SLAB);let e=0;for(let i=0;i<n;i++)e+=hOf(i)+SLAB;return e}")
R("const dirOf=(t,n)=>t.dir||(n>0?'down':n<0?'up':STD);", "const dirOf=(t,n)=>t.dir||(n>0?(FLR[n+1]?'up':'down'):n<0?'up':STD);")
R("const floorHoles=m=>allStairs().filter(s=>(s.dir==='up'&&FLR[s.n+1]&&s.n+1===m)||(s.dir==='down'&&FLR[s.n-1]&&s.n===m)).map(s=>s.t);",
  "const floorHoles=m=>allStairs().filter(s=>(s.dir==='up'&&FLR[s.n+1]&&s.n+1===m)||(s.dir==='down'&&FLR[s.n-1]&&s.n===m)).map(s=>s.t).concat(window.__fpHolesOn?window.__fpHolesOn(m):[]);")
R("const ceilHoles=m=>allStairs().filter(s=>(s.dir==='up'&&FLR[s.n+1]&&s.n===m)||(s.dir==='down'&&FLR[s.n-1]&&s.n-1===m)).map(s=>s.t);",
  "const ceilHoles=m=>allStairs().filter(s=>(s.dir==='up'&&FLR[s.n+1]&&s.n===m)||(s.dir==='down'&&FLR[s.n-1]&&s.n-1===m)).map(s=>s.t).concat(window.__fpHolesOn?window.__fpHolesOn(m+1):[]);")
R("""${FLR[1]?'':'<button class="b" data-addlv="1" style="width:100%;margin:6px 0 2px">＋ Add second floor</button>'}""",
  """${FLR[1]?(FLR[2]?'':'<button class="b" data-addlv="2" style="width:100%;margin:6px 0 2px">＋ Add third floor</button>'):'<button class="b" data-addlv="1" style="width:100%;margin:6px 0 2px">＋ Add second floor</button>'}""")
R("if(h.y1<WHT)pc(h.s0,h.s1,h.y1,WHT);", "if(h.arch){const r=(h.s1-h.s0)/2,ys=h.y1-r,N=16,f=u=>ys+Math.sqrt(Math.max(0,r*r-(u-h.s0-r)**2));for(let j=0;j<N;j++){const u0=h.s0+2*r*j/N,u1=h.s0+2*r*(j+1)/N;pc(u0,u1,Math.max(f(u0),f(u1)),Math.min(h.y1,WHT))}}if(h.y1<WHT)pc(h.s0,h.s1,h.y1,WHT);")
R("else if(k==='door'){const dc=t.col||'#8b5a2b'", "else if(k==='door'&&t.arch){archDoor3(g,t)}else if(k==='door'){const dc=t.col||'#8b5a2b'")
# JumpStart 3D bridge: saving through the app, a close button, and the state the tutorials check
bridge = r'''<script>
/* ===== JumpStart 3D bridge ===== */
(function(){const P=(()=>{try{return window.parent!==window?window.parent:null}catch(e){return null}})();
const FPB=window.__fpb={dl:[],r3:0,views:new Set(),shots:0};
const _dl=dlBlob;dlBlob=function(b,name){FPB.dl.push(name);
if(P&&P.__JS3D_SAVE__){b.arrayBuffer().then(buf=>P.__JS3D_SAVE__(name,new Uint8Array(buf)));return}return _dl(b,name)};
const _r3=render3;render3=function(){FPB.r3++;const v=document.querySelector('#vw');FPB.views.add(v?v.value:'in');return _r3.apply(this,arguments)};
{const sb=document.querySelector('#shot');if(sb){const o=sb.onclick;sb.onclick=function(e){FPB.shots++;render3();const c=document.querySelector('#c3');c.toBlob(b=>dlBlob(b,'floorplan-3d.png'),'image/png')}}}
const st=document.createElement('style');st.textContent='.tut-spot{outline:3px solid #e8a317!important;outline-offset:2px;animation:tutSpotFP 1s ease-in-out infinite;position:relative;z-index:5}@keyframes tutSpotFP{50%{outline-color:#ffd24a;outline-offset:5px}}#js3d-close{margin-left:auto;border-color:#ffd24a;color:#ffd24a;font-weight:700}.js3d-send{position:relative;display:inline-block}.js3d-send3{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;font-size:13px}.js3d-send3 .b{border-color:#7fd17f}#js3d-send{border-color:#7fd17f;color:#c9f5c9;font-weight:700}.js3d-menu{position:absolute;right:0;top:calc(100% + 4px);display:flex;flex-direction:column;gap:4px;padding:6px;background:#173a5e;border:1px solid #9fd0ff;border-radius:8px;z-index:50;min-width:250px;box-shadow:0 6px 18px rgba(0,0,0,.35)}.js3d-menu[hidden]{display:none}.js3d-menu .b{text-align:left;white-space:nowrap}';document.head.appendChild(st);
if(P&&P.__JS3D_FP_CLOSE__){const h=document.querySelector('header');const g=document.createElement('div');g.className='g';g.style.marginLeft='auto';
g.innerHTML=(P.__JS3D_FP_TAB__?'<button class="b" id="js3d-tab" title="Open the Floor Planner in its own browser tab">Open in a new tab ↗</button>':'')+(P.__JS3D_FP_SEND__?'<span class="js3d-send"><button class="b" id="js3d-send" aria-haspopup="true" aria-expanded="false" title="Take this house (every floor, its doors, windows, furniture and roof) into JumpStart 3D">🏠 Use this house in ▾</button><span class="js3d-menu" id="js3d-menu" role="menu" hidden><button class="b" role="menuitem" data-send="arch">Architect: edit it, add a landscape</button><button class="b" role="menuitem" data-send="beginner">Beginner: shapes to print</button><button class="b" role="menuitem" data-send="advanced">Advanced: shapes to print</button></span></span>':'')+'<button class="b" id="js3d-close" title="Close the Floor Planner and go back to Architect. Your plan stays here until you close JumpStart 3D.">✕ Back to Architect</button>';h.appendChild(g);
g.querySelector('#js3d-close').onclick=()=>P.__JS3D_FP_CLOSE__();const sb=g.querySelector('#js3d-send'),mn=g.querySelector('#js3d-menu');if(sb){const show=v=>{mn.hidden=!v;sb.setAttribute('aria-expanded',String(v))};sb.onclick=e=>{e.stopPropagation();show(mn.hidden);if(!mn.hidden)mn.querySelector('button').focus()};mn.onclick=e=>{const b=e.target.closest('[data-send]');if(!b)return;show(false);try{syncLv()}catch(er){}P.__JS3D_FP_SEND__(b.dataset.send)};document.addEventListener('click',()=>show(false));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!mn.hidden){show(false);sb.focus()}})}const tb=g.querySelector('#js3d-tab');if(tb)tb.onclick=()=>P.__JS3D_FP_TAB__()}
{const sh=document.querySelector('#shot');if(sh&&P&&P.__JS3D_FP_SEND__){const d=document.createElement('div');d.className='js3d-send3';d.innerHTML='<b>Use this house in:</b> <button class="b" data-send3="arch" title="Open it in Architect, with every floor, door, window, piece of furniture and the roof">Architect</button><button class="b" data-send3="beginner" title="Shapes in Beginner, scaled to fit the build plate">Beginner</button><button class="b" data-send3="advanced" title="Shapes in Advanced, scaled to fit the build plate">Advanced</button>';sh.parentNode.insertBefore(d,sh.nextSibling);d.onclick=e=>{const b=e.target.closest('[data-send3]');if(!b)return;try{syncLv()}catch(er){}P.__JS3D_FP_SEND__(b.dataset.send3)}}}
const isR=r=>typeof isRect==='function'&&isRect(r);
const dimsOf=r=>{if(!isR(r))return null;const xs=r.v.map(p=>p.x),ys=r.v.map(p=>p.y);return[Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)]};
window.__fp={
 // the whole house for JumpStart 3D (feet, y down the page): every floor's rooms (outlines with
 // curves as points), items (furniture, doors, windows), floor heights and the roof
 exportPlan(){syncLv();const ls=lvs(),out={unit:'ft',levels:[],roof:{...ROOF}};
  for(const n of ls)withLevel(n,()=>{out.levels.push({n,name:(typeof LNM!=='undefined'&&LNM[n])||'',h:hOf(n),elev:elevOf(n),
   rooms:rooms.map(r=>({name:r.name||'',pts:outline(r).map(p=>[p.x,p.y]),wall:(r.wall&&r.wall.color)||null})),
   items:items.map(t=>({k:t.k,n:t.n||'',w:t.w,h:t.h,x:t.x,y:t.y,r:t.r||0,col:t.col||null,oh:t.oh||null,sk:t.sk||null,fl:t.fl||0,dir:t.dir||null,rs:t.rs||null,pr:t.pr||null,ps:t.ps||null,arch:t.arch||0,dbl:t.dbl||0,rise:t.rise||null,dh:t.dh||null}))})});
  return out},
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
more = open(ROOT + '/tools/fp_more.js', encoding='utf-8').read()
assert '</script' not in more.lower()
for part in (tuts, addons): assert '</script' not in part.lower()
R('</body></html>', '<script>\n' + more + '\n</script>\n' + bridge + '<script>\n' + tuts + '\n</script>\n<script>\n' + addons + '\n</script>\n</body></html>')
out = s
assert '071000013' not in out and 'Member FDIC' not in out
open(ROOT + '/src/floorplan.html', 'w', encoding='utf-8').write(out)
print('floorplan.html', len(out))
