import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { AgentScheduleRunner, STORE } from '../src/cli/agent-schedule-runner.mjs';
import { MOST_RUNS, RUNS } from '../src/cli/agent-schedule-runs.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');
const MINUTE = 60000;
const hobkin = { kind: 'hobkin', id: '0a1b2c3d' };
const iso = time => new Date(time).toISOString();
const exit = (code, stdout = '', stderr = '') => ({ code, stdout, stderr, killed: false });
const settle = () => new Promise(resolve => setImmediate(resolve));

/** A home, a fake clock, and a shell whose every run takes `took` and answers what `answers` says next. */
function harness(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-schedule-runs-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const clock = { now: NOW };
  const answers = [];
  const shell = async () => {
    const answer = answers.shift() ?? exit(0);
    clock.now += answer.took ?? 0;
    return answer;
  };
  const timers = { setTimeout: () => ({}), clearTimeout: () => {} };
  const open = () => {
    const runner = new AgentScheduleRunner({ root, now: () => clock.now, shell, timers, env: {} }).open();
    t.after(() => runner.close());
    return runner;
  };
  /** Each run due now, and its settling. */
  const fire = async runner => {
    runner.tick();
    await settle();
  };
  return { root, clock, answers, open, fire };
}

test("each run of a schedule is kept for its agent's conversation: when it began and ended, how it ended, whether it woke and its last lines", async t => {
  const h = harness(t);
  const runner = h.open();
  const watch = runner.make(hobkin, '/work', { name: 'Watch CI', command: 'gh pr checks 412', every: '2m', note: 'Read the checks.', wakeOn: 'failure', pendingExit: [8] });
  const lines = Array.from({ length: 30 }, (_, at) => `check ${at + 1}`).join('\n');
  h.answers.push({ ...exit(8, 'checks pending'), took: 3000 }, { ...exit(1, lines, 'lint failed'), took: 4000 });
  await h.fire(runner);
  h.clock.now = NOW + 2 * MINUTE;
  await h.fire(runner);

  const [shown] = runner.runs(hobkin);
  assert.deepEqual([shown.id, shown.name, shown.does, shown.command], [watch.id, 'Watch CI', 'shell', 'gh pr checks 412']);
  const [pending, failed] = shown.runs;
  assert.deepEqual(pending, { at: iso(NOW + 3000), startedAt: iso(NOW), outcome: 'pending', exitCode: 8, woke: false, line: 'checks pending', tail: 'checks pending' });
  assert.deepEqual([failed.startedAt, failed.at, failed.outcome, failed.exitCode, failed.woke], [iso(NOW + 2 * MINUTE), iso(NOW + 2 * MINUTE + 4000), 'failed', 1, true]);
  const tail = failed.tail.split('\n');
  assert.ok(tail.length <= 12, 'only its last lines');
  assert.deepEqual(tail.slice(-3), ['check 30', '[stderr]', 'lint failed'], 'what went to stderr is marked, as a wake carries it');

  assert.deepEqual(runner.runs({ kind: 'hobkin', id: 'ffffffff' }), [], "another agent's schedules are not its own");
  assert.deepEqual(h.open().runs(hobkin), runner.runs(hobkin), 'kept in the home, so they are there after a restart');
});

test(`a schedule keeps its newest ${MOST_RUNS} runs, more than the store's own history`, async t => {
  const h = harness(t);
  const runner = h.open();
  runner.make(hobkin, '/work', { command: 'gh pr checks 412', every: '1m', expiresIn: 'none', maxWakes: 'none', note: 'Read the checks.', pendingExit: [8] });
  for (let at = 0; at < MOST_RUNS + 5; at++) {
    h.clock.now = NOW + at * MINUTE;
    h.answers.push(exit(8, `pending ${at}`));
    await h.fire(runner);
  }
  const { runs } = runner.runs(hobkin)[0];
  assert.equal(runs.length, MOST_RUNS);
  assert.deepEqual([runs[0].line, runs.at(-1).line], ['pending 5', `pending ${MOST_RUNS + 4}`], 'the oldest go first');
});

test('a schedule from before keeps the runs its history had, the newest with its output, and a run cut off by a restart is kept too', async t => {
  const h = harness(t);
  const schedule = {
    id: 'abcd1234', owner: hobkin, cwd: '/work', name: 'Watch CI', command: 'gh pr checks 412', note: 'Read the checks.', every: 120,
    wakeOn: 'change', stopOn: 'never', pendingExit: [8], timeoutMs: 120000, maxWakes: 12, lifetimeMs: 7200000,
    createdAt: iso(NOW - 10 * MINUTE), until: iso(NOW + 110 * MINUTE), nextAt: iso(NOW - 2 * MINUTE), state: 'running', startedAt: iso(NOW - MINUTE), runs: 2, wakes: 0,
    output: { stdout: 'still pending', stderr: '' },
    history: [
      { at: iso(NOW - 6 * MINUTE), startedAt: iso(NOW - 6 * MINUTE - 2000), outcome: 'pending', exitCode: 8, woke: false, line: 'pending' },
      { at: iso(NOW - 4 * MINUTE), startedAt: iso(NOW - 4 * MINUTE - 2000), outcome: 'pending', exitCode: 8, woke: false, line: 'still pending' },
    ],
  };
  atomicJson(join(h.root, STORE), { version: 1, schedules: [{ ...schedule, state: 'waiting' }], wakes: [] });
  const before = h.open().runs(hobkin)[0].runs;
  assert.deepEqual(before.map(run => [run.line, run.tail]), [['pending', undefined], ['still pending', 'still pending']]);

  atomicJson(join(h.root, STORE), { version: 1, schedules: [schedule], wakes: [] });
  const after = h.open().runs(hobkin)[0].runs;
  assert.deepEqual(after.map(run => run.outcome), ['pending', 'pending', 'error']);
  assert.deepEqual(after.at(-1), { at: iso(NOW), outcome: 'error', woke: false, line: 'It was cut off before it finished.' });
});

test('the runs of a schedule leave the home with it, a day after it ended', async t => {
  const h = harness(t);
  const runner = h.open();
  const watch = runner.make(hobkin, '/work', { command: 'true', in: '1m', note: 'Look.' });
  h.clock.now = NOW + MINUTE;
  await h.fire(runner);
  const file = join(h.root, RUNS, `${watch.id}.json`);
  assert.equal(existsSync(file), true);
  h.clock.now += 25 * 60 * MINUTE;
  runner.save();
  assert.equal(existsSync(file), false);
  assert.deepEqual(runner.runs(hobkin), []);
});

test("the application answers one agent's schedules with their runs, and none for a home with none", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-schedule-runs-app-')));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 60000, now: () => NOW, runHarness: async () => ({ status: 'failed', cost: null, error: 'Not here.' }) });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  assert.deepEqual(app.agentScheduleRuns({ kind: 'main' }), { schedules: [] });
  const made = app.agentSchedules.make({ kind: 'main' }, root, { name: 'Look again', in: '10m', note: 'Read the deploy log.' });
  await app.runAgentSchedule(made.id);
  const { schedules: [shown] } = app.agentScheduleRuns({ kind: 'main' });
  assert.deepEqual([shown.name, shown.does, shown.runs.map(run => [run.outcome, run.woke])], ['Look again', 'wake', [['passed', true]]]);
  assert.deepEqual(app.agentScheduleRuns({ kind: 'hobkin', id: '0a1b2c3d' }), { schedules: [] });
});
