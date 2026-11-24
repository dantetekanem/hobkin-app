import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterRun, askedSchedule, isExpired, scheduleForAgent, scheduledText, scheduleView } from '../src/cli/agent-schedules.mjs';
import { AgentScheduleRunner } from '../src/cli/agent-schedule-runner.mjs';

// How long, how often and how many wakes are the agent's to say (the client's _specs/056-agent-schedules, 2026-11-24).
const NOW = Date.parse('2026-11-24T14:00:00Z');
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const main = { kind: 'main' };
const iso = time => new Date(time).toISOString();

const ask = asked => askedSchedule(asked, { now: NOW, owner: main, cwd: '/work' });
const make = asked => {
  const { schedule, refused } = ask(asked);
  assert.equal(refused, undefined);
  return schedule;
};

test('a schedule lives as long as its agent says, with no most, or with no end when it says none, and two hours when it says nothing', () => {
  const threeDays = make({ every: '1h', note: 'Look at the job.', expiresIn: '72h' });
  assert.equal(threeDays.until, iso(NOW + 3 * DAY));
  assert.equal(make({ every: '1h', note: 'Look.', expiresIn: '3d' }).until, iso(NOW + 3 * DAY), 'days are a duration too');
  assert.equal(make({ in: '2d', note: 'Look once, in two days.', expiresIn: '3d' }).nextAt, iso(NOW + 2 * DAY), 'a first time past a day is the lifetime\'s to bound');

  const endless = make({ every: '1h', note: 'Look at the job.', expiresIn: 'none' });
  assert.deepEqual([endless.until, endless.lifetimeMs], [null, null], 'stored as no end, never a far date');
  assert.equal(isExpired(endless, NOW + 365 * DAY), false);
  assert.equal(scheduleView(endless).until, undefined, 'the window reads no end time');
  assert.equal(scheduleForAgent(endless).until, undefined);
  assert.match(scheduledText(endless, main), / It has no end: cancel it when you are done\./);

  assert.equal(make({ every: '1h', note: 'Look.' }).until, iso(NOW + 2 * HOUR), 'a schedule an agent forgot still ends');
  assert.match(ask({ every: '1h', note: 'Look.', expiresIn: 'forever' }).refused, /expiresIn is a duration from 1m, such as 2h or 3d, or none for no end/);
  assert.match(ask({ every: '1h', note: 'Look.', expiresIn: '30s' }).refused, /expiresIn is a duration from 1m/);
});

test('a schedule with no end runs on and on: its lifetime never ends it after a run', () => {
  let schedule = make({ every: '1h', note: 'Look.', expiresIn: 'none' });
  for (let at = 0; at < 30; at += 1) {
    const fired = NOW + at * DAY;
    schedule = afterRun(schedule, { fired }, fired + 1000).schedule;
    if (schedule.state !== 'waiting') break;
  }
  assert.equal(schedule.state, 'done', 'its wakes cap still ends it, which is the agent\'s to say');
  assert.notEqual(schedule.endedWhy, undefined);
  assert.doesNotMatch(schedule.endedWhy, /ran out/);
});

test('a schedule repeats as often as its agent says, from one minute up with no most, so every six hours and every day work', () => {
  assert.equal(make({ every: '6h', note: 'Look at the job.', expiresIn: '3d' }).every, 6 * 3600);
  assert.equal(make({ every: '1d', note: 'Look at the job.', expiresIn: 'none' }).every, 24 * 3600);
  assert.equal(make({ every: '1d12h', note: 'Look.', expiresIn: '7d' }).every, 36 * 3600);
  assert.match(ask({ every: '30s', note: 'Look.' }).refused, /every is a duration from 1m, such as 2m, 6h or 1d/, 'the one-minute least stays');
  assert.match(ask({ every: 'daily', note: 'Look.' }).refused, /every is a duration from 1m/);
});

/** A fake clock and a shell whose runs end when the test says, around hobkin's own runner and store. */
function harness(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-schedule-limits-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const clock = { now: NOW };
  const calls = [];
  const shell = request => {
    const done = Promise.withResolvers();
    calls.push({ ...request, end: result => done.resolve(result) });
    request.signal?.addEventListener('abort', () => done.resolve({ code: null, killed: true, interrupted: true, stdout: '', stderr: '' }), { once: true });
    return done.promise;
  };
  const timers = { setTimeout: () => ({}), clearTimeout: () => {} };
  const env = { PATH: '/bin', HOBKIN_TURN: 'a'.repeat(32), HOBKIN_SCHEDULE_TOKEN: 'b'.repeat(32) };
  const open = () => {
    const runner = new AgentScheduleRunner({ root, now: () => clock.now, shell, timers, env });
    runner.open();
    t.after(() => runner.close());
    return runner;
  };
  return { root, clock, calls, open };
}

test('after a restart an overdue daily schedule fires once, and one with no end is never ended as expired', async t => {
  const h = harness(t);
  let runner = h.open();
  const daily = runner.make(main, '/work', { command: 'true', every: '1d', note: 'Look at the job.', expiresIn: '7d' });
  const endless = runner.make(main, '/work', { every: '1h', note: 'Look.', expiresIn: 'none', in: '1h' });
  runner.tick();
  h.calls.at(-1).end({ code: 0, stdout: 'ok', stderr: '', killed: false });
  await new Promise(resolve => setImmediate(resolve));
  const store = join(h.root, 'runtime/agent-schedules.json');
  const kept = readFileSync(store, 'utf8');
  await runner.close();
  writeFileSync(store, kept);

  // hobkin stays closed for three days.
  h.clock.now = NOW + 3 * DAY;
  const calls = h.calls.length;
  runner = h.open();
  const [overdue, still] = [daily, endless].map(item => runner.view().find(view => view.id === item.id));
  assert.deepEqual([overdue.state, still.state], ['waiting', 'waiting'], 'neither ended while hobkin was closed');
  assert.equal(still.until, undefined);

  runner.tick();
  runner.tick();
  assert.equal(h.calls.length, calls + 1, 'the overdue daily one fires once, not once for each day missed');
  h.calls.at(-1).end({ code: 0, stdout: 'ok', stderr: '', killed: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runner.view().find(view => view.id === daily.id).nextAt, iso(NOW + 4 * DAY));
});

/** A plain wake fired `times` times, an hour apart: each run wakes its agent. */
function fired(schedule, times) {
  let current = schedule;
  for (let at = 0; at < times && current.state === 'waiting'; at += 1) {
    const time = NOW + at * HOUR;
    current = afterRun(current, { fired: time }, time + 1000).schedule;
  }
  return current;
}

test('a schedule wakes its agent as many times as the agent says, or with no cap when it says none, and twelve when it says nothing', () => {
  const plain = { every: '1h', note: 'Look at the job.', expiresIn: '3d' };

  const thirty = fired(make({ ...plain, maxWakes: 30 }), 40);
  assert.deepEqual([thirty.state, thirty.wakes, thirty.maxWakes], ['done', 30, 30]);
  assert.equal(thirty.endedWhy, 'it woke its agent 30 times, its cap on wakes');
  assert.equal(scheduleForAgent(thirty).endedWhy, 'it woke you 30 times, its cap on wakes');

  const uncapped = make({ ...plain, maxWakes: 'none' });
  assert.equal(uncapped.maxWakes, null, 'stored as no cap, never a big number');
  const after = fired(uncapped, 60);
  assert.deepEqual([after.state, after.wakes], ['waiting', 60]);
  assert.equal(scheduleView(after).maxWakes, undefined, 'the window reads no cap');
  assert.match(scheduledText(uncapped, main), /hobkin wakes you with your note, with no cap on wakes\./);

  const usual = make(plain);
  assert.equal(usual.maxWakes, 12);
  assert.deepEqual([fired(usual, 20).wakes, scheduleView(usual).maxWakes], [12, 12]);
  assert.match(scheduledText(usual, main), /with your note, 12 times at most\./);
  assert.match(ask({ ...plain, maxWakes: 0 }).refused, /maxWakes is a number of wakes from 1, or none for no cap/);
  assert.match(ask({ ...plain, maxWakes: 'lots' }).refused, /maxWakes is a number of wakes from 1/);
});
