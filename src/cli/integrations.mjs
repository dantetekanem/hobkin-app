import { INTEGRATIONS_ENV } from './integration-extension.mjs';

/**
 * What hobkin's application is handed as `integrations` (065-integration-drops), turned into what one agent is given
 * and answered for it. The option is the host's: the tools it offers agents and a call to run one. An agent kind is
 * `main` (the main conversation), `runs` (routines, Work, sessions) or `durable` (a durable hobkin's turns). With no
 * option, or nothing offered to that kind, the agent is given nothing and loads nothing new.
 */
export const AGENT_KINDS = Object.freeze(['main', 'runs', 'durable']);
/** The main conversation, as the host names it in a tool call. Any other agent is named by its run's id. */
export const MAIN_AGENT = '#main';
const WORK_PURPOSES = ['work-discover', 'work-look', 'work-do'];

/** The kind of agent a run's request starts: a durable hobkin's turn, a routine, session or Work run, or null for a run with no tools. */
export function agentKindOf(purpose) {
  if (purpose === 'durable') return 'durable';
  return purpose === undefined || WORK_PURPOSES.includes(purpose) ? 'runs' : null;
}

const TOOL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Pi's own tools and hobkin's, which an integration's tool may never stand in for. hobkin's own all start `hobkin_`.
const TAKEN = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'codemode', 'tool_search', 'ask_question', 'run_routine',
  'message_check', 'model_settings', 'stop_workload', 'owned_agent', 'client', 'custom_style']);
// It travels in one environment variable, which has to stay well inside what a process may be started with.
const MOST_OFFER_BYTES = 65536;
const MOST_DESCRIPTION = 4096;
const MAX_REQUEST_BYTES = 1048576;
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** What the host gives back from one of its calls, or undefined when it has no such call or the call throws. */
function asked(call) {
  try {
    return call?.();
  } catch {
    return undefined;
  }
}

/** One offered tool as an agent registers it, or null when it cannot be one. */
function offeredTool(tool, seen) {
  if (!plain(tool) || typeof tool.name !== 'string' || !TOOL_NAME.test(tool.name) || TAKEN.has(tool.name) || tool.name.startsWith('hobkin_')) return null;
  if (seen.has(tool.name) || typeof tool.description !== 'string' || !tool.description.trim() || tool.description.length > MOST_DESCRIPTION) return null;
  if (!plain(tool.parameters) || tool.parameters.type !== 'object') return null;
  let parameters;
  try {
    parameters = JSON.parse(JSON.stringify(tool.parameters));
  } catch {
    return null;
  }
  seen.add(tool.name);
  return { name: tool.name, description: tool.description, parameters };
}

/**
 * The tools one kind of agent is given, or null when it is given none. A tool that names no agents goes to all three.
 * `only` names the tools a workflow's run is given instead, whatever agents they name. A tool that is not well formed is
 * left out, and so are the last ones when they would not fit in one environment variable.
 */
export function integrationOffer(integrations, kind, { only } = {}) {
  if (!integrations) return null;
  const listed = asked(() => integrations.tools?.());
  const seen = new Set();
  const given = (Array.isArray(listed) ? listed : []).filter(tool => {
    if (only) return Array.isArray(only) && only.includes(tool?.name);
    return Array.isArray(tool?.agents) ? tool.agents.includes(kind) : AGENT_KINDS.includes(kind);
  });
  const tools = given.map(tool => offeredTool(tool, seen)).filter(Boolean);
  while (tools.length && Buffer.byteLength(JSON.stringify({ tools })) > MOST_OFFER_BYTES) tools.pop();
  return tools.length ? { tools } : null;
}

/** The variable a Pi agent reads its offer from (`integration-extension.mjs`). */
export const integrationEnvironment = offer => ({ [INTEGRATIONS_ENV]: JSON.stringify(offer) });

/** Whether a bridge request is one of an integration's, which `serveIntegration` answers. */
export function isIntegrationCall(placeholder) {
  try {
    return JSON.parse(placeholder)?.op === 'integration_tool';
  } catch {
    return false;
  }
}

/**
 * Answers an agent's bridge request for an integration. `host` is the application's `integrations` option, `offer` what
 * this agent was given, and `agent` its name in the host (`MAIN_AGENT` or its run's id). A call of a tool it was offered
 * runs in the host, by `host.callTool(name, args, { agent, id }, signal)`, and its `{ text, failed }` goes back. Anything
 * else is refused.
 */
export async function serveIntegration(placeholder, { host, offer, agent }, signal) {
  try {
    if (typeof placeholder !== 'string' || Buffer.byteLength(placeholder) > MAX_REQUEST_BYTES) throw Error('Invalid bridge request.');
    const request = JSON.parse(placeholder);
    if (request?.op !== 'integration_tool' || typeof request.id !== 'string' || !request.id || request.id.length > 200
      || !offer?.tools?.some(tool => tool.name === request.name) || !plain(request.params) || typeof host?.callTool !== 'function') {
      throw Error('Invalid bridge request.');
    }
    const answer = await host.callTool(request.name, request.params, { agent, id: request.id }, signal);
    if (typeof answer?.text !== 'string') throw Error(`${request.name} gave no text back.`);
    return { ok: true, result: { text: answer.text, failed: answer.failed === true } };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}
