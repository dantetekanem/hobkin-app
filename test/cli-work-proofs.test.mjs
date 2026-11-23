import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { workStatus } from '../src/cli/work/commands.mjs';
import { recordMachines } from '../src/cli/work/machines.mjs';
import { checkChangeModels, recheckModels } from '../src/cli/work/proof-checks.mjs';
import { modeledFiles, readRuns, specsAt } from '../src/cli/work/proofs.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, paths, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { setYolo, yoloView } from '../src/cli/work/yolo.mjs';
import { branched, commit, git, repository, writeJson } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const WEEK = 7 * 24 * 3600000;
const SPEC = '_specs/tla/WorkItem.tla';
const QUEUE = '_specs/tla/ReviewQueue.tla';

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
  // Its state machines were looked for with TLC, so its models part reads only the specs a test commits.
  recordMachines(root, 'api', { machines: [] }, { tlc: true, now: NOW });
  writeMode(root, { enabled: true });
  return { base, root, checkout };
}

function withSpec(h, spec = SPEC, text = specText()) {
  mkdirSync(join(h.checkout, '_specs', 'tla'), { recursive: true });
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
    specHash: sha256(specText()),
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

const flagOf = (call, flag) => call.args[call.args.indexOf(flag) + 1];
const specOf = call => call.args[call.args.indexOf('check') + 1];

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
  writeRun(h, { id: 'edited-spec', head: modeled.head, specHash: sha256('an edit never committed') });
  writeRun(h, { id: 'other-project', head: modeled.head, project: 'web' });
  assert.equal(rowOf(h, modeled).models[0].state, 'unchecked');

  // A model that never reached an action checks nothing that action guards.
  writeRun(h, { id: 'unfired', head: modeled.head, actions: [{ name: 'Merge', count: 3 }, { name: 'Decline', count: 0 }] });
  assert.deepEqual(rowOf(h, modeled).models, [{
    spec: SPEC, state: 'unproven', changed: false, run: 'unfired', why: 'Decline never fired',
    line: `TLC: 2 of 2 hold in 48,211 states, but Decline never fired · at ${modeled.head.slice(0, 7)}`,
  }]);

  const strictProof = {
    strict: true,
    obligations: [
      { id: '<1>1', label: 'Init', status: 'proved', depth: 1 },
      { id: '<1>2', label: 'Next', status: 'proved', depth: 1 },
    ],
  };
  writeRun(h, { id: 'held', head: modeled.head, proof: strictProof });
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

test('hobkin checks each model of a finished change that no run speaks for at its head, with YOLO mode off and whether or not the change edited the spec', async t => {
  const h = workspace(t);
  withSpec(h);
  setYolo(h.root, { on: false }, NOW);
  const modeled = finished(h, 'Fix merge');
  const remodeled = finished(h, 'Model the queue', { file: SPEC, text: specText('app.txt, queue.txt') });
  const checked = finished(h, 'Fix merge again', { text: 'again\n' });
  const unfinished = finished(h, 'Fix merge once more', { text: 'once more\n' });
  updateItem(h.root, 'api', unfinished.id, { state: 'open' }, NOW);
  await survey(h);
  writeRun(h, { id: 'held', head: checked.head, item: checked.id });
  const { spawn, calls } = fakeSpawn();
  const check = now => checkChangeModels(h.root, { now, survey: readUnmerged(h.root).projects, spawn });

  const started = await check(NOW);
  assert.deepEqual([started.slug, started.item, started.spec, started.head], ['api', modeled.id, SPEC, modeled.head]);
  const [{ command, args, cwd }] = calls;
  assert.equal(command, process.execPath);
  assert.deepEqual(args.slice(1), ['proof', 'check', SPEC, '--project', 'api', '--item', modeled.id, '--head', modeled.head, '--home', h.root]);
  assert.equal(cwd, join(paths(h.root, 'api').trees, 'proof'));
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), modeled.head, 'the check runs in a tree at that very commit');

  await check(NOW + 60000);
  assert.deepEqual([flagOf(calls[1], '--item'), flagOf(calls[1], '--head')], [remodeled.id, remodeled.head], 'a change that edited its spec is checked too');
  assert.equal(readFileSync(join(calls[1].cwd, SPEC), 'utf8'), specText('app.txt, queue.txt'));

  assert.equal(await check(NOW + 120000), null);
  assert.equal(calls.length, 2, 'a model a run speaks for at its head is not checked, and neither is a change not finished');
});

test('hobkin checks one model of a finished change at a time, never one it tried this week, and none while work mode is off', async t => {
  const h = workspace(t);
  withSpec(h);
  const first = finished(h, 'Fix merge');
  const second = finished(h, 'Fix merge again', { text: 'again\n' });
  await survey(h);
  const { spawn, calls } = fakeSpawn(process.pid);
  const check = now => checkChangeModels(h.root, { now, survey: readUnmerged(h.root).projects, spawn });

  writeMode(h.root, { enabled: false });
  assert.equal(await check(NOW), null);
  assert.equal(calls.length, 0, 'nothing is checked while work mode is off');

  writeMode(h.root, { enabled: true });
  await check(NOW);
  assert.equal(await check(NOW + 60000), null, 'one check at a time, while the first is going');
  // TLC stops itself after 20 minutes, so a check older than that is over, whatever its process id says now.
  await check(NOW + 26 * 60000);
  assert.deepEqual(calls.map(call => flagOf(call, '--item')), [first.id, second.id]);

  assert.equal(await check(NOW + 52 * 60000), null);
  assert.equal(calls.length, 2, 'a check tried this week is not tried again');
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
  assert.deepEqual(calls.map(specOf), [QUEUE, SPEC], 'one check a pass, each spec in turn');
  await recheck(NOW + 120000);
  assert.equal(calls.length, 2, 'a spec tried this week is not tried again');

  const checkedAt = new Date(NOW).toISOString();
  writeRun(h, { id: 'main-held', head: tip, finished: checkedAt });
  writeRun(h, { id: 'queue-broke', head: tip, spec: QUEUE, specHash: sha256(specText('queue.txt', 'ReviewQueue')), finished: checkedAt, ...broke });

  const [project] = workStatus(h.root).projects;

  assert.deepEqual(project.models.map(({ spec, state, run, why }) => [spec, state, run, why]), [
    [QUEUE, 'broken', 'queue-broke', 'MergedAtReviewedHead'],
    [SPEC, 'holds', 'main-held', undefined],
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

test('work mode reads each proof result once while its file is unchanged, and keeps it without its state graph', t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-proof-runs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = (id, outcome) => {
    mkdirSync(join(root, 'proofs', id), { recursive: true });
    // A TLC run of a real model keeps its whole state graph, tens of megabytes of it.
    const graph = { states: Array.from({ length: 150_000 }, (_, index) => ({ id: index, label: `state ${index}`, next: [index + 1] })) };
    writeJson(join(root, 'proofs', id, 'result.json'), { id, project: 'app', spec: '_specs/tla/Door.tla', outcome, finished: `2026-11-20T10:0${id.length % 10}:00Z`, graph });
  };
  result('run-1', 'holds');

  const first = readRuns(root);
  assert.equal(first[0].outcome, 'holds');
  assert.equal('graph' in first[0], false);

  // Every work tick reads them again, once for each project.
  const startedAt = performance.now();
  for (let tick = 0; tick < 40; tick += 1) readRuns(root);
  assert.ok(performance.now() - startedAt < 400, 'an unchanged result is not parsed again');

  result('run-1', 'broken');
  assert.equal(readRuns(root)[0].outcome, 'broken', 'a result written again is read again');
});

test('a model kept in an area folder under _specs/tla is read with the files it models', async t => {
  const base = mkdtempSync(join(tmpdir(), 'hobkin-area-specs-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const checkout = repository(base, 'app');
  mkdirSync(join(checkout, '_specs', 'tla', 'checkout'), { recursive: true });
  commit(checkout, '_specs/tla/checkout/Cart.tla', '---- MODULE Cart ----\n\\* models: app/cart.rb, app/order.rb\n====\n');
  const head = git(checkout, 'rev-parse', 'HEAD').trim();

  const specs = await specsAt(checkout, head);
  assert.deepEqual(specs.map(({ spec, models }) => ({ spec, models })), [{ spec: '_specs/tla/checkout/Cart.tla', models: ['app/cart.rb', 'app/order.rb'] }]);
});
