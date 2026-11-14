import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bridge } from './bridgenode.mjs';
import { CALLS, PROPERTIES, API_VERSION } from '../src/apicontract.js';
import { checkDocs } from '../tools/apidocs.mjs';
const installed = api => Reflect.ownKeys(api).map(name => ({ name, type: typeof api[name] }));
test('installed API is documented', () => {
  const {api} = bridge();
  assert.deepEqual(checkDocs({installed: installed(api), calls: CALLS, properties: PROPERTIES, text: readFileSync(new URL('../BRIDGE.md', import.meta.url), 'utf8')}), []);
});
const calls = [{name:'foo', signature:'foo() -> number'}], properties = [{name:'version'}];
const good = '<a id="api-foo"></a>\n#### `JS3D.foo() -> number`\n- **Arguments:** None\n- **Returns:** Number\n- **Errors:** None\n- **Example:** `JS3D.foo()`\n- **Since:** 1.0\n<a id="api-version"></a>\n#### `JS3D.version`\n- **Value:** Version\n- **Example:** `JS3D.version`\n- **Since:** 1.0\n';
const base = {calls, properties, installed:[{name:'foo',type:'function'},{name:'version',type:'string'}], text:good};
test('checker accepts a complete reference',()=>assert.deepEqual(checkDocs(base),[]));
for (const [name, change] of [
 ['undocumented installed call', {installed:[...base.installed,{name:'extra',type:'function'}]}],
 ['call not installed',{installed:base.installed.slice(1)}],
 ['stale anchor',{text:good+'<a id="api-stale"></a>'}],
 ['missing errors',{text:good.replace('- **Errors:** None\n','')}],
 ['empty example',{text:good.replace('`JS3D.foo()`','``')}],
 ['example without JS3D',{text:good.replace('`JS3D.foo()`','`foo()`')}],
 ['property function',{installed:[base.installed[0],{name:'version',type:'function'}]}],
 ['duplicate heading',{text:good+'## Repeat\n## Repeat\n'}],
]) test(name,()=>assert.ok(checkDocs({...base,...change}).length));
test('discovery is fresh, sorted, JSON safe and recognizes only calls',()=>{
 const {api}=bridge(); const d=api.describe(); assert.deepEqual(JSON.parse(JSON.stringify(d)),d); assert.equal(d.apiVersion,API_VERSION); assert.equal(d.version,API_VERSION.split('.').slice(0,2).join('.')); assert.ok(d.appVersion);
 for(const list of [d.calls,d.properties]) assert.deepEqual(list.map(x=>x.name),list.map(x=>x.name).sort((a,b)=>a.localeCompare(b)));
 d.calls[0].name='changed';d.properties.length=0;assert.notDeepEqual(api.describe(),d);
 for(const c of CALLS) assert.equal(api.supports(c.name),true,c.name);
 for(const n of [...PROPERTIES.map(p=>p.name),'nope','toString','constructor','__proto__','hasOwnProperty',1,null,undefined,{}]) assert.equal(api.supports(n),false);
});
test('discovery leaves design, history and selection unchanged',()=>{
 const {api,store,app}=bridge({sel:[],select(ids){this.sel=ids;}}); const id=api.add('box'); api.select([id]);
 const before=JSON.stringify([store.doc,store.undoStack.at(-1)?.label,app.sel]); api.supports('add');api.describe();assert.equal(JSON.stringify([store.doc,store.undoStack.at(-1)?.label,app.sel]),before);
});
