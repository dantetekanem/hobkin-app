import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HobkinRuntime } from '../src/cli/runtime.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-main-metrics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = new HobkinRuntime(root, {});
  let clock = 100;
  runtime.metricsNow = () => clock++;
  const state = { runs: {} };
  runtime.state = async () => structuredClone(state);
  runtime.change = async update => update(state);
  const listeners = new Set();
  const gate = Promise.withResolvers();
  const session = {
    sessionId: 'session:old', messages: [], isStreaming: false,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSessionStats() { return { sessionId: this.sessionId, cost: 1 }; },
    async prompt(text, { preflightResult }) {
      if (text === 'refuse') { preflightResult(false); throw Error('Refused'); }
      preflightResult(text === '/handled' ? 'handled' : 'started');
      if (text === '/handled') return;
      this.isStreaming = true;
      await gate.promise;
      this.isStreaming = false;
    },
    async steer() {},
    async clearQueue() { return { steering: ['correction'], followUp: [] }; },
    async abort() { gate.resolve(); },
  };
  runtime.main = session;
  const emit = event => { for (const listener of listeners) listener(event); };
  const message = (timestamp, output = 2) => ({ role: 'assistant', provider: 'fixture', model: 'local', timestamp,
    stopReason: 'stop', content: [{ type: 'text', text: 'private reply' }], durationMs: 4,
    usage: { input: 3, output, cacheRead: 0, cacheWrite: 1, cost: { total: 0.25 } } });
  return { runtime, state, session, gate, listeners, emit, message, root };
}

const options = { timeout: 5000 };

test('main scalar facts own multiple responses and steering, never a selected replacement session', options, async t => {
  const h = fixture(t);
  await h.runtime.send('private prompt', 'turn:1');
  const captured = [...h.listeners][0];
  const first = h.message(1);
  h.emit({ type: 'message_start', message: first });
  h.emit({ type: 'message_update', message: first, assistantMessageEvent: { type: 'thinking_delta', delta: 'private thought' } });
  h.emit({ type: 'message_end', message: first });
  await h.runtime.send('correction', 'steering:1');
  const second = h.message(2, 5);
  h.emit({ type: 'message_end', message: second });
  h.emit({ type: 'message_end', message: structuredClone(second) });
  h.session.messages.push(second);
  h.runtime.main = { sessionId: 'session:replacement' };
  h.gate.resolve();
  await h.runtime.idle();
  const run = h.state.runs['turn:1'];
  assert.equal(run.performance.responses, 2);
  assert.equal(run.performance.sessionId, 'session:old');
  assert.deepEqual(run.performance.output, { value: 7, state: 'complete' });
  assert.deepEqual(run.performance.estimatedUsd, { value: 0.5, state: 'complete' });
  assert.equal(run.performance.firstObservedOutputMs, 1);
  assert.equal(run.performance.dispatchElapsedMs, 2);
  assert.equal(h.state.runs['steering:1'].performance, undefined);
  assert.equal(h.listeners.size, 0);
  captured({ type: 'message_end', message: h.message(3, 99) });
  assert.equal(run.performance.responses, 2);
  const folder = join(h.root, 'runtime', 'events');
  const events = readdirSync(folder).flatMap(file => readFileSync(join(folder, file), 'utf8').trim().split('\n').map(JSON.parse));
  const metrics = events.filter(event => event.type === 'run_performance');
  assert.equal(metrics.length, 1);
  assert.equal(JSON.stringify(metrics).includes('private'), false);
  assert.deepEqual(run.result.performance, run.performance);
});

test('rejected and handled preflight keep unknown usage rather than inventing zero', options, async t => {
  const h = fixture(t);
  await assert.rejects(h.runtime.send('refuse', 'refused'), /rejected/i);
  await h.runtime.idle();
  await h.runtime.send('/handled', 'handled');
  await h.runtime.idle();
  for (const id of ['refused', 'handled']) {
    const facts = h.state.runs[id].performance;
    assert.deepEqual(facts.input, { value: null, state: 'unavailable' });
    assert.equal(facts.firstObservedOutputMs, null);
    assert.equal(facts.responses, 0);
  }
});

test('owned Stop retains observed partial sums and unfinished output without stealing queued metrics', options, async t => {
  const h = fixture(t);
  await h.runtime.send('start', 'stopped');
  h.emit({ type: 'message_end', message: h.message(1) });
  h.emit({ type: 'message_start', message: h.message(2) });
  h.emit({ type: 'message_update', message: h.message(2), assistantMessageEvent: { type: 'text_delta', delta: 'partial' } });
  await h.runtime.send('correction', 'queued');
  assert.deepEqual(await h.runtime.interrupt(), ['correction']);
  const run = h.state.runs.stopped;
  assert.equal(run.status, 'interrupted');
  assert.equal(run.performance.incomplete, true);
  assert.deepEqual(run.performance.output, { value: 2, state: 'partial' });
  assert.equal(h.state.runs.queued.performance, undefined);
});

test('startup abandonment has no observed dispatch clock and never replays performance appends', options, async t => {
  const h = fixture(t);
  h.state.runs.old = { id: 'old', kind: 'main', sessionId: 'session:old', status: 'running', startedAt: '2000-01-01' };
  h.state.runs.queued = { id: 'queued', kind: 'main', sessionId: 'session:old', status: 'running', parentRunId: 'old' };
  await h.runtime.interruptAbandonedRuns();
  const run = h.state.runs.old;
  assert.equal(run.status, 'interrupted');
  assert.equal(run.performance.dispatchElapsedMs, null);
  assert.equal(run.performance.firstObservedOutputMs, null);
  assert.deepEqual(run.performance.output, { value: null, state: 'unavailable' });
  assert.equal(run.performance.incomplete, true);
  assert.equal(h.state.runs.queued.performance, undefined);
  assert.deepEqual(await h.runtime.interruptAbandonedRuns(), []);
});

test('a main turn counts its stages from when the user sent, through the wait before its prompt', options, async t => {
  const h = fixture(t);
  Object.assign(h.session, { model: { provider: 'fixture', id: 'local' }, thinkingLevel: 'high' });
  const since = Date.now() - 400;
  await h.runtime.send('private prompt', 'turn:1', undefined, { since, origin: 'window', marks: { host: since + 30 } });
  h.emit({ type: 'agent_start' });
  h.emit({ type: 'message_start', message: h.message(1) });
  h.emit({ type: 'message_update', message: h.message(1), assistantMessageEvent: { type: 'text_delta', delta: 'private' } });
  h.emit({ type: 'message_end', message: h.message(1) });
  h.session.messages.push(h.message(1));
  h.gate.resolve();
  await h.runtime.idle();
  const { origin, kind, engine, model, effort, stages } = h.state.runs['turn:1'].performance;
  assert.deepEqual([origin, kind, engine, model, effort], ['window', 'main', 'pi', 'fixture/local', 'high']);
  assert.deepEqual(Object.keys(stages), ['host', 'handed', 'admitted', 'prompted', 'started', 'requested', 'text', 'ended']);
  assert.equal(stages.host, 30);
  assert.ok(stages.handed >= 400 && stages.admitted >= stages.handed && stages.prompted >= stages.admitted && stages.text >= stages.prompted);
});

test('a main turn nobody timed counts from when the runtime took it, and names no model it does not know', options, async t => {
  const h = fixture(t);
  await h.runtime.send('/handled', 'plain');
  await h.runtime.idle();
  const facts = h.state.runs.plain.performance;
  assert.deepEqual([facts.origin, facts.kind, facts.engine], ['host', 'main', 'pi']);
  assert.deepEqual(Object.keys(facts.stages).slice(0, 3), ['handed', 'admitted', 'prompted']);
  assert.equal(Object.hasOwn(facts, 'model'), false);
});

test('a main turn says which system prompt parts it read, as hashes, when its session keeps them', options, async t => {
  const h = fixture(t);
  const prompts = () => {
    const folder = join(h.root, 'runtime', 'events');
    return readdirSync(folder).flatMap(file => readFileSync(join(folder, file), 'utf8').trim().split('\n').map(JSON.parse)).filter(event => event.type === 'turn_prompt');
  };
  await h.runtime.send('/handled', 'plain');
  await h.runtime.idle();
  assert.deepEqual(prompts(), []);
  h.session.promptParts = { memory: 'aaaaaaaaaaaa', decided: 'bbbbbbbbbbbb', secret: 'PRIVATE words', persona: 12 };
  await h.runtime.send('/handled', 'turn:2');
  await h.runtime.idle();
  const [event] = prompts();
  assert.deepEqual([event.id, event.parts], ['turn:2', { memory: 'aaaaaaaaaaaa', decided: 'bbbbbbbbbbbb' }]);
});
