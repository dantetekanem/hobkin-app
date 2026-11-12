import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTurnMetrics } from '../src/cli/turn-metrics.mjs';

const owner = { runId: 'run-one', sessionId: 'session-one' };
const usage = { input: 10, output: 4, cacheRead: 2, cacheWrite: 3, cost: { total: 0.25 } };
const message = (timestamp = 1, fields = {}) => ({
  role: 'assistant', api: 'test', provider: 'test', model: 'test', timestamp,
  content: [{ type: 'text', text: 'PRIVATE ANSWER' }], stopReason: 'stop', usage, durationMs: 20, ...fields,
});
const end = msg => ({ type: 'message_end', message: msg });
const delta = (type, text = '') => ({ type: 'message_update', message: message(),
  assistantMessageEvent: { type, delta: text, contentIndex: 0, partial: message() } });
function fixture() {
  let time = 100;
  const metrics = createTurnMetrics({ ...owner, now: () => time });
  return { metrics, time: value => { time = value; }, observe: event => metrics.observe(event, owner), finish: () => metrics.finish(owner) };
}

test('observes the first nonempty generated delta, not message or content starts', () => {
  for (const type of ['text_delta', 'thinking_delta', 'toolcall_delta']) {
    const f = fixture();
    f.time(110);
    f.observe({ type: 'message_start', message: message() });
    f.observe(delta('text_start'));
    f.observe(delta(type));
    f.time(130);
    f.observe(delta(type, 'PRIVATE GENERATION'));
    f.time(160);
    f.observe(delta(type, 'later'));
    const record = f.finish();
    assert.equal(record.firstObservedOutputMs, 30);
    assert.equal(record.dispatchElapsedMs, 60);
    assert.equal(record.responseDurationMs.value, null);
  }
});

test('sums distinct final responses once including reconstructed replay and real zero', () => {
  const f = fixture();
  const first = message(1, { responseId: 'response-one' });
  f.observe(end(first));
  f.observe(end(structuredClone(first)));
  f.observe(end(message(2, { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, durationMs: 0 })));
  f.observe({ type: 'turn_end', message: first });
  const record = f.finish();
  assert.equal(record.responses, 2);
  for (const [key, expected] of Object.entries({ input: 10, output: 4, cacheRead: 2, cacheWrite: 3, estimatedUsd: 0.25, responseDurationMs: 20 })) {
    assert.deepEqual(record[key], { value: expected, state: 'complete' });
  }
  assert.equal(record.firstObservedOutputMs, null);
});

test('conflicting fallback identity is incomplete rather than silently complete', () => {
  const f = fixture();
  f.observe(end(message(1)));
  f.observe(end(message(1, { usage: { ...usage, input: 99 } })));
  const record = f.finish();
  assert.equal(record.responses, 1);
  assert.equal(record.incomplete, true);
  assert.deepEqual(record.input, { value: 10, state: 'partial' });
});

test('whitespace is generated output and a finalized request closes its pending lifecycle', () => {
  const f = fixture();
  f.observe({ type: 'message_start', message: message() });
  f.time(105);
  f.observe(delta('text_delta', ' '));
  f.observe(end(message(1, { responseId: 'id-arriving-after-start' })));
  assert.equal(f.finish().firstObservedOutputMs, 5);
  assert.equal(f.finish().incomplete, false);
});

test('missing and invalid facts remain unavailable or partial, even on interruption', () => {
  const f = fixture();
  f.observe(end(message(1)));
  f.observe(end(message(2, { stopReason: 'aborted', durationMs: undefined,
    usage: { input: 0, output: -1, cacheRead: NaN, cacheWrite: undefined, cost: { total: Infinity } } })));
  const record = f.finish();
  assert.deepEqual(record.input, { value: 10, state: 'complete' });
  for (const key of ['output', 'cacheRead', 'cacheWrite', 'estimatedUsd', 'responseDurationMs']) assert.equal(record[key].state, 'partial');
  const empty = fixture().finish();
  assert.deepEqual(empty.estimatedUsd, { value: null, state: 'unavailable' });
  assert.equal(empty.firstObservedOutputMs, null);
});

test('an interrupted response without final usage makes earlier totals partial', () => {
  const f = fixture();
  f.observe(end(message(1)));
  f.observe({ type: 'message_start', message: message(2, { usage: undefined }) });
  f.observe(end(message(1))); // Replay cannot close the newer unfinished response.
  const record = f.finish();
  assert.equal(record.incomplete, true);
  assert.deepEqual(record.input, { value: 10, state: 'partial' });
  assert.equal(record.responses, 1);
});

test('snapshots live facts without sealing and defer to the frozen final record', () => {
  const f = fixture();
  f.time(110);
  f.observe({ type: 'message_start', message: message() });
  const live = f.metrics.snapshot(owner);
  assert.equal(live.incomplete, true);
  assert.deepEqual(live.input, { value: null, state: 'unavailable' });
  assert.equal(live.dispatchElapsedMs, 10);
  assert.equal(f.metrics.snapshot({ ...owner, runId: 'foreign' }), null);
  f.time(120);
  f.observe(end(message()));
  const updated = f.metrics.snapshot(owner);
  assert.notEqual(updated, live);
  assert.equal(updated.incomplete, false);
  assert.deepEqual(updated.input, { value: 10, state: 'complete' });
  assert.equal(live.responses, 0);
  assert.equal(live.dispatchElapsedMs, 10);
  const final = f.metrics.record('/dev/null/no-write', owner);
  assert.equal(f.metrics.snapshot(owner), final);
  f.time(150);
  assert.equal(f.metrics.snapshot(owner), final);
});

test('rejects foreign identities and nonassistant messages and seals immutable facts', () => {
  const f = fixture();
  for (const identity of [undefined, { ...owner, runId: 'foreign' }, { ...owner, sessionId: 'foreign' }]) {
    f.metrics.observe(end(message()), identity);
    f.metrics.observe(delta('text_delta', 'secret'), identity);
    assert.equal(f.metrics.finish(identity), null);
  }
  f.observe(end({ role: 'toolResult', usage, timestamp: 1 }));
  const record = f.finish();
  f.time(200);
  f.observe(end(message()));
  assert.equal(f.finish(), record);
  assert.equal(record.responses, 0);
  assert.throws(() => { record.input.value = 123; }, TypeError);
  assert.equal(record.dispatchElapsedMs, 0);
  assert.throws(() => createTurnMetrics({ runId: '', sessionId: 's' }), /identit/i);
});

test('bounds dedup memory and discloses missing response identity without inventing totals', () => {
  const f = fixture();
  f.observe(end(message(undefined, { timestamp: undefined })));
  for (let i = 0; i < 1025; i++) f.observe(end(message(i)));
  const record = f.finish();
  assert.equal(record.responses, 1024);
  assert.equal(record.incomplete, true);
  assert.equal(record.input.state, 'partial');
});

test('records only the frozen allowlisted facts locally once and survives write failure', t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-metrics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture();
  f.observe({ ...end(message()), rawReceipt: 'SECRET RECEIPT', args: { secret: 'SECRET ARG' } });
  assert.equal(f.metrics.record(root, { ...owner, runId: 'foreign' }), null);
  const record = f.metrics.record(root, owner);
  assert.equal(f.metrics.record(root, owner), record);
  const folder = join(root, 'runtime', 'events');
  const lines = readFileSync(join(folder, readdirSync(folder)[0]), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const saved = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(saved).sort(), ['at', 'type', ...Object.keys(record)].sort());
  assert.equal(saved.type, 'run_performance');
  assert.equal(saved.runId, owner.runId);
  assert.equal(saved.sessionId, owner.sessionId);
  assert.doesNotMatch(lines[0], /PRIVATE|SECRET|content|responseId|provider|model|stopReason/);
  assert.doesNotThrow(() => fixture().metrics.record('/dev/null/no-write', owner));
});

test('updates an existing pending request when the pending set is at capacity', () => {
  const f = fixture();
  for (let timestamp = 0; timestamp < 1024; timestamp++) {
    f.observe({ type: 'message_start', message: message(timestamp) });
  }
  f.observe({ type: 'message_update', message: message(0),
    assistantMessageEvent: { type: 'text_delta', delta: 'generated' } });
  for (let timestamp = 0; timestamp < 1024; timestamp++) f.observe(end(message(timestamp)));
  const record = f.finish();
  assert.equal(record.responses, 1024);
  assert.equal(record.incomplete, false);
  assert.deepEqual(record.input, { value: 10240, state: 'complete' });
});

test('marks the 1025th distinct pending request incomplete', () => {
  const f = fixture();
  for (let timestamp = 0; timestamp < 1025; timestamp++) {
    f.observe({ type: 'message_start', message: message(timestamp) });
  }
  for (let timestamp = 0; timestamp < 1024; timestamp++) f.observe(end(message(timestamp)));
  const record = f.finish();
  assert.equal(record.responses, 1024);
  assert.equal(record.incomplete, true);
  assert.deepEqual(record.input, { value: 10240, state: 'partial' });
});
