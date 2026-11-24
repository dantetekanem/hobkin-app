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
  assert.deepEqual([one, two, three].map(item => row(h, item).gap), ['land', 'stacked', 'stacked']);
});

test('a finished branch with nothing under or over it is in no stack', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/alone');
  const alone = finished(h, 'hobkin/alone', { stack: 'Said, though it is alone' });
  await survey(h);

  assert.equal(row(h, alone).stack, null);
  assert.equal(row(h, alone).gap, 'land');
});

test('the bottom layer merges alone, and the layer above it is then the bottom of what is left', async t => {
  const h = workspace(t);
  const [one, two, three] = chain(h);
  await survey(h);

  await mergeItem(h.root, 'api', one.id, { now: NOW });

  assert.equal(read(h, one).state, 'merged');
  assert.deepEqual([read(h, two).state, read(h, three).state], ['branch', 'branch'], 'nothing above came along');
  assert.deepEqual([onMain(h, 'hobkin-one.txt'), onMain(h, 'hobkin-two.txt')], [true, false]);

  await survey(h);

  assert.deepEqual(placeOf(h, two), { id: two.id, layer: 1, of: 2, name: null, below: null, base: null });
  assert.equal(placeOf(h, three).layer, 2);
  assert.deepEqual([row(h, two).gap, row(h, three).gap], ['land', 'stacked']);
});

test('a merge, a publish and a refresh of a layer with one under it are refused, naming the layer that lands first', async t => {
  const h = workspace(t);
  const [one, two] = chain(h);
  await survey(h);
  const first = `"${one.title}" lands first: it is the layer under this one.`;

  await assert.rejects(mergeItem(h.root, 'api', two.id, { now: NOW }), error => error.message.includes(first));
  await assert.rejects(publishItem(h.root, 'api', two.id, { gh: async () => assert.fail('no host is asked'), now: NOW }), error => error.message.includes(first));
  await assert.rejects(async () => refreshThenMerge(h.root, 'api', two.id, { now: NOW }), error => error.message.includes(first));
  updateItem(h.root, 'api', two.id, { state: 'pr', pr: 'https://example.invalid/pull/2' }, NOW);
  await assert.rejects(mergePullRequest(h.root, 'api', two.id, { gh: async () => assert.fail('no host is asked'), now: NOW }), error => error.message.includes(first));

  assert.equal(onMain(h, 'hobkin-two.txt'), false);
});

test('a layer above is left out of the landing list and never offered, and says it lands after the layer under it', async t => {
  const h = workspace(t);
  const [, two] = chain(h);
  await survey(h);

  const { leftOut } = landingList(h.root);

  assert.equal(leftOut.find(({ item }) => item === two.id).why, 'it lands after the layer under it');
  const offer = offerFor({ slug: 'api', item: read(h, two), unit: {}, gap: 'stacked', records: new Map() });
  assert.equal(offer.offerable, false);
  assert.ok(offer.why.some(words => /layer under it/.test(words)), offer.why.join('; '));
});

const scored = Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback'].map(name => [name, { score: 10, evidence: `Saw ${name}.` }]));
const allReady = Object.fromEntries(['tests', 'errors', 'slowQueries', 'performance', 'logs', 'alerts', 'rollback', 'deploy'].map(part => [part, { ready: true, how: `${part} is in place.` }]));

test('YOLO mode merges the bottom layer and asks about the layers above it, one pass at a time', async t => {
  const h = workspace(t);
  setYolo(h.root, { on: true }, NOW);
  const readiness = readItems(h.root, 'api').find(({ key }) => key === 'yolo:ready');
  updateItem(h.root, 'api', readiness.id, { state: 'doing' }, NOW);
  recordReadiness(h.root, 'api', allReady, NOW);
  updateItem(h.root, 'api', readiness.id, { state: 'merged' }, NOW);
  const [one, two] = chain(h);
  for (const item of [one, two]) updateItem(h.root, 'api', item.id, { review: { kind: 'bug-fix', scores: scored, head: tipOf(h, item.branch) } }, NOW);
  await survey(h);

  const reports = await yoloPass(h.root, { now: NOW });

  assert.equal(reports.length, 1);
  assert.deepEqual([read(h, one).state, read(h, two).state], ['merged', 'branch']);

  await survey(h);
  await yoloPass(h.root, { now: NOW });

  assert.equal(read(h, two).state, 'merged');
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
