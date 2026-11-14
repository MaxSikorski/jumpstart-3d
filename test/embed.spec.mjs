import { test, expect } from '@playwright/test';
import { buildOf } from './helpers.mjs';

const port = process.env.JS3D_PORT || '8765';
const app = `http://localhost:${port}`;
const host = `http://127.0.0.1:${port}`;
async function openHost(page, hostOrigin = host, src = `${app}/?embed=${encodeURIComponent(host)}`) {
  // a page Playwright makes up has no address, so Chromium counts it as a public website and blocks its frame of localhost (Local Network Access); a real host is a public website framing a public app
  if (page.context().browser()?.browserType().name() === 'chromium') await page.context().grantPermissions(['local-network-access'], {origin: hostOrigin});
  await page.route(`${hostOrigin}/__embed-host.html`, (route) => route.fulfill({contentType:'text/html', body:`<iframe src="${src}"></iframe><script>window.messages=[];addEventListener('message',e=>messages.push(e.data));</script>`}));
  await page.goto(`${hostOrigin}/__embed-host.html`);
}
async function designs(page) { return (await page.evaluate(() => __app.projects._store.list())).map(d => [d.id, d.name, d.mode]); } // the page's own autosave and thumbnail land later and change rev, updated and thumb
async function call(page, id, name, ...args) {
  await page.evaluate(({id,name,args,app}) => document.querySelector('iframe').contentWindow.postMessage({type:'js3d-call',protocol:1,id,call:name,args}, app), {id,name,args,app});
  await expect.poll(() => page.evaluate((id) => window.messages.find(m => m.type === 'js3d-result' && m.id === id), id)).toBeTruthy();
  return page.evaluate((id) => window.messages.find(m => m.type === 'js3d-result' && m.id === id), id);
}
test('site host controls a temporary design and Stop closes the channel', async ({page}, info) => {
  test.skip(buildOf(info) !== 'site', 'iframe tests use the site build');
  await openHost(page);
  await expect.poll(() => page.evaluate(() => messages.find(m => m.type === 'js3d-ready'))).toBeTruthy();
  const ready = await page.evaluate(() => messages.find(m => m.type === 'js3d-ready'));
  expect(ready.calls).toContain('add');
  const frameWindow = page.frames().find(f => f.url().startsWith(app));
  await frameWindow.evaluate(() => window.postMessage({type:'js3d-call', protocol:1, id:100, call:'list'}, location.origin));
  expect((await call(page, 1, 'setMode', 'arch')).error).toContain('mode');
  expect(await page.evaluate(() => messages.some(m => m.id === 100))).toBe(false);
  const added = await call(page, 2, 'add', 'box', {size:{w:40,d:30,h:20}});
  await call(page, 3, 'ready');
  expect((await call(page, 4, 'get', added.result)).result.volume).toBeCloseTo(24000, 1);
  for (const [i, name] of ['run','load','invoke','codeCad','connect'].entries()) expect((await call(page, 5+i, name)).error).toContain('not available');
  const stl = await call(page, 10, 'export', 'stl');
  expect(stl.result instanceof Object).toBe(true);
  expect(await page.evaluate(() => { const b = messages.find(m => m.id === 10).result; return b instanceof Uint8Array && b.length > 84 && new DataView(b.buffer, b.byteOffset).getUint32(80, true) > 0; })).toBe(true);
  await call(page, 11, 'screenshot');
  expect(await page.evaluate(() => Array.from(messages.find(m => m.id === 11).result.slice(0, 8)))).toEqual([137,80,78,71,13,10,26,10]);
  const frame = page.frameLocator('iframe'); await frame.getByRole('button', {name:'Stop', exact:true}).click();
  await expect.poll(() => page.evaluate(() => messages.some(m => m.type === 'js3d-closed' && m.reason === 'stopped'))).toBe(true);
  await page.evaluate((app) => document.querySelector('iframe').contentWindow.postMessage({type:'js3d-call',protocol:1,id:20,call:'list'},app), app);
  await page.waitForTimeout(500); expect(await page.evaluate(() => messages.some(m => m.id === 20))).toBe(false);
});
test('scratch edits do not write designs and a different load closes the channel', async ({page}, info) => {
  test.skip(buildOf(info) !== 'site', 'iframe tests use the site build');
  await page.goto(app); await page.waitForFunction(() => window.__app?.projects?.started);
  await page.evaluate(async () => { JS3D.add('box'); await __app.projects.saveNow(); });
  const before = await designs(page);
  const normalKeys = await page.evaluate(() => Object.keys(localStorage));
  await openHost(page);
  await expect.poll(() => page.evaluate(() => messages.some(m => m.type === 'js3d-ready'))).toBe(true);
  const frame = page.frames().find(f => f.url().startsWith(app));
  expect(await frame.evaluate(() => JS3D.list())).toEqual([]);
  expect(await frame.evaluate(keys => keys.filter(k => Object.hasOwn(localStorage, k)), normalKeys)).toEqual([]);
  expect(await frame.evaluate(() => indexedDB === undefined)).toBe(true);
  expect((await call(page, 1, 'list')).result).toEqual([]);
  await call(page, 2, 'add', 'box'); await call(page, 3, 'ready');
  await frame.evaluate(() => { const doc = structuredClone(__store.doc); doc.id = 'different-design'; __store.load(doc); });
  await expect.poll(() => page.evaluate(() => messages.some(m => m.reason === 'design-changed'))).toBe(true);
  await page.goto(app); await page.waitForFunction(() => window.__app?.projects?.started);
  expect(await designs(page)).toEqual(before);
});
test('unlisted parent gets no reply', async ({page}, info) => {
  test.skip(buildOf(info) !== 'site', 'iframe tests use the site build');
  await openHost(page, `http://127.0.0.2:${port}`);
  await expect(page.frameLocator('iframe').getByText('Temporary design, not saved', {exact:false})).toBeVisible();
  const frame = page.frames().find(f => f.url().startsWith(app));
  await frame.evaluate(() => window.postMessage({type:'js3d-call',protocol:1,id:1,call:'list'}, '*'));
  await page.evaluate(app => document.querySelector('iframe').contentWindow.postMessage({type:'js3d-call',protocol:1,id:2,call:'list'}, app), app);
  await page.waitForTimeout(500); expect(await page.evaluate(() => messages.length)).toBe(0);
});
test('framed without ?embed: a temporary workspace that no website controls and that keeps nothing', async ({page}, info) => {
  test.skip(buildOf(info) !== 'site', 'iframe tests use the site build');
  await page.goto(app); await page.waitForFunction(() => window.__app?.projects?.started);
  await page.evaluate(async () => { JS3D.add('box'); await __app.projects.saveNow(); localStorage.setItem('top-level-probe', '1'); });
  const before = await designs(page);
  expect(before.length).toBeGreaterThan(0);
  const normalKeys = await page.evaluate(() => Object.keys(localStorage));
  await openHost(page, host, `${app}/`);
  const inside = page.frameLocator('iframe');
  await expect(inside.getByText('Temporary workspace inside another website. Nothing here is saved.')).toBeVisible();
  await expect(inside.getByRole('button', {name:'Stop', exact:true})).toHaveCount(0);
  let frame = page.frames().find(f => f.url().startsWith(app));
  await frame.waitForFunction(() => window.__app?.embed?.isScratch(window.__store?.doc?.id));
  expect(await frame.evaluate(() => JS3D.list())).toEqual([]);
  expect(await frame.evaluate(keys => keys.filter(k => Object.hasOwn(localStorage, k)), normalKeys)).toEqual([]);
  expect(await frame.evaluate(() => indexedDB === undefined)).toBe(true);
  // the person's own edit inside the frame stays in the frame
  await frame.evaluate(async () => { JS3D.add('box'); await JS3D.ready(); localStorage.setItem('frame-only', '1'); });
  // the host's messages arrive but are refused: no ready, no result, no change
  await frame.evaluate(() => { window.seen = []; addEventListener('message', e => seen.push(e.data?.type)); });
  await page.evaluate((app) => { const w = document.querySelector('iframe').contentWindow; w.postMessage({type:'js3d-hello',protocol:1}, app); w.postMessage({type:'js3d-call',protocol:1,id:1,call:'add',args:['box']}, app); }, app);
  await expect.poll(() => frame.evaluate(() => seen.length)).toBe(2);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => messages.filter(m => /^js3d-/.test(m?.type)))).toEqual([]);
  expect(await frame.evaluate(() => JS3D.list().length)).toBe(1);
  // nothing persists after a reload
  await page.reload();
  frame = page.frames().find(f => f.url().startsWith(app));
  await frame.waitForFunction(() => window.__app?.embed?.isScratch(window.__store?.doc?.id));
  expect(await frame.evaluate(() => [JS3D.list().length, localStorage.getItem('frame-only')])).toEqual([0, null]);
  // and the person's own designs and settings were never touched
  await page.goto(app); await page.waitForFunction(() => window.__app?.projects?.started);
  expect(await designs(page)).toEqual(before);
  expect(await page.evaluate(() => [localStorage.getItem('top-level-probe'), localStorage.getItem('frame-only')])).toEqual(['1', null]);
});
test('top-level embed parameter does not activate', async ({page}, info) => {
  test.skip(buildOf(info) !== 'site', 'site only'); await page.goto(`${app}/?embed=${encodeURIComponent(host)}`);
  await expect(page.getByText('Temporary design, not saved')).toHaveCount(0);
});
test('single file embed parameter does not activate', async ({page}, info) => {
  test.skip(buildOf(info) !== 'single', 'single file only');
  await page.goto(info.project.use.baseURL + '?embed=https%3A%2F%2Fschool.example');
  await expect(page.getByText('Temporary design, not saved')).toHaveCount(0);
  await page.evaluate(() => { window.messages = []; addEventListener('message', e => messages.push(e.data)); const f = document.createElement('iframe'); f.src = location.href; document.body.append(f); });
  await page.locator('iframe').waitFor();
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => !!window.JS3D);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => messages.some(m => m?.type === 'js3d-ready'))).toBe(false);
});
