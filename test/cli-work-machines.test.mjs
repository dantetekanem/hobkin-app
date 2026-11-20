// What YOLO mode needs of a project's state machines before it counts their models (_specs/050-tla-proofs, A17 to A20): a state-machines
// look made with the TLA+ tools in place, that look due now on a project never looked at with them, and a change to a machine no model
// covers sent back to its branch for the model, keeping its review's scores. No agent, Java or TLC runs here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { jarPath } from '../src/cli/proof/tools.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { readMachines, recordMachines } from '../src/cli/work/machines.mjs';
import { planWork } from '../src/cli/work/plan.mjs';
import { chooseProject, paths, readItems, readMode, updateItem, writeMode, writeState } from '../src/cli/work/store.mjs';
import { readinessOf, recordReadiness, runReadiness, setYolo } from '../src/cli/work/yolo.mjs';
import { repository, writeJson } from './helpers/work-fixture.mjs';

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
