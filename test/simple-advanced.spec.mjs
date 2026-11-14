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
  await page.click('#ribbon .panel-toggle');
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
  await page.click('#ws-print'); await expect(page.locator('#simple-adv-panel')).toBeHidden();
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
