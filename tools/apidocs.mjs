import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function checkDocs({ installed, calls, properties, text }) {
  const problems = [], manifest = [...calls, ...properties], names = new Set();
  for (const item of manifest) {
    if (names.has(item.name)) problems.push(`duplicate manifest name: ${item.name}`);
    names.add(item.name);
  }
  const seen = new Set();
  for (const item of installed) {
    if (typeof item.name !== 'string') { problems.push('symbol installed name'); continue; }
    if (seen.has(item.name)) problems.push(`duplicate installed name: ${item.name}`);
    seen.add(item.name);
    if (!names.has(item.name)) problems.push(`undocumented installed name: ${item.name}`);
    if (calls.some(c => c.name === item.name) && item.type !== 'function') problems.push(`call is not a function: ${item.name}`);
    if (properties.some(p => p.name === item.name) && item.type === 'function') problems.push(`property is a function: ${item.name}`);
  }
  for (const item of manifest) if (!seen.has(item.name)) problems.push(`manifest name not installed: ${item.name}`);
  const anchors = [...text.matchAll(/<a id="api-([^"]+)"><\/a>/g)];
  for (const a of anchors) if (!names.has(a[1])) problems.push(`stale anchor: ${a[1]}`);
  for (const item of manifest) {
    const matches = anchors.filter(a => a[1] === item.name);
    if (matches.length !== 1) { problems.push(`expected one anchor for ${item.name}, found ${matches.length}`); continue; }
    const start = matches[0].index + matches[0][0].length;
    const entry = text.slice(start).split(/(?=<a id="api-|^## )/m)[0].trimStart();
    const call = calls.includes(item);
    const heading = `#### \`JS3D.${call ? item.signature : item.name}\``;
    if (entry.split(/\r?\n/)[0] !== heading) problems.push(`wrong heading: ${item.name}`);
    for (const field of call ? ['Arguments', 'Returns', 'Errors', 'Example', 'Since'] : ['Value', 'Example', 'Since']) {
      const line = entry.match(new RegExp(`^- \\*\\*${field}:\\*\\*[ \t]*(.*)$`, 'm'));
      if (!line || !line[1].trim()) problems.push(`missing ${field}: ${item.name}`);
      else if (field === 'Example' && (!line[1].includes('JS3D.') || !line[1].replace(/[`\s]/g, ''))) problems.push(`invalid Example: ${item.name}`);
    }
  }
  const ids = new Set();
  const add = id => { if (ids.has(id)) problems.push(`duplicate heading or anchor id: ${id}`); ids.add(id); };
  for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$|<a\s+id="([^"]+)"[^>]*>/gm)) {
    if (match[2]) add(match[2]);
    else add(match[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-'));
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [{ bridge }, { CALLS, PROPERTIES }, text] = await Promise.all([import('../test/bridgenode.mjs'), import('../src/apicontract.js'), readFile(new URL('../BRIDGE.md', import.meta.url), 'utf8')]);
  const { api } = bridge();
  const installed = Reflect.ownKeys(api).map(name => ({ name, type: typeof api[name] }));
  const problems = checkDocs({ installed, calls: CALLS, properties: PROPERTIES, text });
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log(`API docs: ${CALLS.length} calls and ${PROPERTIES.length} properties documented`);
}
