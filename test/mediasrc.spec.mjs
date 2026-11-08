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
