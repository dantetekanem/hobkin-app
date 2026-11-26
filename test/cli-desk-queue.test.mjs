import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize, loadConfig } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { writeBriefState } from '../src/cli/brief.mjs';
import { dayPath } from '../src/cli/day.mjs';
import { deskPath, digestMessage, readHeld, roomLine } from '../src/cli/desk-queue.mjs';
import { readEvents, recordEvent } from '../src/cli/events.mjs';
import { pendingCard } from '../src/cli/pending.mjs';
import { readPending } from '../src/cli/pending-read.mjs';
import { writeMode } from '../src/cli/work/store.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
// Local times in November 2026, because the desk reads the user's own clock.
const local = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const iso = time => new Date(time).toISOString();

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-desk-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const fake = fakePi(root);
  const clock = { at: local(20, 10) };
  const presence = { value: { seenAt: clock.at, away: false, occupied: false } };
  return {
    root,
    clock,
    presence,
    // The user is here and their screen is free, unless a test says otherwise.
    seen: () => { presence.value = { seenAt: clock.at, away: false, occupied: false }; },
    openApp: (options = {}) => HobkinApplication.open(root, { createMain: fake.createMain, now: () => clock.at, intervalMs: HOUR_MS, presence: () => presence.value, ...options }),
    ofType: type => readEvents(root).filter(event => event.type === type),
    written: () => readdirSync(join(root, 'runtime', 'events')).map(name => readFileSync(join(root, 'runtime', 'events', name), 'utf8')).join(''),
    deskOff: () => atomicJson(join(root, 'config.json'), { ...loadConfig(root), desk: { enabled: false } }),
  };
}

const finished = (id, text, at, overrides = {}) => ({
  id,
  kind: 'background',
  scheduleId: id,
  title: `Routine ${id}`,
  status: 'completed',
  startedAt: iso(at - MINUTE_MS),
  finishedAt: iso(at),
  result: { status: 'completed', text },
  ...overrides,
});
// A work run that went critical stops its item until the user acts, so the desk interrupts for it.
const workRun = (id, text, at) => finished(id, text, at, { scheduleId: 'work.site.do', title: 'Site', work: { slug: 'site', lane: 'do', item: 'abc123' } });
const linesIn = (view, words) => view.messages.filter(({ content }) => typeof content === 'string' && content.includes(words));
// The user stays on until `until`, seen every 10 minutes, so no look counts as a return.
async function stayOn(h, app, until) {
  while (h.clock.at < until) {
    h.clock.at += 10 * MINUTE_MS;
    h.seen();
    app.lookForReturn();
    await app.refresh();
  }
}
// The user is away for `ms` and seen again.
function backAfter(h, app, ms) {
  h.clock.at += ms;
  h.seen();
  app.lookForReturn();
}
const digestsIn = view => view.messages.filter(({ digest }) => digest);
const heldLines = root => readHeld(root).map(({ level, content }) => [level, content]);

test('a digest says the point first, then one line per item, those for today first, and marks itself as one row', () => {
  const held = [
    { id: 'notice:report:a', level: 'P2', heldAt: iso(local(20, 9)), notice: { id: 'notice:report:a', content: 'Routine mail: The bank wrote back.\nIt can wait.' } },
    { id: 'notice:reminder:b', level: 'P1', heldAt: iso(local(20, 9, 30)), notice: { id: 'notice:reminder:b', content: 'Reminder for today, from mail: Call the dentist.' } },
    { id: 'notice:remember:c', level: 'P2', heldAt: iso(local(20, 9, 45)), notice: { id: 'notice:remember:c', content: 'Remembered from another session: The user likes tea.', memory: { change: 'x1', name: 'tea', did: 'added' } } },
  ];

  const message = digestMessage(held, { now: local(20, 11) });

  assert.equal(message.content, [
    'Digest: 1 for today, 2 that can wait.',
    '- Reminder for today, from mail: Call the dentist.',
    '- Routine mail: The bank wrote back. It can wait.',
    '- Remembered from another session: The user likes tea.',
  ].join('\n'));
  assert.equal(message.role, 'notice');
  assert.equal(message.at, iso(local(20, 11)));
  assert.match(message.id, /^notice:digest:/);
  assert.deepEqual(message.digest.levels, { P1: 1, P2: 2 });
  assert.deepEqual(message.digest.items.map(({ id, level }) => [id, level]), [['notice:reminder:b', 'P1'], ['notice:report:a', 'P2'], ['notice:remember:c', 'P2']]);
  assert.deepEqual(message.digest.items[2].memory, { change: 'x1', name: 'tea', did: 'added' }, 'a line keeps what lets the window offer its Undo');
  assert.equal(digestMessage(held.slice(0, 1), { now: local(20, 11) }).content.split('\n')[0], 'Digest: 1 that can wait.');
});

test('with P1 work on a day too full, the digest says what to move, least important first, until the day fits', () => {
  const now = local(26, 9);
  const day = {
    workDay: true,
    timezone: null,
    hours: { start: iso(local(26, 9)), end: iso(local(26, 17)) },
    events: [
      { start: iso(local(26, 10)), end: iso(local(26, 13)), withOthers: true },
      { start: iso(local(26, 14)), end: iso(local(26, 15)), withOthers: false },
      { start: iso(local(26, 15)), end: iso(local(26, 16)), withOthers: false },
    ],
  };
  const groups = [{ name: 'read', count: 2 }, { name: 'questions', count: 3 }, { name: 'wrong', count: 1 }];

  // 5 hours of events, 30 minutes to read, 15 of questions, 15 for what went wrong and 15 for the P1 that landed: 375 of 480 minutes is under 80%.
  assert.equal(roomLine({ day, groups, landed: 1, now }), null);
  // Two more P1s make 405, past 384. Reading moves first and frees 30, so 375 fits.
  assert.equal(roomLine({ day, groups, landed: 3, now }), 'Today is too full: about 7 of 8 hours (84%). To make room, move 2 branches to read.');
  // Nine make 495. Reading, then the questions, then the latest block of the user's own, then the one before it, which brings 330.
  assert.equal(roomLine({ day, groups, landed: 9, now }), 'Today is too full: about 8 of 8 hours (103%). To make room, move 2 branches to read, then 3 questions, then your 15:00 block, then your 14:00 block.');
  // Thirteen make 555, and all of that leaves 390.
  assert.equal(roomLine({ day, groups, landed: 13, now }), 'Today is too full: about 9 of 8 hours (116%). To make room, move 2 branches to read, then 3 questions, then your 15:00 block, then your 14:00 block, and it still does not fit.');
  // A block that has begun can no longer move.
  assert.equal(roomLine({ day, groups: [], landed: 13, now: local(26, 14, 30) }), 'Today is too full: about 8 of 8 hours (103%). To make room, move your 15:00 block, and it still does not fit.');
  assert.equal(roomLine({ day, groups, landed: 0, now }), null, 'only P1 work landing asks for room');
  assert.equal(roomLine({ day: { ...day, events: [day.events[0]] }, groups: [{ name: 'wrong', count: 20 }], landed: 2, now }),
    'Today is too full: about 9 of 8 hours (106%). Nothing waiting on you can move to make room.');
});

test('a useful report waits for the next digest, stays in hobkin pending meanwhile, and the digest posts it when the user is back after a gap', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await app.runtime.change(state => { state.runs.mail = finished('mail', 'Useful: The bank wrote back.', h.clock.at); });
    await app.refresh();
    const waiting = await app.refresh();

    assert.deepEqual(linesIn(waiting, 'The bank wrote back'), []);
    assert.deepEqual(heldLines(h.root).filter(([, content]) => content.includes('bank')), [['P2', 'Routine mail: The bank wrote back.']]);
    const card = pendingCard({ held: readHeld(h.root), now: h.clock.at });
    assert.ok(card.groups.find(({ name }) => name === 'held').items.some(({ line }) => line === 'Routine mail: The bank wrote back.'));
    assert.equal(h.ofType('desk_held').filter(({ source }) => source === 'report').length, 1, 'held once, however many refreshes');

    h.clock.at += 40 * MINUTE_MS;
    h.seen();
    app.lookForReturn();
    const back = await app.refresh();

    const [digest] = digestsIn(back);
    assert.ok(digest, 'one digest');
    assert.equal(digestsIn(back).length, 1);
    assert.match(digest.content, /^Digest: /);
    assert.ok(digest.content.split('\n').includes('- Routine mail: The bank wrote back.'));
    assert.deepEqual(readHeld(h.root), []);
    assert.equal(h.ofType('digest_posted').length, 1);
    assert.equal(h.ofType('notice_posted').filter(({ source }) => source === 'digest').length, 1);
    assert.doesNotMatch(h.written(), /bank/);
  } finally {
    await app.close();
  }
});

test('what the user asked for posts at once: a run they started by hand, and the line that says what their yes to a pair did', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await app.runtime.change(state => { state.runs.mail = finished('mail', 'Useful: The bank wrote back.', h.clock.at, { trigger: 'manual' }); });
    writeMode(h.root, { ship: { said: iso(h.clock.at - HOUR_MS), notice: { at: iso(h.clock.at), line: 'Both changes merged here.', asked: true } } });
    const view = await app.refresh();

    assert.deepEqual(linesIn(view, 'The bank wrote back').map(({ content, asked }) => [content, asked]), [['Routine mail: The bank wrote back.', undefined]]);
    assert.equal(linesIn(view, 'Both changes merged here').length, 1);
    assert.deepEqual(readHeld(h.root), []);
    assert.deepEqual(h.ofType('desk_posted'), [], 'an answer to the user is no interruption');
  } finally {
    await app.close();
  }
});

test('a critical report from work posts at once, marked P0', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await app.runtime.change(state => { state.runs.fix = workRun('fix', 'Critical: The tests broke on main.', h.clock.at); });
    const view = await app.refresh();

    assert.deepEqual(linesIn(view, 'The tests broke on main').map(({ level, blocksWork }) => [level, blocksWork]), [['P0', undefined]]);
    assert.deepEqual(h.ofType('desk_posted').map(({ source, level, delivery }) => [source, level, delivery]), [['report', 'P0', 'breakpoint']]);
    assert.deepEqual(heldLines(h.root).filter(([, content]) => content.includes('tests')), []);
  } finally {
    await app.close();
  }
});

test('a P0 waits while the user types, and posts at their next pause', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    app.lookForReturn();
    h.presence.value = { seenAt: h.clock.at, away: false, occupied: true };
    await app.runtime.change(state => { state.runs.fix = workRun('fix', 'Critical: The tests broke on main.', h.clock.at); });
    assert.deepEqual(linesIn(await app.refresh(), 'The tests broke'), []);
    assert.deepEqual(heldLines(h.root), [['P0', 'Site: The tests broke on main.']]);

    h.clock.at += MINUTE_MS;
    h.seen();
    app.lookForReturn();
    const view = await app.refresh();

    assert.deepEqual(linesIn(view, 'The tests broke').map(({ level }) => level), ['P0']);
    assert.deepEqual(readHeld(h.root), []);
  } finally {
    await app.close();
  }
});

test('a P0 waits five minutes at most for a draft to leave the input box', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    app.lookForReturn();
    const typing = () => { h.presence.value = { seenAt: h.clock.at, away: false, occupied: true }; };
    typing();
    await app.runtime.change(state => { state.runs.fix = workRun('fix', 'Critical: The tests broke on main.', h.clock.at); });
    await app.refresh();
    h.clock.at += 4 * MINUTE_MS;
    typing();
    assert.deepEqual(linesIn(await app.refresh(), 'The tests broke'), []);

    h.clock.at += MINUTE_MS;
    typing();
    const view = await app.refresh();

    assert.deepEqual(linesIn(view, 'The tests broke').map(({ level }) => level), ['P0']);
    assert.deepEqual(readHeld(h.root), []);
  } finally {
    await app.close();
  }
});

test('in quiet hours only a P0 reaches Chat while the user is away, and their return brings the rest in a digest', async t => {
  const h = fixture(t);
  // Nine days on from 08:00 to 18:00, so the hours from 18:00 to 08:00 are quiet.
  for (let day = 10; day <= 18; day += 1) recordEvent(h.root, 'presence', { kind: 'first', awayMs: 14 * HOUR_MS }, local(day, 8));
  h.clock.at = local(19, 22, 30);
  writeBriefState(h.root, { lastSeenAt: iso(h.clock.at - HOUR_MS) });
  h.presence.value = { seenAt: h.clock.at - HOUR_MS, away: true, occupied: false };
  const app = await h.openApp();
  try {
    await app.runtime.change(state => {
      state.runs.mail = finished('mail', 'Useful: The bank wrote back.', h.clock.at);
      state.runs.lease = finished('lease', 'Blocked: The lease needs a signature.', h.clock.at);
      state.runs.fix = workRun('fix', 'Critical: The tests broke on main.', h.clock.at);
    });
    const away = await app.refresh();

    assert.deepEqual(linesIn(away, 'The tests broke').map(({ level }) => level), ['P0']);
    assert.deepEqual(linesIn(away, 'bank'), []);
    assert.deepEqual(linesIn(away, 'lease'), []);
    assert.deepEqual(heldLines(h.root).filter(([, content]) => /bank|lease/.test(content)).toSorted(), [['P1', 'Routine lease: The lease needs a signature.'], ['P2', 'Routine mail: The bank wrote back.']]);

    h.clock.at += 40 * MINUTE_MS;
    h.seen();
    app.lookForReturn();
    const [digest] = digestsIn(await app.refresh());

    assert.ok(digest, 'quiet hours never hold back a user who is on');
    assert.ok(digest.content.includes('lease') && digest.content.includes('bank'));
    assert.deepEqual(readHeld(h.root), []);
  } finally {
    await app.close();
  }
});

test('a light, irregular user still gets a digest: three scattered days make no quiet hours', async t => {
  const h = fixture(t);
  // On three days in two weeks, two hours at a time, at 07:00, 13:00 and 20:00.
  recordEvent(h.root, 'presence', { kind: 'first' }, local(14, 7));
  recordEvent(h.root, 'presence', { kind: 'first', awayMs: local(18, 13) - local(14, 9) }, local(18, 13));
  recordEvent(h.root, 'presence', { kind: 'first', awayMs: local(22, 20) - local(18, 15) }, local(22, 20));
  h.clock.at = local(26, 15);
  writeBriefState(h.root, { lastSeenAt: iso(local(22, 22)) });
  h.seen();
  const app = await h.openApp();
  try {
    await app.runtime.change(state => { state.runs.mail = finished('mail', 'Useful: The bank wrote back.', h.clock.at); });
    await app.refresh();
    h.clock.at += MINUTE_MS;
    h.seen();
    app.lookForReturn();
    const [digest] = digestsIn(await app.refresh());

    assert.ok(digest?.content.includes('The bank wrote back'));
    assert.deepEqual(readHeld(h.root), []);
  } finally {
    await app.close();
  }
});

test('before any digest time is learned, P1 waits four hours for a return at most, then comes in a digest at the next pause', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await app.runtime.change(state => { state.runs.lease = finished('lease', 'Blocked: The lease needs a signature.', h.clock.at); });
    await app.refresh();
    const heldAt = h.clock.at;
    // The user stays on all along, never away long enough to count as a return.
    await stayOn(h, app, heldAt + 4 * HOUR_MS - 10 * MINUTE_MS);
    assert.deepEqual(heldLines(h.root), [['P1', 'Routine lease: The lease needs a signature.']]);
    await stayOn(h, app, heldAt + 4 * HOUR_MS);
    const [digest] = digestsIn(await app.refresh());

    assert.ok(digest?.content.includes('The lease needs a signature'));
    assert.deepEqual(h.ofType('digest_posted').map(({ why }) => why), ['late']);
  } finally {
    await app.close();
  }
});

test('a new user\'s first sighting brings a digest of what came in before it', async t => {
  const h = fixture(t);
  h.presence.value = { seenAt: h.clock.at, away: true, occupied: false };
  const app = await h.openApp();
  try {
    await app.runtime.change(state => { state.runs.mail = finished('mail', 'Useful: The bank wrote back.', h.clock.at); });
    await app.refresh();
    assert.deepEqual(heldLines(h.root), [['P2', 'Routine mail: The bank wrote back.']]);

    backAfter(h, app, MINUTE_MS);
    const [digest] = digestsIn(await app.refresh());

    assert.ok(digest?.content.includes('The bank wrote back'));
    assert.deepEqual(h.ofType('presence').map(({ kind, awayMs }) => [kind, awayMs]), [['first', undefined]]);
  } finally {
    await app.close();
  }
});

test('in the first week a 20-minute break brings the digest, the same gap the presence log counts', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await stayOn(h, app, h.clock.at + 10 * MINUTE_MS);
    await app.runtime.change(state => { state.runs.site = finished('site', 'Critical: The site is down.', h.clock.at); });
    await app.refresh();
    assert.deepEqual(heldLines(h.root), [['P1', 'Routine site: The site is down.']]);

    backAfter(h, app, 20 * MINUTE_MS);
    const [digest] = digestsIn(await app.refresh());

    assert.ok(digest?.content.includes('The site is down'));
    assert.deepEqual(h.ofType('digest_posted').map(({ why }) => why), ['return']);
  } finally {
    await app.close();
  }
});

test('a return the two-hour gap held back still brings the digest once the gap is over', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await app.runtime.change(state => { state.runs.mail = finished('mail', 'Useful: The bank wrote back.', h.clock.at); });
    await app.refresh();
    backAfter(h, app, 40 * MINUTE_MS);
    assert.equal(digestsIn(await app.refresh()).length, 1);
    const firstDigest = h.clock.at;

    await stayOn(h, app, h.clock.at + 10 * MINUTE_MS);
    await app.runtime.change(state => { state.runs.rent = finished('rent', 'Useful: Rent is due Friday.', h.clock.at); });
    await app.refresh();
    // Back an hour after the first digest: too soon for another, so the return waits with what is held.
    backAfter(h, app, 40 * MINUTE_MS);
    await app.refresh();
    await stayOn(h, app, firstDigest + 2 * HOUR_MS - 10 * MINUTE_MS);
    assert.deepEqual(heldLines(h.root), [['P2', 'Routine rent: Rent is due Friday.']]);

    await stayOn(h, app, firstDigest + 2 * HOUR_MS);

    assert.deepEqual(readHeld(h.root), []);
    assert.deepEqual(h.ofType('digest_posted').map(({ why }) => why), ['return', 'return']);
  } finally {
    await app.close();
  }
});

test('with the desk turned off in config.json, Chat posts as before, and what it held comes out', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await app.runtime.change(state => { state.runs.mail = finished('mail', 'Useful: The bank wrote back.', h.clock.at); });
    assert.deepEqual(linesIn(await app.refresh(), 'bank'), []);

    h.deskOff();
    await app.runtime.change(state => { state.runs.rent = finished('rent', 'Useful: Rent is due Friday.', h.clock.at); });
    const view = await app.refresh();

    assert.deepEqual(linesIn(view, 'Rent is due').map(({ content, level }) => [content, level]), [['Routine rent: Rent is due Friday.', undefined]]);
    assert.deepEqual(linesIn(view, 'bank').map(({ content }) => content), ['Routine mail: The bank wrote back.']);
    assert.deepEqual(readHeld(h.root), []);
    assert.equal(h.ofType('desk_held').filter(({ source }) => source === 'report').length, 1, 'only the one held before the switch');
  } finally {
    await app.close();
  }
});

test('when the desk cannot work, Chat posts as before', async t => {
  const h = fixture(t);
  mkdirSync(deskPath(h.root), { recursive: true });
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await app.runtime.change(state => { state.runs.mail = finished('mail', 'Useful: The bank wrote back.', h.clock.at); });
    const view = await app.refresh();

    assert.deepEqual(linesIn(view, 'bank').map(({ content }) => content), ['Routine mail: The bank wrote back.']);
  } finally {
    await app.close();
  }
});

test('a desk file that cannot be read is kept aside, not lost, and Chat says so once', async t => {
  const h = fixture(t);
  const torn = '{"version":1,"held":[{"id":"notice:report:x","level":"P2"';
  mkdirSync(join(h.root, 'runtime'), { recursive: true });
  writeFileSync(deskPath(h.root), torn);
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await app.runtime.change(state => { state.runs.mail = finished('mail', 'Useful: The bank wrote back.', h.clock.at); });
    const view = await app.refresh();

    const aside = readdirSync(join(h.root, 'runtime')).filter(name => name.startsWith('desk.unreadable-'));
    assert.equal(aside.length, 1);
    assert.equal(readFileSync(join(h.root, 'runtime', aside[0]), 'utf8'), torn);
    const told = linesIn(view, 'could not be read');
    assert.equal(told.length, 1);
    assert.ok(told[0].content.includes(`runtime/${aside[0]}`));
    assert.deepEqual(heldLines(h.root), [['P2', 'Routine mail: The bank wrote back.']], 'the desk works again');

    const again = await app.refresh();
    assert.equal(linesIn(again, 'could not be read').length, 1, 'said once');
    assert.equal(readdirSync(join(h.root, 'runtime')).filter(name => name.startsWith('desk.unreadable-')).length, 1);
  } finally {
    await app.close();
  }
});

test('a line worked out again on each refresh is held once', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    writeMode(h.root, { harnessLines: [{ key: 'harness:pi', line: 'Pi is missing on this machine.', at: iso(h.clock.at) }] });
    await app.refresh();
    const view = await app.refresh();

    assert.deepEqual(linesIn(view, 'Pi is missing'), []);
    assert.deepEqual(heldLines(h.root).filter(([, content]) => content.includes('Pi is missing')), [['P2', 'Pi is missing on this machine.']]);
    assert.equal(h.ofType('desk_held').filter(({ source }) => source === 'harness').length, 1);
  } finally {
    await app.close();
  }
});

test('a held line worked out again posts once when the desk is turned off', async t => {
  const h = fixture(t);
  const app = await h.openApp();
  try {
    writeMode(h.root, { harnessLines: [{ key: 'harness:pi', line: 'Pi is missing on this machine.', at: iso(h.clock.at) }] });
    await app.refresh();
    assert.deepEqual(heldLines(h.root), [['P2', 'Pi is missing on this machine.']]);

    h.deskOff();
    const view = await app.refresh();

    assert.equal(linesIn(view, 'Pi is missing').length, 1);
  } finally {
    await app.close();
  }
});

test('the digest says what to move when P1 work lands on a day too full', async t => {
  const h = fixture(t);
  const day = new Date(h.clock.at).toLocaleDateString('en-CA');
  // Seven hours of meetings with others and one hour of the user's own after them.
  atomicJson(dayPath(h.root), {
    version: 1, date: day, workDay: true,
    hours: { start: iso(local(20, 9)), end: iso(local(20, 18)) },
    events: [{ start: iso(local(20, 11)), end: iso(local(20, 17)), withOthers: true }, { start: iso(local(20, 17)), end: iso(local(20, 18)), withOthers: false }],
  });
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await app.runtime.change(state => { state.runs.lease = finished('lease', 'Blocked: The lease needs a signature.', h.clock.at); });
    await app.refresh();
    h.clock.at += 40 * MINUTE_MS;
    h.seen();
    app.lookForReturn();
    const [digest] = digestsIn(await app.refresh());

    assert.deepEqual(digest.content.split('\n').slice(0, 2), [
      'Digest: 1 for today.',
      'Today is too full: about 7 of 8 hours (91%). To make room, move your 17:00 block.',
    ]);
  } finally {
    await app.close();
  }
});

test('hobkin pending shows what the desk holds for the next digest', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-desk-pending-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  const heldAt = '2026-01-05T09:00:00.000Z';
  atomicJson(deskPath(root), { version: 1, held: [{ level: 'P2', heldAt, notice: { content: 'Routine mail: The bank wrote back.' } }], posting: [], seen: {}, lastDigestAt: null });

  const held = readPending(root, { now: Date.parse('2026-01-05T10:00:00Z') }).groups.find(({ name }) => name === 'held');

  assert.deepEqual(held?.items, [{ level: 'P2', line: 'Routine mail: The bank wrote back.', at: heldAt }]);
});
