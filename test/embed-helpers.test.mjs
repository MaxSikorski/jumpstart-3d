import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.html') || url.endsWith('/fonts_more.js')) return {format:'module', source:'export default "test data";', shortCircuit:true};
    return next(url, context);
  },
});

test('embedded helper pages are refused and data stays available', async () => {
  const previousWindow = globalThis.window, previousLocation = globalThis.location;
  globalThis.window = {parent:{}};
  globalThis.location = {protocol:'https:', search:'?embed=https://school.example'};
  try {
    const {helperPage, helperAsset, helperFailText} = await import('../src/helperpages.js');
    for (const [name, title] of [['chisel','Chisel'], ['flexigen','FlexiGen'], ['meshstep','Mesh to STEP'], ['neon','Neon']]) {
      await assert.rejects(helperPage(name), e => e.message === `${title} is not available in the temporary workspace. Open the full app to use it.` && helperFailText(title, e) === e.message);
    }
    await assert.rejects(helperAsset('floorplan.html'), /Floor Planner is not available in the temporary workspace/);
    assert.equal(await helperAsset('fonts_more.js'), 'test data');
  } finally { globalThis.window = previousWindow; globalThis.location = previousLocation; }
});

test('embedding resets display units after isolation', () => {
  const source = readFileSync(new URL('../src/embed.js', import.meta.url), 'utf8');
  assert.match(source, /export function startEmbed\(app, api\)\s*\{\s*setUnit\("mm"\)/);
});
