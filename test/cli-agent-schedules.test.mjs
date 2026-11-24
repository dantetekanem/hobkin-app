import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterRun, askedSchedule, MOST_WAKES, parseDuration, scheduleView } from '../src/cli/agent-schedules.mjs';
import { AgentScheduleRunner, readAgentSchedules } from '../src/cli/agent-schedule-runner.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');
const MINUTE = 60000;
const main = { kind: 'main' };
const run = { kind: 'run', id: 'session:hobkin-ship-412-a1b2' };
const iso = time => new Date(time).toISOString();

const ask = (asked, extra = {}) => askedSchedule(asked, { now: NOW, owner: main, cwd: '/work', ...extra });
const make = (asked, extra) => {
  const { schedule, refused } = ask(asked, extra);
  assert.equal(refused, undefined);
  return schedule;
};

test('a schedule is refused with no note, a bad interval, lifetime or timeout, or past the most live ones; one given no lifetime gets two hours', () => {
  assert.match(ask({ every: '2m' }).refused, /Give a note/);
  assert.match(ask({ every: '30s', note: 'Look.' }).refused, /from 1m to 1h/);
  assert.match(ask({ every: '61m', note: 'Look.' }).refused, /from 1m to 1h/);
  assert.match(ask({ every: '2m', note: 'Look.', expiresIn: '25h' }).refused, /at most 24 hours/);
  assert.match(ask({ every: '2m', note: 'Look.', command: 'true', timeoutMs: 4000 }).refused, /5 seconds to 10 minutes/);
  assert.match(ask({ every: '2m', note: 'Look.', command: 'true', timeoutMs: 600001 }).refused, /5 seconds to 10 minutes/);
  assert.match(ask({ note: 'Look.' }).refused, /Say when it fires/);
  assert.match(ask({ in: '10m', at: '15:00', note: 'Look.' }).refused, /not both/);
  assert.match(ask({ in: '3h', note: 'Look.' }).refused, /after its lifetime ends/);
  assert.match(ask({ in: '10m', note: 'Look.', wakeOn: 'change', command: 'true' }).refused, /needs every/);
  assert.match(ask({ in: '10m', note: 'Look.', wakeOn: 'failure' }).refused, /are for a command/);
  assert.match(ask({ every: '2m', note: 'Look.', command: 'true', pendingExit: [1, 2, 3, 4, 5] }).refused, /up to 4 exit codes/);

  const live = Array.from({ length: 5 }, (_, at) => make({ every: '2m', note: 'Look.' }, { id: `m${at}` }));
  assert.match(ask({ every: '2m', note: 'One more.' }, { live }).refused, /already keep 5 live schedules/);
  assert.ok(ask({ every: '2m', note: 'Mine.' }, { live, owner: run }).schedule, 'another agent has room of its own');
  const home = Array.from({ length: 20 }, (_, at) => make({ every: '2m', note: 'Look.' }, { id: `h${at}`, owner: { kind: 'hobkin', id: `0000000${at % 10}` } }));
  assert.match(ask({ every: '2m', note: 'One more.' }, { live: home, owner: run }).refused, /already keeps 20 live schedules/);
  const endedOnes = home.map(item => ({ ...item, state: 'done' }));
  assert.ok(ask({ every: '2m', note: 'Room now.' }, { live: endedOnes }).schedule, 'ended ones do not count');

  const watch = make({ name: 'Watch CI for #412', command: 'gh pr checks 412', every: '2m', note: 'Read the checks.' });
  assert.equal(watch.until, iso(NOW + 2 * 3600000));
  assert.equal(watch.nextAt, iso(NOW), 'a repeating schedule runs at once');
  assert.deepEqual([watch.wakeOn, watch.stopOn, watch.timeoutMs, watch.every], ['change', 'never', 120000, 120]);
  assert.deepEqual([make({ in: '10m', note: 'Look.', command: 'true' }).wakeOn, make({ in: '10m', note: 'Look.' }).command], ['always', undefined]);
  assert.equal(parseDuration('1h30m'), 90 * MINUTE);
});

/** The wake rules one run at a time: `result` is what the shell answered, at `minutes` after NOW. */
function runs(schedule, results) {
  const wakes = [];
  let current = schedule;
  results.forEach((result, at) => {
    const fired = NOW + at * 2 * MINUTE;
    const after = afterRun(current, { fired, result }, fired + 1000);
    wakes.push(after.wake);
    current = after.schedule;
  });
  return { schedule: current, wakes };
}
const exit = (code, stdout = '') => ({ code, stdout, stderr: '', killed: false });

test('a run wakes its agent by wakeOn, a pending exit code wakes and stops nothing, and stopOn, the caps and the lifetime end it with the reason', () => {
  const watch = asked => make({ command: 'gh pr checks 412', every: '2m', note: 'Read the checks.', ...asked });

  const change = runs(watch({}), [exit(8, 'pending'), exit(8, 'pending'), exit(1, 'build failed'), exit(1, 'build failed'), exit(0, 'all passed')]);
  assert.deepEqual(change.wakes.map(Boolean), [false, false, true, false, true], 'the first run only sets what to compare with');
  assert.equal(change.wakes[2].output, 'build failed');

  assert.deepEqual(runs(watch({ wakeOn: 'failure' }), [exit(0), exit(1), exit(0)]).wakes.map(Boolean), [false, true, false]);
  assert.deepEqual(runs(watch({ wakeOn: 'success' }), [exit(0), exit(1), exit(0)]).wakes.map(Boolean), [true, false, true]);
  assert.deepEqual(runs(watch({ wakeOn: 'always' }), [exit(0), exit(1)]).wakes.map(Boolean), [true, true]);
  assert.deepEqual(runs(watch({ wakeOn: 'never' }), [exit(0), exit(1)]).wakes.map(Boolean), [false, false]);

  const pending = runs(watch({ wakeOn: 'always', stopOn: 'failure', pendingExit: [8] }), [exit(8), exit(8), exit(8)]);
  assert.deepEqual(pending.wakes, [null, null, null]);
  assert.equal(pending.schedule.state, 'waiting');
  assert.deepEqual(pending.schedule.history.map(item => item.outcome), ['pending', 'pending', 'pending']);

  const stopped = runs(watch({ wakeOn: 'always', stopOn: 'success', pendingExit: [8] }), [exit(8), exit(1), exit(0)]);
  assert.deepEqual(stopped.wakes.map(Boolean), [false, true, true]);
  assert.deepEqual([stopped.schedule.state, stopped.schedule.endedWhy], ['done', 'its command passed']);
  const failed = runs(watch({ stopOn: 'failure', wakeOn: 'never' }), [exit(0), exit(2)]);
  assert.deepEqual([failed.schedule.state, failed.schedule.endedWhy], ['done', 'its command failed']);

  const capped = runs(watch({ maxRuns: 3 }), [exit(0), exit(0), exit(0)]);
  assert.deepEqual([capped.schedule.state, capped.schedule.endedWhy, capped.schedule.runs], ['done', 'it ran its 3 runs', 3]);

  const loud = runs(watch({ wakeOn: 'always' }), Array.from({ length: MOST_WAKES }, () => exit(0)));
  assert.deepEqual([loud.schedule.state, loud.schedule.wakes, loud.schedule.endedWhy], ['done', 12, 'it woke you 12 times, the most one schedule may']);

  const short = watch({ expiresIn: '3m' });
  const late = afterRun(short, { fired: NOW + 2 * MINUTE, result: exit(0) }, NOW + 4 * MINUTE).schedule;
  assert.deepEqual([late.state, late.endedWhy], ['expired', 'its 3 minutes ran out']);

  const broken = afterRun(watch({}), { fired: NOW, result: { code: null, killed: false, stdout: '', stderr: '', error: 'spawn bash ENOENT' } }, NOW);
  assert.deepEqual([broken.schedule.state, broken.schedule.endedWhy], ['failed', 'its command could not start: spawn bash ENOENT']);
  assert.equal(afterRun(watch({}), { fired: NOW, result: { ...exit(null), killed: true }, timedOut: true }, NOW).schedule.history[0].outcome, 'timed-out');

  const view = scheduleView(stopped.schedule, 'hobkin');
  assert.deepEqual([view.does, view.state, view.endedWhy, view.last.outcome, view.last.woke, view.maxWakes, view.nextAt], ['shell', 'done', 'its command passed', 'passed', true, 12, undefined]);
});

/** A fake clock, timers that fire only when told, and a shell whose runs end when the test says. */
function harness(t, { root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-schedules-'))) } = {}) {
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const clock = { now: NOW };
  const timers = [];
  const fakeTimers = {
    setTimeout: (fn, ms) => {
      const timer = { fn, at: clock.now + ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: timer => {
      if (timer) timer.cleared = true;
    },
  };
  const calls = [];
  const shell = request => {
    const done = Promise.withResolvers();
    const call = { ...request, end: result => done.resolve(result) };
    const stopped = () => done.resolve({ code: null, killed: true, interrupted: true, stdout: '', stderr: '' });
    request.signal?.addEventListener('abort', stopped, { once: true });
    calls.push(call);
    return done.promise;
  };
  const env = { PATH: '/bin', HOBKIN_TURN: 'a'.repeat(32), HOBKIN_SCHEDULE_TOKEN: 'b'.repeat(32) };
  const open = (options = {}) => {
    const runner = new AgentScheduleRunner({ root, now: () => clock.now, shell, timers: fakeTimers, env, ...options });
    runner.open();
    t.after(() => runner.close());
    return runner;
  };
  const fireTimers = () => {
    for (const timer of timers.filter(timer => !timer.cleared && timer.at <= clock.now)) {
      timer.cleared = true;
      timer.fn();
    }
  };
  return { root, clock, calls, open, fireTimers };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("a schedule's command runs when it is due, in its owner's folder, never twice at once, three at most, and is ended at its timeout", async t => {
  const h = harness(t);
  const runner = h.open();
  const watch = runner.make(main, '/work/main', { name: 'Watch CI', command: 'gh pr checks 412', every: '2m', note: 'Read the checks.', timeoutMs: 30000 });
  const later = runner.make(run, '/work/run', { command: 'make check', in: '10m', note: 'Look at the build.' });
  for (const at of [1, 2, 3]) runner.make({ kind: 'hobkin', id: `0000000${at}` }, `/work/h${at}`, { command: `step ${at}`, every: '5m', note: 'Look.' });

  runner.tick();
  assert.equal(h.calls.length, 3, 'three commands at once at most');
  assert.deepEqual(h.calls.map(call => [call.command, call.cwd]), [['gh pr checks 412', '/work/main'], ['step 1', '/work/h1'], ['step 2', '/work/h2']]);
  assert.equal(h.calls[0].env.HOBKIN_TURN, undefined, "hobkin's own tokens stay out of a scheduled command");
  assert.equal(h.calls[0].env.HOBKIN_SCHEDULE_TOKEN, undefined);
  assert.equal(h.calls[0].env.PATH, '/bin');

  h.clock.now += 3 * MINUTE;
  runner.tick();
  assert.equal(h.calls.length, 3, 'one schedule never runs twice at once, and the fourth waits for a place');

  h.calls[1].end(exit(0));
  await settle();
  runner.tick();
  assert.equal(h.calls.length, 4);
  assert.equal(h.calls[3].command, 'step 3');

  h.clock.now = NOW + 31000;
  h.fireTimers();
  await settle();
  const ended = runner.list(main)[0];
  assert.equal(ended.last.outcome, 'timed-out');
  assert.equal(ended.state, 'waiting');
  assert.equal(h.calls[0].signal.aborted, true, 'its run was ended through its signal');
  assert.equal(later.nextAt, iso(NOW + 10 * MINUTE));
  assert.equal(watch.id, ended.id);

  const stored = readAgentSchedules(h.root);
  assert.equal(stored.schedules.length, 5);
  assert.equal(stored.schedules.find(item => item.id === watch.id).history.at(-1).outcome, 'timed-out');
});

test('a wake is kept until it is delivered, and a schedule that ends without waking a run tells it once', async t => {
  const h = harness(t);
  const runner = h.open();
  const watch = runner.make(run, '/work', { command: 'gh pr checks 412', every: '2m', note: 'Read the checks.', wakeOn: 'always', pendingExit: [8] });
  runner.tick();
  h.calls[0].end(exit(1, 'lint failed'));
  await settle();
  const [wake] = runner.wakes();
  assert.deepEqual([wake.scheduleId, wake.owner, wake.kind, wake.outcome, wake.exitCode, wake.output, wake.note], [watch.id, run, 'fired', 'failed', 1, 'lint failed', 'Read the checks.']);
  assert.equal(readAgentSchedules(h.root).wakes.length, 1, 'kept in the home');
  runner.delivered([wake.id]);
  assert.deepEqual(runner.wakes(), []);

  assert.deepEqual(runner.cancel(watch.id), { ok: true });
  const [told] = runner.wakes();
  assert.deepEqual([told.kind, told.endedWhy], ['ended', 'the user cancelled it from the window']);
  assert.deepEqual(runner.cancel(watch.id), { ok: false, reason: 'That schedule has already ended.' });
  assert.deepEqual(runner.cancel('nothing'), { ok: false, reason: 'There is no schedule with that id.' });

  const own = runner.make(run, '/work', { in: '5m', note: 'Look again.' });
  runner.manage(run, { action: 'cancel', id: own.id });
  assert.equal(runner.wakes().length, 1, "the agent's own cancel tells it nothing");
});

test('pause, resume and run now do what they say for a live schedule and are refused for an ended or unknown one', async t => {
  const h = harness(t);
  const runner = h.open();
  const watch = runner.make(main, '/work', { command: 'true', every: '2m', note: 'Look.' });
  assert.deepEqual(runner.pause(watch.id, true), { ok: true });
  runner.tick();
  assert.equal(h.calls.length, 0, 'a paused schedule does not run');
  assert.equal(runner.view()[0].nextAt, undefined);

  assert.deepEqual(runner.runNow(watch.id), { ok: true });
  assert.equal(h.calls.length, 1, 'run now runs it at once');
  assert.deepEqual(runner.runNow(watch.id), { ok: false, reason: 'It is running now.' });
  h.calls[0].end(exit(0));
  await settle();
  assert.equal(runner.view()[0].state, 'paused', 'it stays paused after the run');

  assert.deepEqual(runner.pause(watch.id, false), { ok: true });
  runner.tick();
  assert.equal(h.calls.length, 1, 'it goes on at its own time');
  h.clock.now += 2 * MINUTE;
  runner.tick();
  assert.equal(h.calls.length, 2);

  runner.manage(main, { action: 'cancel', id: watch.id });
  for (const answer of [runner.pause(watch.id, true), runner.runNow(watch.id)]) assert.deepEqual(answer, { ok: false, reason: 'That schedule has already ended.' });
  assert.throws(() => runner.manage(run, { action: 'pause', id: watch.id }), /no schedule of yours with that id/);
});

test('schedules outlive a restart: a cut-off run counts as interrupted, an overdue one fires once, an expired one ends quietly and a wake waits', async t => {
  const h = harness(t);
  let runner = h.open();
  const watch = runner.make(run, '/work', { command: 'gh pr checks 412', every: '2m', note: 'Read the checks.', wakeOn: 'always' });
  const quiet = runner.make(run, '/work', { every: '5m', note: 'Look.', expiresIn: '10m' });
  const told = runner.make(main, '/work', { in: '1m', note: 'Say hello.' });
  runner.tick();
  h.clock.now += MINUTE;
  runner.tick();
  assert.equal(runner.wakes().length, 2, 'the plain wakes fired');
  // hobkin stops while the command runs, and nothing writes after: the store is as the crash left it.
  const storeFile = join(h.root, 'runtime/agent-schedules.json');
  const storeAtCrash = readFileSync(storeFile, 'utf8');
  await runner.close();
  writeFileSync(storeFile, storeAtCrash);

  h.clock.now = NOW + 30 * MINUTE;
  const calls = h.calls.length;
  runner = h.open();
  const [after, expired, once] = [watch, quiet, told].map(item => runner.view().find(view => view.id === item.id));
  assert.equal(after.last.outcome, 'error');
  assert.equal(after.last.line, 'It was cut off before it finished.');
  assert.deepEqual([expired.state, expired.endedWhy], ['expired', 'its 10 minutes ran out while hobkin was closed']);
  assert.equal(once.state, 'done');
  assert.equal(runner.wakes().length, 2, 'the wakes not yet delivered are still there');
  assert.equal(runner.wakes().some(wake => wake.scheduleId === quiet.id && wake.kind === 'ended'), false, 'an expired one ends quietly');

  runner.tick();
  runner.tick();
  assert.equal(h.calls.length, calls + 1, 'an overdue schedule fires once');
  h.calls.at(-1).end(exit(0));
  await settle();
  assert.equal(runner.view().find(view => view.id === watch.id).nextAt, iso(NOW + 32 * MINUTE));
  assert.equal(existsSync(join(h.root, 'runtime/agent-schedules.json')), true);
});

test('schedules end with their owner, and a home that never schedules writes nothing', async t => {
  const h = harness(t);
  const runner = h.open();
  runner.tick({ alive: () => true });
  assert.equal(existsSync(join(h.root, 'runtime/agent-schedules.json')), false);

  const mine = runner.make(run, '/work', { every: '2m', note: 'Look.' });
  const kept = runner.make(main, '/work', { every: '2m', in: '1m', note: 'Look.' });
  runner.tick({ alive: owner => owner.kind !== 'run' });
  const [ended, live] = [mine, kept].map(item => runner.view().find(view => view.id === item.id));
  assert.deepEqual([ended.state, ended.endedWhy], ['cancelled', 'its agent ended']);
  assert.equal(live.state, 'waiting');
  assert.equal(runner.live(main), 1);
  assert.deepEqual(runner.wakes(), [], 'nobody is left to tell');

  runner.endOwner(main, 'the chat was reset');
  assert.equal(runner.view().find(view => view.id === kept.id).endedWhy, 'the chat was reset');
  assert.equal(runner.live(main), 0);
});

test('a store that cannot be written costs only the write: the run settles, nothing rejects unhandled, and the error is kept', async t => {
  const h = harness(t);
  const unhandled = [];
  const listen = reason => unhandled.push(reason);
  process.on('unhandledRejection', listen);
  t.after(() => process.off('unhandledRejection', listen));
  const runner = h.open();
  const watch = runner.make(main, '/work', { command: 'sleep 1', every: '5m', note: 'Look.' });
  runner.tick();
  const runtime = join(h.root, 'runtime');
  chmodSync(runtime, 0o500);

  h.calls[0].end(exit(0, 'done'));
  await settle();
  await settle();
  // Writable again before anything can fail, so the home can be removed.
  const failedWrite = runner.lastError;
  chmodSync(runtime, 0o700);
  assert.deepEqual(unhandled, []);
  assert.match(failedWrite, /EACCES/);
  assert.equal(runner.find(watch.id).state, 'waiting', 'the run settled in memory');
  chmodSync(runtime, 0o500);
  assert.deepEqual(runner.cancel(watch.id), { ok: true }, 'an operation still answers');
  chmodSync(runtime, 0o700);
  assert.equal(runner.find(watch.id).state, 'cancelled');

  runner.make(main, '/work', { in: '5m', note: 'Look again.' });
  assert.equal(readAgentSchedules(h.root).schedules.find(item => item.id === watch.id).state, 'cancelled', 'the next write catches up');
  assert.equal(runner.lastError, null);
});
