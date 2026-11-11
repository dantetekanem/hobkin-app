import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnedAgentAdapter } from '../src/cli/owned-agent-session.mjs';
import extension, { ownedRoleTools } from '../src/cli/owned-agent-extension.mjs';
import { createOwnedAgents } from '../src/cli/owned-agents.mjs';

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
      if (type === 'get_session_stats') return { sessionId: 'session', tokens: { input: 5 }, cost: 0.01 };
      return { disposition: 'started' };
    },
    shutdown() { shutdowns++; if (!options.hang) closed.resolve({ code: options.exitCode ?? 0 }); return closed.promise; },
    terminate() { terminations++; },
    force() { forces++; },
  };
  const adapter = createOwnedAgentAdapter({
    bindingFor: () => ({ ...binding, ...options.binding }), startupMs: 30, stopMs: 15,
    startProcess: args => { calls.push(args); callbacks = args; return options.malformed ? { ...transport, request: null } : transport; },
    onEvent: options.onEvent, onStats: options.onStats,
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

test('read execution guard blocks every nonallowlisted tool even when requested directly', () => {
  const handlers = {};
  extension({ on: (name, handler) => { handlers[name] = handler; } }, { role: 'read' });
  for (const name of ['bash', 'write', 'edit', 'codemode', 'tool_search', 'mcp__server__read', 'owned_agent']) {
    assert.equal(handlers.tool_call({ toolName: name }).block, true, name);
  }
  for (const name of ownedRoleTools('read')) assert.equal(handlers.tool_call({ toolName: name }), undefined);
  assert.throws(() => ownedRoleTools('full'));
});
