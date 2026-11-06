import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadKernel, root } from './stepspeed-kernel.mjs';

test('kernel rejects degenerate path arcs before OpenCascade', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sharelink-kernel-'));
  try {
    const source = join(dir, 'kernel.js');
    writeFileSync(source, readFileSync(root + 'src/kernel.js', 'utf8') + '\nexport { sweepPath as __sweepPath };\n');
    const { __sweepPath } = await loadKernel(source);
    for (const [a, m, b] of [
      [[60,50,0], [40,50,0], [60,50,0]],
      [[0,0,0], [1,1e-9,0], [2,0,0]],
      [[0,0,0], [0,1e-6,0], [2,0,0]],
      [[0,0,0], [1,1,0], [1,1 + 5e-7,0]],
    ]) assert.throws(() => __sweepPath([{ t: 'arc', a, m, b }]), { name: 'Error', message: 'An arc in the path is too flat or too small to build: redraw it' });
    const wire = __sweepPath([{ t: 'arc', a: [0,0,0], m: [1,1,0], b: [2,0,0] }]);
    wire.delete();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
