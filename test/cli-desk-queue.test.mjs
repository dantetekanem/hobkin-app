import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize, loadConfig } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { writeBriefState } from '../src/cli/brief.mjs';
import { deskPath, digestMessage, readHeld } from '../src/cli/desk-queue.mjs';
import { readEvents, recordEvent } from '../src/cli/events.mjs';
import { pendingCard } from '../src/cli/pending.mjs';
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

test('in quiet hours only a P0 reaches Chat, and a return brings no digest', async t => {
  const h = fixture(t);
  // Nine days on from 08:00 to 18:00, so the hours from 18:00 to 08:00 are quiet.
  for (let day = 10; day <= 18; day += 1) recordEvent(h.root, 'presence', { kind: 'first', awayMs: 14 * HOUR_MS }, local(day, 8));
  h.clock.at = local(19, 22, 30);
  h.seen();
  writeBriefState(h.root, { lastSeenAt: iso(h.clock.at - HOUR_MS) });
  const app = await h.openApp();
  try {
    app.lookForReturn();
    await app.runtime.change(state => {
      state.runs.mail = finished('mail', 'Useful: The bank wrote back.', h.clock.at);
      state.runs.lease = finished('lease', 'Blocked: The lease needs a signature.', h.clock.at);
      state.runs.fix = workRun('fix', 'Critical: The tests broke on main.', h.clock.at);
    });
    await app.refresh();
    h.clock.at += 40 * MINUTE_MS;
    h.seen();
    app.lookForReturn();
    const view = await app.refresh();

    assert.deepEqual(linesIn(view, 'The tests broke').map(({ level }) => level), ['P0']);
    assert.deepEqual(linesIn(view, 'bank'), []);
    assert.deepEqual(linesIn(view, 'lease'), []);
    assert.deepEqual(digestsIn(view), []);
    assert.deepEqual(heldLines(h.root).filter(([, content]) => /bank|lease/.test(content)).toSorted(), [['P1', 'Routine lease: The lease needs a signature.'], ['P2', 'Routine mail: The bank wrote back.']]);
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
