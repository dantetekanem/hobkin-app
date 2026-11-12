import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const forbidden = () => { throw Error('Real child, signal, SDK or network execution forbidden'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) mock.method(childProcess, name, forbidden);
for (const [module, names] of [[net, ['connect', 'createConnection']], [http, ['request', 'get']], [https, ['request', 'get']]]) {
  for (const name of names) mock.method(module, name, forbidden);
}
mock.method(process, 'kill', forbidden);
mock.method(globalThis, 'fetch', forbidden);
syncBuiltinESMExports();
const { startMainSessionChild, runMainSessionChild } = await import('../src/cli/main-session-child.mjs');
const { openRpcSession } = await import('../src/cli/rpc-session.mjs');
const { HobkinRuntime } = await import('../src/cli/runtime.mjs');

function bootstrap(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-child-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'sessions'));
  const file = join(root, 'sessions', 'main.jsonl');
  writeFileSync(file, `${JSON.stringify({ type: 'session', version: 3, id: 'saved', cwd: root })}\n`);
  return { type: 'hobkin/main/bootstrap', version: 1, id: 'request-1', root, file,
    expected: { sessionId: 'saved', sessionFile: file }, config: { main: { cwd: root, effort: 'medium' } }, resourceCandidates: [] };
}

function childFixture(t) {
  const data = bootstrap(t), channel = new EventEmitter(), replies = [], calls = [];
  channel.send = record => replies.push(record);
  const session = { sessionId: 'saved', sessionFile: data.file, sessionManager: { getCwd: () => data.root },
    bindExtensions: async hooks => { calls.push(['bind', hooks.mode]); }, reload: async () => { calls.push(['reload']); },
    prompt: async message => { calls.push(['prompt', message]); } };
  const services = { cwd: data.root, assertMainInvariants() {} };
  class Runtime {
    constructor(value, actualServices) { assert.equal(value, session); assert.equal(actualServices, services); this.session = value; }
    setRebindSession() {}
    async dispose() { calls.push(['dispose']); }
    async newSession() { calls.push(['teardown']); }
    async switchSession() { calls.push(['teardown']); }
    async fork() { calls.push(['teardown']); }
    async importFromJsonl() { calls.push(['teardown']); }
  }
  const dependencies = { loadSdk: async () => ({ AgentSessionRuntime: Runtime, runRpcMode: async runtime => {
    calls.push(['native']); await runtime.session.bindExtensions({ mode: 'rpc' });
    for (const method of ['newSession', 'switchSession', 'fork', 'importFromJsonl']) await assert.rejects(runtime[method]('other'), /replacement/);
    await runtime.session.reload();
    await runtime.dispose();
  } }), openSession: async (_options, deps) => {
    assert.equal(deps.deferExtensionBinding, true);
    assert.deepEqual(deps.rpcBridge, {});
    return { session, services };
  } };
  return { data, channel, replies, calls, session, services, dependencies };
}

test('native runner binds once, preserves same-session reload and refuses replacements before teardown', async t => {
  const h = childFixture(t);
  const running = runMainSessionChild(h.channel, h.dependencies);
  h.channel.emit('message', h.data);
  await running;
  assert.deepEqual(h.calls, [['native'], ['bind', 'rpc'], ['reload'], ['dispose']]);
  assert.deepEqual(h.replies, [{ type: 'hobkin/main/ready', version: 1, id: h.data.id,
    sessionId: 'saved', sessionFile: h.data.file, cwd: h.data.root, success: true }]);
});

test('a missing client after native reload rejects and fences later commands', async t => {
  const h = childFixture(t), loadSdk = h.dependencies.loadSdk;
  h.session.reload = async () => { h.calls.push(['reload']); h.services.clientAvailable = false; };
  h.services.clientAvailable = true;
  h.services.assertMainInvariants = () => {
    if (!h.services.clientAvailable) throw Error('The Hobkin client extension is unavailable.');
  };
  h.dependencies.loadSdk = async () => {
    const sdk = await loadSdk();
    return { ...sdk, runRpcMode: async runtime => {
      h.calls.push(['native']); await runtime.session.bindExtensions({ mode: 'rpc' });
      await assert.rejects(runtime.session.reload(), /client extension is unavailable/);
      assert.throws(() => runtime.session.prompt('must not run'), /client extension is unavailable/);
      await runtime.dispose();
    } };
  };
  const running = runMainSessionChild(h.channel, h.dependencies);
  h.channel.emit('message', h.data);
  await running;
  assert.deepEqual(h.calls, [['native'], ['bind', 'rpc'], ['reload'], ['dispose']]);
  assert.equal(h.replies.length, 1, 'reload must not announce a second ready session');
});

test('a fresh session keeps its admitted identity across native reload', async t => {
  const h = childFixture(t), loadSdk = h.dependencies.loadSdk;
  writeFileSync(h.data.file, '');
  h.data.expected = null;
  h.session.reload = async () => { h.session.sessionId = 'changed'; };
  h.dependencies.loadSdk = async () => ({ ...await loadSdk(), runRpcMode: async runtime => {
    await runtime.session.bindExtensions({ mode: 'rpc' });
    const prompt = runtime.session.prompt;
    await assert.rejects(runtime.session.reload(), /identity changed/);
    assert.throws(() => prompt('must not run'), /identity changed/);
    await runtime.dispose();
  } });
  const running = runMainSessionChild(h.channel, h.dependencies);
  h.channel.emit('message', h.data);
  await running;
  assert.deepEqual(h.calls, [['bind', 'rpc'], ['dispose']]);
  assert.equal(h.replies.length, 1);
  assert.equal(h.replies[0].sessionId, 'saved');
});

test('malformed or untrusted bootstrap refuses before SDK loading', async t => {
  const h = childFixture(t);
  for (const patch of [{ version: 2 }, { pid: 22 }, { module: '/tmp/other.mjs' }, { config: { ...h.data.config, auth: 'secret' } },
    { config: { ...h.data.config, background: { harness: 'pi', effort: 'medium', cwd() {} } } },
    { file: '/tmp/not-owned.jsonl' }, { resourceCandidates: [{ id: 'x', kind: 'extensions', installed: true, path: '/tmp/x', execute() {} }] },
    { id: 123 }, { id: 'x'.repeat(65537) },
    { resourceCandidates: Array.from({ length: 30 }, (_, i) => ({ id: `test.${i}`, kind: 'extensions', installed: true, path: `/${'x'.repeat(3000)}` })) }]) {
    const channel = new EventEmitter(); channel.send = () => {};
    const running = runMainSessionChild(channel, { loadSdk: forbidden, openSession: forbidden });
    channel.emit('message', { ...h.data, ...patch });
    await assert.rejects(running, /bootstrap/);
  }
});

test('wrong saved header or opened identity refuses before native RPC', async t => {
  const h = childFixture(t);
  h.session.sessionId = 'other';
  const running = runMainSessionChild(h.channel, h.dependencies);
  h.channel.emit('message', h.data);
  await assert.rejects(running, /identity/);
  assert.ok(!h.calls.some(([name]) => name === 'native'));
  const second = childFixture(t);
  second.data.expected.sessionId = 'other';
  second.dependencies.loadSdk = forbidden;
  const rejected = runMainSessionChild(second.channel, second.dependencies);
  second.channel.emit('message', second.data);
  await assert.rejects(rejected, /identity/);
});

test('duplicate bootstrap fences a pending SDK open and never activates it late', async t => {
  const h = childFixture(t), gate = Promise.withResolvers(), opening = Promise.withResolvers();
  h.dependencies.openSession = async () => { opening.resolve(); await gate.promise; return { session: h.session, services: h.services }; };
  const running = runMainSessionChild(h.channel, h.dependencies);
  h.channel.emit('message', h.data);
  await opening.promise;
  h.channel.emit('message', h.data);
  await assert.rejects(running, /Duplicate/);
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!h.calls.some(([name]) => name === 'native'));
  assert.ok(!h.replies.some(reply => reply.success));
  assert.deepEqual(h.calls, [['dispose']], 'a late valid session must be disposed without native activation');
});

function processFixture(t) {
  const data = bootstrap(t), signals = [], sent = [];
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), connected: true,
    send: (record, callback) => { sent.push(record); callback?.(); } });
  t.after(() => child.emit('close', 0, null));
  const dependencies = { startupTimeoutMs: 50, signalProcess: (target, signal) => { assert.equal(target, child); signals.push(signal); },
    spawnProcess: (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.match(args[0], /\/src\/cli\/main-session-child\.mjs$/);
      assert.equal(args.length, 1);
      assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe', 'ipc']);
      assert.equal(options.shell, false);
      return child;
    } };
  const { type, version, id, ...payload } = data;
  return { data, payload, dependencies, child, sent, signals };
}

test('captured child is Force-addressable before bootstrap readiness and only close confirms custody', async t => {
  const h = processFixture(t), transport = startMainSessionChild(h.payload, h.dependencies);
  const ready = assert.rejects(transport.ready, /exited/);
  assert.equal(h.sent.length, 1);
  const pending = assert.rejects(transport.request('get_state'), /force/);
  transport.force();
  assert.deepEqual(h.signals, ['SIGKILL']);
  transport.force(); // A new explicit retry retains the captured handle while cleanup is unknown.
  assert.deepEqual(h.signals, ['SIGKILL', 'SIGKILL']);
  let closed = false;
  transport.closed.then(() => { closed = true; });
  h.child.emit('exit', null, 'SIGKILL');
  await Promise.resolve();
  assert.equal(closed, false);
  transport.force();
  assert.equal(h.signals.length, 2);
  h.child.emit('close', null, 'SIGKILL');
  await Promise.all([ready, pending, transport.closed]);
});

test('the opt-in RPC opener waits for bootstrap and routes the captured client callback', async t => {
  const h = processFixture(t), received = [], extensionPath = join(h.data.root, 'client.mjs');
  h.payload.clientExtensionPath = extensionPath;
  let call;
  const tool = { name: 'client', execute: async (...args) => { call = args; return { content: [], details: { routed: true } }; } };
  const emit = record => h.child.stdout.write(`${JSON.stringify(record)}\n`);
  h.child.stdin.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); received.push(request);
    if (request.type === 'extension_ui_response') return;
    const data = request.type === 'get_state' ? { sessionId: 'saved', sessionFile: h.data.file, model: { provider: 'fixture', id: 'local' }, thinkingLevel: 'medium' }
      : request.type === 'get_messages' ? { messages: [] } : { contextUsage: { tokens: 10 } };
    emit({ type: 'response', id: request.id, success: true, data });
  });
  const opening = openRpcSession({ ...h.payload, prompts: [] }, { ...h.dependencies, bootstrap: h.payload, clientBridge: { extensionPath, tool } });
  assert.equal(received.length, 0, 'no native command precedes trusted readiness');
  const tools = ['ask_question', 'run_routine', 'message_check', 'hobkin_memory', 'model_settings', 'stop_workload', 'owned_agent'];
  for (const [statusKey, names] of [['hobkin/bridge', tools], ['hobkin/bridge/client', ['client']]]) {
    emit({ type: 'extension_ui_request', method: 'setStatus', statusKey, statusText: JSON.stringify({ version: 1, tools: names }) });
  }
  h.child.emit('message', { type: 'hobkin/main/ready', version: 1, id: h.sent[0].id, success: true,
    sessionId: 'saved', sessionFile: h.data.file, cwd: h.data.root });
  const session = await opening;
  emit({ type: 'extension_ui_request', id: 'dialog', method: 'input', title: 'hobkin/bridge',
    placeholder: JSON.stringify({ op: 'tool', name: 'client', id: 'tool-call', params: { action: 'list' } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(call[0], 'tool-call');
  assert.deepEqual(call[1], { action: 'list' });
  assert.ok(call[2] instanceof AbortSignal);
  assert.deepEqual(JSON.parse(received.at(-1).value), { ok: true, result: { content: [], details: { routed: true } } });
  assert.deepEqual(session.getContextUsage(), { tokens: 10 });
  const closing = session.dispose(); h.child.emit('close', 0, null); await closing;
});

test('a fresh native identity must match the captured bootstrap attestation', async t => {
  const h = processFixture(t);
  h.payload.expected = null;
  h.child.stdin.on('data', bytes => {
    const request = JSON.parse(bytes.toString());
    const data = request.type === 'get_state' ? { sessionId: 'changed', sessionFile: h.data.file, model: { provider: 'fixture', id: 'local' }, thinkingLevel: 'medium' }
      : request.type === 'get_messages' ? { messages: [] } : {};
    h.child.stdout.write(`${JSON.stringify({ type: 'response', id: request.id, success: true, data })}\n`);
  });
  h.child.stdin.on('end', () => h.child.emit('close', 0, null));
  const opening = openRpcSession({ ...h.payload, prompts: [] }, { ...h.dependencies, bootstrap: h.payload });
  const rejected = assert.rejects(opening, /identity changed/);
  h.child.stdout.write(`${JSON.stringify({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'hobkin/bridge',
    statusText: JSON.stringify({ version: 1, tools: ['ask_question', 'run_routine', 'message_check', 'hobkin_memory', 'model_settings', 'stop_workload', 'owned_agent'] }) })}\n`);
  h.child.emit('message', { type: 'hobkin/main/ready', version: 1, id: h.sent[0].id, success: true,
    sessionId: 'saved', sessionFile: h.data.file, cwd: h.data.root });
  await rejected;
});

test('only the matching bootstrap response admits native RPC readiness', async t => {
  const h = processFixture(t), transport = startMainSessionChild(h.payload, h.dependencies);
  const request = h.sent[0];
  h.child.emit('message', { type: 'hobkin/main/ready', version: 1, id: request.id, success: true,
    sessionId: 'saved', sessionFile: h.data.file, cwd: h.data.root });
  assert.equal((await transport.ready).sessionId, 'saved');
  for (const patch of [{ id: 'stale' }, { version: 2 }, { sessionId: {} }, { sessionFile: '/wrong' }, { cwd: '/wrong' }]) {
    const stale = processFixture(t), other = startMainSessionChild(stale.payload, stale.dependencies);
    const rejected = assert.rejects(other.ready, /identity|bootstrap/);
    stale.child.emit('message', { type: 'hobkin/main/ready', version: 1, id: stale.sent[0].id, success: true,
      sessionId: 'saved', sessionFile: stale.data.file, cwd: stale.data.root, ...patch });
    await rejected;
  }
});

function startupFixture(t, onMainStartup = () => {}) {
  const h = processFixture(t), state = { main: { ...h.data.expected }, runs: {} };
  const runtime = new HobkinRuntime(h.data.root, h.data.config, { onMainStartup,
    createMain: ({ startup }) => openRpcSession({ ...h.payload, startup, prompts: [] }, { ...h.dependencies, bootstrap: h.payload }) });
  runtime.state = async () => structuredClone(state);
  runtime.change = async update => update(state);
  return { ...h, runtime, state };
}

test('startup cancellation before state resolves prevents creation and late activation', async t => {
  const h = startupFixture(t), gate = Promise.withResolvers(); h.runtime.state = () => gate.promise;
  const opening = h.runtime.connect(); opening.catch(() => {});
  const attempt = h.runtime.mainStartup;
  assert.ok(attempt, 'startup custody exists before state resolves');
  attempt.cancel(); await assert.rejects(opening, /cancelled/); await attempt.settled;
  gate.resolve(h.state); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempt.done, true); assert.equal(attempt.child, null); assert.equal(h.sent.length, 0);
  let serial = 0; h.state.main = null;
  h.runtime.createMain = async () => ({ sessionId: `next${++serial}`, sessionFile: `${h.data.file}.${serial}`, subscribe: () => () => {}, dispose() {}, getSessionStats: () => ({}) });
  await h.runtime.connect(); const installed = h.runtime.mainStartup; await h.runtime.reset();
  assert.notEqual(h.runtime.mainStartup, installed); installed.cancel(); assert.equal(installed.signal.aborted, false);
});

for (const failure of ['cancel', 'timeout', 'callback']) test(`startup ${failure} retains early child custody for explicit retry`, async t => {
  const notices = [], h = startupFixture(t, attempt => { notices.push(attempt); if (failure === 'callback' && attempt.child) throw Error('capture callback failed'); });
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  const opening = h.runtime.connect(); opening.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  const attempt = h.runtime.mainStartup;
  assert.ok(attempt?.child, 'child captured before readiness'); assert.equal(notices[0], notices[1]);
  if (failure === 'cancel') attempt.cancel();
  await assert.rejects(opening, /cancelled|timed out|callback/); await attempt.settled;
  assert.equal(attempt.done, true); assert.equal(attempt.closed, false); assert.deepEqual(h.signals, []);
  await assert.rejects(h.runtime.connect(), /startup/); assert.equal(h.sent.length, 1);
  attempt.child.force(); attempt.child.force(); assert.deepEqual(h.signals, ['SIGKILL', 'SIGKILL']);
  h.child.emit('exit', null, 'SIGKILL'); await Promise.resolve(); assert.equal(attempt.closed, false);
  h.child.emit('close', null, 'SIGKILL'); await attempt.child.closed; assert.equal(attempt.closed, true);
  h.child.emit('message', { type: 'hobkin/main/ready', version: 1, id: h.sent[0].id, success: true,
    sessionId: 'saved', sessionFile: h.data.file, cwd: h.data.root });
  assert.equal(h.runtime.main, undefined); assert.equal(h.state.main.sessionId, 'saved');
});

test('reset cancellation at the persistence boundary retains the prior main and saved identity', async t => {
  const h = startupFixture(t), boundary = Promise.withResolvers(), commit = Promise.withResolvers();
  const previous = { sessionId: 'saved', dispose: forbidden }; h.runtime.main = previous;
  const candidate = { sessionId: 'new', sessionFile: `${h.data.file}.new`, subscribe: () => () => {}, dispose() {}, getSessionStats: () => ({}) };
  h.runtime.createMain = async () => candidate;
  h.runtime.change = async update => { boundary.resolve(); await commit.promise; return update(h.state); };
  const opening = h.runtime.reset(); opening.catch(() => {}); await boundary.promise;
  assert.ok(h.runtime.mainStartup, 'reset uses startup custody too'); h.runtime.mainStartup.cancel(); commit.resolve();
  await assert.rejects(opening, /cancelled/); await h.runtime.mainStartup.settled;
  assert.equal(h.runtime.main, previous); assert.deepEqual(h.state.main, h.data.expected);
});

for (const acknowledgment of ['commit', 'error']) test(`cancelled reset retains Force through delayed ${acknowledgment} acknowledgment`, async t => {
  const h = startupFixture(t), boundary = Promise.withResolvers(), commit = Promise.withResolvers();
  const previous = { sessionId: 'saved', dispose: forbidden }; h.runtime.main = previous;
  h.runtime.createMain = async ({ startup }) => {
    startup.capture(startMainSessionChild(h.payload, h.dependencies));
    return { sessionId: 'new', sessionFile: `${h.data.file}.new`, subscribe: () => () => {}, getSessionStats: () => ({}) };
  };
  h.runtime.change = async update => { update(h.state); boundary.resolve(); await commit.promise; };
  const opening = h.runtime.reset(); opening.catch(() => {});
  assert.ok(h.runtime.mainStartup, 'reset publishes startup before creating its child'); await boundary.promise;
  const attempt = h.runtime.mainStartup; attempt.cancel(); await assert.rejects(opening, /cancelled/);
  attempt.child.force(); assert.deepEqual(h.signals, ['SIGKILL']); assert.equal(attempt.persistence.status, 'unknown');
  h.child.emit('close', null, 'SIGKILL'); await attempt.child.closed;
  await assert.rejects(h.runtime.connectMain(true), /startup/); assert.equal(attempt.done, false);
  if (acknowledgment === 'commit') commit.resolve(); else commit.reject(Error('commit acknowledgment lost'));
  await attempt.settled; assert.equal(attempt.persistence.status, acknowledgment === 'commit' ? 'committed' : 'unknown');
  assert.equal(h.runtime.main, previous); assert.equal(h.state.main.sessionId, 'new'); assert.equal(h.sent.length, 1);
});

test('configured startup captures its fixed transport before any native request', async t => {
  const h = startupFixture(t, attempt => { if (attempt.child) attempt.cancel(); });
  h.runtime.createMain = ({ startup }) => openRpcSession({ ...h.payload, startup, prompts: [] }, { ...h.dependencies,
    spawnProcess: () => h.child });
  const requests = []; h.child.stdin.on('data', bytes => requests.push(bytes.toString()));
  const opening = h.runtime.connect(); opening.catch(() => {}); await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.runtime.mainStartup?.child, 'configured transport captured before readiness'); await assert.rejects(opening, /cancelled/);
  h.runtime.mainStartup.child.force(); assert.deepEqual(h.signals, ['SIGKILL']); assert.deepEqual(requests, []);
});

test('without a startup callback, failed openers keep legacy disposal', async t => {
  const h = startupFixture(t); h.runtime.onMainStartup = undefined;
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  h.child.stdin.on('finish', () => h.child.emit('close', 0, null));
  await assert.rejects(h.runtime.connect(), /timed out/);
  assert.equal(h.child.stdin.writableEnded, true); assert.equal(h.runtime.mainStartup.child, null);
});

test('bootstrap timeout retains the captured process for explicit Force, and late ready cannot revive it', async t => {
  const h = processFixture(t), transport = startMainSessionChild(h.payload, { ...h.dependencies, startupTimeoutMs: 5 });
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  await assert.rejects(transport.ready, /timed out/);
  assert.deepEqual(h.signals, []);
  transport.force();
  assert.deepEqual(h.signals, ['SIGKILL']);
  h.child.emit('message', { type: 'hobkin/main/ready', version: 1, id: h.sent[0].id, success: true,
    sessionId: 'saved', sessionFile: h.data.file, cwd: h.data.root });
  await assert.rejects(transport.ready, /timed out/);
});
