import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { chooseProject, fileItem, readItems, readMode, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { readinessOf, readYolo, recordReadiness, setYolo, yoloView } from '../src/cli/work/yolo.mjs';
import { branched, git, repository } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const READY_KEY = 'yolo:ready';

const scored = (numbers = {}) => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback']
  .map(name => [name, { score: numbers[name] ?? 10, evidence: `What the review saw of ${name}.` }]));

const allReady = (change = {}) => ({
  tests: { ready: true, how: 'node --test runs 40 tests in 3 s.' },
  visibility: { ready: true, how: 'A failing run shows in the error report.' },
  rollback: { ready: true, how: 'bin/deploy rollback takes the last release back.' },
  deploy: { ready: true, how: 'bin/deploy from main, undone by bin/deploy rollback.' },
  ...change,
});

function workspace(t, projects = ['api']) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-yolo-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkouts = Object.fromEntries(projects.map(name => [name, repository(base, name)]));
  for (const name of projects) chooseProject(root, checkouts[name], 'important', NOW);
  writeMode(root, { enabled: true });
  return { base, root, checkouts };
}

const itemsOf = (h, slug = 'api') => readItems(h.root, slug);
const readinessItem = (h, slug = 'api') => itemsOf(h, slug).find(({ key }) => key === READY_KEY);

/** Finished work on a branch of its own, reviewed at its head with these scores. */
function finished(h, title, { slug = 'api', kind = 'bug-fix', numbers, item = {} } = {}) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkouts[slug], branch);
  const head = git(h.checkouts[slug], 'rev-parse', branch);
  const { id } = fileItem(h.root, slug, { key: title, kind: 'fix', title, brief: 'Evidence and first change.', ...item }, NOW);
  updateItem(h.root, slug, id, { state: 'branch', branch, proof: 'The spec passes.', review: { kind, scores: scored(numbers), head } }, NOW);
  return { id, branch, head };
}

test('turning it on files a readiness feature on each project and merges nothing', t => {
  const h = workspace(t, ['api', 'web']);
  const waiting = finished(h, 'Fix login');
  assert.deepEqual(readYolo(h.root), { on: false, rate: 8 }, 'a new home has it off');

  const turned = setYolo(h.root, { on: true }, NOW);

  assert.deepEqual([turned.on, turned.rate, turned.filed.length], [true, 8, 2]);
  assert.deepEqual(readMode(h.root).yolo, { on: true, rate: 8 });
  for (const slug of ['api', 'web']) {
    const { kind, title, state } = readinessItem(h, slug);
    assert.deepEqual([kind, title, state], ['feature', `Get ${slug} ready for YOLO mode`, 'open']);
  }
  assert.equal(itemsOf(h).find(({ id }) => id === waiting.id).state, 'branch');
  assert.equal(setYolo(h.root, { on: true }, NOW).filed.length, 0, 'a project is asked once');
});

test('a project is ready only once every part is in place and its readiness item has landed', t => {
  const h = workspace(t, ['api', 'web']);
  setYolo(h.root, { on: true }, NOW);
  const { id } = readinessItem(h);

  assert.throws(() => recordReadiness(h.root, 'api', allReady(), NOW), /Only the run of this project's readiness item records it/);
  assert.deepEqual(readinessOf(h.root, 'api').needs, ['Its readiness has not been checked yet.']);

  updateItem(h.root, 'api', id, { state: 'doing' }, NOW);
  assert.throws(() => recordReadiness(h.root, 'api', allReady({ tests: { ready: true } }), NOW), /tests needs ready: true with how it works/);
  recordReadiness(h.root, 'api', allReady({ visibility: { ready: false, missing: 'No error report hobkin can read.' } }), NOW);
  assert.deepEqual(
    [readinessOf(h.root, 'api').ready, readinessOf(h.root, 'api').needs],
    [false, ['Visibility: No error report hobkin can read.']],
  );

  recordReadiness(h.root, 'api', allReady(), NOW);
  assert.deepEqual([readinessOf(h.root, 'api').ready, readinessOf(h.root, 'api').needs], [false, ['Its readiness work is still under way.']]);

  updateItem(h.root, 'api', id, { state: 'branch', branch: 'hobkin/ready' }, NOW);
  assert.deepEqual([readinessOf(h.root, 'api').ready, readinessOf(h.root, 'api').needs], [false, ['Its readiness work waits for your yes.']]);

  updateItem(h.root, 'api', id, { state: 'merged' }, NOW);
  assert.deepEqual([readinessOf(h.root, 'api').ready, readinessOf(h.root, 'api').needs], [true, []]);

  const view = yoloView(h.root);
  assert.deepEqual([view.on, view.rate, view.ready, view.projects.length], [true, 8, 1, 2]);
  assert.deepEqual(view.projects.map(({ slug, ready }) => [slug, ready]), [['api', true], ['web', false]]);
});

test('no hobkin work command changes YOLO mode, and a rate outside 6 to 10 is refused', async t => {
  const h = workspace(t);

  await assert.rejects(runWorkCommand(h.root, ['yolo', 'on']), /Unknown project: on/);
  assert.equal(readYolo(h.root).on, false);
  const view = await runWorkCommand(h.root, ['yolo']);
  assert.deepEqual([view.on, view.rate, view.ready], [false, 8, 0]);

  for (const rate of [5, 11, 7.5, '8']) assert.throws(() => setYolo(h.root, { on: true, rate }, NOW), /a whole number from 6 to 10/);
  assert.throws(() => setYolo(h.root, { on: 'yes' }, NOW), /on or off/);
  assert.equal(readMode(h.root).yolo, undefined, 'a refused change writes nothing');

  assert.deepEqual(setYolo(h.root, { rate: 9 }, NOW), { on: false, rate: 9, filed: [] });
  assert.equal(readinessItem(h), undefined, 'a rate alone files nothing');
});
