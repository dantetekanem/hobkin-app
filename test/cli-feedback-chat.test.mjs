import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { draftFeedback } from '../src/cli/feedback/draft.mjs';
import { createDashboard } from '../src/cli/ui.mjs';

const snapshot = {
  config: { background: { harness: 'pi', model: null, effort: 'medium' } },
  counts: { daily: 0, weekly: 0, monthly: 0 },
  schedules: [],
  reports: [],
  messages: [],
  connection: 'connected',
  runs: [],
  usage: null,
};
const CLIENT = { hobkin_version: '0.1.6', platform: 'darwin', arch: 'arm64', node_version: '24.0.0', harness: 'pi' };
const draft = draftFeedback({ kind: 'bug', message: 'The list froze', id: '33333333-3333-4333-8333-333333333333', now: Date.parse('2026-11-03T12:00:00Z'), client: CLIENT });
const screen = ui => stripTerminalSequences(ui.render(140, 70).join('\n'));

async function until(check) {
  for (let turn = 0; turn < 50 && !check(); turn++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(check(), 'the dashboard got there');
}

function dashboard({ draftFeedback: makeDraft = async () => draft, sendFeedback } = {}) {
  const calls = { drafted: [], sent: [], prompts: [] };
  const ui = createDashboard(snapshot, {
    send: text => { calls.prompts.push(text); },
    draftFeedback: async words => { calls.drafted.push(words); return makeDraft(words); },
    sendFeedback: async approved => { calls.sent.push(approved); return sendFeedback?.(approved) ?? { ok: true, state: 'sent', message: 'Sent. The server keeps it as 55555555.' }; },
  });
  return { ui, calls };
}

const submit = (ui, text) => {
  ui.input(text);
  ui.input('\r');
};

test('/feedback shows the exact draft and its SHA-256, and only a yes sends those bytes', async () => {
  const { ui, calls } = dashboard();
  submit(ui, '/feedback The list froze');
  await until(() => ui.state().focus === 'question');

  const shown = screen(ui);
  for (const line of draft.body.split('\n')) assert.ok(shown.includes(line.trimEnd()), `the box shows ${line}`);
  assert.ok(shown.includes(`SHA-256 ${draft.sha256}`));
  assert.match(shown, /best effort/);
  assert.deepEqual(calls.drafted, ['The list froze']);
  assert.deepEqual(calls.sent, []);

  ui.input('\x1b[B');
  ui.input('\r');
  await ui.pending();

  assert.deepEqual(calls.sent, [draft]);
  assert.equal(ui.state().draft, '');
  assert.match(ui.state().notice, /^Sent\./);
  assert.deepEqual(calls.prompts, []);
  ui.stop();
});

test("Don't send sends nothing and keeps the words, so they can be changed", async () => {
  const { ui, calls } = dashboard();
  submit(ui, '/feedback The list froze');
  await until(() => ui.state().focus === 'question');

  ui.input('\r');
  await ui.pending();

  assert.deepEqual(calls.sent, []);
  assert.equal(ui.state().draft, '/feedback The list froze');
  assert.match(ui.state().notice, /Nothing was sent/);
  ui.stop();
});

test('a draft that cannot be made keeps the words and says why, and asks nothing', async () => {
  const { ui, calls } = dashboard({ draftFeedback: () => { throw Error('Feedback is off, so nothing can be sent.'); } });
  submit(ui, '/feedback The list froze');
  await ui.pending();

  assert.equal(ui.state().focus, 'composer');
  assert.equal(ui.state().draft, '/feedback The list froze');
  assert.match(ui.state().notice, /Feedback failed: Feedback is off/);
  assert.deepEqual(calls.sent, []);
  ui.stop();
});

test('a send the server could not take yet says so, and leaves the composer empty', async () => {
  const { ui } = dashboard({ sendFeedback: () => ({ ok: false, state: 'waiting', message: 'Saved. The server did not take it yet, so hobkin tries again later.' }) });
  submit(ui, '/feedback The list froze');
  await until(() => ui.state().focus === 'question');
  ui.input('\x1b[B');
  ui.input('\r');
  await ui.pending();

  assert.match(ui.state().notice, /tries again later/);
  assert.equal(ui.state().draft, '');
  ui.stop();
});

test('/feedback alone says how to use it and drafts nothing', async () => {
  const { ui, calls } = dashboard();
  submit(ui, '/feedback');
  await ui.pending();

  assert.match(ui.state().notice, /Type \/feedback and what happened/);
  assert.deepEqual(calls.drafted, []);
  assert.deepEqual(calls.prompts, []);
  ui.stop();
});

test('/feedback is one of the commands Tab and the hints offer', () => {
  const { ui } = dashboard();
  ui.input('/fe');
  ui.input('\t');

  assert.equal(ui.state().draft, '/feedback');
  ui.stop();
});
