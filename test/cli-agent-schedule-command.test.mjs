import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as wait } from 'node:timers/promises';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { runScheduleCommand, SCHEDULE_ENVIRONMENT } from '../src/cli/agent-schedule-command.mjs';
import { startSession } from '../src/cli/session.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');
const json = value => Readable.from([JSON.stringify(value)]);

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-schedule-command-')));
  const opened = [];
  t.after(async () => {
    await Promise.all(opened.map(app => app.close()));
    rmSync(root, { recursive: true, force: true });
  });
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const fake = fakePi(root);
  const calls = [];
  const open = async () => {
    const app = await HobkinApplication.open(root, { createMain: fake.createMain, intervalMs: 60000, now: () => NOW, runHarness: async request => {
      if (request.purpose) return { status: 'failed', cost: null, error: 'Not in this test.' };
      const call = { request, end: Promise.withResolvers() };
      request.signal?.addEventListener('abort', () => call.end.resolve({ status: 'interrupted', text: '', error: 'Harness cancelled.', cost: null }), { once: true });
      calls.push(call);
      return call.end.promise;
    } });
    opened.push(app);
    return app;
  };
  return { root, calls, open };
}

async function until(check, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw Error('Timed out waiting.');
    await wait(5);
  }
}

/** Runs `hobkin schedule` as the run's shell would, while the app ticks as it does each second. */
async function schedule(app, env, args, input) {
  const ticking = setInterval(() => { void app.tickAgentSchedules(); }, 20);
  try {
    return await runScheduleCommand(app.runtime.directory, args, { env, input, waitMs: 3000 });
  } finally {
    clearInterval(ticking);
  }
}

test('hobkin schedule works only with a run\'s own token and says how to use it', async () => {
  await assert.rejects(runScheduleCommand('/nowhere', ['list'], { env: {} }), /works only inside a run hobkin started/);
  const env = { [SCHEDULE_ENVIRONMENT.token]: 'a'.repeat(32) };
  await assert.rejects(runScheduleCommand('/nowhere', ['cancel'], { env }), /^Error: Usage: hobkin schedule/);
  await assert.rejects(runScheduleCommand('/nowhere', ['make'], { env, input: Readable.from(['not json']) }), /one JSON object on standard input/);
  await assert.rejects(runScheduleCommand('/nowhere', ['list'], { env }), /hobkin is not running/);
});

test('a run on Claude Code schedules with hobkin schedule and its own token, and one whose permissions are not "all" is refused a command and allowed a wake', async t => {
  const h = home(t);
  const app = await h.open();
  const started = await startSession({ root: h.root, title: 'Ship 412', brief: 'Ship #412 and watch CI.', cwd: h.root, approved: true, tier: 'mid' });
  const runId = `session:${started.name}`;
  void app.tickSessions();
  await until(() => h.calls.length === 1);
  const [{ request }] = h.calls;
  const forged = { [SCHEDULE_ENVIRONMENT.token]: 'f'.repeat(32), [SCHEDULE_ENVIRONMENT.home]: h.root };
  const unknownAt = Date.now();
  await assert.rejects(schedule(app, forged, ['list']), /not a run hobkin is running now/, 'a made-up token is refused before any token was given');
  assert.ok(Date.now() - unknownAt < 2000, 'at once, not after the answer time');

  const asked = await app.agentScheduleEnvironment(request.id, { commands: false });
  assert.deepEqual(Object.keys(asked).sort(), [SCHEDULE_ENVIRONMENT.home, SCHEDULE_ENVIRONMENT.token].sort());
  assert.equal(asked[SCHEDULE_ENVIRONMENT.home], h.root);
  assert.match(asked[SCHEDULE_ENVIRONMENT.token], /^[0-9a-f]{32}$/);
  assert.equal(await app.agentScheduleEnvironment('no-such-harness'), null, 'a run that keeps no schedules gets no token');

  await assert.rejects(schedule(app, asked, ['make'], json({ command: 'gh pr checks 412', every: '2m', note: 'Read the checks.' })),
    /permissions are not "all"[\s\S]*plain wake/);
  const made = await schedule(app, asked, ['make'], json({ name: 'Look again', in: '10m', note: 'Read the deploy log.' }));
  assert.match(made.text, /^Scheduled "Look again"/);
  assert.match(made.text, /cannot wait[\s\S]*end when this turn ends/, 'a run on Claude Code is told its schedules end with its turn');
  assert.doesNotMatch(made.text, /End your turn now|starts you again/);
  assert.deepEqual(app.agentSchedules.view().map(item => [item.owner.kind, item.owner.id, item.does]), [['run', runId, 'wake']]);
  const { schedules } = await schedule(app, asked, ['list']);
  assert.deepEqual(schedules.map(item => item.name), ['Look again']);
  assert.equal((await schedule(app, asked, ['cancel', made.schedule.id])).schedule.state, 'cancelled');
  await assert.rejects(schedule(app, forged, ['list']), /not a run hobkin is running now/);

  const all = await app.agentScheduleEnvironment(request.id, { commands: true });
  const watch = await schedule(app, all, ['make'], json({ name: 'Watch CI', command: 'gh pr checks 412', every: '2m', pendingExit: [8], note: 'Read the checks.' }));
  assert.equal(watch.schedule.does, 'shell', 'a run whose permissions are "all" may schedule a command');

  h.calls[0].end.resolve({ status: 'completed', text: 'Useful: Done.', cost: null });
  await until(async () => (await app.runtime.state()).runs[runId].status === 'completed');
  // The tick that drops the ended run's token comes before the command asks, as it did when this test was flaky.
  await app.tickAgentSchedules();
  const endedAt = Date.now();
  await assert.rejects(schedule(app, all, ['list']), /not a run hobkin is running now/, 'the token names the run only while it runs');
  assert.ok(Date.now() - endedAt < 2000, 'at once, not after the answer time');
});
