// jumpstart-3d: explicit mapping checks keep bridge, MCP and flat chat schemas separate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {TOOLS} from '../tools.mjs';
import {TOOLS as CHAT} from '../../src/chattools.js';
import {manifest} from '../../src/apicontract.js';
import {API_MAPPING} from './api-mapping-fixture.mjs';
const clean=x=>JSON.parse(JSON.stringify(x));
const stop=new Error('fixture: stop before effects');
test('every tool has an explicit mapping and byte-equal descriptions',()=>{
 assert.deepEqual(API_MAPPING.map(x=>x.tool).sort(),TOOLS.map(x=>x.name).sort());
 for(const m of TOOLS)assert.equal(m.description,CHAT.find(c=>c.name===m.name).description,m.name);
 for(const f of API_MAPPING){if(f.call)assert.ok(manifest.calls.some(c=>c.name===f.call),f.call);assert.ok(f.difference);}
});
for(const f of API_MAPPING)test(`${f.tool}: named arguments reach documented positional bridge call`,async()=>{
 const tool=TOOLS.find(t=>t.name===f.tool),chat=CHAT.find(t=>t.name===f.tool);const seen=[];
 const trap=(name,args)=>{seen.push([name,clean(args)]);throw stop;};
 const args=z.object(tool.shape).parse(f.args);
 try{await tool.run(args,{call:trap,status:()=>trap(null,[])});}catch(e){assert.equal(e,stop,f.tool+': unexpected MCP error');}
 assert.deepEqual(seen,[[f.call,f.expected]],f.tool+': MCP');seen.length=0;
 const prior=globalThis.window;globalThis.window={JS3D:new Proxy({appVersion:'test',version:'1.13'},{get:(o,k)=>k in o?o[k]:(...args)=>trap(k,args)})};
 try{await chat.run(f.args,{scripts:true,vision:true,download(){throw Error('must not download in forwarding fixture');}});}catch(e){assert.equal(e,stop,f.tool+': unexpected chat error');}finally{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
 // Chat can pass trailing undefined, while MCP trims it before JSON transport.
 for(const c of seen)while(c[1].at(-1)===null)c[1].pop();
 assert.deepEqual(seen,[[f.chatCall,f.chatExpected]],f.tool+': chat');
});
test('shared enums and parameter names agree; documented adapter differences remain explicit',()=>{
 const different=new Set(['status','screenshot','export_file','export_drawing','save_project','load_project','run_script']);
 for(const m of TOOLS){const c=CHAT.find(t=>t.name===m.name);if(different.has(m.name))continue;
  const extras={rotate_bodies:['axis_vector'],scale_bodies:['k_xyz']}[m.name]||[];
  assert.deepEqual(Object.keys(c.parameters.properties).sort(),[...Object.keys(m.shape),...extras].sort(),m.name);
  const enumOf=s=>{while(s?._def?.innerType)s=s._def.innerType;return s?._def?.values;};
  for(const [key,s] of Object.entries(c.parameters.properties)){if(!s.enum)continue;const values=enumOf(m.shape[key]);if(values)assert.deepEqual(s.enum,values,m.name+'.'+key);}
 }
 const get=n=>manifest.calls.find(c=>c.name===n);
 for(const [tool,call,param,index] of [['set_mode','setMode','mode',0],['new_design','newDesign','mode',0],['export_file','export','kind',0]]){
  let s=TOOLS.find(t=>t.name===tool).shape[param];while(s._def.innerType)s=s._def.innerType;assert.deepEqual(s._def.values,get(call).argsSchema.prefixItems[index].enum,tool);
 }
 const shot=z.object(TOOLS.find(t=>t.name==='screenshot').shape).parse({});assert.deepEqual(shot,{width:800,fit:true});
 assert.equal(get('screenshot').argsSchema.prefixItems[0].properties.fit.default,false);
 assert.equal(get('ready').argsSchema.prefixItems[0].default,90000);
 assert.equal(get('drawing').argsSchema.prefixItems[0].properties.units.default,'mm');
});
