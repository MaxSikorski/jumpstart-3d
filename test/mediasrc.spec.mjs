// Runs against site and single via the shared Playwright configuration.
import { test, expect } from '@playwright/test';
import { boot, newDoc, body, prim } from './helpers.mjs';

const hostile = 'http://media-source.example.test/private-pixel';
const design = (id, src) => newDoc('Media guard', 'beginner', {
  media: { [id]: { kind: 'image', src, name: id } },
  bodies: [body('box', 'Box', prim('box', { w: 20, d: 20, h: 20, r: 0, c: 0 }), undefined, { media: { id, map: 'box' } })],
});

test('project media never fetches an address; embedded pictures display', async ({ page }, info) => {
  const requests = [], warnings = [];
  page.on('request', r => { if (r.url().includes('media-source.example.test')) requests.push(r.url()); });
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
  // Abort if a regression occurs: the request event still records the attempt.
  await page.route('**media-source.example.test/**', r => r.abort());
  await boot(page, info);
  await page.evaluate(d => window.JS3D.load(d), design('unsafe', hostile));
  expect(await page.evaluate(() => window.__store.doc.media.unsafe)).toBeUndefined();
  expect(warnings.some(s => s.includes('unsafe'))).toBe(true);
  expect(warnings.some(s => s.includes(hostile))).toBe(false);
  expect(await page.evaluate(() => window.__app.media.entryFor('unsafe', window.__store.doc).kind)).toBe('missing');

  // Bypass load cleanup to exercise use sites (old storage, preview, edits).
  await page.evaluate(d => {
    window.__store.update(doc => { doc.media = d.media; doc.bodies[0].media = { id: 'direct', map: 'box' }; }, 'Test unsafe source');
    window.__app.media.open();
  }, design('direct', hostile));
  expect(await page.evaluate(() => window.__app.media.entryFor('direct', window.__store.doc).kind)).toBe('missing');
  await expect(page.locator('#media-panel img')).toHaveCount(0);

  const picture = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 2, 2);
    return c.toDataURL('image/png');
  });
  await page.evaluate(d => window.JS3D.load(d), design('embedded', picture));
  await expect.poll(() => page.evaluate(() => {
    const v = window.__app.scene.views.get('box');
    const img = v?.mediaMesh?.material.uniforms.map.value?.image;
    return !!v?.mediaMesh?.visible && img?.naturalWidth > 0;
  })).toBe(true);
  await expect.poll(() => page.locator('#media-panel img').evaluateAll(imgs => imgs.some(im => im.complete && im.naturalWidth > 0))).toBe(true);
  expect(requests).toEqual([]);
});

const sketch = src => ({ id: 's1', name: 'Sketch', seq: 1, hidden: false,
  plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [], cons: [],
  image: { src, name: 'Reference', w: 20, h: 10, cx: 2, cy: 3, rot: 15, opacity: 0.4 } });

test('sketch rendering, tracing and puffing reject addresses and retain placement', async ({ page }, info) => {
  const requests = [];
  page.on('request', r => { if (r.url().includes('media-source.example.test')) requests.push(r.url()); });
  await page.route('**media-source.example.test/**', r => r.abort());
  await boot(page, info);
  const doc = newDoc('Sketch guard', 'advanced', { sketches: [sketch(hostile)] });
  await page.evaluate(d => window.JS3D.load(d), doc);
  expect(await page.evaluate(() => window.__store.doc.sketches[0].image)).toEqual({ ...doc.sketches[0].image, src: null });
  // Exercise the use sites independently of load cleanup.
  await page.evaluate(src => { window.__store.update(d => { d.sketches[0].image.src = src; }, 'Unsafe sketch'); window.__app.scene.refresh(); window.__app.traceCmd('s1'); }, hostile);
  await expect(page.locator('#cmd')).toContainText('Auto trace picture');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__app.puffyCmd('s1'));
  await expect(page.locator('#cmd')).toContainText('Picture to 3D model');
  await page.keyboard.press('Escape');
  expect(requests).toEqual([]);
});

for (const mode of ['beginner', 'advanced']) test(`${mode} rejects CSS URLs in body colors`, async ({ page }, info) => {
  const requests = [];
  page.on('request', r => { if (r.url().includes('media-source.example.test')) requests.push(r.url()); });
  await page.route('**media-source.example.test/**', r => r.abort());
  await boot(page, info);
  const doc = design('image', 'data:image/png;base64,AA==');
  doc.mode = mode; doc.bodies[0].color = `url(${hostile})`;
  await page.evaluate(d => { window.__store.load(d); window.__app.setMode(d.mode, true); window.__app.select(['box']); }, doc);
  expect(await page.evaluate(() => window.__store.doc.bodies[0].color)).toBe('#a7b0ba');
  // Bypass cleanup to exercise the CSS sink too.
  await page.evaluate(color => window.__store.update(d => { d.bodies[0].color = color; }, 'Unsafe color'), `url(${hostile})`);
  expect(requests).toEqual([]);
});

test('restored thumbnails cannot fetch addresses and saved pictures round trip', async ({ page }, info) => {
  const requests = [];
  page.on('request', r => { if (r.url().includes('media-source.example.test')) requests.push(r.url()); });
  await page.route('**media-source.example.test/**', r => r.abort());
  await boot(page, info);
  const picture = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 2; c.getContext('2d').fillRect(0, 0, 2, 2); return c.toDataURL('image/png'); });
  const doc = design('saved', picture);
  await page.evaluate(d => window.JS3D.load(d), doc);
  await page.evaluate(() => window.__app.projects.saveNow());
  const saved = await page.evaluate(async id => JSON.parse(await window.__app.projects._store.get(id)), doc.id);
  expect(saved.media.saved.src).toBe(picture);
  await page.evaluate(d => window.JS3D.load(d), saved);
  await expect.poll(() => page.evaluate(() => window.__app.scene.views.get('box')?.mediaMesh?.material.uniforms.map.value?.image?.naturalWidth || 0)).toBeGreaterThan(0);
  const other = { ...doc, id: 't_restored_guard', name: 'Restored guard' };
  const backup = { app: 'jumpstart-3d', backup: 1, designs: [{ entry: { id: other.id, name: other.name, thumb: hostile }, doc: other }] };
  await page.setInputFiles('#file-backup', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect.poll(() => page.evaluate(async id => (await window.__app.projects._store.list()).find(e => e.id === id)?.thumb, other.id)).toBeNull();
  await page.click('#btn-projects');
  await expect(page.locator('.projgrid .pcard', { hasText: 'Restored guard' })).toHaveCount(1);
  expect(requests).toEqual([]);
});
