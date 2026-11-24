import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterRun, askedSchedule, isExpired, scheduleForAgent, scheduledText, scheduleView, spanWords } from '../src/cli/agent-schedules.mjs';
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

test('a span of days reads in days, so a schedule of three days reads "3 days", not 72 hours', () => {
  assert.equal(spanWords(3 * DAY), '3 days');
  assert.equal(spanWords(DAY + 12 * HOUR), '1 day 12 hours');
  assert.equal(spanWords(2 * HOUR + 30 * MINUTE), '2 hours 30 minutes', 'shorter spans read as before');
  const week = afterRun(make({ every: '1d', note: 'Look.', expiresIn: '7d' }), { fired: NOW + 7 * DAY }, NOW + 7 * DAY + 1000).schedule;
  assert.equal(week.endedWhy, 'its 7 days ran out');
  assert.match(scheduledText(make({ every: '1d', note: 'Look.', expiresIn: '3d' }), main), /, then every 1 day, and it ends by/);
});

test('a schedule runs as many times as its agent caps it at, with no most, and with no cap when it says nothing', () => {
  const plain = { every: '1m', note: 'Look at the job.', expiresIn: 'none', maxWakes: 'none' };
  assert.equal(make({ ...plain, maxRuns: 5000 }).maxRuns, 5000);
  assert.equal(make(plain).maxRuns, undefined, 'no cap unless it says one');
  assert.match(ask({ ...plain, maxRuns: 0 }).refused, /maxRuns is a number of runs from 1/);
  assert.match(ask({ ...plain, maxRuns: 2.5 }).refused, /maxRuns is a number of runs from 1/);
});

test('pendingExit takes as many exit codes as the agent names, each from 0 to 255 and kept once, and a code it names is pending even when it is 0', () => {
  const plain = { every: '2m', note: 'Read the checks.', command: 'bin/check', expiresIn: '1d' };
  const many = make({ ...plain, pendingExit: [8, 9, 10, 11, 12, 13, 8] });
  assert.deepEqual(many.pendingExit, [8, 9, 10, 11, 12, 13], 'each once');
  assert.match(ask({ ...plain, pendingExit: [256] }).refused, /pendingExit is a list of exit codes from 0 to 255/);
  assert.match(ask({ ...plain, pendingExit: [-1] }).refused, /pendingExit is a list of exit codes from 0 to 255/);
  assert.match(ask({ ...plain, pendingExit: 8 }).refused, /pendingExit is a list of exit codes/);

  const zero = make({ ...plain, pendingExit: [0] });
  const after = afterRun(zero, { fired: NOW, result: { code: 0, stdout: 'still running', stderr: '', killed: false } }, NOW + 1000);
  assert.deepEqual([after.schedule.history.at(-1).outcome, after.wake], ['pending', null], 'exit 0 named as not yet is not yet');
});

test('at takes a date and time in the home\'s time zone as well as a clock time, one three days out reads as that day, and one already past is refused with why', () => {
  const plain = { note: 'Look at the release.', expiresIn: '7d' };
  const friday = new Date(2026, 10, 27, 9, 0).getTime();
  const once = make({ ...plain, at: '2026-11-27T09:00' });
  assert.equal(once.nextAt, iso(friday), 'read as the home\'s own clock reads it');
  assert.match(scheduledText(once, main), /It first fires at Fri, Nov 27, 9:00\sAM, and it ends by/);
  assert.equal(scheduleForAgent(once).nextAt, iso(friday));
  assert.equal(scheduleView(once).nextAt, iso(friday), 'the window counts down to it');
  assert.equal(make({ ...plain, every: '1d', at: '2026-11-27T09:00' }).nextAt, iso(friday), 'a repeating one starts then');

  const past = ask({ ...plain, at: '2026-11-20T09:00' }).refused;
  assert.match(past, /^2026-11-20T09:00 has passed: it is \d{4}-\d\d-\d\dT\d\d:\d\d here now\. Give a time still to come\./);
  for (const at of ['2026-02-30T09:00', '2026-11-27T25:00', '2026-11-27T09:00Z', '2026-11-27', 'Friday 9am']) {
    assert.match(ask({ ...plain, at }).refused, /Give at as a 24-hour clock time such as 19:30, or a date and time such as 2026-11-27T09:00, in the user's time zone\./, at);
  }
  assert.match(ask({ ...plain, at: '2026-12-20T09:00' }).refused, /after its lifetime ends/, 'its lifetime still bounds it');
});
