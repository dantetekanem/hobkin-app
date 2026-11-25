import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { efforts, validateBinding } from './schedules.mjs';
import { piCommand, piEnvironment } from './launcher.mjs';
import { keptEffort } from './model-settings.mjs';
import { extensionArguments, extensionPaths, LEFT_OUT_WITH_MEMORIES } from './pi-extensions.mjs';
import { providerExtensionBinding } from './provider-extensions.mjs';
import { clean, startRpcProcess } from './rpc-process.mjs';
import { createTurnMetrics } from './turn-metrics.mjs';
import { BRIDGE, serveBridge } from './bridge.mjs';
import { createOwnedAgentSessionTool } from './owned-agent-tool.mjs';
import { assertPromptBytes, promptByteLimit } from './prompt-bounds.mjs';
import { recordEvent } from './events.mjs';
import { promptFactsIn } from './work/usage.mjs';
import { agentsOut, defaultTeamsDir } from './teams-agents.mjs';
import { AGENTS_ENVIRONMENT } from './agent-directions-extension.mjs';
import { codeToolGuardExtension } from './code-tool-crash.mjs';
import { askedWait, MOST_WAITS, PI_WAIT_TOOLS, piWaitNote, stoppedMidStep, WAITING } from './run-waits.mjs';
import { waitExtension } from './wait-extension.mjs';
import { doneExtension } from './done-extension.mjs';
import { scheduleExtension } from './schedule-extension.mjs';
import { agentScheduleTools, SCHEDULE_TOOLS } from './schedule-tools.mjs';
import { memoryExtension } from './memory-extension.mjs';
import { memoryKeeperExtension } from './memory-keeper-extension.mjs';
import { MEMORY_TOOLS, memoryTools } from './memory-tools.mjs';
import { integrationExtension } from './integration-extension.mjs';
import { loadSkillExtension } from './load-skill-extension.mjs';
import { integrationEnvironment, isIntegrationCall, serveIntegration } from './integrations.mjs';

const workPurposes = ['work-discover', 'work-look', 'work-do'];
// A durable hobkin's turn works like a delegated job, with its own directions in place of a check's.
// A goal's runs keep the purpose of the code runs, so tools, skills and limits are the same, and read their own prompt in its place.
const goalPrompts = { 'work-look': 'work-goal-look', 'work-do': 'work-goal-do' };

/** The prompt a work run reads: its purpose's own, or the goal prompt that stands in for that purpose. Null for any other prompt asked for. */
function workPromptOf({ purpose, workPrompt }) {
  if (workPrompt === undefined) return purpose;

  const standsInForPurpose = goalPrompts[purpose] === workPrompt;
  return standsInForPurpose ? workPrompt : null;
}
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
// While teams' files list agents out for an idle lead, they are read again this often, so one that stops beating
// without a report lets the run go once teams' own heartbeat staleness has passed.
const TEAMS_CHECK_MS = 15000;
const dialogMethods = new Set(['select', 'confirm', 'input', 'editor']);
// A grouped swarm suppresses member reports and answers through wakes. Its first wake lets go of it here; a group that
// wakes once per report still holds the run through teams' files (`finishUnlessOut`) while a member is out.
const agentsStarted = ({ toolName, isError, result }) => {
  const details = result?.details;
  if (isError || !details) return [];
  if (toolName === 'spawn_agent') return [details.name];
  if (toolName !== 'spawn_swarm_agents') return [];
  const names = (details.spawned ?? []).map(agent => agent.name);
  return details.completionGroup && names.length ? [completionGroup] : names;
};
/**
 * A call that reached the host over the run's bridge for one of hobkin's own `op`s, `hobkin_wait`'s (`wait-extension.mjs`)
 * or `hobkin_done`'s (`done-extension.mjs`), or null for any other request.
 */
const bridgeCall = (placeholder, op) => {
  try {
    const asked = JSON.parse(placeholder);
    return asked?.op === op ? asked : null;
  } catch {
    return null;
  }
};
/** A job that lives until its agent says it is done (072-jobs-live-until-done): one asked to, that was given `hobkin_done`. */
const livesUntilDone = request => request.untilDone === true && request.extensions?.includes(doneExtension) === true;
/** A call of `hobkin_schedule` or `hobkin_schedules` that reached the host over the run's bridge (`schedule-extension.mjs`). */
const isScheduleCall = placeholder => {
  try {
    const asked = JSON.parse(placeholder);
    return asked?.op === 'tool' && SCHEDULE_TOOLS.includes(asked.name);
  } catch {
    return false;
  }
};
/** A call of one of hobkin's memory tools that reached the host over the run's bridge (`memory-extension.mjs`, 057-shared-memory). */
const isMemoryCall = placeholder => {
  try {
    const asked = JSON.parse(placeholder);
    return asked?.op === 'tool' && MEMORY_TOOLS.includes(asked.name);
  } catch {
    return false;
  }
};
// The extension a run loads for hobkin's memories, by what its request asks: a run reads and suggests, a durable
// hobkin's turn reads and remembers (057-shared-memory).
const MEMORY_EXTENSIONS = { run: memoryExtension, keeper: memoryKeeperExtension };
// A run that waits on its schedules is started again once more this long after the last of them ends, should nothing
// have woken it by then (056-agent-schedules).
const SCHEDULES_GRACE_MS = 5 * 60000;
/** The tools an assistant reply called, by name. */
const toolCallNames = message => (Array.isArray(message?.content) ? message.content : [])
  .filter(part => part?.type === 'toolCall' && typeof part.name === 'string').map(part => part.name);

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
  if (request.purpose !== undefined && !['migration-repair', 'reflection', 'session-patterns', 'compatibility-check', 'humanizer', 'short-report', 'catch-up', 'durable', ...workPurposes].includes(request.purpose)) {
    throw Error('Unsupported harness purpose.');
  }
  if (workPromptOf(request) === null) throw Error('Unsupported work prompt.');
  const durable = request.purpose === 'durable';
  if (warm && !durable) throw Error('Only a durable conversation starts its process ahead of a turn.');
  if (durable && request.directions !== undefined && (typeof request.directions !== 'string' || !request.directions.trim())) {
    throw Error('Invalid durable directions.');
  }
  const isWork = workPurposes.includes(request.purpose);
  const noTools = !usesTools(request.purpose);
  const lives = livesUntilDone(request);
  if (lives && request.purpose !== undefined) throw Error('Only a job of its own lives until it is done.');
  // A living job reads its own short prompt (072-jobs-live-until-done), never the routines' one.
  const system = durable ? request.directions ?? prompt('durable') : prompt(lives ? 'session-job' : isWork ? 'background' : request.purpose ?? 'background');
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
    ...(isWork ? ['--append-system-prompt', prompt(workPromptOf(request))] : []),
  ];
  if (!request.launcher) args.push(...providerExtensionBinding(request.providerExtensions, request.model, noTools ? [] : request.extensions).args);
  if (request.model) args.push('--model', request.model);
  return piCommand(request.launcher, args);
}

/**
 * A job that loads tools gets its extensions named up front, so Pi leaves out what Hobkin does not use. Its Pi also
 * loads `load_skill` (`load-skill-extension.mjs`, 070-load-skill) ahead of the rest, so an extension that sets the
 * whole prompt keeps the list of skills it words, and hobkin's guard against the code tool crash (`code-tool-crash.mjs`).
 * A job that lives until its agent says it is done (`untilDone` on its request) gets `hobkin_done` (`done-extension.mjs`,
 * 072-jobs-live-until-done), and one that keeps schedules (`schedules` on its request) gets `hobkin_schedule` and
 * `hobkin_schedules` (`schedule-extension.mjs`) in place of the Pi scheduler, whose timers would live only in this
 * process (056-agent-schedules). One that reads hobkin's memories (`memories` on its request: `run`
 * or `keeper`) gets their tools (057-shared-memory). One that integrations offer tools to (`options.integrations.offer`)
 * gets them, with its offer in its environment (`integration-extension.mjs`, 065-integration-drops).
 */
export const namingExtensions = run => async (request, options) => {
  if (!usesTools(request.purpose)) return run(request, options);
  const asked = Date.now();
  const schedules = request.schedules === true;
  const memories = Object.hasOwn(MEMORY_EXTENSIONS, request.memories ?? '') ? MEMORY_EXTENSIONS[request.memories] : null;
  const offer = options?.integrations?.offer;
  const leaveOut = [...(schedules ? ['pi-scheduler'] : []), ...(memories ? LEFT_OUT_WITH_MEMORIES : [])];
  const extensions = [loadSkillExtension, ...await extensionPaths(request.cwd, { leaveOut }), codeToolGuardExtension,
    ...(request.untilDone === true ? [doneExtension] : []), ...(schedules ? [scheduleExtension] : []), ...(memories ? [memories] : []),
    ...(offer ? [integrationExtension] : [])];
  // Naming them comes before the process starts, so the turn's stages show how long it took.
  const turn = { since: asked, origin: 'run', ...options?.turn, marks: { ...options?.turn?.marks, resolved: Date.now() } };
  const offered = offer ? { env: { ...request.env, ...integrationEnvironment(offer) } } : {};
  return run({ ...request, extensions, ...offered }, { ...options, turn });
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

/**
 * A change to a working agent's model or thinking level, checked before anything is sent: a full provider/model, one of
 * Pi's thinking levels, or both. Answers with only what it names.
 */
export function bindingChange({ model, effort } = {}) {
  if (model === undefined && effort === undefined) throw Error('Say what to change: a model, a thinking level or both.');
  if (model !== undefined && (typeof model !== 'string' || !/^[^/\s-][^/\s]*\/\S+$/.test(model) || model.length > 200)) {
    throw Error('A Pi model is named as provider/model.');
  }
  if (effort !== undefined && !efforts.pi.includes(effort)) throw Error(`A thinking level is one of ${efforts.pi.join(', ')}.`);
  return { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) };
}

/** Pi's own setters for only what the change names, then what Pi holds now. Pi takes it from its next model call. */
async function changeOn(child, change) {
  const { model, effort } = bindingChange(change);
  if (model !== undefined) {
    const slash = model.indexOf('/');
    await child.request('set_model', { provider: model.slice(0, slash), modelId: model.slice(slash + 1) });
  }
  if (effort !== undefined) await child.request('set_thinking_level', { level: effort });
  const state = await child.request('get_state');
  return { model: state?.model ? `${state.model.provider}/${state.model.id}` : null, effort: state?.thinkingLevel ?? null };
}

/**
 * What Pi offers this process's session as slash commands, as its `get_commands` lists them: extension commands, prompt
 * templates and skills (`skill:name`). Asking only reads; a command runs when its text is prompted.
 */
async function commandsOn(child) {
  return (await child.request('get_commands'))?.commands ?? [];
}

/**
 * The commands of a conversation that waits between turns, from the process kept for its next turn, or null when none
 * is kept. One still starting ahead of the turn is waited for. The process stays kept.
 */
export async function keptCommands(sessionFile) {
  await startingAhead.get(sessionFile)?.settled;
  const kept = keptProcesses.get(sessionFile);
  return kept ? commandsOn(kept.child) : null;
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

/** A kept process asked for again stays another idle time, and counts as the one used last. */
function keepAgain(sessionFile, kept, idleMs) {
  clearTimeout(kept.timer);
  kept.timer = setTimeout(() => void closeNow(sessionFile), idleMs);
  kept.timer.unref();
  keptProcesses.delete(sessionFile);
  keptProcesses.set(sessionFile, kept);
}

/**
 * Starts a durable conversation's process ahead of its next turn and keeps it, so that turn only prompts it
 * (`warm: true` on the request). One already kept with the same start is kept again, its idle time starting over and nothing
 * asked of it, and a second request while one
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
    keepAgain(sessionFile, kept, context.keepIdleMs);
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
export async function runHarness(request, { spawnProcess = spawn, startProcess = startRpcProcess, maxOutputBytes = MAX_LEFT_OUT_BYTES, onEvent = () => {}, onReady = () => {}, onIdle = () => {}, onWoken = () => {}, onControl = () => {}, metricsRoot, ownedScope, schedules, memories, integrations, turn, keepIdleMs = KEPT_IDLE_MS, teamsDir = defaultTeamsDir(), teamsCheckMs = TEAMS_CHECK_MS, now = Date.now } = {}) {
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
  // What hobkin gives this run's own process, such as a durable hobkin's turn token (`hobkin-tell.mjs`), and what has
  // every agent the run spawns follow the user's directions (`agent-directions-extension.mjs`).
  const providerEnv = request.launcher ? {} : providerExtensionBinding(request.providerExtensions, request.model, usesTools(request.purpose) ? request.extensions : []).env;
  const env = { ...piEnvironment(request.launcher), ...AGENTS_ENVIRONMENT, ...request.env, ...providerEnv };
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
    changeBinding: change => (holding ? changeOn(child, change) : Promise.reject(Error('Its turn has ended.'))),
    commands: () => (holding ? commandsOn(child) : Promise.reject(Error('Its turn has ended.'))),
  };
  let assistant;
  let metrics;
  let metricIdentity;
  let streamingMessage;
  // Agents live in this child and report as later turns, so a settled lead may not be finished.
  const agents = new Set();
  // A turn that starts or settles makes a read of teams' files begun before it stale.
  let turns = 0, recheck;
  const extensionErrors = new Set();
  let takesMessages = false, joining = false;
  // A run that can wait (053-run-waits): what the turn asked with `hobkin_wait`, the tools its last reply called, and
  // whether it was told once that Pi's own waits cannot wake it here. Only a run given the tool is told to use it.
  let waitAsked, calledLast = new Set(), toldPiWait = false;
  const canWait = Number.isInteger(request.waits) && request.extensions?.includes(waitExtension) === true;
  const answerWait = asked => {
    const { wait, text, refused } = askedWait(asked, { now: now(), waits: request.waits, agentsOut: agents.size });
    if (refused) return { ok: false, error: refused };
    waitAsked = wait;
    return { ok: true, result: { text, ...wait } };
  };
  // A job that lives until its agent says it is done (072-jobs-live-until-done): a turn that ends well leaves its process
  // up, idle and taking messages (`idle`), and only `hobkin_done` or a stop ends it. `done` is the report that call gave.
  const untilDone = livesUntilDone(request);
  let done, idle = false;
  const answerDone = ({ report }) => {
    if (!untilDone) return { ok: false, error: 'This run ends when its turn ends, so end it with your report.' };
    if (typeof report !== 'string' || !report.trim()) return { ok: false, error: 'Give your report: what you did, what you found and what is left.' };
    if (agents.size) {
      return { ok: false, error: "Your agents are still working, and they live in this job's process, so ending it now would stop them. Their reports come to you here: call hobkin_done once they have reported." };
    }
    done = clean(report).trim();
    return { ok: true, result: { text: 'hobkin ends this job with your report as soon as this turn ends. End your turn now.' } };
  };
  // Pi's own waits wake it inside its process, which a living job keeps.
  const calledPiWait = () => assistant?.stopReason === 'toolUse' && [...calledLast].some(name => PI_WAIT_TOOLS.includes(name));
  const livesOn = () => untilDone && done === undefined && (assistant?.stopReason === 'stop' || calledPiWait());
  const tools = { owned_agent: createOwnedAgentSessionTool((params, signal) => ownedScope.request(params, signal)) };
  // The run's own schedules (056-agent-schedules), which hobkin hands it as `{ make, manage, liveUntil }` when it keeps
  // them for this run's agent. Without them a call is refused in plain words.
  const scheduleTools = agentScheduleTools(schedules);
  const schedulesUntil = () => {
    try {
      return schedules?.liveUntil?.() ?? null;
    } catch {
      return null;
    }
  };
  const finishOwned = async () => {
    if (joining) return;
    joining = true;
    try {
      // Pi's own waits need its process to stay up, which a run here does not unless it lives until done, so the agent
      // is told so once and goes on.
      const stoppedOnCall = assistant?.stopReason === 'toolUse';
      const piWaits = stoppedOnCall && !untilDone && !toldPiWait ? [...calledLast].filter(name => PI_WAIT_TOOLS.includes(name)) : [];
      if (piWaits.length) {
        request.signal?.throwIfAborted();
        toldPiWait = true;
        assistant = undefined;
        joining = false;
        await child.request('prompt', { message: piWaitNote(piWaits, canWait) });
        return;
      }
      const facts = assistant?.stopReason === 'stop' ? await ownedScope?.join() : undefined;
      request.signal?.throwIfAborted();
      if (facts) { assistant = undefined; joining = false; await child.request('prompt', { message: facts }); }
      else if (livesOn()) { idle = true; onIdle(result.text); }
      else { takesMessages = false; settled.resolve(); }
    } catch (error) { settled.reject(error); }
    finally { joining = false; }
  };
  // Teams' own files for this session are asked too, for agents the records above miss: a spawn seen only inside a
  // `codemode` script's record, or a group member still working after its group's first wake.
  const finishUnlessOut = async () => {
    const asked = turns;
    const out = await agentsOut(state?.sessionId, { teamsDir }).catch(() => []);
    if (asked !== turns) return;
    if (out.length) recheck = setTimeout(finishUnlessOut, teamsCheckMs);
    else void finishOwned();
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
      const bridged = record.method === 'input' && record.title === BRIDGE;
      const wait = bridged ? bridgeCall(record.placeholder, 'wait') : null;
      const finished = bridged ? bridgeCall(record.placeholder, 'done') : null;
      if (wait) child.send({ type: 'extension_ui_response', id: record.id, value: JSON.stringify(answerWait(wait)) });
      else if (finished) child.send({ type: 'extension_ui_response', id: record.id, value: JSON.stringify(answerDone(finished)) });
      else if (bridged && isScheduleCall(record.placeholder)) {
        void serveBridge(record.placeholder, { tools: scheduleTools }, request.signal).then(reply => child.send({ type: 'extension_ui_response', id: record.id, value: JSON.stringify(reply) })).catch(error => settled.reject(error));
      } else if (bridged && isMemoryCall(record.placeholder)) {
        // As the agent hobkin handed this run's memories for, `{ recall, remember | suggest }`; without them a call is refused in plain words.
        void serveBridge(record.placeholder, { tools: memoryTools(memories) }, request.signal).then(reply => child.send({ type: 'extension_ui_response', id: record.id, value: JSON.stringify(reply) })).catch(error => settled.reject(error));
      } else if (bridged && integrations?.offer && isIntegrationCall(record.placeholder)) {
        // A tool an integration offered this run runs in the host, as the run hobkin knows (065-integration-drops).
        void serveIntegration(record.placeholder, integrations, request.signal).then(reply => child.send({ type: 'extension_ui_response', id: record.id, value: JSON.stringify(reply) })).catch(error => settled.reject(error));
      } else if (bridged && ownedScope) {
        void serveBridge(record.placeholder, { tools }, request.signal).then(reply => child.send({ type: 'extension_ui_response', id: record.id, value: JSON.stringify(reply) })).catch(error => settled.reject(error));
      } else child.send({ type: 'extension_ui_response', id: record.id, cancelled: true });
    }
    if (record.type === 'message_end' && record.message?.role === 'assistant') {
      assistant = record.message;
      result.text = clean(assistant.content?.filter(part => part.type === 'text').map(part => part.text).join('\n'));
      calledLast = new Set(toolCallNames(assistant));
    }
    if (record.type === 'tool_execution_end') {
      for (const agent of agentsStarted(record)) agents.add(agent);
      // A code mode script's own calls count too, since Pi's waits can be called from inside one.
      for (const name of [record.toolName, ...(record.result?.details?.calls ?? []).map(call => call?.name)]) {
        if (typeof name === 'string') calledLast.add(name);
      }
    }
    // A wait belongs to the turn that asked for it.
    if (record.type === 'agent_start') waitAsked = undefined;
    if (record.type === 'agent_start' && idle) {
      idle = false;
      onWoken();
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
    if (record.type === 'agent_start' || record.type === 'agent_settled') {
      turns++;
      clearTimeout(recheck);
    }
    if (record.type === 'agent_settled') {
      if (record.aborted === true) child.fail(Object.assign(Error('Pi agent run was aborted.'), { interrupted: true }));
      else if (!agents.size) void finishUnlessOut();
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
    // Whoever holds the handle can also change the run's model and thinking level while it works (`HobkinRuntime.changeRun`),
    // and ask what Pi offers its session as slash commands (`HobkinRuntime.runCommands`).
    onControl(durable ? lease : Object.assign(Object.create(child), { changeBinding: change => changeOn(child, change), commands: () => commandsOn(child) }));
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
    // Images the user attached go with the words, as Pi's image content (`imagesProblem` in `paste-image.mjs`).
    const response = await child.request('prompt', { message: request.prompt, ...(request.images?.length ? { images: request.images } : {}) });
    if (response?.disposition === 'handled') {
      throw Error('Pi handled the prompt without starting an assistant response.');
    }
    takesMessages = true;
    // A plain steer would sit unread while the lead waits on its agents, so this also starts a turn on an idle one.
    onReady(async (message, images) => {
      if (!takesMessages) throw Object.assign(Error('That check has finished.'), { notQueued: true });
      return child.request('prompt', { message, ...(images?.length ? { images } : {}), streamingBehavior: 'steer' });
    });
    await settled.promise;
    // A job its agent said is done reports what it said then.
    result.text = done ?? clean(assistant?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n'));
    // A turn that asked to wait and then ended as a turn ends leaves the run waiting, whatever its last words.
    const asked = waitAsked !== undefined && assistant?.stopReason === 'stop';
    // A run that can wait and keeps a live schedule waits for it to wake it, as one that asked to wait does. A living
    // job never waits: its schedules start a turn on its own process.
    const scheduledUntil = !untilDone && !asked && assistant?.stopReason === 'stop' && Number.isInteger(request.waits) && request.waits < MOST_WAITS ? schedulesUntil() : null;
    // A schedule with no end keeps it waiting with no time to start again: only a wake, or the schedule's end, starts it.
    const waiting = asked || typeof scheduledUntil === 'number';
    // A run that waits, or whose agent said it is done, chose its end, so its last reply need not be its report.
    const chosenEnd = waiting || done !== undefined;
    if (!chosenEnd && assistant?.stopReason === 'toolUse') throw Error(stoppedMidStep([...calledLast]));
    if (!chosenEnd && (assistant?.stopReason !== 'stop' || !result.text.trim())) {
      // Only retain the known quota sentence, never the provider payload or paid fallback advice.
      const quota = assistant?.stopReason === 'error' && typeof assistant.errorMessage === 'string'
        ? assistant.errorMessage.match(/^Quota reached\. Please wait ((?:\d{1,3}h)?(?:\d{1,3}m)?\d{1,3}s)\.(?:\s|$)/)?.[1]
        : undefined;
      const reason = `Pi did not finish a response (${assistant?.stopReason ?? 'missing'})`;
      throw Error(quota ? `${reason}: Quota reached; provider reported a wait of ${quota}.` : `${reason}.`);
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
    result.status = waiting ? WAITING : 'completed';
    if (asked) result.wait = waitAsked;
    else if (waiting) {
      const until = Number.isFinite(scheduledUntil) ? new Date(scheduledUntil + SCHEDULES_GRACE_MS).toISOString() : null;
      result.wait = { until, note: 'Waits for its schedules to wake it.', askedAt: new Date(now()).toISOString(), schedules: true };
    }
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
    turns++;
    clearTimeout(recheck);
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
