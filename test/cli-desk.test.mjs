import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryFor, digestDue, itemLevel, learnMoments, learnQuietHours, nextDigestAt, userDay } from '../src/cli/desk.mjs';
import { AWAY_GAP_MS } from '../src/cli/events.mjs';

// Every date here is in November 2026, after the clocks went back, so Toronto is five hours behind UTC all month.
const timeZone = 'America/Toronto';
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const at = (date, time) => Date.parse(`${date}T${time}:00-05:00`);
const iso = (date, time) => new Date(at(date, time)).toISOString();
const dayAfter = date => new Date(Date.parse(`${date}T12:00:00Z`) + 24 * HOUR).toISOString().slice(0, 10);
const presence = (time, kind, awayMs) => ({ at: new Date(time).toISOString(), type: 'presence', kind, ...(awayMs === undefined ? {} : { awayMs }) });

/** Presence events for days the user worked: first on, each break as away then back, and the stop the next day's first event reveals. */
function workdays(days, today) {
  const events = [];
  let stoppedAt;
  for (const { date, first, breaks = [], stop, stopOn = date } of days) {
    const start = at(date, first);
    events.push(presence(start, 'first', stoppedAt === undefined ? undefined : start - stoppedAt));
    for (const [out, back] of breaks) events.push(presence(at(date, back), 'returned', at(date, back) - at(date, out)));
    stoppedAt = at(stopOn, stop);
  }
  if (today) events.push(presence(at(today.date, today.first), 'first', at(today.date, today.first) - stoppedAt));
  return events;
}

const coffee = ['10:30', '10:40'];
const lunch = ['12:15', '13:00'];
const usualDays = [
  { date: '2026-11-10', first: '08:50', breaks: [coffee, lunch], stop: '17:30' },
  { date: '2026-11-11', first: '09:00', breaks: [lunch], stop: '17:30' },
  { date: '2026-11-12', first: '09:10', breaks: [coffee, lunch, ['15:00', '15:35']], stop: '18:30' },
  { date: '2026-11-13', first: '09:00', breaks: [lunch], stop: '17:00' },
  { date: '2026-11-16', first: '08:55', breaks: [lunch], stop: '18:30' },
  { date: '2026-11-17', first: '09:05', breaks: [['12:30', '13:20']], stop: '17:30' },
  { date: '2026-11-18', first: '09:00', breaks: [coffee, lunch], stop: '18:30' },
  { date: '2026-11-19', first: '09:20', breaks: [lunch], stop: '17:30' },
  { date: '2026-11-20', first: '09:00', breaks: [lunch], stop: '17:30' },
];
const usualNow = at('2026-11-23', '09:30');
const usualEvents = workdays(usualDays, { date: '2026-11-23', first: '08:55' });

const moments = [{ at: '09:00', why: 'first' }, { at: '13:00', why: 'return' }, { at: '17:00', why: 'stop' }];
const quiet = [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23];
const on = time => at('2026-11-23', time);

test('digests come when the user usually starts, comes back from the main break and a little before they stop', () => {
  const learned = learnMoments(usualEvents, { now: usualNow, days: 14, timeZone });
  assert.deepEqual(learned.moments, moments);
  assert.equal(learned.enough, true);
  assert.equal(learned.days, 9);
});

test('only presence events count, so the rest of the event log can be passed as it is', () => {
  const noise = [{ at: iso('2026-11-12', '03:00'), type: 'turn_started', id: 'x' }, { at: iso('2026-11-12', '22:00'), type: 'run_finished' }];
  assert.deepEqual(learnMoments([...usualEvents, ...noise], { now: usualNow, days: 14, timeZone }).moments, moments);
});

test('with less than a week of presence it says so, and the digest comes when the user returns after a gap', () => {
  const learned = learnMoments(workdays(usualDays.slice(-3)), { now: usualNow, days: 14, timeZone });
  assert.deepEqual(learned.moments, []);
  assert.equal(learned.enough, false);
  assert.match(learned.reason, /less than a week/i);
  assert.match(learned.reason, /returns after a gap/);
});

test('a user with no usual break gets the middle of their day instead', () => {
  const days = usualDays.map(day => ({ ...day, breaks: [coffee] }));
  assert.deepEqual(learnMoments(workdays(days), { now: usualNow, days: 14, timeZone }).moments,
    [{ at: '09:00', why: 'first' }, { at: '13:00', why: 'middle' }, { at: '17:00', why: 'stop' }]);
});

test('digests are never closer than two hours, so a short day gets fewer of them', () => {
  const days = usualDays.map(day => ({ ...day, first: '09:00', breaks: [], stop: '12:00' }));
  assert.deepEqual(learnMoments(workdays(days), { now: usualNow, days: 14, timeZone }).moments,
    [{ at: '09:00', why: 'first' }, { at: '11:30', why: 'stop' }]);
});

test('a night past midnight belongs to the day it started, so a late stop is that day\'s last digest', () => {
  const days = usualDays.map(({ date }) => ({ date, first: '10:00', breaks: [['14:00', '15:00']], stop: '01:00', stopOn: dayAfter(date) }));
  assert.deepEqual(learnMoments(workdays(days), { now: usualNow, days: 14, timeZone }).moments,
    [{ at: '10:00', why: 'first' }, { at: '15:00', why: 'return' }, { at: '00:30', why: 'stop' }]);
});

test('the user\'s day turns at 04:00 on the clock, on the days the clocks change too', () => {
  // On 2026-03-08 Toronto's clocks go from 02:00 to 03:00, and on 2026-11-01 from 02:00 back to 01:00.
  assert.deepEqual(userDay(Date.parse('2026-03-08T03:30:00-04:00'), timeZone), { date: '2026-03-07', minute: 23 * 60 + 30 });
  assert.deepEqual(userDay(Date.parse('2026-03-08T04:30:00-04:00'), timeZone), { date: '2026-03-08', minute: 30 });
  assert.deepEqual(userDay(Date.parse('2026-11-01T03:30:00-05:00'), timeZone), { date: '2026-10-31', minute: 23 * 60 + 30 });
  assert.deepEqual(userDay(Date.parse('2026-11-01T04:30:00-05:00'), timeZone), { date: '2026-11-01', minute: 30 });
});

test('quiet hours are the hours the user was on in fewer than half their days', () => {
  const learned = learnQuietHours(usualEvents, { now: usualNow, days: 14, timeZone });
  assert.deepEqual(learned.hours, quiet);
  assert.equal(learned.enough, true);
});

test('today is still under way, so it does not count against the hours still to come', () => {
  const days = usualDays.slice(1).map((day, index) => ({ ...day, stop: index < 4 ? '18:30' : '17:30' }));
  const { hours } = learnQuietHours(workdays(days, { date: '2026-11-23', first: '08:55' }), { now: usualNow, days: 14, timeZone });
  assert.equal(hours.includes(18), false);
  assert.equal(hours.includes(8), true);
});

test('with less than a week of presence no hour is quiet yet', () => {
  const learned = learnQuietHours(workdays(usualDays.slice(-3)), { now: usualNow, days: 14, timeZone });
  assert.deepEqual(learned.hours, []);
  assert.equal(learned.enough, false);
  assert.match(learned.reason, /less than a week/i);
});

test('a run that found nothing is only logged, whatever else it says', () => {
  const now = on('10:00');
  assert.equal(itemLevel({ source: 'routine', triage: 'nothing', deadline: iso('2026-11-23', '10:30') }, { now }), 'P3');
  assert.equal(itemLevel({ source: 'routine', triage: { level: 'nothing' } }, { now }), 'P3');
});

test('a deadline before the next digest interrupts, a later one the same day lands in a digest today', () => {
  const now = on('10:00');
  const nextDigest = on('13:00');
  assert.equal(itemLevel({ source: 'email', deadline: iso('2026-11-23', '12:00') }, { now, nextDigest }), 'P0');
  assert.equal(itemLevel({ source: 'email', deadline: iso('2026-11-23', '16:00') }, { now, nextDigest }), 'P1');
  assert.equal(itemLevel({ source: 'email', deadline: iso('2026-11-26', '16:00') }, { now, nextDigest }), 'P2');
});

test('a missed deadline can no longer be saved by interrupting, so it lands the same day', () => {
  assert.equal(itemLevel({ source: 'email', deadline: iso('2026-11-23', '09:00') }, { now: on('10:00'), nextDigest: on('13:00') }), 'P1');
});

test('without a next digest, a deadline within four hours counts as before it', () => {
  const now = on('10:00');
  assert.equal(itemLevel({ source: 'email', deadline: iso('2026-11-23', '13:30') }, { now }), 'P0');
  assert.equal(itemLevel({ source: 'email', deadline: iso('2026-11-23', '14:30') }, { now }), 'P1');
});

test('a deadline cannot be judged without the time', () => {
  assert.throws(() => itemLevel({ source: 'email', deadline: iso('2026-11-23', '12:00') }), /now/);
});

test('critical work that is stopped on the user interrupts; critical, blocked and stopped work alone wait for today', () => {
  assert.equal(itemLevel({ source: 'agent', triage: 'critical', blocksWork: true }), 'P0');
  assert.equal(itemLevel({ source: 'routine', triage: { level: 'critical', message: 'x' } }), 'P1');
  assert.equal(itemLevel({ source: 'routine', triage: 'blocked' }), 'P1');
  assert.equal(itemLevel({ source: 'agent', blocksWork: true }), 'P1');
});

test('a reminder is for today, and other news waits for a digest', () => {
  assert.equal(itemLevel({ source: 'reminder' }), 'P1');
  assert.equal(itemLevel({ source: 'routine', triage: 'useful' }), 'P2');
  assert.equal(itemLevel({ source: 'email' }), 'P2');
});

test('the next digest is the next moment, tomorrow once today\'s have passed, and unknown with none learned', () => {
  assert.equal(nextDigestAt(moments, on('10:00'), timeZone), on('13:00'));
  assert.equal(nextDigestAt(moments, on('18:00'), timeZone), at('2026-11-24', '09:00'));
  assert.equal(nextDigestAt([], on('10:00'), timeZone), null);
});

test('in a digest\'s own minute, the next digest is a later one and never now or before', () => {
  assert.equal(nextDigestAt(moments, on('13:00') + 30000, timeZone), on('17:00'));
  assert.equal(nextDigestAt(moments, on('13:00'), timeZone), on('17:00'));
  assert.equal(nextDigestAt([{ at: '13:00', why: 'first' }], on('13:00') + 30000, timeZone), at('2026-11-24', '13:00'));
});

const learned = { moments, quiet, timeZone, present: true };

test('P3 is logged and P2 waits for the next digest', () => {
  assert.deepEqual(deliveryFor({ source: 'routine' }, { ...learned, now: on('10:00'), level: 'P3' }),
    { delivery: 'log', level: 'P3', reason: 'P3 is logged only.' });
  assert.deepEqual(deliveryFor({ source: 'routine' }, { ...learned, now: on('10:00'), level: 'P2' }),
    { delivery: 'digest', level: 'P2', reason: 'P2 waits for the next digest.' });
});

test('P1 lands in the next digest today, or at the next pause once no digest is left today', () => {
  assert.equal(deliveryFor({}, { ...learned, now: on('10:00'), level: 'P1' }).delivery, 'digest');
  assert.equal(deliveryFor({}, { ...learned, now: on('17:30'), level: 'P1' }).delivery, 'breakpoint');
  assert.equal(deliveryFor({}, { ...learned, now: on('17:30'), level: 'P1', present: false }).delivery, 'breakpoint');
});

test('P1 waits for the digest when the user is back, before any moment is learned', () => {
  const delivery = deliveryFor({}, { ...learned, moments: [], now: on('17:30'), level: 'P1' });
  assert.equal(delivery.delivery, 'digest');
  assert.match(delivery.reason, /back/);
});

test('nothing but P0 is delivered during an event, or in quiet hours while the user is away', () => {
  const day = { events: [{ start: iso('2026-11-23', '09:45'), end: iso('2026-11-23', '10:30') }] };
  const inMeeting = deliveryFor({}, { ...learned, now: on('10:00'), level: 'P1', day });
  assert.equal(inMeeting.delivery, 'digest');
  assert.match(inMeeting.reason, /event/);
  const atNight = deliveryFor({}, { ...learned, now: on('22:00'), level: 'P1', present: false });
  assert.equal(atNight.delivery, 'digest');
  assert.match(atNight.reason, /quiet hours/);
  assert.equal(deliveryFor({}, { ...learned, now: on('17:30'), level: 'P1', day: { events: [{ start: iso('2026-11-23', '17:00'), end: iso('2026-11-23', '18:00') }] } }).delivery, 'digest');
});

test('P0 waits for an event to end only when the end is near and before its deadline', () => {
  const meeting = end => ({ events: [{ start: iso('2026-11-23', '09:45'), end: iso('2026-11-23', end) }] });
  const soon = deliveryFor({}, { ...learned, now: on('10:00'), level: 'P0', day: meeting('10:10') });
  assert.equal(soon.delivery, 'breakpoint');
  assert.match(soon.reason, /10 minutes/);
  assert.equal(deliveryFor({}, { ...learned, now: on('10:00'), level: 'P0', day: meeting('10:50') }).delivery, 'now');
  assert.equal(deliveryFor({ deadline: iso('2026-11-23', '10:05') }, { ...learned, now: on('10:00'), level: 'P0', day: meeting('10:10') }).delivery, 'now');
});

test('P0 in quiet hours waits only when they end soon', () => {
  assert.equal(deliveryFor({}, { ...learned, now: on('07:50'), level: 'P0', present: false }).delivery, 'now');
  assert.equal(deliveryFor({}, { ...learned, now: on('08:50'), level: 'P0', present: false }).delivery, 'breakpoint');
});

test('P0 goes at the user\'s next pause, now when they are away or its deadline is minutes off', () => {
  assert.equal(deliveryFor({}, { ...learned, now: on('10:00'), level: 'P0' }).delivery, 'breakpoint');
  assert.equal(deliveryFor({}, { ...learned, now: on('10:00'), level: 'P0', present: false }).delivery, 'now');
  assert.equal(deliveryFor({ deadline: iso('2026-11-23', '10:10') }, { ...learned, now: on('10:00'), level: 'P0' }).delivery, 'now');
});

test('the level comes from the item and the next learned digest when none is given', () => {
  const delivery = deliveryFor({ source: 'routine', triage: 'useful', deadline: iso('2026-11-23', '12:00') }, { ...learned, now: on('10:00') });
  assert.equal(delivery.level, 'P0');
  assert.equal(delivery.delivery, 'breakpoint');
  assert.equal(deliveryFor({ source: 'routine', triage: 'useful', deadline: iso('2026-11-23', '14:00') }, { ...learned, now: on('10:00') }).level, 'P1');
});

test('a digest is due when a moment has passed since the last one and the user is on', () => {
  const given = { moments, quiet, timeZone };
  assert.equal(digestDue({ ...given, now: on('13:05'), lastDigest: on('09:02'), present: true }).due, true);
  assert.equal(digestDue({ ...given, now: on('13:05'), present: true }).due, true);
  assert.equal(digestDue({ ...given, now: on('13:05'), lastDigest: on('09:02'), present: false }).due, false);
  assert.equal(digestDue({ ...given, now: on('12:00'), lastDigest: on('09:02'), present: true }).due, false);
  assert.equal(digestDue({ ...given, now: on('10:30'), lastDigest: on('09:40'), present: true }).due, false);
});

test('a digest never comes within two hours of the last one, or during an event', () => {
  const given = { moments, quiet, timeZone, present: true };
  const soon = digestDue({ ...given, now: on('13:30'), lastDigest: on('12:00') });
  assert.equal(soon.due, false);
  assert.match(soon.reason, /two hours/);
  const day = { events: [{ start: iso('2026-11-23', '12:55'), end: iso('2026-11-23', '13:30') }] };
  assert.equal(digestDue({ ...given, now: on('13:05'), lastDigest: on('09:02'), day }).due, false);
});

test('quiet hours never hold back a user who is on', () => {
  assert.equal(digestDue({ moments, quiet, timeZone, present: true, now: on('18:10'), lastDigest: on('13:00') }).due, true);
  const line = deliveryFor({}, { ...learned, now: on('22:00'), level: 'P1' });
  assert.equal(line.delivery, 'breakpoint');
  assert.doesNotMatch(line.reason, /quiet/);
  assert.equal(deliveryFor({}, { ...learned, now: on('07:50'), level: 'P0' }).delivery, 'breakpoint');
});

// A light, irregular user: on three days in two weeks, two hours at a time, at 07:00, 13:00 and 20:00.
const lightNow = at('2026-11-26', '15:00');
const lightDays = [['2026-11-14', '07:00'], ['2026-11-18', '13:00'], ['2026-11-22', '20:00'], ['2026-11-26', '15:00']];
const lightEvents = lightDays.map(([date, time], index) => {
  const previous = lightDays[index - 1];
  return presence(at(date, time), 'first', previous ? at(date, time) - (at(...previous) + 2 * HOUR) : undefined);
});

test('quiet hours need five days on, so three scattered days make none', () => {
  const learned = learnQuietHours(lightEvents, { now: lightNow, days: 14, timeZone });
  assert.deepEqual(learned.hours, []);
  assert.equal(learned.enough, false);
  assert.match(learned.reason, /3 days/);
});

test('quiet hours never cover most of the day: a user on at no regular hour has none', () => {
  const scattered = ['02:00', '07:00', '11:00', '15:00', '19:00', '23:00'].map((first, index) => ({ date: `2026-11-${13 + index}`, first, stop: first.replace(/^\d\d/, hour => String((Number(hour) + 2) % 24).padStart(2, '0')) }));
  const learned = learnQuietHours(workdays(scattered.map(day => ({ ...day, stopOn: day.first === '23:00' ? dayAfter(day.date) : day.date }))), { now: lightNow, days: 14, timeZone });
  assert.deepEqual(learned.hours, []);
  assert.match(learned.reason, /most of the day/);
});

test('a light, irregular user still gets a digest the day something waits', () => {
  const learnedMoments = learnMoments(lightEvents, { now: lightNow, days: 14, timeZone }).moments;
  const learnedQuiet = learnQuietHours(lightEvents, { now: lightNow, days: 14, timeZone }).hours;
  const held = [{ level: 'P1', heldAt: iso('2026-11-26', '14:50') }];
  const due = digestDue({ now: lightNow, moments: learnedMoments, quiet: learnedQuiet, present: true, held, timeZone });
  assert.equal(due.due, true, due.reason);
});

test('anything held a day posts at the user\'s next pause, whatever else holds digests back', () => {
  const given = { moments, quiet, timeZone, present: true, now: on('15:00'), lastDigest: on('14:00') };
  const held = [{ level: 'P2', heldAt: at('2026-11-22', '14:59') }, { level: 'P2', heldAt: on('14:30') }];
  const late = digestDue({ ...given, held });
  assert.equal(late.due, true);
  assert.equal(late.why, 'late');
  assert.equal(digestDue({ ...given, held, atPause: false }).due, false, 'it waits for a pause');
  assert.equal(digestDue({ ...given, held: held.slice(1) }).due, false, 'what waited less waits for the next digest');
});

test('P1 waits no longer than its day: past the day\'s last digest time, past the day itself, or four hours with none learned', () => {
  const given = { quiet, timeZone, present: true };
  // The last digest came late, at 15:30, so the 17:00 one would wait for 17:30. P1 does not.
  const p1 = [{ level: 'P1', heldAt: on('16:00') }];
  assert.equal(digestDue({ ...given, moments, now: on('16:30'), lastDigest: on('15:30'), held: p1 }).due, false);
  assert.equal(digestDue({ ...given, moments, now: on('17:00'), lastDigest: on('15:30'), held: p1 }).why, 'late');
  assert.equal(digestDue({ ...given, moments, now: on('17:00'), lastDigest: on('15:30'), held: [{ level: 'P2', heldAt: on('16:00') }] }).due, false, 'only P1 is for today');
  // With no digest time learned, P1 waits four hours for a return at most.
  assert.equal(digestDue({ ...given, moments: [], now: on('13:00'), lastDigest: on('09:00'), held: [{ level: 'P1', heldAt: on('09:30') }] }).due, false);
  assert.equal(digestDue({ ...given, moments: [], now: on('13:30'), lastDigest: on('09:00'), held: [{ level: 'P1', heldAt: on('09:30') }] }).why, 'late');
  // P1 from yesterday is late, whatever is learned.
  assert.equal(digestDue({ ...given, moments: [], now: at('2026-11-24', '08:00'), lastDigest: on('21:30'), held: [{ level: 'P1', heldAt: on('22:00') }] }).why, 'late');
});

test('before any moment is learned, a digest comes when the user returns after a gap', () => {
  const given = { moments: [], quiet: [], timeZone, present: true, now: on('13:05') };
  assert.equal(digestDue({ ...given, lastDigest: on('09:00'), returned: { kind: 'returned', awayMs: 45 * MINUTE } }).due, true);
  assert.equal(digestDue({ ...given, lastDigest: on('09:00'), returned: { kind: 'returned', awayMs: 10 * MINUTE } }).due, false);
  assert.equal(digestDue({ ...given, lastDigest: on('09:00') }).due, false);
  assert.equal(digestDue({ ...given, lastDigest: on('12:00'), returned: { kind: 'returned', awayMs: HOUR } }).due, false);
});

test('a return is the gap the presence log counts, and the first sighting of the day is one too', () => {
  const given = { moments: [], quiet: [], timeZone, present: true, now: on('13:05') };
  assert.equal(digestDue({ ...given, returned: { kind: 'returned', awayMs: AWAY_GAP_MS } }).why, 'return');
  assert.equal(digestDue({ ...given, returned: { kind: 'returned', awayMs: AWAY_GAP_MS - MINUTE } }).due, false);
  assert.equal(digestDue({ ...given, returned: { kind: 'first' } }).why, 'return', 'a new user\'s first sighting has no time away');
});
