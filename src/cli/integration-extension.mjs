import { fileURLToPath } from 'node:url';
import { callBridge } from './bridge.mjs';

/**
 * The path hobkin loads with `--extension` into a Pi agent that an integration offers tools to (`namingExtensions` in
 * `harnesses.mjs`, 065-integration-drops). What it registers comes from this variable, which hobkin sets for that agent
 * alone: `{ tools: [{ name, description, parameters }] }`.
 */
export const integrationExtension = fileURLToPath(import.meta.url);
export const INTEGRATIONS_ENV = 'HOBKIN_INTEGRATIONS';

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
 * host, and the agent reads the text it gives back. A call the host says failed is a failed tool call.
 */
export function createIntegrationExtension(offer) {
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
  };
}

export default function hobkinIntegrations(pi) {
  createIntegrationExtension(readOffer())(pi);
}
