import assert from 'node:assert/strict';
import { test } from 'node:test';
import { afterRun, askedSchedule, isExpired, scheduleForAgent, scheduledText, scheduleView } from '../src/cli/agent-schedules.mjs';

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
