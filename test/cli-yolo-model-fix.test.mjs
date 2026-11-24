import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recheckModels } from '../src/cli/work/proof-checks.mjs';
import { askedOf, holdOf, landingReasons, waitingToMerge, yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { readYolo } from '../src/cli/work/yolo.mjs';
import { setYoloRules } from '../src/cli/work/yolo-rules.mjs';
import { readUnmerged } from '../src/cli/work/unmerged.mjs';
import { git } from './helpers/work-fixture.mjs';
import { brokenRun, finished, makeReady, modeledChange, NOW, SPEC, stateOf, survey, withSpec, workspace, writeRun } from './helpers/yolo-fixture.mjs';

const fakeSpawn = started => () => {
  started.push(true);
  return { pid: process.pid, on() {}, unref() {} };
};
// What the pass itself says of each waiting change, with the project's readiness as it stands.
function asked(h) {
  const yolo = readYolo(h.root);
  const landing = landingReasons(h.root);
  return Object.fromEntries(waitingToMerge(h.root, NOW).map(({ row, item, unit }) => {
    const { asked: found, models } = askedOf(h.root, { yolo, landing, row, item, unit });
    const held = holdOf({ ...found, models });
    return [item.title, { why: held?.why ?? null, setting: held?.setting ?? null }];
  }));
}

test('a broken model holds every change with the switch off; with it on a change that makes it hold merges, one that does not touch it asks and names it, and the broken specs are checked again after the merge', async t => {
  const h = workspace(t);
  withSpec(h);
  writeRun(h, 'main-broke', { head: git(h.checkouts.api, 'rev-parse', 'main'), ...brokenRun });
  makeReady(h);
  const fix = modeledChange(h, 'Fix merge');
  const other = finished(h, 'Fix login');
  await survey(h);
  writeRun(h, 'fix-holds', { head: fix.head, item: fix.id });

  // Off: the project is held and every change names the model and the setting.
  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);
  assert.deepEqual(asked(h), {
    'Fix merge': { why: 'its project is not ready for YOLO mode: WorkItem.tla breaks on the default branch', setting: 'noModelBreaks' },
    'Fix login': { why: 'its project is not ready for YOLO mode: WorkItem.tla breaks on the default branch', setting: 'noModelBreaks' },
  });

  // On: only the change that makes the model hold goes.
  setYoloRules(h.root, null, { brokenModelFixMayMerge: true });
  assert.deepEqual(asked(h), {
    'Fix merge': { why: null, setting: null },
    'Fix login': { why: 'WorkItem.tla breaks on the default branch, and this change does not make it hold', setting: 'brokenModelFixMayMerge' },
  });
  const before = await survey(h).then(() => readUnmerged(h.root).projects.api.models.head);
  const started = [];
  assert.equal(await recheckModels(h.root, { now: NOW, survey: readUnmerged(h.root).projects, spawn: fakeSpawn(started) }), null, 'the week has not passed');

  const reports = await yoloPass(h.root, { now: NOW });
  assert.deepEqual(reports.map(({ item }) => item), [fix.id]);
  assert.deepEqual([stateOf(h, fix), stateOf(h, other)], ['merged', 'branch']);

  // The default branch moved, and the broken spec is checked at once, not after the week.
  await survey(h);
  const moved = readUnmerged(h.root).projects;
  assert.notEqual(moved.api.models.head, before);
  const check = await recheckModels(h.root, { now: NOW, survey: moved, spawn: fakeSpawn(started) });
  assert.equal(check?.spec, SPEC);
  assert.equal(check.head, moved.api.models.head);
  assert.equal(started.length, 1);
  assert.equal(await recheckModels(h.root, { now: NOW, survey: moved, spawn: fakeSpawn(started) }), null, 'asked once');
});

test('with the broken-model hold off, no change asks about it', async t => {
  const h = workspace(t);
  withSpec(h);
  writeRun(h, 'main-broke', { head: git(h.checkouts.api, 'rev-parse', 'main'), ...brokenRun });
  makeReady(h);
  finished(h, 'Fix login');
  await survey(h);
  setYoloRules(h.root, null, { noModelBreaks: false });
  assert.deepEqual(asked(h), { 'Fix login': { why: null, setting: null } });
});
