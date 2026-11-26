import assert from 'node:assert/strict';
import { test } from 'node:test';
import { updateItem } from '../src/cli/work/store.mjs';
import { holdOf } from '../src/cli/work/yolo-pass.mjs';
import { holdProject, readinessOf, recordReadiness } from '../src/cli/work/yolo.mjs';
import { setYoloRules } from '../src/cli/work/yolo-rules.mjs';
import { allReady, brokenRun, makeReady, NOW, readinessItem, survey, withSpec, workspace, writeRun } from './helpers/yolo-fixture.mjs';
import { git } from './helpers/work-fixture.mjs';

const stepOf = name => ({ user: { title: `Take the ${name} step`, step: `Do what the ${name} part needs, in the project's own files.` } });
const record = (h, parts) => {
  const { id } = readinessItem(h);
  updateItem(h.root, 'api', id, { state: 'doing' }, NOW);
  recordReadiness(h.root, 'api', parts, NOW);
  updateItem(h.root, 'api', id, { state: 'merged' }, NOW);
};
const holding = h => {
  const { ready, holds } = readinessOf(h.root, 'api');
  return [ready, holds];
};

test('each project switch lets go of its own hold only, and a held change names the setting that holds it', async t => {
  const h = workspace(t);
  makeReady(h, 'api', allReady({ tests: stepOf('tests'), rollback: stepOf('rollback') }));
  assert.deepEqual(holding(h), [false, ['testsPass', 'wayBackKnown']]);

  const asked = () => {
    const { ready, holds } = readinessOf(h.root, 'api');
    const yolo = { on: true, rate: 8 };
    return holdOf({ yolo, on: true, project: {}, readiness: { ready, holds }, landable: true, row: { holds: 0 }, item: { state: 'branch' } });
  };
  assert.deepEqual(asked(), { why: 'its project is not ready for YOLO mode', setting: 'testsPass' });

  setYoloRules(h.root, null, { testsPass: false });
  assert.deepEqual(holding(h), [false, ['wayBackKnown']]);
  assert.equal(asked().setting, 'wayBackKnown');
  setYoloRules(h.root, null, { wayBackKnown: false });
  assert.deepEqual(holding(h), [true, []]);
  setYoloRules(h.root, null, { testsPass: true, wayBackKnown: true });
  assert.deepEqual(holding(h), [false, ['testsPass', 'wayBackKnown']]);
  setYoloRules(h.root, 'api', { wayBackKnown: false });
  assert.deepEqual(holding(h), [false, ['testsPass']], 'a project\'s own switch lets go of its own hold');

  record(h, allReady());
  assert.deepEqual(holding(h), [true, []]);
  holdProject(h.root, 'api', { item: 'x', title: 'Fix login' }, NOW);
  assert.deepEqual(holding(h), [false, ['holdAfterRegression']]);
  assert.match(readinessOf(h.root, 'api').needs[0], /A regression showed after "Fix login"/);
  setYoloRules(h.root, null, { testsPass: false, noModelBreaks: false });
  assert.deepEqual(holding(h), [false, ['holdAfterRegression']], 'the other switches do not lift a regression hold');
  setYoloRules(h.root, null, { holdAfterRegression: false });
  assert.deepEqual(holding(h), [true, []]);
});

test('a model broken on the default branch is held by its own switch alone', async t => {
  const h = workspace(t);
  makeReady(h);
  withSpec(h);
  await survey(h);
  writeRun(h, 'main-broke', { head: git(h.checkouts.api, 'rev-parse', 'main'), ...brokenRun });
  assert.deepEqual(holding(h), [false, ['noModelBreaks']]);
  setYoloRules(h.root, null, { testsPass: false, wayBackKnown: false, holdAfterRegression: false });
  assert.deepEqual(holding(h), [false, ['noModelBreaks']]);
  setYoloRules(h.root, null, { noModelBreaks: false });
  assert.deepEqual(holding(h), [true, []]);
  assert.equal(readinessOf(h.root, 'api').parts.models.blocks, true, 'the part still says it breaks, and the switch is what lets go');
});
