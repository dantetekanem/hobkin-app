import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import { createRegistry, defineDoc, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { compactionDue } from './compaction.mjs';
import { allCardActions, recordCardAction } from './work/card-actions.mjs';
import { doingAfter } from './doing.mjs';
import { skipInQueue } from './work/store.mjs';
import { JobActivity } from './job-activity.mjs';
import { closePiSession, openPiSession, withPiCancellation } from './pi-session.mjs';
import { assertRuntimeAdmission } from './migration/admission.mjs';
import { MAX_SESSION_BYTES } from './migration/ownership.mjs';
import { isQuietRun, saveReport } from './reports.mjs';
import { logRun } from './checks.mjs';
import { recordEvent, recordRunFinished, recordRunStarted } from './events.mjs';
import { createTurnMetrics } from './turn-metrics.mjs';

// The whole conversation is in its messages. This is a view of what it does now, so a long chat keeps only its latest steps.
const MAIN_ACTIVITY_ENTRIES = 200;

export const MAIN_BUSY = 'Main conversation is busy.';
export const MAX_MESSAGE_BYTES = 65536;
/** A chat past `MAX_SESSION_BYTES` will not reopen, and only images can grow one fast. This much stays free for words. */
export const IMAGE_ROOM_BYTES = 32 * 1024 * 1024;
const context = BACKGROUND_CONTEXT;
const RuntimeDoc = defineDoc({
  kind: 'companion.v2.runtime',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  checkpointWhen: () => false,
  initial: () => ({ main: null, sessionBaselines: {}, runs: {}, lastTick: null }),
});
const copy = value => JSON.parse(JSON.stringify(value));
const costOf = session => {
  const stats = session.getSessionStats();
  return stats.sessionId === session.sessionId && Number.isFinite(stats.cost) && stats.cost >= 0
    ? { usd: stats.cost, kind: 'estimate', cumulative: true, sessionId: session.sessionId } : null;
};

function recordUserStop(root, run, actions) {
  if (run.userStop?.source !== 'user' || run.status !== 'interrupted' || run.result?.status !== 'interrupted') return;
  const id = `user-stop:${run.id}`;
  const existing = (actions ?? allCardActions(root)).find(action => action.id === id);
  if (existing?.userStop && existing.did && existing.line) return;
  const did = `The user stopped run ${run.id} (${run.title}). ${run.userStop.reason} Do not retry or restart this stopped work unless the user explicitly asks. Partial results are retained.`;
  recordCardAction(root, { id, at: existing?.at ?? run.finishedAt, userStop: { runId: run.id, ...run.userStop }, title: run.title, did, line: did });
}

function recordMainStop(root, run, actions) {
  if (run.mainStop?.source !== 'main' || run.status !== 'interrupted' || run.result?.status !== 'interrupted' || !run.work?.planKey) return;
  const id = `main-stop:${run.id}`;
  const existing = (actions ?? allCardActions(root)).find(action => action.id === id);
  if (existing?.mainStop && existing.did && existing.line) return;
  // Only a confirmed interruption gains a hold. No speculative skip or rollback can overwrite another queue edit.
  skipInQueue(root, run.work.planKey);
  const did = `Hobkin stopped Work run ${run.id} (${run.title}) because ${run.mainStop.reason} Do not retry or restart this stopped work unless explicitly repicked. The parent interruption is confirmed; nested helper cleanup is unconfirmed. Partial results are retained.`;
  recordCardAction(root, { id, at: existing?.at ?? run.finishedAt, mainStop: { runId: run.id, ...run.mainStop }, title: run.title, did, line: did });
}

export class HobkinRuntime {
  constructor(root, config, { createMain = openPiSession, askQuestion, triggerSchedule, messageCheck, stopWorkload, ownedAgent, ownedLifecycle, editReport, metricsNow, onChange = () => {} } = {}) {
    this.directory = root;
    this.config = config;
    this.createMain = createMain;
    this.metricsNow = metricsNow;
    this.askQuestion = askQuestion;
    this.triggerSchedule = triggerSchedule;
    this.messageCheck = messageCheck;
    this.stopWorkload = stopWorkload;
    this.ownedAgent = ownedAgent;
    this.ownedLifecycle = ownedLifecycle;
    this.editReport = editReport;
    this.onChange = onChange;
    this.active = new Map();
    this.busySessions = new Set();
    this.mainTurn = null;
    this.resetting = false;
    this.closing = false;
    this.fault = null;
    this.mainFault = null;
  }

  static async open(root, config, options) {
    root = assertRuntimeAdmission(root);
    const runtime = new HobkinRuntime(root, config, options);
    const directory = join(root, 'runtime');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      runtime.release = await lockfile.lock(directory, {
        retries: 0,
        stale: 300000,
        update: 10000,
        onCompromised: error => {
          runtime.fault = error;
          void runtime.close().catch(() => {});
        },
      });
    } catch (error) {
      if (error.code === 'ELOCKED') throw Error('Hobkin is already running for this home.');
      throw error;
    }
    let storage;
    try {
      const file = join(directory, 'hobkin.sqlite');
      storage = await openNodeSqliteStorage(file);
      chmodSync(file, 0o600);
      runtime.harness = await Harness.open(storage, { models: createModels(), registry: createRegistry() }, context);
      runtime.root = await runtime.harness.root(context, {
        init: async (tx, id) => { await tx.doc(RuntimeDoc, id); },
      });
      const abandoned = await runtime.interruptAbandonedRuns();
      for (const run of abandoned) {
        logRun(root, run);
        recordRunFinished(root, run);
      }
      const actions = allCardActions(root);
      for (const run of Object.values((await runtime.state()).runs)) {
        recordUserStop(root, run, actions);
        recordMainStop(root, run, actions);
      }
      return runtime;
    } catch (error) {
      if (runtime.harness) await runtime.harness.close(context);
      else if (storage) await storage.close(context);
      await runtime.release();
      throw error;
    }
  }

  interruptAbandonedRuns() {
    return this.change(state => {
      const stopped = Object.values(state.runs).filter(run => run.status === 'running');
      for (const run of stopped) {
        if (run.kind === 'main' && !run.parentRunId && run.sessionId) {
          const identity = { runId: run.id, sessionId: run.sessionId };
          // Recovery observes neither dispatch nor completion; never clock from restart or replay an append.
          run.performance = { ...createTurnMetrics({ ...identity, now: () => NaN }).finish(identity), incomplete: true };
        }
        Object.assign(run, {
          status: 'interrupted', cost: null,
          error: 'The previous owner stopped without a completion receipt. Not replayed.',
          finishedAt: new Date().toISOString(),
        });
      }
      return copy(stopped);
    });
  }

  check() {
    if (this.fault) throw this.fault;
    if (this.closing) throw Error('hobkin is closing.');
  }

  notify(activityOnly = false) {
    try {
      this.onChange(activityOnly);
    } catch {
      // UI observers cannot change a committed receipt.
    }
  }

  async state() {
    return copy(await this.harness.snapshot(RuntimeDoc, this.root.id, context));
  }

  async change(update) {
    const result = await this.root.commit(async tx => update(await tx.doc(RuntimeDoc, this.root.id)), context);
    this.notify();
    return result;
  }

  async connect() {
    this.check();
    if (!this.connecting) {
      this.connecting = this.connectMain().catch(error => {
        this.connecting = null;
        throw error;
      });
    }
    return this.connecting;
  }

  async connectMain(fresh = false) {
    const currentState = await this.state();
    const saved = fresh ? null : currentState.main;
    let main;
    main = await this.createMain({
      root: this.directory,
      config: this.config,
      saved,
      fresh,
      // What the main conversation asks is about what it said in Chat, so its questions say where they belong.
      askQuestion: this.askQuestion && ((request, signal) => this.askQuestion({ ...request, inChat: true }, signal)),
      triggerSchedule: (scheduleId, callId, signal) => this.triggerSchedule(scheduleId, `${this.main.sessionId}:${callId}`, signal),
      messageCheck: this.messageCheck,
      stopWorkload: this.stopWorkload,
      ownedAgent: this.ownedLifecycle ? (request, signal) => {
        const turn = this.mainTurn;
        if (!main || turn?.session !== main || !turn.owned || turn.preflight !== true || turn.stopping || this.resetting || this.closing) throw Error('No active admitted owned turn');
        return turn.owned.request(request, signal);
      } : this.ownedAgent,
    });
    if (this.closing || this.fault) {
      await closePiSession(main);
      this.check();
    }
    if (!main.sessionId || !main.sessionFile
      || (saved && (saved.sessionId !== main.sessionId || saved.sessionFile !== main.sessionFile))) {
      await closePiSession(main);
      throw Error('Main Pi session identity is unavailable or changed.');
    }
    if (fresh && currentState.main
      && (currentState.main.sessionId === main.sessionId || currentState.main.sessionFile === main.sessionFile)) {
      await closePiSession(main);
      throw Error('A fresh main session must have a new identity and transcript.');
    }

    let unsubscribe;
    // What this session does and the agents it spawns, kept like a job's. A fresh session starts with none.
    const feed = new JobActivity({ most: MAIN_ACTIVITY_ENTRIES });
    try {
      unsubscribe = main.subscribe(event => {
        feed.accept(event);
        if (event.type === 'tool_execution_start') this.mainTool = event.toolName;
        this.mainDoing = doingAfter(this.mainDoing, event);
        if (event.type === 'compaction_start') {
          this.compactingSince = Date.now();
          recordEvent(this.directory, 'compaction_started', { reason: event.reason });
        }
        if (event.type === 'compaction_end') {
          this.lastCompaction = {
            status: event.aborted ? 'cancelled' : event.errorMessage ? 'failed' : 'completed',
            reason: event.reason,
            at: new Date().toISOString(),
            error: event.errorMessage ?? null,
          };
          recordEvent(this.directory, 'compaction_finished', { reason: event.reason, status: this.lastCompaction.status, ms: Date.now() - this.compactingSince });
        }
        this.notify(event.type === 'message_update' || event.type === 'tool_execution_update');
      });
      await this.change(state => {
        if (fresh || !state.main) {
          if (state.main) {
            state.sessionBaselines ??= {};
            state.sessionBaselines[state.main.sessionId] = { baseline: state.main.baseline };
          }
          state.main = {
            sessionId: main.sessionId,
            sessionFile: main.sessionFile,
            connectedAt: new Date().toISOString(),
            baseline: costOf(main),
          };
        }
      });
    } catch (error) {
      unsubscribe?.();
      await closePiSession(main);
      throw error;
    }

    const previous = this.main;
    const unsubscribePrevious = this.unsubscribe;
    this.main = main;
    this.mainFeed = feed;
    this.unsubscribe = unsubscribe;
    this.mainFault = null;
    // A child Pi that exits unasked ends the chat until a restart; scheduled checks keep running.
    main.exited?.then(error => {
      if (error && this.main === main && !this.closing) {
        this.mainFault = error;
        this.notify();
      }
    });
    if (fresh) this.lastCompaction = null;
    unsubscribePrevious?.();
    if (previous && previous !== main) await closePiSession(previous);
    this.notify();
    return main;
  }

  contextInfo() {
    const entries = this.main?.sessionManager?.getBranch().filter(entry => entry.type === 'compaction');
    const last = entries?.at(-1);
    return {
      ...this.main?.getContextUsage?.(),
      auto: this.main?.autoCompactionEnabled ?? null,
      compacting: Boolean(this.main?.isCompacting),
      compactions: entries?.length ?? null,
      last: this.lastCompaction ?? (last ? { status: 'completed', at: last.timestamp } : null),
    };
  }

  messages() { return this.main?.messages ?? []; }
  /** The agents the main chat spawned through pi-extended-teams. A reset or a main Pi that stopped ends any still out unreported. */
  mainChildren() { return this.mainFeed?.children({ ended: this.resetting || Boolean(this.mainFault) }) ?? []; }
  /** The main chat's latest words and tool calls, as a job's activity is kept: never its thinking. */
  mainActivity() { return this.mainFeed?.snapshot() ?? []; }
  get mainBusy() { return Boolean(this.main && this.busySessions.has(this.main.sessionId)); }
  sessionReady(sessionId) { return !this.closing && !this.fault && !this.busySessions.has(sessionId); }
  /** Whether a new turn would start at once. `send` steers a live turn instead, and Pi refuses a prompt during compaction. */
  get mainFree() {
    return Boolean(this.main) && this.sessionReady(this.main.sessionId) && !this.mainFault && !this.resetting
      && !this.main.isStreaming && !this.main.isCompacting;
  }
  /** Pi swaps an image for a placeholder on a model that cannot see one, so the user has to hear it here. A model that does not say is taken at its word. */
  get imageRefusal() {
    const { model, sessionFile } = this.main ?? {};
    if (model?.input && !model.input.includes('image')) return `${model.provider}/${model.id} cannot see images.`;
    const size = sessionFile ? statSync(sessionFile, { throwIfNoEntry: false })?.size ?? 0 : 0;
    return size >= MAX_SESSION_BYTES - IMAGE_ROOM_BYTES ? 'This chat is full of images. /reset starts a fresh one.' : null;
  }

  /** At the force level new work waits for the chat, and carries on by itself once there is room. A chat that has stopped holds nothing up. */
  get workWaitsForChat() {
    if (!this.main || this.mainFault || this.closing) return false;
    return this.main.isCompacting || compactionDue(this.contextInfo()) === 'force';
  }

  /** Hobkin's own compaction. Pi's aborts whatever is running, so this takes only a free session and holds it, so no turn can start under it. */
  async compactMain() {
    if (!this.mainFree || typeof this.main.compact !== 'function') return false;

    const release = this.reserveSession(this.main.sessionId);
    try {
      await this.main.compact();
      return true;
    } catch (error) {
      this.lastCompaction = { status: 'failed', reason: 'hobkin', at: new Date().toISOString(), error: String(error.message ?? error) };
      return false;
    } finally {
      release();
    }
  }

  reserveSession(sessionId) {
    this.check();
    if (!sessionId || !this.sessionReady(sessionId)) throw Error('Conversation is busy.');
    this.busySessions.add(sessionId);
    this.notify();
    return () => {
      this.busySessions.delete(sessionId);
      this.notify();
    };
  }

  async reset() {
    this.check();
    if (!this.main) throw Error('Main conversation is not connected.');
    if (this.resetting) throw Error('Main conversation is already resetting.');

    const previous = this.main;
    const ownedTurn = this.mainTurn?.session === previous ? this.mainTurn : null;
    const hasBusyMainWork = this.mainBusy || previous.isStreaming;
    if (hasBusyMainWork && !ownedTurn) throw Error(MAIN_BUSY);

    this.resetting = true;
    this.notify();
    try {
      if (ownedTurn) await this.stopTurn(ownedTurn);
      const main = await this.connectMain(true);
      this.connecting = Promise.resolve(main);
      return { sessionId: main.sessionId, sessionFile: main.sessionFile };
    } finally {
      this.resetting = false;
      this.notify();
    }
  }

  /**
   * The user's stop, the way Esc stops Pi: what waits in Pi's queue comes out, and the turn ends at once. What it already said stays
   * in the conversation. Returns what the user sent that the agent never read, or null when no turn was running.
   */
  async interrupt() {
    const turn = this.mainTurn;
    if (!turn || turn.session !== this.main) return null;
    if (turn.stopWork) return turn.stopWork;
    if (!this.active.has(turn.id) && !turn.stopping) return null;
    return this.stopTurn(turn);
  }

  stopTurn(turn) {
    if (turn.stopWork) return turn.stopWork;
    turn.stopping = true;
    const work = this.mainWork;
    this.active.get(turn.id)?.controller.abort();
    const abort = Promise.resolve().then(() => turn.session.abort());
    const children = Promise.resolve().then(() => turn.owned?.cancel());
    let timer, expired = false;
    // A failed reply may follow a destructive drain: keep one recovery attempt per captured turn.
    const recovery = turn.unread ?? (turn.recovery ??= (async () => {
      await Promise.allSettled([...turn.steering]);
      if (expired) throw Error('Unread draft recovery expired.');
      if (typeof turn.session.clearQueue !== 'function') throw Error('Unread draft recovery is unavailable.');
      const queue = await turn.session.clearQueue();
      if (!queue || Array.isArray(queue) || !Array.isArray(queue.steering) || !Array.isArray(queue.followUp)) throw Error('Unread draft recovery is invalid.');
      const unread = [...queue.steering, ...queue.followUp];
      if (!unread.every(text => typeof text === 'string')) throw Error('Unread drafts must be strings.');
      return turn.unread = unread;
    })());
    const cancelled = Promise.all([abort, children, work]).then(([, cleanup]) => {
      if (turn.owned && cleanup?.confirmed !== true) throw Error('Owned agent cleanup is unconfirmed.');
      turn.cancellationConfirmed = true;
    });
    turn.stopWork = Promise.race([
      Promise.all([cancelled, recovery]).then(([, unread]) => unread),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Stop completion or unread draft recovery is unconfirmed.')), 5000); }),
    ]).then(unread => {
      // Only a confirmed attempt releases custody, never late recovery after a timed-out Stop.
      if (this.mainTurn === turn) this.mainTurn = null;
      turn.release();
      return unread;
    }).catch(error => {
      throw Object.assign(new Error(error?.message ?? String(error), { cause: error }), {
        code: 'STOP_UNCONFIRMED', runId: turn.id, cancellationConfirmed: turn.cancellationConfirmed === true, queueRecovery: turn.unread ? 'confirmed' : 'unknown',
      });
    }).finally(() => {
      expired = true;
      clearTimeout(timer);
      turn.stopWork = null;
    });
    return turn.stopWork;
  }

  async admit(request) {
    this.check();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(request.id ?? '')
      || !['main', 'background', 'repair'].includes(request.kind)) {
      throw Error('Invalid dispatch identity.');
    }
    return this.change(state => {
      this.check();
      if (Object.hasOwn(state.runs, request.id)) return false;
      state.runs[request.id] = {
        ...copy(request),
        status: 'running',
        startedAt: new Date().toISOString(),
        cost: null,
      };
      return true;
    });
  }
  async finish(id, result) {
    if (!['completed', 'failed', 'interrupted', 'no_change', 'incomplete'].includes(result.status)) throw Error('Invalid completion status.');
    const finished = await this.change(state => {
      const run = state.runs[id];
      if (!run) throw Error('No dispatch admission exists.');
      if (run.status !== 'running') {
        if (JSON.stringify(run.result) !== JSON.stringify(result)) {
          throw Error('A conflicting receipt cannot replace a final outcome.');
        }
        return null;
      }
      if (run.kind !== 'main' && !isQuietRun({ trigger: run.trigger, status: result.status, result })) {
        const report = result.text || result.error || 'No result text.';
        const failure = result.text && result.error ? `\n\n---\n\n**Execution failure:** ${result.error}` : '';
        saveReport(this.directory, id, `${report}${failure}`);
      }
      Object.assign(run, {
        status: result.status,
        cost: result.cost ?? null,
        result: copy(result),
        ...(result.performance ? { performance: copy(result.performance) } : {}),
        finishedAt: new Date().toISOString(),
      });
      return copy(run);
    });
    if (finished) {
      recordUserStop(this.directory, finished);
      recordMainStop(this.directory, finished);
      logRun(this.directory, finished);
      recordRunFinished(this.directory, finished);
    }
  }

  // Every check and work run passes here, whichever agent wrote its report, before anything saves or shows it.
  edited(request, result, signal) {
    if (request.kind !== 'background' || !this.editReport) return result;
    return this.editReport(result, { root: this.directory, signal });
  }

  dispatch(request, effect, onAdmitted) {
    if (this.active.has(request.id)) return this.active.get(request.id).completion;
    const controller = new AbortController();
    const completion = Promise.resolve().then(async () => {
      if (!await this.admit(request)) return (await this.state()).runs[request.id];
      recordRunStarted(this.directory, request);
      onAdmitted?.();
      let result;
      try {
        this.check();
        result = await effect(controller.signal);
      } catch (error) {
        result = {
          status: controller.signal.aborted ? 'interrupted' : 'failed',
          cost: null,
          error: String(error.message ?? error),
        };
      }
      await this.finish(request.id, await this.edited(request, result, controller.signal));
      return (await this.state()).runs[request.id];
    });
    this.active.set(request.id, { controller, completion });
    return completion.finally(() => this.active.delete(request.id));
  }

  async queueSteering(text, id, turn, images) {
    const request = {
      id,
      kind: 'main',
      title: 'Steering',
      prompt: text,
      harness: 'pi',
      sessionId: turn.sessionId,
      model: `${turn.session.model?.provider}/${turn.session.model?.id}`,
      effort: turn.session.thinkingLevel,
      parentRunId: turn.id,
    };
    let interruptedByReset = false;
    let admitted = false;
    const queued = Promise.resolve().then(async () => {
      try {
        if (!await this.admit(request)) {
          const existing = (await this.state()).runs[id];
          if (existing?.status === 'running' && existing.parentRunId === turn.id && existing.prompt === text) {
            return { id, queued: true };
          }
          throw Error('A dispatch with this identity already exists.');
        }
        admitted = true;
        this.check();
        interruptedByReset = this.resetting || turn.stopping || this.mainTurn !== turn;
        if (interruptedByReset) throw Error('Main conversation is stopping or resetting.');
        if (this.main !== turn.session || !turn.session.isStreaming || typeof turn.session.steer !== 'function') {
          throw Error(MAIN_BUSY);
        }
        await turn.session.steer(text, images);
        turn.children.push(id);
        return { id, queued: true };
      } catch (error) {
        const existing = (await this.state()).runs[id];
        if (admitted && existing?.status === 'running' && existing.parentRunId === turn.id) {
          await this.finish(id, {
            status: interruptedByReset || this.resetting || turn.stopping ? 'interrupted' : 'failed',
            cost: null,
            noModel: true,
            error: String(error.message ?? error),
          });
        }
        throw error;
      }
    });
    turn.steering.add(queued);
    try {
      return await queued;
    } finally {
      turn.steering.delete(queued);
    }
  }

  async finishSteering(turn, status) {
    if (!turn.children.length) return;
    return this.change(state => {
      const finishedAt = new Date().toISOString();
      for (const id of turn.children) {
        const run = state.runs[id];
        if (!run || run.status !== 'running') continue;
        Object.assign(run, {
          status,
          cost: null,
          result: { status, noModel: true },
          finishedAt,
        });
      }
    });
  }

  async send(text, id = randomUUID(), images) {
    this.check();
    if (!this.main) throw Error('Main conversation is not connected.');
    if (this.mainFault) throw Error(`Main chat stopped: ${this.mainFault.message} Restart hobkin to reconnect.`);
    if (this.resetting) throw Error('Main conversation is resetting.');
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > MAX_MESSAGE_BYTES) throw Error(`Message must contain 1–${MAX_MESSAGE_BYTES} bytes.`);
    if (images && this.imageRefusal) throw Error(this.imageRefusal);

    const activeTurn = this.mainTurn;
    if (activeTurn?.session === this.main) {
      if (activeTurn.stopping) throw Error('Main conversation is stopping.');
      if (activeTurn.preflight && this.main.isStreaming && typeof this.main.steer === 'function') {
        return this.queueSteering(text, id, activeTurn, images);
      }
      if (this.mainBusy || this.main.isStreaming) throw Error(MAIN_BUSY);
      await this.mainWork;
      this.check();
      if (this.resetting) throw Error('Main conversation is resetting.');
      return this.send(text, id, images);
    }
    if (this.mainBusy || this.main.isStreaming) throw Error(MAIN_BUSY);

    const release = this.reserveSession(this.main.sessionId);
    const accepted = Promise.withResolvers();
    const session = this.main;
    const turn = {
      id,
      session,
      sessionId: session.sessionId,
      preflight: undefined,
      release,
      steering: new Set(),
      children: [],
    };
    this.mainTurn = turn;
    let preflight;
    let disposition;
    const work = this.dispatch({
      id,
      kind: 'main',
      title: 'Conversation',
      prompt: text,
      harness: 'pi',
      sessionId: session.sessionId,
      model: `${session.model?.provider}/${session.model?.id}`,
      effort: session.thinkingLevel,
    }, async signal => {
      const identity = { runId: id, sessionId: turn.sessionId };
      const metrics = createTurnMetrics({ ...identity, now: this.metricsNow });
      const unsubscribe = session.subscribe((event, message) => metrics.observe(message ? { ...event, message } : event, identity));
      let outcome;
      const cancelChildren = () => { void turn.owned?.cancel(); };
      try {
        signal.throwIfAborted();
        const directionsFile = join(this.directory, 'AGENTS.md');
        turn.owned = this.ownedLifecycle?.register({ id, allowHelpers: true, binding: {
          cwd: this.config.main.cwd, prompt: JSON.stringify({ task: text, directions: readFileSync(existsSync(directionsFile) ? directionsFile : new URL('../prompts/agents-default.md', import.meta.url)).subarray(0, 16384).toString('utf8') }),
          model: `${session.model?.provider}/${session.model?.id}`, effort: session.thinkingLevel,
          role: 'read', parentRole: 'read', launcher: this.config.launcher,
        } });
        signal.addEventListener('abort', cancelChildren, { once: true });
        await withPiCancellation(session, signal, () => session.prompt(text, {
          images,
          preflightResult: result => {
            disposition = result;
            preflight = result !== false;
            turn.preflight = preflight && disposition !== 'handled';
            if (signal.aborted) {
              // Throwing here bypasses Pi's settlement cleanup after it has started the run.
              void session.abort().catch(() => {});
              accepted.reject(signal.reason);
            } else if (preflight) {
              accepted.resolve({ id });
            } else {
              accepted.reject(Error('Message rejected before submission.'));
            }
          },
        }));
        if (disposition === 'handled') {
          return outcome = { status: 'completed', cost: costOf(session), text: '' };
        }
        if (disposition === 'queued') await session.waitForIdle();
        const earlier = session.messages.filter(message => message.role === 'assistant').at(-1);
        const facts = earlier?.stopReason === 'stop' ? await turn.owned?.join() : undefined;
        signal.throwIfAborted();
        if (facts) await withPiCancellation(session, signal, () => session.prompt(facts));
        const last = session.messages.filter(message => message.role === 'assistant').at(-1);
        if (facts && last === earlier) throw Error('Owned descendants require a later parent response');
        return outcome = {
          status: last?.stopReason === 'stop' ? 'completed' : 'incomplete',
          stopReason: last?.stopReason,
          cost: costOf(session),
          text: last?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '',
        };
      } catch (error) {
        accepted.reject(error);
        return outcome = {
          status: signal.aborted || preflight === true ? 'interrupted' : 'failed',
          noModel: preflight === false,
          text: session.messages.filter(message => message.role === 'assistant').at(-1)?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '',
          cost: preflight === false ? null : costOf(session),
          error: String(error.message ?? error),
        };
      } finally {
        signal.removeEventListener('abort', cancelChildren);
        const cleanup = await turn.owned?.cancel();
        if (outcome && cleanup) Object.assign(outcome, { ownedCleanupConfirmed: cleanup.confirmed, ownedChildren: cleanup.agents });
        unsubscribe();
        const performance = metrics.record(this.directory, identity);
        if (outcome) outcome.performance = performance;
      }
    });
    this.mainWork = work.then(async run => {
      if (preflight === undefined) accepted.reject(Error('Message was already admitted or did not pass Pi preflight.'));
      await Promise.allSettled([...turn.steering]);
      await this.finishSteering(turn, run.status);
    }, error => {
      accepted.reject(error);
      this.fault = error;
    }).catch(error => {
      this.fault = error;
    }).finally(() => {
      if (!turn.stopping) {
        if (this.mainTurn === turn) this.mainTurn = null;
        release();
      }
      this.mainTool = null;
      this.mainDoing = null;
    });
    return accepted.promise;
  }

  async cancel(id, stop = {}) {
    const active = this.active.get(id);
    if (!active || active.controller.signal.aborted || active.cancelling) return false;
    active.cancelling = true;
    const run = await this.change(state => {
      const current = state.runs[id];
      if (current?.status !== 'running' || active.controller.signal.aborted) return null;
      if (stop.source === 'user') current.userStop = {
        source: 'user', reason: String(stop.reason ?? 'Stopped by the user.').slice(0, 200),
      };
      if (stop.source === 'main') current.mainStop = { source: 'main', reason: stop.reason };
      return copy(current);
    }).catch(error => {
      active.cancelling = false;
      throw error;
    });
    if (!run) return false;
    active.controller.abort();
    if (run.kind === 'main') await this.main?.abort();
    await active.completion;
    if (run.kind === 'main') await this.mainWork;
    const ended = (await this.state()).runs[id];
    if (ended.status !== 'interrupted') return false;
    return true;
  }

  async idle() {
    await this.mainWork;
    await Promise.all([...this.active.values()].map(item => item.completion));
  }

  close() {
    if (!this.closePromise) {
      this.closing = true;
      this.closePromise = (async () => {
        const children = this.ownedLifecycle?.close();
        for (const { controller } of this.active.values()) controller.abort();
        await this.connecting?.catch(() => {});
        await this.main?.abort();
        await children;
        await Promise.allSettled([this.mainWork, ...[...this.active.values()].map(item => item.completion)]);
        this.unsubscribe?.();
        await closePiSession(this.main);
        await this.harness.close(context);
        await this.release();
      })();
    }
    return this.closePromise;
  }
}
