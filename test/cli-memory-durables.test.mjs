import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as wait } from 'node:timers/promises';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { durableDirections } from '../src/cli/hobkins.mjs';
import { addMemory, changeMemory, readMemories } from '../src/cli/memories.mjs';
import { runMemoryCommand } from '../src/cli/memory-command.mjs';
import { TURN_TOKEN } from '../src/cli/hobkin-tell.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const NOW = Date.parse('2026-11-23T14:00:00Z');
const as = { by: { kind: 'user' }, source: { kind: 'window' } };

function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-durable-')));
  const opened = [];
  t.after(async () => {
    await Promise.all(opened.map(app => app.close()));
    rmSync(root, { recursive: true, force: true });
  });
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const calls = [];
  const open = async () => {
    const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 60000, now: () => NOW, runHarness: async (request, options) => {
      if (request.purpose !== 'durable' || request.warm) return request.warm ? { status: 'warmed' } : { status: 'failed', cost: null, error: 'Not in this test.' };
      const call = { request, options, end: Promise.withResolvers() };
      request.signal?.addEventListener('abort', () => call.end.resolve({ status: 'interrupted', text: '', error: 'Harness cancelled.', cost: null }), { once: true });
      calls.push(call);
      return call.end.promise;
    } });
    opened.push(app);
    return app;
  };
  return { root, calls, open };
}

async function until(check, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw Error('Timed out waiting.');
    await wait(5);
  }
}

test("a durable hobkin's directions carry the index with private memories, it remembers as itself, and a change reaches its next turn as a note", { timeout: 10000 }, async t => {
  const h = home(t);
  addMemory(h.root, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon' }, as);
  addMemory(h.root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, as);
  const app = await h.open();
  const { id } = await app.hobkins.start({ text: 'Plan the trip.', cwd: h.root, engine: { kind: 'tier', tier: 'mid' }, title: 'Trip planner' });
  await until(() => h.calls.length === 1);
  const [first] = h.calls;
  assert.ok(first.request.directions.startsWith(durableDirections(id).trimEnd()), 'its own directions come first');
  assert.match(first.request.directions, /\n## What hobkin remembers\n[\s\S]*- lives-in-lisbon: Lives in Lisbon\n/);
  assert.match(first.request.directions, /- partner-name: Partner is called Ana \(private\)/);
  assert.match(first.request.directions, /hobkin_recall/);
  assert.equal(first.request.memories, 'keeper');
  assert.equal(first.request.prompt, 'Plan the trip.');

  assert.match((await first.options.memories.recall({ words: 'ana' })).text, /partner-name/);
  await first.options.memories.remember({ action: 'add', name: 'trip-in-march', kind: 'date', description: 'A trip to Porto in March' });
  assert.deepEqual(readMemories(h.root).memories.find(memory => memory.name === 'trip-in-march').added.by, { kind: 'hobkin', id, title: 'Trip planner' });
  changeMemory(h.root, 'lives-in-lisbon', { description: 'Lives in Lisbon since 2025' }, as);
  first.end.resolve({ status: 'completed', text: 'Planned.', cost: null });
  await until(async () => (await app.hobkins.read(id)).hobkin.state === 'waiting');

  await app.hobkins.say(id, { text: 'And the hotel?' });
  await until(() => h.calls.length === 2);
  const [, second] = h.calls;
  assert.equal(second.request.directions, first.request.directions, 'its start stays as it was, so a kept process is kept');
  assert.match(second.request.prompt, /^<hobkin-since>\nMemories added or changed since:\n- lives-in-lisbon: Lives in Lisbon since 2025\n- trip-in-march: A trip to Porto in March\n<\/hobkin-since>\n\nAnd the hotel\?$/);
  second.end.resolve({ status: 'completed', text: 'Booked.', cost: null });
  await until(async () => (await app.hobkins.read(id)).hobkin.state === 'waiting');
  await app.hobkins.say(id, { text: 'Thanks.' });
  await until(() => h.calls.length === 3);
  assert.equal(h.calls[2].request.prompt, 'Thanks.', 'a note is told once');
  h.calls[2].end.resolve({ status: 'completed', text: 'Welcome.', cost: null });
});

test('a durable hobkin on Claude Code reads and saves with hobkin memory in its turn, private ones too, and its token names it only while the turn runs', { timeout: 10000 }, async t => {
  const h = home(t);
  addMemory(h.root, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, as);
  const app = await h.open();
  const { id } = await app.hobkins.start({ text: 'Review the diff.', cwd: h.root, engine: { kind: 'claude' }, title: 'Reviewer' });
  await until(() => h.calls.length === 1);
  const [{ request }] = h.calls;
  assert.match(request.directions, /`hobkin memory get <name>`/);
  const env = { [TURN_TOKEN]: request.env[TURN_TOKEN] };
  const command = async (args, input) => {
    const ticking = setInterval(() => { void app.hobkins.tick(); }, 20);
    try {
      return await runMemoryCommand(h.root, args, { env, input, waitMs: 3000 });
    } finally {
      clearInterval(ticking);
    }
  };
  assert.match((await command(['get', 'partner-name'])).text, /Partner is called Ana/);
  const saved = await command(['add'], Readable.from([JSON.stringify({ name: 'reviews-short', kind: 'preference', description: 'Wants short reviews' })]));
  assert.match(saved.text, /^Remembered "reviews-short"/);
  assert.deepEqual(readMemories(h.root).memories.find(memory => memory.name === 'reviews-short').added.by, { kind: 'hobkin', id, title: 'Reviewer' });
  h.calls[0].end.resolve({ status: 'completed', text: 'Reviewed.', cost: null });
  await until(async () => (await app.hobkins.read(id)).hobkin.state === 'waiting');
  await assert.rejects(command(['list']), /not a turn hobkin is running now/);
});

test("a durable hobkin's directions carry the user's own directions with their name line, and one that cannot be read costs only that part", { timeout: 10000 }, async t => {
  const { updateProfile } = await import('../src/cli/profile.mjs');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const h = home(t);
  updateProfile(h.root, { name: 'Sam' });
  writeFileSync(join(h.root, 'AGENTS.md'), 'Answer in plain words.\n');
  const app = await h.open();
  const { id } = await app.hobkins.start({ text: 'Plan the trip.', cwd: h.root, engine: { kind: 'tier', tier: 'mid' } });
  await until(() => h.calls.length === 1);
  const { directions } = h.calls[0].request;
  assert.ok(directions.startsWith(durableDirections(id).trimEnd()));
  assert.match(directions, /\n## Directions\n\nThese are the user's standing directions[\s\S]*The user's name is Sam\.[\s\S]*Answer in plain words\./);
  h.calls[0].end.resolve({ status: 'completed', text: 'Planned.', cost: null });
  await until(async () => (await app.hobkins.read(id)).hobkin.state === 'waiting');

  rmSync(join(h.root, 'AGENTS.md'));
  mkdirSync(join(h.root, 'AGENTS.md'));
  const other = await app.hobkins.start({ text: 'Again.', cwd: h.root, engine: { kind: 'tier', tier: 'mid' } });
  await until(() => h.calls.length === 2);
  assert.equal(h.calls[1].request.directions, durableDirections(other.id), 'directions that cannot be read leave its own as they were');
  h.calls[1].end.resolve({ status: 'completed', text: 'Done.', cost: null });
});
