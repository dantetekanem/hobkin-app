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

test('host Force captures a whole branch before waits, retains unknown custody and leaves unrelated roots alone', { timeout: 1000 }, async () => {
  const starts = [], forces = [];
  const receipts = new Map(), results = new Map();
  const tree = createOwnedAgents({ maxRunning: 4, adapter: { start(agent) {
    starts.push(agent.id);
    const result = Promise.withResolvers(); results.set(agent.id, result);
    receipts.set(agent.id, Promise.withResolvers());
    return {
      result: result.promise,
      cancel: () => agent.name === 'stuck' ? new Promise(() => {}) : false,
      force() {
        forces.push(agent.id);
        return receipts.get(agent.id).promise;
      },
    };
  } } });
  tree.registerRoot({ id: 'root', allowHelpers: true });
  tree.registerRoot({ id: 'other', allowHelpers: true });
  const outside = tree.spawn('other', { name: 'outside' });
  const parent = tree.spawn('root', { name: 'stuck' });
  const nested = tree.spawn(parent.id, { name: 'nested' });
  const unknown = tree.spawn(parent.id, { name: 'unknown' });
  const queued = tree.spawn(nested.id, { name: 'queued' });
  const old = await tree.cancel('root', unknown.id);
  assert.equal(old.confirmed, false);
  void tree.cancel('root', parent.id); // This parent never answers ordinary cancellation.
  await assert.rejects(tree.force('root', outside.id), /scope/);
  assert.throws(() => createOwnedAgentTool(tree, 'root')({ action: 'force', id: parent.id }), /request/);
  const first = tree.force('root', parent.id);
  const duplicate = tree.force('root', parent.id);
  assert.deepEqual(forces, [parent.id, nested.id, unknown.id]);
  assert.equal(tree.status('root', queued.id).status, 'cancelled');
  assert.throws(() => tree.spawn(nested.id, { name: 'late' }), /active/);
  receipts.get(parent.id).resolve(true);
  receipts.get(nested.id).resolve(true);
  receipts.get(unknown.id).resolve(false);
  const receipt = await first;
  assert.equal(receipt.confirmed, false);
  assert.equal((await duplicate).confirmed, false);
  assert.equal(receipt.cleanupScope, 'captured-rpc-children');
  assert.equal(receipt.detachedCleanup, 'unknown');
  assert.equal(tree.status('other', outside.id).status, 'running');
  assert.equal(starts.length, 4);
  results.get(unknown.id).resolve('late success');
  await tick();
  assert.equal(tree.status('root', unknown.id).status, 'unknown');
  const retry = Promise.withResolvers();
  retry.resolve(true);
  receipts.set(unknown.id, retry);
  assert.equal((await tree.force('root', parent.id)).confirmed, true);
  assert.deepEqual(forces, [parent.id, nested.id, unknown.id, unknown.id]);
  assert.equal(old.agents[0].status, 'unknown');
  assert.equal(receipt.agents.find(node => node.id === unknown.id).status, 'unknown');
  assert.equal(tree.status('root', unknown.id).status, 'cancelled');
});

test('failed Force keeps its slot and can retry; a late ordinary failure cannot undo confirmed closure', { timeout: 1000 }, async () => {
  const ordinary = Promise.withResolvers();
  let attempts = 0, starts = 0;
  const tree = createOwnedAgents({ maxRunning: 1, adapter: { start() {
    starts++;
    return {
      result: new Promise(() => {}),
      cancel: () => ordinary.promise,
      force() {
        if (++attempts === 1) throw Error('signal denied');
        return attempts === 2 ? Promise.reject(Error('unconfirmed')) : Promise.resolve(true);
      },
    };
  } } });
  tree.registerRoot({ id: 'root', allowHelpers: true });
  const child = tree.spawn('root', { name: 'child' });
  const queued = tree.spawn('root', { name: 'queued' });
  const stopping = tree.cancel('root', child.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await tree.force('root', child.id)).confirmed, false);
    assert.equal(tree.status('root', child.id).status, 'unknown');
    assert.equal(tree.status('root', queued.id).status, 'queued');
  }
  assert.equal(starts, 1);
  assert.equal((await tree.force('root', child.id)).confirmed, true);
  ordinary.resolve(false);
  await stopping;
  assert.equal(tree.status('root', child.id).status, 'cancelled');
  assert.equal(tree.status('root', queued.id).status, 'running');
  assert.equal(starts, 2);
});

test('synchronous launch failure is terminal and never retried', () => {
  let calls = 0;
  const tree = createOwnedAgents({ adapter: { start() { calls++; throw Error('launch failed'); } } });
  tree.registerRoot({ id: 'root', allowHelpers: true });
  const agent = tree.spawn('root', { name: 'failure' });
  assert.equal(agent.status, 'failed');
  assert.equal(calls, 1);
});
