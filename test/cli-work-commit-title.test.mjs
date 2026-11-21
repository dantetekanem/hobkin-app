import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitTitle } from '../src/cli/work/unmerged.mjs';

test("a branch's title is its commit's summary, never the attribution line or markup before it", () => {
  const message = '**[made by hobkin · v0.1.6]**\n\nBring the release test gate and query monitoring onto current main\n\n<details><summary>Agent extra information</summary>\n\nMore.\n</details>\n';
  assert.equal(commitTitle(message), 'Bring the release test gate and query monitoring onto current main');
  assert.equal(commitTitle('[made by hobkin · v0.1.7]\n# Fix the cart total\n'), 'Fix the cart total');
  assert.equal(commitTitle('Plain subject\n\nBody'), 'Plain subject');
  assert.equal(commitTitle('**[made by hobkin · v0.1.6]**\n\n<details><summary>x</summary></details>\n'), '');
  assert.equal(commitTitle(''), '');
});
