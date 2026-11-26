import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { callBridge } from './bridge.mjs';
import { createOwnedAgentSessionTool } from './owned-agent-tool.mjs';

const READ = ['read', 'grep', 'find', 'ls'];
const WRITE = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

export function ownedRoleTools(role) {
  if (role === 'theme') return ['custom_style'];
  if (!['read', 'write'].includes(role)) throw Error('Invalid owned role');
  return [...(role === 'read' ? READ : WRITE)];
}

export function createCustomStyleTool(callback) {
  const parameters = Type.Union([
    Type.Object(
      { op: Type.Literal('read') },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        op: Type.Literal('replace'),
        css: Type.String({ maxLength: 16384 }),
      },
      { additionalProperties: false },
    ),
  ]);
  return {
    name: 'custom_style',
    label: 'Custom style',
    description: 'Read or replace the fixed custom style. Only the five palette and two border colors are supported.',
    parameters,
    async execute(id, request, signal, _update, ctx) {
      if (!Check(parameters, request)) throw Error('Invalid custom_style operation');
      signal?.throwIfAborted();
      const details = await callback(request, signal, ctx, id);
      signal?.throwIfAborted();
      return {
        content: [{ type: 'text', text: JSON.stringify(details) }],
        details,
      };
    },
  };
}

// The host supplies the role, never a tool argument or a prompt instruction.
export default function ownedAgentExtension(pi, { role = process.env.HOBKIN_OWNED_ROLE, allowHelpers = process.env.HOBKIN_OWNED_HELPERS === '1' } = {}) {
  const allowed = new Set(ownedRoleTools(role));
  if (role === 'theme') {
    pi.registerTool(createCustomStyleTool(async (params, signal, ctx, id) => {
      const reply = await callBridge(ctx, {
        op: 'tool',
        name: 'custom_style',
        id,
        params,
      }, signal);
      return reply.details;
    }));
    pi.on('session_start', () => pi.setActiveTools([...allowed]));
  } else if (allowHelpers === true) {
    allowed.add('owned_agent');
    pi.registerTool(createOwnedAgentSessionTool(async (params, signal, ctx, id) =>
      (await callBridge(ctx, { op: 'tool', name: 'owned_agent', id, params }, signal)).details));
    pi.on('session_start', () => pi.setActiveTools([...allowed]));
  }
  pi.on('tool_call', event => {
    if (!allowed.has(event.toolName)) return { block: true, reason: 'Tool outside owned role', terminate: true };
  });
}
