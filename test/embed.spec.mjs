import { test, expect } from '@playwright/test';
import { buildOf } from './helpers.mjs';

const port = process.env.JS3D_PORT || '8765';
const app = `http://localhost:${port}`;
const host = `http://127.0.0.1:${port}`;
async function openHost(page, hostOrigin = host) {
  await page.route(`${hostOrigin}/__embed-host.html`, (route) => route.fulfill({contentType:'text/html', body:`<iframe src="${app}/?embed=${encodeURIComponent(host)}"></iframe><script>window.messages=[];addEventListener('message',e=>messages.push(e.data));</script>`}));
  await page.goto(`${hostOrigin}/__embed-host.html`);
}
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
  const before = await page.evaluate(() => __app.projects._store.list());
  await openHost(page);
  await expect.poll(() => page.evaluate(() => messages.some(m => m.type === 'js3d-ready'))).toBe(true);
  const frame = page.frames().find(f => f.url().startsWith(app));
  await frame.evaluate(() => {
    window.__embedWrites = [];
    const set = Storage.prototype.setItem, open = indexedDB.open.bind(indexedDB);
    Storage.prototype.setItem = function (...a) { window.__embedWrites.push(['storage', a[0]]); return set.apply(this, a); };
    indexedDB.open = function (...a) { window.__embedWrites.push(['database', a[0]]); return open(...a); };
  });
  expect((await call(page, 1, 'list')).result).toEqual([]);
  await call(page, 2, 'add', 'box'); await call(page, 3, 'ready');
  expect(await frame.evaluate(() => window.__embedWrites)).toEqual([]);
  await frame.evaluate(() => { const doc = structuredClone(__store.doc); doc.id = 'different-design'; __store.load(doc); });
  await expect.poll(() => page.evaluate(() => messages.some(m => m.reason === 'design-changed'))).toBe(true);
  await page.goto(app); await page.waitForFunction(() => window.__app?.projects?.started);
  expect(await page.evaluate(() => __app.projects._store.list())).toEqual(before);
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
