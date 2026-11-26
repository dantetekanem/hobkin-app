import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { registerHooks } from 'node:module';
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
const { createOwnedLifecycle } = await import('../src/cli/owned-agent-lifecycle.mjs');
const { default: ownedExtension } = await import('../src/cli/owned-agent-extension.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const binding = { cwd: '/isolated/project', prompt: 'Host task', model: 'test/model', effort: 'medium', role: 'read', parentRole: 'read', allowHelpers: true };
const end = text => ({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] } });
function transportFactory(hang = false) {
  const children = [];
  const startProcess = options => {
    const closed = Promise.withResolvers(), requests = [], responses = [];
    const child = { options, closed, requests, responses, shutdowns: 0, forces: 0,
      emit: record => options.onRecord(record),
      request: async (type, data) => { requests.push({ type, data }); return type === 'get_state'
        ? { sessionId: String(children.indexOf(child)), model: { provider: 'test', id: 'model' }, thinkingLevel: 'medium' }
        : type === 'get_session_stats' ? { sessionId: String(children.indexOf(child)) } : { disposition: 'started' }; },
      send: record => responses.push(record),
      shutdown() { child.shutdowns++; if (!hang) closed.resolve({ code: 0 }); return closed.promise; }, terminate() {},
      force() { child.forces++; },
    };
    children.push(child);
    return { ...child, closed: closed.promise };
  };
  return { children, startProcess };
}

test('owned adapter waits for descendant facts and requires a later final response', { timeout: 1000 }, async () => {
  const f = transportFactory(), joined = Promise.withResolvers();
  let joins = 0;
  const adapter = createOwnedAgentAdapter({ bindingFor: () => binding, startProcess: f.startProcess,
    join: () => ++joins === 1 ? joined.promise : undefined });
  const handle = adapter.start({ id: 'child' });
  await tick();
  const child = f.children[0];
  child.emit(end('early')); child.emit({ type: 'agent_settled' });
  await tick();
  assert.equal(child.shutdowns, 0);
  joined.resolve(JSON.stringify({ ownedChildren: [{ id: 'grandchild', status: 'completed', report: 'fact' }] }));
  await tick();
  assert.equal(child.requests.filter(request => request.type === 'prompt').length, 2);
  child.emit(end('later')); child.emit({ type: 'agent_settled' });
  assert.equal(await handle.result, 'later');
});

test('continuation settlement before its prompt acknowledgement is not lost', { timeout: 1000 }, async t => {
  const f = transportFactory(); let prompts = 0, joins = 0;
  const adapter = createOwnedAgentAdapter({ bindingFor: () => binding, join: () => ++joins === 1 ? '{"ownedChildren":[]}' : undefined,
    startProcess: options => { const wire = f.startProcess(options), request = wire.request;
      wire.request = async (type, data) => { if (type === 'prompt' && ++prompts === 2) { options.onRecord(end('later')); options.onRecord({ type: 'agent_settled' }); } return request(type, data); }; return wire; } });
  const handle = adapter.start({ id: 'child' }); t.after(() => handle.cancel()); await tick();
  f.children[0].emit(end('early')); f.children[0].emit({ type: 'agent_settled' }); await tick();
  assert.equal(f.children[0].shutdowns, 1); assert.equal(await handle.result, 'later');
});

test('an unfinished parent response cannot be restarted by a descendant continuation', { timeout: 1000 }, async t => {
  const f = transportFactory(), adapter = createOwnedAgentAdapter({ bindingFor: () => binding, startProcess: f.startProcess, join: () => '{"ownedChildren":[]}' });
  const handle = adapter.start({ id: 'child' }); t.after(() => handle.cancel()); await tick();
  const unfinished = end('partial'); unfinished.message.stopReason = 'error';
  f.children[0].emit(unfinished); f.children[0].emit({ type: 'agent_settled' }); await tick();
  assert.equal(f.children[0].requests.filter(r => r.type === 'prompt').length, 1);
  await assert.rejects(handle.result, /finish/);
});

test('owned child bridge is bound by host and non-bridge dialogs stay declined', { timeout: 1000 }, async () => {
  const f = transportFactory(), calls = [];
  const adapter = createOwnedAgentAdapter({ bindingFor: () => binding, startProcess: f.startProcess,
    ownedAgent: (identity, request) => { calls.push({ identity, request }); return { admitted: true }; } });
  const handle = adapter.start({ id: 'child' }); await tick();
  const child = f.children[0];
  child.emit({ type: 'extension_ui_request', method: 'input', id: 'bridge', title: 'hobkin/bridge', placeholder: JSON.stringify({ op: 'tool', name: 'owned_agent', id: 'call', params: { action: 'list' } }) });
  child.emit({ type: 'extension_ui_request', method: 'confirm', id: 'dialog' }); await tick();
  assert.equal(calls[0]?.identity.id, 'child');
  assert.deepEqual(calls[0]?.request, { action: 'list' });
  assert.equal(JSON.parse(child.responses.find(r => r.id === 'bridge').value).ok, true);
  assert.equal(child.responses.find(r => r.id === 'dialog').cancelled, true);
  assert.equal(await handle.cancel(), true); await assert.rejects(handle.result);
});

test('host authority refuses escalation; closed directions, names and depth cannot widen it', { timeout: 1000 }, async () => {
  const f = transportFactory(), life = createOwnedLifecycle({ startProcess: f.startProcess, maxDepth: 1 });
  assert.throws(() => life.register({ id: 'unsafe', allowHelpers: true, binding: { ...binding, role: 'write' } }), /authority/);
  const root = life.register({ id: 'root', allowHelpers: true, binding });
  const closed = life.register({ id: 'background', binding });
  assert.throws(() => closed.request({ action: 'spawn', name: 'ignore directions' }), /prohibits/);
  assert.throws(() => root.request({ action: 'spawn', name: 'escape', role: 'write' }), /Invalid/);
  const child = root.request({ action: 'spawn', name: 'read', allowHelpers: true }); await tick();
  const wire = f.children[0];
  assert.equal(wire.options.cwd, binding.cwd); assert.equal(wire.options.env.HOBKIN_OWNED_ROLE, 'read');
  assert.equal(wire.requests.find(r => r.type === 'prompt').data.message, binding.prompt);
  wire.emit({ type: 'extension_ui_request', method: 'input', id: 'nested', title: 'hobkin/bridge', placeholder: JSON.stringify({ op: 'tool', name: 'owned_agent', id: 'call', params: { action: 'spawn', name: 'grandchild' } }) });
  await tick(); assert.match(JSON.parse(wire.responses[0].value).error, /depth/);
  assert.equal(root.request({ action: 'status', id: child.id }).depth, 1);
  await life.close(); assert.throws(() => root.request({ action: 'list' }), /active/);
  assert.throws(() => life.register({ id: 'reopen', binding }), /closed/);
});

test('lifecycle snapshots isolate roots without changing control authority', { timeout: 1000 }, async () => {
  const f = transportFactory(), life = createOwnedLifecycle({ startProcess: f.startProcess });
  const root = life.register({ id: 'root', allowHelpers: true, binding });
  const other = life.register({ id: 'other', allowHelpers: true, binding });
  const empty = life.register({ id: 'empty', binding });
  const child = root.request({ action: 'spawn', name: 'child' });
  const outside = other.request({ action: 'spawn', name: 'outside' });
  await root.request({ action: 'cancel', id: child.id });
  await other.request({ action: 'cancel', id: outside.id });
  const rows = life.snapshot('root');
  assert.deepEqual(rows.map(({ id, status }) => [id, status]), [[child.id, 'cancelled']]);
  assert.deepEqual(life.snapshot('empty'), []);
  assert.equal(life.snapshot('missing'), null);
  assert.deepEqual(life.snapshot().map(({ id, status }) => [id, status]), [[child.id, 'cancelled'], [outside.id, 'cancelled']]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['depth', 'id', 'lastActivityAt', 'name', 'parentId', 'performance', 'rootId', 'status', 'usage']);
  rows[0].status = 'failed';
  rows.pop();
  assert.equal(life.snapshot('root')[0].status, 'cancelled');
  assert.equal(root.request({ action: 'status', id: child.id }).status, 'cancelled');
  await life.close();
});

test('root policy refuses synchronous and nested admission before allocation without blocking controls', { timeout: 1000 }, async () => {
  const f = transportFactory(), calls = [], life = createOwnedLifecycle({ startProcess: f.startProcess });
  let decision = false;
  const root = life.register({ id: 'policy', binding, allowHelpers: true, beforeSpawn: ids => { calls.push(ids); if (decision === 'throw') throw Error('Denied'); return decision; } });
  for (decision of [false, undefined, Promise.resolve(true), Promise.reject(Error('Async denial')), 'throw']) {
    assert.throws(() => root.request({ action: 'spawn', name: 'denied' }));
    assert.deepEqual(life.snapshot('policy'), []); assert.equal(f.children.length, 0);
  }
  decision = true;
  const child = root.request({ action: 'spawn', name: 'child' }); await tick();
  decision = false;
  f.children[0].emit({ type: 'extension_ui_request', method: 'input', id: 'nested', title: 'hobkin/bridge', placeholder: JSON.stringify({ op: 'tool', name: 'owned_agent', id: 'call', params: { action: 'spawn', name: 'denied nested' } }) });
  await tick(); assert.match(JSON.parse(f.children[0].responses[0].value).error, /admission|denied/i);
  assert.deepEqual(calls.at(-1), { rootId: 'policy', parentId: child.id });
  const count = calls.length;
  assert.equal(root.request({ action: 'status', id: child.id }).status, 'running');
  assert.equal(root.request({ action: 'list' }).length, 1);
  await root.request({ action: 'cancel', id: child.id }); await life.force('policy', child.id);
  assert.equal(calls.length, count); await life.close();
});

test('queued children cancel without starting and nested children never queue behind waiting parents', { timeout: 1000 }, async () => {
  const rows = [], f = transportFactory(), life = createOwnedLifecycle({ startProcess: f.startProcess, maxRunning: 1,
    onPerformance: row => { rows.push(row); if (row.status === 'cancelled') throw Error('Observer failed'); return Promise.reject(Error('Async observer failed')); } });
  const root = life.register({ id: 'root', allowHelpers: true, binding });
  root.request({ action: 'spawn', name: 'first' });
  const queued = root.request({ action: 'spawn', name: 'queued' });
  assert.equal(queued.status, 'queued');
  assert.equal((await root.request({ action: 'cancel', id: queued.id })).confirmed, true);
  await tick(); const child = f.children[0];
  child.emit({ type: 'extension_ui_request', method: 'input', id: 'nested', title: 'hobkin/bridge', placeholder: JSON.stringify({ op: 'tool', name: 'owned_agent', id: 'call', params: { action: 'spawn', name: 'nested' } }) });
  await tick(); assert.match(JSON.parse(child.responses[0].value).error, /slot/);
  child.emit(end('result')); child.emit({ type: 'agent_settled' });
  const facts = JSON.parse(await root.join());
  assert.deepEqual(facts.ownedChildren.map(c => c.status), ['completed', 'cancelled']);
  assert.deepEqual(life.snapshot('root').map(({ status }) => status), ['completed', 'cancelled']);
  assert.equal(f.children.length, 1); await life.close();
  assert.deepEqual(rows.map(row => [row.id, row.status]), [[queued.id, 'cancelled'], [facts.ownedChildren[0].id, 'completed']]);
  assert.equal(rows[0].performance, null);
  assert.deepEqual(Object.keys(rows[1]).sort(), ['depth', 'id', 'parentId', 'performance', 'rootId', 'status']);
});

test('unknown teardown stays occupied; joining never hangs behind it and retains partial facts', { timeout: 1000 }, async () => {
  const f = transportFactory(true), life = createOwnedLifecycle({ startProcess: f.startProcess, maxRunning: 1, stopMs: 5 });
  const root = life.register({ id: 'root', allowHelpers: true, binding });
  const child = root.request({ action: 'spawn', name: 'unknown' }); await tick();
  f.children[0].emit({ ...end('partial'), message: { ...end('partial').message, provider: 'test', model: 'model', responseId: 'own', usage: { input: 7 } } });
  const measured = life.snapshot('root')[0]; assert.equal(measured.usage.input.value, 7); assert.ok(measured.lastActivityAt);
  assert.equal((await root.request({ action: 'cancel', id: child.id })).confirmed, false);
  root.request({ action: 'spawn', name: 'queued' });
  assert.equal(life.snapshot('root')[1].usage, null);
  const sealed = life.snapshot('root')[0]; assert.equal(sealed.usage.sealed, true);
  await assert.rejects(root.join(), /unconfirmed/);
  f.children[0].closed.resolve({ code: 0 }); f.children[0].emit(end('late')); await tick();
  assert.equal(root.request({ action: 'status', id: child.id }).status, 'unknown');
  assert.equal(life.snapshot('root').find(node => node.id === child.id)?.status, 'unknown');
  assert.deepEqual(life.snapshot('root')[0], sealed, 'late records cannot alter unknown usage or activity');
  assert.equal(f.children.length, 1);
  const cleanup = (await life.close())[0];
  assert.equal(cleanup.confirmed, false); assert.equal(cleanup.agents[0].report, 'partial');
});

test('rows give every helper\'s place and standing and the model and level it runs on, without the measurements a snapshot carries', { timeout: 1000 }, async () => {
  const f = transportFactory(), life = createOwnedLifecycle({ startProcess: f.startProcess, maxRunning: 1 });
  const root = life.register({ id: 'root', allowHelpers: true, binding });
  const running = root.request({ action: 'spawn', name: 'running' });
  const queued = root.request({ action: 'spawn', name: 'queued' });
  life.register({ id: 'empty', allowHelpers: true, binding });
  await tick();
  f.children[0].emit({ ...end('partial'), message: { ...end('partial').message, provider: 'test', model: 'model', responseId: 'own', usage: { input: 7 } } });
  assert.equal(life.snapshot()[0].usage.input.value, 7);
  assert.deepEqual(life.rows(), [
    { id: running.id, parentId: 'root', rootId: 'root', depth: 1, name: 'running', status: 'running', model: 'test/model', thinking: 'medium' },
    { id: queued.id, parentId: 'root', rootId: 'root', depth: 1, name: 'queued', status: 'queued', model: 'test/model', thinking: 'medium' },
  ]);
  await life.close();
});

test('host Force remains available after invalidation and reports only captured helper closure', { timeout: 1000 }, async () => {
  const f = transportFactory(true);
  const rows = [], life = createOwnedLifecycle({ startProcess: f.startProcess, stopMs: 5, onPerformance: row => rows.push(row) });
  const root = life.register({ id: 'root', allowHelpers: true, binding });
  const other = life.register({ id: 'other', allowHelpers: true, binding });
  const child = root.request({ action: 'spawn', name: 'target' });
  const outside = other.request({ action: 'spawn', name: 'outside' });
  await tick();
  f.children[0].emit(end('partial'));
  const old = await root.cancel();
  assert.equal(old.confirmed, false);
  await assert.rejects(life.force('root', outside.id), /scope/);
  await assert.rejects(life.force('unowned'), /identity/);
  const pending = life.force('root');
  assert.equal(f.children[0].forces, 1);
  assert.equal(f.children[1].forces, 0);
  assert.equal((await pending).confirmed, false);
  assert.deepEqual(rows, [], 'unknown teardown is not terminal');
  f.children[0].closed.resolve({ code: 0 }); await tick();
  f.children[0].emit(end('late success'));
  const reconciled = await life.force('root', child.id);
  assert.equal(reconciled.confirmed, true);
  assert.equal(reconciled.cleanupScope, 'captured-rpc-children');
  assert.equal(reconciled.detachedCleanup, 'unknown');
  assert.deepEqual(reconciled.agents.map(agent => [agent.status, agent.report]), [['cancelled', 'partial']]);
  assert.equal(f.children[0].forces, 1);
  assert.equal(old.confirmed, false);
  assert.equal(old.agents[0].status, 'unknown');
  assert.deepEqual(rows.map(row => [row.id, row.status]), [[child.id, 'cancelled']]);
  assert.equal(rows[0].performance.sessionId, '0');
  await life.force('root', child.id); assert.equal(rows.length, 1);
  assert.throws(() => root.request({ action: 'spawn', name: 'restart' }), /active/);
  assert.equal(other.request({ action: 'status', id: outside.id }).status, 'running');
  f.children[1].closed.resolve({ code: 0 });
  await life.close();
});

test('nested completion forwards bounded terminal facts, then only the later parent text', { timeout: 1000 }, async () => {
  const rows = [], f = transportFactory(), life = createOwnedLifecycle({ startProcess: f.startProcess, onPerformance: row => rows.push(row) });
  const root = life.register({ id: 'root', allowHelpers: true, binding });
  root.request({ action: 'spawn', name: 'parent' }); await tick();
  const parent = f.children[0];
  parent.emit({ type: 'extension_ui_request', method: 'input', id: 'nested', title: 'hobkin/bridge', placeholder: JSON.stringify({ op: 'tool', name: 'owned_agent', id: 'call', params: { action: 'spawn', name: 'nested', allowHelpers: false } }) });
  await tick(); const child = f.children[1];
  assert.equal(child.options.env.HOBKIN_OWNED_HELPERS, '0');
  child.emit({ type: 'extension_ui_request', method: 'input', id: 'forged', title: 'hobkin/bridge', placeholder: JSON.stringify({ op: 'tool', name: 'owned_agent', id: 'call', params: { action: 'spawn', name: 'forbidden' } }) });
  await tick(); assert.match(JSON.parse(child.responses[0].value).error, /prohibits/);
  parent.emit(end('early parent')); parent.emit({ type: 'agent_settled' }); await tick();
  assert.equal(parent.shutdowns, 0);
  const joining = root.join(); child.emit(end('x'.repeat(700))); child.emit({ type: 'agent_settled' }); await tick();
  const facts = JSON.parse(parent.requests.filter(r => r.type === 'prompt')[1].data.message);
  assert.equal(facts.ownedChildren[0].report.length, 512);
  parent.emit(end('later parent')); parent.emit({ type: 'agent_settled' });
  assert.equal(JSON.parse(await joining).ownedChildren[0].report, 'later parent');
  assert.equal(parent.shutdowns, 1); assert.equal(child.shutdowns, 1); await life.close();
  assert.deepEqual(rows.map(row => [row.depth, row.performance.sessionId]), [[2, '1'], [1, '0']]);
  for (const row of rows) {
    assert.equal(row.performance.runId, row.id); assert.equal(row.rootId, 'root');
    assert.equal(row.status, 'completed'); assert.equal(JSON.stringify(row).includes('later parent'), false);
  }
});

test('failed helpers retain failure facts and cancel descendants', { timeout: 1000 }, async t => {
  const rows = [], f = transportFactory();
  const life = createOwnedLifecycle({ startProcess: f.startProcess, onPerformance: row => rows.push(row) });
  const root = life.register({ id: 'root', allowHelpers: true, binding });
  t.after(() => life.close());

  const parent = root.request({ action: 'spawn', name: 'parent' });
  await tick();
  const parentWire = f.children[0];
  parentWire.emit({
    type: 'extension_ui_request',
    method: 'input',
    id: 'nested',
    title: 'hobkin/bridge',
    placeholder: JSON.stringify({
      op: 'tool',
      name: 'owned_agent',
      id: 'call',
      params: { action: 'spawn', name: 'grandchild' },
    }),
  });
  await tick();
  assert.equal(f.children.length, 2);

  const partial = end('partial failure');
  partial.message.stopReason = 'error';
  parentWire.emit(partial);
  parentWire.emit({ type: 'agent_settled' });

  const childFacts = JSON.parse(await root.join());
  assert.deepEqual(childFacts.ownedChildren.map(({ status }) => status), ['failed', 'cancelled']);
  assert.deepEqual(life.snapshot('root').map(({ status }) => status), ['failed', 'cancelled']);
  assert.equal(childFacts.ownedChildren[0].id, parent.id);
  assert.equal(childFacts.ownedChildren[0].report, 'partial failure');
  assert.equal(f.children[1].shutdowns, 1);
  assert.deepEqual(rows.map(row => row.status).sort(), ['cancelled', 'failed']);
  assert.equal(rows.find(row => row.id === parent.id).performance.sessionId, '0');
});

test('theme root binds one nondelegating child and routes only exact current bridge operations', { timeout: 10000 }, async t => {
  const f = transportFactory(), calls = [], life = createOwnedLifecycle({ startProcess: f.startProcess });
  t.after(() => life.close());
  const theme = { ...binding, role: 'theme', parentRole: 'theme' };
  const root = life.register({ id: 'theme', binding: theme, allowHelpers: true, customStyle: (request, signal) => { calls.push(request); assert.equal(signal.aborted, false); return { css: 'canonical' }; } });
  const other = life.register({ id: 'other-theme', binding: theme, allowHelpers: true, customStyle: () => { throw Error('Wrong root'); } });
  for (const request of [{ action: 'spawn', name: 'delegating' }, { action: 'spawn', name: 'delegating', allowHelpers: true }]) assert.throws(() => root.request(request));
  const child = root.request({ action: 'spawn', name: 'theme', allowHelpers: false }); await tick();
  assert.throws(() => root.request({ action: 'spawn', name: 'second', allowHelpers: false }));
  assert.equal(f.children.length, 1); const wire = f.children[0], args = wire.options.args;
  assert.deepEqual(args, ['--mode', 'rpc', '--no-session', '--model', 'test/model', '--thinking', 'medium', '--no-builtin-tools', '--no-context-files', '--no-extensions', '--extension', new URL('../src/cli/owned-agent-extension.mjs', import.meta.url).pathname, '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes', '--tools', 'custom_style', '--exclude-tools', 'mcp__*']);
  assert.equal(wire.options.env.HOBKIN_OWNED_HELPERS, '0'); assert.equal(wire.options.command, 'pi');
  const envelope = { op: 'tool', name: 'custom_style', id: 'call', params: { op: 'read' } };
  const send = async (request = envelope, extra = {}) => {
    wire.emit({ type: 'extension_ui_request', method: 'input', id: 'bridge', title: 'hobkin/bridge', placeholder: JSON.stringify(request), ...extra });
    await tick(); return wire.responses.at(-1);
  };
  for (const params of [{ op: 'read' }, { op: 'replace', css: 'new palette' }]) assert.equal(JSON.parse((await send({ ...envelope, params })).value).ok, true);
  assert.deepEqual(calls, [{ op: 'read' }, { op: 'replace', css: 'new palette' }]);
  for (const request of [null, [], { ...envelope, path: '/tmp/escape' }, { ...envelope, rootId: 'other-theme' }, { ...envelope, params: { op: 'replace', css: 'x', extra: true } }, { ...envelope, op: 'memory' }, { ...envelope, name: 'owned_agent', params: { action: 'spawn', name: 'escape' } }, { ...envelope, params: { op: 'read', path: '/tmp/escape' } }, { ...envelope, params: { op: 'replace', css: 1 } }, { ...envelope, params: { op: 'delete' } }, { ...envelope, id: 1 }]) assert.equal(JSON.parse((await send(request)).value).ok, false);
  for (const extra of [{ method: 'confirm' }, { title: 'other' }, { sessionId: 'foreign' }, { runId: 'other-child' }, { path: '/tmp/escape' }]) assert.equal((await send(envelope, extra)).cancelled, true);
  await send(envelope, { type: 'not_a_request' }); assert.equal(calls.length, 2);
  assert.equal(other.request({ action: 'list' }).length, 0); assert.equal(root.request({ action: 'status', id: child.id }).allowHelpers, false);
  assert.equal((await root.cancel()).confirmed, true); await send(); assert.equal(calls.length, 2);
});

test('theme pending callbacks receive cancellation on failure or captured closure', { timeout: 10000 }, async t => {
  for (const exited of [false, true]) {
    const f = transportFactory(), gate = Promise.withResolvers(); let callbackSignal;
    const life = createOwnedLifecycle({ startProcess: f.startProcess }); t.after(() => life.close());
    const root = life.register({ id: 'theme', allowHelpers: true, binding: { ...binding, role: 'theme', parentRole: 'theme' },
      customStyle: async (_request, signal) => { callbackSignal = signal; await gate.promise; signal.throwIfAborted(); throw Error('Late authority'); } });
    root.request({ action: 'spawn', name: 'theme', allowHelpers: false }); await tick();
    const wire = f.children[0];
    wire.emit({ type: 'extension_ui_request', method: 'input', id: 'bridge', title: 'hobkin/bridge', placeholder: JSON.stringify({ op: 'tool', name: 'custom_style', id: 'call', params: { op: 'replace', css: 'late' } }) });
    await tick();
    if (exited) wire.closed.resolve({ code: 1 }); else wire.emit({ type: 'agent_settled', aborted: true });
    await tick(); assert.equal(callbackSignal.aborted, true); gate.resolve(); await tick();
    assert.deepEqual(wire.responses, []); assert.equal(JSON.parse(await root.join()).ownedChildren[0].status, 'failed');
  }
});

test('theme authority cannot enter ordinary roots or bypass host admission and isolation', async t => {
  const f = transportFactory(), life = createOwnedLifecycle({ startProcess: f.startProcess }); t.after(() => life.close());
  const customStyle = () => {}, theme = { ...binding, role: 'theme', parentRole: 'theme' };
  for (const options of [{ binding }, { binding: { ...binding, role: 'write', parentRole: 'write' } }, { binding: { ...theme, parentRole: 'read' } }, { binding: theme, customStyle: undefined }, { binding: theme, allowHelpers: false }, { binding: { ...theme, customStyle } }, { binding: { ...theme, launcher: { command: ['pi'] } } }]) {
    assert.throws(() => life.register({ id: 'denied', allowHelpers: true, customStyle, ...options }));
  }
  const root = life.register({ id: 'theme', allowHelpers: true, binding: theme, customStyle, beforeSpawn: () => false });
  assert.throws(() => root.request({ action: 'spawn', name: 'denied', allowHelpers: false }), /admission/);
  assert.equal(f.children.length, 0);
  const read = life.register({ id: 'read', binding, allowHelpers: true });
  assert.throws(() => read.request({ action: 'spawn', name: 'escalate', role: 'theme', customStyle }));
});

test('only host-enabled helpers activate the owned tool, never write tools for a read role', () => {
  const handlers = {}, registered = []; let active;
  ownedExtension({ on: (name, handler) => { handlers[name] = handler; }, registerTool: tool => registered.push(tool), setActiveTools: names => { active = names; } }, { role: 'read', allowHelpers: true });
  handlers.session_start(); assert.deepEqual(active, ['read', 'grep', 'find', 'ls', 'owned_agent']);
  assert.equal(registered[0].name, 'owned_agent'); assert.equal(handlers.tool_call({ toolName: 'owned_agent' }), undefined);
  for (const toolName of ['bash', 'edit', 'write', 'codemode', 'mcp__read']) assert.equal(handlers.tool_call({ toolName }).block, true);
});
