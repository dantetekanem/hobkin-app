import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
// Replace the SDK before any production import; only the pure tool declaration is needed.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@earendil-works/pi-coding-agent') return { url: 'data:text/javascript,export const defineTool = value => value;', shortCircuit: true };
  return next(specifier, context);
} });

for (const name of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) mock.method(childProcess, name, () => { throw Error('Real process forbidden'); });
syncBuiltinESMExports();
mock.method(process, 'kill', () => { throw Error('Real signal forbidden'); });
mock.method(globalThis, 'fetch', () => { throw Error('Network forbidden'); });
const { createOwnedAgentAdapter } = await import('../src/cli/owned-agent-session.mjs');
const { default: extension, ownedRoleTools } = await import('../src/cli/owned-agent-extension.mjs');
const { createOwnedAgents } = await import('../src/cli/owned-agents.mjs');

const identity = Object.freeze({ id: 'child', parentId: 'parent', rootId: 'root' });
const binding = { cwd: '/isolated/project', model: 'test/model', effort: 'medium', prompt: 'Inspect.', role: 'read', parentRole: 'read' };
function fixture(options = {}) {
  const closed = Promise.withResolvers(), state = Promise.withResolvers();
  const requests = [], calls = [];
  let callbacks, shutdowns = 0, terminations = 0, forces = 0;
  const transport = {
    closed: closed.promise,
    request: async (type, data) => {
      requests.push({ type, data });
      if (type === 'get_state') return options.waitState ? state.promise : { sessionId: 'session', model: { provider: 'test', id: options.wrongModel ? 'wrong' : 'model' }, thinkingLevel: 'medium' };
      if (type === 'get_session_stats') return options.stats ?? { sessionId: 'session', tokens: { input: 5 }, cost: 0.01 };
      return { disposition: 'started' };
    },
    shutdown() { shutdowns++; if (!options.hang) closed.resolve({ code: options.exitCode ?? 0 }); return closed.promise; },
    terminate() { terminations++; },
    force() { forces++; },
  };
  const adapter = createOwnedAgentAdapter({
    bindingFor: () => ({ ...binding, ...options.binding }), startupMs: 30, stopMs: 15,
    startProcess: args => { calls.push(args); callbacks = args; return options.malformed ? { ...transport, request: null } : transport; },
    onEvent: options.onEvent, onStats: options.onStats, now: options.now, metricNow: options.metricNow, customStyle: options.customStyle,
  });
  return { adapter, calls, requests, state, closed, emit: event => callbacks.onRecord(event),
    get shutdowns() { return shutdowns; }, get terminations() { return terminations; }, get forces() { return forces; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const end = text => ({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text }] } });

test('owned read child uses actual restricted tools and one trusted extension, then waits for closure', { timeout: 1000 }, async () => {
  const events = [], stats = [];
  const f = fixture({ onEvent: (_identity, event) => events.push(event), onStats: (_identity, value) => stats.push(value) });
  const handle = f.adapter.start(identity);
  assert.equal(typeof handle.cancel, 'function');
  await tick();
  assert.deepEqual(f.requests.map(item => item.type), ['get_state', 'prompt']);
  const { args, env } = f.calls[0];
  assert.equal(args[args.indexOf('--tools') + 1], 'read,grep,find,ls');
  assert.ok(args.includes('--no-extensions') && args.includes('--no-mcp'));
  assert.equal(args.filter(arg => arg === '--extension').length, 1);
  assert.equal(env.HOBKIN_OWNED_ROLE, 'read');
  f.emit(end('x'.repeat(9000))); f.emit({ type: 'agent_settled' });
  assert.equal((await handle.result).length, 8000);
  assert.equal(f.shutdowns, 1);
  assert.equal(JSON.stringify(events).includes('private'), false);
  assert.equal(stats.length, 1);
});

test('an opted-in provider adds only the provider adapter to the owned read role', { timeout: 1000 }, async () => {
  const entry = fileURLToPath(import.meta.url);
  const f = fixture({ binding: { providerExtensions: { test: entry } } });
  const handle = f.adapter.start(identity);
  await tick();
  const { args, env } = f.calls[0];
  assert.equal(args[args.indexOf('--tools') + 1], 'read,grep,find,ls');
  assert.ok(args.includes('--no-extensions') && args.includes('--no-mcp'));
  assert.equal(args.filter(arg => arg === '--extension').length, 2);
  assert.ok(args.some(arg => arg.endsWith('/provider-extensions.mjs')));
  assert.ok(!args.includes(entry));
  assert.deepEqual(JSON.parse(env.HOBKIN_PROVIDER_EXTENSIONS), { test: entry });
  f.emit(end('report'));
  f.emit({ type: 'agent_settled' });
  assert.equal(await handle.result, 'report');
});

test('owned measurement reconciles cumulative facts without replay charges or private identity', { timeout: 1000 }, async () => {
  for (const foreign of [false, true]) {
    let now = 10;
    const f = fixture({ now: () => now, stats: { sessionId: foreign ? 'foreign' : 'session', tokens: { input: 12, output: 1, cacheRead: 0, cacheWrite: 0 } } });
    const handle = f.adapter.start(identity);
    assert.deepEqual(handle.snapshot(), { usage: null, lastActivityAt: null, performance: null });
    await tick();
    const event = end('private report'); Object.assign(event.message, { provider: 'test', model: 'model', responseId: 'response', timestamp: 999999, usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0 } });
    f.emit(event); f.emit(event);
    assert.equal(handle.snapshot().usage.input.value, 5);
    const before = handle.snapshot(); now = 20;
    assert.deepEqual(handle.snapshot().usage, before.usage);
    assert.equal(handle.snapshot().lastActivityAt, before.lastActivityAt, 'reads do not refresh activity');
    f.emit({ ...event, message: { ...event.message, usage: { ...event.message.usage, input: 9 } } });
    assert.equal(handle.snapshot().usage.input.state, 'partial');
    f.emit({ type: 'agent_settled' });
    if (foreign) await assert.rejects(handle.result, /identity/);
    else await handle.result;
    const final = handle.snapshot();
    assert.equal(final.usage.input.value, foreign ? 5 : 12);
    assert.deepEqual(final.usage.output, { value: 2, state: 'partial' });
    assert.equal(final.usage.incomplete, true); assert.equal(final.usage.sealed, true);
    assert.equal(final.performance.sessionId, 'session'); assert.equal(JSON.stringify(final).includes('private'), false);
    now = 30; f.emit(event); assert.deepEqual(handle.snapshot(), final);
  }
});

test('a helper times its process start and its first text from the moment it was asked for', { timeout: 1000 }, async () => {
  let wall = 1000;
  const f = fixture({ now: () => wall });
  const handle = f.adapter.start(identity);
  // The process is started at once, and answers twenty milliseconds later.
  wall = 1020; await tick();
  const message = { role: 'assistant', provider: 'test', model: 'model', responseId: 'own', timestamp: 10 };
  wall = 1025; f.emit({ type: 'agent_start' });
  wall = 1030; f.emit({ type: 'message_start', message });
  wall = 1050; f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'private delta' } });
  wall = 1060; f.emit({ type: 'message_end', message: { ...message, stopReason: 'stop', content: [{ type: 'text', text: 'report' }], usage: { input: 5, output: 2, cacheRead: 40 } } });
  f.emit({ type: 'agent_settled' }); await handle.result;
  const { origin, kind, engine, model, effort, stages, steps } = handle.snapshot().performance;
  assert.deepEqual([origin, kind, engine, model, effort], ['tool', 'helper', 'pi', 'test/model', 'medium']);
  assert.deepEqual(stages, { spawned: 0, ready: 20, prompted: 20, started: 25, requested: 30, text: 50, ended: 60 });
  assert.deepEqual(steps, [{ at: 30, first: 50, text: 50, end: 60, input: 5, cacheRead: 40, output: 2 }]);
});

test('cancellation seals own lower bounds before an outstanding terminal statistics reply', { timeout: 1000 }, async () => {
  const stats = Promise.withResolvers(), f = fixture({ stats: stats.promise }), handle = f.adapter.start(identity);
  await tick();
  const event = end('partial'); Object.assign(event.message, { provider: 'test', model: 'model', responseId: 'own', usage: { input: 4 } });
  f.emit(event); f.emit({ type: 'agent_settled' }); await tick();
  await handle.cancel(); const sealed = handle.snapshot();
  stats.resolve({ sessionId: 'session', tokens: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 } });
  await assert.rejects(handle.result); f.emit(event);
  assert.deepEqual(handle.snapshot(), sealed);
  assert.equal(sealed.usage.input.value, 4); assert.equal(sealed.usage.output.state, 'unavailable');
  assert.equal(sealed.usage.sealed, true); assert.equal(sealed.usage.incomplete, true);
});

test('performance captures only current own output and reconciles cumulative zero, missing and regressing facts', { timeout: 1000 }, async () => {
  for (const cost of [0, 0.01, -1, undefined]) {
    let clock = 100;
    const events = [], f = fixture({ metricNow: () => clock, now: () => 999,
      stats: { sessionId: 'session', tokens: { input: 12, output: 0, cacheRead: 0, cacheWrite: 0 }, cost },
      onEvent: (_id, event) => events.push(event) });
    const handle = f.adapter.start(identity); await tick();
    const message = { role: 'assistant', provider: 'test', model: 'model', responseId: 'own', timestamp: 10 };
    const delta = { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'private delta' } };
    f.emit(delta); assert.equal(handle.snapshot().performance.firstObservedOutputMs, null);
    f.emit({ type: 'message_start', message }); clock = 107;
    f.emit({ ...delta, sessionId: 'foreign' });
    assert.equal(handle.snapshot().performance.firstObservedOutputMs, null);
    f.emit(delta); f.emit(delta);
    const response = { ...message, stopReason: 'stop', content: [{ type: 'text', text: 'report' }], durationMs: 3,
      usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02 } } };
    f.emit({ type: 'message_end', message: response }); f.emit({ type: 'message_end', message: response });
    clock = 120; f.emit({ type: 'agent_settled' }); await handle.result;
    const final = handle.snapshot().performance;
    assert.equal(final.runId, identity.id); assert.equal(final.sessionId, 'session'); assert.equal(final.responses, 1);
    assert.equal(final.firstObservedOutputMs, 7); assert.equal(final.dispatchElapsedMs, 20);
    assert.deepEqual(final.input, { value: 12, state: 'partial' });
    assert.deepEqual(final.output, { value: 2, state: 'partial' });
    assert.deepEqual(final.estimatedUsd, { value: 0.02, state: 'partial' });
    assert.deepEqual(final.cacheRead, { value: 0, state: 'partial' });
    assert.equal(final.responseDurationMs.value, 3);
    assert.deepEqual(events.filter(e => e.type === 'performance'), [{ type: 'performance', display: false }]);
    assert.equal(JSON.stringify(final).includes('private'), false);
    final.input.value = 999; clock = 150; f.emit(delta);
    assert.equal(handle.snapshot().performance.input.value, 12); assert.equal(handle.snapshot().performance.dispatchElapsedMs, 20);
  }
});

test('performance preserves complete zero and absent scalars without borrowing foreign responses', { timeout: 1000 }, async () => {
  const f = fixture({ stats: { sessionId: 'session', tokens: { input: 0 }, cost: 0 } }), handle = f.adapter.start(identity);
  await tick();
  const response = { ...end('report').message, provider: 'test', model: 'model', responseId: 'own', usage: { input: 0, cost: { total: 0 } } };
  f.emit({ type: 'message_end', message: response }); f.emit({ type: 'agent_settled' }); await handle.result;
  const facts = handle.snapshot().performance;
  assert.deepEqual(facts.input, { value: 0, state: 'complete' }); assert.deepEqual(facts.estimatedUsd, { value: 0, state: 'complete' });
  assert.deepEqual(facts.output, { value: null, state: 'unavailable' });
});

test('message-less deltas require an identified current response and reject explicit foreign owners', { timeout: 1000 }, async () => {
  const f = fixture(), handle = f.adapter.start(identity); await tick();
  const delta = { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'secret' } };
  const message = { role: 'assistant', provider: 'test', model: 'model' };
  f.emit({ type: 'message_start', message }); f.emit(delta);
  assert.equal(handle.snapshot().performance.firstObservedOutputMs, null);
  f.emit({ type: 'message_start', message: { ...message, responseId: 'own' } });
  for (const extra of [{ runId: 'foreign-child' }, { responseId: 'foreign-response' }]) {
    f.emit({ ...delta, ...extra }); assert.equal(handle.snapshot().performance.firstObservedOutputMs, null);
  }
  f.emit({ type: 'message_end', message: { ...message, responseId: 'own' } }); f.emit(delta);
  assert.equal(handle.snapshot().performance.firstObservedOutputMs, null);
  await handle.cancel(); await assert.rejects(handle.result);
});

test('terminal performance reconciles each scalar without adding or clearing response uncertainty', { timeout: 1000 }, async () => {
  for (const conflict of [false, true]) {
    const f = fixture({ stats: { sessionId: 'session', tokens: { input: 12, output: 1, cacheRead: 0 }, cost: 0.01 } });
    const handle = f.adapter.start(identity); await tick();
    const event = end('report'); Object.assign(event.message, { provider: 'test', model: 'model', responseId: 'own',
      usage: { input: 5, output: 2, cacheRead: 0, cost: { total: 0.02 } } });
    f.emit(event);
    if (conflict) f.emit({ ...event, message: { ...event.message, usage: { ...event.message.usage, input: 9 } } });
    f.emit({ type: 'agent_settled' }); await handle.result;
    const facts = handle.snapshot().performance;
    assert.deepEqual(facts.input, { value: 12, state: conflict ? 'partial' : 'complete' });
    assert.deepEqual(facts.estimatedUsd, { value: 0.02, state: 'partial' });
    assert.deepEqual(facts.output, { value: 2, state: 'partial' });
    assert.deepEqual(facts.cacheRead, { value: 0, state: conflict ? 'partial' : 'complete' });
    assert.deepEqual(facts.cacheWrite, { value: null, state: 'unavailable' });
  }
});

test('elapsed time seals before delayed captured closure and late output', { timeout: 1000 }, async () => {
  let clock = 5;
  const f = fixture({ hang: true, metricNow: () => clock }), handle = f.adapter.start(identity); await tick();
  clock = 15; assert.equal(await handle.cancel(), false);
  clock = 100; f.closed.resolve({ code: 0 }); await tick();
  f.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'late' } });
  assert.equal(await handle.force(), true); await assert.rejects(handle.result);
  assert.equal(handle.snapshot().performance.dispatchElapsedMs, 10);
  assert.equal(handle.snapshot().performance.firstObservedOutputMs, null);
});

test('host binding refuses permission escalation, missing authority and managed extension wrappers before launch', () => {
  for (const extra of [{ role: 'write' }, { role: 'full' }, { parentRole: undefined }, { launcher: { command: ['wrapper'], managedExtensions: true } }]) {
    const f = fixture({ binding: extra });
    assert.throws(() => f.adapter.start(identity));
    assert.equal(f.calls.length, 0);
  }
  assert.throws(() => createOwnedAgentAdapter().start(identity));
});

test('model mismatch and malformed startup dispose before failing; no prompt or retry', { timeout: 1000 }, async () => {
  for (const option of [{ wrongModel: true }, { malformed: true }]) {
    const f = fixture(option), handle = f.adapter.start(identity);
    await assert.rejects(handle.result);
    assert.equal(f.shutdowns, 1);
    assert.equal(f.requests.some(item => item.type === 'prompt'), false);
    assert.equal(f.calls.length, 1);
  }
});

test('cancellation before startup settles only after actual transport close and never dispatches', { timeout: 1000 }, async () => {
  const f = fixture({ waitState: true }), handle = f.adapter.start(identity);
  assert.equal(await handle.cancel(), true);
  await assert.rejects(handle.result);
  f.state.resolve({ model: { provider: 'test', id: 'model' }, thinkingLevel: 'medium' });
  await tick();
  assert.equal(f.requests.some(item => item.type === 'prompt'), false);
  assert.equal(f.shutdowns, 1);
});

test('unconfirmed close is bounded, retains core capacity, and is not revived by late completion', { timeout: 1000 }, async () => {
  const f = fixture({ hang: true }), tree = createOwnedAgents({ adapter: f.adapter, maxRunning: 1 });
  tree.registerRoot({ id: 'root', allowHelpers: true });
  const child = tree.spawn('root', { name: 'first' });
  await tick();
  assert.equal((await tree.cancel('root', child.id)).confirmed, false);
  assert.equal(f.terminations, 1);
  f.closed.resolve({ code: 0 }); f.emit(end('late')); f.emit({ type: 'agent_settled' });
  await tick();
  assert.equal(tree.status('root', child.id).status, 'unknown');
  assert.equal(tree.spawn('root', { name: 'second' }).status, 'queued');
});

test('Force bypasses pending cancellation, coalesces attempts and explicitly reconciles a later close', { timeout: 1000 }, async () => {
  const events = [], f = fixture({ hang: true, waitState: true, onEvent: (_id, event) => events.push(event) });
  const handle = f.adapter.start(identity);
  let settled = false;
  handle.result.catch(() => { settled = true; });
  const ordinary = handle.cancel();
  const first = handle.force(), duplicate = handle.force();
  assert.equal(f.forces, 1, 'signal request happens before awaiting ordinary cancellation');
  assert.equal(await first, false);
  assert.equal(await duplicate, false);
  assert.equal(await ordinary, false);
  assert.equal(settled, false, 'signals and timeout do not confirm closure');
  assert.equal(await handle.force(), false);
  assert.equal(f.forces, 2, 'unknown is retryable');
  f.closed.resolve({ code: 0 });
  await tick();
  f.emit(end('late')); f.emit({ type: 'agent_settled' });
  assert.equal(await handle.force(), true);
  await assert.rejects(handle.result, /cancelled/);
  assert.equal(f.forces, 2, 'observed closure cannot signal a stale PID');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(events, []);
  assert.deepEqual(f.requests.map(request => request.type), ['get_state']);
});

test('startup timeout and unexpected exit fail only after cleanup is observed', { timeout: 1000 }, async () => {
  const f = fixture({ waitState: true }), handle = f.adapter.start(identity);
  await assert.rejects(handle.result, /startup/i);
  assert.equal(f.shutdowns, 1);
  const early = fixture(), next = early.adapter.start(identity);
  early.closed.resolve({ code: 1 });
  await assert.rejects(next.result, /exited/i);
});

test('write bindings preserve built-in project trust and actual mutation tools', { timeout: 1000 }, async () => {
  const f = fixture({ binding: { role: 'write', parentRole: 'write' } }), handle = f.adapter.start(identity);
  await tick();
  const { args } = f.calls[0];
  assert.equal(args[args.indexOf('--tools') + 1], 'read,bash,edit,write,grep,find,ls');
  assert.equal(args.includes('--approve') || args.includes('--no-approve'), false);
  assert.equal(await handle.cancel(), true);
});

test('an aborted or unfinished settled record cannot confirm successful completion', { timeout: 1000 }, async () => {
  for (const unfinished of [false, true]) {
    const f = fixture(), handle = f.adapter.start(identity);
    const message = end('partial');
    if (unfinished) message.message.stopReason = 'toolUse';
    await tick(); f.emit(message); f.emit({ type: 'agent_settled', aborted: !unfinished });
    await assert.rejects(handle.result);
  }
});

test('settled text followed by failed disposal is not a successful report', { timeout: 1000 }, async () => {
  const f = fixture({ exitCode: 1 }), handle = f.adapter.start(identity);
  await tick(); f.emit(end('not confirmed')); f.emit({ type: 'agent_settled' });
  await assert.rejects(handle.result, /exit/i);
});

test('theme extension exposes only exact custom_style operations without delegation', async () => {
  const handlers = {};
  const registered = [];
  const requests = [];
  let active;

  extension({
    on: (name, fn) => { handlers[name] = fn; },
    registerTool: tool => registered.push(tool),
    setActiveTools: names => { active = names; },
  }, { role: 'theme', allowHelpers: true });

  handlers.session_start();
  assert.deepEqual(active, ['custom_style']);
  assert.deepEqual(registered.map(tool => tool.name), ['custom_style']);

  for (const toolName of ['read', 'write', 'edit', 'bash', 'codemode', 'owned_agent', 'tool_search', 'mcp__read']) {
    assert.equal(handlers.tool_call({ toolName }).block, true);
  }
  assert.equal(handlers.tool_call({ toolName: 'custom_style' }), undefined);

  const ctx = {
    mode: 'rpc',
    ui: {
      input: async (title, placeholder) => {
        assert.equal(title, 'hobkin/bridge');
        requests.push(JSON.parse(placeholder));
        return JSON.stringify({ ok: true, result: { details: { css: 'saved' } } });
      },
    },
  };
  for (const params of [{ op: 'read' }, { op: 'replace', css: 'palette' }]) {
    const result = await registered[0].execute('call', params, undefined, undefined, ctx);
    assert.deepEqual(result.details, { css: 'saved' });
    assert.deepEqual(requests.at(-1), {
      op: 'tool',
      name: 'custom_style',
      id: 'call',
      params,
    });
  }

  for (const params of [
    null,
    [],
    { op: 'read', path: '/etc/passwd' },
    { op: 'replace', css: 1 },
    { op: 'replace' },
    { op: 'delete' },
    { op: 'replace', css: 'x'.repeat(16385) },
  ]) {
    await assert.rejects(
      registered[0].execute('call', params, undefined, undefined, ctx),
      /custom_style/,
    );
  }
  assert.equal(requests.length, 2);
});

test('theme adapter refuses missing authority, delegation and all configured launchers before launch', () => {
  const theme = { role: 'theme', parentRole: 'theme', allowHelpers: false };
  const invalidBindings = [
    { parentRole: 'read' },
    { parentRole: 'write' },
    { allowHelpers: true },
    { launcher: { command: ['pi'] } },
    { launcher: { command: ['wrapper'], managedExtensions: true } },
  ];

  for (const extra of invalidBindings) {
    const f = fixture({ binding: { ...theme, ...extra }, customStyle: () => {} });
    assert.throws(() => f.adapter.start({ ...identity, parentId: 'root', depth: 1 }));
    assert.equal(f.calls.length, 0);
  }

  const missing = fixture({ binding: theme });
  assert.throws(() => missing.adapter.start({ ...identity, parentId: 'root', depth: 1 }));
  assert.equal(missing.calls.length, 0);
});

test('read execution guard blocks every nonallowlisted tool even when requested directly', () => {
  const handlers = {};
  extension({ on: (name, handler) => { handlers[name] = handler; } }, { role: 'read' });
  for (const name of ['bash', 'write', 'edit', 'codemode', 'tool_search', 'mcp__server__read', 'owned_agent']) {
    assert.equal(handlers.tool_call({ toolName: name }).block, true, name);
  }
  for (const name of ownedRoleTools('read')) assert.equal(handlers.tool_call({ toolName: name }), undefined);
  assert.throws(() => ownedRoleTools('full'));
});
