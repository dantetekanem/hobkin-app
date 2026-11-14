import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTurnMetrics, safeSteps, safeTurnFacts, turnFrom } from '../src/cli/turn-metrics.mjs';

const owner = { runId: 'run-one', sessionId: 'session-one' };
const usage = { input: 10, output: 4, cacheRead: 2, cacheWrite: 3, cost: { total: 0.25 } };
const message = (timestamp = 1, fields = {}) => ({ role: 'assistant', provider: 'test', model: 'test', timestamp, usage, durationMs: 20, ...fields });
const start = timestamp => ({ type: 'message_start', message: message(timestamp, { usage: undefined }) });
const delta = (type, timestamp = 1) => ({ type: 'message_update', message: message(timestamp), assistantMessageEvent: { type, delta: 'x' } });
const end = (timestamp, fields) => ({ type: 'message_end', message: message(timestamp, fields) });

// The wall clock reads 1100 when the prompt is handed over, the turn began at 1000, and both clocks step together.
function fixture(turn = { since: 1000, origin: 'window', kind: 'main', engine: 'pi', model: 'openai/gpt-x', effort: 'high', marks: { host: 1010, handed: 1020, admitted: 1040 } }) {
  let time = 100;
  const metrics = createTurnMetrics({ ...owner, now: () => time, wall: () => 1000 + time, turn });
  return { metrics, at: (value, event) => { time = value; if (event) metrics.observe(event, owner); }, finish: () => metrics.finish(owner) };
}

test('a turn lists every stage in milliseconds since it began', () => {
  const f = fixture();
  f.at(110, { type: 'agent_start' });
  f.at(120, start(1));
  f.at(150, delta('thinking_delta'));
  f.at(170, delta('toolcall_delta'));
  f.at(200, delta('text_delta'));
  f.at(205, delta('text_delta'));
  f.at(230, end(1));
  f.at(260);
  const facts = f.finish();
  assert.deepEqual(facts.stages, { host: 10, handed: 20, admitted: 40, prompted: 100, started: 110, requested: 120, thinking: 150, tool: 170, text: 200, ended: 260 });
  assert.deepEqual([facts.origin, facts.kind, facts.engine, facts.model, facts.effort], ['window', 'main', 'pi', 'openai/gpt-x', 'high']);
  // What was measured before stays as it was: from the prompt, not from the turn's start.
  assert.equal(facts.firstObservedOutputMs, 50);
  assert.equal(facts.dispatchElapsedMs, 160);
  assert.throws(() => { facts.stages.text = 1; }, TypeError);
});

test('a stage that never came is left out, and only the first of each counts', () => {
  const f = fixture();
  f.at(120, start(1));
  f.at(140, delta('text_delta'));
  f.at(150, { type: 'agent_start' });
  f.at(160, { type: 'agent_start' });
  f.at(170, start(2));
  f.at(180, delta('text_delta', 2));
  const { stages } = f.finish();
  assert.deepEqual(stages, { host: 10, handed: 20, admitted: 40, prompted: 100, started: 150, requested: 120, text: 140, ended: 180 });
});

test('with nothing known about the turn, the stages count from the prompt', () => {
  const f = fixture(null);
  f.at(130, start(1));
  f.at(150, delta('text_delta'));
  const facts = f.finish();
  assert.equal(facts.origin, 'prompt');
  assert.deepEqual(facts.stages, { prompted: 0, requested: 30, text: 50, ended: 50 });
  for (const key of ['kind', 'engine', 'model', 'effort']) assert.equal(Object.hasOwn(facts, key), false);
});

test('what a caller got wrong about the turn is dropped, never guessed', () => {
  for (const since of [NaN, '1000', 1100 + 5000, 1100 - 7200001]) {
    const facts = fixture({ since, origin: 'window', marks: { host: 1010 } }).finish();
    assert.equal(facts.origin, 'prompt');
    assert.deepEqual(facts.stages, { prompted: 0, ended: 0 });
  }
  const facts = fixture({ since: 1000, origin: 'somewhere', kind: 'boss', engine: 'gpt', model: 'x'.repeat(201), effort: 7,
    marks: { host: 990, handed: 1101 + 1000, admitted: NaN, spawned: '1050', ready: 1090, secret: 1050 } }).finish();
  assert.equal(facts.origin, 'run');
  assert.deepEqual(facts.stages, { ready: 90, prompted: 100, ended: 100 });
  for (const key of ['kind', 'engine', 'model', 'effort']) assert.equal(Object.hasOwn(facts, key), false);
});

test('each model response is one step, kept apart from the facts a run saves', t => {
  const root = mkdtempSync(join(tmpdir(), 'hobkin-stages-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture();
  f.at(120, start(1));
  f.at(150, delta('thinking_delta'));
  f.at(200, delta('text_delta'));
  f.at(230, end(1));
  f.at(230, end(1)); // A replay of a response already counted adds no step.
  f.at(300, start(2));
  f.at(310, delta('toolcall_delta', 2));
  f.at(340, end(2, { usage: { ...usage, input: 7, cacheRead: 900, output: 1 } }));
  f.at(400, end(3)); // A response that never streamed has only its end.
  const steps = f.metrics.steps(owner);
  assert.deepEqual(steps, [
    { at: 120, first: 150, text: 200, end: 230, input: 10, cacheRead: 2, output: 4 },
    { at: 300, first: 310, text: null, end: 340, input: 7, cacheRead: 900, output: 1 },
    { at: null, first: null, text: null, end: 400, input: 10, cacheRead: 2, output: 4 },
  ]);
  assert.equal(f.metrics.steps({ ...owner, runId: 'foreign' }), null);
  const facts = f.metrics.record(root, owner);
  assert.equal(Object.hasOwn(facts, 'steps'), false);
  const folder = join(root, 'runtime', 'events');
  const saved = JSON.parse(readFileSync(join(folder, readdirSync(folder)[0]), 'utf8').trim());
  assert.deepEqual(saved.steps, steps);
  assert.deepEqual(saved.stages, facts.stages);
});

test('steps stop at twenty-four, and a response with no end keeps what it had', () => {
  const f = fixture();
  for (let n = 1; n <= 30; n++) { f.at(100 + n * 10, start(n)); f.at(105 + n * 10, end(n)); }
  f.at(500, start(31));
  f.at(510, delta('text_delta', 31));
  const steps = f.metrics.steps(owner);
  assert.equal(steps.length, 24);
  assert.deepEqual(steps[23], { at: 340, first: null, text: null, end: 345, input: 10, cacheRead: 2, output: 4 });
  const open = fixture();
  open.at(120, start(1));
  open.at(130, delta('text_delta'));
  assert.deepEqual(open.metrics.steps(owner), [{ at: 120, first: 130, text: 130, end: null, input: null, cacheRead: null, output: null }]);
});

test('the window says when the user sent, and a time that cannot be right is not believed', () => {
  assert.deepEqual(turnFrom(1000, 1040), { since: 1000, origin: 'window', marks: { host: 1040 } });
  // The two clocks are one machine's, so a send a moment "after" its arrival is the same moment.
  assert.deepEqual(turnFrom(1041, 1040), { since: 1040, origin: 'window', marks: { host: 1040 } });
  for (const sentAt of [undefined, null, NaN, '1000', 1040 + 5001, 1040 - 600001]) {
    assert.deepEqual(turnFrom(sentAt, 1040), { since: 1040, origin: 'host', marks: {} });
  }
});

test('saved facts keep only the stages and names that can be right', () => {
  const good = { origin: 'tool', kind: 'helper', engine: 'pi', model: 'openai/gpt-x', effort: 'low', stages: { spawned: 5, ready: 80.5, prompted: 81, text: 900, ended: 950 } };
  assert.deepEqual(safeTurnFacts({ ...good, secret: 'PRIVATE' }), good);
  assert.deepEqual(safeTurnFacts({ origin: 'x', kind: 1, engine: 'gpt', model: 'a\nb', effort: '', stages: { text: -1, ended: Infinity, said: 3, prompted: '4' } }), {});
  assert.deepEqual(safeTurnFacts({ stages: 'no' }), {});
  assert.deepEqual(safeTurnFacts(null), {});
  const row = { at: 1, first: 2, text: null, end: 4, input: 5, cacheRead: 6, output: 7 };
  assert.deepEqual(safeSteps([row, { ...row, text: 'PRIVATE', said: 'x' }, 'no', null]), [row, { ...row, text: null }]);
  assert.equal(safeSteps(Array.from({ length: 40 }, () => row)).length, 24);
  assert.deepEqual(safeSteps('no'), []);
});

test('each part of the system prompt leaves a short hash of what it last read as, and never what it said', async () => {
  const { fingerprinted } = await import('../src/cli/rpc-session.mjs');
  let memory = ['PRIVATE fact'];
  const { readers, parts } = fingerprinted({ memory: () => memory, persona: () => 'Normal' });
  assert.deepEqual(parts, {});
  assert.deepEqual(readers.memory(), ['PRIVATE fact']);
  assert.equal(readers.persona(), 'Normal');
  const first = { ...parts };
  assert.match(first.memory, /^[0-9a-f]{12}$/);
  assert.notEqual(first.memory, first.persona);
  readers.memory();
  assert.deepEqual(parts, first);
  memory = ['PRIVATE fact', 'another'];
  readers.memory();
  assert.notEqual(parts.memory, first.memory);
  assert.equal(parts.persona, first.persona);
  assert.equal(JSON.stringify(parts).includes('PRIVATE'), false);
});
