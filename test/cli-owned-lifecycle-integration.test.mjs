import assert from 'node:assert/strict';
import { test, mock, after } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { HobkinRuntime } from '../src/cli/runtime.mjs';
import { HobkinApplication } from '../src/cli/application.mjs';
import { createOwnedLifecycle } from '../src/cli/owned-agent-lifecycle.mjs';
import { runHarness } from '../src/cli/harnesses.mjs';

for (const name of ['spawn', 'exec', 'execFile', 'fork']) mock.method(childProcess, name, () => { throw Error('Real process forbidden'); });
syncBuiltinESMExports();
mock.method(DefaultResourceLoader.prototype, 'reload', () => { throw Error('Real resource loader forbidden'); });
mock.method(globalThis, 'fetch', () => { throw Error('Network forbidden'); });
const tick = () => new Promise(resolve => setImmediate(resolve));
const fixtureHome = mkdtempSync(join(tmpdir(), 'owned-lifecycle-'));
after(() => rmSync(fixtureHome, { recursive: true, force: true }));
function runtimeFixture(ownedLifecycle) {
  const state = { main: null, runs: {} }, sessions = [];
  writeFileSync(`${fixtureHome}/AGENTS.md`, 'Host standing directions\n');
  const runtime = new HobkinRuntime(fixtureHome, { main: { cwd: fixtureHome } }, { ownedLifecycle,
    createMain: options => {
      const session = { sessionId: `s${sessions.length}`, sessionFile: `${fixtureHome}/s${sessions.length}.jsonl`,
        model: { provider: 'test', id: 'model' }, thinkingLevel: 'medium', systemPrompt: 'Host standing directions',
        messages: [], prompts: [], promptDisposition: 'started', options,
        getSessionStats: () => ({ sessionId: session.sessionId, cost: 0 }), subscribe: () => () => {},
        async prompt(text, opts = {}) {
          session.prompts.push(text);
          opts.preflightResult?.(session.promptDisposition);
          await session.onPrompt?.(text);
          session.messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: `response${session.prompts.length}` }] });
        },
        async waitForIdle() {},
        async abort() {}, async clearQueue() { return {}; }, async dispose() {},
      };
      sessions.push(session); return session;
    } });
  runtime.state = async () => structuredClone(state);
  runtime.change = async change => change(state);
  runtime.harness = { async close() {} }; runtime.release = async () => {};
  return { runtime, state, sessions };
}

test('main callback binds an admitted turn, joins children, and rejects the replaced session', { timeout: 1000 }, async () => {
  const calls = [], joined = Promise.withResolvers();
  const scope = { request: request => { calls.push(request); return []; }, join: () => joined.promise, async cancel() { return { confirmed: true }; }, finish() {} };
  const f = runtimeFixture({ register: binding => { calls.push(binding); return scope; }, async close() {} });
  await f.runtime.connect();
  const old = f.sessions[0]; old.systemPrompt = undefined; // RPC sessions do not expose it.
  await assert.rejects(async () => old.options.ownedAgent({ action: 'list' }), /active|admitted/i);
  await f.runtime.send('host task', 'turn'); await tick();
  assert.equal(calls[0]?.id, 'turn');
  assert.equal(calls[0]?.binding.prompt.includes('host task'), true);
  assert.equal(JSON.parse(calls[0].binding.prompt).directions, 'Host standing directions\n');
  assert.equal(readFileSync(`${fixtureHome}/AGENTS.md`, 'utf8'), 'Host standing directions\n');
  assert.deepEqual(await old.options.ownedAgent({ action: 'list' }), []);
  assert.equal(f.state.runs.turn.status, 'running');
  joined.resolve('{"ownedChildren":[{"id":"child","status":"completed","report":"fact"}]}');
  await f.runtime.idle();
  assert.equal(f.state.runs.turn.result.text, 'response2');
  assert.equal(old.prompts.length, 2);
  await assert.rejects(f.runtime.send('host task', 'turn'), /already admitted|preflight/i);
  await f.runtime.idle(); assert.equal(old.prompts.length, 2);
  const reopened = runtimeFixture({ register: () => { throw Error('Saved admission must not reopen helpers'); }, async close() {} });
  reopened.state.runs = structuredClone(f.state.runs); await reopened.runtime.connect();
  await assert.rejects(reopened.runtime.send('host task', 'turn'), /already admitted|preflight/i);
  await reopened.runtime.idle(); assert.equal(reopened.sessions[0].prompts.length, 0); await reopened.runtime.close();
  await f.runtime.reset();
  await assert.rejects(async () => old.options.ownedAgent({ action: 'spawn', name: 'stale' }), /active|admitted/i);
  await f.runtime.close();
});

test('owned helper admission follows model-turn response dispositions', { timeout: 1000 }, async t => {
  for (const disposition of ['started', 'queued', 'handled']) {
    const requests = [];
    const scope = {
      request: request => { requests.push(request); return []; },
      async join() { return undefined; },
      async cancel() { return { confirmed: true }; },
      finish() {},
    };
    const f = runtimeFixture({ register: () => scope, async close() {} });
    t.after(() => f.runtime.close());
    await f.runtime.connect();
    const main = f.sessions[0];
    main.promptDisposition = disposition;
    if (disposition === 'handled') {
      main.onPrompt = async () => {
        await assert.rejects(async () => main.options.ownedAgent({ action: 'list' }), /active|admitted/i);
      };
    } else {
      main.onPrompt = () => main.options.ownedAgent({ action: 'list' });
    }

    await f.runtime.send('host task', `turn-${disposition}`);
    await f.runtime.idle();

    const expectedRequests = disposition === 'handled' ? [] : [{ action: 'list' }];
    assert.deepEqual(requests, expectedRequests, `owned request for ${disposition}`);
    const run = f.state.runs[`turn-${disposition}`];
    assert.equal(run.status, 'completed', `accepted ${disposition} response`);
    if (disposition === 'handled') assert.equal(run.result.text, '');
  }
});

test('real lifecycle keeps main partial output and unknown cleanup through Stop, reset and close', { timeout: 1000 }, async () => {
  for (const stop of ['interrupt', 'reset', 'close']) {
    let child, callback; const closed = Promise.withResolvers();
    const life = createOwnedLifecycle({ stopMs: 5, startProcess: options => {
      callback = options.onRecord;
      child = { closed: closed.promise, request: async type => type === 'get_state' ? { sessionId: 'child', model: { provider: 'test', id: 'model' }, thinkingLevel: 'medium' } : {}, shutdown: () => closed.promise, terminate() {} }; return child;
    } });
    const f = runtimeFixture(life); await f.runtime.connect();
    const main = f.sessions[0]; main.onPrompt = () => main.options.ownedAgent({ action: 'spawn', name: 'read helper' });
    await f.runtime.send('approved task', `turn-${stop}`); await tick();
    callback({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'child partial' }] } });
    await f.runtime[stop]();
    const result = f.state.runs[`turn-${stop}`].result;
    assert.equal(result.status, 'interrupted'); assert.equal(result.text, 'response1');
    assert.equal(result.ownedCleanupConfirmed, false); assert.equal(result.ownedChildren[0].status, 'unknown');
    assert.equal(result.ownedChildren[0].report, 'child partial');
    closed.resolve({ code: 0 }); await tick();
    assert.equal(f.state.runs[`turn-${stop}`].result.ownedCleanupConfirmed, false);
    await f.runtime.close();
  }
});

test('closed background bridge refuses helpers while preserving parent completion and metrics', { timeout: 1000 }, async () => {
  const life = createOwnedLifecycle({ startProcess: () => { throw Error('No child may launch'); } });
  const scope = life.register({ id: 'admitted-background', allowHelpers: false, binding: {} });
  const closed = Promise.withResolvers(), response = Promise.withResolvers();
  const result = await runHarness({ id: '11111111-1111-4111-8111-111111111111', harness: 'pi', model: 'test/model', effort: 'medium', cwd: fixtureHome,
    prompt: 'check', sessionFile: `${fixtureHome}/job.jsonl` }, { ownedScope: scope, startProcess: options => ({
    closed: closed.promise, terminate: () => closed.resolve({}), send: record => response.resolve(record),
    async request(type) {
      if (type === 'get_state') return { sessionId: 'background', model: { provider: 'test', id: 'model' }, thinkingLevel: 'medium' };
      if (type === 'get_session_stats') return { sessionId: 'background', cost: 0.1 };
      if (type === 'prompt') {
        options.onRecord({ type: 'extension_ui_request', method: 'input', title: 'hobkin/bridge', id: 'request', placeholder: JSON.stringify({ op: 'tool', name: 'owned_agent', id: 'call', params: { action: 'spawn', name: 'unauthorized' } }) });
        await response.promise;
        options.onRecord({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'parent report' }] } });
        options.onRecord({ type: 'agent_settled' }); return { disposition: 'started' };
      }
    },
  }) });
  assert.match(JSON.parse((await response.promise).value).error, /prohibits/);
  assert.equal(result.status, 'completed'); assert.equal(result.text, 'parent report'); assert.equal(result.cost.usd, 0.1); assert.ok(result.performance);
  await life.close();
});

test('application close invalidates owned admission before waiting for main idle', { timeout: 1000 }, async () => {
  const order = [], app = new HobkinApplication(); app.openedAt = 0;
  app.runtime = { ownedLifecycle: { close: async () => order.push('owned') }, main: { abort: async () => order.push('abort') },
    idle: async () => { assert.equal(order[0], 'owned'); order.push('idle'); }, close: async () => order.push('close') };
  await app.close();
  assert.deepEqual(order, ['owned', 'abort', 'idle', 'close']);
});

test('presentDecision carries the authoritative next-unshown ID into the question', { timeout: 1000 }, async () => {
  const app = new HobkinApplication(), next = { id: 'decision:stable', at: new Date().toISOString(), question: 'Which?', choices: [{ value: 'yes', label: 'Yes' }] };
  app.runtime = { directory: fixtureHome }; app.now = Date.now; app.nextUnshown = () => next;
  let seen; app.askQuestion = async request => { seen = request; }; await app.presentDecision();
  assert.equal(seen.requestId, next.id); assert.equal(seen.question, next.question); assert.deepEqual(seen.choices, next.choices);
});
