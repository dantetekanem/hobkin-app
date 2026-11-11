import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedAgents } from '../src/cli/owned-agents.mjs';
import { createOwnedAgentTool } from '../src/cli/owned-agent-tool.mjs';

function fixture(options = {}) {
  const starts = [], cancels = [], pending = new Map();
  const tree = createOwnedAgents({ adapter: { start(agent) {
    starts.push(agent);
    const result = new Promise((resolve, reject) => pending.set(agent.id, { resolve, reject }));
    return { result, cancel: async () => { cancels.push(agent.id); return agent.name !== 'unknown'; } };
  } }, ...options });
  tree.registerRoot({ id: 'root', allowHelpers: true });
  return { tree, starts, cancels, pending };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('immutable IDs, not duplicate names, scope siblings and grandchildren', () => {
  const { tree, starts } = fixture();
  const a = tree.spawn('root', { name: 'same' }), b = tree.spawn('root', { name: 'same' });
  const child = tree.spawn(a.id, { name: 'same' });
  assert.notEqual(a.id, b.id);
  assert.equal(child.parentId, a.id);
  assert.equal(child.rootId, 'root');
  assert.deepEqual(tree.list(a.id).map(x => x.id), [child.id]);
  assert.throws(() => tree.status(a.id, b.id), /scope/);
  a.parentId = 'forged';
  assert.equal(tree.status('root', a.id).parentId, 'root');
  assert.ok(Object.isFrozen(starts[0]));
});

test('bounded FIFO queue starts once and records terminal outcomes', async () => {
  const { tree, starts, pending } = fixture({ maxRunning: 1, maxQueued: 1 });
  const a = tree.spawn('root', { name: 'a' }), b = tree.spawn('root', { name: 'b' });
  assert.equal(b.status, 'queued');
  assert.throws(() => tree.spawn('root', { name: 'overflow' }), /capacity/);
  pending.get(a.id).resolve('report');
  await tick();
  assert.equal(tree.status('root', a.id).status, 'completed');
  assert.equal(tree.status('root', a.id).report, 'report');
  assert.deepEqual(starts.map(x => x.id), [a.id, b.id]);
  pending.get(b.id).reject(Error('failed'));
  await tick();
  assert.equal(tree.status('root', b.id).status, 'failed');
  assert.equal(starts.length, 2);
});

test('depth, total descendants and no-helper inputs refuse before launch', () => {
  const { tree, starts } = fixture({ maxDepth: 1, maxDescendants: 2 });
  const a = tree.spawn('root', { name: 'a' });
  assert.throws(() => tree.spawn(a.id, { name: 'too deep' }), /depth/);
  tree.spawn('root', { name: 'b' });
  assert.throws(() => tree.spawn('root', { name: 'third' }), /descendant/);
  tree.registerRoot({ id: 'disabled', allowHelpers: false });
  assert.throws(() => tree.spawn('disabled', { name: 'blocked', allowHelpers: true }), /helpers/);
  tree.registerRoot({ id: 'implicit' });
  assert.throws(() => tree.spawn('implicit', { name: 'blocked' }), /helpers/);
  assert.equal(starts.length, 2);
  assert.throws(() => tree.registerRoot({ id: 'root', allowHelpers: true }), /identity/);
});

test('recursive cancellation confirms queued cleanup but preserves unknown capacity', async () => {
  const { tree, starts, cancels } = fixture({ maxRunning: 2, maxQueued: 2 });
  const a = tree.spawn('root', { name: 'unknown' });
  const b = tree.spawn(a.id, { name: 'child' });
  const c = tree.spawn(b.id, { name: 'queued' });
  const result = await tree.cancel('root', a.id);
  assert.equal(result.confirmed, false);
  assert.equal(tree.status('root', a.id).status, 'unknown');
  assert.equal(tree.status('root', b.id).status, 'cancelled');
  assert.equal(tree.status('root', c.id).status, 'cancelled');
  assert.deepEqual(new Set(cancels), new Set([a.id, b.id]));
  assert.equal(starts.length, 2);
  assert.throws(() => tree.spawn(a.id, { name: 'restart' }), /active/);
  assert.equal((await tree.cancel('root', a.id)).confirmed, false);
  assert.equal(cancels.length, 2);
});

test('bound tool rejects forged identity and exact sibling cancellation', async () => {
  const { tree, cancels } = fixture();
  const a = tree.spawn('root', { name: 'a' }), b = tree.spawn('root', { name: 'b' });
  const tool = createOwnedAgentTool(tree, a.id);
  assert.throws(() => tool({ action: 'spawn', name: 'x', parentId: b.id }), /request/);
  assert.throws(() => tool({ action: 'status', id: b.id }), /scope/);
  await assert.rejects(tool({ action: 'cancel', id: b.id }), /scope/);
  const child = tool({ action: 'spawn', name: 'child', allowHelpers: false });
  assert.throws(() => tree.spawn(child.id, { name: 'forbidden' }), /helpers/);
  assert.equal((await tool({ action: 'cancel', id: child.id })).confirmed, true);
  assert.deepEqual(cancels, [child.id]);
});

test('overlapping cancellation calls share teardown and late completion cannot invent success', async () => {
  let calls = 0, finishCancel, finishResult;
  const tree = createOwnedAgents({ maxRunning: 1, maxQueued: 1, adapter: { start() {
    return { result: new Promise(resolve => { finishResult = resolve; }), cancel() {
      calls++;
      return new Promise(resolve => { finishCancel = resolve; });
    } };
  } } });
  tree.registerRoot({ id: 'root', allowHelpers: true });
  const a = tree.spawn('root', { name: 'a' });
  const first = tree.cancel('root', a.id), second = tree.cancel('root', a.id);
  assert.equal(calls, 1);
  finishCancel(false);
  assert.equal((await first).confirmed, false);
  assert.equal((await second).confirmed, false);
  finishResult('too late');
  await tick();
  assert.equal(tree.status('root', a.id).status, 'unknown');
  assert.equal(tree.spawn('root', { name: 'queued' }).status, 'queued');
  assert.throws(() => tree.spawn('root', { name: 'overflow' }), /capacity/);
});

test('synchronous launch failure is terminal and never retried', () => {
  let calls = 0;
  const tree = createOwnedAgents({ adapter: { start() { calls++; throw Error('launch failed'); } } });
  tree.registerRoot({ id: 'root', allowHelpers: true });
  const agent = tree.spawn('root', { name: 'failure' });
  assert.equal(agent.status, 'failed');
  assert.equal(calls, 1);
});
