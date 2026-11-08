import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../tools.mjs";
import { TOOLS as CHAT } from "../../src/chattools.js";
const cases=[['checkpoint','checkpoint',{label:'safe'},['safe']],['checkpoint','checkpoint',{},[]],['list_checkpoints','checkpoints',{},[]],['diff_checkpoint','diff',{fromId:'c1'},['c1']],['diff_checkpoint','diff',{fromId:'c1',toId:'c2'},['c1','c2']],['rollback','rollback',{id:'c1'},['c1']]];
for(const [name,method,args,expected] of cases) test(`${name} forwards ${JSON.stringify(args)}`,async()=>{
  const t=TOOLS.find(t=>t.name===name); const calls=[];
  const result=await t.run(args,{call:(...a)=>{calls.push(a);return 'answer';}});
  assert.equal(result,'answer'); assert.deepEqual(calls[0].slice(0,2),[method,expected]);
});
test('checkpoint tools follow redo with matching chat contracts',()=>{
  const names=['checkpoint','list_checkpoints','diff_checkpoint','rollback'];
  for(const list of [TOOLS,CHAT])assert.deepEqual(list.slice(list.findIndex(t=>t.name==='redo')+1,list.findIndex(t=>t.name==='redo')+5).map(t=>t.name),names);
  for(const name of names){const a=TOOLS.find(t=>t.name===name),b=CHAT.find(t=>t.name===name); assert.equal(a.description,b.description);assert.deepEqual(Object.keys(a.shape),Object.keys(b.parameters.properties));}
});
test('chat forwards checkpoint methods and propagates errors',async()=>{
  const prior=globalThis.window; const calls=[];
  globalThis.window={JS3D:Object.fromEntries(['checkpoint','checkpoints','diff','rollback'].map(m=>[m,(...args)=>{calls.push([m,args]);if(m==='rollback')throw Error('no checkpoint "c9"');return 'ok';}]))};
  try{
    assert.equal(CHAT.find(t=>t.name==='checkpoint').run({label:'safe'}),'ok');
    CHAT.find(t=>t.name==='list_checkpoints').run({}); CHAT.find(t=>t.name==='diff_checkpoint').run({fromId:'c1',toId:'c2'});
    assert.throws(()=>CHAT.find(t=>t.name==='rollback').run({id:'c9'}),/no checkpoint/);
    assert.deepEqual(calls,[['checkpoint',['safe']],['checkpoints',[]],['diff',['c1','c2']],['rollback',['c9']]]);
  }finally{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});
