import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { validateBinding } from './schedules.mjs';
import { piCommand, piEnvironment } from './launcher.mjs';
import { keptEffort } from './model-settings.mjs';
import { extensionArguments, extensionPaths } from './pi-extensions.mjs';
import { clean, startRpcProcess } from './rpc-process.mjs';
import { createTurnMetrics } from './turn-metrics.mjs';
import { BRIDGE, serveBridge } from './bridge.mjs';
import { createOwnedAgentSessionTool } from './owned-agent-tool.mjs';
import { assertPromptBytes, promptByteLimit } from './prompt-bounds.mjs';
import { recordEvent } from './events.mjs';
import { promptFactsIn } from './work/usage.mjs';

const workPurposes = ['work-discover', 'work-look', 'work-do'];
// A durable hobkin's turn works like a delegated job, with its own directions in place of a check's.
const usesTools = purpose => purpose === undefined || purpose === 'compatibility-check' || purpose === 'durable' || workPurposes.includes(purpose);
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
  const maxPromptBytes = promptByteLimit();
  if (request.harness !== 'pi') throw Error('Execution requires an explicit Pi binding.');
  validateBinding(request);
  // A request to start a conversation's process ahead of its turn (`warm`) has no words yet.
  const warm = request.warm === true;
  if (!uuid.test(request.id) || !isAbsolute(request.cwd ?? '')
    || (!warm && (typeof request.prompt !== 'string' || !request.prompt.trim()))) {
    throw Error('Invalid harness request identity, cwd or bounded prompt.');
  }
  if (!warm) assertPromptBytes(request.prompt, maxPromptBytes, 'harness prompt');
  if (request.purpose !== undefined && !['migration-repair', 'reflection', 'session-patterns', 'compatibility-check', 'humanizer', 'durable', ...workPurposes].includes(request.purpose)) {
    throw Error('Unsupported harness purpose.');
  }
  const durable = request.purpose === 'durable';
  if (warm && !durable) throw Error('Only a durable conversation starts its process ahead of a turn.');
  if (durable && request.directions !== undefined && (typeof request.directions !== 'string' || !request.directions.trim())) {
    throw Error('Invalid durable directions.');
  }
  const isWork = workPurposes.includes(request.purpose);
  const noTools = !usesTools(request.purpose);
  const system = durable ? request.directions ?? prompt('durable') : prompt(isWork ? 'background' : request.purpose ?? 'background');
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
    ] : [
      ...extensionArguments(request.extensions), '--append-system-prompt', system,
      // Work keeps the launcher's normal project-trust decision.
      ...(isWork ? [] : ['--approve']),
    ]),
    ...(isWork ? ['--append-system-prompt', prompt(request.purpose)] : []),
  ];
  if (request.model) args.push('--model', request.model);
  return piCommand(request.launcher, args);
}

/** A job that loads tools gets its extensions named up front, so Pi leaves out what Hobkin does not use. */
export const namingExtensions = run => async (request, options) => {
  if (!usesTools(request.purpose)) return run(request, options);
  const asked = Date.now();
  const extensions = await extensionPaths(request.cwd);
  // Naming them comes before the process starts, so the turn's stages show how long it took.
  const turn = { since: asked, origin: 'run', ...options?.turn, marks: { ...options?.turn?.marks, resolved: Date.now() } };
  return run({ ...request, extensions }, { ...options, turn });
};

// A durable hobkin's Pi process stays up after a turn that ended well, so the next turn of that conversation only prompts
// it. Each is kept by its conversation file, and goes after this long without a turn or when more are kept than this.
const KEPT_IDLE_MS = 600000;
const MOST_KEPT = 4;
const keptProcesses = new Map();
// Kept processes still exiting, by conversation file, so a new one for that file starts only once the old one is gone.
const closingProcesses = new Map();
// Processes being started ahead of a turn (`startAhead`), by conversation file: when each is settled, and how to stop it.
const startingAhead = new Map();
// One that has not answered by then is closed. Nobody waits on it, so nothing else would end it.
const START_AHEAD_LIMIT_MS = 60000;

/** Records that come while no turn holds a kept process reach no turn, and a dialog is declined as it is in a turn. */
const between = child => record => {
  if (record.type === 'extension_ui_request' && dialogMethods.has(record.method)) child.send({ type: 'extension_ui_response', id: record.id, cancelled: true });
};

/** Whether a kept process is one this request can use: started with exactly this, and still up. */
const usable = (kept, key) => kept?.key === key && !kept.child.failure && !kept.child.exited;

/**
 * Starts a Pi process whose records and failures go to `lane`, which whoever holds the process fills in: a turn while
 * it runs, and `between` while the process is kept.
 */
function startOnLane(lane, { invocation, cwd, env, startProcess, spawnProcess, maxOutputBytes }) {
  const child = startProcess({
    ...invocation,
    cwd,
    env,
    spawnProcess,
    maxRecordBytes: maxOutputBytes,
    maxKeptBytes: Math.min(maxOutputBytes, MAX_KEPT_RECORD_BYTES),
    onRecord: record => lane.accept(record),
    onFail: error => lane.fail(error),
  });
  child.closed.then(({ error }) => lane.fail(error));
  return child;
}

/** Closes the process kept for this conversation file now, if one is kept. The promise is for its exit, or that of one closed before. */
function closeNow(sessionFile) {
  const kept = keptProcesses.get(sessionFile);
  if (kept) {
    keptProcesses.delete(sessionFile);
    clearTimeout(kept.timer);
    kept.child.terminate();
    const closed = kept.child.closed.then(() => {
      if (closingProcesses.get(sessionFile) === closed) closingProcesses.delete(sessionFile);
    });
    closingProcesses.set(sessionFile, closed);
  }
  return closingProcesses.get(sessionFile);
}

/**
 * Closes the process kept for this conversation file, if one is kept, and stops one still starting ahead of a turn.
 * It resolves once that process, or one closed before, has exited.
 */
export async function closeKept(sessionFile) {
  const starting = startingAhead.get(sessionFile);
  if (starting) {
    starting.stop();
    await starting.settled;
  }
  await closeNow(sessionFile);
}

/**
 * The kept process a turn takes: one started with exactly what this turn would start its own with. One still starting
 * ahead is waited for. Any other kept for the conversation has exited before this resolves, so two processes never
 * share the file. A process a turn holds is never kept.
 */
async function takeKept(sessionFile, key, onReplaced) {
  await startingAhead.get(sessionFile)?.settled;
  const kept = keptProcesses.get(sessionFile);
  if (usable(kept, key)) {
    keptProcesses.delete(sessionFile);
    clearTimeout(kept.timer);
    return kept;
  }
  if (kept && kept.key !== key) onReplaced?.(keptDifference(kept.key, key));
  await closeNow(sessionFile);
}

/**
 * What differs between what a kept process was started with and what a turn would start its own with, so a process
 * that is replaced on every turn can be explained: the flags whose arguments changed and the names of the environment
 * variables that changed, never a value.
 */
export function keptDifference(keptKey, wantedKey) {
  const [command, args, cwd, env] = JSON.parse(keptKey);
  const [wantedCommand, wantedArgs, wantedCwd, wantedEnv] = JSON.parse(wantedKey);
  // An argument is named by the flag before it, so a changed model reads as `--model`.
  const flagBefore = (list, at) => list.slice(0, at + 1).findLast(arg => String(arg).startsWith('--'));
  const flags = [];
  for (let at = 0; at < Math.max(args.length, wantedArgs.length); at++) {
    if (args[at] !== wantedArgs[at]) flags.push(flagBefore(wantedArgs, at) ?? flagBefore(args, at) ?? `#${at}`);
  }
  const names = new Set([...Object.keys(env), ...Object.keys(wantedEnv)]);
  return {
    command: command !== wantedCommand,
    cwd: cwd !== wantedCwd,
    args: [...new Set(flags)].slice(0, 20),
    env: [...names].filter(name => env[name] !== wantedEnv[name]).sort().slice(0, 40),
  };
}

/** Keeps a process after its turn. One that exits on its own is forgotten, and past the most kept the one idle longest goes. */
function keep(sessionFile, kept, idleMs) {
  Object.assign(kept.lane, { accept: between(kept.child), fail: () => {} });
  void closeNow(sessionFile);
  kept.timer = setTimeout(() => void closeNow(sessionFile), idleMs);
  kept.timer.unref();
  keptProcesses.set(sessionFile, kept);
  kept.child.closed.then(() => {
    if (keptProcesses.get(sessionFile) !== kept) return;
    keptProcesses.delete(sessionFile);
    clearTimeout(kept.timer);
  });
  if (keptProcesses.size > MOST_KEPT) void closeNow(keptProcesses.keys().next().value);
}

/** The model a started process is on, once it is seen to hold the thinking level and the model that were asked for. */
function heldModel(request, state) {
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
  return model;
}

/**
 * Starts a durable conversation's process ahead of its next turn and keeps it, so that turn only prompts it
 * (`warm: true` on the request). One already kept with the same start is left alone, and a second request while one
 * starts gets the first one's answer. A turn that comes while it starts waits for it (`takeKept`). The caller asks only
 * while no turn of the conversation runs.
 */
function startAhead(request, context) {
  const { sessionFile } = request;
  const already = startingAhead.get(sessionFile);
  if (already) return already.settled;

  const kept = keptProcesses.get(sessionFile);
  if (usable(kept, context.key)) {
    const model = heldModel(request, kept.state);
    return Promise.resolve({ ...context.result, status: 'warmed', sessionId: kept.state.sessionId, model });
  }

  // `stop` reaches it wherever it has got to: before its process exists, or while that process is asked for its state.
  const starting = {
    stopped: false,
    child: undefined,
    stop() {
      this.stopped = true;
      this.child?.terminate();
    },
  };
  starting.settled = startAndKeep(request, context, starting).finally(() => {
    if (startingAhead.get(sessionFile) === starting) startingAhead.delete(sessionFile);
  });
  startingAhead.set(sessionFile, starting);
  return starting.settled;
}

/**
 * The work of `startAhead`: the process is started, checked as a turn checks its own, and kept. Nothing is asked of the
 * model. One that fails its start or its check, is stopped meanwhile or does not answer in time is closed and not kept,
 * and the turn then starts its own.
 */
async function startAndKeep(request, { invocation, env, key, result, startProcess, spawnProcess, maxOutputBytes, keepIdleMs, metricsRoot }, starting) {
  const { sessionFile } = request;
  const began = Date.now();
  await closeNow(sessionFile);
  if (starting.stopped) return { ...result, error: 'Closed before it started.' };

  const lane = { accept: () => {}, fail: () => {} };
  let child;
  try {
    child = startOnLane(lane, { invocation, cwd: request.cwd, env, startProcess, spawnProcess, maxOutputBytes });
  } catch (error) {
    return { ...result, error: clean(error.message) };
  }
  starting.child = child;
  lane.accept = between(child);
  const limit = setTimeout(() => child.terminate(), START_AHEAD_LIMIT_MS);
  limit.unref();

  try {
    const state = await child.request('get_state');
    const model = heldModel(request, state);
    if (starting.stopped) throw Error('Closed before its turn.');

    keep(sessionFile, { child, key, state, lane }, keepIdleMs);
    if (metricsRoot) recordEvent(metricsRoot, 'kept_process_warmed', { id: request.id, ms: Date.now() - began });
    return { ...result, status: 'warmed', sessionId: state.sessionId, model };
  } catch (error) {
    child.terminate();
    await child.closed;
    return { ...result, error: clean((child.failure ?? error).message).slice(0, 2000) };
  } finally {
    clearTimeout(limit);
  }
}

/** The caller persists admission before invoking this function. It never retries a child; only its signal stops one. */
export async function runHarness(request, { spawnProcess = spawn, startProcess = startRpcProcess, maxOutputBytes = MAX_LEFT_OUT_BYTES, onEvent = () => {}, onReady = () => {}, onControl = () => {}, metricsRoot, ownedScope, turn, keepIdleMs = KEPT_IDLE_MS } = {}) {
  // Before anything else, so a turn nobody timed still counts its process start.
  const entered = Date.now();
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
  const durable = request.purpose === 'durable';
  // What hobkin gives this run's own process, such as a durable hobkin's turn token (`hobkin-tell.mjs`).
  const env = { ...piEnvironment(request.launcher), ...request.env };
  // Everything a durable turn's process starts with. The conversation's next turn reuses it only when all of it is the same.
  const key = durable && JSON.stringify([invocation.command, invocation.args, request.cwd, env]);
  if (request.warm === true) {
    return startAhead(request, { invocation, env, key, result, startProcess, spawnProcess, maxOutputBytes, keepIdleMs, metricsRoot });
  }
  const reused = durable ? await takeKept(request.sessionFile, key, difference => {
    if (metricsRoot) recordEvent(metricsRoot, 'kept_process_replaced', { id: request.id, ...difference });
  }) : undefined;
  if (request.signal?.aborted) {
    reused?.child.terminate();
    await reused?.child.closed;
    return { ...result, status: 'interrupted', error: 'Cancelled before dispatch.' };
  }

  const settled = Promise.withResolvers();
  settled.promise.catch(() => {});
  let child;
  let spawned;
  let state;
  let promptFacts;
  // A durable turn hands out a handle of its own, which lets go of the process when the turn ends, so Stop and Force
  // reach only the turn in flight and never a process kept for the next one.
  const released = Promise.withResolvers();
  let holding = true;
  const lease = {
    closed: released.promise,
    force: () => { if (holding) child.force(); },
    terminate: () => { if (holding) child.terminate(); },
  };
  let assistant;
  let metrics;
  let metricIdentity;
  let streamingMessage;
  // Agents live in this child and report as later turns, so a settled lead may not be finished.
  const agents = new Set();
  const extensionErrors = new Set();
  let takesMessages = false, joining = false;
  const tools = { owned_agent: createOwnedAgentSessionTool((params, signal) => ownedScope.request(params, signal)) };
  const finishOwned = async () => {
    if (joining) return;
    joining = true;
    try {
      const facts = assistant?.stopReason === 'stop' ? await ownedScope?.join() : undefined;
      request.signal?.throwIfAborted();
      if (facts) { assistant = undefined; joining = false; await child.request('prompt', { message: facts }); }
      else { takesMessages = false; settled.resolve(); }
    } catch (error) { settled.reject(error); }
    finally { joining = false; }
  };
  const accept = record => {
    if (metrics) {
      // RPC strips cumulative message snapshots from deltas. Retain only the current request's scalar identity.
      if (record.type === 'message_start' && record.message?.role === 'assistant') {
        const { role, provider, model, timestamp, responseId } = record.message;
        streamingMessage = { role, provider, model, timestamp, responseId };
      }
      metrics.observe(record.type === 'message_update' ? { ...record, message: streamingMessage } : record, metricIdentity);
      if (record.type === 'message_end' && record.message?.role === 'assistant') streamingMessage = undefined;
    }
    // Nobody is watching a job, so a dialog from any extension is declined.
    if (record.type === 'extension_ui_request' && dialogMethods.has(record.method)) {
      if (record.method === 'input' && record.title === BRIDGE && ownedScope) {
        void serveBridge(record.placeholder, { tools }, request.signal).then(reply => child.send({ type: 'extension_ui_response', id: record.id, value: JSON.stringify(reply) })).catch(error => settled.reject(error));
      } else child.send({ type: 'extension_ui_response', id: record.id, cancelled: true });
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
      else if (!agents.size) void finishOwned();
    }
    // What the run's first model request was made of, from the usage extension. Only hashes and sizes are kept.
    promptFacts ??= promptFactsIn(record);
    onEvent(record);
  };
  // This run reads the process's records and failures while it runs. A kept process already has its lane.
  const lane = Object.assign(reused?.lane ?? {}, { accept, fail: error => settled.reject(error) });
  try {
    if (reused) child = reused.child;
    else {
      child = startOnLane(lane, { invocation, cwd: request.cwd, env, startProcess, spawnProcess, maxOutputBytes });
      spawned = Date.now();
    }
    if (durable) child.closed.then(released.resolve);
    onControl(durable ? lease : child);
  } catch (error) {
    child?.terminate();
    if (child) await child.closed;
    return { ...result, error: clean(error.message) };
  }

  const cancel = () => child.fail(Object.assign(Error('Harness cancelled.'), { interrupted: true }));
  request.signal?.addEventListener('abort', cancel, { once: true });
  try {
    // A kept process was checked when it started, and nothing it was started with has changed.
    state = reused?.state ?? await child.request('get_state');
    const model = heldModel(request, state);
    result.sessionId = state.sessionId;
    result.model = model;
    metricIdentity = Object.freeze({ runId: request.id, sessionId: state.sessionId });
    const kind = request.purpose === 'durable' ? 'durable' : workPurposes.includes(request.purpose) ? 'work' : 'other';
    metrics = createTurnMetrics({ ...metricIdentity, turn: { since: entered, origin: 'run', kind, ...turn,
      engine: 'pi', model, effort: request.effort, marks: { ...turn?.marks, ...(reused ? {} : { spawned, ready: Date.now() }) } } });
    const response = await child.request('prompt', { message: request.prompt });
    if (response?.disposition === 'handled') {
      throw Error('Pi handled the prompt without starting an assistant response.');
    }
    takesMessages = true;
    // A plain steer would sit unread while the lead waits on its agents, so this also starts a turn on an idle one.
    onReady(async message => {
      if (!takesMessages) throw Object.assign(Error('That check has finished.'), { notQueued: true });
      return child.request('prompt', { message, streamingBehavior: 'steer' });
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
    if (stats?.tokens) result.tokens = (stats.tokens.input ?? 0) + (stats.tokens.cacheWrite ?? 0) + (stats.tokens.output ?? 0);
    result.status = 'completed';
    if (!durable) {
      child.terminate();
      await child.closed;
    }
  } catch (error) {
    result.status = (child.failure ?? error).interrupted ? 'interrupted' : 'failed';
    result.error = clean((child.failure ?? error).message).slice(0, 2000);
  } finally {
    if (metrics) {
      result.performance = metrics.finish(metricIdentity);
      if (metricsRoot) metrics.record(metricsRoot, metricIdentity);
    }
    if (metricsRoot && promptFacts) recordEvent(metricsRoot, 'turn_prompt', { id: request.id, ...promptFacts });
    takesMessages = false;
    request.signal?.removeEventListener('abort', cancel);
    if (durable && result.status === 'completed' && !child.failure && !child.exited) {
      holding = false;
      released.resolve({ code: null, signal: null });
      keep(request.sessionFile, { child, key, state, lane }, keepIdleMs);
    } else {
      child.terminate();
      await child.closed;
    }
  }
  return result;
}
