import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { worldBounds, fitsPlate, restsOnPlate, verdict } from '../src/printcheck.js';
const p = [-5,-5,0, 5,-5,0, 5,5,0, -5,5,0, -5,-5,10, 5,-5,10, 5,5,10, -5,5,10];
const ix = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7];
const matrix = (x=0,z=0) => [1,0,0,0,0,1,0,0,0,0,1,0,x,0,z,1];
test('plate contact, size, and edge', () => {
  assert.deepEqual(restsOnPlate(p,ix,matrix()), { minZ: 0, contactArea: 100 });
  assert.equal(restsOnPlate(p,ix,matrix(0,3)).minZ, 3);
  assert.equal(restsOnPlate(p,ix,matrix(0,-2)).minZ, -2);
  assert.equal(fitsPlate(worldBounds(p,matrix()), {w:9,d:20,h:20}).why, 'size');
  assert.equal(fitsPlate(worldBounds(p,matrix(8)), {w:20,d:20,h:20}).why, 'edge');
  assert.deepEqual(fitsPlate(worldBounds(p,matrix()), null), {ok:true,why:'none'});
  const t = Math.SQRT1_2, tilted = [t,0,-t,0,0,1,0,0,t,0,t,0,0,0,5*t,1];
  assert.equal(restsOnPlate(p,ix,tilted).contactArea, 0);
  assert.equal(verdict({flat:'point',fit:true,overhang:false}), 'warn');
});
