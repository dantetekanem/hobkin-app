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
  t.mock.timers.tick(5000); await tick();
  assert.equal(stopped.error?.code, 'STOP_UNCONFIRMED');
  assert.equal(stopped.error?.queueRecovery, 'unknown');
  assert.equal(stopped.error?.cancellationConfirmed, true);
  assert.equal(h.state.runs.original.status, 'interrupted');
  const retried = observe(h.runtime.interrupt());
  await tick();
  assert.equal(recoveries, 1, 'an outstanding clearQueue is joined, not sent again');
  t.mock.timers.tick(5000); await tick();
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
  await tick(); t.mock.timers.tick(5000); await tick();
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

test('RPC Stop escalates a missing acknowledgment but waits for captured close evidence', options, async t => {
  const h = rpcFixture(t), permission = new AbortController();
  h.session.calls.add(permission);
  let settled = false;
  const stopped = h.session.abort().then(() => { settled = true; });
  const repeated = h.session.abort();
  stopped.catch(() => {}); repeated.catch(() => {});
  await tick();
  assert.equal(permission.signal.aborted, true);
  t.mock.timers.tick(2000); await tick();
  assert.deepEqual(h.calls, ['abort', 'fail']);
  assert.equal(settled, false);
  h.closed.resolve({ error: Error('Captured child exited') });
  await Promise.all([stopped, repeated]);
  assert.equal(settled, true);
});

test('RPC escalation without exit is bounded and never returns a successful Stop', options, async t => {
  const h = rpcFixture(t);
  const stopped = observe(h.session.abort());
  await tick(); t.mock.timers.tick(2000); await tick();
  assert.deepEqual(h.calls, ['abort', 'fail']);
  t.mock.timers.tick(2000); await tick();
  assert.match(stopped.error?.message ?? '', /exit.*unconfirmed/i);
  const retried = h.session.abort();
  h.closed.resolve({ error: Error('Late captured exit') });
  await retried;
});

test('acknowledged RPC Stop joins callers and clears its escalation timer', options, async t => {
  const h = rpcFixture(t);
  const first = h.session.abort(), second = h.session.abort();
  h.ack.resolve();
  await Promise.all([first, second]);
  t.mock.timers.tick(5000); await tick();
  assert.deepEqual(h.calls, ['abort']);
});

test('a queue transport failure is unknown, never a fabricated empty queue', options, async t => {
  const h = rpcFixture(t);
  const queue = h.session.clearQueue();
  h.ack.reject(Error('Transport unavailable'));
  await assert.rejects(queue, /Transport unavailable/);
});
