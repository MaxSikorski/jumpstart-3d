// jumpstart-3d: deterministic reference blocks and runtime/doc coverage checker.
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {manifest} from '../src/apicontract.js';
export const signature=c=>`JS3D.${c.name}(${c.argsSchema.prefixItems.map((x,i)=>x.title+(i>=c.argsSchema.minItems?'?':'')).join(', ')})`;
export function generated(text, registry=manifest){
 for(const area of [...new Set(registry.calls.map(c=>c.area))]){
  const rows=registry.calls.filter(c=>c.area===area).map(c=>`| \`${signature(c)}\` | ${c.returnsKind}; ${c.async?'Promise; see waiting rule':'synchronous'} | [Effects/errors](#${c.docAnchor}) | [Example/reference](#${c.docAnchor}) |`).join('\n');
  text=replaceBlock(text,'index:'+area,'| Name/signature | Returns and waiting | Effects/errors | Example/reference |\n|---|---|---|---|\n'+rows);
 }
 text=replaceBlock(text,'index:Properties','| Name/signature | Returns and waiting | Effects/errors | Example/reference |\n|---|---|---|---|\n'+registry.properties.map(p=>`| \`JS3D.${p.name}\` | ${p.stability} property | Read-only access | [Value/reference](#${p.docAnchor}) |`).join('\n'));
 for(const c of registry.calls)text=replaceBlock(text,'schema:'+c.name,'```json\n'+JSON.stringify({argsSchema:c.argsSchema,returnsKind:c.returnsKind,returnsSchema:c.returnsSchema},null,2)+'\n```');
 return text;
}
function replaceBlock(text,key,body){const start=`<!-- api:begin ${key} -->`,end=`<!-- api:end ${key} -->`;const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<0)throw Error('missing generated block '+key);return text.slice(0,a)+start+'\n'+body+'\n'+text.slice(b);}
export function checkReference(members,text,registry=manifest){
 const all=[...registry.calls,...registry.properties], names=all.map(c=>c.name);
 if(new Set(names).size!==names.length)throw Error('duplicate manifest name');
 for(const m of members){if(m.symbol)throw Error('symbol API member');if(!names.includes(m.name))throw Error('undocumented installed member '+m.name);const call=registry.calls.some(c=>c.name===m.name);if(call!==(m.type==='function'))throw Error('member type mismatch '+m.name);if(!call){const p=registry.properties.find(p=>p.name===m.name),type=p.valueSchema.type||typeof p.valueSchema.const;if(m.type!==type)throw Error('property type mismatch '+m.name);}}
 for(const c of all){if(!members.some(m=>m.name===c.name))throw Error('manifest-only member '+c.name);
  const anchor=`<a id="${c.docAnchor}"></a>`;if(c.docAnchor!=='api-'+c.name||text.split(anchor).length!==2)throw Error('missing/duplicate docs anchor '+c.name);
  const tail=text.slice(text.indexOf(anchor)+anchor.length),end=tail.search(/\n(?:<a id="api-|## )/);const entry=end<0?tail:tail.slice(0,end);
  const fields=c.argsSchema?['Signature','Arguments/defaults/units','Returns','Errors','Effects/undo/storage','Example','Since/transports']:['Value','Returns','Errors','Effects/undo/storage','Example','Since/transports'];
  for(const field of fields){const marker=`**${field}**`;const i=entry.indexOf(marker);if(i<0)throw Error(`${c.name}: missing ${field}`);const body=entry.slice(i+marker.length).split(/\n\*\*|\n<!--|\n<a |\n## /)[0].trim();if(!body)throw Error(`${c.name}: empty ${field}`);}
 }
 return {calls:registry.calls.length,properties:registry.properties.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const url=new URL('../BRIDGE.md',import.meta.url),old=readFileSync(url,'utf8'),next=generated(old);if(process.argv.includes('--check')){if(old!==next)throw Error('BRIDGE.md generated blocks stale: run node tools/api-reference.mjs');console.log('API reference generated blocks match.');}else writeFileSync(url,next);}
