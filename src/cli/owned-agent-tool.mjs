import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { actionParameters } from './action-parameters.mjs';

/** Same validated tool contract in an SDK session and on both sides of RPC. */
export function createOwnedAgentSessionTool(hostCallback) {
  const id = Type.String({ minLength: 1, maxLength: 200 });
  const { parameters, refusal } = actionParameters({
    spawn: { name: Type.String({ minLength: 1, maxLength: 120 }), allowHelpers: Type.Optional(Type.Boolean()) },
    list: {},
    status: { id },
    cancel: { id },
  });
  return defineTool({
    name: 'owned_agent',
    label: 'Owned agents',
    description: 'Spawn a named owned helper, list descendants, inspect status or cancel an exact owned ID. The host binds parent, root, task, role and model; requests cannot choose them. allowHelpers can restrict further delegation. Availability and admission are decided by the host.',
    parameters,
    async execute(_id, request, signal, _update, ctx) {
      if (!Check(parameters, request)) throw Error('Invalid owned-agent request');
      const unfit = refusal(request);
      if (unfit) throw Error(`Invalid owned-agent request. ${unfit}`);
      if (request.action === 'spawn' && !request.name.trim()) throw Error('Invalid owned-agent request');
      signal?.throwIfAborted();
      if (!hostCallback) throw Error('Owned agents are unavailable.');
      const details = await hostCallback(request, signal, ctx, _id);
      signal?.throwIfAborted();
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    },
  });
}

/** Host binds authority; model requests never choose their parent or root. */
export function createOwnedAgentTool(tree, parentId) {
  tree.status(parentId, parentId);
  return function ownedAgentRequest(request) {
    const fields = { spawn: ['action', 'name', 'allowHelpers'], list: ['action'], status: ['action', 'id'], cancel: ['action', 'id'] };
    const allowed = request && fields[request.action];
    if (!allowed || Object.keys(request).some(key => !allowed.includes(key))
      || (['status', 'cancel'].includes(request.action) && typeof request.id !== 'string')) throw Error('Invalid owned-agent request');
    switch (request.action) {
      case 'spawn': return tree.spawn(parentId, request);
      case 'list': return tree.list(parentId);
      case 'status': return tree.status(parentId, request.id);
      case 'cancel': return tree.cancel(parentId, request.id);
    }
  };
}
