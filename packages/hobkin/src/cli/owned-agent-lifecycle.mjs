import { isAbsolute } from 'node:path';
import { createOwnedAgents } from './owned-agents.mjs';
import { createOwnedAgentAdapter } from './owned-agent-session.mjs';
import { createOwnedAgentTool } from './owned-agent-tool.mjs';

/** Host bindings and joins around the tree; no process ownership or persisted replay. */
export function createOwnedLifecycle({ maxRunning = 4, maxDepth = 3, startProcess, stopMs, onEvent = () => {}, onStats, onChange = () => {}, onPerformance = () => {} } = {}) {
  const scopes = new Map(), roots = new Set(), partial = new Map();
  const themeCapabilities = new Map();
  let closing = false, changed = Promise.withResolvers();
  const notify = () => {
    for (const root of roots) for (const { id, parentId, rootId, depth, status } of tree.list(root)) {
      const child = scopes.get(id);
      if (!child || child.performancePublished || !['completed', 'failed', 'cancelled'].includes(status)) continue;
      child.performancePublished = true;
      try {
        const attempt = onPerformance({
          id, parentId, rootId, depth, status,
          performance: child.handle?.snapshot().performance ?? null,
        });
        Promise.resolve(attempt).catch(() => {});
      } catch { /* A best-effort observer cannot change execution or retry publication. */ }
    }
    changed.resolve();
    changed = Promise.withResolvers();
    onChange();
  };
  const fact = ({ id, parentId, status, report }) => ({ id, parentId, status, report: (report ?? partial.get(id) ?? '').slice(0, 512) });
  const adapter = createOwnedAgentAdapter({ startProcess, stopMs, onStats,
    bindingFor: identity => scopes.get(identity.id)?.binding,
    ownedAgent: (identity, request, signal) => scopes.get(identity.id).request(request, signal),
    customStyle: (identity, request, signal) => {
      const child = scopes.get(identity.id);
      const root = scopes.get(identity.rootId);
      if (
        !child?.valid
        || !root?.valid
        || child.binding.role !== 'theme'
        || identity.parentId !== identity.rootId
        || tree.status(identity.rootId, identity.id).status !== 'running'
      ) {
        throw Error('Inactive theme child');
      }
      return themeCapabilities.get(identity.rootId)(request, signal);
    },
    join: identity => scopes.get(identity.id).join(),
    onUnconfirmed: identity => { void scopes.get(identity.id).cancel(); },
    onEvent: (identity, event) => { if (event.type === 'message_end') partial.set(identity.id, event.text); onEvent(identity, event); },
  });
  const tree = createOwnedAgents({ maxRunning, maxDepth, adapter: { start(identity) {
    const parent = scopes.get(identity.parentId);
    if (!scopes.has(identity.id)) scope(identity.id, { ...parent.binding, parentRole: parent.binding.role, allowHelpers: identity.allowHelpers }, identity.rootId);
    const handle = adapter.start(identity);
    scopes.get(identity.id).handle = handle;
    const settled = () => { scopes.get(identity.id).finish(); queueMicrotask(notify); };
    const failed = () => {
      scopes.get(identity.id).invalidateAfterFailure();
      queueMicrotask(notify);
    };
    handle.result.then(settled, failed);
    return handle;
  } } });
  function scope(id, binding, rootId = id) {
    let valid = true, accepting = true, delivered = false, cancellation;
    const tool = createOwnedAgentTool(tree, id);
    const check = () => { if (!valid || !scopes.get(rootId).valid) throw Error('Owned parent is no longer active'); };
    const value = { binding: Object.freeze({ ...binding }), get valid() { return valid; },
      request(request, signal) {
        signal?.throwIfAborted(); check();
        if (request?.action === 'spawn') {
          if (
            binding.role === 'theme'
            && (id !== rootId || tree.list(id).length || request.allowHelpers !== false)
          ) {
            throw Error('Theme permits one nondelegating child');
          }
          if (!accepting) throw Error('Owned parent is joining');
          const policy = scopes.get(rootId).beforeSpawn;
          const decision = policy === undefined ? true : policy({ rootId, parentId: id });
          if (decision instanceof Promise) decision.catch(() => {});
          if (decision !== true) throw Error('Owned admission denied');
          const occupied = [...roots].flatMap(root => tree.list(root)).filter(node => ['running', 'cancelling', 'unknown'].includes(node.status));
          // A waiting child holds a slot: queuing its descendant can deadlock the entire pool.
          if (rootId !== id && occupied.length >= maxRunning) throw Error('No running slot for a nested helper');
        }
        if (request?.action === 'cancel') {
          if (Object.keys(request).some(key => !['action', 'id'].includes(key))) throw Error('Invalid owned-agent request');
          tree.status(id, request.id); // Refuse another tree before invalidation.
          return scopes.get(request.id).cancel();
        }
        const result = tool(request);
        if (request.action === 'spawn' && result.status === 'queued') scope(result.id, { ...binding, parentRole: binding.role, allowHelpers: result.allowHelpers }, rootId);
        notify(); return result;
      },
      async join() {
        check(); accepting = false;
        let children;
        for (;;) {
          children = tree.list(id);
          if (children.some(node => node.status === 'unknown')) throw Error('Owned child cleanup is unconfirmed');
          if (!children.some(node => ['running', 'queued', 'cancelling'].includes(node.status))) break;
          await changed.promise; check();
        }
        if (delivered || !children.length) return;
        delivered = true;
        return JSON.stringify({ ownedChildren: children.map(fact) });
      },
      finish() {
        valid = false;
        accepting = false;
        if (id === rootId) themeCapabilities.delete(id);
        notify();
      },
      invalidateAfterFailure() {
        value.finish();
        const directChildren = tree.list(id).filter(node => node.parentId === id);
        for (const child of directChildren) {
          void scopes.get(child.id)?.cancel();
        }
      },
      cancel() {
        if (!cancellation) {
          value.finish();
          for (const child of tree.list(id)) scopes.get(child.id)?.finish();
          cancellation = tree.cancel(id, id).then(result => ({ ...result, agents: result.agents.filter(node => !node.root).map(fact) })).finally(notify);
        }
        return cancellation;
      },
    };
    scopes.set(id, value); return value;
  }
  return {
    register({ id, binding, allowHelpers = false, beforeSpawn, customStyle }) {
      if (closing) throw Error('Owned lifecycle is closed');
      if (typeof allowHelpers !== 'boolean') throw Error('Invalid owned host direction');
      const theme = binding?.role === 'theme';
      if (Object.hasOwn(binding ?? {}, 'customStyle') || (theme
        ? !allowHelpers || binding.parentRole !== 'theme' || typeof customStyle !== 'function' || binding.launcher !== undefined
        : customStyle !== undefined)) throw Error('Invalid theme host authority');
      if (allowHelpers && (!isAbsolute(binding?.cwd ?? '') || typeof binding?.prompt !== 'string' || !binding.prompt.trim()
        || Buffer.byteLength(binding.prompt) > 524288 || (!theme && (!['read', 'write'].includes(binding.role)
        || !['read', 'write'].includes(binding.parentRole) || (binding.parentRole === 'read' && binding.role !== 'read')))
        || !/^[^/\s]+\/\S+$/.test(binding.model ?? '') || !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(binding.effort))) throw Error('Invalid owned host authority');
      tree.registerRoot({ id, allowHelpers }); roots.add(id);
      if (theme) themeCapabilities.set(id, customStyle);
      return Object.assign(scope(id, { ...binding, allowHelpers }), { beforeSpawn });
    },
    snapshot(rootId) {
      if (rootId !== undefined && !roots.has(rootId)) return null;
      return (rootId === undefined ? [...roots].flatMap(id => tree.list(id)) : tree.list(rootId))
        .map(({ id, parentId, rootId, depth, name, status }) => ({ id, parentId, rootId, depth, name, status,
          ...(scopes.get(id)?.handle?.snapshot() ?? { usage: null, lastActivityAt: null, performance: null }) }));
    },
    /**
     * Every helper's place and standing, as `snapshot()` gives them without measuring each helper, and the model and
     * thinking level its binding starts it on: all a display needs.
     */
    rows() {
      const helpers = [...roots].flatMap(id => tree.list(id));
      return helpers.map(({ id, parentId, rootId, depth, name, status }) => {
        const binding = scopes.get(id)?.binding;
        return {
          id, parentId, rootId, depth, name, status,
          ...(binding?.model ? { model: binding.model } : {}),
          ...(binding?.effort ? { thinking: binding.effort } : {}),
        };
      });
    },
    targets() {
      return [...roots].flatMap(runId => tree.list(runId)).filter(node => ['running', 'queued', 'cancelling', 'unknown'].includes(node.status))
        .map(node => ({ kind: 'agent', runId: node.rootId, agentId: node.id, parentId: node.parentId, rootId: node.rootId, label: node.name, canStop: true, canForce: true }));
    },
    stop(scopeId, id) {
      tree.status(scopeId, id);
      return scopes.get(id).cancel();
    },
    async force(scopeId, id = scopeId) {
      tree.status(scopeId, id); // Captured identity remains authoritative after its model scope is invalidated.
      for (const node of [tree.status(scopeId, id), ...tree.list(id)]) {
        scopes.get(node.id)?.finish();
      }

      try {
        const result = await tree.force(scopeId, id);
        return {
          ...result,
          agents: result.agents.filter(node => !node.root).map(fact),
        };
      } finally {
        notify();
      }
    },
    async close() { closing = true; return Promise.all([...roots].map(id => scopes.get(id).cancel())); },
  };
}
