import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DAY_OFF_MINUTES, TOO_FULL, WORK_DAY_MINUTES, dayLoad, dayPath, readDay } from '../src/cli/day.mjs';

// 03:00 UTC on the 27th is still the evening of the 26th in Toronto.
const NOW = Date.parse('2026-11-27T03:00:00Z');
const ZONE = 'America/Toronto';

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-day-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeDay(root, value) {
  mkdirSync(join(root, 'runtime'), { recursive: true });
  writeFileSync(dayPath(root), typeof value === 'string' ? value : JSON.stringify(value));
}

const day = (extra = {}) => ({
  version: 1,
  date: '2026-11-26',
  timezone: ZONE,
  workDay: true,
  hours: { start: '2026-11-26T09:00:00-05:00', end: '2026-11-26T17:00:00-05:00' },
  events: [],
  gaps: [],
  source: 'calendar tools of the gmail MCP server',
  writtenAt: '2026-11-26T12:00:00Z',
  ...extra,
});

const event = (start, end, withOthers = true) => ({ start: `2026-11-26T${start}:00-05:00`, end: `2026-11-26T${end}:00-05:00`, withOthers });

test('there is no day when the file is missing, unreadable or not a record', t => {
  const root = home(t);
  assert.equal(readDay(root, NOW), null);
  writeDay(root, '{ torn');
  assert.equal(readDay(root, NOW), null);
  writeDay(root, '[1, 2]');
  assert.equal(readDay(root, NOW), null);
});

test('a file written for another day is no day, judged by the date in its own time zone', t => {
  const root = home(t);
  writeDay(root, day({ date: '2026-11-25' }));
  assert.equal(readDay(root, NOW), null);
  writeDay(root, day({ date: '2026-11-27' }));
  assert.equal(readDay(root, NOW), null);

  writeDay(root, day());
  assert.equal(readDay(root, NOW).date, '2026-11-26');
});

test('an older file still reads: what it lacks gets a default, and events that make no sense are left out', t => {
  const root = home(t);
  writeDay(root, {
    date: '2026-11-26',
    timezone: ZONE,
    events: [
      { start: '2026-11-26T10:00:00-05:00', end: '2026-11-26T11:00:00-05:00' },
      { start: 'soon', end: '2026-11-26T12:00:00-05:00' },
      { start: '2026-11-26T15:00:00-05:00', end: '2026-11-26T14:00:00-05:00' },
      'a meeting',
    ],
  });

  assert.deepEqual(readDay(root, NOW), {
    date: '2026-11-26',
    timezone: ZONE,
    workDay: true,
    hours: null,
    events: [{ start: '2026-11-26T10:00:00-05:00', end: '2026-11-26T11:00:00-05:00', withOthers: false }],
    gaps: [],
    source: null,
    writtenAt: null,
  });
});

test('a day without a time zone that works is judged in the machine\'s own', t => {
  const root = home(t);
  const today = new Date().toLocaleDateString('en-CA');
  writeDay(root, day({ date: today, timezone: 'Nowhere/Atlantis' }));
  const read = readDay(root);
  assert.equal(read.date, today);
  assert.equal(read.timezone, null);
});

test('a work day holds 8 hours, and its meetings count once where they overlap and only inside working hours', () => {
  const load = dayLoad(day({
    events: [event('10:00', '11:00'), event('10:30', '11:30'), event('08:00', '09:30', false), event('18:00', '19:00')],
  }), { committedMinutes: 120, waitingMinutes: 30 });

  assert.equal(WORK_DAY_MINUTES, 480);
  assert.deepEqual(load, {
    capacityMinutes: 480,
    meetingMinutes: 120,
    loadMinutes: 270,
    ratio: 270 / 480,
    tooFull: false,
  });
});

test('the day is too full from 80% of what it holds', () => {
  assert.equal(TOO_FULL, 0.8);
  const almost = dayLoad(day({ events: [event('09:00', '12:00')] }), { committedMinutes: 203, waitingMinutes: 0 });
  assert.equal(almost.loadMinutes, 383);
  assert.equal(almost.tooFull, false);

  const full = dayLoad(day({ events: [event('09:00', '12:00')] }), { committedMinutes: 180, waitingMinutes: 24 });
  assert.equal(full.loadMinutes, 384);
  assert.equal(full.ratio, 0.8);
  assert.equal(full.tooFull, true);
});

test('a day off holds the default for a normal day off, and every event counts when there are no hours', () => {
  const load = dayLoad(day({ workDay: false, hours: null, events: [event('11:00', '13:00'), event('19:00', '20:00')] }), { committedMinutes: 30 });

  assert.equal(DAY_OFF_MINUTES, 240);
  assert.equal(load.capacityMinutes, 240);
  assert.equal(load.meetingMinutes, 180);
  assert.equal(load.loadMinutes, 210);
  assert.equal(load.tooFull, true);
});

test('with no day file the load is a work day with no meetings, and minutes that make no sense count as none', () => {
  assert.deepEqual(dayLoad(null, { committedMinutes: -30, waitingMinutes: Number.NaN }), {
    capacityMinutes: 480,
    meetingMinutes: 0,
    loadMinutes: 0,
    ratio: 0,
    tooFull: false,
  });
  assert.equal(dayLoad(undefined).loadMinutes, 0);
});
