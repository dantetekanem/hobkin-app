import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialize, atomicJson } from '../src/cli/config.mjs';
import * as views from '../src/cli/view.mjs';
import { recentPerformanceEvents, recordEvent } from '../src/cli/events.mjs';
import { createTurnMetrics } from '../src/cli/turn-metrics.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { fakePi } from './helpers/pi-session.mjs';

const fixture = t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-performance-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' });
  return { root, config };
};
const facts = (runId = 'turn', sessionId = 'session') => {
  const identity = { runId, sessionId };
  const metrics = createTurnMetrics({ ...identity, now: () => 10 });
  metrics.observe({ type: 'message_end', message: { role: 'assistant', provider: 'fixture', model: 'local',
    timestamp: 1, usage: { input: 0, output: 2, cost: { total: 0 } } } }, identity);
  return metrics.finish(identity);
};
const run = (id = 'turn') => ({ id, sessionId: 'session', kind: 'main', status: 'completed', startedAt: '2026-01-01T00:00:00Z' });

test('performance projection preserves measured zero, partial fields, identity and own-parent privacy', t => {
  const { root } = fixture(t);
  const performance = { ...facts(), input: { value: 0, state: 'partial' }, secret: 'PRIVATE' };
  recordEvent(root, 'run_performance', { ...facts(), output: { value: 99, state: 'complete' } });
  const result = views.projectPerformance(root, [{ ...run(), result: { performance } },
    { ...run('missing') }, { ...run('steer'), parentRunId: 'turn', performance: facts('steer') }]);
  assert.equal(result.scope, 'own-parent');
  assert.equal(result.helpers, 'unavailable');
  assert.equal(result.stale, false);
  assert.equal(result.runs.length, 2);
  assert.deepEqual(result.runs[0].performance.input, { value: 0, state: 'partial' });
  assert.equal(result.runs[0].performance.estimatedUsd.value, 0);
  assert.equal(result.runs[0].performance.output.value, 2);
  assert.equal(result.runs[0].performance.cacheRead.value, null);
  assert.equal(result.runs[1].performance, null);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes('TTFT'), false);
});

test('event fallback deduplicates exact identities, refreshes after append and rejects other sessions', t => {
  const { root } = fixture(t);
  recordEvent(root, 'run_performance', facts());
  recordEvent(root, 'run_performance', facts());
  recordEvent(root, 'run_performance', { ...facts('turn', 'other'), secret: 'PRIVATE' });
  let result = views.projectPerformance(root, [run()]);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].source, 'event');
  assert.equal(result.runs[0].performance.sessionId, 'session');
  recordEvent(root, 'run_performance', facts('new'));
  result = views.projectPerformance(root, [run('new')]);
  assert.equal(result.runs[0].performance.runId, 'new');
  assert.equal(views.projectPerformance(root, [{ ...run(), sessionId: 'absent' }]).runs[0].performance, null);
});

test('background projection uses the settled native session rather than a requested alias', t => {
  const { root } = fixture(t);
  const performance = facts('job', 'native');
  const result = views.projectPerformance(root, [{ ...run('job'), kind: 'background', sessionId: 'requested',
    result: { sessionId: 'native', performance } }]);
  assert.equal(result.runs[0].sessionId, 'native');
  assert.equal(result.runs[0].performance.output.value, 2);
});

test('bounded history prioritizes current parents and does not read earlier monthly bytes', t => {
  const { root } = fixture(t);
  const folder = join(root, 'runtime/events');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, '2026-01.jsonl'), JSON.stringify({ type: 'run_performance', ...facts('old') }) + '\n' + 'x'.repeat(300000) + '\n');
  recordEvent(root, 'run_performance', facts('recent'));
  const runs = Array.from({ length: 110 }, (_, i) => run(String(i)));
  runs.push({ ...run('current'), status: 'running' });
  const result = views.projectPerformance(root, runs);
  assert.equal(result.runs.length, 100);
  assert.equal(result.runs[0].runId, 'current');
  assert.equal(result.retention.maxRuns, 100);
  assert.equal(result.retention.eventTailBytesPerFile, 262144);
  assert.equal(views.projectPerformance(root, [run('old')]).runs[0].performance, null);
});

test('offline saved metrics remain stale, sanitize malformed facts and do not change cumulative usage', t => {
  const { root } = fixture(t);
  atomicJson(join(root, 'runtime/view.json'), { version: 1, savedAt: '2026-01-01T00:00:00Z',
    runs: [run()], telemetry: { runs: [{ ...run(), runId: 'turn', performance: { ...facts(),
      output: { value: -1, state: 'complete' }, prompt: 'PRIVATE' } }] } });
  const snapshot = views.readLocalView(root);
  assert.equal(snapshot.telemetry.connection, 'offline');
  assert.equal(snapshot.telemetry.stale, true);
  assert.equal(snapshot.telemetry.asOf, '2026-01-01T00:00:00.000Z');
  assert.equal(snapshot.telemetry.runs[0].source, 'saved');
  assert.deepEqual(snapshot.telemetry.runs[0].performance.output, { value: null, state: 'unavailable' });
  assert.equal(JSON.stringify(snapshot.telemetry).includes('PRIVATE'), false);
  assert.equal(snapshot.usage.kind, 'estimate');
  assert.equal(snapshot.usage.usd, 0);
});

test('event tails tolerate broken lines, ignore unfinished appends and expose unavailable storage', t => {
  const { root } = fixture(t);
  const folder = join(root, 'runtime/events');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, '2026-11.jsonl');
  writeFileSync(file, 'broken\n' + JSON.stringify({ type: 'run_performance', ...facts() }));
  assert.equal(views.projectPerformance(root, [run()]).runs[0].performance, null);
  appendFileSync(file, '\n');
  const first = recentPerformanceEvents(root);
  assert.equal(views.projectPerformance(root, [run()]).runs[0].performance.output.value, 2);
  assert.equal(recentPerformanceEvents(root), first, 'unchanged tails reuse the cached result');
  rmSync(file);
  mkdirSync(file);
  const unavailable = views.projectPerformance(root, [run()]);
  assert.equal(unavailable.retention.eventReadState, 'unavailable');
  assert.equal(unavailable.runs[0].performance, null);
});

test('older hosts and malformed optional telemetry remain explicitly unavailable offline', t => {
  const { root } = fixture(t);
  atomicJson(join(root, 'runtime/view.json'), { version: 1, runs: [run()], telemetry: { runs: 'invalid' } });
  const old = views.readLocalView(root);
  assert.equal(old.telemetry.stale, true);
  assert.equal(old.telemetry.runs[0].performance, null);
  assert.equal(old.telemetry.runs[0].source, 'unavailable');
  assert.equal(old.telemetry.asOf, null);
});

test('application saves the same bounded telemetry and offline reload never claims current measurements', async t => {
  const { root } = fixture(t);
  const fake = fakePi(root);
  const app = await HobkinApplication.open(root, { createMain: fake.createMain, intervalMs: 60000 });
  t.after(() => app.close());
  await app.runtime.change(state => { state.runs.turn = { ...run(), performance: facts() }; });
  const snapshot = await app.refresh();
  assert.equal(snapshot.telemetry.connection, 'connected');
  assert.equal(snapshot.telemetry.runs[0].performance.output.value, 2);
  const saved = JSON.parse(readFileSync(join(root, 'runtime/view.json'), 'utf8'));
  assert.deepEqual(saved.telemetry, snapshot.telemetry);
  const offline = views.readLocalView(root);
  assert.equal(offline.telemetry.stale, true);
  assert.equal(offline.telemetry.runs[0].performance.output.value, 2);
});
