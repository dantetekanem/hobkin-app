import { INTEGRATIONS_ENV } from './integration-extension.mjs';

/**
 * What hobkin's application is handed as `integrations` (065-integration-drops), turned into what one agent is given
 * and answered for it. The option is the host's: the tools it offers agents and a call to run one, and the tool calls it
 * hooks with a call before and after each. An agent kind is `main` (the main conversation), `runs` (routines, Work,
 * sessions) or `durable` (a durable hobkin's turns). With no option, or nothing offered to that kind and nothing hooked,
 * the agent is given nothing and loads nothing new.
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
// Any tool an agent may call can be hooked, an MCP server's included.
const HOOKED_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const HOOK_OPS = ['tool_before', 'tool_after'];
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

/** The tool names the host hooks, `all` for every tool, or null for none. A name that cannot be a tool's is left out. */
function hookedOf(integrations) {
  const hooked = asked(() => integrations.hookedTools?.());
  if (hooked === 'all') return 'all';
  const names = [...new Set((Array.isArray(hooked) ? hooked : []).filter(name => typeof name === 'string' && HOOKED_NAME.test(name)))];
  return names.length ? names : null;
}

/** Whether the host hooks calls to this tool for an agent given this offer. */
const hooks = (offer, name) => offer?.hooked === 'all' || (Array.isArray(offer?.hooked) && offer.hooked.includes(name));

/**
 * What one kind of agent is given: `{ tools, hooked? }`, or null when it is given no tool and nothing is hooked. A tool
 * that names no agents goes to all three. `only` names the tools a workflow's run is given instead, whatever agents they
 * name. A tool that is not well formed is left out, and so are the last ones when they would not fit in one environment
 * variable. `hooked` is every agent's alike: the names whose calls the host hears before and after, or `all`.
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
  const hooked = hookedOf(integrations);
  while (tools.length && Buffer.byteLength(JSON.stringify({ tools, hooked })) > MOST_OFFER_BYTES) tools.pop();
  if (!tools.length && !hooked) return null;
  return hooked ? { tools, hooked } : { tools };
}

/** The variable a Pi agent reads its offer from (`integration-extension.mjs`). */
export const integrationEnvironment = offer => ({ [INTEGRATIONS_ENV]: JSON.stringify(offer) });

/** Whether a bridge request is one of an integration's, which `serveIntegration` answers. */
export function isIntegrationCall(placeholder) {
  try {
    const op = JSON.parse(placeholder)?.op;
    return op === 'integration_tool' || HOOK_OPS.includes(op);
  } catch {
    return false;
  }
}

/** What a `before` hook may answer: a refusal with its reason, or the arguments the call runs with instead. */
function beforeAnswer(answer) {
  if (typeof answer?.block === 'string' && answer.block.trim()) return { block: answer.block };
  return plain(answer?.args) ? { args: answer.args } : null;
}

/** What an `after` hook may answer: the text the agent reads instead, and whether the call failed. */
function afterAnswer(answer) {
  const changed = {
    ...(typeof answer?.text === 'string' ? { text: answer.text } : {}),
    ...(typeof answer?.failed === 'boolean' ? { failed: answer.failed } : {}),
  };
  return Object.keys(changed).length ? changed : null;
}

/**
 * Answers an agent's bridge request for an integration. `host` is the application's `integrations` option, `offer` what
 * this agent was given, and `agent` its name in the host (`MAIN_AGENT` or its run's id). A call of a tool it was offered
 * runs in the host, by `host.callTool(name, args, { agent, id }, signal)`, and its `{ text, failed }` goes back. A call
 * to a hooked tool is heard by `host.beforeTool({ agent, id, name, args })` as it starts, which may answer
 * `{ block: reason }` or `{ args }`, and by `host.afterTool(call, { text, failed })` as it ends, which may answer
 * `{ text, failed }`. Anything else is refused.
 */
export async function serveIntegration(placeholder, { host, offer, agent }, signal) {
  try {
    if (typeof placeholder !== 'string' || Buffer.byteLength(placeholder) > MAX_REQUEST_BYTES) throw Error('Invalid bridge request.');
    const request = JSON.parse(placeholder);
    if (HOOK_OPS.includes(request?.op)) return { ok: true, result: await hookAnswer(request, { host, offer, agent }) };
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

/** A hook's answer for a call to a tool this agent's offer hooks. */
async function hookAnswer(request, { host, offer, agent }) {
  if (typeof request.id !== 'string' || !request.id || request.id.length > 200 || !hooks(offer, request.name)) throw Error('Invalid bridge request.');
  const call = { agent, id: request.id, name: request.name, args: request.args };
  if (request.op === 'tool_before') return beforeAnswer(await host?.beforeTool?.(call));
  const result = { text: typeof request.result?.text === 'string' ? request.result.text : '', failed: request.result?.failed === true };
  return afterAnswer(await host?.afterTool?.(call, result));
}
