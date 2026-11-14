import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kernelHint, withKernelHint } from '../src/kernelhints.js';
test('gives advice for the actual kernel failures', () => {
  for (const [message, expected] of [
    ['Fillet: its edges no longer exist', /remove.*feature.*JS3D.edges/],
    ['Chamfer: its edges no longer exist', /remove.*feature.*JS3D.edges/],
    ["Shell: the faces to remove weren't found. Edit the shell and pick them again.", /Remove.*shell.*JS3D.faces/],
    ['Empty group', /Undo the step that emptied the group/],
    ['The taper is too large: the profile collapses before the end of the sweep.', /smaller taper or distance/],
    ['The taper changes this profile too much (some of its edges vanish). Use a smaller taper angle or distance.', /smaller taper or distance/],
    ['Fillet 5 mm is too large for the selected edges.', /JS3D.undo\(\).*smaller/],
    ["Shell: couldn't make a 2 mm wall here.", /JS3D.undo\(\).*thinner/],
    ['Corner radius is too large for this shape', /smaller/],
    ["Nothing is left: these shapes don't overlap, or the holes cut all of it away.", /overlap/],
    ["Couldn't sweep the profile along this path.", /gentler path/],
  ]) { assert.match(kernelHint(message), expected); assert.ok(withKernelHint(message).startsWith(message)); }
  assert.equal(kernelHint('unrecognized error'), '');
});
