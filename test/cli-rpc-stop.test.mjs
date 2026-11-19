import assert from 'node:assert/strict';
import { test, mock, after } from 'node:test';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const refuse = () => { throw Error('Real process, SDK or network forbidden'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) mock.method(childProcess, name, refuse);
mock.method(process, 'kill', refuse);
mock.method(globalThis, 'fetch', refuse);
syncBuiltinESMExports();
const sdkStub = `data:text/javascript,${encodeURIComponent(`
  const refuse = () => { throw Error('Real SDK execution forbidden'); };
  export const defineTool = refuse, createAgentSession = refuse, ModelRuntime = { create: refuse };
  export class DefaultResourceLoader { reload() { refuse(); } }
`)}`;
const sdkGuard = registerHooks({ resolve(specifier, context, next) {
  return specifier === '@earendil-works/pi-coding-agent' ? { url: sdkStub, shortCircuit: true } : next(specifier, context);
} });
after(() => sdkGuard.deregister());
const { HobkinRuntime } = await import('../src/cli/runtime.mjs');
const { PiRpcSession } = await import('../src/cli/rpc-session.mjs');
const { HobkinApplication } = await import('../src/cli/application.mjs');
const { allCardActions } = await import('../src/cli/work/card-actions.mjs');
const { createOwnedLifecycle } = await import('../src/cli/owned-agent-lifecycle.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const options = { timeout: 2000 };
const observe = promise => {
  const result = {};
  promise.then(value => { result.value = value; }, error => { result.error = error; });
  return result;
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'rpc-stop-'));
  const prompt = Promise.withResolvers(), state = { runs: {} }, queue = [];
  const calls = { abort: 0, owned: 0, prompt: 0 }, cleanup = [];
  const session = { sessionId: 'synthetic', model: { provider: 'fixture', id: 'local' }, messages: [
    { role: 'assistant', content: [{ type: 'text', text: 'Partial output' }] },
  ], subscribe: () => () => {}, getSessionStats: () => ({ sessionId: 'synthetic', cost: 0 }),
  async prompt(_text, opts) { calls.prompt++; session.isStreaming = true; opts.preflightResult('started'); await prompt.promise; },
  async steer(text) { queue.push(text); return 'queued'; },
  clearQueue: () => ({ steering: queue.splice(0), followUp: [] }),
  async abort() { calls.abort++; session.isStreaming = false; prompt.reject(Error('Cancelled')); },
  };
  const owned = { async cancel() { calls.owned++; return { confirmed: true, agents: [] }; } };
  const runtime = new HobkinRuntime(root, { main: { cwd: root } }, { ownedLifecycle: { register: () => owned } });
  runtime.main = session;
  runtime.state = async () => structuredClone(state);
  runtime.change = async change => change(state);
  t.after(async () => { cleanup.forEach(release => release()); prompt.reject(Error('Fixture cleanup')); await runtime.idle(); rmSync(root, { recursive: true, force: true }); });
  return { runtime, session, state, calls, prompt, queue, cleanup };
}

test('Stop cancels before pending steering, joins repeats, and preserves interrupted output and drafts', options, async t => {
  const h = fixture(t), steering = Promise.withResolvers();
  h.cleanup.push(() => steering.resolve('queued'));
  h.session.steer = text => { h.queue.push(text); return steering.promise; };
  await h.runtime.send('Original', 'original');
  const queued = h.runtime.send('Correction', 'correction');
  await tick();
  const controller = h.runtime.active.get('original').controller;
  const stopping = h.runtime.interrupt(), repeated = h.runtime.interrupt();
  stopping.catch(() => {}); repeated.catch(() => {});
  await tick();
  assert.equal(controller.signal.aborted, true);
  assert.ok(h.calls.abort > 0);
  assert.ok(h.calls.owned > 0);
  steering.resolve('queued');
  await queued;
  assert.deepEqual(await stopping, ['Correction']);
  assert.deepEqual(await repeated, ['Correction']);
  assert.equal(h.state.runs.original.result.text, 'Partial output');
  assert.equal(h.state.runs.original.status, 'interrupted');
  assert.equal(h.state.runs.correction.status, 'interrupted');
  await assert.rejects(h.runtime.send('Original', 'original'), /already admitted|preflight/i);
  await h.runtime.idle();
  assert.equal(h.calls.prompt, 1, 'no replay of an interrupted admission');
});

test('a stalled queue cannot delay cancellation and yields explicit unknown draft recovery', options, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), queue = Promise.withResolvers();
  h.cleanup.push(() => queue.resolve({ steering: ['Unobserved text'], followUp: [] }));
  let recoveries = 0;
  h.session.clearQueue = () => { recoveries++; return queue.promise; };
  await h.runtime.send('Original', 'original');
  const stopped = observe(h.runtime.interrupt());
  await tick(); await h.runtime.idle();
  assert.ok(h.calls.abort > 0);
  await assert.rejects(h.runtime.send('Cannot race recovery', 'late'), /stopping/i);
  assert.equal(h.runtime.mainFree, false);
  t.mock.timers.tick(30000); await tick();
  assert.equal(stopped.error?.code, 'STOP_UNCONFIRMED');
  assert.equal(stopped.error?.queueRecovery, 'unknown');
  assert.equal(stopped.error?.cancellationConfirmed, true);
  assert.equal(h.state.runs.original.status, 'interrupted');
  const retried = observe(h.runtime.interrupt());
  await tick();
  assert.equal(recoveries, 1, 'an outstanding clearQueue is joined, not sent again');
  t.mock.timers.tick(30000); await tick();
  assert.equal(retried.error?.code, 'STOP_UNCONFIRMED');
  queue.resolve({ steering: ['Unobserved text'], followUp: [] }); await tick();
  assert.equal(h.runtime.mainFree, false, 'late recovery alone cannot release Stop custody');
  assert.deepEqual(await h.runtime.interrupt(), ['Unobserved text']);
  assert.equal(recoveries, 1);
  assert.equal(h.runtime.mainFree, true);
  assert.equal(await h.runtime.interrupt(), null);
  assert.equal(h.calls.prompt, 1);
  h.session.prompt = async (_text, opts) => { h.calls.prompt++; opts.preflightResult('started'); };
  assert.deepEqual(await h.runtime.send('Explicit new task', 'new'), { id: 'new' });
  await h.runtime.idle();
  assert.equal(h.calls.prompt, 2, 'only a new user submission starts another prompt');
});

test('uncooperative in-process abort remains unknown and a later Stop retries without new prompts', options, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), abort = Promise.withResolvers();
  h.cleanup.push(() => abort.resolve());
  h.session.abort = () => { h.calls.abort++; return abort.promise; };
  await h.runtime.send('Original', 'original');
  await h.runtime.send('Unread correction', 'queued');
  const first = observe(h.runtime.interrupt());
  await tick(); t.mock.timers.tick(30000); await tick();
  assert.equal(first.error?.code, 'STOP_UNCONFIRMED');
  assert.equal(h.state.runs.original.status, 'running');
  const calls = h.calls.abort;
  h.runtime.mainFault = Error('Synthetic availability fault');
  const second = observe(h.runtime.interrupt());
  await tick();
  assert.ok(h.calls.abort > calls);
  await assert.rejects(h.runtime.send('Do not queue after Stop', 'late'), /stopped|stopping/i);
  abort.resolve(); h.prompt.reject(Error('Eventually cancelled'));
  await tick();
  assert.deepEqual(second.value, ['Unread correction']);
  assert.equal(h.state.runs.original.status, 'interrupted');
  assert.equal(h.calls.prompt, 1);
});

test('Stop prevents an admitted but not yet delivered steering message from reaching Pi', options, async t => {
  const h = fixture(t), admission = Promise.withResolvers();
  h.cleanup.push(() => admission.resolve());
  await h.runtime.send('Original', 'original');
  const admit = h.runtime.admit.bind(h.runtime);
  h.runtime.admit = async request => { if (request.id === 'late') await admission.promise; return admit(request); };
  const queued = observe(h.runtime.send('Late correction', 'late'));
  const stopped = h.runtime.interrupt();
  await tick(); admission.resolve();
  assert.deepEqual(await stopped, []);
  assert.match(queued.error?.message ?? '', /stopping/i);
  assert.equal(h.state.runs.late.status, 'interrupted');
  assert.deepEqual(h.queue, []);
});

test('unknown owned cleanup cannot become a successful Stop receipt', options, async t => {
  const h = fixture(t);
  h.runtime.ownedLifecycle.register = () => ({ cancel: async () => ({ confirmed: false, agents: [] }) });
  await h.runtime.send('Original', 'original');
  await assert.rejects(h.runtime.interrupt(), { code: 'STOP_UNCONFIRMED', cancellationConfirmed: false });
  assert.equal(h.state.runs.original.status, 'interrupted');
  assert.equal(h.state.runs.original.result.ownedCleanupConfirmed, false);
  assert.equal(h.state.runs.original.result.text, 'Partial output');
});

for (const [name, reply] of Object.entries({ missing: undefined, undefined: undefined, null: null, empty: {}, array: [],
  missingSteering: { followUp: [] }, missingFollowUp: { steering: [] },
  steeringText: { steering: 'draft', followUp: [] }, steeringValue: { steering: [42], followUp: [] }, sparse: { steering: Array(1), followUp: [] },
  followUpText: { steering: [], followUp: 'draft' }, followUpValue: { steering: [], followUp: [null] },
  followUpNull: { steering: [], followUp: null }, followUpUndefined: { steering: [], followUp: undefined },
})) test(`Stop rejects ${name} queue recovery`, options, async t => {
  const h = fixture(t);
  h.session.clearQueue = name === 'missing' ? undefined : () => reply;
  await h.runtime.send('Original', 'original');
  await assert.rejects(h.runtime.interrupt(), { code: 'STOP_UNCONFIRMED', queueRecovery: 'unknown' });
  await h.runtime.idle();
  assert.equal(h.state.runs.original.result.text, 'Partial output');
});

for (const reply of [undefined, null, {}, { confirmed: 1 }]) test(`owned cleanup requires true, not ${JSON.stringify(reply)}`, options, async t => {
  const h = fixture(t);
  h.runtime.ownedLifecycle.register = () => ({ cancel: async () => reply });
  await h.runtime.send('Original', 'original');
  await assert.rejects(h.runtime.interrupt(), { code: 'STOP_UNCONFIRMED', cancellationConfirmed: false });
});

for (const source of ['abort', 'owned']) test(`Stop retries ${source} after the parent settles without clearing recovered drafts again`, options, async t => {
  const h = fixture(t);
  let confirmed = false, recoveries = 0, attempts = 0;
  h.session.clearQueue = () => { recoveries++; return { steering: ['Recovered'], followUp: ['Follow up'] }; };
  if (source === 'owned') h.runtime.ownedLifecycle.register = () => ({ async cancel() { attempts++; return { confirmed }; } });
  else h.session.abort = async () => {
    attempts++; h.session.isStreaming = false; h.prompt.reject(Error('Cancelled'));
    if (!confirmed) throw Error('Abort receipt unavailable');
  };
  await h.runtime.send('Original', 'original');
  await assert.rejects(h.runtime.interrupt(), { code: 'STOP_UNCONFIRMED', cancellationConfirmed: false });
  await h.runtime.idle();
  assert.equal(h.state.runs.original.result.text, 'Partial output');
  const before = attempts; confirmed = true;
  assert.deepEqual(await h.runtime.interrupt(), ['Recovered', 'Follow up']);
  assert.ok(attempts > before);
  assert.equal(recoveries, 1);
  assert.equal(h.calls.prompt, 1);
});

for (const failure of ['rejected', 'malformed']) test(`${failure} recovery after a drain stays unknown across cancellation retries`, options, async t => {
  const h = fixture(t);
  let recoveries = 0;
  h.session.clearQueue = () => {
    h.queue.splice(0);
    if (++recoveries > 1) return { steering: [], followUp: [] };
    if (failure === 'rejected') throw Error('Lost reply after drain');
    return {};
  };
  await h.runtime.send('Original', 'original');
  await h.runtime.send('Lost draft', 'draft');
  await assert.rejects(h.runtime.interrupt(), { code: 'STOP_UNCONFIRMED', queueRecovery: 'unknown' });
  await h.runtime.idle(); await tick();
  const { abort, owned } = h.calls;
  await assert.rejects(h.runtime.interrupt(), { code: 'STOP_UNCONFIRMED', cancellationConfirmed: true, queueRecovery: 'unknown' });
  assert.ok(h.calls.abort > abort && h.calls.owned > owned);
  assert.equal(recoveries, 1);
  await assert.rejects(h.runtime.send('Still fenced', 'late'), /stopping/i);
});

for (const owned of [false, true]) test(`Stop confirms ${owned ? 'real owned lifecycle cleanup' : 'no owned lifecycle'}`, options, async t => {
  const h = fixture(t);
  h.session.thinkingLevel = 'medium';
  h.runtime.ownedLifecycle = owned ? createOwnedLifecycle({ startProcess: refuse }) : undefined;
  await h.runtime.send('Original', 'original');
  assert.deepEqual(await h.runtime.interrupt(), []);
  assert.equal(h.state.runs.original.result.text, 'Partial output');
  if (owned) assert.equal(h.state.runs.original.result.ownedCleanupConfirmed, true);
});

const until = async check => {
  for (let turns = 0; turns < 1000 && !check(); turns++) await tick();
  assert.ok(check());
};
/** A turn held by a tool that does not listen for a stop: Pi answers the stop only once the tool returns. */
function heldByTool(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), tool = Promise.withResolvers();
  h.cleanup.push(() => tool.resolve());
  h.session.abort = async () => {
    h.calls.abort++;
    await tool.promise;
    h.session.isStreaming = false;
    h.prompt.reject(Error('Cancelled'));
  };
  return { ...h, tool };
}
const stopLines = h => allCardActions(h.runtime.directory).filter(action => action.id === 'main-stop:original');

test('a turn whose tool ignores the stop is confirmed once Pi stops, inside the thirty seconds', options, async t => {
  const h = heldByTool(t);
  await h.runtime.send('Review the pull request', 'original');
  const stopping = h.runtime.interrupt(), stopped = observe(stopping);
  await tick(); t.mock.timers.tick(29000); await tick();
  assert.deepEqual(stopped, {});
  await assert.rejects(h.runtime.send('Meanwhile', 'meanwhile'), { message: 'Main conversation is stopping.' });
  h.tool.resolve();
  assert.deepEqual(await stopping, []);
  assert.equal(h.runtime.mainFree, true);
  assert.equal(h.state.runs.original.status, 'interrupted');
});

test('a stop that outlasted its wait lets go once Pi stops, and Chat says so once', options, async t => {
  const h = heldByTool(t);
  let changes = 0;
  h.runtime.onChange = () => { changes++; };
  await h.runtime.send('Review the pull request', 'original');
  const stopped = observe(h.runtime.interrupt());
  await tick(); t.mock.timers.tick(30000); await tick();
  assert.equal(stopped.error?.code, 'STOP_UNCONFIRMED');
  await assert.rejects(h.runtime.send('Meanwhile', 'meanwhile'), { message: 'Main conversation is stopping.' });
  assert.equal(stopLines(h).length, 0);

  const before = changes;
  h.tool.resolve();
  await until(() => h.runtime.mainFree);
  assert.ok(changes > before, 'the window hears it');
  assert.equal(h.runtime.mainTurn, null);
  assert.deepEqual(stopLines(h).map(action => action.line), ['You stopped hobkin.']);
  assert.equal(await h.runtime.interrupt(), null, 'nothing is left to stop');
  h.session.prompt = async (_text, opts) => { h.calls.prompt++; opts.preflightResult('started'); };
  assert.deepEqual(await h.runtime.send('Next', 'next'), { id: 'next' });
  await h.runtime.idle();
  assert.equal(stopLines(h).length, 1);
});

test('one with a message Pi never read keeps the conversation until the next stop gives it back', options, async t => {
  const h = heldByTool(t);
  await h.runtime.send('Review the pull request', 'original');
  await h.runtime.send('Also check the tests', 'unread');
  const stopped = observe(h.runtime.interrupt());
  await tick(); t.mock.timers.tick(30000); await tick();
  assert.equal(stopped.error?.code, 'STOP_UNCONFIRMED');

  h.tool.resolve();
  await until(() => h.runtime.mainTurn?.cancellationConfirmed && h.state.runs.original.status === 'interrupted');
  await tick();
  await assert.rejects(h.runtime.send('A new question', 'new'), { message: 'Stop hobkin again to get back what it had not read.' });
  assert.equal(h.runtime.mainFree, false, 'the conversation stays held');
  assert.equal(stopLines(h).length, 0);
  assert.deepEqual(await h.runtime.interrupt(), ['Also check the tests']);
  assert.equal(h.runtime.mainFree, true);
});

test('a turn still being stopped keeps an ended Pi from opening again, and so does a reset', options, async t => {
  const h = heldByTool(t);
  let opened = 0;
  h.runtime.createMain = async () => { opened++; throw Error('Opened while it should not.'); };
  assert.equal(await h.runtime.reopenMain(), h.session, 'a running Pi is left alone');
  await h.runtime.send('Review the pull request', 'original');
  const stopping = h.runtime.interrupt();
  await tick();
  h.runtime.mainFault = Error('Main Pi exited before completion (1).');
  await assert.rejects(h.runtime.reopenMain(), { message: 'Main conversation is stopping.' });
  h.runtime.resetting = true;
  await assert.rejects(h.runtime.reopenMain(), { message: 'Main conversation is resetting.' });
  h.runtime.resetting = false;
  assert.equal(opened, 0);
  h.tool.resolve();
  assert.deepEqual(await stopping, []);
});

function rpcFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ack = Promise.withResolvers(), closed = Promise.withResolvers(), calls = [];
  const session = new PiRpcSession({});
  session.attach({ closed: closed.promise,
    request(type) { calls.push(type); return ack.promise; },
    fail(error) { calls.push('fail'); ack.reject(error); },
  });
  t.after(() => { ack.resolve(); closed.resolve({ error: Error('Fixture closed') }); });
  return { session, ack, closed, calls };
}

/** Each request gets an answer of its own, so a stop asked twice can be told apart. */
function answering(h) {
  const answers = [];
  h.session.child.request = type => {
    h.calls.push(type);
    const answer = Promise.withResolvers();
    answers.push(answer);
    return answer.promise;
  };
  return answers;
}
const refused = message => Object.assign(Error(message), { commandRejected: true });

test('a stop that Pi answers late is waited for, asks once and never ends the process', options, async t => {
  const h = rpcFixture(t), permission = new AbortController();
  h.session.calls.add(permission);
  const stopped = observe(h.session.abort()), repeated = observe(h.session.abort());
  await tick();
  assert.equal(permission.signal.aborted, true, 'a dialog waiting on the user is let go at once');
  t.mock.timers.tick(60000); await tick();
  assert.deepEqual(h.calls, ['abort'], 'no signal, however long Pi takes');
  assert.deepEqual([stopped, repeated], [{}, {}]);
  h.ack.resolve(); await tick();
  assert.ok('value' in stopped && 'value' in repeated);
  assert.deepEqual(h.calls, ['abort']);
});

test('a Pi that exited counts as stopped once its output closes', options, async t => {
  const h = rpcFixture(t);
  const stopped = observe(h.session.abort());
  h.ack.reject(Error('Main Pi exited before completion (1).')); await tick();
  assert.deepEqual(stopped, {}, 'not before its output has closed');
  h.closed.resolve({ error: Error('Main Pi exited before completion (1).') }); await tick();
  assert.ok('value' in stopped);
  assert.deepEqual(h.calls, ['abort']);
});

test('a refusal from a Pi that still runs leaves the stop unconfirmed, and the next stop asks again', options, async t => {
  const h = rpcFixture(t), answers = answering(h);
  const first = observe(h.session.abort());
  answers[0].reject(refused('Nothing to abort.')); await tick();
  assert.match(first.error?.message ?? '', /Nothing to abort/);
  const second = observe(h.session.abort());
  assert.deepEqual(h.calls, ['abort', 'abort']);
  answers[1].resolve(); await tick();
  assert.ok('value' in second);
});

test('a quit ends the process two seconds after an unanswered stop, and waits for its output to close', options, async t => {
  const h = rpcFixture(t), permission = new AbortController();
  h.session.calls.add(permission);
  const quit = observe(h.session.quit()), repeated = observe(h.session.quit());
  await tick();
  assert.equal(permission.signal.aborted, true);
  t.mock.timers.tick(1999); await tick();
  assert.deepEqual(h.calls, ['abort']);
  t.mock.timers.tick(1); await tick();
  assert.deepEqual(h.calls, ['abort', 'fail']);
  assert.deepEqual(quit, {}, 'a signal is only a request');
  h.closed.resolve({ error: Error('Captured child exited') }); await tick();
  assert.ok('value' in quit && 'value' in repeated);
  assert.equal(await h.session.exited, null, 'a requested end does not stop the chat');
});

test('a quit whose process does not close is bounded and never confirmed', options, async t => {
  const h = rpcFixture(t);
  const quit = observe(h.session.quit());
  await tick(); t.mock.timers.tick(2000); await tick();
  assert.deepEqual(h.calls, ['abort', 'fail']);
  t.mock.timers.tick(2000); await tick();
  assert.match(quit.error?.message ?? '', /exit.*unconfirmed/i);
  const retried = h.session.quit();
  h.closed.resolve({ error: Error('Late captured exit') });
  await retried;
});

test('a quit that Pi answers ends nothing', options, async t => {
  const h = rpcFixture(t);
  const first = h.session.quit(), second = h.session.quit();
  h.ack.resolve();
  await Promise.all([first, second]);
  t.mock.timers.tick(5000); await tick();
  assert.deepEqual(h.calls, ['abort']);
});

test('RPC Force bypasses pending Stop and requires captured close, not a signal', options, async t => {
  const h = rpcFixture(t), permission = new AbortController();
  h.session.calls.add(permission); h.session.child.force = () => h.calls.push('force');
  const stopping = observe(h.session.abort()), forced = observe(h.session.force());
  assert.deepEqual(h.calls, ['abort', 'force']);
  assert.equal(permission.signal.aborted, true);
  await tick(); assert.equal(forced.value, undefined);
  t.mock.timers.tick(2000); await tick(); assert.equal(forced.value, false);
  const retry = h.session.force(); h.closed.resolve({ error: Error('Closed') });
  assert.equal(await retry, true); await tick(); assert.equal(stopping.error, undefined);
});

function application(h) {
  const app = new HobkinApplication(); app.runtime = h.runtime; app.now = Date.now;
  app.refresh = async () => {}; return app;
}
const control = (mode, attemptId = '11111111-1111-4111-8111-111111111111') => ({ kind: 'main', runId: 'original', mode, attemptId });

test('main Force starts parent and descendants during pending Stop; drafts and notice are claimed once', options, async t => {
  const h = fixture(t), abort = Promise.withResolvers(), calls = [], app = application(h);
  h.cleanup.push(() => abort.resolve()); h.session.abort = () => abort.promise;
  h.runtime.ownedLifecycle.force = async id => { calls.push(id); return { confirmed: true, agents: [] }; };
  h.session.force = async () => { calls.push('parent'); return true; };
  await h.runtime.send('Original', 'original'); await h.runtime.send('Unread draft', 'draft');
  const stopped = app.stopExecution(control('stop')); await tick();
  const forced = app.stopExecution(control('force', '22222222-2222-4222-8222-222222222222'));
  await tick(); assert.deepEqual(calls, ['parent', 'original']);
  assert.equal(h.runtime.stopControls().targets[0].runId, 'original');
  const forceReceipt = await forced;
  assert.equal(forceReceipt.closure.status, 'confirmed'); assert.equal(forceReceipt.descendants.status, 'confirmed');
  abort.resolve(); h.prompt.reject(Error('Cancelled')); const stopReceipt = await stopped;
  assert.equal(stopReceipt.attemptId, control('stop').attemptId);
  assert.equal(forceReceipt.attemptId, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual([...forceReceipt.queueRecovery.unsent, ...stopReceipt.queueRecovery.unsent], ['Unread draft']);
  assert.equal(stopReceipt.queueRecovery.alreadyReturned, true);
  assert.equal(allCardActions(h.runtime.directory).filter(action => action.id === 'main-stop:original').length, 1);
});

test('main Force still reaches descendants when the parent transport throws', options, async t => {
  const h = fixture(t), app = application(h), children = [];
  h.session.force = () => { throw Error('Transport failed'); };
  h.runtime.ownedLifecycle.force = async id => { children.push(id); return { confirmed: true, agents: [] }; };
  await h.runtime.send('Original', 'original');
  await assert.rejects(app.stopExecution(control('force')), /Transport failed/);
  assert.deepEqual(children, ['original']);
});

test('main SDK Force reports unsupported and never retries failed destructive queue recovery', options, async t => {
  const h = fixture(t), app = application(h); let recoveries = 0;
  h.session.clearQueue = () => { recoveries++; throw Error('Lost drain'); };
  await h.runtime.send('Original', 'original');
  const first = await app.stopExecution(control('force'));
  await h.runtime.idle();
  const second = await app.stopExecution(control('stop'));
  assert.equal(second.stop.status, 'confirmed');
  assert.equal(first.closure.status, 'unsupported');
  assert.deepEqual(first.queueRecovery, { status: 'unknown' }); assert.deepEqual(second.queueRecovery, { status: 'unknown' });
  assert.equal(recoveries, 1); assert.equal(h.runtime.stopControls().targets[0].runId, 'original');
  assert.equal(allCardActions(h.runtime.directory).filter(action => action.id === 'main-stop:original').length, 1);
  await assert.rejects(app.stopExecution({ ...control('force'), runId: 'other' }), /target|identity/i);
  await assert.rejects(app.stopExecution({ ...control('stop'), how: 'not-approved' }), /Work parent/);
});

test('a queue transport failure is unknown, never a fabricated empty queue', options, async t => {
  const h = rpcFixture(t);
  const queue = h.session.clearQueue();
  h.ack.reject(Error('Transport unavailable'));
  await assert.rejects(queue, /Transport unavailable/);
});
