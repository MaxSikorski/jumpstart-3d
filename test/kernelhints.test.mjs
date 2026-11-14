import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kernelHint, withKernelHint } from '../src/kernelhints.js';
test('adds hints for known kernel errors and preserves the original text', () => {
  for (const message of ['Corner radius is too large for this shape', 'Bevel is too large for this shape', 'Fillet 5 mm is too large for the selected edges.', "Shell: couldn't make a 2 mm wall here.", "Nothing is left: these shapes don't overlap, or the holes cut all of it away.", "Couldn't sweep the profile along this path.", "Couldn't read this body's sketch"]) {
    assert.ok(kernelHint(message), message);
    assert.ok(withKernelHint(message).startsWith(message));
  }
  assert.equal(kernelHint('unrecognized error'), '');
});
