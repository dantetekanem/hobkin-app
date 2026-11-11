import { randomUUID } from 'node:crypto';

/** In-memory host authority only; adapters own session launch and confirmed teardown. */
export function createOwnedAgents({ adapter, maxRunning = 4, maxQueued = 8, maxDepth = 3, maxDescendants = 32 }) {
  for (const limit of [maxRunning, maxQueued, maxDepth, maxDescendants]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Invalid owned-agent limit');
  }
  if (typeof adapter?.start !== 'function') throw Error('Owned adapter required');
  const nodes = new Map(), handles = new Map(), stops = new Map();
  const occupied = node => !node.root && ['running', 'cancelling', 'unknown'].includes(node.status);
  const snapshot = node => ({ ...node });
  function get(id) {
    const node = nodes.get(id);
    if (!node) throw Error('Unknown owned identity');
    return node;
  }
  function within(scopeId, node) {
    get(scopeId);
    for (let cursor = node; cursor; cursor = nodes.get(cursor.parentId)) {
      if (cursor.id === scopeId) return true;
    }
    return false;
  }
  function scoped(scopeId, id) {
    const node = get(id);
    if (!within(scopeId, node)) throw Error('Identity outside owned scope');
    return node;
  }
  function settle(node, status, report) {
    if (node.status !== 'running') return;
    node.status = status;
    if (status === 'completed') node.report = typeof report === 'string' ? report.slice(0, 8000) : '';
    handles.delete(node.id);
    drain();
  }
  function start(node) {
    node.status = 'running';
    try {
      const handle = adapter.start(Object.freeze(snapshot(node)));
      if (!handle || typeof handle.cancel !== 'function' || typeof handle.result?.then !== 'function') throw Error('Invalid adapter handle');
      handles.set(node.id, handle);
      Promise.resolve(handle.result).then(report => settle(node, 'completed', report), () => settle(node, 'failed'));
    } catch {
      settle(node, 'failed');
    }
  }
  function drain() {
    for (const node of nodes.values()) {
      if ([...nodes.values()].filter(occupied).length >= maxRunning) break;
      if (node.status === 'queued') start(node);
    }
  }
  function registerRoot({ id, allowHelpers = false }) {
    if (typeof id !== 'string' || !id || id.length > 200 || nodes.has(id)) throw Error('Invalid or duplicate root identity');
    nodes.set(id, { id, parentId: null, rootId: id, depth: 0, status: 'running', allowHelpers: allowHelpers === true, root: true });
    return snapshot(get(id));
  }
  function spawn(parentId, { name, allowHelpers = true }) {
    const parent = get(parentId);
    if (parent.status !== 'running') throw Error('Parent is not active');
    if (!parent.allowHelpers) throw Error('Direction prohibits helpers');
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || typeof allowHelpers !== 'boolean') throw Error('Invalid owned-agent name or direction');
    if (parent.depth >= maxDepth) throw Error('Owned-agent depth exceeded');
    const children = [...nodes.values()].filter(node => !node.root);
    if (children.filter(node => node.rootId === parent.rootId).length >= maxDescendants) throw Error('Owned descendant limit exceeded');
    if (children.filter(occupied).length >= maxRunning && children.filter(node => node.status === 'queued').length >= maxQueued) throw Error('Owned capacity exceeded');
    const node = { id: randomUUID(), parentId, rootId: parent.rootId, depth: parent.depth + 1, name: name.trim(), allowHelpers, status: 'queued' };
    nodes.set(node.id, node);
    drain();
    return snapshot(node);
  }
  function list(scopeId) {
    get(scopeId);
    return [...nodes.values()].filter(node => node.id !== scopeId && within(scopeId, node)).map(snapshot);
  }
  async function cancel(scopeId, id) {
    const target = scoped(scopeId, id);
    const branch = [...nodes.values()].filter(node => within(target.id, node));
    // Freeze admission and the queue before any asynchronous teardown can release capacity.
    for (const node of branch) {
      if (node.status === 'queued' || (node.root && node.status === 'running')) node.status = 'cancelled';
      else if (node.status === 'running') node.status = 'cancelling';
    }
    await Promise.all(branch.map(async node => {
      if (node.status !== 'cancelling') return;
      if (!stops.has(node.id)) stops.set(node.id, (async () => {
        try { node.status = await handles.get(node.id)?.cancel() === true ? 'cancelled' : 'unknown'; }
        catch { node.status = 'unknown'; }
        handles.delete(node.id);
      })());
      await stops.get(node.id);
    }));
    drain();
    return { id, confirmed: branch.every(node => !['unknown', 'cancelling'].includes(node.status)), agents: branch.map(snapshot) };
  }
  // Roots consume no child capacity, including when several host runs share this tree.
  return { registerRoot, spawn, list, status: (scopeId, id) => snapshot(scoped(scopeId, id)), cancel };
}
