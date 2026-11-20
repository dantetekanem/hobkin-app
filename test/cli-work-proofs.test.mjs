import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { workStatus } from '../src/cli/work/commands.mjs';
import { recheckModels } from '../src/cli/work/proof-checks.mjs';
import { modeledFiles } from '../src/cli/work/proofs.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, paths, readItems, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { recordReadiness, setYolo, yoloView } from '../src/cli/work/yolo.mjs';
import { branched, commit, git, repository, writeJson } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const WEEK = 7 * 24 * 3600000;
const SPEC = 'specs/tla/WorkItem.tla';
const QUEUE = 'specs/tla/ReviewQueue.tla';

const specText = (models = 'app.txt', name = 'WorkItem') => [
  `---- MODULE ${name} ----`,
  `\\* models: ${models}`,
  'VARIABLE state',
  '\\* words: An item starts queued.',
  'Init == state = "queued"',
  '\\* code: app.txt:1',
  'Merge == state\' = "merged"',
  'Next == Merge',
  '====',
  '',
].join('\n');
const sha256 = text => createHash('sha256').update(text).digest('hex');

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-proofs-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  writeMode(root, { enabled: true });
  return { base, root, checkout };
}

function withSpec(h, spec = SPEC, text = specText()) {
  mkdirSync(join(h.checkout, 'specs', 'tla'), { recursive: true });
  commit(h.checkout, spec, text);
}

/** Finished work on a branch of its own that changes `file`, reviewed at its head with every score at 10. */
function finished(h, title, { file = 'app.txt', text = `${title}\n` } = {}) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkout, branch, file, text);
  const head = git(h.checkout, 'rev-parse', branch);
  const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  const scores = Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback'].map(name => [name, { score: 10, evidence: `What the review saw of ${name}.` }]));
  updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'The spec passes.', review: { kind: 'bug-fix', scores, head } }, NOW);
  return { id, branch, head };
}

/** A run as `hobkin proof check` leaves it in `<home>/proofs/<id>/result.json`. */
function writeRun(h, change) {
  const run = {
    project: 'api',
    spec: SPEC,
    specSha256: sha256(specText()),
    tool: 'TLC 1.7.4',
    workers: 4,
    started: new Date(NOW - 120000).toISOString(),
    finished: new Date(NOW - 60000).toISOString(),
    outcome: 'holds',
    steps: [],
    stats: { generated: 120000, distinct: 48211, queue: 0, depth: 9 },
    rules: [{ name: 'TypeOK', kind: 'invariant', status: 'holds' }, { name: 'MergedAtReviewedHead', kind: 'invariant', status: 'holds' }],
    actions: [{ name: 'Merge', count: 3 }, { name: 'Decline', count: 2 }],
    ...change,
  };
  writeJson(join(h.root, 'proofs', run.id, 'result.json'), run);
  return run;
}

const broke = { outcome: 'broken', broken: 'MergedAtReviewedHead', traceLength: 5, rules: [{ name: 'TypeOK', kind: 'invariant', status: 'holds' }, { name: 'MergedAtReviewedHead', kind: 'invariant', status: 'broken' }] };
const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });
const rowOf = (h, { id }) => readyItems(h.root).find(row => row.item === id);

/** A spawn that starts nothing, keeping what hobkin asked for. `pid` stands for the child: the test's own process is one that is alive. */
function fakeSpawn(pid = 2 ** 22 + 1) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return { pid, unref() {}, on() {} };
  };
  return { spawn, calls };
}

test('a spec names the files it models in its models comments', () => {
  assert.deepEqual(modeledFiles(specText('src/items.mjs, src/yolo-pass.mjs')), ['src/items.mjs', 'src/yolo-pass.mjs']);
  assert.deepEqual(modeledFiles('\\* models: a.mjs\n\\*models:  ./b.mjs ,\nX == 1\n\\* code: c.mjs:3'), ['a.mjs', 'b.mjs']);
  assert.deepEqual(modeledFiles('---- MODULE Plain ----\n===='), []);
});

test('a run covers a change whose files its spec models, and counts only when it held with every action fired at the change\'s head and spec', async t => {
  const h = workspace(t);
  withSpec(h);
  const modeled = finished(h, 'Fix merge');
  const elsewhere = finished(h, 'Fix docs', { file: 'docs.txt' });
  const remodeled = finished(h, 'Model the queue', { file: SPEC, text: specText('app.txt, queue.txt') });
  await survey(h);

  assert.deepEqual(rowOf(h, modeled).models, [{ spec: SPEC, state: 'unchecked', changed: false }]);
  assert.equal(rowOf(h, elsewhere).models, undefined, 'a change to a file no spec models has no model');
  assert.deepEqual(rowOf(h, remodeled).models, [{ spec: SPEC, state: 'unchecked', changed: true }], 'a change to the spec itself is covered by it');

  // A run of another commit, or of a spec that is not the one at the change's head, is not evidence for it.
  writeRun(h, { id: 'older-head', head: 'b'.repeat(40) });
  writeRun(h, { id: 'edited-spec', head: modeled.head, specSha256: sha256('an edit never committed') });
  writeRun(h, { id: 'other-project', head: modeled.head, project: 'web' });
  assert.equal(rowOf(h, modeled).models[0].state, 'unchecked');

  // A model that never reached an action checks nothing that action guards.
  writeRun(h, { id: 'unfired', head: modeled.head, actions: [{ name: 'Merge', count: 3 }, { name: 'Decline', count: 0 }] });
  assert.deepEqual(rowOf(h, modeled).models, [{
    spec: SPEC, state: 'unproven', changed: false, run: 'unfired', why: 'Decline never fired',
    line: `TLC: 2 of 2 hold in 48,211 states, but Decline never fired · at ${modeled.head.slice(0, 7)}`,
  }]);

  writeRun(h, { id: 'held', head: modeled.head, proof: { strict: true, obligations: [{ id: '<1>1', label: 'Init', status: 'proved', depth: 1 }, { id: '<1>2', label: 'Next', status: 'proved', depth: 1 }] } });
  assert.deepEqual(rowOf(h, modeled).models, [{
    spec: SPEC, state: 'holds', changed: false, run: 'held',
    line: `TLC: 2 of 2 hold in 48,211 states · TLAPS: 2 of 2, strict · at ${modeled.head.slice(0, 7)}`,
  }]);

  // A model that broke at that head outweighs one that held there.
  writeRun(h, { id: 'broke', head: modeled.head, ...broke });
  assert.deepEqual(rowOf(h, modeled).models, [{
    spec: SPEC, state: 'broken', changed: false, run: 'broke', why: 'MergedAtReviewedHead',
    line: `TLC: MergedAtReviewedHead breaks in 5 steps · at ${modeled.head.slice(0, 7)}`,
  }]);
});

/** A project with every readiness part in place, its readiness work merged, and its spec holding on the default branch. */
async function readyWithModel(h) {
  withSpec(h);
  writeRun(h, { id: 'main', head: git(h.checkout, 'rev-parse', 'main') });
  setYolo(h.root, { on: true }, NOW);
  const { id } = readItems(h.root, 'api').find(({ key }) => key === 'yolo:ready');
  updateItem(h.root, 'api', id, { state: 'doing' }, NOW);
  const part = { ready: true, how: 'In place.' };
  recordReadiness(h.root, 'api', Object.fromEntries(['tests', 'errors', 'slowQueries', 'performance', 'logs', 'alerts', 'rollback', 'deploy'].map(name => [name, part])), NOW);
  updateItem(h.root, 'api', id, { state: 'merged' }, NOW);
}

test('hobkin checks an unchanged model at a change\'s new head itself, once, and only for a change heading to a YOLO merge', async t => {
  const h = workspace(t);
  await readyWithModel(h);
  const modeled = finished(h, 'Fix merge');
  const remodeled = finished(h, 'Model the queue', { file: SPEC, text: specText('app.txt, queue.txt') });
  await survey(h);
  const { spawn, calls } = fakeSpawn();

  assert.deepEqual(await yoloPass(h.root, { now: NOW, spawn }), [], 'nothing merges before its model is checked at its head');

  assert.equal(calls.length, 1, 'a change whose spec changed has its own run to cite, so hobkin starts none for it');
  const [{ command, args, cwd }] = calls;
  assert.equal(command, process.execPath);
  assert.deepEqual(args.slice(1), ['proof', 'check', SPEC, '--project', 'api', '--item', modeled.id, '--head', modeled.head, '--home', h.root]);
  assert.equal(cwd, join(paths(h.root, 'api').trees, 'proof'));
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), modeled.head, 'the check runs in a tree at that very commit');
  assert.equal(readFileSync(join(cwd, SPEC), 'utf8'), specText());
  assert.deepEqual([rowOf(h, modeled).models[0].state, rowOf(h, remodeled).models[0].state], ['unchecked', 'unchecked']);

  await yoloPass(h.root, { now: NOW + 60000, spawn });
  assert.equal(calls.length, 1, 'a check hobkin tried is not started again for the same commit');

  writeRun(h, { id: 'rerun', head: modeled.head, item: modeled.id });
  const [merged] = await yoloPass(h.root, { now: NOW + 120000, spawn });
  assert.deepEqual([merged.item, merged.head], [modeled.id, modeled.head]);
});

test('hobkin checks nothing while YOLO mode is off, and one check at a time', async t => {
  const h = workspace(t);
  await readyWithModel(h);
  const first = finished(h, 'Fix merge');
  const second = finished(h, 'Fix merge again', { text: 'again\n' });
  await survey(h);
  setYolo(h.root, { on: false }, NOW);
  const { spawn, calls } = fakeSpawn(process.pid);

  await yoloPass(h.root, { now: NOW, spawn });
  assert.equal(calls.length, 0);

  setYolo(h.root, { on: true }, NOW);
  await yoloPass(h.root, { now: NOW, spawn });
  assert.equal(calls.length, 1, 'one check at a time, while the first is going');
  await yoloPass(h.root, { now: NOW + 60000, spawn });
  assert.equal(calls.length, 1);

  // TLC stops itself after 20 minutes, so a check older than that is over, whatever its process id says now.
  await yoloPass(h.root, { now: NOW + 26 * 60000, spawn });
  assert.deepEqual(calls.map(({ args }) => args[7]).sort(), [first.id, second.id].sort());
});

test('hobkin checks each model on the default branch itself once a week, and one that breaks there shows on its project', async t => {
  const h = workspace(t);
  withSpec(h);
  withSpec(h, QUEUE, specText('queue.txt', 'ReviewQueue'));
  const tip = git(h.checkout, 'rev-parse', 'main');
  await survey(h);
  const { spawn, calls } = fakeSpawn();
  const recheck = now => recheckModels(h.root, { now, survey: readUnmerged(h.root).projects, spawn });

  await recheck(NOW);
  assert.deepEqual(calls.map(({ args }) => args.slice(1)), [['proof', 'check', QUEUE, '--project', 'api', '--head', tip, '--home', h.root]]);
  assert.equal(git(calls[0].cwd, 'rev-parse', 'HEAD'), tip);

  await recheck(NOW + 60000);
  assert.deepEqual(calls.map(({ args }) => args[3]), [QUEUE, SPEC], 'one check a pass, each spec in turn');
  await recheck(NOW + 120000);
  assert.equal(calls.length, 2, 'a spec tried this week is not tried again');

  writeRun(h, { id: 'item-held', head: tip, finished: new Date(NOW).toISOString() });
  writeRun(h, { id: 'queue-broke', head: tip, spec: QUEUE, specSha256: sha256(specText('queue.txt', 'ReviewQueue')), finished: new Date(NOW).toISOString(), ...broke });
  const [project] = workStatus(h.root).projects;
  assert.deepEqual(project.models.map(({ spec, state, run, why }) => [spec, state, run, why]), [
    [QUEUE, 'broken', 'queue-broke', 'MergedAtReviewedHead'],
    [SPEC, 'holds', 'item-held', undefined],
  ]);
  assert.deepEqual(yoloView(h.root).projects[0].models, project.models);

  await recheck(NOW + WEEK - 1);
  assert.equal(calls.length, 2);
  await recheck(NOW + WEEK + 60000);
  assert.equal(calls.length, 3, 'a week on, each model is checked again');

  writeMode(h.root, { enabled: false });
  await recheck(NOW + 2 * WEEK + 60000);
  assert.equal(calls.length, 3, 'nothing is checked while work mode is off');
});
