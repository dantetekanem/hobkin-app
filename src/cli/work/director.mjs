import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { openCheck } from '../checks.mjs';
import { loadConfig } from '../config.mjs';
import { buildContext } from '../context.mjs';
import { recordEvent } from '../events.mjs';
import { runHarness as defaultRunHarness } from '../harnesses.mjs';
import { isTurnRunId } from '../hobkin-ids.mjs';
import { readMemory } from '../memory.mjs';
import { reportTriage } from '../reports.mjs';
import { tierBinding } from '../tiers.mjs';
import { afterMerges } from './after-merge.mjs';
import { budgetFor, fitsDay, fitsHour, hourShareOf, withStart } from './budget.mjs';
import { discoveryMessage, hobkinCommand } from './chat.mjs';
import { retireClosedTrees, surveyAndClose } from './closing.mjs';
import { declineStopped, toldStop } from './controls.mjs';
import { fileOpenIssues } from './issues.mjs';
import { watchBrief } from './launches.mjs';
import { toolsHere } from './machines.mjs';
import { nameOf } from './names.mjs';
import { watchPile } from './pairs.mjs';
import { countsAgainst, ideasWanted, planWork, skipsTheHour } from './plan.mjs';
import { recheckModels } from './proof-checks.mjs';
import { sameCodeAs } from './proofs.mjs';
import { reviewDue, reviewMessage, reviewView } from './review.mjs';
import { readSignals } from './signals.mjs';
import {
  answerCancel, chosenProjects, currentRequest, declinedToday, DISCOVERY_EVERY_MS, followUsage, foldersLeft, hasWorkToShow, issueMode, itemTree, landing, levels, nextDiscoveryAt, paths, pendingCancels,
  prFile, proposedProjects, readDiscovery, readItems, readMode, readProject, readProjects, readState, recordDiscovery, recordTokens, requestAllowance, retryItem, roomToFill, runnableStates, takeHanded,
  sessionError, sessionUsage, skipInQueue, tokenLabel, updateItem, workName, writeMode, writeOwnerView, writeState,
} from './store.mjs';
import { BRANCH_PREFIX, changesOnlyDocs, currentBranch, defaultBranch, enterFolder, folderRefusal, headBranch, leaveFolder, prepareTree, realPlace, releaseTree } from './tree.mjs';
import { readUnmerged } from './unmerged.mjs';
import { copyJson } from '../file-version.mjs';
import { lookAfterHarness, stampUpkeep, upkeepDue } from './upkeep.mjs';
import { offerSubscriptionPause, retireSubscriptionPause } from './subscription.mjs';
import { nextPause, usageLimitIn } from './usage.mjs';
import { readWatch, watchFolder } from './watcher.mjs';
import { openReadinessPulls } from './yolo-parts.mjs';
import { yoloPass } from './yolo-pass.mjs';
import { writeYoloReports } from './yolo-report.mjs';
import { reviewsByItself } from './yolo.mjs';

function withSessionCost(result, sessionFile) {
  const { usd, sessionId } = sessionUsage(sessionFile);
  return usd ? { ...result, cost: { usd, kind: 'estimate', cumulative: true, sessionId } } : result;
}

const HOUR_MS = 3600000;
const DISCOVERY_RETRY_MS = HOUR_MS / 4;
const WATCH_EVERY_MS = 24 * HOUR_MS;
// `gh` and `git` cost no tokens, but nothing here needs them every tick.
const SURVEY_EVERY_MS = HOUR_MS / 2;
const MAX_DISCOVERY_CONTINUATIONS = 2;
const MAX_NOTES_BYTES = 16384;
const MAX_ITEMS_SENT = 40;
const MAX_REASON_LENGTH = 500;
// These looks run tests, which write files, so they never run in the project's own folder.
const looksThatWrite = ['study', 'bugs', 'improvements'];
// Nothing else gives a run a deadline, and a run that has hung holds its worker for good.
const QUIET_MS = HOUR_MS;
const QUIET_REASON = 'It went quiet for an hour.';

const clone = promisify(execFile);
// A clone that hangs or asks for a password has no session to watch, so it gets a limit of its own.
const CLONE_TIMEOUT_MS = 10 * 60000;
const MOST_FOLDER_LINES = 10;
// hobkin runs from its own folder, so a run switching that folder's branch would change the code hobkin runs, mid-session.
const HOBKIN_FOLDER = fileURLToPath(new URL('../../..', import.meta.url));

const readBounded = file => {
  if (!existsSync(file)) return '';
  return Buffer.from(readFileSync(file)).subarray(0, MAX_NOTES_BYTES).toString('utf8');
};
const elapsedSince = (at, now) => (at ? now - Date.parse(at) : Infinity);
const firstLine = text => String(text ?? '').trim().split('\n', 1)[0].trim().slice(0, MAX_REASON_LENGTH);
const runError = run => firstLine(run?.result?.error ?? run?.error);
const laneKey = (slug, lane) => `${slug}:${lane}`;
// An older hobkin ran work in terminal panes and could leave an agent at work there as it closed. Without its report there is no telling whether it still works.
const LEFT_WITHOUT_REPORT = 'An older hobkin left this agent at work in a terminal pane as it closed, and it wrote no report. hobkin now runs work only as its own jobs, so the item waits at the end of the queue with its branch as it is.';
// A usage limit says nothing about the project, so it counts against nothing.
const notTheWork = run => Boolean(run?.result?.usageLimit);
// A stale Stop must not roll back a newer not-approved decision.
const declineMutations = new WeakMap();

/** Decides what runs next. Everything it knows lives in `work/`, so it can restart at any time. Every agent is a Pi job of the runner's, recorded with the other runs. */
export class WorkDirector {
  constructor({ root, config, runtime, runner, runHarness = defaultRunHarness, now = Date.now, onChange = () => {}, onDraftDone = () => {}, onHandOff, gh, fetch, ownFolder = HOBKIN_FOLDER }) {
    Object.assign(this, { root, config, runtime, runner, runHarness, now, onChange, onDraftDone, onHandOff, gh, fetch, ownFolder });
    this.active = new Map();
    // When the last run started survives a restart, so a new owner keeps the gap instead of starting two at once.
    this.lastStartAt = Date.parse(readMode(root).lastStartAt) || null;
  }

  running() { return [...this.active.values()]; }

  /** What only the owner can know, for the plan and for the tab. A check takes a place, because it shares the same subscription. */
  outlook() {
    return {
      running: this.running(),
      // A durable hobkin's turn is the user's own and takes no place from work mode.
      checks: [...this.runner.jobs.keys()].filter(id => !id.startsWith('work:') && !isTurnRunId(id)).length,
      lastStartAt: this.lastStartAt,
    };
  }

  /** Commands run in other processes, so what is in `active` reaches them through a file. A write only when something changed keeps an idle owner quiet. */
  publish() {
    const view = { ...this.outlook(), running: this.running().map(({ meter, ...run }) => run) };
    const text = JSON.stringify(view);
    if (text === this.published) return;
    this.published = text;
    writeOwnerView(this.root, view);
  }

  // A kill lasts until its run ends, and a run stuck getting ready may not end, so no tick waits for one.
  killRun(id) {
    this.runner.kill(id).catch(() => {});
  }

  // A no waits for its run to end, so nothing the run records on its way out can stand over it. A run that already ended has nothing to stop.
  async stopRun(id, { decline = false, stopOperation = (id, stop) => this.runner.kill(id, stop) } = {}) {
    const run = this.running().find(entry => entry.id === id);
    if (!run) return null;
    const wasDeclined = run.declined;
    const mutation = run.item && decline ? { previous: declineMutations.get(run) } : null;
    if (mutation) {
      run.declined = true;
      declineMutations.set(run, mutation);
    }
    const rollback = () => {
      if (!mutation || declineMutations.get(run) !== mutation) return;

      run.declined = wasDeclined;
      if (mutation.previous) {
        declineMutations.set(run, mutation.previous);
      } else {
        declineMutations.delete(run);
      }
    };

    try {
      const stopped = await stopOperation(id, { source: 'user', reason: decline ? 'Not approved.' : 'Stopped for now.' });
      if (stopped) return run;

      rollback();
      return null;
    } catch (error) {
      if (error.code !== 'STOP_UNCONFIRMED') rollback();
      throw error;
    }
  }

  /** `k` on an agent, once the user has picked how it stops. What they picked is told, so the main agent hears it with their next message. */
  async stopFromScreen(id, how, stopOperation) {
    const decline = how === 'decline';
    const run = await this.stopRun(id, { decline, stopOperation });
    return toldStop(this.root, run, { decline });
  }

  // A request is answered before the kill, so one that fails cannot stop every tick after it. This is `k` from another process.
  answerCancels() {
    for (const { run, decline } of pendingCancels(this.root)) {
      answerCancel(this.root, run, this.now());
      void this.stopRun(run, { decline }).catch(error => {
        recordEvent(this.root, 'work_stop_failed', { runId: run, error: String(error.message ?? error) });
      });
    }
  }

  // Turning work mode off starts nothing new. Project agents finish, but a look stops: it only reads, it carries on from its notes, and nothing shows what it spends once the tab is gone.
  async tick() {
    this.pickUpHanded();
    this.recoverDiscovery();
    this.tellNewProposals();
    // Agents keep working after the mode goes off, so these do too.
    this.meterRuns();
    this.answerCancels();
    await this.guardFolders();
    this.publish();
    // Work merges whether the mode is on or not, and finding that costs no tokens.
    this.surveyWork();
    // A merge is the work done, mode on or not: what each one left is told, and its issue closed.
    this.settleMerges();
    this.dropFinishedPicks();

    const mode = readMode(this.root);
    this.reviewWeek(mode);
    this.lookAfterItself();
    if (!mode.enabled) {
      this.stopLook();
      return;
    }

    this.watchChanges(mode);

    const current = readMode(this.root);
    const { pause, budget, next, shipFirst, subscription } = planWork(this.root, { mode: current, now: this.now(), ...this.outlook() });
    watchPile(this.root, shipFirst, this.now());
    if (['day', 'hour'].includes(pause?.kind)) this.holdDiscovery();
    // New issues come in only while nothing holds work: no pause, no stop and budget left.
    if (!pause) this.pickUpIssues();
    this.tellPause(pause, current);
    // Ahead of the subscription's pace, hobkin tells and asks, and work carries on unless the user pauses it.
    retireSubscriptionPause(this.root, subscription.ahead, this.now());
    if (offerSubscriptionPause(this.root, subscription.ahead, this.now())) this.onChange();
    if (pause?.kind === 'day') this.askForAllowance(current, budget);
    // Schedules are not held. Only new work waits, and the next tick picks it up.
    if (next && !this.runtime.workWaitsForChat) this.begin(next, budget, current);
  }

  // The next tick can find the look still stopping, and it only needs telling once.
  stopLook() {
    const look = this.active.get('discover');
    if (!look || look.stopping) return;
    look.stopping = true;
    this.killRun(look.id);
  }

  // Code only, with no model. It comes before the mode check, because whether work mode is running is the first thing it answers.
  reviewWeek(mode) {
    if (!chosenProjects(this.root).length) return;
    const now = this.now();
    const at = new Date(now).toISOString();
    if (!mode.lastReviewAt) writeMode(this.root, { lastReviewAt: at });
    if (!reviewDue(mode, now)) return;

    const view = reviewView(this.root, now);
    writeMode(this.root, { lastReviewAt: at, review: { at, message: reviewMessage(view), stale: view.stale } });
    this.onChange();
  }

  // Code only, with no model, mode on or off. The clock goes first, because a problem here costs one day's pass and must never stop a tick.
  lookAfterItself() {
    const now = this.now();
    if (!upkeepDue(this.root, now)) return;
    stampUpkeep(this.root, now);
    try {
      lookAfterHarness(this.root, { now });
      this.onChange();
    } catch {
      // Tomorrow's pass reads its own day.
    }
  }

  /** A pick whose item finished another way, by a merge, a done or a drop, would sit in the list for good, so it leaves it. One that waits on the user keeps its place. */
  dropFinishedPicks() {
    const { queueNext, queueNow } = readMode(this.root);
    const stillWanted = key => {
      const [kind, slug, id] = key.split(':');
      if (kind !== 'item') return true;
      const state = readItems(this.root, slug).find(item => item.id === id)?.state;
      return [...runnableStates, 'waiting'].includes(state);
    };
    const kept = queueNext.filter(stillWanted);
    if (kept.length < queueNext.length) {
      writeMode(this.root, {
        queueNext: kept,
        queueNow: queueNow.filter(key => kept.includes(key)),
      });
    }
  }

  /** One start per tick, and the plan keeps them spaced out, so each run shows what it costs before the next one begins. What starts by itself spends its priority's runs. */
  begin(entry, { used, limit }, mode) {
    this.lastStartAt = this.now();
    const lastStartAt = new Date(this.lastStartAt).toISOString();
    const priority = countsAgainst(entry);
    const without = keys => keys.filter(key => key !== entry.key);
    // A start that fills room the user added takes one of those workers.
    const room = roomToFill(mode, this.lastStartAt);
    writeMode(this.root, {
      lastStartAt,
      ...(room > 0 ? { roomAdded: { ...mode.roomAdded, count: room - 1 } } : {}),
      ...(entry.picked ? { queueNext: without(mode.queueNext), queueNow: without(mode.queueNow) } : {}),
      ...(priority ? { countedStarts: withStart(mode.countedStarts, priority, this.lastStartAt) } : {}),
    });
    const tokens = { today: used, limit };
    const cost = { estimate: entry.estimate, kind: entry.lane === 'do' ? 'do' : entry.kind, planKey: entry.key, grade: entry.grade };
    if (entry.lane === 'discover') return this.startDiscovery(mode.folder, tokens, cost);
    const project = readProject(this.root, entry.slug);
    if (entry.lane === 'do') return this.startDo(project, entry.item, cost);
    return this.startLook(project, entry.focus, tokens, cost);
  }

  /**
   * Sessions are followed as they grow, so a long run counts while it runs. The final figure replaces this when it ends.
   * A session that stops growing is a run that has hung. One with no session to read yet says nothing either way.
   */
  meterRuns() {
    const now = this.now();
    for (const run of this.running()) {
      this.meterRun(run);
      if (run.stalled || run.activityUnknown || run.lastActivityAt === null || now - run.lastActivityAt < QUIET_MS) continue;
      run.stalled = true;
      this.killRun(run.id);
    }
  }

  meterRun(run) {
    const { offset = 0, grewAt = null } = run.meter ?? {};
    const meter = followUsage(run.sessionFile, run.meter);
    run.meter = { ...meter, grewAt: meter.offset > offset ? this.now() : grewAt };
    const rows = this.runtime.ownedLifecycle?.snapshot(run.id);
    const children = new Map((rows ?? run.children ?? [])
      .filter(child => child.rootId === run.id && child.id !== run.id)
      .map(child => [child.id, child]));
    run.children = [...children.values()];
    run.tokens = meter.tokens;
    run.cached = meter.cached;
    run.childReserved = 0;
    run.usageIncomplete = false;
    run.cleanupUnknown = false;
    run.incompleteEvents ??= {};
    run.lastActivityAt = run.meter.grewAt;
    run.activityUnknown = false;
    for (const child of run.children) {
      const terminal = ['completed', 'failed', 'cancelled'].includes(child.status);
      const usage = child.usage;
      const amount = field => usage?.[field]?.value ?? 0;
      const tokens = amount('input') + amount('cacheWrite') + amount('output');
      const incomplete = !usage || usage.incomplete
        || ['input', 'output', 'cacheRead', 'cacheWrite'].some(field => usage[field]?.state !== 'complete')
        || (terminal && !usage.sealed);
      run.tokens += tokens;
      run.cached += amount('cacheRead');
      run.usageIncomplete ||= incomplete;
      run.cleanupUnknown ||= child.status === 'unknown'
        || !terminal && child.status !== 'running' && child.status !== 'queued' && child.status !== 'cancelling';
      if (terminal && incomplete) run.incompleteEvents[child.id] ??= new Date(this.now()).toISOString();
      if (!terminal) run.childReserved += Math.max(0, (run.estimate?.fresh ?? 0) - tokens);
      if (Number.isFinite(child.lastActivityAt)) run.lastActivityAt = Math.max(run.lastActivityAt ?? 0, child.lastActivityAt);
      else if (!terminal) run.activityUnknown = true;
    }
  }

  admitHelper(entry, { rootId, parentId }) {
    if (rootId !== entry.id || !this.running().includes(entry) || this.runner.stopped
      || entry.stopping || entry.declined || entry.stalled || entry.moved) return false;
    const mode = readMode(this.root);
    const now = this.now();
    if (!mode.enabled || mode.pausedAt || mode.queueSkipped.includes(entry.planKey)
      || [mode.usagePause, mode.subscriptionPause].some(pause => Date.parse(pause?.until) > now)
      || pendingCancels(this.root).some(cancel => cancel.run === entry.id)) return false;
    if (entry.slug) {
      const project = readProject(this.root, entry.slug);
      if (project?.state !== 'chosen' || project.paused) return false;
      if (entry.item && readItems(this.root, entry.slug).find(item => item.id === entry.item)?.state !== 'doing') return false;
    }
    if (!Array.isArray(this.runtime.ownedLifecycle?.snapshot(entry.id))) return false;
    for (const run of this.running()) this.meterRun(run);
    if (parentId !== entry.id && !entry.children.some(child => child.id === parentId && child.status === 'running')) return false;
    const fresh = entry.estimate?.fresh;
    const budget = budgetFor(this.root, mode, now, this.running());
    return Number.isFinite(fresh) && fresh >= 0 && !budget.helperHold && fitsDay(budget, fresh)
      && (skipsTheHour(entry) || fitsHour(budget, fresh));
  }

  // A run works on its own branch in the user's folder. If the folder has left that branch, whatever it commits next lands somewhere else.
  // During a rebase there is no branch to read, and the run's own rebase is no reason to leave the folder in the middle of one.
  async guardFolders() {
    for (const run of this.running()) {
      const { folder } = run;
      if (!folder?.branch || run.moved) continue;
      const branch = await headBranch(folder.repo);
      if (!branch || branch === folder.branch) continue;
      run.moved = true;
      this.killRun(run.id);
    }
  }

  // Code only: no model and no tokens. It runs by itself, because a slow disk should not hold a tick.
  watchChanges({ folder }) {
    const last = readWatch(this.root);
    if (this.watching || !folder || (last?.folder === folder && elapsedSince(last.at, this.now()) < WATCH_EVERY_MS)) return;
    this.watching = watchFolder(this.root, { folder, now: this.now() }).catch(() => {}).finally(() => {
      this.watching = null;
      this.onChange();
    });
  }

  // Code only: what each merge left for the user is told in Chat, and the GitHub issue it came from is closed, at once or once the deploy that
  // carried it held. "Deploy now?" is asked here, and a yes to it goes to the main agent. It runs by itself, because gh must not hold a tick.
  settleMerges() {
    if (this.settlingMerges) return;
    const handOff = this.onHandOff ? { handOff: this.onHandOff } : {};
    this.settlingMerges = afterMerges(this.root, { now: this.now(), ...(this.gh ? { gh: this.gh } : {}), ...handOff })
      .then(followed => {
        if (followed.length) this.onChange();
      })
      .catch(() => {})
      .finally(() => { this.settlingMerges = null; });
  }

  // Code only: gh reads the issues of the projects that pick them up, and the new ones are filed. It runs by itself, because gh must not hold a tick.
  pickUpIssues() {
    if (this.pickingUp) return;
    this.pickingUp = fileOpenIssues(this.root, { now: this.now(), ...(this.gh ? { gh: this.gh } : {}) })
      .then(filed => {
        if (filed.length) this.onChange();
      })
      .catch(() => {})
      .finally(() => { this.pickingUp = null; });
  }

  // After the survey, so what it found merged lets go of its tree on the same pass. A tree that cannot go yet is asked about again next time.
  surveyWork() {
    if (this.surveying || elapsedSince(readUnmerged(this.root).at, this.now()) < SURVEY_EVERY_MS) return;
    if (!chosenProjects(this.root).length) return;
    this.surveying = surveyAndClose(this.root, { now: this.now(), ...(this.gh ? { gh: this.gh } : {}), ...(this.fetch ? { fetch: this.fetch } : {}) })
      // Only this survey, the owner's own, lets a change merge by itself, and only while the user has YOLO mode on (`yolo-pass.mjs`).
      .then(() => yoloPass(this.root, { now: this.now(), ...(this.onHandOff ? { handOff: this.onHandOff } : {}) }))
      // Each project's YOLO report says what the pass found and did, written only where its words changed (`yolo-report.mjs`).
      .then(merged => {
        const reported = writeYoloReports(this.root, { now: this.now() });
        if (merged.length || reported.length) this.onChange();
      })
      .catch(() => {})
      // Each branch readiness made is offered as a PR by itself, YOLO mode on or off, since the user asked readiness to open them (`yolo-parts.mjs`).
      .then(() => openReadinessPulls(this.root, { now: this.now(), ...(this.gh ? { gh: this.gh } : {}) }))
      .then(opened => {
        if (opened.length) this.onChange();
      })
      .catch(() => {})
      // hobkin's own weekly check of each TLA+ model on a default branch, one at a time (`proof-checks.mjs`).
      .then(() => recheckModels(this.root, { now: this.now(), survey: readUnmerged(this.root).projects }))
      .catch(() => {})
      .then(() => retireClosedTrees(this.root, { running: this.running() }))
      .catch(() => {})
      .finally(() => { this.surveying = null; });
  }

  // Once for each pause, in Chat. The tab keeps the live numbers, and a daily pause speaks through its question.
  tellPause(pause, mode) {
    if (!['hour', 'usage'].includes(pause?.kind)) return;
    const day = new Date(this.now()).toDateString();
    const id = pause.kind === 'usage' ? `usage:${mode.usagePause.at}` : `${pause.kind}:${day}`;
    if (mode.pauseNotice?.id === id) return;
    const tone = pause.kind === 'hour' ? 'useful' : 'critical';
    writeMode(this.root, { pauseNotice: { id, at: new Date(this.now()).toISOString(), line: pause.line, tone } });
    this.onChange();
  }

  // Pausing is not stopping: running agents finish and items stay. The user just gets the choice, once, with what it would change.
  askForAllowance(mode, { used, limit }) {
    const asked = currentRequest(mode, this.now());
    if (asked?.limit === limit || declinedToday(mode, this.now())) return;

    const waiting = chosenProjects(this.root).flatMap(project => readItems(this.root, project.slug)
      .filter(item => runnableStates.includes(item.state))
      .map(item => ({ item, project })));
    if (!waiting.length) return;

    const proposed = limit * 2;
    const hourShare = hourShareOf(proposed);
    const [{ item, project }] = waiting;
    const count = waiting.length === 1 ? '1 item is' : `${waiting.length} items are`;
    const reason = `Paused for today: ${tokenLabel(used)} of the ${tokenLabel(limit)} daily limit used. ${count} waiting, starting with "${item.title}" on ${project.name}. `
      + `Raising today's limit to ${tokenLabel(proposed)} lets them run today and makes the hourly share ${tokenLabel(hourShare)} until midnight. `
      + `Tomorrow it is back to ${tokenLabel(mode.dailyTokens)}. Otherwise they wait until tomorrow.`;
    requestAllowance(this.root, { limit, proposed, used, hourShare, atLimit: true, reason }, this.now());
    this.onChange();
  }

  // Marked running with no agent behind it, a look lost its owner: Hobkin was killed, not closed, so it ends here.
  recoverDiscovery() {
    if (this.active.has('discover') || readDiscovery(this.root).status !== 'running') return;
    recordDiscovery(this.root, { status: 'interrupted', finishedAt: new Date(this.now()).toISOString() });
    writeMode(this.root, { lastDiscoveryAt: null });
  }

  // A proposal can arrive with no look behind it, and an imported one was never told, so nothing here waits for a look to end.
  tellNewProposals() {
    const { status, told = [] } = readDiscovery(this.root);
    if (this.active.has('discover') || status === 'continuing') return;

    const isNew = ({ slug }) => !told.includes(slug);
    if (proposedProjects(this.root).some(isNew)) this.concludeDiscovery({ status: 'offered' });
  }

  // Tokens stop the next run in a chain, so the user hears what it has so far instead of waiting for the limit to lift.
  holdDiscovery() {
    const { status, folder } = readDiscovery(this.root);
    if (status !== 'continuing') return;

    this.concludeDiscovery({ status: 'unfinished', folder, reason: 'The token limit stopped it.', nextAt: null });
  }

  /**
   * The model and effort of a look or a do: the tier the project's level gives that kind of run, read as the tiers
   * stand now. A tier with a model of its own brings its effort too. One that follows the chat or the checks model
   * keeps the effort the level always gave.
   */
  bindingFor(level, lane) {
    let config = this.config;
    try {
      config = loadConfig(this.root);
    } catch {
      // No configuration on disk to read just now: the tiers are as this director was given them.
    }
    const { model, effort, follows } = tierBinding(config, levels[level][`${lane}Tier`]);
    return { model, effort: follows ? levels[level][`${lane}Effort`] : effort };
  }

  /** What a named tier runs with now, for a run that takes its tier from what it does and not from its project's level. A tier with no model of its own thinks as hard as `effort`. */
  bindingOfTier(tier, effort) {
    let config = this.config;
    try {
      config = loadConfig(this.root);
    } catch {
      // No configuration on disk to read just now: the tiers are as this director was given them.
    }
    const bound = tierBinding(config, tier);
    return { model: bound.model, effort: bound.follows ? effort : bound.effort };
  }

  command(subcommand) {
    return hobkinCommand(this.root, `work ${subcommand}`);
  }

  /** Exact commands, so the main agent's answer lands in this home whatever is on its path. */
  answerCommands() {
    return {
      choose: this.command('choose <slug> [max|critical|important|casual]'),
      skip: this.command('skip <slug>'),
      drop: this.command('drop <slug>'),
      allow: this.command('allow [tokens | no]'),
      resume: this.command('resume'),
      ship: this.command('ship [on|off]'),
    };
  }

  describe(project) {
    const { slug, name, level, summary } = project;
    const { project: notes, directions } = paths(this.root, slug);
    const items = readItems(this.root, slug).slice(-MAX_ITEMS_SENT)
      .map(({ id, key, kind, title, state, pr }) => ({ id, key, kind, title, state, pr }));
    return {
      project: { slug, name, level, summary, checkout: project.path ?? paths(this.root, slug).clone, issues: issueMode(project) },
      projectFile: notes,
      projectNotes: readBounded(notes),
      directions: readBounded(directions),
      items,
      commands: {
        item: this.command(`item ${slug}`),
        tree: this.command(`tree ${slug}`),
        // A TLA+ model is checked by hobkin itself, never with java, so the run it records is evidence the agent cannot write.
        proof: hobkinCommand(this.root, `proof check --project ${slug}`),
      },
    };
  }

  async repositoryFor(project) {
    const repo = project.path ?? paths(this.root, project.slug).clone;
    if (existsSync(repo) || !project.remote) return repo;

    await clone('git', ['clone', '--quiet', project.remote, repo], {
      timeout: CLONE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return repo;
  }

  /**
   * Where a run works, decided as it starts: the project's own folder when that is safe right now, and a worktree when it is not.
   * Only the worktree path resets anything, so the folder the user works in can be switched and never cleaned.
   */
  async place(entry, { project, tree, branch, resume, writes = false }) {
    const repo = await this.repositoryFor(project);
    // An item cut short in the one tree every item shared before still has its work there, on its branch, and git lets no other tree take that branch.
    const { oldDoTree } = paths(this.root, project.slug);
    const leftInOldTree = resume && await currentBranch(oldDoTree) === branch;
    const workTree = leftInOldTree ? oldDoTree : tree;

    const sharing = this.running().some(run => run !== entry && run.slug === project.slug);
    const writing = branch ? 'this item rebases' : 'this look runs tests';
    let reason = writes ? writing : sharing ? 'another agent is in this repository' : null;
    if (!reason && realPlace(repo) === realPlace(this.ownFolder)) reason = 'hobkin runs from this folder';
    if (!reason && resume && await currentBranch(workTree) === branch) reason = 'its work is there';
    if (!reason) {
      const { refused, base } = await enterFolder({ repo, branch });
      if (!refused) return { cwd: repo, folder: { repo, branch, base } };
      reason = refused;
    }
    await prepareTree({ repo, tree: workTree, branch, resume });
    return { cwd: workTree, tree: workTree, note: `Worktree: ${reason}` };
  }

  // An item still in the queue has no outcome yet, whoever put it there, and the next run carries on from what this one left.
  recordedOutcome(slug, id) {
    const state = readItems(this.root, slug).find(item => item.id === id)?.state;
    return Boolean(state) && !runnableStates.includes(state);
  }

  /**
   * A run hands the folder back as it found it. If that cannot be done it stays as it is, nothing in it is changed, and Chat says why once,
   * by the project and the work. A tree lets go of its branch, so the user can check that out.
   */
  async leave(slug, id, { folder, tree }) {
    if (tree) await releaseTree(tree, { finished: this.recordedOutcome(slug, id) });
    if (!folder) return;
    if (!folder.branch) {
      const refused = await folderRefusal(folder.repo);
      writeState(this.root, slug, { folderNote: refused && `After the look, ${refused}.` });
      return;
    }

    const { moved, stays } = await leaveFolder(folder) ?? {};
    const note = moved ? `It is on ${moved} now, so hobkin left it there.` : stays ? `It stays on the run's branch, because ${stays}.` : null;
    writeState(this.root, slug, { folderNote: note });
    if (stays) this.sayAboutFolder(slug, `${this.folderOf(slug)} stays on the branch for "${this.titleOf(slug, id)}", because ${stays}. Nothing in it was changed.`);
  }

  folderOf(slug) { return `${nameOf(readProject(this.root, slug))}'s folder`; }

  titleOf(slug, id) { return readItems(this.root, slug).find(item => item.id === id)?.title ?? 'its work'; }

  /** What the user needs to know about their own folder is said once in Chat, as a system line, and never sits in the tab as an error. */
  sayAboutFolder(slug, line) {
    const at = new Date(this.now()).toISOString();
    const told = [...readMode(this.root).folderLines ?? [], { key: `folder:${slug}:${at}`, line, at }];
    writeMode(this.root, { folderLines: told.slice(-MOST_FOLDER_LINES) });
  }

  // Only a look that finished starts clean. Anything else left a list to pick up, here and in `checkMemory`.
  startDiscovery(folder, tokens, cost = {}) {
    const startedAt = new Date(this.now()).toISOString();
    const last = readDiscovery(this.root);
    const resuming = last.folder === folder && last.status !== 'finished';
    const { rootFolders, finishedFolders, repositories } = resuming ? last : {};
    const continuation = last.status === 'continuing' ? (last.continuation ?? 0) + 1 : 0;
    const carryOn = resuming ? ' An earlier run stopped before it finished, so carry on from where it stopped.' : '';
    writeMode(this.root, { lastDiscoveryAt: startedAt });
    recordDiscovery(this.root, {
      status: 'running',
      folder,
      startedAt,
      continuation,
      rootFolders,
      finishedFolders,
      repositories,
      told: last.told,
      lastFailure: last.status === 'failed' ? last.reason : last.lastFailure,
    });
    const cwd = join(this.root, 'work');
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    this.start({
      key: 'discover',
      lane: 'discover',
      title: 'Finding projects',
      purpose: 'work-discover',
      cwd,
      ...cost,
      model: this.config.main.model,
      effort: 'medium',
      instructions: `Find the projects in ${folder} and propose the ones worth working on.${carryOn}`,
      work: () => ({
        lane: 'discover',
        folder,
        tokens,
        ...(rootFolders ? { folders: { root: rootFolders, finished: finishedFolders ?? [] } } : {}),
        known: readProjects(this.root).map(({ slug, path, state }) => ({ slug, path, state })),
        commands: { propose: this.command('propose'), progress: this.command('progress') },
      }),
      settle: run => this.settleDiscovery(run, folder),
    });
  }

  // A run only says it stopped. The folder list says whether the look is done, so a clean stop with folders left is not.
  discoveryOutcome(run, enabled) {
    if (run?.status === 'interrupted') return { status: 'cancelled' };
    if (run?.status !== 'completed') return { status: 'failed', reason: runError(run) || 'The run ended without saying why.' };

    const triage = reportTriage(run);
    const reason = triage?.message ?? (firstLine(run.result?.text) || 'The agent did not say why.');
    const discovery = readDiscovery(this.root);
    if (foldersLeft(discovery)?.length === 0) return { status: 'finished', reason };

    const carriesOn = enabled && (discovery.continuation ?? 0) < MAX_DISCOVERY_CONTINUATIONS;
    return { status: carriesOn ? 'continuing' : 'unfinished', reason };
  }

  // `null` means look again as soon as nothing stands in the way.
  clockAfter(status, enabled) {
    const now = this.now();
    if (status === 'interrupted' || status === 'continuing') return null;
    if (status === 'failed') return new Date(now - DISCOVERY_EVERY_MS + DISCOVERY_RETRY_MS).toISOString();
    return status === 'unfinished' && !enabled ? null : new Date(now).toISOString();
  }

  /** Closing Hobkin is not an outcome, so that look just starts over. Everything else ends with the user being told. */
  settleDiscovery(run, folder) {
    const { enabled, folder: currentFolder } = readMode(this.root);
    const closing = run?.status === 'interrupted' && this.runner.stopped;
    const { status, reason } = closing || notTheWork(run) ? { status: 'interrupted' } : this.discoveryOutcome(run, enabled);

    // A folder named during the run has its own look coming, so this one leaves the clock alone.
    if (currentFolder === folder) writeMode(this.root, { lastDiscoveryAt: this.clockAfter(status, enabled) });

    if (status === 'interrupted' || status === 'continuing') {
      recordDiscovery(this.root, { status, reason, finishedAt: new Date(this.now()).toISOString() });
    } else {
      this.concludeDiscovery({ status, reason, folder });
    }
  }

  /** Each proposal is told once, a repeated failure is not told again, and a quiet day with projects says nothing. A look that finished has no other coming. */
  concludeDiscovery({ status, reason, folder, nextAt = status === 'finished' ? null : nextDiscoveryAt(readMode(this.root)) }) {
    const now = this.now();
    const discovery = readDiscovery(this.root);
    const { told = [], lastFailure } = discovery;
    const proposals = proposedProjects(this.root);
    const hasNews = proposals.some(({ slug }) => !told.includes(slug));
    const isNewFailure = status === 'failed' && reason !== lastFailure;
    const foundNothing = status === 'finished' && !hasWorkToShow(this.root);
    const worthSaying = hasNews || isNewFailure || foundNothing || status === 'unfinished';
    const message = worthSaying
      ? discoveryMessage({ folder: folder ?? discovery.folder, proposals, status, reason, left: foldersLeft(discovery), nextAt, now }) : '';
    recordDiscovery(this.root, {
      ...(status === 'offered' ? {} : { status, reason, offered: proposals.length }),
      finishedAt: new Date(now).toISOString(),
      told: [...new Set([...told, ...proposals.map(({ slug }) => slug)])],
      ...(message ? { message } : {}),
    });
  }

  // A focus that records through a command of its own gets that command, and what it needs to read.
  describeLook(project, focus) {
    const { slug } = project;
    const described = this.describe(project);
    // The state machines look pipes each machine it found, with its files, which readiness and the YOLO pass read (`machines.mjs`).
    if (focus === 'state-machines') return { ...described, commands: { ...described.commands, machines: this.command(`machines ${slug}`) } };
    const reads = { signals: () => readSignals(this.root, slug), watch: () => watchBrief(this.root, slug) }[focus];
    if (!reads) return described;
    return { ...described, [focus]: reads(), commands: { ...described.commands, [focus]: this.command(`${focus} ${slug}`) } };
  }

  startLook(project, focus, tokens, cost = {}) {
    const { slug, level } = project;
    const state = readState(this.root, slug);
    const now = new Date(this.now()).toISOString();
    const lens = { lastLookAt: now, lastLensAt: now, lensIndex: (state.lensIndex ?? 0) + 1, newCommits: 0 };
    const stampedBy = {
      study: { lastLookAt: now },
      ideas: { lastIdeasAt: now },
      // A look started with the TLA+ tools in place is the one readiness waits for (`plan.mjs`).
      'state-machines': { lastLookAt: now, lastMachinesAt: now, ...(toolsHere(this.root) ? { lastMachinesTlcAt: now } : {}) },
      signals: { lastSignalsAt: now },
      watch: { lastWatchAt: now },
    };
    const stamped = stampedBy[focus] ?? lens;
    const earlier = Object.fromEntries(Object.keys(stamped).map(key => [key, state[key] ?? null]));
    writeState(this.root, slug, stamped);
    const ideas = focus === 'ideas' ? { ideas: ideasWanted(this.root, slug, { used: tokens.today, limit: tokens.limit }) } : {};

    const tree = paths(this.root, slug).lookTree;
    this.start({
      key: laneKey(slug, 'look'),
      lane: 'look',
      slug,
      title: `${project.name}: ${focus}`,
      purpose: 'work-look',
      cwd: tree,
      level,
      ...cost,
      // The weekly state-machines look is a deep read of the whole project: it runs on the max tier, whatever the project's level.
      ...(focus === 'state-machines' ? this.bindingOfTier('max', 'xhigh') : this.bindingFor(level, 'look')),
      instructions: `Look at ${project.name} with the focus ${focus}.`,
      prepare: entry => this.place(entry, { project, tree, writes: looksThatWrite.includes(focus) }),
      work: place => ({ lane: 'look', focus, tokens, place, ...ideas, ...this.describeLook(project, focus) }),
      settle: run => this.settleLook(slug, run, earlier),
    });
  }

  // The tab is the only place a failed look shows, because a busy project stays out of Chat. A look the work had no part in stopping comes round again.
  settleLook(slug, run, earlier) {
    if (run?.status === 'interrupted') return;
    if (notTheWork(run)) {
      writeState(this.root, slug, earlier);
      return;
    }

    const lookError = run?.status === 'completed' ? null : runError(run) || 'The look failed.';
    writeState(this.root, slug, { lookError });
  }

  describeFor(project, { id }) {
    const described = this.describe(project);
    const decide = hobkinCommand(this.root, `decide work ${project.slug} ${id}`);
    // Where a project's readiness run records what it found (`yolo.mjs`), which only that run's record is kept from.
    const yolo = this.command(`yolo ${project.slug}`);
    const proof = hobkinCommand(this.root, `proof check --project ${project.slug} --item ${id}`);
    return { ...described, commands: { ...described.commands, decide, yolo, proof } };
  }

  startDo(project, item, cost = {}) {
    const { slug } = project;
    const level = item.max ? 'max' : project.level;
    const branch = item.branch ?? `${BRANCH_PREFIX}${workName(item)}`;
    const resume = Boolean(item.branch);
    updateItem(this.root, slug, item.id, { state: 'doing', branch }, this.now());

    // A fix on another item's branch is an item of its own, so it gets a tree of its own too.
    const tree = itemTree(this.root, slug, item);
    const description = prFile(this.root, slug, item.ships ?? item.id);
    mkdirSync(dirname(description), { recursive: true, mode: 0o700 });
    this.start({
      key: laneKey(slug, 'do'),
      lane: 'do',
      slug,
      item: item.id,
      title: `${project.name}: ${item.title}`,
      purpose: 'work-do',
      cwd: tree,
      level,
      ...cost,
      ...this.bindingFor(level, 'do'),
      instructions: `Finish this item on ${project.name}: ${item.title}`,
      prepare: entry => this.place(entry, { project, tree, branch, resume, writes: item.kind === 'pr-fix' }),
      work: place => ({
        lane: 'do',
        place,
        item: { ...item, branch, prFile: description },
        landing: landing(project),
        ...this.describeFor(project, item),
      }),
      settle: (run, entry) => this.settleItem(slug, item.id, run, entry),
    });
  }

  // Closing Hobkin keeps the item, so it resumes, and so does anything that was not the item's doing.
  // A folder moved under a run only ended that run: the item stays in the plan.
  // Cancelling one is the user's own stop, so it stays in sight at the end of the queue instead of starting again on the next tick.
  // Stopping one as not approved is the user's no, and it stands however the run ended and over whatever the run recorded on its way out.
  // Any other end means the run did not record an outcome, and one that went quiet is the same however it was stopped.
  // The item goes straight back in the queue, and the next run carries on from the branch with what this one said.
  // A review costs a whole run, so a finished branch gets one by itself only once the user turns reviews on: then it is its next run, ahead of new work.
  async itemFinished(slug, item) {
    const { id, title, kind, state, branch, reviewAsked, workNote, modelAsked } = item;
    if (reviewAsked || workNote || modelAsked) updateItem(this.root, slug, id, { reviewAsked: false, workNote: null, modelAsked: null }, this.now());
    if (!['branch', 'pr'].includes(state) || kind === 'pr-fix') return;

    const project = readProject(this.root, slug);
    if (!reviewAsked && state === 'branch' && await this.earnsAReview(project, branch, item.review)) {
      updateItem(this.root, slug, id, { reviewAsked: true }, this.now());
      retryItem(this.root, slug, id, this.now());
      return;
    }
    this.onDraftDone({ slug, id, title, project: nameOf(project) });
  }

  // With the mode off nothing new starts, and that holds for a review too. A home with no setting is off. A review of a commit whose code the
  // branch still has, since only models changed after it, still speaks for the branch, so it earns no other.
  async earnsAReview(project, branch, review) {
    if (!readMode(this.root).enabled || !reviewsByItself(this.root, project.slug)) return false;
    const repo = project.path ?? paths(this.root, project.slug).clone;
    const base = await defaultBranch(repo);
    if (await changesOnlyDocs(repo, base, branch)) return false;
    return !(review?.head && (await sameCodeAs(repo, base, branch)).includes(review.head));
  }

  settleItem(slug, id, run, { moved = false, stalled = false, declined = false } = {}) {
    if (declined && run?.status === 'interrupted') return declineStopped(this.root, slug, id, this.now());
    const interrupted = run?.status === 'interrupted';
    if ((interrupted && this.runner.stopped) || notTheWork(run)) return;
    const item = readItems(this.root, slug).find(entry => entry.id === id);
    if (!item) return;
    if (item.state !== 'doing') return this.itemFinished(slug, item);
    if (moved) {
      writeState(this.root, slug, { folderNote: 'The folder left the run\'s branch, so the run stopped. Nothing was forced.' });
      this.sayAboutFolder(slug, `${this.folderOf(slug)} left the branch for "${item.title}" while it ran, so that run stopped. Nothing was forced.`);
    }
    if (moved) {
      updateItem(this.root, slug, id, { state: 'open' }, this.now());
      return;
    }
    if (interrupted && !stalled) {
      updateItem(this.root, slug, id, { state: 'open' }, this.now());
      skipInQueue(this.root, `item:${slug}:${id}`);
      return;
    }
    const lastError = stalled ? QUIET_REASON : runError(run) || firstLine(run?.result?.text) || 'The run ended without recording an outcome.';
    updateItem(this.root, slug, id, { state: 'open', attempts: (item.attempts ?? 0) + 1, lastError }, this.now());
  }

  // Pi only reports that a run did not finish, so its own words come from the session. Only the first line of an error counts.
  noteUsageLimit(result, sessionFile) {
    if (result.status !== 'failed') return result;
    const { usagePause } = readMode(this.root);
    const limit = usageLimitIn(sessionError(sessionFile) ?? firstLine(result.error), this.now());
    if (!limit) return result;
    writeMode(this.root, { usagePause: nextPause(usagePause, limit, this.now()) });
    return { ...result, usageLimit: true };
  }

  clearUsagePause() {
    const { usagePause } = readMode(this.root);
    if (usagePause && Date.parse(usagePause.until) <= this.now()) writeMode(this.root, { usagePause: null });
  }

  /**
   * An older hobkin ran work in terminal panes and could leave agents at work there as it closed, written down for the next one. Nothing
   * writes that list now, but a home may still hold one, so each comes back once as it would have ended here, and its report and tokens are
   * settled the usual way. A look has nothing to restore.
   */
  pickUpHanded() {
    if (this.pickedUp) return;
    this.pickedUp = true;
    for (const record of takeHanded(this.root)) {
      const { slug, lane, item, title, level, kind, estimate, model, effort, place } = record;
      const settle = lane === 'do' ? (run, entry) => this.settleItem(slug, item, run, entry) : run => this.settleLook(slug, run, {});
      this.start({ key: laneKey(slug, lane), lane, slug, item, title, purpose: `work-${lane}`, cwd: place.cwd, level, kind, estimate, model, effort, instructions: title, settle, handed: record });
    }
  }

  // Its report says it finished. Without one it may still be at work, so nothing here touches its folder or starts it again.
  handedOutcome({ report, sessionFile }) {
    if (!report || !existsSync(report)) return { status: 'interrupted', cost: null, error: LEFT_WITHOUT_REPORT };
    return withSessionCost({ status: 'completed', text: readFileSync(report, 'utf8').trim(), cost: null }, sessionFile);
  }

  start({ key, planKey, grade, lane, slug, item, title, purpose, cwd, level, kind = lane, estimate = {}, model, effort, instructions, prepare, work, settle, handed = null }) {
    const harnessId = handed?.harnessId ?? randomUUID();
    // Its first run already ended in the record as left running, and an id is only ever used once.
    const id = `work:${slug ?? 'discover'}:${lane}:${handed ? randomUUID() : harnessId}`;
    const scheduleId = slug ? `work.${slug}.${lane}` : 'work.discover';
    const request = {
      id,
      kind: 'background',
      scheduleId,
      title,
      harness: 'pi',
      model,
      effort,
      cwd,
      harnessId,
      work: { slug, lane, item, planKey },
    };
    const sessionFile = join(this.root, 'jobs', `${harnessId}.jsonl`);
    const startedAt = handed?.startedAt ?? new Date(this.now()).toISOString();
    const entry = { id, harnessId, grade, kind, model, slug, lane, item, planKey, title, level, effort, estimate, sessionFile, tokens: 0, cached: 0, harness: 'pi', startedAt, report: handed?.report };
    // It takes messages while it works, as a running check does: `message_check` reaches it by its schedule. The runner closes its inbox when it ends.
    const inbox = handed ? null : Promise.withResolvers();
    inbox?.promise.catch(() => {});
    if (inbox) this.runner.inboxes.set(id, inbox);
    const runIn = async (place, signal) => {
      const here = place.cwd;
      const schedule = { id: scheduleId, title, prompt: instructions, cwd: here, harness: 'pi', model, context: [] };
      // Only the latest finished run of this schedule is wanted: the committed document is read with no copy, and only that run is copied.
      const { runs } = await (this.runtime.document?.() ?? this.runtime.state());
      const latest = Object.values(runs)
        .filter(run => run.scheduleId === scheduleId && run.status !== 'running')
        .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];
      const previous = latest && copyJson(latest);
      const prompt = await buildContext(schedule, previous, readMemory(this.root), openCheck(this.root, scheduleId), work(place.folder ? 'folder' : 'tree'));
      mkdirSync(join(this.root, 'jobs'), { recursive: true, mode: 0o700 });
      return this.runHarness({
        id: harnessId,
        harness: 'pi',
        purpose,
        cwd: here,
        model,
        effort,
        prompt,
        sessionFile,
        signal,
      }, {
        beforeSpawn: identity => !signal.aborted && this.admitHelper(entry, identity),
        onEvent: event => this.runner.onActivity(id, event),
        onReady: send => inbox.resolve(send),
      });
    };
    const effect = async signal => {
      const place = handed?.place ?? (prepare ? await prepare(entry) : { cwd });
      Object.assign(entry, place);
      let ended;
      try {
        ended = handed ? this.handedOutcome(entry) : await runIn(place, signal);
        return this.noteUsageLimit(ended, sessionFile);
      } finally {
        // A folder that went away during the run must not hide how the run ended. One an agent may still work in is left as it is.
        if (!handed || ended?.status === 'completed') await this.leave(slug, item, place).catch(() => {});
      }
    };
    this.active.set(key, entry);
    const { work: finished } = this.runner.startTracked(request, effect);
    const closed = finished.then(run => {
      const own = sessionUsage(sessionFile);
      if (this.active.get(key) !== entry) return;
      this.meterRun(entry);
      if (run?.id !== id || run.harnessId !== harnessId || (run.result?.id && run.result.id !== harnessId)
        || (run.result?.sessionId && run.result.sessionId !== own.sessionId)) {
        entry.cleanupUnknown = true;
        entry.childAdmissionHold = true;
        return;
      }
      if (entry.children.length && (!run.result?.sessionId || run.result.sessionId !== own.sessionId)) {
        entry.usageIncomplete = true;
        entry.incompleteEvents.parent ??= new Date(this.now()).toISOString();
      }
      entry.cleanupUnknown ||= entry.children.some(child => !['completed', 'failed', 'cancelled'].includes(child.status));
      entry.usageIncomplete ||= entry.cleanupUnknown;
      this.active.delete(key);
      const { tokens, cached, usageIncomplete, cleanupUnknown, incompleteEvents } = entry;
      recordEvent(this.root, 'run_tokens', { id, tokens, cached, usageIncomplete, cleanupUnknown });
      // When it began goes with what it spent, so the forecast can time the next run like it.
      const estimated = !tokens && !entry.children.length;
      const facts = { slug, lane, kind, startedAt, ...(!estimated && level ? { level } : {}) };
      recordTokens(this.root, { ...facts, tokens, cached, usageIncomplete, cleanupUnknown, incompleteEvents,
        ...(estimated ? { estimated: true } : {}) }, this.now());
      if (run?.status === 'completed') this.clearUsagePause();
      // Deciding on a finished branch reads git, and a failure there costs its review, never the run's outcome.
      return Promise.resolve(settle?.(run, entry)).catch(() => {}).finally(() => {
        this.publish();
        this.onChange();
      });
    });
    this.closing = Promise.all([this.closing, closed]);
    this.publish();
    this.onChange();
  }
}
