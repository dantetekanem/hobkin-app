// What YOLO mode needs of a project's state machines before it counts their models (_specs/050-tla-proofs, A17 to A20): a state-machines
// look made with the TLA+ tools in place, that look due now on a project never looked at with them, and a change to a machine no model
// covers sent back to its branch for the model, keeping its review's scores. No agent, Java or TLC runs here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { jarPath } from '../src/cli/proof/tools.mjs';
import { surveyAndClose } from '../src/cli/work/closing.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { WorkDirector } from '../src/cli/work/director.mjs';
import { readMachines, recordMachines } from '../src/cli/work/machines.mjs';
import { planWork } from '../src/cli/work/plan.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, paths, prFile, readItems, readMode, updateItem, writeMode, writeState } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { whyItAsks, yoloPass } from '../src/cli/work/yolo-pass.mjs';
import { readinessOf, recordReadiness, runReadiness, setYolo } from '../src/cli/work/yolo.mjs';
import { branched, commit, git, repository, writeJson } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const DAY = 24 * 3600000;
const RECORDED = ['tests', 'errors', 'slowQueries', 'performance', 'logs', 'alerts', 'rollback', 'deploy'];

function workspace(t, projects = ['api']) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-machines-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkouts = Object.fromEntries(projects.map(name => [name, repository(base, name)]));
  for (const name of projects) chooseProject(root, checkouts[name], 'important', NOW);
  writeMode(root, { enabled: true });
  return { base, root, checkouts };
}

/** Every part a readiness run records in place, and the readiness work merged: only the models part is left to hobkin. */
function readyButModels(h, slug = 'api') {
  setYolo(h.root, { on: true }, NOW);
  const { id } = readItems(h.root, slug).find(({ key }) => key === 'yolo:ready');
  updateItem(h.root, slug, id, { state: 'doing' }, NOW);
  recordReadiness(h.root, slug, Object.fromEntries(RECORDED.map(name => [name, { ready: true, how: 'In place.' }])), NOW);
  updateItem(h.root, slug, id, { state: 'merged' }, NOW);
}

const piped = value => Readable.from([JSON.stringify(value)]);

test('the models part is not ready until a look with TLC recorded the machines, and not applicable only when it found none', async t => {
  const h = workspace(t);
  readyButModels(h);
  const models = () => readinessOf(h.root, 'api').parts.models;
  const notLooked = 'Its state machines have not been looked for with TLC yet.';

  assert.deepEqual(models(), { ready: false, missing: notLooked });
  assert.deepEqual([readinessOf(h.root, 'api').ready, readinessOf(h.root, 'api').needs], [false, [`Models: ${notLooked}`]]);

  // A look that ran without Java and TLC found nothing a model could check.
  recordMachines(h.root, 'api', { machines: [] }, { tlc: false, now: NOW });
  assert.deepEqual(models(), { ready: false, missing: notLooked });

  recordMachines(h.root, 'api', { machines: [] }, { tlc: true, now: NOW });
  assert.deepEqual(models(), { notApplicable: 'Its state machines look found none.' });
  assert.deepEqual([readinessOf(h.root, 'api').ready, readinessOf(h.root, 'api').needs], [true, []]);

  // A machine with no model yet does not hold the project back: a change to it gets its model first.
  const checkout = { name: 'Checkout', files: ['app/order.rb', './app/payment.rb'] };
  recordMachines(h.root, 'api', { machines: [checkout] }, { tlc: true, now: NOW });
  assert.deepEqual(readMachines(h.root, 'api'), {
    at: new Date(NOW).toISOString(), tlc: true, machines: [{ name: 'Checkout', files: ['app/order.rb', 'app/payment.rb'] }],
  });
  assert.deepEqual(models(), { ready: true, how: '1 machine has no model on the default branch yet, so a change to it gets its model first.' });

  assert.throws(() => recordMachines(h.root, 'api', {}, { tlc: true }), /machines is a list of each state machine the look found/);
  assert.throws(() => recordMachines(h.root, 'api', { machines: [{ name: 'Checkout', files: ['../outside.rb'] }] }, { tlc: true }), /files are the paths/);
  assert.throws(() => recordMachines(h.root, 'api', { machines: [{ name: '', files: ['app.rb'] }] }, { tlc: true }), /name is the machine's name/);
  assert.equal(readMachines(h.root, 'api').machines.length, 1, 'a refused list changes nothing');

  // The look pipes its list. Without the pinned jar in this home, the tools were not found, so it is kept but counts for nothing.
  const reply = await runWorkCommand(h.root, ['machines', 'api'], piped({ machines: [] }));
  assert.match(reply.message, /^Recorded no state machine on api, without Java and TLC/);
  assert.deepEqual([readMachines(h.root, 'api').tlc, models()], [false, { ready: false, missing: notLooked }]);
});

/** A studied project whose looks are all fresh, and whose state machines were looked for a day ago, before the TLA+ tools were here. */
function lookedYesterday(h, slug) {
  mkdirSync(paths(h.root, slug).directory, { recursive: true });
  writeFileSync(paths(h.root, slug).project, '# What it is\n');
  const at = new Date(NOW).toISOString();
  writeState(h.root, slug, { lastLookAt: at, lastLensAt: at, lastIdeasAt: at, lastSignalsAt: at, lastMachinesAt: new Date(NOW - DAY).toISOString() });
}

/** The pinned jar as setup leaves it, which it puts in only once Java is found or installed. */
function toolsSetUp(h) {
  mkdirSync(dirname(jarPath(h.root)), { recursive: true });
  writeFileSync(jarPath(h.root), 'not a real jar');
}

test('a project never looked at for its state machines with TLC has that look due now, and Run readiness puts it first', t => {
  const h = workspace(t, ['api', 'web', 'site']);
  writeJson(join(h.root, 'work', 'subscription.json'), { secondary: { usedPercent: 10, windowMinutes: 10080, resetAt: NOW + 3 * DAY } });
  for (const slug of ['api', 'web', 'site']) lookedYesterday(h, slug);
  const due = () => planWork(h.root, { now: NOW }).entries.filter(({ kind }) => kind === 'machines').map(({ slug, why }) => [slug, why]);

  assert.deepEqual(due(), [], 'without the tools a look made yesterday comes again in a week');

  toolsSetUp(h);
  assert.deepEqual(due().map(([slug, why]) => [slug, why.endsWith('never looked for with TLC')]).toSorted(), [['api', true], ['site', true], ['web', true]]);
  writeMode(h.root, { agents: 1 });
  const plan = planWork(h.root, { now: NOW, running: [{ id: 'run-1', slug: 'web', lane: 'look', kind: 'machines', level: 'max' }] });
  assert.equal(plan.next, null, 'the agent limit paces them: with one agent and it busy, none of them starts');

  // A look that started with the tools here is the one readiness waits for, and the next comes a week after it.
  writeState(h.root, 'web', { lastMachinesAt: new Date(NOW).toISOString(), lastMachinesTlcAt: new Date(NOW).toISOString() });
  assert.deepEqual(due().map(([slug]) => slug).toSorted(), ['api', 'site']);

  // Run readiness puts the project's look ahead of its readiness work when the look is due, and leaves a look that is not due alone.
  const { message } = runReadiness(h.root, 'api', NOW);
  const readiness = readItems(h.root, 'api').find(({ key }) => key === 'yolo:ready');
  assert.match(message, /^Queued "Get api ready for YOLO mode" on api to start at once\..* Its state machines look goes first\.$/);
  assert.deepEqual(readMode(h.root).queueNext, ['machines:api', `item:api:${readiness.id}`]);
  assert.deepEqual(planWork(h.root, { now: NOW }).entries.filter(({ pickedNow }) => pickedNow).map(({ key }) => key), ['machines:api', `item:api:${readiness.id}`]);

  runReadiness(h.root, 'web', NOW);
  assert.equal(readMode(h.root).queueNext.includes('machines:web'), false);
});

const CHECKOUT = { name: 'Checkout', files: ['app.txt'] };
const MODEL = '_specs/tla/Checkout.tla';
const modelText = [
  '---- MODULE Checkout ----',
  '\\* models: app.txt',
  'VARIABLE state',
  '\\* words: An order starts open.',
  'Init == state = "open"',
  '\\* code: app.txt:1',
  'Pay == state\' = "paid"',
  'Next == Pay',
  '====',
  '',
].join('\n');
const scored = numbers => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback']
  .map(name => [name, { score: numbers?.[name] ?? 10, evidence: `What the review saw of ${name}.` }]));

/** Finished work on a branch of its own that changes `file`, reviewed at its head. */
function finished(h, title, { slug = 'api', file = 'app.txt', numbers } = {}) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkouts[slug], branch, file, `${title}\n`);
  const head = git(h.checkouts[slug], 'rev-parse', branch);
  const { id } = fileItem(h.root, slug, { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, slug, id, { state: 'branch', branch, proof: 'The spec passes.', review: { kind: 'bug-fix', scores: scored(numbers), head } }, NOW);
  // Described, so the survey's own pass has nothing to file for it.
  mkdirSync(dirname(prFile(h.root, slug, id)), { recursive: true });
  writeFileSync(prFile(h.root, slug, id), 'What changed and why.\n');
  return { slug, id, branch, head };
}

/** What the run sent back for a model leaves on the change's branch: the model alone, committed on top of the reviewed head. */
function modelOnBranch(h, { slug, branch }) {
  const checkout = h.checkouts[slug];
  git(checkout, 'switch', '-q', branch);
  mkdirSync(join(checkout, '_specs', 'tla'), { recursive: true });
  commit(checkout, MODEL, modelText);
  git(checkout, 'switch', '-q', 'main');
  return git(checkout, 'rev-parse', branch);
}

/** A run as `hobkin proof check` leaves it, which only that process writes. */
const writeRun = (h, id, change) => writeJson(join(h.root, 'proofs', id, 'result.json'), {
  id,
  spec: MODEL,
  specHash: createHash('sha256').update(modelText).digest('hex'),
  outcome: 'holds',
  finished: new Date(NOW).toISOString(),
  stats: { generated: 40, distinct: 12, queue: 0, depth: 4 },
  rules: [{ name: 'PaidOnce', kind: 'invariant', status: 'holds' }],
  actions: [{ name: 'Pay', count: 3 }],
  ...change,
});

/** A spawn that starts nothing and keeps what hobkin asked for. Its pid names no live process, so one check never holds up the next. */
function fakeSpawn() {
  const calls = [];
  const spawn = (command, args) => {
    calls.push(args);
    return { pid: 2 ** 22 + 1, unref() {}, on() {} };
  };
  return { spawn, calls };
}

const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });
const itemOf = (h, { slug, id }) => readItems(h.root, slug).find(item => item.id === id);
const rowOf = (h, { id }) => readyItems(h.root).find(row => row.item === id);
const onMain = (h, { slug }, head) => git(h.checkouts[slug], 'branch', '--contains', head, '--format=%(refname:short)').split('\n').includes('main');
const flagOf = (args, flag) => args[args.indexOf(flag) + 1];

/** Two ready projects whose state machines look found Checkout in app.txt, with no model of it anywhere yet. */
function readyWithAMachine(t) {
  const h = workspace(t, ['api', 'web']);
  for (const slug of ['api', 'web']) {
    readyButModels(h, slug);
    recordMachines(h.root, slug, { machines: [CHECKOUT] }, { tlc: true, now: NOW });
  }
  return h;
}

test('a finished change to a machine no model covers goes back to its branch for the model, once a review', async t => {
  const h = readyWithAMachine(t);
  const touches = finished(h, 'Fix checkout');
  const unsafe = finished(h, 'Fix totals', { slug: 'web', numbers: { safety: 7 } });
  await survey(h);
  assert.deepEqual([readinessOf(h.root, 'api').ready, readinessOf(h.root, 'web').ready], [true, true]);

  assert.deepEqual(await yoloPass(h.root, { now: NOW, spawn: () => assert.fail('there is no model to check yet') }), []);

  const sent = itemOf(h, touches);
  assert.deepEqual([sent.state, sent.branch, sent.modelAsked, sent.modelAskedFor], ['open', touches.branch, { machines: [CHECKOUT] }, touches.head]);
  assert.equal(readMode(h.root).queueNext[0], `item:api:${touches.id}`, 'it goes ahead of new work, as a review does');
  assert.match(planWork(h.root, { now: NOW }).entries.find(({ key }) => key === `item:api:${touches.id}`).why, /model of Checkout first/);
  assert.equal(onMain(h, touches, touches.head), false);
  // Only a change nothing else stops goes back: a model would not lift a safety score under its floor.
  assert.deepEqual([itemOf(h, unsafe).state, itemOf(h, unsafe).modelAsked], ['branch', undefined]);

  const asked = { yolo: { on: true, rate: 8 }, project: {}, readiness: { ready: true }, landable: true, row: { holds: 0 }, unit: { sha: touches.head } };
  const review = { kind: 'bug-fix', scores: scored(), head: touches.head };
  assert.equal(whyItAsks({ ...asked, item: { state: 'branch', kind: 'fix', review }, unmodeled: [CHECKOUT] }), 'it changes Checkout, a state machine no model covers yet');

  // A run that ends with no model leaves the change asking. It went back once for this review, and does not go again.
  updateItem(h.root, 'api', touches.id, { state: 'branch', modelAsked: null }, NOW);
  await survey(h);
  assert.deepEqual(await yoloPass(h.root, { now: NOW + 60000 }), []);
  assert.deepEqual([itemOf(h, touches).state, onMain(h, touches, touches.head)], ['branch', false]);
});

test('a model written after the review keeps the scores, and the change merges by itself once the model holds', async t => {
  const h = readyWithAMachine(t);
  const holds = finished(h, 'Fix checkout');
  const breaks = finished(h, 'Fix payment', { slug: 'web' });
  await survey(h);
  await yoloPass(h.root, { now: NOW, spawn: () => assert.fail('there is no model to check yet') });
  assert.deepEqual([itemOf(h, holds).state, itemOf(h, breaks).state], ['open', 'open']);

  // Each run commits the model alone and records its branch. Ending it asks for no review: the code the review scored has not changed.
  const director = new WorkDirector({ root: h.root, now: () => NOW, gh: async () => '[]' });
  const heads = new Map();
  for (const change of [holds, breaks]) {
    heads.set(change.id, modelOnBranch(h, change));
    updateItem(h.root, change.slug, change.id, { state: 'branch' }, NOW);
    await director.itemFinished(change.slug, itemOf(h, change));
    assert.deepEqual([itemOf(h, change).state, itemOf(h, change).reviewAsked, itemOf(h, change).modelAsked], ['branch', false, null]);
  }
  const closed = await surveyAndClose(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });
  assert.deepEqual(closed.reviewing, [], 'a commit that only wrote a model asks for no new review');
  assert.deepEqual([rowOf(h, holds).head, rowOf(h, holds).review.stale], [heads.get(holds.id), false], 'the scores still speak for the new head');

  // hobkin checks the model it asked for itself, at each new head.
  const { spawn, calls } = fakeSpawn();
  assert.deepEqual(await yoloPass(h.root, { now: NOW, spawn }), []);
  assert.deepEqual(calls.map(args => [flagOf(args, 'check'), flagOf(args, '--item'), flagOf(args, '--head')]).toSorted(), [
    [MODEL, holds.id, heads.get(holds.id)], [MODEL, breaks.id, heads.get(breaks.id)],
  ].toSorted());

  writeRun(h, 'checkout-held', { project: 'api', item: holds.id, head: heads.get(holds.id) });
  writeRun(h, 'payment-broke', { project: 'web', item: breaks.id, head: heads.get(breaks.id), outcome: 'broken', broken: 'PaidOnce', traceLength: 5 });
  const reports = await yoloPass(h.root, { now: NOW + 60000, spawn });

  assert.deepEqual(reports.map(({ item, head }) => [item, head]), [[holds.id, heads.get(holds.id)]]);
  assert.deepEqual([itemOf(h, holds).state, onMain(h, holds, heads.get(holds.id))], ['merged', true]);
  assert.deepEqual([itemOf(h, breaks).state, onMain(h, breaks, heads.get(breaks.id))], ['branch', false]);
  assert.deepEqual(rowOf(h, breaks).review.scores.proof, {
    score: 3, evidence: `Checkout.tla: TLC: PaidOnce breaks in 5 steps · at ${heads.get(breaks.id).slice(0, 7)}`, by: 'hobkin', run: 'payment-broke',
  }, 'the broken model is the floor, and the proof score line names it and its run');
});
