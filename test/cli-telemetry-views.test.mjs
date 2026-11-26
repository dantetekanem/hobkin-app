import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { recordEvent, recordPresence } from '../src/cli/events.mjs';
import { addMemory } from '../src/cli/memories.mjs';
import { recordMemoryUse } from '../src/cli/memory-use.mjs';
import { main } from '../src/cli/main.mjs';
import { telemetryView, TELEMETRY_VIEWS } from '../src/cli/telemetry/views.mjs';

const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-views-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// Local times, because a day and an hour are the user's.
const local = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const iso = ms => new Date(ms).toISOString();
const NOW = local(26, 20);
const seen = (root, day, hour, minute, kind, awayMs) => recordEvent(root, 'presence', { kind, ...(awayMs === undefined ? {} : { awayMs }) }, local(day, hour, minute));

/** Two days of the user: on at 08:00 both days, away 09:45 to 10:30 and from 18:00 on the first, and 12:00 to 13:00 on the second. */
function twoDays(root) {
  seen(root, 25, 8, 0, 'first', 10 * HOUR_MS);
  // A second look in the same minute as the first, before when they were last here moved on. It is no return.
  seen(root, 25, 8, 1, 'first', MINUTE_MS);
  seen(root, 25, 10, 30, 'returned', 45 * MINUTE_MS);
  seen(root, 26, 8, 0, 'first', 14 * HOUR_MS);
  seen(root, 26, 13, 0, 'returned', HOUR_MS);
}

const printed = () => {
  const chunks = [];
  return { write: text => chunks.push(text), text: () => chunks.join('') };
};

test('questions: asked per day by source, how each ended, the median time to answer, and whether the user was away', t => {
  const root = dataRoot(t);
  twoDays(root);
  const file = (id, source, day, hour, minute = 0) => recordEvent(root, 'decision_filed', { id, ...(source ? { source } : {}) }, local(day, hour, minute));
  recordEvent(root, 'decision_answered', { id: 'older', source: 'routine', ms: 5 }, local(25, 7));
  file('a', 'routine', 25, 9);
  recordEvent(root, 'decision_answered', { id: 'a', source: 'routine', ms: 10 * MINUTE_MS }, local(25, 9, 10));
  file('b', 'work', 25, 10);
  file('c', 'chat', 25, 11);
  file('d', 'action', 25, 12);
  recordEvent(root, 'action_handed', { id: 'd' }, local(25, 12, 5));
  file('e', 'action', 25, 13);
  recordEvent(root, 'action_settled', { id: 'e', by: 'main' }, local(25, 14));
  file('f', 'chat', 26, 13, 30);
  recordEvent(root, 'decision_answered', { id: 'f', source: 'chat', ms: 30 * MINUTE_MS }, local(26, 14));
  file('g', null, 26, 14, 30);
  recordEvent(root, 'question_shown', {}, local(25, 9));
  recordEvent(root, 'question_ended', { how: 'answered', choice: 0, ms: 4000 }, local(25, 9));
  recordEvent(root, 'question_ended', { how: 'escaped', ms: 900 }, local(25, 10));
  recordEvent(root, 'question_ended', { how: 'expired', ms: 30000 }, local(25, 11));

  const view = telemetryView(root, 'questions', { days: 3, now: NOW });

  assert.equal(view.view, 'questions');
  assert.equal(view.since, iso(NOW - 3 * 86400000));
  assert.equal(view.asked, 7);
  assert.deepEqual(view.bySource, { routine: 1, work: 1, chat: 2, action: 2, unknown: 1 });
  assert.deepEqual(view.ended, { answered: 2, settled: 1, handed: 1, later: 1, open: 2 });
  assert.equal(view.medianAnswerMs, 20 * MINUTE_MS);
  assert.deepEqual(view.whileAway, { away: 1, on: 4, unknown: 2 }, 'b came while the user was away, and f and g after the last sign of them');
  assert.deepEqual(Object.keys(view.byDay), ['2026-11-25', '2026-11-26']);
  assert.deepEqual(view.byDay['2026-11-26'], {
    asked: 2,
    bySource: { chat: 1, unknown: 1 },
    ended: { answered: 1, settled: 0, handed: 0, later: 0, open: 1 },
    whileAway: { away: 0, on: 0, unknown: 2 },
    repeats: 0,
  });
  assert.deepEqual(view.sheet, { shown: 1, ended: { answered: 1, dismissed: 1, expired: 1 }, medianAnswerMs: 4000 });
});

test('questions: a default counts as settled, a recall or a rule as not asked, and a topic asked again after its answer as a repeat', t => {
  const root = dataRoot(t);
  const file = (id, day, hour, topic) => recordEvent(root, 'decision_filed', { id, source: 'routine', ...(topic ? { topic } : {}) }, local(day, hour));
  file('a', 25, 9, 'aaa');
  recordEvent(root, 'decision_answered', { id: 'a', source: 'routine', ms: MINUTE_MS }, local(25, 10));
  file('b', 25, 11, 'aaa');
  file('c', 25, 12, 'bbb');
  recordEvent(root, 'decision_defaulted', { id: 'c', source: 'routine', ms: HOUR_MS }, local(25, 13));
  file('d', 26, 9, 'bbb');
  file('e', 26, 10, 'aaa');
  file('f', 26, 11);
  file('g', 24, 8, 'ccc');
  recordEvent(root, 'decision_recalled', { routine: 'mail' }, local(26, 12));
  recordEvent(root, 'decision_recalled', { routine: 'mail', by: 'rule' }, local(26, 12));
  recordEvent(root, 'decision_recalled', { routine: 'site', by: 'rule' }, local(26, 13));

  const view = telemetryView(root, 'questions', { days: 2, now: NOW });

  assert.equal(view.asked, 6, 'g was filed before the two days');
  assert.equal(view.ended.settled, 1, 'c took its pick at its deadline');
  assert.equal(view.ended.answered, 1);
  assert.equal(view.repeats, 3, 'b and e came after a was answered, and d after c defaulted');
  assert.deepEqual([view.byDay['2026-11-25'].repeats, view.byDay['2026-11-26'].repeats], [1, 2]);
  assert.deepEqual(view.notAsked, { earlierAnswer: 1, standingRule: 2 });
});

test('interruptions: Chat notices per day by source and tone, and by local hour', t => {
  const root = dataRoot(t);
  recordEvent(root, 'notice_posted', { source: 'session', tone: 'useful' }, local(25, 9, 5));
  recordEvent(root, 'notice_posted', { source: 'work-ship', tone: 'critical' }, local(25, 9, 30));
  recordEvent(root, 'notice_posted', { source: 'reminder' }, local(26, 14));
  recordEvent(root, 'decision_filed', { id: 'x', source: 'routine' }, local(26, 15));

  const view = telemetryView(root, 'interruptions', { days: 3, now: NOW });

  assert.equal(view.notices, 3);
  assert.deepEqual(view.bySource, { session: 1, 'work-ship': 1, reminder: 1 });
  assert.deepEqual(view.byTone, { useful: 1, critical: 1, none: 1 });
  assert.deepEqual(view.byDay['2026-11-25'], { notices: 2, bySource: { session: 1, 'work-ship': 1 }, byTone: { useful: 1, critical: 1 } });
  assert.equal(view.byHour.length, 24);
  assert.equal(view.byHour[9], 2);
  assert.equal(view.byHour[14], 1);
  assert.equal(view.byHour.reduce((sum, count) => sum + count, 0), 3);
});

test('presence: when the user was first on each day, each return with how long they were away, and time on by hour', t => {
  const root = dataRoot(t);
  twoDays(root);

  const view = telemetryView(root, 'presence', { days: 3, now: NOW });

  assert.deepEqual(view.byDay['2026-11-25'], {
    firstOn: { at: iso(local(25, 8)), local: '08:00', awayMs: 10 * HOUR_MS },
    returns: [{ at: iso(local(25, 10, 30)), local: '10:30', awayMs: 45 * MINUTE_MS }],
    onMs: (105 + 450) * MINUTE_MS,
  });
  assert.deepEqual(view.byDay['2026-11-26'], {
    firstOn: { at: iso(local(26, 8)), local: '08:00', awayMs: 14 * HOUR_MS },
    returns: [{ at: iso(local(26, 13)), local: '13:00', awayMs: HOUR_MS }],
    onMs: 240 * MINUTE_MS,
  });
  assert.equal(view.onSince, iso(local(26, 13)), 'the stretch still under way has no end yet, so it is not counted');
  const hours = Array.from({ length: 24 }, () => 0);
  Object.assign(hours, { 8: 120, 9: 105, 10: 90, 11: 120, 12: 60, 13: 60, 14: 60, 15: 60, 16: 60, 17: 60 });
  assert.deepEqual(view.minutesOnByHour, hours);
});

test('presence: a night past midnight belongs to the day it started, so the next morning is that day\'s first', t => {
  const root = dataRoot(t);
  recordPresence(root, { lastSeenAt: null, seenAt: local(24, 22) });
  recordPresence(root, { lastSeenAt: iso(local(24, 23, 59)), seenAt: local(25, 0, 0) });
  recordPresence(root, { lastSeenAt: iso(local(25, 1)), seenAt: local(25, 9) });

  const { byDay } = telemetryView(root, 'presence', { days: 3, now: NOW });

  assert.deepEqual(byDay, {
    '2026-11-24': { firstOn: { at: iso(local(24, 22)), local: '22:00' }, returns: [], onMs: 180 * MINUTE_MS },
    '2026-11-25': { firstOn: { at: iso(local(25, 9)), local: '09:00', awayMs: 8 * HOUR_MS }, returns: [], onMs: 0 },
  });
});

test('a home with no events gives empty views', t => {
  const root = dataRoot(t);

  assert.deepEqual(telemetryView(root, 'questions', { days: 30, now: NOW }).whileAway, { away: 0, on: 0, unknown: 0 });
  assert.equal(telemetryView(root, 'questions', { days: 30, now: NOW }).medianAnswerMs, null);
  assert.equal(telemetryView(root, 'interruptions', { days: 30, now: NOW }).notices, 0);
  assert.deepEqual(telemetryView(root, 'presence', { days: 30, now: NOW }), {
    view: 'presence',
    days: 30,
    since: iso(NOW - 30 * 86400000),
    byDay: {},
    minutesOnByHour: Array.from({ length: 24 }, () => 0),
    onSince: null,
  });
});

test('hobkin telemetry <view> prints the view as JSON for its days and changes nothing', async t => {
  const root = dataRoot(t);
  recordEvent(root, 'decision_filed', { id: 'one', source: 'routine' }, Date.now() - 3 * 86400000);
  recordEvent(root, 'decision_filed', { id: 'two', source: 'work' }, Date.now() - HOUR_MS);
  const before = readdirSync(root, { recursive: true });

  const month = printed();
  assert.equal(await main(['telemetry', 'questions', '--home', root], month), 0);
  assert.equal(JSON.parse(month.text()).asked, 2);
  assert.equal(JSON.parse(month.text()).days, 30);

  const today = printed();
  assert.equal(await main(['telemetry', '--days', '2', 'questions', '--home', root], today), 0);
  assert.deepEqual(JSON.parse(today.text()).bySource, { work: 1 });

  assert.equal(await main(['telemetry', 'interruptions', '--home', root], printed()), 0);
  assert.equal(await main(['telemetry', 'presence', '--home', root], printed()), 0);
  assert.deepEqual(readdirSync(root, { recursive: true }), before);
});

test('hobkin telemetry help lists each view in one line', async t => {
  const output = printed();

  assert.equal(await main(['telemetry', 'help', '--home', dataRoot(t)], output), 0);

  const lines = output.text().trim().split('\n');
  for (const name of Object.keys(TELEMETRY_VIEWS)) assert.equal(lines.filter(line => line.trim().startsWith(`${name} `)).length, 1, name);
  assert.ok(lines.some(line => line.trim().startsWith('help ')));
});

test('hobkin telemetry refuses a view it does not have, more words, and days that are not a whole number', async t => {
  const root = dataRoot(t);

  for (const args of [['download'], ['questions', 'more'], ['questions', '--days', '0'], ['presence', '--days', 'week']]) {
    await assert.rejects(main(['telemetry', ...args, '--home', root], printed()), /^Error: Usage: hobkin telemetry/, args.join(' '));
  }
  assert.equal(existsSync(join(root, 'runtime')), false);
});

test('help names the views', async () => {
  const output = printed();
  await main(['--help'], output);
  assert.match(output.text(), /telemetry <view> \[--days n\]/);
  assert.match(output.text(), /telemetry help lists them all/);
});

test('the memory view lists the shared memories agents used and those nobody used, never a private one or one past its day', t => {
  const root = dataRoot(t);
  const author = { by: { kind: 'main' }, source: { kind: 'chat' }, now: NOW - 2 * HOUR_MS };
  addMemory(root, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon since 2025' }, author);
  addMemory(root, { name: 'tram-pass', kind: 'pointer', description: 'Monthly tram pass in the blue wallet' }, author);
  addMemory(root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, author);
  addMemory(root, { name: 'old-trip', kind: 'date', description: 'Trip to Porto', until: '2026-10-01' }, author);
  recordMemoryUse(root, { kind: 'recall', names: ['lives-in-lisbon', 'partner-name'], by: 'main' }, { now: NOW - HOUR_MS });

  const { used, unused } = telemetryView(root, 'memory', { days: 30, now: NOW });

  assert.deepEqual(used.map(({ name, recalls }) => [name, recalls]), [['lives-in-lisbon', 1]]);
  assert.deepEqual(unused, [{ name: 'tram-pass', kind: 'pointer' }]);
  assert.ok(!JSON.stringify({ used, unused }).includes('partner-name'), 'a private memory stays out of the view');
});
