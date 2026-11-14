import { test, expect } from '@playwright/test';
import { boot } from './helpers.mjs';
import { CALLS, PROPERTIES } from '../src/apicontract.js';

test('API discovery matches installed calls and leaves the design alone', async ({ page }, info) => {
  await boot(page, info);
  const names = [...CALLS, ...PROPERTIES].map(x => x.name).sort();
  const result = await page.evaluate(expected => {
    const keys = Reflect.ownKeys(window.JS3D).sort();
    const id = JS3D.add('box'); JS3D.select([id]);
    const doc = JSON.stringify(JS3D.doc()), selection = JS3D.selection();
    const supported = JS3D.supports('add'), description = JS3D.describe();
    const unchanged = doc === JSON.stringify(JS3D.doc()) && JSON.stringify(selection) === JSON.stringify(JS3D.selection());
    JS3D.undo();
    return { keys, expected, supported, description, unchanged, removed: !JS3D.list().some(b => b.id === id) };
  }, names);
  expect(result.keys).toEqual(result.expected); expect(result.supported).toBe(true); expect(result.description.apiVersion).toBeTruthy(); expect(result.unchanged).toBe(true); expect(result.removed).toBe(true);
});
