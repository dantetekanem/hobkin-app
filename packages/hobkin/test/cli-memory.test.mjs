import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../src/cli/context.mjs';
import { readDecided } from '../src/cli/decided.mjs';
import { answerDecision, fileDecision } from '../src/cli/decisions.mjs';
import { recordEvent } from '../src/cli/events.mjs';
import { createMemoryExtension, createMemoryTool, memoryBytes, readMemory } from '../src/cli/memory.mjs';
import { createQuestionTool } from '../src/cli/questions.mjs';
import { recordCardAction } from '../src/cli/work/card-actions.mjs';

function dataRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const memoryFile = root => join(root, 'memory.md');
const change = (root, request) => createMemoryTool(root).execute('memory', request);
const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DECIDED = '## What the user decided lately';

function systemPromptOf(root) {
  let handler;
  createMemoryExtension(root)({ on: (_event, run) => { handler = run; } });
  return handler({ systemPrompt: 'Base prompt.' }).systemPrompt;
}

/** As the Decisions tab answers a question: the answer, and the fact that the user gave it. */
function answeredInDecisions(root, at, { kind = 'routine', value = 'keep', ...asked } = {}) {
  const { id } = fileDecision(root, {
    from: 'Routine gym-check',
    question: 'The gym charged twice this month. Cancel the membership?',
    tldr: 'Cancel the gym membership?',
    choices: [{ value: 'keep', label: 'Keep it' }, { value: 'cancel', label: 'Cancel it' }],
    answerTo: { kind },
    ...asked,
  }, at - MINUTE_MS);
  answerDecision(root, id, value, at);
  recordEvent(root, 'decision_answered', { id, source: kind, ms: MINUTE_MS }, at);
  return id;
}

const merged = (root, title, at) => recordCardAction(root, {
  did: 'merged it locally',
  project: 'api',
  item: `item-${at}`,
  title,
  line: `Merged "${title}" on api.`,
}, at);

test('the agent can add, replace and remove items, and each change comes back as the current list', async t => {
  const root = dataRoot(t);

  await change(root, { action: 'add', text: 'Rent is due November 1' });
  await change(root, { action: 'add', text: 'Waiting on the contractor' });
  await change(root, {
    action: 'replace',
    item: 'Rent is due November 1',
    text: 'Rent for November is paid',
  });
  const removed = await change(root, { action: 'remove', item: 'Waiting on the contractor' });

  assert.deepEqual(removed.details.items, ['Rent for November is paid']);
  assert.match(removed.content[0].text, /1 of 20[\s\S]*- Rent for November is paid/);
  assert.equal(readFileSync(memoryFile(root), 'utf8'), '- Rent for November is paid\n');
  assert.equal(lstatSync(memoryFile(root)).mode & 0o077, 0);
});

test('the list stays short: a full memory refuses more until something is replaced or removed', async t => {
  const root = dataRoot(t);
  writeFileSync(memoryFile(root), Array.from({ length: 20 }, (_, index) => `- Item ${index}`).join('\n'));

  await assert.rejects(change(root, { action: 'add', text: 'One too many' }), /full/i);
  await assert.rejects(change(root, { action: 'add', text: 'x'.repeat(201) }), /Invalid memory change/);

  assert.equal(readMemory(root).length, 20);
});

test('a change must name an exact existing item and stay on one line', async t => {
  const root = dataRoot(t);
  writeFileSync(memoryFile(root), '- Keep this\n');

  await assert.rejects(change(root, { action: 'remove', item: 'Keep' }), /exact text/);
  await assert.rejects(change(root, { action: 'add', text: 'Two\nlines' }), /Invalid memory change/);
  await assert.rejects(change(root, { action: 'replace', item: 'Keep this' }), /Invalid memory change/);

  assert.deepEqual(readMemory(root), ['Keep this']);
});

test('a hand-edited file is honoured without bullets, and agents see at most the bounded list', async t => {
  const root = dataRoot(t);
  assert.deepEqual(readMemory(root), []);

  writeFileSync(memoryFile(root), `\n- Bullet\n* Star\nPlain line\n\n${Array.from({ length: 30 }, (_, index) => `- Extra ${index}`).join('\n')}\n- ${'x'.repeat(300)}\n`);

  const items = readMemory(root);
  assert.deepEqual(items.slice(0, 3), ['Bullet', 'Star', 'Plain line']);
  assert.equal(items.length, 20);

  writeFileSync(memoryFile(root), `- ${'y'.repeat(300)}\n`);
  assert.equal(readMemory(root)[0].length, 200);
});

test('replacing one item keeps hand-edited items beyond the visible bound', async t => {
  const root = dataRoot(t);
  writeFileSync(memoryFile(root), Array.from({ length: 25 }, (_, index) => `- Item ${index}`).join('\n'));

  await change(root, { action: 'remove', item: 'Item 0' });

  assert.equal(readFileSync(memoryFile(root), 'utf8').trim().split('\n').length, 24);
});

test('each turn sees the list as it is now, including edits made between turns', async t => {
  const root = dataRoot(t);
  const handlers = {};
  createMemoryExtension(root)({ on: (event, handler) => { handlers[event] = handler; } });
  const turn = () => handlers.before_agent_start({ systemPrompt: 'Base prompt.' }).systemPrompt;

  assert.match(turn(), /^Base prompt\.[\s\S]*empty/i);

  writeFileSync(memoryFile(root), '- Rent is due November 1\n');

  assert.match(turn(), /^Base prompt\.[\s\S]*- Rent is due November 1/);
});

test('every turn ends with what the user decided lately: Decisions, a card and the agent\'s own question, newest first, by title and with no ids', async t => {
  const root = dataRoot(t);
  const now = Date.now();
  const decision = answeredInDecisions(root, now - 3 * HOUR_MS);
  recordCardAction(root, {
    did: 'said no',
    project: 'api',
    item: 'item-7f3a',
    title: 'Fix the login timeout',
    pr: 'https://example.com/pull/12',
    line: 'Said no to "Fix the login timeout" on api.',
  }, now - 2 * HOUR_MS);
  const restore = {
    question: 'Restore the backup now or wait for Monday?',
    choices: [{ value: 'now', label: 'Restore now' }, { value: 'wait', label: 'Wait for Monday' }],
  };
  await createQuestionTool(async () => 'wait', root).execute('q', restore);

  const prompt = systemPromptOf(root);

  const part = prompt.slice(prompt.indexOf(DECIDED));
  assert.ok(prompt.indexOf('## Current memory') < prompt.indexOf(DECIDED), 'it comes last, after memory');
  const newestToOldest = [restore.question, 'Fix the login timeout', 'Cancel the gym membership?'];
  const places = newestToOldest.map(text => part.indexOf(text));
  assert.ok(places.every(place => place > 0), part);
  assert.deepEqual(places, places.toSorted((left, right) => left - right), 'newest first');
  for (const words of ['Wait for Monday', 'said no', 'on api', 'Routine gym-check', 'Keep it']) assert.ok(part.includes(words), words);
  for (const id of [decision, 'item-7f3a', 'pull/12']) assert.ok(!part.includes(id), id);
});

test('the part holds the newest 20 from the last 14 days', t => {
  const root = dataRoot(t);
  const now = Date.now();
  merged(root, 'Fifteen days ago', now - 15 * DAY_MS);
  for (let index = 0; index < 25; index++) merged(root, `Row ${index}`, now - (25 - index) * MINUTE_MS);

  const lines = readDecided(root, now);

  assert.equal(lines.length, 20);
  assert.match(lines[0], /Row 24/);
  assert.match(lines[19], /Row 5\b/);
  assert.ok(!lines.some(line => line.includes('Fifteen days ago')));
});

test('long lines keep the part within 4 KB, and what is left out is the oldest', t => {
  const root = dataRoot(t);
  const now = Date.now();
  const longTitle = 'a long title '.repeat(30);
  for (let index = 0; index < 20; index++) merged(root, `Row ${index}: ${longTitle}`, now - (20 - index) * MINUTE_MS);

  const lines = readDecided(root, now);

  assert.ok(lines.length > 0 && lines.length < 20, `${lines.length} lines`);
  assert.match(lines[0], /Row 19\b/);
  assert.ok(Buffer.byteLength(lines.map(line => `- ${line}\n`).join('')) <= 4096);
});

test('only the user\'s own answers count: not a question hobkin closed itself, the card about the pile, or the line that sums up a group', t => {
  const root = dataRoot(t);
  const now = Date.now();
  const { id: offer } = fileDecision(root, {
    from: 'Work mode',
    question: 'Merge "Row 1" on api?',
    choices: [{ value: 'later', label: 'Not now' }, { value: 'merge', label: 'Merge it' }],
    answerTo: { kind: 'merge' },
  }, now - 2 * HOUR_MS);
  answerDecision(root, offer, 'later', now - HOUR_MS);
  answeredInDecisions(root, now - HOUR_MS, {
    kind: 'pending',
    question: '5 calls are waiting. Where to start?',
    choices: [{ value: 'later', label: 'Later' }, { value: 'ready', label: 'Start with the ready' }],
    value: 'later',
  });
  recordCardAction(root, { did: 'summed up a group', line: 'Merged 2 of 3 here, with nothing pushed.', heard: true }, now - HOUR_MS);

  assert.deepEqual(readDecided(root, now), []);
  assert.match(systemPromptOf(root), /## What the user decided lately\n\n.+\n\nNothing in the last 14 days\.$/);

  recordCardAction(root, { did: 'stopped your turn', line: 'You stopped hobkin.' }, now - MINUTE_MS);
  const lines = readDecided(root, now);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /stopped your turn/);
});

test('a record that cannot be read costs the turn this part and nothing else', t => {
  const root = dataRoot(t);
  writeFileSync(memoryFile(root), '- Rent is due November 1\n');
  mkdirSync(join(root, 'answers.jsonl'));

  const prompt = systemPromptOf(root);

  assert.match(prompt, /- Rent is due November 1/);
  assert.match(prompt, /Nothing in the last 14 days\.$/);
});

test('a scheduled job receives memory as read-only context beside its instructions', async t => {
  const root = dataRoot(t);
  const schedule = {
    id: 'check',
    title: 'Check',
    cwd: root,
    harness: 'pi',
    model: null,
    context: [],
    prompt: 'Check things.',
  };

  const envelope = JSON.parse(await buildContext(schedule, null, ['Rent is due November 1']));

  assert.deepEqual(envelope.memory, ['Rent is due November 1']);
});

test('memory size covers the shared list and every check, and needs neither to exist', t => {
  const root = dataRoot(t);
  assert.equal(memoryBytes(root), 0);

  writeFileSync(memoryFile(root), 'x'.repeat(100));
  mkdirSync(join(root, 'checks/email'), { recursive: true });
  mkdirSync(join(root, 'checks/calendar'), { recursive: true });
  writeFileSync(join(root, 'checks/email/memory.md'), 'x'.repeat(2000));
  writeFileSync(join(root, 'checks/email/log.md'), 'x'.repeat(9000));

  assert.equal(memoryBytes(root), 2100);
});
