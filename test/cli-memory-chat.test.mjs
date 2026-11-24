import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, initialize } from '../src/cli/config.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { memoryList, memorySave, memoryUndo } from '../src/cli/memory-window.mjs';
import { fakePi } from './helpers/pi-session.mjs';

async function open(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-memory-chat-')));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  config.main.model = 'fixture/local';
  config.background.model = 'fixture/check';
  atomicJson(join(root, 'config.json'), config);
  const app = await HobkinApplication.open(root, { createMain: fakePi(root).createMain, intervalMs: 60000,
    runHarness: async () => ({ status: 'failed', cost: null, error: 'Not in this test.' }) });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, app };
}

const memoryLines = view => view.messages.filter(message => message.memory);

test('a memory an agent changes gets one quiet line in Chat with the change to undo, and one the user changes in the window gets none', async t => {
  const { root, app } = await open(t);
  const main = app.memoryKeeper({ kind: 'main' });
  const added = await main.remember({ action: 'add', name: 'car-insurance', kind: 'date', description: 'Car insurance renews every March 3' });
  const durable = app.memoryKeeper({ kind: 'hobkin', id: 'a1b2c3d4', title: 'Trip planner' });
  await durable.remember({ action: 'change', name: 'car-insurance', text: 'Bring it up two weeks before.' });
  let lines = memoryLines(await app.refresh());
  assert.deepEqual(lines.map(({ role, tone, content, memory }) => [role, tone, content, memory.name, memory.did]), [
    ['notice', 'quiet', 'hobkin remembered: Car insurance renews every March 3', 'car-insurance', 'added'],
    ['notice', 'quiet', 'Trip planner changed: Car insurance renews every March 3', 'car-insurance', 'changed'],
  ]);
  assert.equal(lines[0].memory.change, added.change);
  assert.equal(memoryLines(await app.refresh()).length, 2, 'each line is posted once');

  assert.deepEqual(memoryUndo(root, { change: lines[1].memory.change }), { ok: true }, "the line's change is what Undo takes");
  memorySave(root, { description: 'Prefers trains', kind: 'preference' });
  lines = memoryLines(await app.refresh());
  assert.equal(lines.length, 2, 'the window says its own changes itself');
  assert.equal(memoryList(root).memories.length, 2);
});

test("the snapshot's memoriesStamp moves when a memory or the right-now list changes", async t => {
  const { root, app } = await open(t);
  const before = (await app.refresh()).memoriesStamp;
  assert.match(before, /^[0-9a-f]{16}$/);
  assert.equal((await app.refresh()).memoriesStamp, before);
  memorySave(root, { description: 'Prefers trains', kind: 'preference' });
  const after = (await app.refresh()).memoriesStamp;
  assert.notEqual(after, before);
});
