import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { createOwnedAgentAdapter } from '../src/cli/owned-agent-session.mjs';
import { createOwnedLifecycle } from '../src/cli/owned-agent-lifecycle.mjs';
import ownedExtension from '../src/cli/owned-agent-extension.mjs';

for (const name of ['spawn', 'exec', 'execFile', 'fork']) mock.method(childProcess, name, () => { throw Error('Real process forbidden'); });
syncBuiltinESMExports();
mock.method(DefaultResourceLoader.prototype, 'reload', () => { throw Error('Real resource loader forbidden'); });
mock.method(globalThis, 'fetch', () => { throw Error('Network forbidden'); });
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

test('queued children cancel without starting and nested children never queue behind waiting parents', { timeout: 1000 }, async () => {
  const f = transportFactory(), life = createOwnedLifecycle({ startProcess: f.startProcess, maxRunning: 1 });
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
  assert.equal(f.children.length, 1); await life.close();
});

test('unknown teardown stays occupied; joining never hangs behind it and retains partial facts', { timeout: 1000 }, async () => {
  const f = transportFactory(true), life = createOwnedLifecycle({ startProcess: f.startProcess, maxRunning: 1, stopMs: 5 });
  const root = life.register({ id: 'root', allowHelpers: true, binding });
  const child = root.request({ action: 'spawn', name: 'unknown' }); await tick();
  f.children[0].emit(end('partial'));
  assert.equal((await root.request({ action: 'cancel', id: child.id })).confirmed, false);
  root.request({ action: 'spawn', name: 'queued' });
  await assert.rejects(root.join(), /unconfirmed/);
  f.children[0].closed.resolve({ code: 0 }); f.children[0].emit(end('late')); await tick();
  assert.equal(root.request({ action: 'status', id: child.id }).status, 'unknown');
  assert.equal(f.children.length, 1);
  const cleanup = (await life.close())[0];
  assert.equal(cleanup.confirmed, false); assert.equal(cleanup.agents[0].report, 'partial');
});

test('host Force remains available after invalidation and reports only captured helper closure', { timeout: 1000 }, async () => {
  const f = transportFactory(true), life = createOwnedLifecycle({ startProcess: f.startProcess, stopMs: 5 });
  const root = life.register({ id: 'root', allowHelpers: true, binding });
  const other = life.register({ id: 'other', allowHelpers: true, binding });
  const child = root.request({ action: 'spawn', name: 'target' });
  const outside = other.request({ action: 'spawn', name: 'outside' }); await tick();
  f.children[0].emit(end('partial'));
  const old = await root.cancel();
  assert.equal(old.confirmed, false);
  await assert.rejects(life.force('root', outside.id), /scope/);
  await assert.rejects(life.force('unowned'), /identity/);
  const pending = life.force('root');
  assert.equal(f.children[0].forces, 1);
  assert.equal(f.children[1].forces, 0);
  assert.equal((await pending).confirmed, false);
  f.children[0].closed.resolve({ code: 0 }); await tick();
  f.children[0].emit(end('late success'));
  const reconciled = await life.force('root', child.id);
  assert.equal(reconciled.confirmed, true);
  assert.equal(reconciled.cleanupScope, 'captured-rpc-children'); assert.equal(reconciled.detachedCleanup, 'unknown');
  assert.deepEqual(reconciled.agents.map(agent => [agent.status, agent.report]), [['cancelled', 'partial']]);
  assert.equal(f.children[0].forces, 1);
  assert.equal(old.confirmed, false); assert.equal(old.agents[0].status, 'unknown');
  assert.throws(() => root.request({ action: 'spawn', name: 'restart' }), /active/);
  assert.equal(other.request({ action: 'status', id: outside.id }).status, 'running');
  f.children[1].closed.resolve({ code: 0 }); await life.close();
});

test('nested completion forwards bounded terminal facts, then only the later parent text', { timeout: 1000 }, async () => {
  const f = transportFactory(), life = createOwnedLifecycle({ startProcess: f.startProcess });
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
});

test('failed helpers retain failure facts and cancel descendants', { timeout: 1000 }, async t => {
  const f = transportFactory();
  const life = createOwnedLifecycle({ startProcess: f.startProcess });
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
  assert.equal(childFacts.ownedChildren[0].id, parent.id);
  assert.equal(childFacts.ownedChildren[0].report, 'partial failure');
  assert.equal(f.children[1].shutdowns, 1);
});

test('only host-enabled helpers activate the owned tool, never write tools for a read role', () => {
  const handlers = {}, registered = []; let active;
  ownedExtension({ on: (name, handler) => { handlers[name] = handler; }, registerTool: tool => registered.push(tool), setActiveTools: names => { active = names; } }, { role: 'read', allowHelpers: true });
  handlers.session_start(); assert.deepEqual(active, ['read', 'grep', 'find', 'ls', 'owned_agent']);
  assert.equal(registered[0].name, 'owned_agent'); assert.equal(handlers.tool_call({ toolName: 'owned_agent' }), undefined);
  for (const toolName of ['bash', 'edit', 'write', 'codemode', 'mcp__read']) assert.equal(handlers.tool_call({ toolName }).block, true);
});
