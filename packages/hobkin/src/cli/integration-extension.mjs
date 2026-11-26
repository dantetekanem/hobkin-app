import { fileURLToPath } from 'node:url';
import { callBridge } from './bridge.mjs';

/**
 * The path hobkin loads with `--extension` into a Pi agent that an integration offers tools to or hooks calls of
 * (`namingExtensions` in `harnesses.mjs`, 065-integration-drops). What it does comes from this variable, which hobkin
 * sets for that agent alone: `{ tools: [{ name, description, parameters }], hooked?: [names] | 'all' }`.
 */
export const integrationExtension = fileURLToPath(import.meta.url);
export const INTEGRATIONS_ENV = 'HOBKIN_INTEGRATIONS';
// How long a hooked call waits for the host before it goes on as it was. The host answers its own hooks sooner.
const HOOK_WAIT_MS = 15000;
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const textOf = content => (Array.isArray(content) ? content : []).filter(part => part?.type === 'text' && typeof part.text === 'string')
  .map(part => part.text).join('\n');

/** The offer hobkin set for this agent, or null when it set none or it cannot be read. */
export function readOffer(env = process.env) {
  try {
    const offer = JSON.parse(env[INTEGRATIONS_ENV] ?? 'null');
    return offer && Array.isArray(offer.tools) ? offer : null;
  } catch {
    return null;
  }
}

/**
 * One proxy per offered tool. Each call asks hobkin over the agent's own bridge (`bridge.mjs`), which runs it in the
 * host, and the agent reads the text it gives back. A call the host says failed is a failed tool call. A call to a hooked
 * tool asks the host as it starts, which may refuse it with a reason or change its arguments, and as it ends, which may
 * change what the agent reads. A call to a tool nothing hooks never leaves this process.
 */
export function createIntegrationExtension(offer, { hookWaitMs = HOOK_WAIT_MS } = {}) {
  return pi => {
    const tools = offer?.tools ?? [];
    for (const { name, description, parameters } of tools) {
      pi.registerTool({
        name,
        label: name,
        description,
        parameters,
        async execute(id, params, signal, _update, ctx) {
          const { text, failed } = await callBridge(ctx, { op: 'integration_tool', name, id, params }, signal);
          if (failed) throw Error(text);
          return { content: [{ type: 'text', text }], details: {} };
        },
      });
    }
    if (tools.length) {
      pi.on('session_start', () => {
        const active = pi.getActiveTools();
        const missing = tools.map(tool => tool.name).filter(name => !active.includes(name));
        if (missing.length) pi.setActiveTools([...active, ...missing]);
      });
    }
    const hooked = offer?.hooked;
    if (hooked !== 'all' && !(Array.isArray(hooked) && hooked.length)) return;
    const hooks = name => hooked === 'all' || hooked.includes(name);
    // A host that fails, or has not answered in time, lets the call go on as it was: it decides its own refusals.
    const ask = async (ctx, request) => {
      try {
        return await callBridge(ctx, request, AbortSignal.any([AbortSignal.timeout(hookWaitMs), ...(ctx?.signal ? [ctx.signal] : [])]));
      } catch {
        return null;
      }
    };
    pi.on('tool_call', async (event, ctx) => {
      if (!hooks(event.toolName)) return undefined;
      const answer = await ask(ctx, { op: 'tool_before', id: event.toolCallId, name: event.toolName, args: event.input });
      if (typeof answer?.block === 'string') return { block: true, reason: answer.block };
      // Pi runs the call with this same object, so the new arguments go into it in place.
      if (plain(answer?.args) && plain(event.input)) {
        for (const key of Object.keys(event.input)) delete event.input[key];
        Object.assign(event.input, answer.args);
      }
      return undefined;
    });
    pi.on('tool_result', async (event, ctx) => {
      if (!hooks(event.toolName)) return undefined;
      const result = { text: textOf(event.content), failed: event.isError === true };
      const answer = await ask(ctx, { op: 'tool_after', id: event.toolCallId, name: event.toolName, args: event.input, result });
      const changed = {
        ...(typeof answer?.text === 'string' ? { content: [{ type: 'text', text: answer.text }] } : {}),
        ...(typeof answer?.failed === 'boolean' ? { isError: answer.failed } : {}),
      };
      return Object.keys(changed).length ? changed : undefined;
    });
  };
}

export default function hobkinIntegrations(pi) {
  createIntegrationExtension(readOffer())(pi);
}
