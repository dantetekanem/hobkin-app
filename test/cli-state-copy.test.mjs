import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initialize } from '../src/cli/config.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';

async function open(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-state-copy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = await HobkinRuntime.open(root, initialize(root, { cwd: root }), {
    createMain: async () => { throw Error('This test opens no main session.'); },
  });
  t.after(() => runtime.close());
  return runtime;
}

// How many times a read encodes the runtime's own document. pi-durable encodes small addresses of its own on the way.
async function encodingsWhile(t, read) {
  const stringify = t.mock.method(JSON, 'stringify');
  try {
    const result = await read();
    const encodings = stringify.mock.calls.filter(({ arguments: [value] }) => value?.runs !== undefined && value?.evidenceReceipts !== undefined);
    return { result, encodings: encodings.length };
  } finally {
    stringify.mock.restore();
  }
}

test('reading the state again with nothing committed does not encode it again, and every read is a copy of its own', async t => {
  const runtime = await open(t);
  await runtime.change(state => { state.evidenceReceipts = { first: true }; });
  const first = await runtime.state();
  const { result: second, encodings } = await encodingsWhile(t, () => runtime.state());
  assert.equal(encodings, 0, 'nothing was committed, so the last encoding serves');
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
  first.evidenceReceipts.first = false;
  first.runs.edited = { id: 'edited' };
  const third = await runtime.state();
  assert.equal(third.evidenceReceipts.first, true, 'changing one copy leaves the next untouched');
  assert.equal(third.runs.edited, undefined);
});

test('a commit shows in the next read, which encodes the new document once', async t => {
  const runtime = await open(t);
  await runtime.state();
  await runtime.change(state => { state.evidenceReceipts = { ...state.evidenceReceipts, later: true }; });
  const { result, encodings } = await encodingsWhile(t, () => runtime.state());
  assert.equal(result.evidenceReceipts.later, true);
  assert.equal(encodings, 1);
  await runtime.change(state => { delete state.evidenceReceipts.later; });
  assert.equal((await runtime.state()).evidenceReceipts.later, undefined);
});

test('the run index gives each run\'s bookkeeping without its prompt or result, the same until a commit and never encoded', async t => {
  const runtime = await open(t);
  await runtime.change(state => {
    state.runs.check = { id: 'check', kind: 'background', scheduleId: 'mail', scheduledAt: '2026-01-02T09:00:00.000Z',
      status: 'running', prompt: 'PROMPT', result: { text: 'RESULT' }, work: { slug: 'site' } };
    state.runs.turn = { id: 'turn', kind: 'main', status: 'completed', hobkin: 'friend', prompt: 'PROMPT' };
  });
  const { result: index, encodings } = await encodingsWhile(t, () => runtime.runIndex());
  assert.equal(encodings, 0);
  assert.deepEqual(index, { runs: {
    check: { id: 'check', kind: 'background', status: 'running', scheduleId: 'mail', scheduledAt: '2026-01-02T09:00:00.000Z', work: true, hobkin: false },
    turn: { id: 'turn', kind: 'main', status: 'completed', scheduleId: undefined, scheduledAt: undefined, work: false, hobkin: true },
  }, evidenceDue: true });
  assert.equal(await runtime.runIndex(), index, 'nothing was committed');
  assert.throws(() => { index.runs.check.status = 'changed'; }, TypeError, 'an index is read, never written');

  await runtime.change(state => { state.runs.check.status = 'completed'; });
  assert.equal((await runtime.runIndex()).runs.check.status, 'completed');
  assert.equal(index.runs.check.status, 'running', 'an index handed out is never changed');
  assert.equal((await runtime.state()).runs.check.status, 'completed', 'the document itself is untouched');
});
