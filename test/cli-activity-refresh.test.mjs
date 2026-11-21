import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = new HobkinApplication();
  const published = [];
  let projects = 0, helperLists = 0;
  app.now = Date.now;
  app.runner = {};
  app.snapshot = { reports: [{ id: 'saved-report' }], runs: [{ id: 'job', state: 'running' }] };
  app.runtime = {
    mainActivity: () => [{ id: 'main', kind: 'assistant', text: 'Streaming' }],
    helpers: () => { helperLists++; return { jobChildren: { job: [{ id: 'helper', state: 'running' }] }, mainChildren: [] }; },
    mainBusy: true,
    mainTool: 'read',
    mainDoing: 'Reading',
  };
  app.onChange = snapshot => published.push(snapshot);
  app.project = async () => { projects++; };
  const flush = async () => {
    t.mock.timers.tick(25);
    await app.refreshing;
  };
  return { app, published, flush, projects: () => projects, helperLists: () => helperLists };
}

test('streamed job activity updates without rebuilding reports or runtime state', async t => {
  const h = fixture(t);
  const reports = h.app.snapshot.reports;
  h.app.observeActivity('job', { type: 'message_start', message: { role: 'assistant' } });
  for (let i = 0; i < 10; i++) {
    h.app.observeActivity('job', { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'a' } });
    await h.flush();
  }
  assert.equal(h.projects(), 0);
  assert.equal(h.published.length, 10);
  assert.equal(h.published.at(-1).jobActivity.job[0].text, 'a'.repeat(10));
  assert.equal(h.helperLists(), 10, 'helpers are listed once a publish');
  assert.equal(h.published.at(-1).jobChildren.job[0].id, 'helper');
  assert.deepEqual(h.published.at(-1).mainChildren, []);
  assert.equal(h.app.snapshot.reports, reports);
  assert.equal(h.app.snapshot.mainActivity[0].text, 'Streaming');
  assert.equal(h.app.snapshot.doing, 'Reading');
});

test('a full refresh takes precedence over streamed activity in either order', async t => {
  const h = fixture(t);
  for (const fullFirst of [true, false]) {
    h.app.requestRefresh(!fullFirst);
    h.app.requestRefresh(fullFirst);
    await h.flush();
  }
  assert.equal(h.projects(), 2);
});

test('a full refresh requested during projection still gets its follow-up', async t => {
  const h = fixture(t);
  const release = Promise.withResolvers();
  let calls = 0;
  h.app.project = async () => { if (++calls === 1) await release.promise; };
  const first = h.app.refresh();
  h.app.requestRefresh();
  h.app.requestRefresh(true);
  t.mock.timers.tick(25);
  release.resolve();
  await first;
  await h.flush();
  assert.equal(calls, 2);
});

test('main-session deltas use activity refreshes but completed messages request full state', async () => {
  const changes = [];
  let emit;
  const main = {
    sessionId: 'fake-main', sessionFile: '/unused/fake-main.jsonl',
    getSessionStats: () => ({ sessionId: 'fake-main', cost: 0 }),
    subscribe: listener => { emit = listener; return () => {}; },
  };
  const runtime = new HobkinRuntime('/unused', {}, { createMain: async () => main, onChange: activityOnly => changes.push(activityOnly) });
  runtime.state = async () => ({ main: null });
  runtime.change = async update => update({ main: null });
  await runtime.connectMain();
  changes.length = 0;
  emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello' } });
  emit({ type: 'tool_execution_update', toolCallId: 'read', partialResult: {} });
  emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } });
  runtime.notify();
  assert.deepEqual(changes, [true, true, false, false]);
});

// The main chat's own listener, wired to an application as `open` wires it, with a turn admitted and every rebuild counted.
async function mainChat(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = new HobkinApplication();
  const published = [];
  let projects = 0, emit;
  const main = {
    sessionId: 'fake-main', sessionFile: '/unused/fake-main.jsonl',
    getSessionStats: () => ({ sessionId: 'fake-main', cost: 0 }),
    subscribe: listener => { emit = listener; return () => {}; },
  };
  const runtime = new HobkinRuntime('/unused', {}, { createMain: async () => main, onChange: activityOnly => app.requestRefresh(activityOnly) });
  runtime.state = async () => ({ main: null });
  runtime.change = async update => update({ main: null });
  Object.assign(app, { now: Date.now, runner: {}, runtime, snapshot: {}, onChange: snapshot => published.push(snapshot) });
  app.project = async () => { projects++; };
  await runtime.connectMain();
  runtime.busySessions.add(main.sessionId);
  const flush = async () => {
    t.mock.timers.tick(25);
    await app.refreshing;
  };
  await flush();
  published.length = 0;
  projects = 0;
  return { emit: event => emit(event), published, flush, projects: () => projects };
}

test('a main tool start publishes activity and rebuilds nothing, and a message end rebuilds once', async t => {
  const h = await mainChat(t);
  h.emit({ type: 'turn_start' });
  h.emit({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash', args: { command: 'ls' } });
  await h.flush();
  assert.equal(h.projects(), 0);
  assert.equal(h.published.length, 1);
  const shown = h.published.at(-1);
  assert.equal(shown.busy, true, 'the turn still reads as busy');
  assert.equal(shown.tooling, true, 'the tool in flight is shown');
  assert.equal(shown.doing, 'working');
  assert.ok(shown.mainActivity.some(entry => entry.id === 'tool:call-1' && entry.state === 'running'), 'the feed carries the tool');
  for (const type of ['tool_execution_end', 'message_start', 'turn_end', 'agent_start']) {
    h.emit({ type, toolCallId: 'call-1', toolName: 'bash', message: { role: 'assistant', content: [] } });
    await h.flush();
  }
  assert.equal(h.projects(), 0, 'no event short of an end rebuilds');
  h.emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } });
  await h.flush();
  assert.equal(h.projects(), 1);
});

test('the end of a turn, a settle and a compaction each rebuild, and so does its start, which the window shows as compacting', async t => {
  const h = await mainChat(t);
  for (const type of ['agent_end', 'agent_settled', 'compaction_start', 'compaction_end']) {
    h.emit({ type, reason: 'threshold' });
    await h.flush();
  }
  assert.equal(h.projects(), 4);
});
