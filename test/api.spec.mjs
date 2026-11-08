// jumpstart-3d: runtime contract parity on both builds (orchestrator runs browser specs).
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {boot} from './helpers.mjs';
import {manifest,API_VERSION} from '../src/apicontract.js';
import {checkReference} from '../tools/api-reference.mjs';
const docs=readFileSync(new URL('../BRIDGE.md',import.meta.url),'utf8');
test('runtime contract, pure discovery and defensive copies',async({page},info)=>{
 await boot(page,info);
 const result=await page.evaluate(()=>{
  const before=JSON.stringify({doc:JS3D.doc(),undo:__store.undoStack,selection:JS3D.selection()});
  const descriptor=Object.getOwnPropertyDescriptor(JS3D,'add');let calls=0;JS3D.add=()=>{calls++;throw Error('must not invoke');};
  const supported=JS3D.supports('add');Object.defineProperty(JS3D,'add',descriptor);
  const bad=['constructor','toString','internals','version','Add','unknown',null,0,{},[]].map(x=>JS3D.supports(x));
  const first=JS3D.describe();first.calls[0].name='changed';first.calls[0].argsSchema.prefixItems.push({});first.properties.length=0;
  const description=JS3D.describe();const after=JSON.stringify({doc:JS3D.doc(),undo:__store.undoStack,selection:JS3D.selection()});
  return {before,after,calls,supported,bad,description,alias:JS3D.delete===JS3D.remove,members:Reflect.ownKeys(JS3D).map(key=>({name:typeof key==='string'?key:'',symbol:typeof key==='symbol',type:typeof Object.getOwnPropertyDescriptor(JS3D,key).value})),version:JS3D.version};
 });
 expect(result.before).toBe(result.after);expect(result.calls).toBe(0);expect(result.supported).toBe(true);expect(result.bad.every(x=>!x)).toBe(true);expect(result.alias).toBe(true);
 expect(checkReference(result.members,docs)).toEqual({calls:76,properties:4});expect(result.description.calls).toEqual(manifest.calls);expect(result.description.properties).toEqual(manifest.properties);expect(result.description.apiVersion).toBe(API_VERSION);expect(result.version).toBe('1.13');
});
