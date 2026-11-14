// Simple Advanced Browser and Timeline: src/simpleadvanced.js and src/simplemode.js.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { boot, loadDoc, reload, watchErrors } from './helpers.mjs';

const design = JSON.parse(readFileSync(new URL('./projects/advanced-sketch-extrude.json', import.meta.url), 'utf8'));
let errors;
test.beforeEach(async ({ page }, info) => {
  errors = watchErrors(page); await boot(page, info);
  await page.evaluate(() => window.__app.setFace('simple', true));
  await loadDoc(page, design);
});
test.afterEach(() => expect(errors).toEqual([]));

function desktop(info) { test.skip(info.project.name === 'mobile', 'This interaction needs the desktop panel.'); }

test('Browser and Timeline keep selecting and editing', async ({ page }, info) => {
  desktop(info);
  await expect(page.locator('#simple-adv-panel #browser')).toBeVisible();
  await expect(page.locator('#simple-adv-panel #timeline')).toBeVisible();
  await expect(page.locator('#timeline .tl-item')).toHaveCount(await page.evaluate(() => window.__app.timelineRoll.count()));
  await page.locator('#browser .node:not(.fold) .nm').first().click();
  await expect.poll(() => page.evaluate(() => window.__app.sel.length)).toBeGreaterThan(0);
  await page.locator('#timeline .tl-item').last().dblclick();
  await expect.poll(() => page.evaluate(() => !!window.__app.command)).toBe(true);
});

test('Timeline section stays closed across reload', async ({ page }, info) => {
  desktop(info);
  const head = page.locator('#sap-timeline .sap-head');
  await head.click(); await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#sap-timeline-slot')).toBeHidden();
  await reload(page); await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#sap-timeline-slot')).toBeHidden();
});

test('panel keyboard activation leaves the command open', async ({ page }, info) => {
  desktop(info);
  await page.locator('#timeline .tl-item').last().dblclick();
  await expect.poll(() => page.evaluate(() => !!window.__app.command)).toBe(true);
  const title = await page.locator('#cmd').textContent();
  const head = page.locator('#sap-browser .sap-head');
  await head.focus(); await page.keyboard.press('Enter');
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => page.evaluate(() => !!window.__app.command)).toBe(true);
  await expect(page.locator('#cmd')).toHaveText(title);
  await page.keyboard.press('Space'); await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => page.evaluate(() => !!window.__app.command)).toBe(true);
});

test('side Timeline does not displace STEP progress', async ({ page }, info) => {
  desktop(info);
  await page.click('#sap-browser .sap-head');
  const result = await page.evaluate(() => {
    const vp = document.querySelector('#viewport').getBoundingClientRect();
    const timeline = document.querySelector('#timeline').getBoundingClientRect();
    window.__app.stepProgress.start('test.step');
    return { vpRight: vp.right, timelineLeft: timeline.left, bottom: parseFloat(document.querySelector('#step-progress').style.bottom) };
  });
  expect(result.timelineLeft).toBeGreaterThanOrEqual(result.vpRight);
  expect(result.bottom).toBe(12);
});

test('ribbon Browser reveals a hidden panel with Browser open', async ({ page }, info) => {
  desktop(info);
  await page.setViewportSize({ width: 820, height: 768 });
  await page.click('#simple-collapse-panel');
  await page.evaluate(() => document.querySelector('#ribbon .panel-toggle').click());
  await expect(page.locator('#sap-browser .sap-head')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#browser')).toBeVisible();
});

test('ribbon Browser opens the collapsed phone sheet', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'This interaction needs the phone sheet.');
  await expect(page.locator('#sap-sheet')).toHaveAttribute('aria-expanded', 'false');
  await page.click('#ribbon .panel-toggle');
  await expect(page.locator('#sap-sheet')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#sap-browser .sap-head')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#browser')).toBeVisible();
});

test('panel handle widens the viewport and restores it', async ({ page }, info) => {
  desktop(info);
  const width = () => page.locator('#viewport').evaluate(el => el.clientWidth);
  const before = await width(); await page.click('#simple-collapse-panel');
  await expect(page.locator('html')).toHaveAttribute('data-simple-hide', /\bpanel\b/);
  expect(await width()).toBeGreaterThan(before);
  await page.click('#simple-collapse-panel'); await expect.poll(width).toBe(before);
});

test('Original and Beginner restore both original positions', async ({ page }, info) => {
  desktop(info);
  const restored = () => page.evaluate(() => { const b = document.querySelector('#browser'), t = document.querySelector('#timeline'); return b.parentElement.matches('main.work') && b.nextElementSibling.id === 'viewport' && t.parentElement.id === 'viewport'; });
  await page.evaluate(() => window.__app.setFace('original', true)); expect(await restored()).toBe(true);
  await page.evaluate(() => window.__app.setFace('simple', true));
  await expect(page.locator('#simple-adv-panel #browser')).toBeAttached();
  await page.evaluate(() => window.__app.setMode('beginner')); expect(await restored()).toBe(true);
});

test('Print Sim returns the Browser and restores it on exit', async ({ page }, info) => {
  desktop(info);
  await page.click('#sr-more'); await page.locator('#simple-more [data-for="ws-print"]').click(); await expect(page.locator('#simple-adv-panel')).toBeHidden();
  expect(await page.locator('#browser').evaluate(el => el.parentElement.matches('main.work'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#simple-adv-panel #browser')).toBeVisible();
});

test('reveal opens the panel and Browser section for Parameters', async ({ page }, info) => {
  desktop(info);
  await page.click('#sap-browser .sap-head'); await page.click('#simple-collapse-panel');
  await page.evaluate(() => window.__app.simple.reveal(document.querySelector('#browser .param-add')));
  await expect(page.locator('#sap-browser .sap-head')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#browser .param-add')).toBeVisible();
});

test('fits the screen and opens the phone sheet', async ({ page }, info) => {
  if (info.project.name === 'mobile') {
    const sheet = page.locator('#sap-sheet'); await expect(sheet).toBeVisible(); await sheet.click();
    await expect(sheet).toHaveAttribute('aria-expanded', 'true'); await expect(page.locator('#simple-adv-panel #browser')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } else {
    for (const width of [1366, 1280, 1024, 820]) {
      await page.setViewportSize({ width, height: 768 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `width ${width}`).toBe(true);
    }
  }
});

const railIds = page => page.locator('#sar button:visible').evaluateAll(bs => bs.map(b => b.dataset.for));
async function moreTool(page, id) {
  await page.click('#sr-more');
  await page.locator(`#simple-more [data-for="${id}"]:visible`).first().click();
}
async function enterSketch(page) {
  await page.locator('#sar [data-for="ad-sketch"]').click();
  await page.locator('#plane-seg button').filter({ hasText: 'XY' }).click();
  await expect.poll(() => page.evaluate(() => !!window.__app.sketcher.active)).toBe(true);
}
async function canvasPoint(page, x, y) {
  const point = await page.evaluate(([x,y]) => { const vp = window.__app.vp, r = vp.canvas.getBoundingClientRect(); vp.updateCamera(); const p = vp.project(vp.view.target.clone().set(x,y,0)); return {x:r.left+p[0], y:r.top+p[1]}; }, [x,y]);
  await page.mouse.click(point.x, point.y);
}

test('design rail replaces the ribbon and keeps More in the rail', async ({ page }, info) => {
  desktop(info);
  await expect(page.locator('#ribbon')).toBeHidden();
  expect(await railIds(page)).toEqual(['ad-sketch','ad-extrude','ad-revolve','ad-edge','ad-hole','ad-shell','ad-pattern','ad-measure']);
  expect(await page.locator('#sr-more').evaluate(b => b.parentElement.id)).toBe('simple-rail');
});

test('ribbon tools and menu items have proxies in every workspace', async ({ page }, info) => {
  desktop(info);
  const check = async () => {
    const missing = await page.evaluate(() => {
      const ribbon = document.querySelector('#ribbon'), ids = [];
      for (const b of ribbon.querySelectorAll('button[id]')) {
        if (b.hasAttribute('aria-haspopup')) {
          b.click(); document.querySelectorAll('#ribbon-menu button[id]').forEach(item => ids.push(item.id));
          document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
        } else ids.push(b.id);
      }
      return [...new Set(ids)].filter(id => ![...document.querySelectorAll('#simple-rail [data-for], #simple-more [data-for]')].some(b => b.dataset.for === id));
    });
    expect(missing).toEqual([]);
  };
  await check(); await enterSketch(page); await check(); await page.click('#sar-sk-finish');
  await moreTool(page, 'ws-print'); await check(); await page.keyboard.press('Escape');
  await moreTool(page, 'ws-simulate'); await check();
});

test('rail and More run commands and mirror the edge choice', async ({ page }, info) => {
  desktop(info);
  await page.click('#sar-ad-revolve'); await expect.poll(() => page.evaluate(() => window.__app.command?.title)).toMatch(/Revolve/i);
  await expect(page.locator('#ribbon-menu')).toHaveCount(0); await page.keyboard.press('Escape');
  await moreTool(page, 'ad-chamfer'); await expect.poll(() => page.evaluate(() => window.__app.command?.title)).toMatch(/Chamfer/i);
  await expect(page.locator('#sar-ad-edge')).toContainText('Chamfer'); await page.keyboard.press('Escape');
  await page.click('#sr-more'); await page.fill('#simple-find','combine'); await page.locator('#simple-find').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__app.command?.title)).toMatch(/Combine/i);
});

test('sketch rail draws a rectangle and returns to Design', async ({ page }, info) => {
  desktop(info); await enterSketch(page); await page.click('#sar-sk-rect');
  await canvasPoint(page,-20,-10); await canvasPoint(page,20,10);
  await expect.poll(() => page.evaluate(() => window.__app.sketcher.sketch.ents.length)).toBe(4);
  await page.click('#sar-sk-constraints'); await expect(page.locator('#ribbon-menu')).toBeVisible();
  const button = await page.locator('#sar-sk-constraints').boundingBox(), menu = await page.locator('#ribbon-menu').boundingBox(); expect(menu.x).toBeGreaterThanOrEqual(button.x + button.width);
  await page.keyboard.press('Escape'); await expect(page.locator('#sar-sk-constraints')).toBeFocused();
  await page.click('#sar-sk-finish'); await expect(page.locator('#simple-rail')).toHaveAttribute('data-set','design');
});

test('More switches workspaces and finds Simulate tools', async ({ page }, info) => {
  desktop(info); await moreTool(page,'ws-simulate'); await expect.poll(() => page.evaluate(() => window.__app.advanced.workspace)).toBe('simulate');
  await page.locator('#sar [data-for="ws-design"]:visible').click(); await moreTool(page,'ws-print'); await expect(page.locator('body')).toHaveClass(/ps-orca/);
  await page.keyboard.press('Escape'); await expect.poll(() => page.evaluate(() => window.__app.advanced.workspace)).toBe('design');
  await page.click('#sr-more'); await page.fill('#simple-find','joint'); await page.locator('#simple-find').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__app.advanced.workspace)).toBe('simulate');
});

test('Beginner sketch uses the sketch rail and restores Beginner tools', async ({ page }, info) => {
  desktop(info); await page.evaluate(() => window.__app.setMode('beginner')); await page.click('#sr-sketch');
  await canvasPoint(page,10,-10); await expect(page.locator('#sar-sk-line')).toBeVisible(); await expect(page.locator('#sar-sk-finish')).toBeVisible();
  await page.click('#sar-sk-rect'); await canvasPoint(page,-20,-10); await canvasPoint(page,20,10);
  await expect.poll(() => page.evaluate(() => window.__app.sketcher.sketch.ents.length)).toBe(4);
  await page.click('#sar-sk-finish'); await expect(page.locator('#sr-sketch')).toBeVisible();
});

test('phone shows six rail tools and More, with Pattern and Measure in More', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Phone tab bar only.');
  await expect(page.locator('#sar button:visible')).toHaveCount(6); await expect(page.locator('#sr-more')).toBeVisible();
  await page.click('#sr-more'); await expect(page.locator('#simple-more [data-for="ad-pattern"]:visible')).toBeVisible(); await expect(page.locator('#simple-more [data-for="ad-measure"]:visible')).toBeVisible();
});
