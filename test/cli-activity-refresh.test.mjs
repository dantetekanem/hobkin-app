import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HobkinApplication } from '../src/cli/application.mjs';
import { HobkinRuntime } from '../src/cli/runtime.mjs';

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = new HobkinApplication();
  const published = [];
  let projects = 0;
  app.now = Date.now;
  app.runner = {};
  app.snapshot = { reports: [{ id: 'saved-report' }], runs: [{ id: 'job', state: 'running' }] };
  app.runtime = {
    mainActivity: () => [{ id: 'main', kind: 'assistant', text: 'Streaming' }],
    mainChildren: () => [],
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
  return { app, published, flush, projects: () => projects };
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
