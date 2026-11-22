import { chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import { createRegistry, defineDoc, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { compactionDue } from './compaction.mjs';
import { allCardActions, recordCardAction } from './work/card-actions.mjs';
import { doingAfter } from './doing.mjs';
import { skipInQueue } from './work/store.mjs';
import { JobActivity, OwnedActivity } from './job-activity.mjs';
import { closePiSession, openPiSession, withPiCancellation } from './pi-session.mjs';
import { assertRuntimeAdmission } from './migration/admission.mjs';
import { lockHome } from './home-lock.mjs';
import { MAX_SESSION_BYTES } from './migration/ownership.mjs';
import { isQuietRun, runReport, saveReport } from './reports.mjs';
import { logRun } from './checks.mjs';
import { readDirections } from './directions.mjs';
import { recordEvent, recordRunFinished, recordRunStarted } from './events.mjs';
import { createTurnMetrics } from './turn-metrics.mjs';
import { clockTime, WAITING } from './run-waits.mjs';

// The whole conversation is in its messages. This is a view of what it does now, so a long chat keeps only its latest steps.
const MAIN_ACTIVITY_ENTRIES = 200;
// The main chat's events after which the whole view reads something new: the conversation, its context, or a compaction under way.
const WHOLE_VIEW_EVENTS = new Set(['message_end', 'agent_end', 'agent_settled', 'compaction_start', 'compaction_end']);

export const MAIN_BUSY = 'Main conversation is busy.';
const MAIN_STOPPING = 'Main conversation is stopping.';
// A turn whose Pi has stopped is held only for what it had not read, and the next stop gives that back.
export const STOP_AGAIN = 'Stop hobkin again to get back what it had not read.';
// A tool that does not listen for a stop holds Pi's answer until it returns, so a stop waits this long before it says it is unconfirmed.
const STOP_WAIT_MS = 30000;
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
export async function controlWait(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]); }
  finally { clearTimeout(timer); }
}
export const descendantReceipt = result => ({
  status: result?.confirmed === true ? 'confirmed' : 'unknown',
  agents: (result?.agents ?? []).map(node => ({ agentId: node.id, status: ['completed', 'cancelled', 'failed'].includes(node.status) ? 'confirmed' : 'unknown' })),
  cleanupScope: result?.agents?.length ? 'captured-rpc-children' : 'none', detachedCleanup: 'unknown',
});
const copy = value => JSON.parse(JSON.stringify(value));
const costOf = session => {
  const stats = session.getSessionStats();
  return stats.sessionId === session.sessionId && Number.isFinite(stats.cost) && stats.cost >= 0
    ? { usd: stats.cost, kind: 'estimate', cumulative: true, sessionId: session.sessionId } : null;
};

function recordUserStop(root, run, actions) {
  // A durable hobkin's turn is stopped on its own page, so neither Chat nor the main agent hears of it.
  if (run.hobkin || run.userStop?.source !== 'user' || run.status !== 'interrupted' || run.result?.status !== 'interrupted') return;
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
  constructor(root, config, { createMain = openPiSession, onMainStartup, askQuestion, triggerSchedule, messageCheck, stopWorkload, ownedAgent, ownedLifecycle, editReport, metricsNow, stopWaitMs = STOP_WAIT_MS, onChange = () => {} } = {}) {
    this.directory = root;
    this.config = config;
    this.createMain = createMain;
    this.stopWaitMs = stopWaitMs;
    this.onMainStartup = onMainStartup;
    this.metricsNow = metricsNow;
    this.askQuestion = askQuestion;
    this.triggerSchedule = triggerSchedule;
    this.messageCheck = messageCheck;
    this.stopWorkload = stopWorkload;
    this.ownedAgent = ownedAgent;
    this.ownedLifecycle = ownedLifecycle;
    this.ownedActivity = new OwnedActivity();
    this.mainOwnedRoots = new Set();
    this.editReport = editReport;
    this.onChange = onChange;
    this.active = new Map();
    this.busySessions = new Set();
    this.mainTurn = null;
    this.ownCompaction = null;
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
    runtime.release = await lockHome(directory, {
      onCompromised: error => {
        runtime.fault = error;
        void runtime.close().catch(() => {});
      },
    });
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

  // pi-durable hands back the same document until a commit swaps in a new one, and never changes one in place, so its
  // text is encoded once per commit. Every caller still gets a copy of its own to change.
  async state() {
    const document = await this.harness.snapshot(RuntimeDoc, this.root.id, context);
    if (document !== this.encodedDocument) {
      this.encodedState = JSON.stringify(document);
      this.encodedDocument = document;
    }
    return JSON.parse(this.encodedState);
  }

  /**
   * The committed document itself, with no copy, for a reader that never changes it, such as the view's rebuild. pi-durable swaps in a
   * new document at each commit and never changes one in place, so what this hands out stays as it was. A caller that changes what it
   * reads, or keeps it, takes `state()` or copies what it keeps.
   */
  document() {
    return this.harness.snapshot(RuntimeDoc, this.root.id, context);
  }

  /**
   * Each run's bookkeeping, for what only counts and matches runs, as the scheduler's tick does every second: its id,
   * kind, status, routine, occurrence and harness, and whether it is Work's or a durable hobkin's, never its prompt or result.
   * `evidenceDue` says whether a finished run still waits for its evidence (`collectEvidence` in compatibility.mjs), `finished` how
   * many runs have finished, as the learner counts them, and `toTitle` whether an open hobkin is still named by its first message.
   * Worked out once per commit, as `state()` encodes, and frozen, since every caller gets this same object.
   */
  async runIndex() {
    const document = await this.harness.snapshot(RuntimeDoc, this.root.id, context);
    if (document !== this.indexedDocument) {
      const runs = Object.entries(document.runs ?? {}).map(([id, { kind, status, scheduleId, scheduledAt, harnessId, work, hobkin }]) =>
        [id, Object.freeze({ id, kind, status, scheduleId, scheduledAt, harnessId, work: Boolean(work), hobkin: Boolean(hobkin) })]);
      const records = Object.values(document.runs ?? {});
      const receipts = document.evidenceReceipts ?? {};
      this.indexed = Object.freeze({
        runs: Object.freeze(Object.fromEntries(runs)),
        evidenceDue: records.some(run => run.status !== 'running' && run.status !== WAITING && !receipts[run.id]),
        finished: records.filter(run => run.finishedAt).length,
        toTitle: Object.values(document.hobkins ?? {}).some(record => record.state !== 'ended' && record.titleBy === 'message'),
      });
      this.indexedDocument = document;
    }
    return this.indexed;
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

  /**
   * The main chat's Pi ended without being asked, so the next message opens the same conversation again in a new process. Not while a
   * stop of a turn on that Pi is under way or gives back what it had not read, nor during a reset. A turn the ended Pi still held goes, since
   * nothing is left to stop. A second message joins a reopening under way, and a close waits for it.
   */
  reopenMain() {
    this.check();
    if (!this.mainFault) return Promise.resolve(this.main);
    if (this.resetting) return Promise.reject(Error('Main conversation is resetting.'));
    const ended = this.main, turn = this.mainTurn;
    if (turn?.session === ended && (turn.stopWork || turn.heldForUnread)) {
      return Promise.reject(Error(turn.stopWork ? MAIN_STOPPING : STOP_AGAIN));
    }
    this.reopening ??= (async () => {
      // The ended Pi's output has closed, so a turn on it has nothing left to wait for.
      await this.mainWork;
      const held = this.mainTurn;
      if (held?.session === ended && !held.stopWork) {
        this.mainTurn = null;
        held.release();
      }
      this.check();
      return this.connectMain(false);
    })().finally(() => { this.reopening = null; });
    return this.reopening;
  }

  async connectMain(fresh = false) {
    const prior = this.mainStartup;
    if (prior && (!prior.done || (prior.error && prior.child && !prior.closed))) throw Error('Previous main startup cleanup is unconfirmed.');
    const controller = new AbortController(), settled = Promise.withResolvers(), cancelled = Promise.withResolvers();
    controller.signal.addEventListener('abort', () => cancelled.reject(controller.signal.reason), { once: true });
    cancelled.promise.catch(() => {});
    const startup = this.mainStartup = {
      token: randomUUID(), fresh, child: null, closed: false, done: false, installed: false, error: null,
      persistence: { status: 'unchanged' }, signal: controller.signal, settled: settled.promise,
      cancel: () => { if (!startup.done && !startup.installed) controller.abort(Error('Main startup cancelled.')); },
      wait: promise => Promise.race([promise, cancelled.promise]),
      capture: child => {
        startup.child = child;
        child.closed.then(() => { startup.closed = true; });
        this.onMainStartup?.(startup);
        controller.signal.throwIfAborted();
      },
    };
    const opening = (async () => { this.onMainStartup?.(startup); return this.#connectMain(fresh, startup); })()
      .catch(error => { startup.error = error; controller.abort(error); throw error; })
      .finally(() => { startup.done = true; settled.resolve(); });
    return startup.wait(opening);
  }

  async #connectMain(fresh, startup) {
    startup.signal.throwIfAborted();
    const currentState = await startup.wait(this.state());
    startup.signal.throwIfAborted();
    const saved = fresh ? null : currentState.main;
    let main;
    main = await this.createMain({
      startup: this.onMainStartup ? startup : undefined,
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
    if (startup.signal.aborted || this.closing || this.fault) {
      if (!startup.child) await closePiSession(main);
      startup.signal.throwIfAborted();
      this.check();
    }
    if (!main.sessionId || !main.sessionFile
      || (saved && (saved.sessionId !== main.sessionId || saved.sessionFile !== main.sessionFile))) {
      if (!startup.child) await closePiSession(main);
      throw Error('Main Pi session identity is unavailable or changed.');
    }
    if (fresh && currentState.main
      && (currentState.main.sessionId === main.sessionId || currentState.main.sessionFile === main.sessionFile)) {
      if (!startup.child) await closePiSession(main);
      throw Error('A fresh main session must have a new identity and transcript.');
    }

    let unsubscribe;
    // Parent content stays complete and separate from the owned descendant display.
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
        // A message's words, its tools and its turns travel as activity, which carries the busy state, the tool in flight and the doing word.
        // The whole view is rebuilt only when what it reads changed: a message or a run ended, or a compaction began or ended.
        this.notify(!WHOLE_VIEW_EVENTS.has(event.type));
      });
      await this.change(state => {
        startup.signal.throwIfAborted();
        if (fresh || !state.main) {
          startup.persistence = { status: 'unknown', sessionId: main.sessionId, sessionFile: main.sessionFile };
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
      if (startup.persistence.status === 'unknown') startup.persistence.status = 'committed';
      startup.signal.throwIfAborted();
    } catch (error) {
      unsubscribe?.();
      if (!startup.child) await closePiSession(main);
      throw error;
    }

    const previous = this.main;
    const unsubscribePrevious = this.unsubscribe;
    this.main = main;
    startup.installed = true;
    this.installMainActivity(feed, fresh);
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
      compactions: entries?.length ?? this.main?.compaction?.compactions ?? null,
      last: this.lastCompaction ?? (last ? { status: 'completed', at: last.timestamp }
        : this.main?.compaction?.last ? { status: 'completed', at: this.main.compaction.last } : null),
    };
  }

  messages() { return this.main?.messages ?? []; }
  installMainActivity(feed, fresh) {
    this.mainFeed = feed;
    if (fresh) this.mainOwnedRoots.clear();
  }

  ownedChildren() {
    // A lifecycle from before `rows` gives them only with each helper's measurements.
    const rows = this.ownedLifecycle?.rows?.() ?? this.ownedLifecycle?.snapshot?.() ?? [];
    const groups = this.ownedActivity.project(rows);
    for (const id of this.mainOwnedRoots) {
      if (!this.ownedActivity.groups.has(id)) this.mainOwnedRoots.delete(id);
    }
    return groups;
  }

  /** The helpers of each run but the main chat's (`jobChildren`, by run id) and the main chat's (`mainChildren`), from one projection. */
  helpers() {
    const groups = Object.entries(this.ownedChildren());
    return {
      jobChildren: Object.fromEntries(groups.filter(([id]) => this.ownedActivity.groups.get(id).kind !== 'main')),
      mainChildren: groups.filter(([id]) => this.mainOwnedRoots.has(id)).flatMap(([, rows]) => rows),
    };
  }

  mainChildren() { return this.helpers().mainChildren; }
  jobChildren() { return this.helpers().jobChildren; }
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

  /**
   * Hobkin's own compaction. Pi's aborts whatever is running, so this takes only a free session and holds it, so no turn can start under it.
   * One begun `early`, before the chat is too full to wait, gives way to the user's next message (`yieldCompaction`).
   * The summary keeps what the user asked for in their own words, because a later turn takes those asks as its yes.
   */
  async compactMain({ early = false } = {}) {
    if (!this.mainFree || typeof this.main.compact !== 'function') return false;

    const release = this.reserveSession(this.main.sessionId);
    const compaction = { early, session: this.main, yielded: false };
    this.ownCompaction = compaction;
    try {
      await this.main.compact(readFileSync(new URL('../prompts/compaction.md', import.meta.url), 'utf8'));
      return true;
    } catch (error) {
      this.lastCompaction = {
        status: compaction.yielded ? 'cancelled' : 'failed',
        reason: 'hobkin',
        at: new Date().toISOString(),
        error: String(error.message ?? error),
      };
      return false;
    } finally {
      if (this.ownCompaction === compaction) this.ownCompaction = null;
      release();
    }
  }

  /**
   * Stops a compaction begun early, so a message from the user goes at once instead of a minute or two later. Pi's abort leaves the chat as
   * it was, and the next try waits as after a failed one. One begun because the chat is too full to wait goes on.
   */
  yieldCompaction() {
    const compaction = this.ownCompaction;
    if (!compaction?.early || compaction.yielded || compaction.session !== this.main) return;

    compaction.yielded = true;
    // Nothing waits on the abort: the message goes once the compaction ends, however it ends.
    void Promise.resolve().then(() => compaction.session.abort()).catch(() => {});
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
      if (ownedTurn) await this.stopTurn(ownedTurn).catch(error => this.quitHeld(previous, ownedTurn, error));
      const main = await this.connectMain(true);
      this.connecting = Promise.resolve(main);
      return { sessionId: main.sessionId, sessionFile: main.sessionFile };
    } finally {
      this.resetting = false;
      this.notify();
    }
  }

  /**
   * A reset must not wait forever on a tool that ignores the stop. When the stop stays unconfirmed and the main chat's Pi is a process of its
   * own, that Pi ends and the reset goes on to the fresh conversation.
   */
  async quitHeld(session, turn, error) {
    if (error?.code !== 'STOP_UNCONFIRMED' || typeof session.quit !== 'function') throw error;
    await session.quit();
    if (this.mainTurn === turn) {
      this.mainTurn = null;
      turn.release();
    }
  }

  /**
   * The user's stop, the way Esc stops Pi: what waits in Pi's queue comes out, and the turn ends once Pi has stopped. What it already said
   * stays in the conversation. Returns what the user sent that the agent never read, or null when no turn was running.
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
      turn.cleanup = cleanup;
      if (turn.owned && cleanup?.confirmed !== true) throw Error('Owned agent cleanup is unconfirmed.');
      turn.cancellationConfirmed = true;
    });
    const stopped = Promise.all([cancelled, recovery]).then(([, unread]) => unread);
    let outlasted = false;
    stopped.then(unread => { if (outlasted) this.letGo(turn, unread); }, () => {});
    turn.stopWork = Promise.race([
      stopped,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          outlasted = true;
          reject(Error('Stop completion or unread draft recovery is unconfirmed.'));
        }, this.stopWaitMs);
      }),
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

  /**
   * A stop that outlasted its wait, once Pi has stopped: with no other stop under way, the turn ends as an ordinary stop ends it, Chat says
   * so once and the window hears it. A message Pi never read keeps the conversation until the next stop gives it back. A reset takes the
   * turn itself.
   */
  letGo(turn, unread) {
    if (turn.stopWork || this.resetting || this.mainTurn !== turn) return;
    if (unread.length && !turn.draftsReturned) {
      turn.heldForUnread = true;
      this.notify();
      return;
    }
    this.mainTurn = null;
    this.noticeStop(turn);
    turn.release();
  }

  /** Chat's one line for a turn the user stopped, said once whichever way the turn stopped. */
  noticeStop(turn, now = Date.now()) {
    if (turn.stopNoticed) return;
    turn.stopNoticed = true;
    recordCardAction(this.directory, { id: `main-stop:${turn.id}`, did: 'stopped your turn', line: 'You stopped hobkin.' }, now);
  }

  /** `resume` admits a run that waited back to running, only while its record still says it waits (053-run-waits). */
  async admit(request, { resume = false } = {}) {
    this.check();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(request.id ?? '')
      || !['main', 'background', 'repair'].includes(request.kind)) {
      throw Error('Invalid dispatch identity.');
    }
    return this.change(state => {
      this.check();
      if (resume) {
        const run = state.runs[request.id];
        if (run?.status !== WAITING) return false;
        Object.assign(run, { status: 'running', resumedAt: new Date().toISOString() });
        return true;
      }
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
  /**
   * A `waiting` outcome is no ending (053-run-waits): the run keeps its record with until when and why, how many times it
   * has waited and whether its session began fresh, and no report is saved or logged. A run that waited before ends with
   * the `freshSession` it began with, so its cost still counts from the start of its session.
   */
  async finish(id, given) {
    if (!['completed', 'failed', 'interrupted', 'no_change', 'incomplete', WAITING].includes(given.status)) throw Error('Invalid completion status.');
    const finished = await this.change(state => {
      const run = state.runs[id];
      if (!run) throw Error('No dispatch admission exists.');
      const result = run.wait && given.status !== WAITING ? { ...given, freshSession: run.wait.freshSession === true } : given;
      if (run.status !== 'running') {
        if (JSON.stringify(run.result) !== JSON.stringify(result)) {
          throw Error('A conflicting receipt cannot replace a final outcome.');
        }
        return null;
      }
      if (result.status === WAITING) {
        Object.assign(run, {
          status: WAITING,
          cost: result.cost ?? run.cost ?? null,
          wait: { ...copy(result.wait), said: String(result.text ?? '').slice(0, 4000), waits: (run.wait?.waits ?? 0) + 1,
            freshSession: run.wait?.freshSession ?? result.freshSession === true },
          ...(result.performance ? { performance: copy(result.performance) } : {}),
        });
        return copy(run);
      }
      if (result.status === 'interrupted' && this.active.get(id)?.userStop) run.userStop = this.active.get(id).userStop;
      // A durable hobkin's turn answers on its own page and keeps no report.
      if (run.kind !== 'main' && !run.hobkin && !isQuietRun({ trigger: run.trigger, status: result.status, result })) {
        saveReport(this.directory, id, runReport(result));
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
    if (finished && finished.status !== WAITING) {
      recordUserStop(this.directory, finished);
      recordMainStop(this.directory, finished);
      logRun(this.directory, finished);
      recordRunFinished(this.directory, finished);
    }
    // The run as committed, a copy of its own, or null when it had already ended.
    return finished;
  }

  /**
   * The user's Stop of a run that waits, which has no process to stop: only while its record still says it waits, so
   * this or its start again wins and never both. It ends interrupted, its last words are its report, and the stop is
   * recorded as any user stop is. The run as committed, or null when it no longer waits.
   */
  async stopWaiting(id, stop = {}) {
    const finished = await this.change(state => {
      const run = state.runs[id];
      if (run?.status !== WAITING) return null;
      const result = {
        status: 'interrupted',
        text: run.wait?.said ?? '',
        error: `The user stopped it while it waited to carry on at ${clockTime(Date.parse(run.wait?.until))}.`,
        cost: run.cost ?? null,
        freshSession: run.wait?.freshSession === true,
      };
      run.userStop = { source: 'user', reason: String(stop.reason ?? 'Stopped by the user.').slice(0, 200) };
      if (run.kind !== 'main' && !run.hobkin && !isQuietRun({ trigger: run.trigger, status: result.status, result })) {
        saveReport(this.directory, id, runReport(result));
      }
      Object.assign(run, { status: 'interrupted', result, finishedAt: new Date().toISOString() });
      return copy(run);
    });
    if (finished) {
      recordUserStop(this.directory, finished);
      logRun(this.directory, finished);
      recordRunFinished(this.directory, finished);
    }
    return finished;
  }

  // Every check and work run passes here, whichever agent wrote its report, before anything saves or shows it. A durable hobkin's answer is not a report.
  edited(request, result, signal) {
    if (request.kind !== 'background' || request.hobkin || !this.editReport) return result;
    return this.editReport(result, { root: this.directory, signal });
  }

  /** `resume` starts again a run that waited, under its own id, and its start is not counted twice (053-run-waits). */
  dispatch(request, effect, onAdmitted, { resume = false } = {}) {
    if (this.active.has(request.id)) return this.active.get(request.id).completion;
    const controller = new AbortController();
    const active = { controller, request, closed: Promise.withResolvers() };
    const completion = Promise.resolve().then(async () => {
      if (!await this.admit(request, { resume })) return (await this.state()).runs[request.id];
      active.admitted = true;
      this.ownedActivity.track(request.id, request.kind);
      if (request.kind === 'main' && request.sessionId === this.main?.sessionId) this.mainOwnedRoots.add(request.id);
      if (!resume) recordRunStarted(this.directory, request);
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
      const ended = await this.finish(request.id, await this.edited(request, result, controller.signal));
      return ended ?? (await this.state()).runs[request.id];
    });
    active.completion = completion;
    this.active.set(request.id, active);
    return completion.then(run => {
      if (active.admitted) {
        const settled = () => {
          this.ownedActivity.settle(request.id);
          this.notify();
        };
        if (!active.transport || active.transportClosed) settled();
        else void active.closed.promise.then(settled);
      }
      return run;
    }).finally(() => {
      active.finished = true;
      if (!active.transport || active.transportClosed) this.active.delete(request.id);
    });
  }

  bindHarness(runId, harnessId, child) {
    const active = this.active.get(runId);
    if (!active?.admitted || active.request.kind === 'main' || active.request.harnessId !== harnessId || active.transport || active.finished) throw Error('Stale run/harness identity.');
    active.transport = child;
    child.closed.then(() => {
      active.transportClosed = true; active.closed.resolve(true);
      if (active.finished && this.active.get(runId) === active) this.active.delete(runId);
      this.notify();
    });
    if (active.forceRequested) { child.force(); active.controller.abort(); }
  }

  /**
   * Changes a working agent's model or thinking level from its next step, through its process handle (`changeBinding` in
   * `harnesses.mjs`). The run records what Pi holds now and keeps anything Pi did not say. Answers with the run's model and level.
   */
  async changeRun(runId, change) {
    const active = this.active.get(runId);
    if (!active || active.finished) throw Error('That agent is not working.');
    if (active.request.kind === 'main') throw Error("hobkin's own conversation changes its model in Settings.");
    if (!active.admitted) throw Error('That agent has not started yet.');
    if (!active.transport || typeof active.transport.changeBinding !== 'function') throw Error('Its process has not started yet.');
    if (active.transportClosed) throw Error('Its process has closed.');
    const held = await active.transport.changeBinding(change);
    return this.change(state => {
      const run = state.runs[runId];
      if (!run) return { model: held.model ?? null, effort: held.effort ?? null };
      if (held.model) run.model = held.model;
      if (held.effort) run.effort = held.effort;
      return { model: run.model ?? null, effort: run.effort ?? null };
    });
  }

  async forceRun(runId, stop = { source: 'user', reason: 'Stopped from the agent view.' }) {
    const active = this.active.get(runId);
    if (!active?.admitted || active.request.kind === 'main') {
      throw Error('Stale execution target.');
    }

    if (!active.userStop || stop.reason === 'Not approved.') {
      active.userStop = { source: 'user', reason: stop.reason };
    }
    active.forceRequested = true;

    let closure = active.closed.promise;
    try {
      if (active.transport && !active.transportClosed) {
        active.transport.force();
        active.controller.abort();
      }
    } catch (error) {
      closure = Promise.reject(error);
    }

    const descendants = this.ownedLifecycle?.targets?.().some(target => target.runId === runId)
      ? this.ownedLifecycle.force(runId)
      : Promise.resolve({ confirmed: true, agents: [] });
    const [closed, cleanup] = await Promise.all([
      controlWait(closure),
      controlWait(descendants),
    ]);

    return {
      closure: { status: closed === true ? 'confirmed' : 'unknown' },
      descendants: descendantReceipt(cleanup),
    };
  }

  async forceMain(turn) {
    if (this.mainTurn !== turn || this.main !== turn.session) {
      throw Error('Stale execution target.');
    }

    const supported = typeof turn.session.force === 'function';
    let closure;
    try {
      closure = supported ? turn.session.force() : undefined;
    } catch (error) {
      closure = Promise.reject(error);
    }

    const descendants = turn.owned && this.ownedLifecycle?.force
      ? this.ownedLifecycle.force(turn.id)
      : { confirmed: !turn.owned, agents: [] };
    const [closed, cleanup] = await Promise.all([
      controlWait(closure),
      controlWait(descendants),
    ]);

    return {
      closure: {
        status: supported ? closed === true ? 'confirmed' : 'unknown' : 'unsupported',
      },
      descendants: descendantReceipt(cleanup),
    };
  }

  stopControls() {
    const targets = [...this.active].filter(([, active]) => active.admitted && active.request.kind !== 'main')
      .map(([runId, active]) => ({ kind: 'run', runId, parentId: null, rootId: runId, label: active.request.title ?? runId, canStop: !active.finished, canForce: !active.transportClosed }));
    const turn = this.mainTurn;
    if (turn && turn.session === this.main && (turn.stopping || this.active.get(turn.id)?.admitted)) targets.unshift({ kind: 'main', runId: turn.id, parentId: null, rootId: turn.id, label: 'Main conversation', canStop: true, canForce: typeof turn.session.force === 'function' });
    return { targets: [...targets, ...(this.ownedLifecycle?.targets?.() ?? [])] };
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

  /** `began` says when the user sent these words and what they waited on since (`turnFrom`), for the turn's stage timings. */
  async send(text, id = randomUUID(), images, began) {
    // When the runtime took the words: a turn nobody timed counts from here.
    const handed = Date.now();
    this.check();
    if (!this.main) throw Error('Main conversation is not connected.');
    if (this.mainFault) throw Error(`Main chat stopped: ${this.mainFault.message} The next message opens it again.`);
    if (this.resetting) throw Error('Main conversation is resetting.');
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > MAX_MESSAGE_BYTES) throw Error(`Message must contain 1–${MAX_MESSAGE_BYTES} bytes.`);
    if (images && this.imageRefusal) throw Error(this.imageRefusal);

    const activeTurn = this.mainTurn;
    if (activeTurn?.session === this.main) {
      if (activeTurn.stopping) throw Error(activeTurn.heldForUnread ? STOP_AGAIN : MAIN_STOPPING);
      if (activeTurn.preflight && this.main.isStreaming && typeof this.main.steer === 'function') {
        return this.queueSteering(text, id, activeTurn, images);
      }
      if (this.mainBusy || this.main.isStreaming) throw Error(MAIN_BUSY);
      await this.mainWork;
      this.check();
      if (this.resetting) throw Error('Main conversation is resetting.');
      return this.send(text, id, images, began);
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
      const model = session.model?.provider && session.model.id ? `${session.model.provider}/${session.model.id}` : undefined;
      const metrics = createTurnMetrics({ ...identity, now: this.metricsNow, turn: { since: handed, origin: 'host', ...began,
        kind: 'main', engine: 'pi', model, effort: session.thinkingLevel, marks: { ...began?.marks, handed, admitted: Date.now() } } });
      const unsubscribe = session.subscribe((event, message) => metrics.observe(message ? { ...event, message } : event, identity));
      let outcome;
      const cancelChildren = () => { void turn.owned?.cancel(); };
      try {
        signal.throwIfAborted();
        // Helpers follow the same directions main does, whole, so a rule far down the file still reaches them.
        turn.owned = this.ownedLifecycle?.register({ id, allowHelpers: true, binding: {
          cwd: this.config.main.cwd, prompt: JSON.stringify({ task: text, directions: readDirections(this.directory) }),
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
        // Which parts of the system prompt this turn read, as hashes: a part that changed sends the whole conversation uncached.
        const parts = Object.fromEntries(Object.entries(session.promptParts ?? {}).filter(([, hash]) => /^[0-9a-f]{12}$/.test(hash)));
        if (Object.keys(parts).length) recordEvent(this.directory, 'turn_prompt', { id, parts });
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
    // The run as its finish committed it, which no later commit changes once it has ended.
    const completed = await active.completion;
    if (run.kind === 'main') await this.mainWork;
    const ended = completed ?? (await this.state()).runs[id];
    if (ended.status !== 'interrupted') return false;
    return true;
  }

  /** A close stops the main chat's Pi, and ends it when it is a process of its own that does not answer in time (`PiRpcSession.quit`). */
  quitMain() {
    const main = this.main;
    return typeof main?.quit === 'function' ? main.quit() : main?.abort();
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
        await this.reopening?.catch(() => {});
        await this.quitMain();
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
