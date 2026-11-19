import test, { mock } from 'node:test';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
const forbidden = () => { throw Error('Performance fixture forbids SDK/process/network/signals'); };
for (const key of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) mock.method(childProcess, key, forbidden);
mock.method(process, 'kill', forbidden);
mock.method(globalThis, 'fetch', forbidden);
syncBuiltinESMExports();
const sdk = 'data:text/javascript,' + encodeURIComponent(`
  export const defineTool = tool => tool;
  const no = () => { throw Error('SDK/resources forbidden'); };
  export { no as createAgentSession, no as DefaultResourceLoader, no as SessionManager,
    no as ModelRuntime, no as SettingsManager, no as getAgentDir,
    no as getMarkdownTheme, no as getSelectListTheme, no as initTheme };
`);
registerHooks({ resolve(specifier, context, next) {
  return specifier === '@earendil-works/pi-coding-agent' ? { url: sdk, shortCircuit: true } : next(specifier, context);
} });
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { initialize, atomicJson } = await import('../src/cli/config.mjs');
const views = await import('../src/cli/view.mjs');
const { recentPerformanceEvents, recordEvent } = await import('../src/cli/events.mjs');
const { createTurnMetrics } = await import('../src/cli/turn-metrics.mjs');
const { HobkinApplication } = await import('../src/cli/application.mjs');

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
const helper = (id = 'child', extra = {}) => ({ id, rootId: 'turn', parentId: 'turn', depth: 1,
  status: 'completed', performance: facts(id, 'native'), ...extra });

test('helper projection prefers live then events then saved without summing parent or child totals', t => {
  const { root } = fixture(t);
  recordEvent(root, 'run_performance', { ...facts('child', 'native'), ownedHelper: helper('child') });
  const saved = { runs: [{ runId: 'turn', sessionId: 'session', helpers: [helper('saved', { sessionId: 'native', status: 'running' })] }] };
  const projected = views.projectPerformance(root, [{ ...run(), performance: facts() }], {
    liveHelpers: [helper('child', { performance: { ...facts('child', 'native'), output: { value: 9, state: 'complete' } }, name: 'PRIVATE' }),
      helper('grand', { parentId: 'child', depth: 2 }), helper('queued', { status: 'queued', performance: null })], savedTelemetry: saved,
  });
  const rows = projected.runs[0].helpers;
  assert.equal(projected.runs[0].performance.output.value, 2);
  const byId = Object.fromEntries(rows.map(row => [row.id, row]));
  assert.deepEqual(rows.map(row => [row.id, row.source]).sort(), [['child', 'live'], ['grand', 'live'], ['queued', 'live'], ['saved', 'saved']]);
  assert.equal(byId.child.performance.output.value, 9);
  assert.equal(byId.grand.performance.output.value, 2);
  assert.equal(byId.queued.performance, null);
  assert.equal(byId.queued.sessionId, null);
  assert.equal(byId.saved.status, 'unknown');
  assert.equal(JSON.stringify(projected).includes('PRIVATE'), false);
  const restart = views.projectPerformance(root, [run()], { liveHelpers: [], savedTelemetry: projected });
  assert.equal(restart.runs[0].helpers.find(row => row.id === 'child').source, 'event');
  assert.equal(restart.runs[0].helpers.find(row => row.id === 'queued').status, 'unknown');
  atomicJson(join(root, 'runtime/view.json'), { version: 1, runs: [run()], telemetry: projected });
  const offline = views.readLocalView(root).telemetry.runs[0].helpers;
  assert.equal(offline.find(row => row.id === 'grand').status, 'completed');
  assert.equal(offline.find(row => row.id === 'queued').status, 'unknown');
});

test('helper projection rejects foreign stale malformed ancestry and bounds retained rows', t => {
  const { root } = fixture(t);
  const liveHelpers = [helper('foreign', { rootId: 'other' }), helper('orphan', { parentId: 'absent', depth: 2 }),
    helper('cycle', { parentId: 'cycle', depth: 2 }), helper('bad-depth', { depth: 2 }),
    helper('wrong-session', { sessionId: 'wrong' }), helper('null-session', { sessionId: null }),
    helper('wrong-run', { performance: facts('other', 'native') }),
    ...Array.from({ length: 40 }, (_, i) => helper(`ok${i}`))];
  const result = views.projectPerformance(root, [run()], { liveHelpers });
  assert.equal(result.runs[0].helpers.length, 32);
  assert.ok(result.runs[0].helpers.every(row => row.id.startsWith('ok')));
  assert.equal(result.retention.maxHelpersPerRun, 32);
  assert.equal(result.retention.maxEventKeys, 100);
  const stale = { runs: [{ runId: 'turn', sessionId: 'old', helpers: [helper()] }] };
  assert.deepEqual(views.projectPerformance(root, [run()], { savedTelemetry: stale }).runs[0].helpers, []);
  const parent = { ...run(), sessionId: undefined };
  const unmeasured = views.projectPerformance(root, [parent], { liveHelpers: [helper('queued', { status: 'queued', performance: null })] });
  const restarted = views.projectPerformance(root, [parent], { savedTelemetry: unmeasured });
  assert.equal(restarted.runs[0].helpers[0].status, 'unknown');
  assert.equal(restarted.runs[0].helpers[0].performance, null);
});

test('Work performance uses captured harness and native session IDs across offline reload', t => {
  const { root } = fixture(t);
  const work = { ...run('public-work'), kind: 'background', harnessId: 'captured', result: { id: 'captured', sessionId: 'native', performance: facts('captured', 'native') } };
  let telemetry = views.projectPerformance(root, [work]);
  assert.equal(telemetry.runs[0].runId, 'public-work');
  assert.equal(telemetry.runs[0].performance.runId, 'captured');
  atomicJson(join(root, 'runtime/view.json'), { version: 1, runs: [{ ...work, result: undefined }], telemetry });
  assert.equal(views.readLocalView(root).telemetry.runs[0].performance.runId, 'captured');
  assert.equal(views.projectPerformance(root, [{ ...work, result: { ...work.result, id: 'foreign' } }]).runs[0].performance, null);
  assert.equal(views.projectPerformance(root, [{ ...work, harnessId: 'wrong' }]).runs[0].performance, null);
  recordEvent(root, 'run_performance', facts('captured', 'native'));
  assert.equal(views.projectPerformance(root, [{ ...work, result: { id: 'captured', sessionId: 'native' } }]).runs[0].source, 'event');
  assert.equal(views.projectPerformance(root, [{ ...work, result: { id: 'captured', sessionId: 'stale' } }]).runs[0].performance, null);
});

test('application helper observers append allowlisted facts and refresh only meaningful measurements', t => {
  const { root } = fixture(t), app = Object.create(HobkinApplication.prototype), refreshes = [];
  app.runtime = { directory: root };
  app.requestRefresh = value => refreshes.push(value);
  app.observeOwnedEvent(helper(), { type: 'performance', display: false });
  app.observeOwnedEvent(helper(), { type: 'message_end', text: 'PRIVATE' });
  app.observeOwnedEvent(helper(), { type: 'message_update' });
  app.observeOwnedEvent(helper(), { type: 'tool_execution_start', toolCallId: 'call', toolName: 'read' });
  assert.deepEqual(refreshes, [false, false], 'a helper\'s words and calls are not shown, so only its measurements refresh');
  app.recordOwnedPerformance(helper('child', { name: 'PRIVATE', performance: { ...facts('child', 'native'), prompt: 'PRIVATE' } }));
  app.recordOwnedPerformance(helper('queued', { status: 'cancelled', performance: null }));
  app.recordOwnedPerformance({ ...helper(), id: 'PRIVATE/path' });
  app.recordOwnedPerformance(helper('invalid', { status: 'running' }));
  const events = recentPerformanceEvents(root).events;
  assert.equal(events.length, 2);
  assert.equal(events[0].runId, 'child');
  assert.equal(events[1].sessionId, null);
  assert.equal(JSON.stringify(events).includes('PRIVATE'), false);
  rmSync(join(root, 'runtime/events'), { recursive: true });
  writeFileSync(join(root, 'runtime/events'), 'not a directory');
  assert.doesNotThrow(() => app.recordOwnedPerformance(helper()));
});

test('performance projection preserves measured zero, partial fields, identity and own-parent privacy', t => {
  const { root } = fixture(t);
  const performance = { ...facts(), input: { value: 0, state: 'partial' }, secret: 'PRIVATE' };
  recordEvent(root, 'run_performance', { ...facts(), output: { value: 99, state: 'complete' } });
  const result = views.projectPerformance(root, [{ ...run(), result: { performance } },
    { ...run('missing') }, { ...run('steer'), parentRunId: 'turn', performance: facts('steer') }]);
  assert.equal(result.scope, 'own-parent-and-helpers');
  assert.equal(result.helpers, 'owned');
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

test('synthetic application persists helper facts and retains them through an empty restart lifecycle', async t => {
  const { root, config } = fixture(t), app = new HobkinApplication();
  const work = { ...run('public-work'), kind: 'background', harnessId: 'captured',
    result: { id: 'captured', sessionId: 'native', performance: facts('captured', 'native') } };
  app.runtime = { directory: root, state: async () => ({ runs: { work } }), messages: () => [],
    main: { model: { provider: 'fixture', id: 'local' } }, contextInfo: () => ({}),
    jobChildren: () => ({}), mainChildren: () => [], stopControls: () => ({}), mainActivity: () => [],
    ownedLifecycle: { snapshot: () => [helper('child', { rootId: work.id, parentId: work.id, status: 'running' })] } };
  app.config = config; app.snapshot = { history: { reports: [] } }; app.noticeRunIds = new Set();
  app.delivery = { syncEvidence: async () => {} };
  app.runner = { snapshot: async () => ({ schedules: [], errors: [] }), steeringReceipts: () => ({}) };
  app.learner = { takePost: () => null }; app.ledger = { sync: () => ({}) };
  app.telemetry = { attention: () => [] }; app.now = () => 0;
  app.workView = () => ({ harnessLines: [], folderLines: [], discovery: {} });
  app.moods = { observe() {}, reaction: {} }; app.templatesLooked = true; app.uploadLooked = true;
  app.yesterdayWins = () => null; app.waitingNow = () => ({}); app.winsToday = () => null; app.notePause = () => {};
  const snapshot = await app.project();
  const saved = JSON.parse(readFileSync(join(root, 'runtime/view.json'), 'utf8'));
  assert.deepEqual(saved.telemetry, snapshot.telemetry);
  assert.equal(snapshot.telemetry.runs[0].helpers[0].source, 'live');
  app.snapshot = views.readLocalView(root);
  assert.equal(app.snapshot.telemetry.runs[0].performance.runId, 'captured');
  app.runtime.ownedLifecycle.snapshot = () => [];
  const restarted = await app.project();
  assert.equal(restarted.telemetry.runs[0].helpers[0].status, 'unknown');
  assert.equal(restarted.telemetry.runs[0].helpers[0].source, 'saved');
});

test("a helper's event keeps its stages and its steps, and nothing else it was handed", t => {
  const { root } = fixture(t), app = Object.create(HobkinApplication.prototype);
  app.runtime = { directory: root };
  const step = { at: 1, first: 2, text: 3, end: 4, input: 5, cacheRead: 6, output: 7 };
  app.recordOwnedPerformance(helper('child', { performance: { ...facts('child', 'native'), kind: 'helper', engine: 'pi', model: 'test/model',
    steps: [{ ...step, said: 'PRIVATE' }] } }));
  const [event] = recentPerformanceEvents(root).events;
  assert.deepEqual(event.steps, [step]);
  assert.deepEqual([event.kind, event.engine, event.model, event.origin], ['helper', 'pi', 'test/model', 'prompt']);
  assert.equal(event.stages.prompted, 0);
  assert.equal(JSON.stringify(event).includes('PRIVATE'), false);
});
