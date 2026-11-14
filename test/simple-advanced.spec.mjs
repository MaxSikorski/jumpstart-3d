// Simple Advanced Browser and Timeline: src/simpleadvanced.js and src/simplemode.js.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { boot, loadDoc, newDoc, reload, watchErrors } from './helpers.mjs';

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

test('sheet control opens the collapsed phone sheet', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'This interaction needs the phone sheet.');
  await expect(page.locator('#sap-sheet')).toHaveAttribute('aria-expanded', 'false');
  await page.click('#sap-sheet');
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
  expect(await railIds(page)).toEqual(['ad-prims','ad-sketch','ad-extrude','ad-revolve','ad-edge','ad-hole','ad-shell','ad-pattern','ad-measure']);
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
  await expect.poll(() => page.evaluate(() => window.__app.command?.title)).toMatch(/Joint/i);
});

test('Beginner sketch uses the sketch rail and restores Beginner tools', async ({ page }, info) => {
  desktop(info); await page.evaluate(() => window.__app.setMode('beginner')); await page.click('#sr-sketch');
  await canvasPoint(page,10,-10); await expect(page.locator('#sar-sk-line')).toBeVisible(); await expect(page.locator('#sar-sk-finish')).toBeVisible();
  await page.click('#sar-sk-rect'); await canvasPoint(page,-20,-10); await canvasPoint(page,20,10);
  await expect.poll(() => page.evaluate(() => window.__app.sketcher.sketch.ents.length)).toBe(4);
  await page.locator('#sar-sk-finish').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#sr-sketch')).toBeVisible();
  await expect(page.locator('#sr-shapes')).toBeFocused();
});

test('phone shows six rail tools and More, with Pattern and Measure in More', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Phone tab bar only.');
  expect(await railIds(page)).toEqual(['ad-prims','ad-sketch','ad-extrude','ad-edge','ad-hole','ad-shell']); await expect(page.locator('#sr-more')).toBeVisible();
  await page.click('#sr-more'); await expect(page.locator('#simple-more [data-for="ad-pattern"]:visible')).toBeVisible(); await expect(page.locator('#simple-more [data-for="ad-measure"]:visible')).toBeVisible();
});

test('selected body actions stay visible at the bottom of the Browser', async ({ page }, info) => {
  desktop(info);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => window.__app.select([window.__store.doc.bodies[0].id]));
  const props = page.locator('#simple-adv-panel #browser .props');
  const edit = props.getByRole('button', { name: 'Edit', exact: true });
  const del = props.getByRole('button', { name: 'Delete', exact: true });
  await expect(edit).toBeVisible(); await expect(del).toBeVisible();
  const bounds = await props.evaluate(el => {
    const panel = document.querySelector('#simple-adv-panel').getBoundingClientRect();
    return [...el.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return r.top >= panel.top && r.bottom <= panel.bottom; });
  });
  expect(bounds.every(Boolean)).toBe(true);
});

test('adding a feature scrolls the Timeline to its new row but rerendering does not', async ({ page }, info) => {
  desktop(info);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => window.__store.update(d => {
    const body = d.bodies[0];
    for (let i = 0; i < 20; i++) d.bodies.push({ ...structuredClone(body), id: `scroll-body-${i}`, name: `Scroll body ${i}`, seq: 1000 + i });
  }, 'Add bodies'));
  const slot = page.locator('#sap-timeline-slot');
  await expect.poll(() => slot.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await slot.evaluate(el => { el.scrollTop = 0; });
  await page.evaluate(() => window.__app.refreshUI());
  await expect.poll(() => slot.evaluate(el => el.scrollTop)).toBe(0);
  const count = await page.locator('#timeline .tl-item').count();
  await page.evaluate(() => window.__store.update(d => {
    d.bodies.push({ ...structuredClone(d.bodies[0]), id: 'scroll-new-body', name: 'Newest body', seq: 2000 });
  }, 'Add body'));
  await expect(page.locator('#timeline .tl-item')).toHaveCount(count + 1);
  await expect.poll(() => slot.evaluate(el => {
    const row = el.querySelector('.tl-item:last-child').getBoundingClientRect(), view = el.getBoundingClientRect();
    return row.bottom <= view.bottom && row.top >= view.top;
  })).toBe(true);
});

test('mobile Timeline items and controls have 44 px touch targets', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'This interaction needs the phone sheet.');
  await page.click('#sap-sheet');
  const targets = page.locator('#simple-adv-panel :is(.tl-item, .tl-ctl)');
  expect(await targets.count()).toBeGreaterThan(0);
  for (const height of await targets.evaluateAll(els => els.map(el => el.getBoundingClientRect().height))) expect(height).toBeGreaterThanOrEqual(44);
});

test('section headers show Browser and Timeline counts', async ({ page }) => {
  const counts = await page.evaluate(() => ({ browser: window.__store.doc.bodies.length + window.__store.doc.sketches.length, timeline: document.querySelectorAll('#timeline .tl-item').length }));
  await expect(page.locator('#sap-browser .sap-head')).toContainText(`Browser (${counts.browser})`);
  await expect(page.locator('#sap-timeline .sap-head')).toContainText(`Timeline (${counts.timeline})`);
});


test('sketch constraints and quick extrude work from the rail', async ({ page }, info) => {
  desktop(info); await loadDoc(page, newDoc('Rail sketch', 'advanced')); await enterSketch(page);
  await page.click('#sar-sk-line'); await canvasPoint(page,-20,-15); await canvasPoint(page,20,-10);
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => window.__store.doc.sketches.at(-1).cons.length);
  await page.click('#sar-sk-constraints'); await page.locator('#ribbon-menu #sk-c-horizontal').click();
  await canvasPoint(page,0,-12.5);
  await expect.poll(() => page.evaluate(() => window.__store.doc.sketches.at(-1).cons.length)).toBeGreaterThan(before);
  await page.click('#sar-sk-rect'); await canvasPoint(page,-15,0); await canvasPoint(page,15,20);
  const bodies = await page.evaluate(() => window.__store.doc.bodies.length);
  await page.click('#sar-sk-extrude'); await page.click('#cmd-ok');
  await expect.poll(() => page.evaluate(() => window.__store.doc.bodies.length)).toBe(bodies + 1);
});

test('rectangle choices and canonical tutorial aliases are reachable', async ({ page }, info) => {
  desktop(info);
  expect(await page.evaluate(() => window.__app.simple.proxyFor('ad-hole-m')?.id)).toBe('sar-ad-hole');
  await page.click('#sr-more');
  expect(await page.evaluate(() => window.__app.simple.proxyFor('ad-fastbtn')?.dataset.for)).toBe('ad-fasteners');
  await page.click('#sr-more'); await enterSketch(page);
  await moreTool(page,'sk-rectc'); await expect.poll(() => page.evaluate(() => window.__app.sketcher.tool)).toBe('rectc');
  await moreTool(page,'sk-rect'); await expect.poll(() => page.evaluate(() => window.__app.sketcher.tool)).toBe('rect');
});

test('rail arrows move focus without nudging the selected body', async ({ page }, info) => {
  desktop(info); await page.locator('#browser .node:not(.fold) .nm').first().click();
  const before = await page.evaluate(() => JSON.stringify(window.__store.doc.bodies));
  await page.locator('#sar-ad-sketch').focus(); await page.keyboard.press('ArrowDown');
  await expect(page.locator('#sar-ad-extrude')).toBeFocused();
  expect(await page.evaluate(() => JSON.stringify(window.__store.doc.bodies))).toBe(before);
});

test('Advanced More has icons, one Workshop, and searchable import and plane names', async ({ page }, info) => {
  desktop(info); await page.click('#sr-more');
  const workshop = page.locator('#simple-more section:visible').filter({ has: page.getByRole('heading', { name: 'Workshop', exact: true }) });
  await expect(workshop).toHaveCount(1);
  await expect(workshop.locator('[data-for="simple-run-litho"]')).toBeVisible();
  await expect(workshop.locator('[data-for="exp-laser-svg"]')).toBeVisible();
  expect(await page.locator('#simple-more .sadv-group button:visible').evaluateAll(bs => bs.every(b => !!b.querySelector('svg')))).toBe(true);
  for (const [query, id] of [['image','ad-ins-img'], ['STL','ad-ins-model'], ['offset plane','ad-plane-off']]) {
    await page.fill('#simple-find', query);
    await expect(page.locator(`#simple-more [data-for="${id}"]`)).toBeVisible();
  }
});


test('Primitives opens beside the rail and Box creates a body', async ({ page }, info) => {
  desktop(info); const before = await page.evaluate(() => window.__store.doc.bodies.length);
  await page.click('#sar-ad-prims'); await expect(page.locator('#ribbon-menu')).toBeVisible();
  const button = await page.locator('#sar-ad-prims').boundingBox(), menu = await page.locator('#ribbon-menu').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(button.x + button.width);
  await page.click('#ribbon-menu #ad-box'); await page.click('#cmd-ok'); await expect.poll(() => page.evaluate(() => window.__store.doc.bodies.length)).toBeGreaterThan(before);
});

test('pressed Rectangle returns to Select', async ({ page }) => {
  await enterSketch(page); await page.click('#sar-sk-rect'); await expect(page.locator('#sar-sk-rect')).toHaveAttribute('aria-pressed','true');
  await page.click('#sar-sk-rect'); await expect.poll(() => page.evaluate(() => window.__app.sketcher.tool)).toBe('select');
});

test('Main tools is first and unchanged status is not rewritten', async ({ page }, info) => {
  desktop(info); await page.click('#sr-more'); await expect(page.locator('#simple-more section').first().locator('h3')).toHaveText('Main tools');
  await page.click('#sr-more'); await enterSketch(page);
  const changes = await page.evaluate(async () => { const note = document.querySelector('#sap-note'); let count = 0; const observer = new MutationObserver(records => count += records.length); observer.observe(note, {childList:true, characterData:true, subtree:true}); window.__app.refreshUI(); await new Promise(resolve => setTimeout(resolve, 0)); observer.disconnect(); return count; });
  expect(changes).toBe(0);
});

test('Beginner Find import does not leave an empty panel', async ({ page }) => {
  await page.evaluate(() => window.__app.setMode('beginner')); await page.click('#sr-more'); await page.fill('#simple-find','import');
  expect(await page.locator('#simple-more button[data-for]:visible').count() + await page.locator('#simple-empty:visible').count()).toBeGreaterThan(0);
});
