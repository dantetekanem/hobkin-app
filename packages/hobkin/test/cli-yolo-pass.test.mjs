import assert from 'node:assert/strict';
import { test } from 'node:test';
import { yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { setYoloRules } from '../src/cli/work/yolo-rules.mjs';
import { git } from './helpers/work-fixture.mjs';
import { finished, makeReady, NOW, stateOf, survey, workspace } from './helpers/yolo-fixture.mjs';

const onMain = (h, { head }) => git(h.checkouts.api, 'branch', '--contains', head, '--format=%(refname:short)').split('\n').includes('main');

test('two merges on one project in one pass when the user set two, each pinned to its commit, and one by default', async t => {
  const h = workspace(t);
  makeReady(h);
  const first = finished(h, 'Fix login');
  const second = finished(h, 'Fix logout', { kind: 'performance' });
  await survey(h);

  const byDefault = await yoloPass(h.root, { now: NOW });
  assert.equal(byDefault.length, 1, 'one change a project in a pass at the default');
  const [merged] = byDefault;
  assert.ok([first, second].some(change => change.head === merged.head));

  setYoloRules(h.root, null, { mergesAPass: 2 });
  const third = finished(h, 'Fix totals');
  const fourth = finished(h, 'Fix tax');
  await survey(h);
  const twice = await yoloPass(h.root, { now: NOW });

  assert.equal(twice.length, 2, 'two on the project in one pass');
  for (const report of twice) {
    const change = [first, second, third, fourth].find(({ head }) => head === report.head);
    assert.ok(change, 'each merge is at the head its change was rated at');
    assert.equal(onMain(h, change), true);
  }
  const merges = [first, second, third, fourth].filter(change => stateOf(h, change) === 'merged');
  assert.equal(merges.length, 3);
});
