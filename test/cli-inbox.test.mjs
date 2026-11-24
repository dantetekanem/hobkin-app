import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { HobkinApplication } from '../src/cli/application.mjs';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { fileDecision, openDecisions } from '../src/cli/decisions.mjs';
import { main } from '../src/cli/main.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const yesNo = [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }];
const asking = (question, fields = {}) => JSON.stringify({ question, choices: yesNo, ...fields });
const localNoon = (year, month, day) => new Date(year, month - 1, day, 12).getTime();
const noteOf = text => JSON.parse(text.match(/^<hobkin-work>\n(.*)\n<\/hobkin-work>\n\n/)?.[1] ?? '{}');
const systemLines = view => view.messages.filter(({ role }) => role === 'system');
const hobkinLines = view => view.messages.filter(({ id }) => id?.startsWith('notice:'));

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-inbox-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);

  const fake = fakePi(root);
  const clock = { at: localNoon(2026, 11, 3) };
  const runHarness = async () => { throw Error('No agent runs in this test.'); };
  const openApp = () => HobkinApplication.open(root, {
    createMain: fake.createMain,
    runHarness,
    now: () => clock.at,
  });
  return { root, clock, openApp };
}

/** A command another agent runs, in its own session, while hobkin may or may not be open. */
async function hobkin(root, args, stdin = '') {
  const output = { text: '', write(chunk) { this.text += chunk; } };
  await main([...args, '--home', root], output, { input: Readable.from([stdin]) });
  return JSON.parse(output.text);
}

/** What the main agent heard with each message the user sent. A message tried again while the last turn ends is one message, so only the try that went counts. */
async function heardWith(t, app, ...messages) {
  const sent = t.mock.method(app.runtime, 'send');
  const notes = [];
  for (const message of messages) {
    await app.send(message);
    notes.push(noteOf(sent.mock.calls.at(-1).arguments[0]));
  }
  return notes;
}

test('hobkin remind saves a reminder and says when hobkin brings it up', async t => {
  const h = fixture(t);

  const later = await hobkin(h.root, ['remind', 'Renew', 'the', 'passport', '--on', '2099-01-02', '--from', 'Claude Code']);
  const past = await hobkin(h.root, ['remind', 'Car inspection at 10:00', '--on', '2000-01-01']);

  assert.deepEqual([later.ok, later.on], [true, '2099-01-02']);
  assert.match(later.message, /2099-01-02/);
  assert.match(past.message, /now/);
});

test('a date that is not a real YYYY-MM-DD day is refused with what to type, and nothing is saved', async t => {
  const h = fixture(t);
  const output = { write() {} };

  for (const on of ['2026-02-30', 'tomorrow', '11/03/2026']) {
    await assert.rejects(main(['remind', 'Call the bank', '--on', on, '--home', h.root], output), /YYYY-MM-DD/);
  }
  await assert.rejects(main(['remind', 'Call the bank', '--home', h.root], output), /--on/);
  await assert.rejects(main(['remind', '--on', '2026-11-03', '--home', h.root], output), /Usage: hobkin remind/);
  await assert.rejects(main(['remember', '--home', h.root], output), /Usage: hobkin remember/);

  assert.equal(existsSync(join(h.root, 'runtime', 'inbox.jsonl')), false);
});

test('the same words handed twice before hobkin takes them up are saved once', async t => {
  const h = fixture(t);

  const first = await hobkin(h.root, ['remember', 'The user prefers morning appointments', '--from', 'Pi']);
  const again = await hobkin(h.root, ['remember', 'the user prefers  morning appointments.', '--from', 'Claude Code']);
  const reminder = await hobkin(h.root, ['remind', 'Pay rent', '--on', '2099-01-01']);
  const reminderAgain = await hobkin(h.root, ['remind', 'Pay rent', '--on', '2099-01-01']);
  const otherDay = await hobkin(h.root, ['remind', 'Pay rent', '--on', '2099-02-01']);

  assert.equal(again.id, first.id);
  assert.equal(reminderAgain.id, reminder.id);
  assert.notEqual(otherDay.id, reminder.id);
});

test('a folder that is not a hobkin workspace is refused, and nothing is created in it', async t => {
  const parent = mkdtempSync(join(tmpdir(), 'hobkin-inbox-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const refused = (args, input) => assert.rejects(main(args, { write() {} }, { input }), { code: 'ENOENT' });

  await refused(['remember', 'Anything', '--home', join(parent, 'never-created')]);
  await refused(['remind', 'Anything', '--on', '2026-11-03', '--home', parent]);
  await refused(['remember', 'Anything', '--home', parent]);
  await refused(['decide', '--from', 'Pi', '--home', parent], Readable.from([asking('Ok?')]));

  assert.deepEqual(readdirSync(parent), []);
});

test('a home whose upgrade is unfinished is refused by remind, remember and decide, and nothing is written there', async t => {
  const h = fixture(t);
  mkdirSync(join(h.root, 'migration'));
  const files = () => readdirSync(h.root, { recursive: true }).toSorted();
  const before = files();

  await assert.rejects(hobkin(h.root, ['remind', 'Pay rent', '--on', '2026-11-03']), /Migration is incomplete/);
  await assert.rejects(hobkin(h.root, ['remember', 'Rent is due on the 1st']), /Migration is incomplete/);
  await assert.rejects(hobkin(h.root, ['decide', '--from', 'Pi'], asking('Ok?')), /Migration is incomplete/);

  assert.deepEqual(files(), before);
});

test('hobkin decide --from files a question in Decisions that names the session it came from', async t => {
  const h = fixture(t);

  const filed = await hobkin(h.root, ['decide', '--from', 'Claude Code'], asking('Renew the registration in person or by mail?'));

  assert.equal(filed.ok, true);
  assert.deepEqual(openDecisions(h.root).map(({ id, from, answerTo }) => [id, from, answerTo]), [[filed.id, 'Claude Code', { kind: 'outside' }]]);
  assert.match(filed.message, /main agent/, 'the asker learns that the answer goes to hobkin, not back to it');

  await assert.rejects(hobkin(h.root, ['decide'], asking('Ok?')), /--from/);
});

test('a key another session gives stays its own, so it can never change one of hobkin\'s questions', async t => {
  const h = fixture(t);
  fileDecision(h.root, { key: 'pair', from: 'hobkin', question: 'Do these two?', choices: yesNo });

  await hobkin(h.root, ['decide', '--from', 'Pi'], asking('Merge everything?', { key: 'pair' }));

  assert.deepEqual(openDecisions(h.root).map(({ question }) => question).toSorted(), ['Do these two?', 'Merge everything?']);
});

test('a reminder comes up on its day: one system line in Chat, a question in Decisions, and the main agent hears it once', async t => {
  const h = fixture(t);
  await hobkin(h.root, ['remind', 'Car inspection at 10:00', '--on', '2026-11-04', '--from', 'Claude Code']);
  const app = await h.openApp();
  try {
    app.tickInbox();
    const [early] = await heardWith(t, app, 'before its day');

    assert.deepEqual(systemLines(await app.refresh()), []);
    assert.deepEqual(openDecisions(h.root), []);
    assert.equal(early.reminders, undefined);

    h.clock.at = localNoon(2026, 11, 4);
    app.tickInbox();
    app.tickInbox();
    const lines = systemLines(await app.refresh());
    const [question, ...more] = openDecisions(h.root);

    assert.equal(lines.length, 1);
    assert.match(lines[0].content, /^Reminder\b.*Claude Code.*Car inspection at 10:00/);
    assert.deepEqual(more, []);
    assert.equal(question.from, 'Claude Code');
    assert.deepEqual(question.choices.map(({ value }) => value), ['done', 'tomorrow']);

    const [heard, heardAgain] = await heardWith(t, app, 'good morning', 'anything else?');

    assert.deepEqual(heard.reminders.map(({ text, on, from }) => [text, on, from]), [['Car inspection at 10:00', '2026-11-04', 'Claude Code']]);
    assert.equal(heardAgain.reminders, undefined);
  } finally {
    await app.close();
  }
});

test('a reminder for a day already past comes up at once', async t => {
  const h = fixture(t);
  await hobkin(h.root, ['remind', 'Send the tax papers', '--on', '2026-10-01', '--from', 'Pi']);
  const app = await h.openApp();
  try {
    app.tickInbox();

    assert.match(systemLines(await app.refresh())[0].content, /Send the tax papers/);
    assert.equal(openDecisions(h.root).length, 1);
  } finally {
    await app.close();
  }
});

test('a reminder comes up once, even across a restart that lost the saved chat', async t => {
  const h = fixture(t);
  await hobkin(h.root, ['remind', 'Pay rent', '--on', '2026-11-03', '--from', 'Pi']);
  let app = await h.openApp();
  try {
    app.tickInbox();
    assert.equal(systemLines(await app.refresh()).length, 1);
    await heardWith(t, app, 'first');
  } finally {
    await app.close();
  }

  atomicJson(join(h.root, 'runtime/view.json'), { version: 1, messages: [] });
  app = await h.openApp();
  try {
    app.tickInbox();
    const [heard] = await heardWith(t, app, 'after the restart');

    assert.equal(systemLines(await app.refresh()).length, 0);
    assert.equal(openDecisions(h.root).length, 1);
    assert.equal(heard.reminders, undefined);
  } finally {
    await app.close();
  }
});

test('Remind me tomorrow brings it all back on the next day, and Done ends it', async t => {
  const h = fixture(t);
  await hobkin(h.root, ['remind', 'Call the bank', '--on', '2026-11-03', '--from', 'Pi']);
  const app = await h.openApp();
  try {
    app.tickInbox();
    await app.refresh();
    const [first] = openDecisions(h.root);
    await heardWith(t, app, 'today');

    const { message } = await app.workAction('decide', first.id, 'tomorrow');
    app.tickInbox();

    assert.match(message, /tomorrow/);
    assert.deepEqual(openDecisions(h.root), [], 'nothing more today');

    h.clock.at = localNoon(2026, 11, 4);
    app.tickInbox();
    const lines = systemLines(await app.refresh());
    const [second] = openDecisions(h.root);
    const [heard] = await heardWith(t, app, 'the next day');

    assert.equal(lines.length, 2);
    assert.notEqual(second.id, first.id);
    assert.deepEqual(heard.reminders.map(({ on }) => on), ['2026-11-04']);

    await app.workAction('decide', second.id, 'done');
    h.clock.at = localNoon(2026, 11, 5);
    app.tickInbox();

    assert.deepEqual(openDecisions(h.root), []);
    assert.equal(systemLines(await app.refresh()).length, 2);
  } finally {
    await app.close();
  }
});

test('a fact from another session gets one quiet line in Chat, and the main agent hears it once, even across a restart', async t => {
  const h = fixture(t);
  await hobkin(h.root, ['remember', 'The user prefers morning appointments', '--from', 'Claude Code']);
  const noted = view => hobkinLines(view).filter(({ content }) => /prefers morning appointments/.test(content));
  let app = await h.openApp();
  try {
    app.tickInbox();
    const lines = noted(await app.refresh());
    const [heard, heardAgain] = await heardWith(t, app, 'hi', 'and?');

    assert.deepEqual(lines.map(({ role, tone }) => [role, tone]), [['notice', 'quiet']]);
    assert.match(lines[0].content, /Claude Code/);
    assert.deepEqual(heard.remember.map(({ text, from }) => [text, from]), [['The user prefers morning appointments', 'Claude Code']]);
    assert.equal(heardAgain.remember, undefined);
  } finally {
    await app.close();
  }

  app = await h.openApp();
  try {
    const lines = noted(await app.refresh());
    const [heard] = await heardWith(t, app, 'after a restart');

    assert.equal(lines.length, 1);
    assert.equal(heard.remember, undefined);
  } finally {
    await app.close();
  }
});

test('the user\'s answer to a question from another session reaches the main agent once, since that session cannot hear it', async t => {
  const h = fixture(t);
  const choices = [{ value: 'person', label: 'In person' }, { value: 'mail', label: 'By mail' }];
  await hobkin(h.root, ['decide', '--from', 'Claude Code'], asking('Renew the registration in person or by mail?', { choices }));
  const app = await h.openApp();
  try {
    const [asked] = openDecisions(h.root);

    await app.workAction('decide', asked.id, 'mail');
    const [heard, heardAgain] = await heardWith(t, app, 'done with that', 'next');

    assert.deepEqual(openDecisions(h.root), []);
    assert.deepEqual(heard.answered.map(({ question, answer, from }) => [question, answer, from]), [['Renew the registration in person or by mail?', 'By mail', 'Claude Code']]);
    assert.equal(heardAgain.answered, undefined);
  } finally {
    await app.close();
  }
});

test('the main agent hears ten handed-over things at a time, and the rest with the next message', async t => {
  const h = fixture(t);
  for (let index = 0; index < 12; index++) {
    await hobkin(h.root, ['remember', `Fact number ${index}`, '--from', 'Pi']);
  }
  const app = await h.openApp();
  try {
    const [first, second] = await heardWith(t, app, 'first', 'second');

    assert.equal(first.remember.length, 10);
    assert.deepEqual(second.remember.map(({ text }) => text), ['Fact number 10', 'Fact number 11']);
  } finally {
    await app.close();
  }
});

test('hobkin remember saves a memory at once, with where it came from, and the main agent still hears it once', async t => {
  const { readMemories } = await import('../src/cli/memories.mjs');
  const h = fixture(t);
  const saved = await hobkin(h.root, ['remember', 'The user prefers morning appointments', '--from', 'Claude Code']);
  assert.match(saved.message, /^Saved as the memory "the-user-prefers-morning-appointments"/);
  const [memory] = readMemories(h.root).memories;
  assert.deepEqual([memory.name, memory.kind, memory.description], ['the-user-prefers-morning-appointments', 'user', 'The user prefers morning appointments']);
  assert.deepEqual(memory.added.by, { kind: 'outside', title: 'Claude Code' });
  assert.deepEqual(memory.source, { kind: 'remember', said: 'The user prefers morning appointments', from: 'Claude Code' });
  assert.match((await hobkin(h.root, ['remember', 'The user prefers morning appointments', '--from', 'Claude Code'])).message, /^Already saved/);
  assert.equal(readMemories(h.root).memories.length, 1);
  await assert.rejects(hobkin(h.root, ['remember', 'The wifi password: hunter22']), /looks like a secret/);

  const app = await h.openApp();
  try {
    app.tickInbox();
    const lines = hobkinLines(await app.refresh()).filter(({ content }) => /morning appointments/.test(content));
    assert.equal(lines.length, 1);
    assert.match(lines[0].content, /^Remembered from Claude Code: /);
    assert.deepEqual([lines[0].memory.name, lines[0].memory.did], ['the-user-prefers-morning-appointments', 'added']);
    const [heard, heardAgain] = await heardWith(t, app, 'hi', 'and?');
    assert.deepEqual(heard.remember.map(({ text, from, saved: name }) => [text, from, name]),
      [['The user prefers morning appointments', 'Claude Code', 'the-user-prefers-morning-appointments']]);
    assert.equal(heardAgain.remember, undefined);
  } finally {
    await app.close();
  }
});

test('hobkin remember of what another memory already says is handed to the main agent to file, as before', async t => {
  const { addMemory, readMemories } = await import('../src/cli/memories.mjs');
  const h = fixture(t);
  addMemory(h.root, { name: 'mornings', kind: 'preference', description: 'Prefers morning appointments' }, { by: { kind: 'user' } });
  const handed = await hobkin(h.root, ['remember', 'Prefers morning appointments, before ten', '--from', 'Claude Code']);
  assert.match(handed.message, /main agent hears it with the user's next message/);
  assert.equal(readMemories(h.root).memories.length, 1);
});

test('hobkin remember typed inside a run hobkin started becomes a suggestion from that run', async t => {
  const { readMemories } = await import('../src/cli/memories.mjs');
  const { inboxToTell } = await import('../src/cli/inbox.mjs');
  const h = fixture(t);
  const output = { text: '', write(chunk) { this.text += chunk; } };
  await main(['remember', 'Wants CI green before a merge', '--home', h.root], output, { input: Readable.from(['']), env: { HOBKIN_RUN: 'Ship 412' } });
  assert.match(JSON.parse(output.text).message, /^Suggested\./);
  assert.deepEqual(readMemories(h.root).memories, []);
  const [entry] = inboxToTell(h.root, Date.now());
  assert.deepEqual([entry.kind, entry.from, entry.memory.description], ['suggestion', 'Ship 412', 'Wants CI green before a merge']);
});
