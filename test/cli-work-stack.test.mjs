import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { mergeItem, mergePullRequest, publishItem } from '../src/cli/work/controls.mjs';
import { offerFor } from '../src/cli/work/patterns.mjs';
import { refreshThenMerge } from '../src/cli/work/refresh.mjs';
import { landingList, readyItems } from '../src/cli/work/reads.mjs';
import { recordMachines } from '../src/cli/work/machines.mjs';
import { chooseProject, fileItem, readItems, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { recordReadiness, setYolo } from '../src/cli/work/yolo.mjs';
import { yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { branched, commit, git, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-stack-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  recordMachines(root, 'api', { machines: [] }, { tlc: true, now: NOW });
  writeMode(root, { enabled: true });
  return { base, root, checkout };
}

/** A branch built on `under`, or on main when there is none, with one commit of its own. */
function layer(h, name, under = 'main') {
  git(h.checkout, 'switch', '-qc', name, under);
  commit(h.checkout, `${name.replaceAll('/', '-')}.txt`, `${name}\n`);
  git(h.checkout, 'switch', '-q', 'main');
}

function finished(h, branch, change = {}) {
  const { id } = fileItem(h.root, 'api', { key: branch, kind: 'fix', title: `Layer ${branch}`, brief: 'Evidence and first change.' }, NOW);
  return updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'It passes.', ...change }, NOW);
}

const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });
const row = (h, { id }) => readyItems(h.root).find(({ item }) => item === id);
const read = (h, { id }) => readItems(h.root, 'api').find(item => item.id === id);
const tipOf = (h, name) => git(h.checkout, 'rev-parse', name);
const onMain = (h, file) => git(h.checkout, 'ls-tree', '-r', '--name-only', 'main').split('\n').includes(file);

/** Three finished branches, each built on the one before. */
function chain(h, change = {}) {
  layer(h, 'hobkin/one');
  layer(h, 'hobkin/two', 'hobkin/one');
  layer(h, 'hobkin/three', 'hobkin/two');
  return ['hobkin/one', 'hobkin/two', 'hobkin/three'].map(name => finished(h, name, change));
}

const placeOf = (h, item) => row(h, item).stack;

test('finished branches built one on the other are layers of one stack, counted from the bottom and named by it', async t => {
  const h = workspace(t);
  const [one, two, three] = chain(h);
  updateItem(h.root, 'api', one.id, { stack: 'The split of the big change' }, NOW);
  await survey(h);

  assert.deepEqual(placeOf(h, one), { id: one.id, layer: 1, of: 3, name: 'The split of the big change', below: null, base: null });
  assert.deepEqual(placeOf(h, two), { id: one.id, layer: 2, of: 3, name: 'The split of the big change', below: one.id, base: tipOf(h, 'hobkin/one') });
  assert.deepEqual(placeOf(h, three), { id: one.id, layer: 3, of: 3, name: 'The split of the big change', below: two.id, base: tipOf(h, 'hobkin/two') });
});

test('a finished branch with nothing under or over it is in no stack', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/alone');
  const alone = finished(h, 'hobkin/alone', { stack: 'Said, though it is alone' });
  await survey(h);

  assert.equal(row(h, alone).stack, null);
  assert.equal(row(h, alone).gap, 'land');
});

test('the name given when a layer is registered is on every layer, and an agent cannot set it afterwards', async t => {
  const h = workspace(t);
  layer(h, 'hobkin/one');
  layer(h, 'hobkin/two', 'hobkin/one');
  const adopt = (branch, extra = {}) => runWorkCommand(h.root, ['item', 'api'], Readable.from([JSON.stringify({ title: `Layer ${branch}`, branch, summary: 'A part.', proof: 'It passes.', ...extra })]));
  const one = await adopt('hobkin/one', { stack: '  Split\nof the big change  ' });
  const two = await adopt('hobkin/two');
  await survey(h);

  assert.equal(read(h, { id: one.id }).stack, 'Split of the big change', 'one line, trimmed');
  assert.deepEqual([placeOf(h, one).name, placeOf(h, two).name], ['Split of the big change', 'Split of the big change']);

  await runWorkCommand(h.root, ['item', 'api'], Readable.from([JSON.stringify({ id: two.id, stack: 'Another name' })]));
  assert.equal(read(h, { id: two.id }).stack ?? null, null);
  assert.equal(placeOf(h, two).name, 'Split of the big change');
});

test('branches built on one base each count the layers under their own line, and the stack counts every branch', async t => {
  const h = workspace(t);
  layer(h, 'hobkin/base');
  layer(h, 'hobkin/left', 'hobkin/base');
  layer(h, 'hobkin/right', 'hobkin/base');
  const [base, left, right] = ['hobkin/base', 'hobkin/left', 'hobkin/right'].map(name => finished(h, name));
  await survey(h);

  assert.deepEqual([base, left, right].map(item => placeOf(h, item).layer), [1, 2, 2]);
  assert.deepEqual([base, left, right].map(item => placeOf(h, item).of), [3, 3, 3]);
  assert.deepEqual([left, right].map(item => placeOf(h, item).below), [base.id, base.id]);
  assert.equal(placeOf(h, left).id, base.id);
});
