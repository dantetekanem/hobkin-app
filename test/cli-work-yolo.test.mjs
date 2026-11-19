import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { clientNoticesToPost } from '../src/cli/client-notices.mjs';
import { initialize } from '../src/cli/config.mjs';
import { surveyAndClose } from '../src/cli/work/closing.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { chooseProject, fileItem, prFile, readItems, readMode, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { readinessOf, readYolo, recordReadiness, setYolo, yoloView } from '../src/cli/work/yolo.mjs';
import { branched, commit, git, repository } from './helpers/work-fixture.mjs';

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

/** A project the user's yes made ready: every part recorded as in place, and the readiness work merged. */
function makeReady(h, slug = 'api', parts = allReady()) {
  setYolo(h.root, { on: true }, NOW);
  const { id } = readinessItem(h, slug);
  updateItem(h.root, slug, id, { state: 'doing' }, NOW);
  recordReadiness(h.root, slug, parts, NOW);
  updateItem(h.root, slug, id, { state: 'merged' }, NOW);
}

const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });
const stateOf = (h, { id }, slug = 'api') => itemsOf(h, slug).find(item => item.id === id).state;
const ledger = h => (existsSync(join(h.root, 'work', 'yolo.jsonl')) ? readFileSync(join(h.root, 'work', 'yolo.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []);
const onMain = (h, { head }, slug = 'api') => git(h.checkouts[slug], 'branch', '--contains', head, '--format=%(refname:short)').split('\n').includes('main');

test('with YOLO mode off nothing merges by itself', async t => {
  const h = workspace(t);
  makeReady(h);
  setYolo(h.root, { on: false }, NOW);
  const perfect = finished(h, 'Fix login');
  await survey(h);

  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);

  assert.equal(stateOf(h, perfect), 'branch');
  assert.equal(onMain(h, perfect), false);
  assert.deepEqual(ledger(h), []);
});

test('a project that is not ready never merges by itself, even at rate 10', async t => {
  const h = workspace(t, ['api', 'web']);
  setYolo(h.root, { on: true, rate: 6 }, NOW);
  // api: every part is in place, and its readiness work still waits for the user's yes.
  updateItem(h.root, 'api', readinessItem(h, 'api').id, { state: 'doing' }, NOW);
  recordReadiness(h.root, 'api', allReady(), NOW);
  updateItem(h.root, 'api', readinessItem(h, 'api').id, { state: 'branch', branch: 'hobkin/ready' }, NOW);
  // web: its readiness work landed, and one part is still missing.
  updateItem(h.root, 'web', readinessItem(h, 'web').id, { state: 'doing' }, NOW);
  recordReadiness(h.root, 'web', allReady({ deploy: { ready: false, missing: 'No way to take a deploy back.' } }), NOW);
  updateItem(h.root, 'web', readinessItem(h, 'web').id, { state: 'merged' }, NOW);
  const onApi = finished(h, 'Fix login');
  const onWeb = finished(h, 'Fix signup', { slug: 'web' });
  await survey(h);

  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);

  assert.deepEqual([stateOf(h, onApi), stateOf(h, onWeb, 'web')], ['branch', 'branch']);
  assert.deepEqual([onMain(h, onApi), onMain(h, onWeb, 'web')], [false, false]);
});

test('on a ready project a small change at the user\'s rate merges by itself at its scored commit', async t => {
  const h = workspace(t);
  makeReady(h);
  const good = finished(h, 'Fix login', { numbers: { coverage: 8, proof: 8, safety: 9, visibility: 8, rollback: 9 } });
  const alsoGood = finished(h, 'Speed up search', { kind: 'performance' });
  const underRate = finished(h, 'Fix logout', { numbers: { coverage: 7, proof: 7, safety: 9, visibility: 7, rollback: 9 } });
  const unsafe = finished(h, 'Fix totals', { numbers: { safety: 7 } });
  await survey(h);

  const [first, ...rest] = await yoloPass(h.root, { now: NOW });

  assert.deepEqual(rest, [], 'one change a project in a pass');
  const merged = [good, alsoGood].filter(change => stateOf(h, change) === 'merged');
  assert.equal(merged.length, 1);
  assert.equal(first.head, merged[0].head);
  assert.equal(itemsOf(h).find(({ id }) => id === merged[0].id).landed.route, 'yolo');
  assert.equal(onMain(h, merged[0]), true);

  await survey(h);
  await yoloPass(h.root, { now: NOW });

  assert.deepEqual([good, alsoGood, underRate, unsafe].map(change => stateOf(h, change)), ['merged', 'merged', 'branch', 'branch']);
  assert.deepEqual([onMain(h, underRate), onMain(h, unsafe)], [false, false]);
});

test('scores for an older commit never count', async t => {
  const h = workspace(t);
  makeReady(h);
  const movedBeforeTheSurvey = finished(h, 'Fix login');
  const movedAfterTheSurvey = finished(h, 'Fix logout');
  const moveOn = ({ branch }) => {
    git(h.checkouts.api, 'switch', '-q', branch);
    commit(h.checkouts.api, `${branch.replaceAll('/', '-')}-more.txt`, 'more\n');
    git(h.checkouts.api, 'switch', '-q', 'main');
  };
  moveOn(movedBeforeTheSurvey);
  await survey(h);
  moveOn(movedAfterTheSurvey);

  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);

  assert.deepEqual([stateOf(h, movedBeforeTheSurvey), stateOf(h, movedAfterTheSurvey)], ['branch', 'branch']);
  assert.deepEqual([onMain(h, movedBeforeTheSurvey), onMain(h, movedAfterTheSurvey)], [false, false]);
});

test('a feature or an unclear change never merges by itself', async t => {
  const h = workspace(t);
  makeReady(h);
  const feature = finished(h, 'Add exports', { kind: 'feature' });
  const unclear = finished(h, 'Rework billing', { kind: 'unclear' });
  const filedAsFeature = finished(h, 'Add imports', { kind: 'small-change', item: { kind: 'feature' } });
  await survey(h);

  assert.deepEqual(await yoloPass(h.root, { now: NOW }), []);

  assert.deepEqual([feature, unclear, filedAsFeature].map(change => stateOf(h, change)), ['branch', 'branch', 'branch']);
});

test('each merge by itself is reported in Chat and in the ledger, and its deploy is handed on', async t => {
  const h = workspace(t, ['api', 'lib']);
  makeReady(h);
  makeReady(h, 'lib', allReady({ deploy: { ready: true, how: 'Nothing deploys: other projects use it from source.', deploys: false } }));
  const onApi = finished(h, 'Fix login', { numbers: { coverage: 9, proof: 9, safety: 9, visibility: 8, rollback: 9 } });
  const onLib = finished(h, 'Bump parser', { slug: 'lib', kind: 'package-update' });
  await survey(h);
  const handed = [];

  const reports = await yoloPass(h.root, { now: NOW, handOff: job => handed.push(job) });

  assert.deepEqual(reports.map(({ slug, title, kind, rate, deploy }) => [slug, title, kind, rate, deploy]).sort(), [
    ['api', 'Fix login', 'bug-fix', 8.8, 'handed on'],
    ['lib', 'Bump parser', 'package-update', 10, 'nothing deploys'],
  ]);
  assert.deepEqual(ledger(h), reports);
  const api = reports.find(({ slug }) => slug === 'api');
  assert.deepEqual([api.item, api.head, api.at, api.scores.safety], [onApi.id, onApi.head, new Date(NOW).toISOString(), 9]);
  assert.equal(api.target, git(h.checkouts.api, 'rev-parse', 'main'));

  const lines = clientNoticesToPost(h.root).map(({ line }) => line);
  assert.ok(lines.includes(`YOLO mode merged "Fix login" on api by itself: a bug fix rated 8.8, at ${onApi.head.slice(0, 7)}. Its deploy is with the main agent.`), lines.join('\n'));
  assert.ok(lines.includes(`YOLO mode merged "Bump parser" on lib by itself: a package update rated 10, at ${onLib.head.slice(0, 7)}. Nothing deploys on this project.`), lines.join('\n'));

  assert.equal(handed.length, 1);
  const [job] = handed;
  assert.deepEqual([job.project, job.item, job.title, job.commit], ['api', onApi.id, 'Fix login', api.target]);
  assert.match(job.asked, /Deploy exactly that commit by the project's recorded path: bin\/deploy from main, undone by bin\/deploy rollback\./);
});

test('with YOLO mode on, a finished branch on a ready project gets its review by itself', async t => {
  const h = workspace(t, ['api', 'web']);
  makeReady(h);
  // Described and proved, with no scores yet, so a review is all each one lacks.
  const unscored = ({ slug, id }) => {
    mkdirSync(dirname(prFile(h.root, slug, id)), { recursive: true });
    writeFileSync(prFile(h.root, slug, id), 'What changed and why.\n');
    updateItem(h.root, slug, id, { review: null }, NOW);
  };
  const onReady = { slug: 'api', ...finished(h, 'Fix login') };
  const onUnready = { slug: 'web', ...finished(h, 'Fix signup', { slug: 'web' }) };
  [onReady, onUnready].forEach(unscored);

  await surveyAndClose(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });

  const asked = ({ slug, id }) => Boolean(itemsOf(h, slug).find(item => item.id === id).reviewAsked);
  assert.deepEqual([asked(onReady), asked(onUnready)], [true, false]);
});
