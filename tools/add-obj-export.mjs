// Adds our OBJ export to a freshly extracted src/ tree. Run after
// tools/extract.mjs; running it twice is refused.
//
//   node tools/add-obj-export.mjs
//
// The app bundle is minified, so the helper names (bodies list, download
// function, file-name function) are read off the STL exporter next door
// instead of being hard-coded.

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../src/", import.meta.url).pathname;
let app = readFileSync(root + "app.js", "utf8");
let shell = readFileSync(root + "index.html", "utf8");
if (app.includes("function seObj(")) throw new Error("OBJ export is already applied");

const once = (re, text, label) => {
  const all = text.match(new RegExp(re.source, re.flags + "g")) || [];
  if (all.length !== 1) throw new Error(`${label}: expected 1 match, found ${all.length}`);
  return re.exec(text);
};

// async function ue(){let Se=re();if(!Se){i.toast("Nothing to export yet. ...");return}await K(Y()+".stl",Se)}
const stl = once(
  /async function (\w+)\(\)\{let (\w+)=(\w+)\(\);if\(!\2\)\{i\.toast\("Nothing to export yet\. Holes on their own aren't exported\."\);return\}await (\w+)\((\w+)\(\)\+"\.stl",\2\)\}/,
  app,
  "STL export function"
);
const [stlFn, , stlSerializer, download, fileName] = stl.slice(1);
// function re(){let Se=[];for(let ot of V()){let et=i.scene.views.get(ot.id);...
const ser = once(
  new RegExp(`function ${stlSerializer}\\(\\)\\{let \\w+=\\[\\];for\\(let \\w+ of (\\w+)\\(\\)\\)\\{let \\w+=i\\.scene\\.views\\.get\\(`),
  app,
  "STL serializer"
);
const bodies = ser[1];
// Locals inside the OBJ code below must not shadow these minified helpers.
for (const n of [bodies, download, fileName]) if (/^(_e|nt|Ye|oLines|off|f|x|v|y|z|k|Z|j|Me|Xe|Pe|a|b|c|name|data|m)$/.test(n)) throw new Error(`helper name ${n} collides with a local in the OBJ code`);

const objCode =
  `function seObj(){let _e=[];for(let nt of ${bodies}()){let Ye=i.scene.views.get(nt.id);!Ye||!Ye.data||_e.push({name:nt.name||nt.id,data:Ye.data,m:Ye.group.matrix})}if(!_e.length)return null;` +
  `let oLines=["# JumpStart 3D export (mm)"],off=1,f=x=>{let v=Math.round(x*1e5)/1e5;return Object.is(v,-0)?"0":String(v)};` +
  `for(let{name,data:nt,m:Ye}of _e){let Z=Ye.elements,j=nt.vertices,Me=nt.triangles,Xe=Z[0]*(Z[5]*Z[10]-Z[9]*Z[6])-Z[4]*(Z[1]*Z[10]-Z[9]*Z[2])+Z[8]*(Z[1]*Z[6]-Z[5]*Z[2]);` +
  `oLines.push("o "+String(name).replace(/\\s+/g,"_"));` +
  `for(let k=0;k<j.length;k+=3){let x=j[k],y=j[k+1],z=j[k+2];oLines.push("v "+f(Z[0]*x+Z[4]*y+Z[8]*z+Z[12])+" "+f(Z[1]*x+Z[5]*y+Z[9]*z+Z[13])+" "+f(Z[2]*x+Z[6]*y+Z[10]*z+Z[14]))}` +
  `for(let Pe=0;Pe<Me.length;Pe+=3){let a=Me[Pe]+off,b=Me[Pe+1]+off,c=Me[Pe+2]+off;Xe<0&&([b,c]=[c,b]);oLines.push("f "+a+" "+b+" "+c)}off+=j.length/3}` +
  `return new TextEncoder().encode(oLines.join("\\n")+"\\n")}` +
  `async function ceObj(){let _e=seObj();if(!_e){i.toast("Nothing to export yet. Holes on their own aren't exported.");return}await ${download}(${fileName}()+".obj",_e)}`;

const patch = (text, from, to, label) => {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, found ${n}`);
  return text.replace(from, () => to);
};
app = patch(app, stl[0], objCode + stl[0], "insert OBJ functions");
app = patch(app, `we==="stl"&&${stlFn}(),`, `we==="stl"&&${stlFn}(),we==="obj"&&ceObj(),`, "export menu handler");
shell = patch(
  shell,
  '<button data-act="stl">STL for 3D printing <small>.stl</small></button>\n',
  '<button data-act="stl">STL for 3D printing <small>.stl</small></button>\n' +
    '        <button data-act="obj">OBJ for Blender and other 3D apps <small>.obj</small></button>\n',
  "export menu button"
);
writeFileSync(root + "app.js", app);
writeFileSync(root + "index.html", shell);
console.log(`OBJ export added (bodies ${bodies}, download ${download}, name ${fileName}, stl ${stlFn})`);
