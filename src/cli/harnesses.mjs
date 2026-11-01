import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { validateBinding } from './schedules.mjs';
import { CHROME_GRANT, isChromeConsent, offersChrome } from './chrome.mjs';
import { piCommand, piEnvironment } from './launcher.mjs';
import { keptEffort } from './model-settings.mjs';
import { extensionArguments, extensionPaths } from './pi-extensions.mjs';
import { clean, startRpcProcess } from './rpc-process.mjs';

const workPurposes = ['work-discover', 'work-look', 'work-do'];
const usesTools = purpose => purpose === undefined || purpose === 'compatibility-check' || workPurposes.includes(purpose);
const prompt = name => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');
/** What a work run is told, for a harness that cannot take it as a system prompt. */
export const workDirections = purpose => `${prompt('background')}\n${prompt(purpose)}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validCost = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
// Pi's `agent_end` repeats a whole run, so a long run's biggest record comes when its work is done. Hobkin reads none of it.
const MAX_KEPT_RECORD_BYTES = 1048576;
const MAX_LEFT_OUT_BYTES = 268435456;
const completionGroup = Symbol('completion group');
const dialogMethods = new Set(['select', 'confirm', 'input', 'editor']);
// A grouped swarm suppresses member reports and answers once, through a wake.
const agentsStarted = ({ toolName, isError, result }) => {
  const details = result?.details;
  if (isError || !details) return [];
  if (toolName === 'spawn_agent') return [details.name];
  if (toolName !== 'spawn_swarm_agents') return [];
  const names = (details.spawned ?? []).map(agent => agent.name);
  return details.completionGroup && names.length ? [completionGroup] : names;
};

export function buildInvocation(request) {
  if (request.harness !== 'pi') throw Error('Execution requires an explicit Pi binding.');
  validateBinding(request);
  if (!uuid.test(request.id) || !isAbsolute(request.cwd ?? '') || typeof request.prompt !== 'string'
    || !request.prompt.trim() || Buffer.byteLength(request.prompt) > 65536) {
    throw Error('Invalid harness request identity, cwd or bounded prompt.');
  }
  if (request.purpose !== undefined && !['migration-repair', 'reflection', 'session-patterns', 'compatibility-check', ...workPurposes].includes(request.purpose)) {
    throw Error('Unsupported harness purpose.');
  }
  const isWork = workPurposes.includes(request.purpose);
  const noTools = !usesTools(request.purpose);
  const system = prompt(isWork ? 'background' : request.purpose ?? 'background');
  if (!isAbsolute(request.sessionFile ?? '')) throw Error('Pi requires an explicit job session file.');
  const args = [
    '--mode', 'rpc',
    '--session', request.sessionFile,
    '--thinking', request.effort,
    // Tool-enabled jobs keep Pi's normal prompt, tool guidance and extension guidelines.
    ...(noTools ? [
      '--no-tools',
      // Some managed Pi installations load required extensions and refuse --no-extensions.
      ...(request.launcher?.managedExtensions ? [] : ['--no-extensions']),
      '--no-skills', '--no-prompt-templates', '--no-themes',
      '--no-context-files', '--no-approve',
      '--system-prompt', system,
      // Nothing here can stop to ask, and a worktree is a new folder a saved trust decision would not reach.
    ] : [...extensionArguments(request.extensions), '--append-system-prompt', system, '--approve']),
    ...(isWork ? ['--append-system-prompt', prompt(request.purpose)] : []),
  ];
  if (request.model) args.push('--model', request.model);
  return piCommand(request.launcher, args);
}

/** A job that loads tools gets its extensions named up front, so Pi leaves out what Hobkin does not use. */
export const namingExtensions = run => async (request, options) => {
  if (!usesTools(request.purpose)) return run(request, options);
  return run({ ...request, extensions: await extensionPaths(request.cwd) }, options);
};

/** The caller persists admission before invoking this function. It never retries a child; only its signal stops one. */
export async function runHarness(request, { spawnProcess = spawn, maxOutputBytes = MAX_LEFT_OUT_BYTES, onEvent = () => {}, onReady = () => {} } = {}) {
  const invocation = buildInvocation(request);
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1) throw Error('Invalid harness bounds.');
  const result = {
    id: request.id,
    harness: 'pi',
    status: 'failed',
    text: '',
    cost: null,
    model: request.model,
    effort: request.effort,
    sessionId: null,
    freshSession: !existsSync(request.sessionFile),
  };
  if (request.signal?.aborted) return { ...result, status: 'interrupted', error: 'Cancelled before dispatch.' };

  const settled = Promise.withResolvers();
  settled.promise.catch(() => {});
  let child;
  let assistant;
  // Agents live in this child and report as later turns, so a settled lead may not be finished.
  const agents = new Set();
  const extensionErrors = new Set();
  let takesMessages = false;
  const accept = record => {
    // Nobody is watching a job, so a dialog from any extension is declined. Chrome's the user allowed for every run.
    if (record.type === 'extension_ui_request' && dialogMethods.has(record.method)) {
      const answer = isChromeConsent(record) ? { confirmed: true } : { cancelled: true };
      child.send({ type: 'extension_ui_response', id: record.id, ...answer });
    }
    if (record.type === 'message_end' && record.message?.role === 'assistant') {
      assistant = record.message;
      result.text = clean(assistant.content?.filter(part => part.type === 'text').map(part => part.text).join('\n'));
    }
    if (record.type === 'tool_execution_end') {
      for (const agent of agentsStarted(record)) agents.add(agent);
    }
    if (record.type === 'message_end' && record.message?.customType === 'pi-extended-teams-report') {
      agents.delete(record.message.details?.name);
    }
    if (record.type === 'message_end' && record.message?.customType === 'pi-extended-teams-wake') {
      agents.delete(completionGroup);
    }
    // A side extension's bug says nothing about the work, so it goes in the report instead of ending the run.
    if (record.type === 'extension_error') {
      extensionErrors.add(clean(`${record.extensionPath ?? 'An extension'} (${record.event ?? 'event'}): ${record.error ?? 'handler failed'}`));
    }
    if (record.type === 'agent_settled') {
      if (record.aborted === true) child.fail(Object.assign(Error('Pi agent run was aborted.'), { interrupted: true }));
      else if (!agents.size) {
        takesMessages = false;
        settled.resolve();
      }
    }
    onEvent(record);
  };
  try {
    child = startRpcProcess({
      ...invocation,
      cwd: request.cwd,
      env: piEnvironment(request.launcher),
      spawnProcess,
      maxRecordBytes: maxOutputBytes,
      maxKeptBytes: Math.min(maxOutputBytes, MAX_KEPT_RECORD_BYTES),
      onRecord: accept,
      onFail: error => settled.reject(error),
    });
  } catch (error) {
    return { ...result, error: clean(error.message) };
  }
  child.closed.then(({ error }) => settled.reject(error));

  const cancel = () => child.fail(Object.assign(Error('Harness cancelled.'), { interrupted: true }));
  request.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const state = await child.request('get_state');
    const effortHeld = workPurposes.includes(request.purpose)
      ? keptEffort(state?.model, request.effort, state?.thinkingLevel)
      : state?.thinkingLevel === request.effort;
    if (!state?.sessionId || !effortHeld) {
      throw Error('Pi did not retain the requested effort; no prompt was submitted.');
    }
    const model = state.model && `${state.model.provider}/${state.model.id}`;
    if (!model || (request.model?.includes('/') && request.model !== model)) {
      throw Error('Pi did not retain the requested model; no prompt was submitted.');
    }
    result.sessionId = state.sessionId;
    result.model = model;
    if (usesTools(request.purpose)) {
      const { commands } = await child.request('get_commands');
      if (offersChrome(commands)) await child.request('prompt', { message: CHROME_GRANT });
    }
    const response = await child.request('prompt', { message: request.prompt });
    if (response?.disposition === 'handled') {
      throw Error('Pi handled the prompt without starting an assistant response.');
    }
    takesMessages = true;
    // A plain steer would sit unread while the lead waits on its agents, so this also starts a turn on an idle one.
    onReady(async message => {
      if (!takesMessages) throw Error('That check has finished.');
      await child.request('prompt', { message, streamingBehavior: 'steer' });
    });
    await settled.promise;
    result.text = clean(assistant?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n'));
    if (assistant?.stopReason !== 'stop' || !result.text.trim()) {
      throw Error(`Pi did not finish a response (${assistant?.stopReason ?? 'missing'}).`);
    }
    if (extensionErrors.size) {
      const noted = [...extensionErrors].map(error => `- ${error}`).join('\n');
      result.text += `\n\n---\n\n**Extension errors during this run:**\n${noted}`;
    }
    let stats;
    let statsUnavailable = false;
    try {
      stats = await child.request('get_session_stats');
    } catch (error) {
      if (!error.commandRejected || child.failure || child.exited) throw error;
      statsUnavailable = true;
    }
    if (!statsUnavailable && stats?.sessionId !== state.sessionId) {
      throw Error('Pi session identity changed during the job.');
    }
    if (validCost(stats?.cost)) {
      result.cost = { usd: stats.cost, kind: 'estimate', cumulative: true, sessionId: state.sessionId };
    }
    result.status = 'completed';
    child.terminate();
    await child.closed;
  } catch (error) {
    result.status = (child.failure ?? error).interrupted ? 'interrupted' : 'failed';
    result.error = clean((child.failure ?? error).message).slice(0, 2000);
  } finally {
    takesMessages = false;
    request.signal?.removeEventListener('abort', cancel);
    child.terminate();
    await child.closed;
  }
  return result;
}
