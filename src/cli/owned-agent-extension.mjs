import { callBridge } from './bridge.mjs';
import { createOwnedAgentSessionTool } from './owned-agent-tool.mjs';

const READ = ['read', 'grep', 'find', 'ls'];
const WRITE = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

export function ownedRoleTools(role) {
  if (!['read', 'write'].includes(role)) throw Error('Invalid owned role');
  return [...(role === 'read' ? READ : WRITE)];
}

// The host supplies the role, never a tool argument or a prompt instruction.
export default function ownedAgentExtension(pi, { role = process.env.HOBKIN_OWNED_ROLE, allowHelpers = process.env.HOBKIN_OWNED_HELPERS === '1' } = {}) {
  const allowed = new Set(ownedRoleTools(role));
  if (allowHelpers === true) {
    allowed.add('owned_agent');
    pi.registerTool(createOwnedAgentSessionTool(async (params, signal, ctx, id) =>
      (await callBridge(ctx, { op: 'tool', name: 'owned_agent', id, params }, signal)).details));
    pi.on('session_start', () => pi.setActiveTools([...allowed]));
  }
  pi.on('tool_call', event => {
    if (!allowed.has(event.toolName)) return { block: true, reason: 'Tool outside owned role', terminate: true };
  });
}
