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
import { WorkDirector } from '../src/cli/work/director.mjs';

for (const name of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) mock.method(childProcess, name, () => { throw Error('Real process forbidden'); });
syncBuiltinESMExports();
mock.method(process, 'kill', () => { throw Error('Real signal forbidden'); });
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
        async abort() {}, async clearQueue() { return { steering: [], followUp: [] }; }, async dispose() {},
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

test('helpers get the user\'s whole directions, past the first 16 KB', { timeout: 1000 }, async () => {
  const calls = [];
  const scope = { request: () => [], async join() { return undefined; }, async cancel() { return { confirmed: true }; }, finish() {} };
  const f = runtimeFixture({ register: binding => { calls.push(binding); return scope; }, async close() {} });
  const directions = `# Directions\n\n${'Keep going. '.repeat(2000)}\n\n## Merging and deploying\n\nThe user's ask is the yes.\n`;
  writeFileSync(`${fixtureHome}/AGENTS.md`, directions);
  await f.runtime.connect();
  await f.runtime.send('fix it and deploy', 'whole-directions');
  await f.runtime.idle();
  assert.equal(JSON.parse(calls[0].binding.prompt).directions, directions);
  await f.runtime.close();
});

test('helpers get the index of shared memories and never a private one, and none when there are no memories', { timeout: 2000 }, async t => {
  const { addMemory } = await import('../src/cli/memories.mjs');
  const calls = [];
  const scope = { request: () => [], async join() { return undefined; }, async cancel() { return { confirmed: true }; }, finish() {} };
  const f = runtimeFixture({ register: binding => { calls.push(binding); return scope; }, async close() {} });
  t.after(() => rmSync(join(fixtureHome, 'memories'), { recursive: true, force: true }));
  await f.runtime.connect();
  await f.runtime.send('look it up', 'no-memories');
  await f.runtime.idle();
  assert.equal(Object.hasOwn(JSON.parse(calls[0].binding.prompt), 'memories'), false);
  const as = { by: { kind: 'user' }, source: { kind: 'window' } };
  addMemory(fixtureHome, { name: 'lives-in-lisbon', kind: 'user', description: 'Lives in Lisbon' }, as);
  addMemory(fixtureHome, { name: 'partner-name', kind: 'user', description: 'Partner is called Ana', private: true }, as);
  await f.runtime.send('look it up again', 'with-memories');
  await f.runtime.idle();
  const { memories } = JSON.parse(calls[1].binding.prompt);
  assert.match(memories, /- lives-in-lisbon: Lives in Lisbon/);
  assert.doesNotMatch(calls[1].binding.prompt, /partner|Ana/);
  assert.doesNotMatch(memories, /hobkin_recall|hobkin memory/, 'a helper has no tool to read one whole');
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
    if (stop === 'close') await f.runtime.close();
    else await assert.rejects(f.runtime[stop](), { code: 'STOP_UNCONFIRMED', cancellationConfirmed: false, queueRecovery: 'confirmed' });
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

test('owned harness forwards only trusted policy while retaining closed admission and cleanup', { timeout: 1000 }, async () => {
  const app = Object.create(HobkinApplication.prototype), calls = [], active = {};
  const policy = () => true, scope = { cancel: async () => ({ confirmed: true }) };
  app.runtime = { directory: fixtureHome, active: new Map([['root', active]]),
    state: async () => ({ runs: { root: { id: 'root', harnessId: 'harness', status: 'running' } } }),
    ownedLifecycle: { register: options => { calls.push(options); return scope; } },
    bindHarness: (...args) => calls.push(args) };
  const wrapped = app.ownedHarness(async (request, options) => {
    assert.equal(options.metricsRoot, fixtureHome); assert.equal(options.ownedScope, scope);
    options.onControl('captured'); return 'result';
  });
  assert.equal(await wrapped({ id: 'harness' }, { beforeSpawn: policy, metricsRoot: 'foreign', ownedScope: {}, onControl: () => assert.fail() }), 'result');
  assert.equal(calls[0].beforeSpawn, policy); assert.equal(calls[0].allowHelpers, false);
  assert.equal(calls[0].id, 'root'); assert.deepEqual(calls[1], ['root', 'harness', 'captured']);
  assert.deepEqual(active.cleanup, { confirmed: true });
});

test('application close invalidates owned admission before waiting for main idle', { timeout: 1000 }, async () => {
  const order = [], app = new HobkinApplication(); app.openedAt = 0;
  app.runtime = { ownedLifecycle: { close: async () => order.push('owned') }, quitMain: async () => order.push('quit'),
    idle: async () => { assert.equal(order[0], 'owned'); order.push('idle'); }, close: async () => order.push('close') };
  await app.close();
  assert.deepEqual(order, ['owned', 'quit', 'idle', 'close']);
});

test('parent Force before transport capture binds only the admitted run/harness, before startup awaits', { timeout: 1000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = runtimeFixture(createOwnedLifecycle({ startProcess: () => { throw Error('No helpers'); } }));
  const ready = Promise.withResolvers(), closed = Promise.withResolvers();
  const calls = [];
  const harnessId = '11111111-1111-4111-8111-111111111111';
  const work = f.runtime.dispatch({ id: 'parent', kind: 'background', harnessId }, async signal => {
    await ready.promise;
    return runHarness({ id: harnessId, harness: 'pi', model: 'test/model', effort: 'medium', cwd: fixtureHome,
      prompt: 'check', sessionFile: `${fixtureHome}/captured.jsonl`, signal }, {
      onControl: child => f.runtime.bindHarness('parent', harnessId, child),
      startProcess: () => ({ closed: closed.promise, force() { calls.push('force'); }, terminate() {},
        async request(type) { calls.push(type); throw Error('Startup interrupted'); } }),
    });
  });
  await tick();
  assert.throws(() => f.runtime.bindHarness('parent', 'wrong-harness', {}), /identity|harness/i);
  const force = f.runtime.forceRun('parent');
  ready.resolve();
  await tick();
  assert.deepEqual(calls.slice(0, 2), ['force', 'get_state']);
  assert.equal(f.runtime.active.get('parent').controller.signal.aborted, true);
  assert.equal(f.runtime.stopControls().targets[0].runId, 'parent');
  t.mock.timers.tick(2000); const unknown = await force; assert.equal(unknown.closure.status, 'unknown');
  const retry = f.runtime.forceRun('parent');
  closed.resolve({}); assert.equal((await retry).closure.status, 'confirmed'); await work;
  assert.equal(unknown.closure.status, 'unknown', 'later close cannot rewrite the prior receipt');
  assert.deepEqual(f.runtime.stopControls().targets, []);
  assert.throws(() => f.runtime.bindHarness('parent', harnessId, {}), /identity|harness/i);
});

test('terminal parent retains exact nested control authority and rejects a different root', { timeout: 1000 }, async () => {
  const transports = [], life = createOwnedLifecycle({ stopMs: 5, startProcess: () => {
    const closed = Promise.withResolvers(), transport = { closed: closed.promise, resolve: closed.resolve, force() {}, terminate() {}, shutdown: () => closed.promise,
      request: async type => type === 'get_state' ? { sessionId: 'child', model: { provider: 'test', id: 'model' }, thinkingLevel: 'medium' } : {} };
    transports.push(transport); return transport;
  } });
  const binding = { cwd: fixtureHome, prompt: 'task', model: 'test/model', effort: 'medium', role: 'read', parentRole: 'read' };
  const parent = life.register({ id: 'finished-parent', allowHelpers: true, binding });
  life.register({ id: 'other-parent', allowHelpers: true, binding });
  const child = parent.request({ action: 'spawn', name: 'exact child' }); await tick();
  await parent.cancel();
  const app = new HobkinApplication(), f = runtimeFixture(life);
  app.runtime = f.runtime; app.now = Date.now; app.refresh = async () => {};
  f.state.runs['finished-parent'] = { id: 'finished-parent', status: 'interrupted', result: { text: 'preserved' } };
  assert.equal(f.runtime.stopControls().targets[0].agentId, child.id);
  const args = { kind: 'agent', runId: 'finished-parent', agentId: child.id, mode: 'stop', attemptId: '11111111-1111-4111-8111-111111111111' };
  await assert.rejects(app.stopExecution({ ...args, runId: 'other-parent' }), /target|scope|identity/i);
  assert.equal((await app.stopExecution(args)).closure.status, 'unknown');
  const force = app.stopExecution({ ...args, mode: 'force' }); transports[0].resolve({});
  assert.equal((await force).closure.status, 'confirmed');
  assert.equal(f.state.runs['finished-parent'].result.text, 'preserved'); assert.deepEqual(f.runtime.stopControls().targets, []);
  await life.close();
});

test('Work Force pins user intent and decline before immediate close; legacy Stop keeps its disposition', { timeout: 1000 }, async () => {
  const f = runtimeFixture(createOwnedLifecycle()), app = new HobkinApplication();
  const closed = Promise.withResolvers(), done = Promise.withResolvers(), pendingStop = Promise.withResolvers();
  const workRun = { id: 'work:exact', title: 'Work', item: 'item' };
  const director = Object.create(WorkDirector.prototype); director.root = fixtureHome; director.active = new Map([[workRun.id, workRun]]);
  app.runtime = f.runtime; app.director = director; app.now = Date.now; app.refresh = async () => {};
  let stops = 0;
  app.runner = director.runner = { kill() { assert.equal(++stops, 1, 'Force cannot enter the pending runner Stop'); return pendingStop.promise; } };
  const completion = f.runtime.dispatch({ id: workRun.id, kind: 'background', harnessId: 'exact', work: { lane: 'do' } }, () => done.promise);
  await tick(); f.runtime.bindHarness(workRun.id, 'exact', { closed: closed.promise, force() {
    assert.equal(workRun.declined, true); assert.equal(f.runtime.active.get(workRun.id).userStop.reason, 'Not approved.');
    closed.resolve({}); done.resolve({ status: 'interrupted', text: 'Partial Work' });
  } });
  const args = { kind: 'run', runId: workRun.id, how: 'not-approved', attemptId: '11111111-1111-4111-8111-111111111111' };
  const stopping = app.stopExecution({ ...args, mode: 'stop' });
  const result = await app.stopExecution({ ...args, mode: 'force' });
  assert.equal(result.closure.status, 'confirmed'); assert.equal(result.stop.status, 'confirmed'); await completion;
  pendingStop.resolve(true); assert.equal((await stopping).stop.status, 'confirmed');
  assert.equal(f.state.runs[workRun.id].userStop.reason, 'Not approved.'); assert.equal(f.state.runs[workRun.id].result.text, 'Partial Work');
  let stop; director.runner = { kill: async (_id, value) => { stop = value; return true; } };
  workRun.declined = false; assert.equal(await director.stopRun(workRun.id, { decline: true }), workRun);
  assert.equal(stop.reason, 'Not approved.'); assert.equal(workRun.declined, true);
  workRun.declined = false;
  await assert.rejects(director.stopRun(workRun.id, { decline: true, stopOperation: async () => { throw Object.assign(Error('Unknown'), { code: 'STOP_UNCONFIRMED' }); } }), { code: 'STOP_UNCONFIRMED' });
  assert.equal(workRun.declined, true);
  assert.equal(await director.stopRun(workRun.id, { stopOperation: async () => true }), workRun);
});

test('a stale Work Stop cannot undo a newer unconfirmed not-approved Force', { timeout: 10000 }, async t => {
  for (const outcome of ['false', 'error']) await t.test(outcome, { timeout: 10000 }, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = runtimeFixture(createOwnedLifecycle()), app = new HobkinApplication();
    const closed = Promise.withResolvers(), done = Promise.withResolvers(), pendingStop = Promise.withResolvers();
    const workRun = { id: `work:stale-${outcome}`, title: 'Work', item: 'item' };
    const director = Object.create(WorkDirector.prototype); director.root = fixtureHome; director.active = new Map([[workRun.id, workRun]]);
    app.runtime = f.runtime; app.director = director; app.now = Date.now; app.refresh = async () => {};
    app.runner = director.runner = { kill: () => pendingStop.promise };
    const completion = f.runtime.dispatch({ id: workRun.id, kind: 'background', harnessId: 'exact', work: { lane: 'do' } }, () => done.promise);
    await tick();
    f.runtime.bindHarness(workRun.id, 'exact', { closed: closed.promise, force: () => assert.equal(workRun.declined, true) });

    const args = { kind: 'run', runId: workRun.id, attemptId: '11111111-1111-4111-8111-111111111111' };
    const olderStop = app.stopExecution({ ...args, how: 'for-now', mode: 'stop' });
    await tick();
    const force = app.stopExecution({ ...args, how: 'not-approved', mode: 'force' });
    t.mock.timers.tick(2000);
    await tick();
    assert.equal((await olderStop).stop.status, 'unknown');
    t.mock.timers.tick(2000);
    assert.equal((await force).closure.status, 'unknown');
    assert.equal(workRun.declined, true);

    if (outcome === 'false') pendingStop.resolve(false);
    else pendingStop.reject(Error('older Stop failed'));
    await tick(); await tick();
    assert.equal(workRun.declined, true);

    workRun.declined = false;
    await assert.rejects(director.stopRun(workRun.id, { decline: true, stopOperation: async () => { throw Error('own Stop failed'); } }), /own Stop failed/);
    assert.equal(workRun.declined, false);
    const staleDecline = Promise.withResolvers();
    const stale = director.stopRun(workRun.id, { decline: true, stopOperation: () => staleDecline.promise });
    await director.stopRun(workRun.id, { decline: true, stopOperation: async () => true });
    staleDecline.resolve(false);
    assert.equal(await stale, null);
    assert.equal(workRun.declined, true);
    closed.resolve({}); done.resolve({ status: 'interrupted', text: 'partial' }); await completion;
    await f.runtime.close();
  });
});

test('presentDecision carries the authoritative next-unshown ID into the question', { timeout: 1000 }, async () => {
  const app = new HobkinApplication(), next = { id: 'decision:stable', at: new Date().toISOString(), question: 'Which?', choices: [{ value: 'yes', label: 'Yes' }] };
  app.runtime = { directory: fixtureHome }; app.now = Date.now; app.nextUnshown = () => next;
  let seen; app.askQuestion = async request => { seen = request; }; await app.presentDecision();
  assert.equal(seen.requestId, next.id); assert.equal(seen.question, next.question); assert.deepEqual(seen.choices, next.choices);
});
