// jumpstart-3d: public contract gate; run after build, never skip a missing prerequisite.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import {manifest,API_VERSION,discovery} from '../src/apicontract.js';
import {checkReference,generated} from '../tools/api-reference.mjs';
const docs=readFileSync(new URL('../BRIDGE.md',import.meta.url),'utf8');
const members=[...manifest.calls.map(c=>({name:c.name,type:'function'})),...manifest.properties.map(c=>({name:c.name,type:c.name==='internals'?'object':'string'}))];
test('single-file runtime own keys and descriptors exactly match documented contract', {timeout:120000}, async()=>{
 const file=resolve('dist/jumpstart-3d.html');assert.ok(existsSync(file),'prerequisite: node build.mjs must create dist/jumpstart-3d.html');
 let browser;
 try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();const page=await context.newPage();
  await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>!!window.JS3D,{},{timeout:90000});
  const state=await page.evaluate(()=>({members:Reflect.ownKeys(JS3D).map(key=>{const d=Object.getOwnPropertyDescriptor(JS3D,key);return {name:typeof key==='string'?key:'',symbol:typeof key==='symbol',type:'value'in d?typeof d.value:typeof JS3D[key]};}),alias:JS3D.delete===JS3D.remove,version:JS3D.version,apiVersion:JS3D.apiVersion,description:JS3D.describe()}));
  assert.deepEqual(checkReference(state.members,docs),{calls:76,properties:4});assert.equal(state.alias,true);assert.equal(state.apiVersion,API_VERSION);assert.equal(state.version,API_VERSION.split('.').slice(0,2).join('.'));
  assert.deepEqual(state.description.calls,manifest.calls);assert.deepEqual(state.description.properties,manifest.properties);
 }finally{await browser?.close();}
});
test('generated reference check never rewrites files',()=>{assert.equal(generated(docs),docs);execFileSync(process.execPath,['tools/api-reference.mjs','--check']);assert.equal(readFileSync(new URL('../BRIDGE.md',import.meta.url),'utf8'),docs);});
test('coverage checker rejects undocumented function, property, alias and nonenumerable own key',()=>{
 for(const [name,value,enumerable] of [['surprise',()=>{},true],['newProperty',3,true],['alias',()=>{},true],['hiddenCall',()=>{},false]]){
  const api=Object.fromEntries(members.map(m=>[m.name,m.type==='function'?()=>{}:m.type==='object'?{}:'x']));Object.defineProperty(api,name,{value,enumerable});
  const actual=Reflect.ownKeys(api).map(name=>({name,type:typeof Object.getOwnPropertyDescriptor(api,name).value}));
  assert.throws(()=>checkReference(actual,docs),/undocumented installed member/);
 }
});
test('coverage checker rejects missing fields, bogus anchor, removed runtime member, symbols and duplicate registry names',()=>{
 const begin=docs.indexOf('<a id="api-add"></a>'),end=docs.indexOf('<a id="api-',begin+1);const entry=docs.slice(begin,end);
 for(const field of ['Errors','Example'])assert.throws(()=>checkReference(members,docs.slice(0,begin)+entry.replace(`**${field}**`,`**Omitted${field}**`)+docs.slice(end)),new RegExp('missing '+field));
 assert.throws(()=>checkReference(members,docs.replace('<a id="api-add"></a>','<a id="wrong-add"></a>')),/anchor/);
 assert.throws(()=>checkReference(members.filter(m=>m.name!=='add'),docs),/manifest-only/);
 assert.throws(()=>checkReference([...members,{symbol:true}],docs),/symbol/);
 assert.throws(()=>checkReference(members,docs,{...manifest,calls:[...manifest.calls,manifest.calls[0]]}),/duplicate/);
 assert.throws(()=>checkReference(members.map(m=>m.name==='add'?{...m,type:'number'}:m),docs),/type mismatch/);
});
test('discovery freezes nested schemas, copies data, and only supports exact own callable strings',()=>{
 let invoked=0;const api={add(){invoked++;},apiVersion:API_VERSION,credentials:'PRIVATE_SENTINEL',docName:'PRIVATE_DESIGN'};Object.assign(api,discovery(api,'test'));
 for(const x of ['add','supports','describe'])assert.equal(api.supports(x),true);
 for(const x of ['toString','constructor','apiVersion','ADD',' add','missing',null,42,{},Symbol('add')])assert.equal(api.supports(x),false);
 assert.equal(invoked,0);const d=api.describe();d.calls[0].argsSchema.prefixItems.push({});d.properties.length=0;assert.deepEqual(api.describe().calls,manifest.calls);assert.equal(api.describe().properties.length,4);
 const walk=v=>{if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));Object.values(v).forEach(walk);}};walk(manifest);
 assert.equal(/PRIVATE_SENTINEL|PRIVATE_DESIGN/.test(JSON.stringify(api.describe())),false);
});
test('positional schemas, unions, defaults and examples cover the integrated API',()=>{
 const get=name=>manifest.calls.find(c=>c.name===name);
 for(const c of manifest.calls){assert.ok(c.example.includes('JS3D.'+c.name));assert.equal(c.argsSchema.type,'array');assert.equal(c.argsSchema.maxItems,c.argsSchema.prefixItems.length);assert.ok(c.argsSchema.minItems<=c.argsSchema.maxItems);assert.ok(c.argsSchema.prefixItems.every(s=>s.title));assert.equal(c.transports.postMessage,false);if(c.returnsKind==='void')assert.equal(c.returnsSchema,null);}
 assert.equal(get('ready').argsSchema.prefixItems[0].default,90000);
 assert.equal(get('newDesign').argsSchema.prefixItems[0].default,'beginner');
 assert.equal(get('checkpoint').argsSchema.prefixItems[0].maxLength,200);
 assert.equal(get('fillet').argsSchema.$defs.selector.anyOf.length,3);
 assert.equal(get('measure').argsSchema.prefixItems[0].anyOf.length,5);
 assert.equal(get('sketch').argsSchema.prefixItems[0].properties.shapes.items.oneOf.length,7);
 assert.equal(get('drawing').argsSchema.prefixItems[0].additionalProperties,false);
 assert.equal(get('add').argsSchema.prefixItems[1].additionalProperties,true);
 assert.equal(get('rollback').async,false);assert.equal(get('codeCad').async,true);assert.equal(get('holePattern').async,true);
 assert.ok(get('list').returnsSchema.items.properties.volume.anyOf.some(s=>s.type==='null'));
 assert.equal(get('delete').aliasOf,'remove');
});

// Small fixture matcher for the schema vocabulary used here; not a runtime validator.
function matches(s,v,root=s){
 if(s===null)return v===undefined;
 if(s.$ref)return matches(root.$defs[s.$ref.split('/').at(-1)],v,root);
 if(s.anyOf&&!s.anyOf.some(x=>matches(x,v,root)))return false;
 if(s.oneOf&&s.oneOf.filter(x=>matches(x,v,root)).length!==1)return false;
 if(s.not&&matches(s.not,v,root))return false;
 if('const'in s&&JSON.stringify(v)!==JSON.stringify(s.const))return false;
 if(s.enum&&!s.enum.includes(v))return false;
 const type=v===null?'null':Array.isArray(v)?'array':typeof v;
 if(s.type&&(s.type==='integer'?!Number.isInteger(v):s.type!==type))return false;
 if(typeof v==='number'&&(!Number.isFinite(v)||(s.minimum!==undefined&&v<s.minimum)||(s.maximum!==undefined&&v>s.maximum)||(s.exclusiveMinimum!==undefined&&v<=s.exclusiveMinimum)||(s.multipleOf!==undefined&&Math.abs(v/s.multipleOf-Math.round(v/s.multipleOf))>1e-8)))return false;
 if(typeof v==='string'&&((s.minLength!==undefined&&[...v].length<s.minLength)||(s.maxLength!==undefined&&[...v].length>s.maxLength)||(s.pattern&&!new RegExp(s.pattern).test(v))))return false;
 if(Array.isArray(v)){
  if(v.length<(s.minItems??0)||v.length>(s.maxItems??Infinity))return false;
  if(s.uniqueItems&&new Set(v.map(x=>JSON.stringify(x))).size!==v.length)return false;
  if(!v.every((x,i)=>matches(s.prefixItems?.[i]||s.items||{},x,root)))return false;
 }
 if(type==='object'){
  if((s.required||[]).some(k=>!Object.hasOwn(v,k)))return false;
  if(s.maxProperties!==undefined&&Object.keys(v).length>s.maxProperties)return false;
  for(const [k,x] of Object.entries(v)){if(s.propertyNames&&!matches(s.propertyNames,k,root))return false;const p=s.properties?.[k];if(!p&&s.additionalProperties===false)return false;if(!matches(p||(typeof s.additionalProperties==='object'?s.additionalProperties:{}),x,root))return false;}
 }
 return true;
}
test('independent input/result fixtures exercise schema unions, defaults and error/empty results',async()=>{
 const schema=name=>manifest.calls.find(c=>c.name===name);
 const good=[['add',['box',{size:[40,30,20]}]],['fillet',['b1',[0,1],'W/4']],['shell',['b1',{th:2,open:[]}]],['shell',['b1',{th:2,open:null}]],['measure',[[0,0,0],{body:'b1',near:[1,2,3]}]],['sketch',[{shapes:[{type:'circle',diameter:20}]}]],['namePlate',[{text:'Hi',holes:'screws'}]],['drawing',[{views:['top'],scale:1,units:'mm'}]],['checkpoint',['before']],['diff',['c1','c2']],['spring',[{turns:2.5}]]];
 for(const [name,args] of good)assert.ok(matches(schema(name).argsSchema,args),name+' valid');
 const bad=[['add',[]],['sketch',[{shapes:[{type:'circle',diameter:20,unexpected:1}]}]],['drawing',[{views:['top','top']}]],['drawing',[{scale:0}]],['checkpoint',['x'.repeat(201)]],['diff',['not-a-checkpoint']],['spring',[{turns:2.25}]],['fillet',['b1',[],-1]],['hardware',[{part:'shcs'}]]];
 for(const [name,args] of bad)assert.equal(matches(schema(name).argsSchema,args),false,name+' invalid');
 const {historyCalls}=await import('../src/bridgehistory.js');
 const doc={id:'d1',bodies:[],sketches:[],params:[]};const history=historyCalls({store:{doc},snapshot:()=>structuredClone(doc),edit(){},app:{}});
 const cp=history.checkpoint('before');assert.ok(matches(schema('checkpoint').returnsSchema,cp));assert.ok(matches(schema('checkpoints').returnsSchema,history.checkpoints()));assert.ok(matches(schema('diff').returnsSchema,history.diff(cp.id)));
 const {checkPrint}=await import('../src/inspectgeo.js');
 const emptyPrint={...checkPrint({bodies:[],bed:null,angle:45}),ignored:[],printer:'none',bed:null,angle:45};assert.ok(matches(schema('printCheck').returnsSchema,emptyPrint));assert.equal(emptyPrint.ok,false);
 assert.ok(matches(schema('list').returnsSchema,[]));
 assert.ok(matches(schema('list').returnsSchema,[{id:'b1',name:'Box',kind:'box',hole:false,hidden:false,locked:false,color:'#ffffff',position:[0,0,0],bbox:null,volume:null,error:'build failed'}]));
 assert.ok(matches(schema('namePlate').returnsSchema,{plate:'b1',textBody:null,size:[40,20,3]}));
 assert.ok(matches(schema('collisions').returnsSchema,{pairs:[],checked:0,skipped:[]}));
 assert.ok(matches(schema('describe').returnsSchema,discovery({},'test').describe()));
});
test('red/green gate proof: registered new call requires its own complete reference',()=>{
 const name='undocumentedProbe',docAnchor='api-'+name;
 const registry={...manifest,calls:[...manifest.calls,{...manifest.calls[0],name,docAnchor}]};
 const actual=[...members,{name,type:'function'}];
 assert.throws(()=>checkReference(actual,docs,registry),/missing\/duplicate docs anchor undocumentedProbe/);
 const reference=`\n<a id="${docAnchor}"></a>\n### Probe\n\n`+['Signature','Arguments/defaults/units','Returns','Errors','Effects/undo/storage','Example','Since/transports'].map(f=>`**${f}**\n\nFixture value.\n\n`).join('');
 assert.deepEqual(checkReference(actual,docs+reference,registry),{calls:77,properties:4});
 assert.throws(()=>checkReference(members.filter(m=>!['supports','describe'].includes(m.name)),docs),/manifest-only member/);
});
