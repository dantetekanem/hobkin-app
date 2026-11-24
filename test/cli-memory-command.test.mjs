import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import lockfile from 'proper-lockfile';
import { MEMORY_REQUESTS, RUN_MARKER, answerMemoryRequest, runMemoryCommand } from '../src/cli/memory-command.mjs';
import { memoryHandler } from '../src/cli/memory-tools.mjs';
import { addMemory, readMemories } from '../src/cli/memories.mjs';
import { answerRequest, takeRequests, TURN_TOKEN } from '../src/cli/hobkin-tell.mjs';
import { inboxToTell } from '../src/cli/inbox.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');
const TOKEN = 'a'.repeat(32);
const json = value => Readable.from([JSON.stringify(value)]);

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-command-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  addMemory(root, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon', text: 'The user lives in Lisbon.' }, { by: { kind: 'main' }, now: NOW });
  addMemory(root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, { by: { kind: 'main' }, now: NOW });
  return root;
}

/** A running hobkin that knows one durable hobkin's token and answers its memory requests as that hobkin. */
async function runningHobkin(t, root) {
  mkdirSync(join(root, 'runtime'), { recursive: true });
  const release = await lockfile.lock(join(root, 'runtime'), { stale: 300000 });
  const handler = memoryHandler(root, { kind: 'hobkin', id: 'a1b2c3d4', title: 'Deploy watcher' }, { now: () => NOW });
  const asked = [];
  const timer = setInterval(() => {
    for (const { id, request } of takeRequests(root, MEMORY_REQUESTS)) {
      asked.push(request);
      let answer;
      try {
        if (request?.token !== TOKEN) throw Error('Not a turn hobkin is running now.');
        answer = { ok: true, value: answerMemoryRequest(root, handler, request, { now: NOW }) };
      } catch (error) {
        answer = { ok: false, error: error.message };
      }
      answerRequest(root, MEMORY_REQUESTS, id, answer);
    }
  }, 10);
  t.after(async () => {
    clearInterval(timer);
    await release();
  });
  return asked;
}

test('outside a durable turn, hobkin memory reads shared memories from the home and never a private one', async t => {
  const root = home(t);
  const env = {};
  const listed = await runMemoryCommand(root, ['list'], { env, now: NOW });
  assert.match(listed.text, /- lives-in-lisbon: Lives in Lisbon/);
  assert.doesNotMatch(listed.text, /partner|Ana/);
  assert.match((await runMemoryCommand(root, ['get', 'lives-in-lisbon'], { env, now: NOW })).text, /The user lives in Lisbon\./);
  assert.match((await runMemoryCommand(root, ['get', 'partner-name'], { env, now: NOW })).text, /^No memory matches/);
  assert.match((await runMemoryCommand(root, ['search', 'ana'], { env, now: NOW })).text, /^No memory matches/);
  assert.match((await runMemoryCommand(root, ['search', 'lisbon', '--kind', 'user'], { env, now: NOW })).text, /lives-in-lisbon/);
  assert.match((await runMemoryCommand(root, ['list', 'user'], { env: { [RUN_MARKER]: 'Ship 412' }, now: NOW })).text, /lives-in-lisbon/);
  await assert.rejects(runMemoryCommand(root, ['get'], { env }), /^Error: Usage: hobkin memory/);
});

test('outside a durable turn, a save is refused and points at hobkin remember', async t => {
  const root = home(t);
  for (const action of ['add', 'change']) {
    await assert.rejects(runMemoryCommand(root, [action], { env: {}, input: json({ name: 'x-y', kind: 'user', description: 'X' }) }), /use hobkin remember/);
  }
  await assert.rejects(runMemoryCommand(root, ['forget', 'lives-in-lisbon'], { env: {} }), /use hobkin remember/);
  assert.equal(readMemories(root).memories.length, 2);
});

test('inside a durable turn, hobkin memory asks the running hobkin, which reads private ones and saves as that hobkin', async t => {
  const root = home(t);
  const asked = await runningHobkin(t, root);
  const env = { [TURN_TOKEN]: TOKEN };
  assert.match((await runMemoryCommand(root, ['get', 'partner-name'], { env, waitMs: 3000 })).text, /Partner is called Ana/);
  assert.match((await runMemoryCommand(root, ['list'], { env, waitMs: 3000 })).text, /partner-name: Partner is called Ana \(private\)/);
  const added = await runMemoryCommand(root, ['add'], { env, waitMs: 3000, input: json({ name: 'tax-papers', kind: 'pointer', description: 'Tax papers are in ~/Documents/Taxes' }) });
  assert.match(added.text, /^Remembered "tax-papers"/);
  assert.deepEqual(readMemories(root).memories.find(memory => memory.name === 'tax-papers').added.by, { kind: 'hobkin', id: 'a1b2c3d4', title: 'Deploy watcher' });
  assert.match((await runMemoryCommand(root, ['forget', 'tax-papers'], { env, waitMs: 3000 })).text, /^Forgot "tax-papers"/);
  assert.deepEqual(asked.map(request => [request.token, request.action]), [[TOKEN, 'get'], [TOKEN, 'list'], [TOKEN, 'add'], [TOKEN, 'forget']]);
  await assert.rejects(runMemoryCommand(root, ['list'], { env: { [TURN_TOKEN]: 'f'.repeat(32) }, waitMs: 3000 }), /Not a turn hobkin is running now/);
});

test('hobkin memory suggest files an entry in the inbox from the run that typed it', async t => {
  const root = home(t);
  const suggested = await runMemoryCommand(root, ['suggest'], { env: { [RUN_MARKER]: 'Ship 412' }, now: NOW,
    input: json({ kind: 'preference', description: 'Wants CI green before a merge', said: 'only merge when CI is green' }) });
  assert.match(suggested.text, /^Suggested\./);
  const [entry] = inboxToTell(root, NOW);
  assert.deepEqual([entry.kind, entry.from, entry.memory.description], ['suggestion', 'Ship 412', 'Wants CI green before a merge']);
  await assert.rejects(runMemoryCommand(root, ['suggest'], { env: {}, input: Readable.from(['not json']) }), /one JSON object on standard input/);
  await assert.rejects(runMemoryCommand(root, ['suggest'], { env: { [TURN_TOKEN]: TOKEN }, input: json({ kind: 'user', description: 'X' }) }), /hobkin memory add/);
});

test('hobkin memory runs from the command line, takes its own flags and prints its words', async t => {
  const { main } = await import('../src/cli/main.mjs');
  const { initialize } = await import('../src/cli/config.mjs');
  const root = home(t);
  initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  const output = { text: '', write(chunk) { this.text += chunk; } };
  await main(['memory', 'search', 'lisbon', '--kind', 'user', '--home', root], output, { env: {} });
  assert.match(output.text, /^lives-in-lisbon \(about the user\): Lives in Lisbon\n/);
  assert.doesNotMatch(output.text, /partner/);
});
