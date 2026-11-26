import { watch } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { HobkinRuntime, MAIN_BUSY, MAX_MESSAGE_BYTES, controlWait, descendantReceipt } from './runtime.mjs';
import { createOwnedLifecycle } from './owned-agent-lifecycle.mjs';
import { HobkinRunner } from './runner.mjs';
import { JobActivity, MOST_OUTPUT, MOST_STEPS } from './job-activity.mjs';
import { createPulses, createPulseWire, feedPiEvent } from './pulse.mjs';
import { TeamsAgents } from './teams-agents.mjs';
import { CompatibilityDelivery } from './compatibility.mjs';
import { namingExtensions, runHarness as defaultRunHarness } from './harnesses.mjs';
import { agentKindOf, integrationOffer, MAIN_AGENT } from './integrations.mjs';
import { workflowFoldersOf } from './workflows.mjs';
import { restartingAfterCodeToolCrash } from './code-tool-crash.mjs';
import { withShippedSkills } from './skills-extension.mjs';
import { UsageLedger } from './usage.mjs';
import { copyJson } from './file-version.mjs';
import { Telemetry } from './telemetry.mjs';
import { RemoteSender, uploadNotice } from './telemetry/sender.mjs';
import { feedbackQuestion } from './feedback/draft.mjs';
import { crashToOffer, discardDraft, sendApproved } from './feedback/outbox.mjs';
import { recordEvent } from './events.mjs';
import { memoryBytes } from './memory.mjs';
import { callName, readProfile } from './profile.mjs';
import { MemoryIndex } from './memory-index.mjs';
import { CHROME_NOTE } from './chrome.mjs';
import { compactionDue, nextRunIn } from './compaction.mjs';
import { editReport } from './report-editor.mjs';
import { ShortReports } from './short-reports.mjs';
import { tickCatchUp } from './catch-up.mjs';
import { moveRoutinesFolder } from './schedules.mjs';
import { holdBrief, isHoldBrief, nextHoldTurn } from './holds.mjs';
import { endSessionJob, markHeard, markPosted, markWoken, sessionNotice, sessionReports, sessionsToPost, sessionsToTell, sessionsToWake } from './session-log.mjs';
import { resumeSessionJob, startKeptSession, startSessionJob, takeSessionRequests } from './session-jobs.mjs';
import { MOST_WAITS, WAITING } from './run-waits.mjs';
import { AgentScheduleRunner } from './agent-schedule-runner.mjs';
import { scheduledText, scheduleWakeBlock } from './agent-schedules.mjs';
import { isTurnRunId } from './hobkin-ids.mjs';
import { tierBinding } from './tiers.mjs';
import { TeamsTiers } from './teams-tiers.mjs';
import { agentSchedulesBrief, failureKey, handOffBrief, isQuietScheduledRun, isWakeBrief, jobsBrief, messagesBrief, scheduledBrief, scheduledFailure, sessionsBrief } from './wake.mjs';
import { Hobkins, hobkinSummaries } from './hobkins.mjs';
import { answerRequest, takeRequests, tellRequests, turnToken } from './hobkin-tell.mjs';
import { SCHEDULE_ENVIRONMENT, SCHEDULE_REQUESTS, scheduleAskedHere } from './agent-schedule-command.mjs';
import { memoryHandler } from './memory-tools.mjs';
import { memoriesStamp, RUN_MARKER } from './memories.mjs';
import { fileTemplateNews } from './routine-care.mjs';
import { templateNews, templateNotice } from './routine-templates.mjs';
import { cardActionNotice, cardActionsToPost, cardActionsToTell, markCardActionsHeard, markCardActionsPosted, recordCardAction } from './work/card-actions.mjs';
import { askReminders, inboxNews, inboxNotice, inboxToPost, inboxToTell, markInboxHeard, markInboxPosted } from './inbox.mjs';
import { clientNotice, clientNoticesToPost, markClientNoticesPosted } from './client-notices.mjs';
import { finishedLine, foldFinishedLines, withoutWorkNote, workNote } from './work/chat.mjs';
import { WorkDirector } from './work/director.mjs';
import { workStatus } from './work/commands.mjs';
import { askAgent, declineItem, deleteItemBranch, fixRisk, markDone, mergeItem, mergePullRequest, openDiff, openPullRequest, pauseWork, publishItem, requestReview, resumeWork, riskStays, triggerRow } from './work/controls.mjs';
import { addIssue } from './work/issues.mjs';
import { mergeGroup } from './work/merge-group.mjs';
import { filePickUp, retirePickUp } from './work/pick-up.mjs';
import { mergeRefreshed, refreshThenMerge } from './work/refresh.mjs';
import { winsNow, yesterdayLine } from './work/wins.mjs';
import { runReadiness } from './work/yolo.mjs';
import { yoloReports } from './work/yolo-report.mjs';
import { prView } from './work/reads.mjs';
import { LandOffers, lastOfferAt, offerDecisions, retireOffers } from './work/land-offer.mjs';
import { fileFirstPair } from './work/pairs.mjs';
import { stalled } from './checks.mjs';
import { DISMISSALS_FILE } from './action-dismissal.mjs';
import { fileDecision, findDecision, findOpenDecision, markShown, QUESTION_WAIT_MS } from './decisions.mjs';
import { isPresent } from './pending.mjs';
import { readActionDecisions, readPending, readWaiting } from './pending-read.mjs';
import { arrivedCount, arrivedSince, asksForBrief, BRIEF_BAR, briefMaterial, briefNote, briefSince, offerLine, readBriefState, returnedSince, seenMoved, withoutBriefNote, writeBriefState } from './brief.mjs';
import { readReportIds, reportReadStates } from './telemetry.mjs';
import { carryOutAnswer } from './answer.mjs';
import {
  answerAllowance, chooseProject, dropProject, pickNext, putBackInQueue, readMode, retryItem, setProjectIssues, setProjectPrMode, setProjectPriority, skipInQueue, skipProject, startWork, updateItem,
  writeMode,
} from './work/store.mjs';
import { readingUsage } from './work/usage.mjs';
import { atomicJson, learningEnabled, loadConfig, readPersona, setLearning } from './config.mjs';
import { runLearningCommand } from './learning/commands.mjs';
import { Learner, proposalMessage } from './learning/learner.mjs';
import { DIRECTIONS_KIND } from './learning/pi-directions.mjs';
import { PiDirectionsLearner } from './learning/pi-directions-learner.mjs';
import { learningState } from './learning/store.mjs';
import { withoutLearningNote } from './learning/note.mjs';
import { Moods, searchingTool } from './mood.mjs';
import { projectPerformance, readLocalView, safePerformance } from './view.mjs';
import { safeSteps, turnFrom } from './turn-metrics.mjs';
import { withoutSinceNote } from './prompt-parts.mjs';
import { PastedImages } from './paste-image.mjs';
import { forgetUnread, readUnread } from './unread.mjs';
import { deletedReportIds, isQuietRun, readReport, referToReport, reportText, reportTriage, runOutcomeText, savedReportPath, splitReportReference } from './reports.mjs';
export { readLocalView } from './view.mjs';

const textOf = message => (typeof message.content === 'string' ? message.content
  : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n'));
const SIGN_IN_TROUBLE = /\b40[13]\b|unauthori[sz]ed|authentication|api key|credential|log ?in\b/i;
/**
 * The provider's own words: the `message` of an error given as JSON, followed down through JSON held inside it, as a
 * Gemini error that came without a JSON content type holds its whole body as text.
 */
const providerWords = text => {
  for (let depth = 0; depth < 4; depth++) {
    let body;
    try { body = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { break; }
    const message = body?.error?.message ?? body?.message;
    if (typeof message !== 'string' || !message.trim()) break;
    text = message;
  }
  return text.trim();
};
/** A refused turn has no text of its own, so without this the chat just goes quiet. */
const turnFailure = ({ stopReason, errorMessage }) => {
  if (stopReason !== 'error' || !errorMessage) return '';

  const words = providerWords(errorMessage);
  const reason = (words.match(/"message":"([^"]+)"/)?.[1] ?? words).split('\n', 1)[0];
  const fix = SIGN_IN_TROUBLE.test(errorMessage) ? ' Run `hobkin login` in a terminal, then reopen hobkin.' : '';
  return `The model did not answer: ${reason.slice(0, 300)}${fix}`;
};
const imagesIn = message => (Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image').length;
// Every refresh hashes the whole chat, and an image would be most of what it hashes.
const withoutImageData = (_, value) => (value?.type === 'image' ? { ...value, data: '' } : value);
// What the user typed, and the report it was about, without the notes hobkin sends ahead of it.
const typedPart = text => splitReportReference(withoutSinceNote(withoutBriefNote(withoutLearningNote(withoutWorkNote(text)))));
const chatMessage = (message, index, shown) => {
  const { text, about } = typedPart(textOf(message));
  const endedTheChat = index === shown.length - 1;
  const images = imagesIn(message);
  return {
    id: createHash('sha256').update(JSON.stringify(message, withoutImageData)).digest('hex'),
    role: message.role,
    content: reportText(text || (endedTheChat ? turnFailure(message) : '')).slice(0, 8192),
    at: message.timestamp ?? message.at,
    ...(about ? { about } : {}),
    ...(images ? { images } : {}),
  };
};
const visibleChatMessages = messages => messages
  .filter(message => ['user', 'assistant', 'custom'].includes(message.role) && message.customType !== CHROME_NOTE)
  .filter(message => message.display !== false)
  .filter(message => !isHoldBrief(textOf(message)) && !isWakeBrief(textOf(message)))
  .filter(message => !isQuietScheduledRun(message))
  .slice(-100);
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
// A durable hobkin's turn answers on its own page, so it is never a report, a notice or an attention row.
const isVisibleScheduledReport = run => run.kind === 'background' && !run.hobkin
  && typeof run.scheduleId === 'string' && run.scheduleId.length > 0
  && run.status !== 'running' && run.status !== WAITING && (run.status !== 'no_change' || run.trigger === 'manual');
const pauseNote = ({ nextRun, timezone }) => {
  const resumes = new Date(nextRun.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: timezone });
  return ` Paused until ${resumes}; running it manually or editing the routine resumes it sooner.`;
};
const messageTime = message => {
  const value = message.at ?? message.timestamp;
  const time = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(time) ? time : null;
};
// The conversation as the model read it, each message timed for placing Chat's own lines among them. A message queued for a turn keeps
// the time it was sent and is read once the reply before it ends, so it is placed no earlier than the message read before it.
const inReadOrder = messages => {
  let latest = null;
  return messages.map(message => {
    const time = messageTime(message);
    if (time !== null) latest = Math.max(latest ?? time, time);
    return { message, time: time === null ? null : latest };
  });
};
const DISCOVERY_POST = 'notice:work-discovery:';
const isOwnPost = message => message.role === 'notice' || message.id?.startsWith('notice:');

// What Chat says when an agent changed a memory (057-shared-memory), by what it did, with the change so the line offers Undo.
const MEMORY_DID = { added: 'remembered', changed: 'changed', forgot: 'forgot', restored: 'restored' };
// A memory another session handed over, kept by the main chat: a change by its record, and a keep in what Chat says (`kept`).
const keptWords = (who, what) => `${who} kept: ${what}${/[.!?]$/.test(what) ? '' : '.'} Every agent hobkin runs reads it now.`;
function memoryLine(owner, { change, name, did, description, by, kept }, at) {
  const who = owner.kind === 'hobkin' ? owner.title ?? `hobkin ${owner.id}` : 'hobkin';
  const what = description ?? name;
  const said = kept ? keptWords(who, what) : `${who} ${MEMORY_DID[did] ?? did}: ${what}`;
  const content = by?.kind === 'suggested' ? `${who} remembered what ${by.title ?? 'a run'} suggested: ${what}` : said;
  return { id: `notice:memory:${change}`, role: 'notice', tone: 'quiet', content, memory: { change, name, did }, at: new Date(at).toISOString() };
}
// Work's status less the token counts a running agent's meter raises as its session grows: the day's and the hour's, and each run's own.
const withoutLiveCounts = ({ tokensToday, tokensCached, tokensThisHour, running, ...status }) => ({
  ...status,
  running: running?.map(({ tokens, cached, ...run }) => run),
});
/** A running job that lives until it is done and sits idle between turns says so, with when it went idle (072-jobs-live-until-done). */
function idleFields(run, idle) {
  if (run.status !== 'running' || !idle) return {};
  return { idle: true, idleSince: idle.since };
}

const BUSY_RETRY_MS = 100;
// What Continue sends after the user stopped a turn: the word they would type in Pi, which has no way to resume a stopped run.
const CONTINUE_WORDS = 'Continue';
// Events that come together go out as one publish this long after the first, and a rebuild is asked for this soon too.
const REFRESH_DELAY_MS = 25;
// The window shows growing words every 100 ms, so activity goes out no oftener than this.
const ACTIVITY_EVERY_MS = 100;
// How long hobkin waits before it tries again to tell the main agent of a durable hobkin, after a try that failed.
const HOBKIN_WAKE_RETRY_MS = 5 * 60000;
// How many living jobs' replies one wake carries, so it stays well under what a message can hold. The rest go with the next.
const JOBS_TOLD_MOST = 5;
// The keys of the Done walk, which only the user presses.
const WALK_EVENTS = { diff: 'done_diff', merge: 'done_merged', decline: 'done_declined', ask: 'done_sent_back' };
// A tick comes every second, and what is waiting rarely changes that fast.
const PENDING_LOOK_MS = 30000;
// A question nobody was there to see waits this long for them to come back, then joins Decisions without opening.
const UNSEEN_MS = 10 * 60000;
// A decision as the main agent reads it when the user talks it over: its summary, then the question and each choice in words.
const aboutDecision = ({ tldr, question, choices }) => ({ title: tldr, body: [question, '', ...choices.map(({ label }) => `- ${label}`)].join('\n') });

// What a schedule's wake may be (056-agent-schedules): as a hidden turn of the main chat, and as a message steered into
// a working turn.
const MAIN_WAKE_MOST = 32768;
const STEER_MOST = 4096;

const NOT_A_RUN = 'Nothing was done: that is not a run hobkin is running now. hobkin schedule works only from a run hobkin started, while it runs.';
const NO_COMMANDS = 'This run\'s Claude Code permissions are not "all", so hobkin runs no command for it: a scheduled command would run without the prompt Claude Code would have shown. Schedule a plain wake instead, with no command, and look yourself when it wakes you.';

/** Who a run's schedules belong to: a durable hobkin for its turn, the run itself for a session, and nobody else. */
function scheduleOwnerOf(runId) {
  if (isTurnRunId(runId)) return { kind: 'hobkin', id: runId.split(':')[1] };
  return String(runId).startsWith('session:') ? { kind: 'run', id: runId } : null;
}

/** The schedules agents keep, as the home holds them. One that cannot be read costs only the schedules: hobkin opens without them. */
function openAgentSchedules(app) {
  const schedules = new AgentScheduleRunner({ root: app.runtime.directory, now: app.now, onChange: () => app.requestRefresh() });
  try {
    schedules.open();
  } catch (error) {
    app.agentSchedulesError = String(error?.message ?? error);
  }
  return schedules;
}

export class HobkinApplication {
  jobActivity = new Map();
  activeJobIds = new Set();
  // Each working run's pulse and the main turn's, and what of them is on the wire (054-working-line).
  pulses = createPulses();
  pulseWire = createPulseWire();
  // Which tick read each Work status, in order, so a rebuild never shows Work older than one already published (`keepNewerWork`).
  workReads = new WeakMap();
  workReadCount = 0;
  outgoing = Promise.resolve();
  sending = 0;
  // Holds this process has nothing more to do for: one try each, and the next start picks up a turn that was cut off.
  handledHolds = new Set();
  // Scheduled failures already told, and when this process opened. The scheduler stamps its messages by the wall clock, so this does too.
  failuresTold = new Set();
  openedAt = Date.now();
  returnLookedAt = -Infinity;

  /** Lazy bytes for an already-visible image, scoped to the selected main session. */
  messageImage({ sessionId, messageId, ordinal } = {}) {
    const main = this.runtime.main;
    if (!main || typeof sessionId !== 'string' || /[/\\]/.test(sessionId) || !sessionId
      || sessionId !== main.sessionId || !/^[a-f0-9]{64}$/.test(messageId)
      || !Number.isInteger(ordinal) || ordinal < 0
      || !this.snapshot.messages?.some(message => message.id === messageId)) return null;
    const shown = visibleChatMessages(this.runtime.messages());
    if (this.runtime.main !== main || main.sessionId !== sessionId) return null;
    const index = shown.findIndex((message, index) => chatMessage(message, index, shown).id === messageId);
    const part = shown[index]?.content?.filter?.(part => part.type === 'image')[ordinal];
    if (!part || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(part.mimeType)
      || typeof part.data !== 'string' || !part.data.length
      || part.data.length > 4 * Math.ceil(MAX_PREVIEW_BYTES / 3)
      || part.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(part.data)) return null;
    const bytes = Buffer.from(part.data, 'base64');
    if (bytes.length > MAX_PREVIEW_BYTES || bytes.toString('base64') !== part.data) return null;
    return { mimeType: part.mimeType, data: part.data };
  }

  observeActivity(id, event) {
    this.feedPulse(id, event);
    try {
      if (!this.jobActivity.has(id)) {
        // A run's newest steps and the ends of each long output. The rest stays in its saved session (`run-steps.mjs`).
        this.jobActivity.set(id, new JobActivity({ now: this.now, most: MOST_STEPS, mostOutput: MOST_OUTPUT }));
      }
      this.jobActivity.get(id).accept(event);
      // Read only, after the run's own feed has it. It catches its own errors.
      this.teamsAgents?.observe(id, event);
      this.requestRefresh(true);
    } catch {
      /* Preview observers cannot fail a job. */
    }
  }

  /** A run's pulse follows its events, which the request for a refresh after them publishes. It cannot fail the run. */
  feedPulse(id, event) {
    try {
      feedPiEvent(this.pulses, id, event, this.now());
    } catch {
      // The run goes on without it.
    }
  }

  /**
   * The pulses to put on the wire now, or undefined while none works, so an idle snapshot is as it was. On an error there
   * are none. The wire changes a run's pulse at most once a second (`createPulseWire`), and a change it held back goes
   * out with a refresh asked for once that second is over, as no event may come after it.
   */
  publishedPulses() {
    try {
      const published = this.pulseWire.publish(this.pulses, Date.now());
      this.refreshWhenDue(this.pulseWire.heldUntil());
      return Object.keys(published).length ? published : undefined;
    } catch {
      return undefined;
    }
  }

  /** Asks for a refresh of the activity once a change held back may go out. A refresh already asked for sooner stays. */
  refreshWhenDue(heldUntil) {
    if (heldUntil === undefined || (this.pulseTimer && this.pulseDue <= heldUntil)) return;
    clearTimeout(this.pulseTimer);
    this.pulseDue = heldUntil;
    this.pulseTimer = setTimeout(() => {
      this.pulseTimer = null;
      this.requestRefresh(true);
    }, heldUntil - Date.now());
    this.pulseTimer.unref();
  }

  /** A run's pulse goes once the state says the run no longer runs. One that began after the state was read keeps its own. */
  endStoppedPulses(runs) {
    try {
      for (const id of Object.keys(this.pulses.all())) {
        if (Object.hasOwn(runs, id) && runs[id].status !== 'running') this.pulses.end(id);
      }
    } catch {
      // The rebuild goes on, and publishes no pulses if they still fail.
    }
  }

  // A helper's words and calls are not shown, only who it is and how it stands, which its lifecycle reports itself.
  observeOwnedEvent(identity, event) {
    if (['performance', 'message_end'].includes(event.type)) this.requestRefresh(false);
  }

  recordOwnedPerformance({ id, parentId, rootId, depth, status, performance }) {
    if (![id, parentId, rootId].every(value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,200}$/.test(value))
      || !Number.isInteger(depth) || depth < 1 || depth > 3
      || !['completed', 'failed', 'cancelled'].includes(status)) {
      return;
    }
    const facts = safePerformance(performance, id, performance?.sessionId);
    const steps = safeSteps(performance?.steps);
    recordEvent(this.runtime.directory, 'run_performance', {
      ...facts,
      runId: id,
      sessionId: facts?.sessionId ?? null,
      ownedHelper: { id, parentId, rootId, depth, status },
      ...(steps.length ? { steps } : {}),
    });
  }

  /**
   * `integrations` is what the host's integrations give agents (065-integration-drops): `tools()`, the tools offered, each
   * with a name, a description, JSON schema parameters and the agents it goes to (`main`, `runs`, `durable`), and
   * `callTool(name, args, { agent, id }, signal)`, which runs one and answers `{ text, failed? }`. `hookedTools()` names
   * the tools whose calls it hears in every agent, or says `all`: `beforeTool({ agent, id, name, args })` may answer
   * `{ block: reason }` or `{ args }`, and `afterTool(call, { text, failed })` may answer `{ text, failed }`. `agent` is
   * `#main` for the main conversation and the run's id for any other. `workflowFolders()` gives each integration's
   * folder of workflows, `[{ id, folder, tools }]`, which run as routines do with only those tools (`workflows.mjs`).
   * Without it no agent is given anything new.
   */
  static async open(root, { createMain, onMainStartup, askQuestion, showDone, showRow, presence, runHarness, harnessWarms, ownedLifecycle, sessionDependencies, shell, now, intervalMs, signal, onChange = null, memoryIndex = null, clipboard, fetch, integrations = null, teamsHome = null, piAgentDir = null } = {}) {
    signal?.throwIfAborted();
    const app = new HobkinApplication();
    app.onChange = onChange;
    app.integrations = integrations;
    app.now = () => new Date(now?.() ?? Date.now()).getTime();
    app.config = loadConfig(root);
    // hobkin's own harness starts a durable hobkin's process ahead of its turn when asked. One that is given says whether it does.
    const warms = harnessWarms ?? runHarness === undefined;
    // Every job starts its Pi through the configured launcher, which owns Pi's extensions; without one Hobkin names them.
    const { launcher } = app.config;
    if (launcher) {
      const run = runHarness ?? defaultRunHarness;
      runHarness = (request, options) => run({ ...request, launcher }, options);
    }
    runHarness ??= namingExtensions(readingUsage(withShippedSkills(defaultRunHarness)));
    if (!launcher && app.config.providerExtensions) {
      const run = runHarness;
      runHarness = (request, options) => run({ ...request, providerExtensions: app.config.providerExtensions }, options);
    }
    app.snapshot = readLocalView(root);
    // The agents a run's own Pi starts with pi-extended-teams, shown and never controlled or counted (046-teams-layer).
    app.teamsAgents = new TeamsAgents({ now: app.now, onChange: () => app.requestRefresh(true) });
    app.moods = new Moods({
      now: () => new Date(app.now()).getTime(),
      onChange: () => app.requestRefresh(),
    });
    app.runtime = await HobkinRuntime.open(root, app.config, {
      ownedLifecycle: ownedLifecycle ?? createOwnedLifecycle({
        onChange: () => app.requestRefresh(),
        onEvent: (identity, event) => app.observeOwnedEvent(identity, event),
        onPerformance: row => app.recordOwnedPerformance(row),
      }),
      createMain,
      onMainStartup,
      askQuestion,
      triggerSchedule: (...args) => app.runner.trigger(...args),
      messageCheck: request => app.runner.messageCheck(request),
      // The agents the main chat's own Pi starts with pi-extended-teams, kept as a run's are, under the main chat's name.
      onMainEvent: event => app.teamsAgents?.observe(MAIN_AGENT, event),
      stopWorkload: request => app.stopWorkload(request),
      // The main agent's own schedules, run in its folder (056-agent-schedules).
      agentSchedules: app.scheduleHandler({ kind: 'main' }, app.config.main.cwd),
      // The memories it reads and saves as the main chat (057-shared-memory).
      memoryKeeper: app.memoryKeeper({ kind: 'main' }, root),
      ...(integrations ? { integrations } : {}),
      editReport: (result, job) => editReport(result, { ...job, binding: app.config.background, runHarness }),
      pulses: app.pulses,
      onChange: activityOnly => app.requestRefresh(activityOnly),
    });
    app.loadUnread();
    try {
      // The schedules agents keep for themselves (056-agent-schedules), before the main chat opens with its tools for them.
      app.agentSchedules = openAgentSchedules(app);
      // A run whose Pi crashed in its code tool starts again once (`code-tool-crash.mjs`).
      runHarness = app.ownedHarness(restartingAfterCodeToolCrash(runHarness));
      // A report's short version comes in the background once the report is listed, and the list refreshes when it does (051-short-reports).
      app.shortReports = new ShortReports({ root: app.runtime.directory, runHarness, onMade: () => app.requestRefresh() });
      moveRoutinesFolder(app.runtime.directory);
      // Only a draft ever needs these, and a draft does not outlive the process.
      app.pastedImages = new PastedImages(app.runtime.directory, clipboard);
      app.pastedImages.clear();
      await app.runtime.connect();
      const initialState = await app.runtime.state();
      app.noticeRunIds = new Set(Object.values(initialState.runs)
        .filter(isVisibleScheduledReport)
        .map(run => run.id));
      app.delivery = new CompatibilityDelivery({
        root: app.runtime.directory,
        runtime: app.runtime,
        config: app.config,
        sessionDependencies,
        runHarness,
        shell,
        now,
      });
      // pi-extended-teams' tiers kept equal to hobkin's, in the home whose settings teams reads; only when one is named (`teams-tiers.mjs`).
      app.teamsTiers = teamsHome ? new TeamsTiers({ root: app.runtime.directory, home: teamsHome }) : null;
      app.ledger = UsageLedger.open(app.runtime.directory, app.config.initializedAt);
      app.telemetry = Telemetry.open(app.runtime.directory, app.now());
      // Before the first tick and before `app_opened`, so upload begins with this start and never sends what came before.
      app.remote = new RemoteSender({ root: app.runtime.directory, fetch, now: app.now });
      app.learner = new Learner({ root: app.runtime.directory, telemetry: app.telemetry, now: app.now });
      // Pi's own AGENTS.md, learned from when it changes and asked about in Action Items; only in the Pi folder the host names (038-resources).
      app.piDirections = piAgentDir ? new PiDirectionsLearner({ root: app.runtime.directory, agentDir: piAgentDir, runHarness, now: app.now, onChange: () => app.requestRefresh() }) : null;
      app.runner = new HobkinRunner({
        runtime: app.runtime,
        root: app.runtime.directory,
        config: app.config,
        runHarness,
        now,
        ...(typeof integrations?.workflowFolders === 'function' ? { workflows: () => workflowFoldersOf(integrations) } : {}),
        compatibility: app.delivery.adapter,
        onActivity: (id, event) => app.observeActivity(id, event),
        // A living job that goes idle or works again changes its row in `runs` (072-jobs-live-until-done).
        onIdleChange: () => app.requestRefresh(),
        onTick: async () => {
          await app.tickWork();
          await app.tickRefreshed();
          await app.tickHolds();
          // Before the wakes, so a message `hobkin tell` left this second can go in this tick's.
          await app.hobkins.tick();
          app.tickWakes();
          await app.tickAgentSchedules();
          void app.tickSessions();
          app.tickCompaction();
          retireOffers(app.runtime.directory, app.now());
          retirePickUp(app.runtime.directory, app.now());
          app.tickInbox();
          // The daily catch-up, a pile of unread reports, or an ask from `hobkin reports catch-up` (069-report-catch-up).
          tickCatchUp(app.runtime.directory, app);
          app.piDirections?.tick();
          app.remote.tick();
          app.landOffers.next();
          app.lookForReturn();
          // Not awaited: it holds a question on screen for as long as it stays there.
          app.presentDecision();
          app.teamsTiers?.tick();
        },
      });
      app.hobkins = new Hobkins({ runtime: app.runtime, runner: app.runner, root: app.runtime.directory, config: () => app.config, now: app.now, warms,
        // What a durable hobkin's `hobkin memory` reaches in its turn, as that hobkin (057-shared-memory).
        memoryKeeper: owner => app.memoryKeeper(owner) });
      Object.assign(app, { askQuestion, showDone, showRow, presence });
      app.landOffers = new LandOffers({
        file: decision => fileDecision(app.runtime.directory, decision, app.now()),
        offers: () => offerDecisions(app.runtime.directory, app.now()),
        lastFiledAt: () => lastOfferAt(app.runtime.directory),
        now: app.now,
      });
      app.director = new WorkDirector({
        root: app.runtime.directory,
        config: app.config,
        runtime: app.runtime,
        runner: app.runner,
        ...(runHarness ? { runHarness } : {}),
        now: app.now,
        onChange: () => app.requestRefresh(),
        onDraftDone: draft => app.landOffers.add(draft),
        // The deploy of a change YOLO mode merged by itself, for the main agent to hand to one session.
        onHandOff: job => app.handOff(job),
      });
      signal?.throwIfAborted();
      // Before anything starts: a durable hobkin's turn that was running when hobkin stopped is over.
      await app.hobkins.open();
      app.runner.start({ intervalMs });
      // Report deletions and Action Item dismissals can arrive from another process.
      app.deletionWatcher = watch(join(app.runtime.directory, 'runtime'), (_event, name) => {
        if (name === DISMISSALS_FILE || name?.startsWith('deleted-reports.json')) app.requestRefresh();
      });
      app.deletionWatcher.unref();
      // `hobkin tell` runs in a durable hobkin's own shell and waits for the answer, so its message is taken as soon as
      // it is written. The tick looks too, for a change the watcher missed.
      app.tellWatcher = watch(tellRequests(app.runtime.directory), () => { void app.hobkins.tick(); });
      app.tellWatcher.unref();
      // Only `main` asks for this, so nothing else that opens an application can start a real qmd.
      if (memoryIndex) {
        app.memoryIndex = new MemoryIndex({ ...memoryIndex, root: app.runtime.directory, onNote: () => app.requestRefresh() });
        app.memoryIndex.start();
      }
      await app.refresh();
      app.openedAt = app.now();
      recordEvent(app.runtime.directory, 'app_opened');
      app.offering = app.offerCrash();
      return app;
    } catch (error) {
      await app.close();
      throw error;
    }
  }

  /**
   * Starts one run of a workflow (`<integration>/<name>`) now, with `input` in its context, and answers `{ run }`, the
   * run's id. It refuses a workflow that is unknown or turned off, and one that would go past the background capacity.
   */
  async startWorkflow(id, input) {
    const started = await this.runner.startWorkflow(id, input);
    this.requestRefresh();
    return started;
  }

  /** Turns a workflow on or off, kept in the home, and answers `{ id, enabled }`. A workflow turned off does not run. */
  async setWorkflowEnabled(id, enabled) {
    const changed = await this.runner.setWorkflowEnabled(id, enabled);
    this.requestRefresh();
    return changed;
  }

  ownedHarness(run) {
    const app = this, metricsRoot = app.runtime.directory;
    return async (request, options) => {
      // Only the running run of this harness is wanted, which the run index names as the whole document would.
      const { runs } = await (app.runtime.runIndex?.() ?? app.runtime.state());
      const admission = Object.values(runs).find(item => item.harnessId === request.id && item.status === 'running');
      // Checks prohibit helpers; Work stays closed until child accounting is integrated. The owned tree keeps every root
      // it had, so a start after a wait (`waits` on the request, 053-run-waits) has a root of its own beside its run's.
      const scopeId = admission && (request.waits > 0 ? `${admission.id}:after-wait:${request.waits}` : admission.id);
      const binding = app.config.providerExtensions ? { ...request, providerExtensions: app.config.providerExtensions } : request;
      const ownedScope = admission && app.runtime.ownedLifecycle.register({ id: scopeId, allowHelpers: false, binding, beforeSpawn: options?.beforeSpawn });
      // A session run and a durable hobkin's turn keep schedules for themselves (056-agent-schedules).
      const owner = admission && request.schedules === true ? scheduleOwnerOf(admission.id) : null;
      const schedules = owner ? app.scheduleHandler(owner, request.cwd, { waits: request.waits, lives: request.untilDone === true }) : undefined;
      // A run that reads hobkin's memories reaches them as hobkin knows it by its run, never by what its request says
      // (057-shared-memory): a durable hobkin's turn as that hobkin, any other run as itself.
      const turnRun = Boolean(admission) && isTurnRunId(admission.id);
      const title = admission && (request.memories || !turnRun) ? await app.runTitle(admission.id) : undefined;
      const memories = admission && request.memories ? app.memoryKeeper(app.memoryOwnerOf({ ...admission, title })) : undefined;
      // Every run but a durable hobkin's turn carries its title in its environment, so `hobkin remember` typed in its
      // shell is only that run's suggestion.
      const started = admission && !turnRun ? { ...request, env: { ...request.env, [RUN_MARKER]: (title ?? admission.id).replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, 80) } } : request;
      // What integrations offer this kind of agent (065-integration-drops), run in the host as the run hobkin knows. A
      // durable hobkin's process started ahead of its turn is given the same, so the turn can take it.
      const kind = agentKindOf(request.purpose);
      // A workflow's run (`<integration>/<name>`) is offered its integration's tools alone.
      const workflow = admission?.scheduleId?.includes('/') ? admission.scheduleId.split('/')[0] : null;
      const only = workflow === null ? undefined : workflowFoldersOf(app.integrations).find(item => item.id === workflow)?.tools ?? [];
      const offer = kind && integrationOffer(app.integrations, kind, { only });
      const integrations = offer ? { host: app.integrations, offer, agent: admission?.id ?? request.id } : undefined;
      const cancel = () => { void ownedScope?.cancel(); };
      request.signal?.addEventListener('abort', cancel, { once: true });
      try {
        request.signal?.throwIfAborted();
        return await run(started, { ...options, metricsRoot, ownedScope, ...(schedules ? { schedules } : {}), ...(memories ? { memories } : {}), ...(integrations ? { integrations } : {}),
          onControl: child => { if (admission) app.runtime.bindHarness(admission.id, request.id, child); },
        });
      } finally {
        request.signal?.removeEventListener('abort', cancel);
        const cleanup = await ownedScope?.cancel();
        const active = admission && app.runtime.active.get(admission.id);
        if (active) active.cleanup = cleanup;
      }
    };
  }

  /**
   * `work` is Work's status as a tick just read it, for the refresh it asks for. A refresh asked for anything else reads Work again.
   * A whole rebuild goes out 25 ms after it is asked. Activity does too after a quiet moment, then no sooner than 100 ms after it last
   * went out, since the window shows growing words every 100 ms: a rebuild asked meanwhile does not wait for that.
   */
  requestRefresh(activityOnly = false, work = null) {
    if (this.closing || !this.runner) return;
    if (!activityOnly) {
      this.refreshDirty = true;
      this.workAsRead = work;
    }
    const now = Date.now();
    const soonest = now + REFRESH_DELAY_MS;
    const due = this.refreshDirty ? soonest : Math.max(soonest, (this.activityAt ?? -Infinity) + ACTIVITY_EVERY_MS);
    if (this.refreshTimer) {
      if (this.refreshDue <= due) return;
      clearTimeout(this.refreshTimer);
    }
    this.refreshDue = due;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      const work = this.workAsRead;
      this.workAsRead = null;
      const update = this.refreshDirty ? this.refresh(work) : Promise.resolve().then(() => this.publishActivity());
      void update.catch(error => {
        this.snapshot = { ...this.snapshot, error: error.message };
        recordEvent(this.runtime.directory, 'error_shown', { from: 'refresh' });
        this.onChange?.(this.snapshot);
      });
    }, due - now);
    this.refreshTimer.unref();
  }

  // Streaming does not change receipts, reports or the Work plan. Publish its in-memory feed only.
  publishActivity() {
    if (this.closing) return;
    this.activityAt = Date.now();
    this.snapshot = {
      ...this.snapshot,
      jobActivity: Object.fromEntries([...this.jobActivity].map(([id, feed]) => [id, feed.snapshot()])),
      pulses: this.publishedPulses(),
      ...this.runtime.helpers(),
      teamsAgents: this.teamsAgents?.snapshot() ?? {},
      mainActivity: this.runtime.mainActivity(),
      busy: this.runtime.mainBusy,
      mainStopped: this.runtime.stoppedTurn,
      searching: searchingTool(this.runtime.mainTool),
      tooling: Boolean(this.runtime.mainTool),
      doing: this.runtime.mainDoing ?? null,
    };
    this.onChange?.(this.snapshot);
  }

  /** `work` is Work as the tick that asked for this refresh read it. Any other caller changed something, so Work is read again. */
  refresh(work = null) {
    if (!this.refreshing) {
      this.refreshDirty = false;
      this.refreshing = this.project(work).then(snapshot => this.keepNewerWork(work) ?? snapshot).finally(() => {
        this.refreshing = null;
        if (this.refreshDirty) this.requestRefresh(false, this.workAsRead);
      });
    }
    return this.refreshing;
  }

  async project(workAsRead = null) {
    await this.delivery.syncEvidence();
    // The run index changes with every commit. Read before the document, it can only be older than the document, never newer.
    const version = await this.runtime.runIndex?.();
    // A rebuild only reads the document, so it reads the committed one with no copy, and copies what it hands out.
    const state = await (this.runtime.document?.() ?? this.runtime.state());
    const loaded = await this.runner.snapshot(state);
    const runs = Object.values(state.runs).sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    const deleted = deletedReportIds(this.runtime.directory);
    const sessionsEnded = sessionsToPost(this.runtime.directory);
    const cardActions = cardActionsToPost(this.runtime.directory);
    const handedOver = inboxToPost(this.runtime.directory, this.now());
    const clientLines = clientNoticesToPost(this.runtime.directory);
    const runReports = runs
      .filter(run => run.kind !== 'main' && !run.hobkin && run.status !== 'running' && run.status !== WAITING && (run.status !== 'no_change' || run.trigger === 'manual'))
      .filter(run => !deleted.has(run.id) && !isQuietRun(run))
      .map(run => {
        const text = runOutcomeText(run) || 'No result text.';
        const coverage = run.result?.coverage
          ? `\n\nCoverage: ${JSON.stringify(run.result.coverage)}\nOmissions: ${JSON.stringify(run.result.omissions)}`
          : '';
        return {
          id: run.id,
          title: run.title ?? run.scheduleId ?? run.id,
          scheduleId: run.scheduleId,
          at: run.finishedAt,
          body: readReport(this.runtime.directory, run.id, reportText(text + coverage)),
          outcome: run.status,
        };
      });
    const reportIds = new Set();
    const reports = [...runReports, ...sessionReports(this.runtime.directory, deleted), ...yoloReports(this.runtime.directory, deleted)]
      .filter(report => {
        if (reportIds.has(report.id)) return false;
        reportIds.add(report.id);
        return true;
      })
      .toSorted((left, right) => (right.at ?? '').localeCompare(left.at ?? ''));
    const notices = (this.snapshot.messages ?? []).filter(isOwnPost);
    // What was in Chat when this process opened is not news. One that scrolled away is worked out again on each refresh, so a count needs a memory of its own.
    this.noticesCounted ??= new Set(notices.map(({ id }) => id));
    const noticeIds = new Set(notices.map(message => message.id));
    const noticedRunIds = new Set(this.noticeRunIds);
    const work = this.workView(workAsRead);
    const asked = work.allowanceRequest;
    const askedId = asked && `notice:work-allowance:${asked.at}`;
    if (asked && !noticeIds.has(askedId)) {
      notices.push({ id: askedId, role: 'notice', content: asked.reason, tone: asked.atLimit ? 'critical' : 'useful', at: asked.at });
      noticeIds.add(askedId);
    }
    const told = work.pauseNotice;
    const toldId = told && `notice:work-pause:${told.id}`;
    if (told && !noticeIds.has(toldId)) {
      notices.push({ id: toldId, role: 'notice', content: told.line, tone: told.tone, at: told.at });
      noticeIds.add(toldId);
    }
    // These read as Hobkin speaking, because the user is meant to answer them.
    const shipping = work.shipNotice;
    const shippingId = shipping && `notice:work-ship:${shipping.at}`;
    if (shipping && !noticeIds.has(shippingId)) {
      notices.push({ id: shippingId, role: 'notice', content: shipping.line, tone: 'useful', at: shipping.at });
      noticeIds.add(shippingId);
    }
    // The offer of a brief stands where it was made, and the user answers it in their own words.
    const offered = readBriefState(this.runtime.directory).offer;
    const offeredId = offered && `notice:brief:${offered.since}`;
    if (offered && !noticeIds.has(offeredId)) {
      notices.push({ id: offeredId, role: 'notice', content: offered.line, tone: 'useful', at: offered.at });
      noticeIds.add(offeredId);
    }
    for (const { key, line, at } of work.harnessLines) {
      const id = `notice:${key}`;
      if (noticeIds.has(id)) continue;
      notices.push({ id, role: 'notice', content: line, tone: 'quiet', at });
      noticeIds.add(id);
    }
    // A folder of the user's own left off its default branch is theirs to know about, so it reads as a system line.
    for (const { key, line, at } of work.folderLines) {
      const id = `notice:${key}`;
      if (noticeIds.has(id)) continue;
      notices.push({ id, role: 'system', content: line, at });
      noticeIds.add(id);
    }
    const reviewed = work.review;
    const reviewedId = reviewed && `notice:work-review:${reviewed.at}`;
    if (reviewed && !noticeIds.has(reviewedId)) {
      notices.push({ id: reviewedId, role: 'assistant', content: reviewed.message, at: reviewed.at });
      noticeIds.add(reviewedId);
    }
    const { message: looked, finishedAt } = work.discovery;
    const lookedId = looked && `${DISCOVERY_POST}${finishedAt}`;
    if (looked && !noticeIds.has(lookedId)) {
      notices.push({ id: lookedId, role: 'assistant', content: looked, at: finishedAt });
      noticeIds.add(lookedId);
    }
    // It reads as Hobkin speaking too, for the same reason.
    const proposed = this.learner.takePost();
    if (proposed && !noticeIds.has(proposed.id)) {
      notices.push(proposed);
      noticeIds.add(proposed.id);
    }
    const indexNote = this.memoryIndex?.takeNote();
    if (indexNote) notices.push(indexNote);
    // An update can bring routine templates, and only an update changes them, so the first refresh after opening is the one to say so.
    if (!this.templatesLooked) {
      this.templatesLooked = true;
      const told = this.templateLine();
      if (told) notices.push(told);
    }
    // Usage upload is on by default, so the first start that sends says so, once, with how to stop it.
    if (!this.uploadLooked) {
      this.uploadLooked = true;
      const told = uploadNotice(this.runtime.directory, this.now());
      if (told) notices.push(told);
    }
    const yesterday = this.yesterdayWins();
    if (yesterday && !noticeIds.has(yesterday.id)) notices.push(yesterday);
    if (this.answerTrouble) notices.push(this.answerTrouble);
    this.answerTrouble = null;
    for (const line of this.memoryLines?.splice(0) ?? []) {
      if (noticeIds.has(line.id)) continue;
      notices.push(line);
      noticeIds.add(line.id);
    }
    const handedLines = handedOver.map(entry => inboxNotice(entry, this.now()));
    for (const notice of [...sessionsEnded.map(sessionNotice), ...cardActions.map(cardActionNotice), ...handedLines, ...clientLines.map(clientNotice)]) {
      if (noticeIds.has(notice.id)) continue;
      notices.push(notice);
      noticeIds.add(notice.id);
    }
    const scheduledReports = runs.filter(isVisibleScheduledReport)
      .sort((a, b) => (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''));
    for (const run of scheduledReports) {
      if (noticedRunIds.has(run.id)) continue;
      noticedRunIds.add(run.id);
      const id = `notice:report:${createHash('sha256').update(String(run.id)).digest('hex')}`;
      if (noticeIds.has(id)) continue;
      const scheduleName = String(run.title ?? run.scheduleId ?? 'your routine').slice(0, 512);
      const triage = reportTriage(run);
      if (triage?.level === 'nothing') continue;
      // A busy project would push the conversation out of Chat, so what needs no answer takes a quiet line that folds into the next.
      if (run.work?.slug && !['critical', 'blocked'].includes(triage?.level)) {
        if (triage?.level === 'useful') notices.push(finishedLine(id, scheduleName, triage.message, run.finishedAt));
        continue;
      }
      // A look speaks for itself above, with every proposal in it.
      if (run.work?.lane === 'discover') continue;

      const schedule = loaded.schedules.find(item => item.id === run.scheduleId);
      const held = schedule?.nextRun?.state === 'held';
      const message = triage?.message ?? (held ? schedule.nextRun.reason : null);
      const call = triage?.next ? ` Next: ${triage.next}` : '';
      notices.push({
        id,
        role: 'notice',
        content: message
          ? `${scheduleName}: ${message}${call}${held ? pauseNote(schedule) : ''}`
          : `Report available for ${scheduleName}`,
        tone: held ? 'blocked' : triage?.level,
        at: run.finishedAt,
      });
      noticeIds.add(id);
    }
    const messages = foldFinishedLines([
      ...inReadOrder(visibleChatMessages(this.runtime.messages()).map(chatMessage)),
      ...notices.map(message => ({ message, time: messageTime(message) })),
    ].map((entry, index) => ({ ...entry, index }))
      .sort((left, right) => {
        if (left.time === null) return right.time === null ? left.index - right.index : -1;
        if (right.time === null) return 1;
        return left.time - right.time || left.index - right.index;
      })
      .map(({ message }) => message)).slice(-100);
    // `read` once the user opened it, `caught-up` once a catch-up covered it, and nothing while unread (069-report-catch-up).
    const readStates = reportReadStates(this.runtime.directory);
    const listedReports = [...reports, ...this.snapshot.history.reports.filter(report => {
      if (deleted.has(report.id) || reportIds.has(report.id)) return false;
      reportIds.add(report.id);
      return true;
    })].map(report => readStates.has(report.id) ? { ...report, readState: readStates.get(report.id) } : report);
    const currentAndRecentRuns = runs.filter((run, index) => run.status === 'running' || run.status === WAITING || index < 100);
    const visible = {
      version: 1,
      savedAt: new Date().toISOString(),
      // Saved selection for subsequent runs, not the active turn's applied voice.
      persona: readPersona(this.runtime.directory),
      telemetry: projectPerformance(this.runtime.directory, currentAndRecentRuns, {
        liveHelpers: this.runtime.ownedLifecycle?.snapshot?.() ?? [], savedTelemetry: this.snapshot.telemetry,
      }),
      // Every report is listed. The tab shows them a page at a time, so nothing needs cutting here. Each carries its short version once it has one.
      reports: this.shortReports?.carry(listedReports) ?? listedReports,
      messages,
      context: this.runtime.contextInfo(),
      runs: [
        ...loaded.errors.map(error => ({ title: `${error.path}: ${error.message}`, state: 'invalid' })),
        ...currentAndRecentRuns.map(run => ({
          id: run.id,
          title: run.title ?? run.id,
          state: run.status,
          kind: run.kind,
          scheduleId: run.scheduleId,
          harness: run.harness,
          model: run.model,
          effort: run.effort,
          // The tier its model came from: a session's own, or a work run's from its project's level (`bindingFor`).
          tier: run.tier,
          harnessId: run.harnessId,
          cwd: run.cwd ?? (run.kind === 'main' ? this.config.main.cwd : undefined),
          startedAt: run.startedAt,
          work: copyJson(run.work),
          stalled: stalled(run),
          stopReason: run.result?.stopReason,
          // A run that waits says until when and why, and every run that waited says how many times (053-run-waits).
          ...(run.status === WAITING ? { waitUntil: run.wait?.until, waitNote: run.wait?.note } : {}),
          ...(run.wait ? { waits: run.wait.waits } : {}),
          ...idleFields(run, this.runner?.idle?.get(run.id)),
        })),
      ],
      lastTick: loaded.lastTick,
      error: this.runtime.mainFault
        ? `Main chat stopped: ${this.runtime.mainFault.message} Your next message opens it again; scheduled checks keep running.`
        : loaded.error,
    };
    const saved = {
      ...visible,
      reports: visible.reports.map(report => ({ ...report, body: report.body.slice(0, 32 * 1024) })),
    };
    const signature = JSON.stringify({ ...saved, savedAt: null, lastTick: null });
    if (signature !== this.savedSignature) {
      atomicJson(join(this.runtime.directory, 'runtime/view.json'), saved);
      this.savedSignature = signature;
    }
    markPosted(this.runtime.directory, sessionsEnded);
    markCardActionsPosted(this.runtime.directory, cardActions);
    markInboxPosted(this.runtime.directory, handedOver);
    markClientNoticesPosted(this.runtime.directory, clientLines);
    const active = new Set(runs
      .filter(run => run.kind === 'background' && run.scheduleId && run.status === 'running')
      .map(run => run.id));
    const completedJobReports = {};
    const completedIds = new Set([
      ...runs.filter(run => run.kind === 'background' && run.status !== 'running' && run.status !== WAITING).slice(0, 100).map(run => run.id),
      ...this.activeJobIds,
    ]);
    for (const id of completedIds) {
      const run = state.runs[id];
      if (!run || run.status === 'running' || run.status === WAITING || run.hobkin) continue;
      if (deleted.has(id) || isQuietRun(run)) {
        completedJobReports[id] = null;
        continue;
      }
      const body = readReport(this.runtime.directory, id, null);
      if (body !== null) {
        completedJobReports[id] = {
          id,
          title: run.title ?? run.scheduleId ?? id,
          scheduleId: run.scheduleId,
          at: run.finishedAt,
          body,
          outcome: run.status,
        };
      }
    }
    // Publish the final buffered events once before releasing ended jobs.
    const jobActivity = Object.fromEntries(
      [...this.jobActivity].map(([id, feed]) => [id, feed.snapshot()]),
    );
    const helpers = this.runtime.helpers();
    for (const id of this.jobActivity.keys()) {
      if (!active.has(id)) this.jobActivity.delete(id);
    }
    this.endStoppedPulses(state.runs);
    this.noticeRunIds = noticedRunIds;
    for (const { id, tone } of notices.filter(({ id }) => !this.noticesCounted.has(id))) {
      this.noticesCounted.add(id);
      recordEvent(this.runtime.directory, 'notice_posted', { source: id.split(':')[1], tone });
    }
    if (visible.error && visible.error !== this.snapshot.error) recordEvent(this.runtime.directory, 'error_shown', { from: this.runtime.mainFault ? 'main' : 'runner' });
    this.notePause(work.pause?.kind ?? null);
    this.snapshot = {
      ...this.snapshot,
      ...visible,
      jobActivity,
      pulses: this.publishedPulses(),
      ...helpers,
      // The main chat runs as long as hobkin does, so its teams agents are never taken for those of a run that ended.
      teamsAgents: this.teamsAgents?.snapshot(new Set([...active, MAIN_AGENT])) ?? {},
      stopControls: this.runtime.stopControls(),
      steeringReceipts: this.runner.steeringReceipts(),
      completedJobReports,
      counts: loaded.counts,
      schedules: loaded.schedules,
      // The schedules agents keep for themselves, live and ended in the last hour (056-agent-schedules), not the routines above.
      agentSchedules: this.agentScheduleView(state),
      // Moves when any memory or the right-now list changes, so an open Memory page reads the list again (057-shared-memory).
      memoriesStamp: this.memoriesStamp(),
      usage: this.usageOf(state, version),
      memoryBytes: memoryBytes(this.runtime.directory),
      reportAttention: this.telemetry.attention(runs.filter(run => !run.hobkin), this.now()),
      work,
      hobkins: hobkinSummaries(state),
      decisions: readActionDecisions(this.runtime.directory),
      waiting: this.waitingNow(),
      wins: this.winsToday(),
      connection: 'connected',
      unread: this.unread,
      busy: this.runtime.mainBusy,
      // The main turn the user stopped, while nothing has started since: Chat offers to continue it.
      mainStopped: this.runtime.stoppedTurn,
      searching: searchingTool(this.runtime.mainTool),
      tooling: Boolean(this.runtime.mainTool),
      doing: this.runtime.mainDoing ?? null,
      mainActivity: this.runtime.mainActivity(),
      learning: learningEnabled(this.runtime.directory),
      userName: callName(readProfile(this.runtime.directory)),
      main: {
        harness: 'pi',
        model: `${this.runtime.main.model.provider}/${this.runtime.main.model.id}`,
        effort: this.runtime.main.thinkingLevel,
      },
    };
    this.moods.observe(this.snapshot);
    this.snapshot.mood = this.moods.reaction;
    this.onChange?.(this.snapshot);
    this.activeJobIds = this.onChange
      ? active
      : new Set([...this.activeJobIds, ...active]);
    return this.snapshot;
  }

  /**
   * The usage ledger as `state` makes it. It is worked out from every run, so it is worked out again only when a commit changed the document
   * or something else changed the ledger, and each caller gets a copy of its own.
   */
  usageOf(state, version) {
    const kept = this.keptUsage;
    const unchanged = version && kept?.version === version && kept.data === this.ledger.data;
    if (unchanged) return copyJson(kept.usage);

    const usage = this.ledger.sync(state);
    this.keptUsage = { version, data: this.ledger.data, usage: copyJson(usage) };
    return usage;
  }

  notePause(kind) {
    const was = this.pauseKind ?? null;
    this.pauseKind = kind;
    if (kind === was) return;
    if (was) recordEvent(this.runtime.directory, 'work_resumed', { pause: was });
    if (kind) recordEvent(this.runtime.directory, 'work_paused', { pause: kind });
  }

  // Messages go out in the order they were typed, and one the conversation cannot take yet waits here. During a turn `queue` says how it
  // waits for that turn: `steer`, or `follow-up` once the turn would end.
  send(text, report, images = [], { sentAt, queue } = {}) {
    // Where the turn's clock starts, read before the message waits its place: the user's Enter when the window said when that was.
    const turn = turnFrom(sentAt);
    this.sending++;
    const sent = this.outgoing.then(() => this.deliver(text, report, images, turn, queue)).finally(() => { this.sending--; });
    this.outgoing = sent.catch(() => {});
    return sent;
  }

  async stopWorkload(request) {
    const { action, id, reason } = request;
    if (!['list', 'stop'].includes(action) || Object.keys(request).some(key => !(action === 'list' ? ['action'] : ['action', 'id', 'reason']).includes(key))
      || (action === 'stop' && (typeof id !== 'string' || !/^work:[a-zA-Z0-9._:-]{1,195}$/.test(id)
        || typeof reason !== 'string' || !reason.trim() || reason.length > 200))) throw Error('Invalid workload Stop request.');
    const { runs } = await this.runtime.state();
    const owned = this.director.running().filter(entry => {
      const run = runs[entry.id];
      return this.runner.jobs.has(entry.id) && this.runtime.active.has(entry.id) && run?.status === 'running'
        && run.kind === 'background' && run.work?.planKey && run.work.planKey === entry.planKey
        && ['do', 'look', 'discover'].includes(entry.lane) && run.work.lane === entry.lane;
    });
    if (action === 'list') return { running: owned.slice(0, 20).map(({ id, title, lane }) => ({ id, title, lane })) };
    if (!owned.some(entry => entry.id === id)) throw Error('That exact owned Work parent is not active.');
    if (!await this.runner.kill(id, { source: 'main', reason: reason.trim() })) throw Error('Work parent interruption was not confirmed.');
    const run = (await this.runtime.state()).runs[id];
    if (run?.status !== 'interrupted' || run.result?.status !== 'interrupted' || run.mainStop?.reason !== reason.trim()) throw Error('Work parent interruption was not confirmed.');
    return { stopped: true, id, reason: run.mainStop.reason, scope: 'parent Work run', nestedCleanup: 'unconfirmed',
      report: savedReportPath(this.runtime.directory, id), partialResult: Boolean(run.result.text) };
  }

  async deliver(text, report, images = [], turn, queue) {
    // A main chat whose Pi ended opens the same conversation again for the user's next message.
    await this.runtime.reopenMain();
    const message = report ? referToReport(this.runtime.directory, report, text) : text;
    // What a message still waiting in the turn carries goes with that message alone, and with the next one only if it is never read.
    const waiting = this.newsWaiting();
    const sessions = sessionsToTell(this.runtime.directory).filter(({ name }) => !waiting.sessions.has(name));
    const actions = cardActionsToTell(this.runtime.directory).filter(({ id }) => !waiting.actions.has(id));
    const userDid = actions.filter(action => !action.mainStop);
    const mainStopped = actions.filter(action => action.mainStop);
    const handedOver = inboxToTell(this.runtime.directory, this.now()).filter(({ id }) => !waiting.inbox.has(id));
    const note = workNote({ ...workStatus(this.runtime.directory, this.director.outlook()), sessions, userDid, mainStopped, handed: inboxNews(handedOver) }, this.director.answerCommands());
    const opening = note === this.workNoteSeen || waiting.notes.has(note) ? '' : note;
    const learned = this.learner.note(this.runtime.messages());
    // "brief me" brings what a brief is written from, ahead of the words, in the room the work note and the words leave, and Chat shows only the words.
    const room = MAX_MESSAGE_BYTES - Buffer.byteLength(`${opening}${message}`);
    const brief = !report && asksForBrief(text) ? this.briefBlock(room) : '';
    // A message with no room for the note still goes, and the note goes with the next one.
    const fits = Buffer.byteLength(`${opening}${learned}${brief}${message}`) <= MAX_MESSAGE_BYTES;
    // What the user decided and how memory changed since the main agent's prompt was written goes with their words, so
    // the prompt itself can stay as it is and the conversation stays cached (`prompt-parts.mjs`). With no room it waits.
    const news = this.runtime.main?.promptNews?.() ?? null;
    const notes = `${opening}${fits ? learned : ''}${brief}`;
    const since = news && !waiting.since.has(news.text) && Buffer.byteLength(`${notes}${news.text}${message}`) <= MAX_MESSAGE_BYTES ? news.text : '';
    // Heard once the model reads it: at once for a message that starts its turn, and for one steered into a turn when Pi takes it in (014-continuity A10).
    const carried = { sessions, actions, handedOver, note, news: since ? news : null, briefedAt: brief ? new Date(this.now()).toISOString() : null };
    this.carrying().add(carried);
    let accepted;
    try {
      accepted = await this.sendWhenFree(`${notes}${since}${message}`, images, turn, read => this.heard(carried, read), queue);
    } catch (error) {
      this.carrying().delete(carried);
      throw error;
    }
    // The user's words reached the main agent's turn, a wake's they joined included, so its messages count from them.
    this.hobkins.userWrote();
    this.pastedImages.remove(images);
    if (!accepted?.queued) this.heard(carried, true);
    this.dropUnread();
    if (report) {
      this.telemetry.recordReportDiscussed(report.id, this.now());
      recordEvent(this.runtime.directory, 'report_messaged', { id: report.id });
      this.learner.noteReply(report.id, text);
    }
    this.requestRefresh();
    return accepted;
  }

  /**
   * What the user sent that the model never read before hobkin closed or crashed, as they typed it, for the window to put back in its
   * input (014-continuity A11). Undefined when there is none. It stays until the user's next message goes.
   */
  loadUnread() {
    try {
      const kept = readUnread(this.runtime.directory).map(({ id, text }) => ({ id, text: typedPart(text).text })).filter(({ text }) => text.trim());
      this.unread = kept.length ? kept : undefined;
    } catch {
      this.unread = undefined;
    }
  }

  /** The window has had them, and the user wrote again. */
  dropUnread() {
    if (!this.unread) return;
    try {
      forgetUnread(this.runtime.directory);
      this.unread = undefined;
    } catch {
      // They stay, and the window already holds them by their ids.
    }
  }

  /** The news each message carries until the model reads it or its turn ends without it. */
  carrying() {
    this.carried ??= new Set();
    return this.carried;
  }

  newsWaiting() {
    const waiting = { sessions: new Set(), actions: new Set(), inbox: new Set(), notes: new Set(), since: new Set() };
    for (const carried of this.carrying()) {
      for (const { name } of carried.sessions) waiting.sessions.add(name);
      for (const { id } of carried.actions) waiting.actions.add(id);
      for (const { id } of carried.handedOver) waiting.inbox.add(id);
      waiting.notes.add(carried.note);
      if (carried.news) waiting.since.add(carried.news.text);
    }
    return waiting;
  }

  /** A message the model read has its news heard. One it never read leaves its news for the next message. */
  heard(carried, read) {
    if (!this.carrying().delete(carried) || !read) return;
    const root = this.runtime.directory;
    carried.news?.told();
    this.workNoteSeen = carried.note;
    markHeard(root, carried.sessions);
    markCardActionsHeard(root, carried.actions);
    markInboxHeard(root, carried.handedOver);
    if (carried.briefedAt) writeBriefState(root, { briefedAt: carried.briefedAt });
  }

  async sendWhenFree(message, attachments, turn, onRead, queue) {
    const images = attachments.length ? this.pastedImages.contents(attachments) : undefined;
    for (;;) {
      try {
        return await this.runtime.send(message, undefined, images, turn, onRead, queue);
      } catch (error) {
        if (error.message !== MAIN_BUSY) throw error;
        // Only a turn, or a chat too full to wait, holds what the user sent. A compaction hobkin began early gives way.
        this.runtime.yieldCompaction();
        await wait(BUSY_RETRY_MS);
      }
    }
  }

  pasteImage() { return this.pastedImages.paste(this.runtime.imageRefusal); }
  dropImages(images) { this.pastedImages.remove(images); }

  /**
   * Stops a run. One that waits holds no process, so its record ends it, and its session hears of its end as a stopped
   * session does (053-run-waits). One that started again meanwhile is stopped as any running run.
   */
  async kill(runId) {
    const stop = { source: 'user', reason: 'Stopped from the agent view.' };
    if ((await this.runner.runIndex()).runs[runId]?.status === WAITING) {
      const stopped = await this.runtime.stopWaiting(runId, stop);
      if (stopped) {
        if (stopped.session) endSessionJob(this.runtime.directory, stopped.session, stopped);
        this.requestRefresh();
        return true;
      }
    }
    return this.runner.kill(runId, stop);
  }

  /**
   * The window's own commands for a schedule an agent keeps for itself (056-agent-schedules): cancel it, hold it or let
   * it go on, or run it now. Each answers `{ ok: true }`, or `{ ok: false, reason }` in plain words for an unknown or
   * ended schedule. hobkin's own agents change theirs with their tools, never with these.
   */
  async cancelAgentSchedule(id) { return this.scheduleCommand(id, schedules => schedules.cancel(id, 'user')); }

  async pauseAgentSchedule(id, paused) {
    if (typeof paused !== 'boolean') return { ok: false, reason: 'Say whether to pause it or let it go on.' };
    return this.scheduleCommand(id, schedules => schedules.pause(id, paused, 'user'));
  }

  async runAgentSchedule(id) { return this.scheduleCommand(id, schedules => schedules.runNow(id)); }

  scheduleCommand(id, command) {
    if (!this.agentSchedules) return { ok: false, reason: 'This hobkin keeps no schedules yet.' };
    if (typeof id !== 'string' || !id) return { ok: false, reason: 'There is no schedule with that id.' };
    try {
      const answer = command(this.agentSchedules);
      this.requestRefresh();
      return answer;
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) };
    }
  }

  /**
   * The schedules' second of the runtime's tick: those whose owner ended end with it, those whose lifetime passed end,
   * those due fire, what `hobkin schedule` asked is answered, and what they found goes to their agents. A home with no
   * live schedule, no wake and no run on Claude Code to answer reads nothing. Trouble here never stops the runtime's
   * tick: it is kept for the next look and the tick goes on.
   */
  async tickAgentSchedules() {
    // A home where `hobkin schedule` never ran and no run holds a token has nothing to answer.
    const asked = this.scheduleTokens?.size > 0 || scheduleAskedHere(this.runtime.directory);
    if (!asked && !this.agentSchedules?.live() && !this.agentSchedules?.pending.length) return;
    try {
      const { runs } = await this.runner.runIndex();
      if (asked) this.takeScheduleRequests(runs);
      this.agentSchedules.tick({ alive: owner => this.scheduleOwnerAlive(owner, runs) });
      this.deliverScheduleWakes(runs);
      // A store that could not be written is kept as the schedules' trouble, and the next write tries again.
      this.agentSchedulesError = this.agentSchedules.lastError ?? null;
    } catch (error) {
      this.agentSchedulesError = String(error?.message ?? error);
    }
  }

  /**
   * What an agent's schedule tools reach (056-agent-schedules): `make` and `manage` for its own schedules alone, their
   * commands run in `cwd`, and `liveUntil`, when the last of them ends, so a run can wait on them. A run that has waited
   * as often as one may cannot wait for a schedule, so it makes none. `canWait` is false for a run that cannot wait at
   * all, as on Claude Code, which is told its schedules end with its turn. `lives` is true for a job that lives until its
   * agent says it is done, whose schedules start a turn on its own process (072-jobs-live-until-done).
   */
  /**
   * What an agent's memory tools reach (057-shared-memory), by who it is: the main chat and a durable hobkin read
   * private memories and save at once, a run reads shared ones and suggests. A change one makes is posted in Chat.
   */
  memoryKeeper(owner, root = this.runtime.directory) {
    return memoryHandler(root, owner, { now: () => this.now(), onChange: change => this.memoryChanged(owner, change) });
  }

  /** The memories' fingerprint for the snapshot, or none when the folder cannot be looked at. */
  memoriesStamp() {
    try {
      return memoriesStamp(this.runtime.directory);
    } catch {
      return undefined;
    }
  }

  /** A run's title as the store holds it, or none when it cannot be read: that costs the name, never the run. */
  async runTitle(id) {
    try {
      return (await this.runtime.document?.())?.runs?.[id]?.title;
    } catch {
      return undefined;
    }
  }

  /** Who a run is to its memory tools: a durable hobkin's turn is that hobkin, any other run is itself, by its title. */
  memoryOwnerOf(run) {
    if (isTurnRunId(run.id)) {
      const id = run.id.split(':')[1];
      const title = this.hobkins?.records?.[id]?.title;
      return { kind: 'hobkin', id, ...(title ? { title } : {}) };
    }
    return { kind: 'run', id: run.id, title: run.title ?? run.id };
  }

  /** An agent changed a memory: Chat says so with the next refresh, quietly and with Undo, and the window reads the list again. */
  memoryChanged(owner, change) {
    if (typeof change?.change === 'string') (this.memoryLines ??= []).push(memoryLine(owner, change, this.now()));
    this.requestRefresh();
  }

  scheduleHandler(owner, cwd, { waits, canWait = true, lives = false } = {}) {
    const schedules = () => {
      if (!this.agentSchedules) throw Error('Schedules are not available here.');
      return this.agentSchedules;
    };
    return {
      make: params => {
        if (owner.kind === 'run' && !lives && Number.isInteger(waits) && waits >= MOST_WAITS) {
          throw Error(`This run has waited ${MOST_WAITS} times, the most one run may, so nothing could wake it for a schedule. Finish what you can now and end with your report.`);
        }
        const schedule = schedules().make(owner, cwd, params);
        this.requestRefresh();
        return { text: scheduledText(schedule, owner, { canWait, lives }), schedule };
      },
      manage: params => {
        const answer = schedules().manage(owner, params);
        this.requestRefresh();
        return { text: JSON.stringify(answer), ...answer };
      },
      liveUntil: () => this.agentSchedules?.liveUntil(owner) ?? null,
    };
  }

  /**
   * Delivers what schedules found, each to its own agent: a durable hobkin as a turn while it waits or a message into the
   * turn it is on, and a running run as a message steered in. The main chat's wait for it to be free (`tickWakes`), and
   * a waiting run's for a place to start in (`tickSessions`). A wake stays until it is delivered.
   */
  deliverScheduleWakes(runs) {
    this.scheduleDeliveries ??= new Set();
    const byOwner = Map.groupBy(this.agentSchedules.wakes(), wake => JSON.stringify([wake.owner.kind, wake.owner.id ?? null]));
    for (const [key, wakes] of byOwner) {
      const { owner } = wakes[0];
      const delivering = this.scheduleDeliveries.has(key);
      const waitsElsewhere = owner.kind === 'main' || (owner.kind === 'run' && runs[owner.id]?.status !== 'running');
      if (delivering || waitsElsewhere) continue;

      // The owner's place is held until this delivery itself settles, however long its run takes to take messages, so
      // one wake is never sent twice. A run that ends meanwhile settles it, and its wake waits for the next way in.
      this.scheduleDeliveries.add(key);
      const delivery = owner.kind === 'hobkin' ? this.wakeHobkin(owner.id, wakes) : this.steerRun(owner.id, wakes);
      void delivery
        .then(done => { if (done) this.agentSchedules.delivered(wakes.map(wake => wake.id)); })
        .catch(() => {})
        .finally(() => this.scheduleDeliveries.delete(key));
    }
  }

  /** A durable hobkin hears its schedules: a turn of its own while it waits, the turn it is on while it works. */
  async wakeHobkin(id, wakes) {
    const from = { kind: 'schedule', id: wakes[0].scheduleId, title: wakes.length === 1 ? wakes[0].name : `${wakes.length} schedules` };
    return Boolean(await this.hobkins.wake(id, { text: scheduleWakeBlock(wakes), short: scheduleWakeBlock(wakes, STEER_MOST), from }));
  }

  /** A running run hears its schedules in the turn it is on, as the main agent's message would reach it. */
  async steerRun(id, wakes) {
    const inbox = this.runner.inboxes.get(id);
    if (!inbox) return false;
    const send = await inbox.promise;
    await send(scheduleWakeBlock(wakes));
    return true;
  }

  /** What a waiting run's schedules found, for the start that wakes it: read as the start is admitted, and delivered then. */
  scheduleWakeFor(runId) {
    const owner = { kind: 'run', id: runId };
    if (!this.agentSchedules?.wakesFor(owner).length) return undefined;
    return () => {
      const wakes = this.agentSchedules.wakesFor(owner);
      if (!wakes.length) return undefined;
      this.agentSchedules.delivered(wakes.map(wake => wake.id));
      return scheduleWakeBlock(wakes);
    };
  }

  /**
   * The environment a run on Claude Code keeps its schedules with (`hobkin schedule`, 056-agent-schedules), for the host
   * to start that run's process with: a token of the run's own and the home. `commands` says whether hobkin may run a
   * command for it, which only a run whose Claude Code permissions are "all" may; any other may schedule plain wakes.
   * Null for a run that keeps no schedules, such as a Work run or a routine, and when the runs cannot be read: the run
   * then goes on without them. The token names the run only while it runs. It never rejects.
   */
  async agentScheduleEnvironment(harnessId, { commands = false } = {}) {
    try {
      const { runs } = await this.runner.runIndex();
      const run = Object.values(runs).find(item => item.harnessId === harnessId && item.status === 'running');
      const owner = run && scheduleOwnerOf(run.id);
      if (!owner) return null;
      const { cwd, wait } = (await this.runtime.state()).runs[run.id] ?? {};
      const token = turnToken();
      const waits = owner.kind === 'run' ? wait?.waits ?? 0 : undefined;
      (this.scheduleTokens ??= new Map()).set(token, { owner, runId: run.id, cwd, waits, commands: commands === true });
      return { [SCHEDULE_ENVIRONMENT.token]: token, [SCHEDULE_ENVIRONMENT.home]: this.runtime.directory };
    } catch (error) {
      this.agentSchedulesError = String(error?.message ?? error);
      return null;
    }
  }

  /** What `hobkin schedule` asked from a run's shell, each answered once, as the run its token names. A token outlives no run. */
  takeScheduleRequests(runs) {
    this.scheduleTokens ??= new Map();
    for (const [token, entry] of this.scheduleTokens) if (runs[entry.runId]?.status !== 'running') this.scheduleTokens.delete(token);
    for (const { id, request } of takeRequests(this.runtime.directory, SCHEDULE_REQUESTS)) {
      let answer;
      try {
        answer = { ok: true, value: this.fromScheduleCommand(request) };
      } catch (error) {
        answer = { ok: false, error: String(error?.message ?? error) };
      }
      try {
        answerRequest(this.runtime.directory, SCHEDULE_REQUESTS, id, answer);
      } catch {
        // The command then says hobkin did not answer.
      }
    }
  }

  fromScheduleCommand(request) {
    const entry = typeof request?.token === 'string' ? this.scheduleTokens?.get(request.token) : undefined;
    if (!entry) throw Error(NOT_A_RUN);
    // A session run on Claude Code has no waiting outcome, so its schedules end with its turn.
    const handler = this.scheduleHandler(entry.owner, entry.cwd, { waits: entry.waits, canWait: false });
    if (request.action === 'make') {
      if (!entry.commands && request.params?.command !== undefined) throw Error(NO_COMMANDS);
      return handler.make(request.params);
    }
    return handler.manage({ action: request.action, ...(request.id === undefined ? {} : { id: request.id }) });
  }

  /** The main chat lives as long as hobkin does, a durable hobkin until it is ended, and a run while it runs or waits. */
  scheduleOwnerAlive(owner, runs) {
    if (owner.kind === 'main') return true;
    if (owner.kind === 'hobkin') {
      const record = this.hobkins?.records?.[owner.id];
      return Boolean(record) && record.state !== 'ended';
    }
    return ['running', WAITING].includes(runs[owner.id]?.status);
  }

  /**
   * One agent's schedules with each run they made, for its conversation in the window: `owner` is the main chat, a
   * durable hobkin or a run. None when hobkin keeps no schedules or they cannot be read.
   */
  agentScheduleRuns(owner) {
    try {
      return { schedules: this.agentSchedules?.runs(owner) ?? [] };
    } catch {
      return { schedules: [] };
    }
  }

  /** Every schedule as the window shows it, each with its owner's name. None when they cannot be read. */
  agentScheduleView(state) {
    try {
      return this.agentSchedules?.view(owner => (owner.kind === 'main' ? 'hobkin'
        : owner.kind === 'hobkin' ? state.hobkins?.[owner.id]?.title : state.runs?.[owner.id]?.title)) ?? [];
    } catch {
      return [];
    }
  }

  /**
   * The user's Esc. Chat says so in one system line, and the main agent hears it with the next message, the way it hears what the user
   * did from a card. What the agent never read goes back to the user as they typed it. Null when no turn was running.
   */
  async interrupt() {
    const turn = this.runtime.mainTurn;
    const unsent = await this.runtime.interrupt();
    if (!unsent) return null;
    const recovery = this.recoverMainStop(turn);
    await this.refreshing?.catch(() => {});
    await this.refresh();
    return recovery.unsent;
  }

  /** Pi's Alt+Up: what waits for the running turn comes back as the user typed it, for the input, and the turn goes on. */
  async dequeue() {
    const taken = await this.runtime.dequeue();
    this.requestRefresh();
    return taken.map(text => typedPart(text).text).filter(text => text.trim());
  }

  /**
   * Continue after the user stopped a turn. Pi cannot resume a stopped run: its RPC has no such command, and its agent does not continue
   * from the reply the stop cut short. So the word goes as the user's own message, as they would type it in Pi, and the main agent hears
   * with it that they stopped its turn.
   */
  async continueStopped({ sentAt } = {}) {
    if (!this.runtime.stoppedTurn) throw Error('Nothing to continue: the last turn was not one you stopped.');
    return this.send(CONTINUE_WORDS, undefined, [], { sentAt });
  }

  recoverMainStop(turn, confirmed = true) {
    if (confirmed) this.runtime.noticeStop(turn, this.now());
    if (!turn.unread) return { status: 'unknown' };
    const alreadyReturned = turn.draftsReturned === true;
    turn.draftsReturned = true;
    return { status: 'confirmed', unsent: alreadyReturned ? [] : turn.unread.map(text => typedPart(text).text), ...(alreadyReturned ? { alreadyReturned: true } : {}) };
  }

  async stopExecution({ kind, runId, agentId, mode, attemptId, how }) {
    if (!['stop', 'force'].includes(mode) || !this.runtime.stopControls().targets.some(target => target.kind === kind && target.runId === runId && target.agentId === agentId)) throw Error('Stale execution target.');
    if (how !== undefined && (kind !== 'run' || !this.runtime.active.get(runId)?.request.work || !['for-now', 'not-approved'].includes(how))) throw Error('Stop disposition requires a Work parent.');
    const receipt = { target: { kind, runId, ...(agentId ? { agentId } : {}) }, mode, attemptId,
      stop: { status: 'not-attempted' }, closure: { status: 'not-attempted' },
      descendants: { status: 'not-attempted', agents: [], cleanupScope: 'none', detachedCleanup: 'unknown' }, queueRecovery: { status: 'not-attempted' } };
    if (kind === 'main') {
      const turn = this.runtime.mainTurn;
      const forced = mode === 'force' ? this.runtime.forceMain(turn) : null;
      const stopped = this.runtime.stopTurn(turn).catch(error => { if (error.code !== 'STOP_UNCONFIRMED') throw error; });
      if (forced) { Object.assign(receipt, await forced); void stopped.catch(() => {}); await controlWait(turn.recovery?.catch(() => {})); }
      else await stopped;
      receipt.stop.status = turn.cancellationConfirmed ? 'confirmed' : 'unknown';
      if (!forced) receipt.descendants = descendantReceipt(turn.cleanup ?? (turn.owned ? undefined : { confirmed: true, agents: [] }));
      receipt.queueRecovery = this.recoverMainStop(turn, turn.cancellationConfirmed || (receipt.closure.status === 'confirmed' && receipt.descendants.status === 'confirmed'));
    } else if (kind === 'agent') {
      const cleanup = await controlWait(mode === 'force' ? this.runtime.ownedLifecycle.force(runId, agentId) : this.runtime.ownedLifecycle.stop(runId, agentId));
      receipt.descendants = descendantReceipt(cleanup);
      receipt[mode === 'force' ? 'closure' : 'stop'].status = receipt.descendants.status;
      receipt.closure.status = receipt.descendants.status;
    } else {
      const active = this.runtime.active.get(runId);
      const operation = async (_id, stop) => {
        if (mode === 'stop') return this.runner.kill(runId, stop);
        Object.assign(receipt, await this.runtime.forceRun(runId, stop));
        const ended = await controlWait(active.completion);
        if (ended?.status !== 'interrupted') throw Object.assign(Error('Stop outcome is unconfirmed.'), { code: 'STOP_UNCONFIRMED' });
        return true;
      };
      try {
        const stopping = active.request.work
          ? this.director.stopFromScreen(runId, how === 'not-approved' ? 'decline' : 'for-now', operation)
          : operation(runId, { source: 'user', reason: 'Stopped from the agent view.' });
        const result = mode === 'force' ? await stopping : await controlWait(stopping);
        receipt.stop.status = result ? 'confirmed' : 'unknown';
      } catch (error) { if (error.code !== 'STOP_UNCONFIRMED') throw error; receipt.stop.status = 'unknown'; }
      if (mode === 'stop') {
        receipt.closure.status = active.transportClosed ? 'confirmed' : 'unknown';
        receipt.descendants = descendantReceipt(active.cleanup);
      }
    }
    this.requestRefresh();
    return receipt;
  }

  workView(status = null) {
    const discovering = this.director.running().some(run => run.lane === 'discover');
    return { ...(status ?? workStatus(this.runtime.directory, this.director.outlook())), discovering };
  }

  // Agents file work from their own processes, and nothing else tells the dashboard it changed.
  async tickWork() {
    this.moods.notice();
    await this.director.tick();
    await this.learn();
    const root = this.runtime.directory;
    // The director's look of this tick serves its Work status too, while nothing it read has changed since.
    const outlook = this.director.outlook();
    const watched = {
      work: workStatus(root, outlook, { shared: this.director.sharedLook?.(outlook), plan: this.director.planWork }),
      decisions: readActionDecisions(root),
      learning: learningEnabled(root),
      // At least once a minute, for whatever else in the dashboard moves with the clock alone.
      minute: Math.floor(this.now() / 60_000),
    };
    // How much of a usage window's time has gone moves on every tick, so it counts in whole percent, as Work's words say it.
    const inWholePercent = (key, value) => (key === 'elapsedPercent' && typeof value === 'number' ? Math.round(value) : value);
    this.workReads.set(watched.work, ++this.workReadCount);
    const signature = JSON.stringify(watched, inWholePercent);
    if (signature === this.workSignature) return;
    // A running agent's token counts move with every message it writes. When nothing else moved, the counts go out the light way.
    const steady = JSON.stringify({ ...watched, work: withoutLiveCounts(watched.work) }, inWholePercent);
    const countsOnly = this.workSignature != null && steady === this.steadyWorkSignature;
    this.workSignature = signature;
    this.steadyWorkSignature = steady;
    if (countsOnly) this.publishWork(watched.work);
    else this.requestRefresh(false, watched.work);
  }

  /** Work as a tick just read it, published as activity is: the rest of the view stays as the last rebuild made it. */
  publishWork(status) {
    if (this.closing) return;
    const work = this.workView(status);
    this.lightWork = { read: this.workReads.get(status) ?? 0, work };
    this.snapshot = { ...this.snapshot, work };
    this.onChange?.(this.snapshot);
  }

  /**
   * A rebuild shows the Work a tick read before it began, and a light publish made while it ran is newer: that one is shown again, so
   * the window never goes back to older counts. A rebuild that read Work itself read it last, after its own waits, and keeps it.
   */
  keepNewerWork(asked) {
    const light = this.lightWork;
    if (!asked || this.closing || !light || light.read <= (this.workReads.get(asked) ?? 0)) return null;
    this.snapshot = { ...this.snapshot, work: light.work };
    this.onChange?.(this.snapshot);
    return this.snapshot;
  }

  /**
   * A branch the user said to refresh and merge merges once its refresh has ended well, and what came of it is told like an action on a card:
   * one line in Chat, and the main agent hears it. A problem here costs this tick its look, and the next tick looks again.
   */
  async tickRefreshed() {
    const root = this.runtime.directory;
    try {
      const results = await mergeRefreshed(root, { now: this.now() });
      for (const { told } of results) recordCardAction(root, told, this.now());
      if (results.length) this.requestRefresh();
    } catch {
      // Nothing was used up: the word to merge stays on the item until a merge is tried.
    }
  }

  /** What other sessions handed over comes up by itself: a reminder whose day has come asks in Decisions, and anything new gets its line in Chat. */
  tickInbox() {
    const root = this.runtime.directory;
    try {
      const asked = askReminders(root, this.now());
      const toPost = inboxToPost(root, this.now());
      if (asked || toPost.length) this.requestRefresh();
    } catch {
      // Nothing is marked before it is done, so the next tick looks again.
    }
  }

  // Learning watches the product, so a problem in it can never stop a tick.
  async learn() {
    try {
      if (!this.learner.enabled()) return;
      // Every run whole is read only for a pass the learner would make: a run finished, telemetry moved, or its evidence aged.
      const index = await this.runtime.runIndex?.();
      if (Number.isInteger(index?.finished) && !this.learner.due(index.finished)) return;
      const { runs } = await this.runtime.state();
      const { schedules } = this.runner.loaded;
      if (this.learner.settle({ runs: Object.values(runs), schedules, attention: this.snapshot.reportAttention })) this.requestRefresh();
    } catch {
      /* Nothing it holds is lost: the next pass works it out again. */
    }
  }

  async toggleLearning() {
    const root = this.runtime.directory;
    const result = setLearning(root, !learningEnabled(root));
    this.workSignature = null;
    await this.refresh();
    return result;
  }

  // Compacting takes the chat away for about a minute, so it goes where nobody is waiting on it. A busy session that reaches the force
  // level is Pi's to compact between model calls. This is never awaited, because schedules keep their time.
  tickCompaction() {
    const now = this.now();
    const lastMessageAt = this.runtime.messages().at(-1)?.timestamp ?? 0;
    const due = compactionDue({
      ...this.runtime.contextInfo(),
      free: this.canStartHoldTurn(),
      quietMs: now - lastMessageAt,
      agentsRunning: this.runner.jobs.size > 0,
      nextRunInMs: nextRunIn(this.snapshot.schedules, now),
      now,
    });
    if (due && this.canStartHoldTurn()) return this.runtime.compactMain({ early: due === 'smart' });
    return false;
  }

  // Nobody asked for this turn, so it never steers one under way or overtakes what the user sent.
  canStartHoldTurn() {
    return !this.closing && !this.sending && this.runtime.mainFree;
  }

  /** A held check owes the user a plan. This never waits for the turn itself, because the turn's `run_routine` needs this tick to end. */
  async tickHolds() {
    const owed = schedules => schedules.filter(({ nextRun }) => nextRun?.state === 'held' && !this.handledHolds.has(nextRun.holdId));
    if (!owed(this.snapshot.schedules ?? []).length || !this.canStartHoldTurn()) return;

    const { schedules, runs } = await this.runner.snapshot();
    for (const schedule of owed(schedules)) {
      const { holdId } = schedule.nextRun;
      const turn = nextHoldTurn(holdId, runs);
      if (turn && !this.canStartHoldTurn()) return;

      this.handledHolds.add(holdId);
      if (!turn) continue;

      // Its receipt records a failure, for the next start to pick up.
      void this.runtime.send(holdBrief(this.runtime.directory, schedule, runs, turn), turn.id).catch(() => {});
      return;
    }
  }

  /**
   * A session the agent started with `--wake` ended, or a command it scheduled failed. Each is told once, as soon as the agent is free, and
   * nothing waits for the turn. A failure counts only from this open on, because one from before it was told by the hobkin that saw it.
   */
  tickWakes() {
    if (this.waking || !this.canStartHoldTurn()) return;
    if (this.handOffs?.length) {
      // A choice that could not be sent goes back in front, for the next try.
      const jobs = this.handOffs.splice(0);
      void this.runtime.send(handOffBrief(jobs)).catch(() => { this.handOffs.unshift(...jobs); });
      return;
    }
    const root = this.runtime.directory;
    const sessions = sessionsToWake(root);
    if (sessions.length) {
      this.waking = true;
      return this.runtime.send(sessionsBrief(sessions)).then(() => {
        markWoken(root, sessions);
        markHeard(root, sessions);
        markCardActionsHeard(root, sessions.filter(session => session.stopRunId)
          .map(session => ({ id: `user-stop:${session.stopRunId}` })));
      }).catch(() => {}).finally(() => { this.waking = false; });
    }
    // What jobs handed out said as a turn ended without hobkin_done, as when one asks the user, told once for each such
    // turn as soon as the agent is free (072-jobs-live-until-done). One that does not go is tried again after five minutes.
    const replies = this.now() >= (this.jobsWakeAfter ?? 0) ? this.runner?.idleReplies().slice(0, JOBS_TOLD_MOST) ?? [] : [];
    if (replies.length) {
      this.waking = true;
      return this.runtime.send(jobsBrief(replies)).then(() => this.runner.toldIdle(replies))
        .catch(error => { if (error?.message !== MAIN_BUSY) this.jobsWakeAfter = this.now() + HOBKIN_WAKE_RETRY_MS; })
        .finally(() => { this.waking = false; });
    }
    // Messages durable hobkins sent the main agent with `hobkin tell`, delivered once, as soon as it is free. They leave
    // the store only once it took the turn. One the main agent cannot take, as with a sign-in that ran out, waits five minutes.
    const messages = this.now() >= (this.messagesWakeAfter ?? 0) ? this.hobkins.forMain() : [];
    if (messages.length) {
      this.waking = true;
      return this.runtime.send(messagesBrief(messages), this.hobkins.mainTurnFor(messages)).then(() => this.hobkins.heardByMain(messages))
        .catch(error => { if (error?.message !== MAIN_BUSY) this.messagesWakeAfter = this.now() + HOBKIN_WAKE_RETRY_MS; })
        .finally(() => { this.waking = false; });
    }
    // What the main agent's own schedules found, as soon as it is free (056-agent-schedules). One that does not go, as
    // with a sign-in that ran out, is tried again after five minutes.
    const scheduled = this.now() >= (this.scheduleWakeAfter ?? 0) ? this.agentSchedules?.wakesFor({ kind: 'main' }) ?? [] : [];
    if (scheduled.length) {
      this.waking = true;
      return this.runtime.send(agentSchedulesBrief(scheduled, MAIN_WAKE_MOST)).then(() => this.agentSchedules.delivered(scheduled.map(wake => wake.id)))
        .catch(error => { if (error?.message !== MAIN_BUSY) this.scheduleWakeAfter = this.now() + HOBKIN_WAKE_RETRY_MS; })
        .finally(() => { this.waking = false; });
    }
    const failures = this.untoldFailures();
    if (!failures.length) return;
    for (const failure of failures) this.failuresTold.add(failureKey(failure));
    void this.runtime.send(scheduledBrief(failures)).catch(() => {});
  }

  /**
   * Sessions `hobkin session` asked for start here as background jobs, each on the model of the tier its work was
   * given (`tiers.mjs`), and a kept one as a durable hobkin on that tier, which needs no free place. The tiers are read
   * as they stand now, so one the user just set is used by the next job.
   * A session that waited and whose time has come starts again first, earliest first, by the same rule of a free place
   * (053-run-waits), and one with no place keeps waiting for a later tick. Resolves once they have all ended.
   */
  tickSessions() {
    const root = this.runtime.directory;
    return this.runner.serialize(async () => {
      if (this.runner.stopped) return [];
      const index = await this.runner.runIndex();
      let capacity = Math.max(0, this.config.concurrency - this.runner.scheduledJobCount(index));
      // Reserve synchronously, but release admission before waiting for any job to finish.
      this.sessionJobs ??= new Set();
      const track = started => {
        const job = started.catch(() => {}).finally(() => {
          this.sessionJobs.delete(job);
          this.requestRefresh();
        });
        this.sessionJobs.add(job);
      };
      const waiting = capacity > 0 && Object.values(index.runs).some(run => run.status === WAITING);
      for (const run of waiting ? (await this.sessionsDue()).slice(0, capacity) : []) {
        track(resumeSessionJob({ root, runner: this.runner, now: this.now() }, run, this.scheduleWakeFor(run.id)));
        capacity--;
      }
      const requests = takeSessionRequests(root, capacity);
      let config = this.config;
      try {
        if (requests.length) config = loadConfig(root);
      } catch {
        // A configuration that cannot be read just now leaves the tiers as hobkin last knew them.
      }
      for (const session of requests) {
        const { model, effort, tier } = tierBinding(config, session.tier);
        track(session.keep
          ? startKeptSession({ root, hobkins: this.hobkins, tier }, session)
          : startSessionJob({ root, runner: this.runner, model, effort, tier }, session));
      }
      return [...this.sessionJobs];
    }).then(jobs => Promise.all(jobs));
  }

  /**
   * Sessions that wait and whose time has come, or that their schedules woke (056-agent-schedules), earliest first. Read
   * whole, so it is asked only while a run waits.
   */
  async sessionsDue() {
    const now = this.now();
    const woken = new Set((this.agentSchedules?.wakes() ?? []).filter(wake => wake.owner.kind === 'run').map(wake => wake.owner.id));
    return Object.values((await this.runtime.state()).runs)
      .filter(run => run.status === WAITING && run.session && (Date.parse(run.wait?.until) <= now || woken.has(run.id)))
      .toSorted((a, b) => Date.parse(a.wait.until) - Date.parse(b.wait.until));
  }

  /** Work the user chose on a card that work mode cannot start. The main agent gets it as soon as it is free, and hands it to a session. */
  handOff(job) {
    (this.handOffs ??= []).push(job);
  }

  untoldFailures() {
    const failures = this.runtime.messages()
      .filter(message => message.timestamp >= this.openedAt)
      .map(scheduledFailure)
      .filter(failure => failure && !this.failuresTold.has(failureKey(failure)));
    return failures.filter((failure, index) => failures.findIndex(other => failureKey(other) === failureKey(failure)) === index);
  }

  async workAction(action, slug, value, extra) {
    const root = this.runtime.directory;
    const turnOn = folder => {
      const mode = startWork(root, folder);
      fileFirstPair(root, this.now());
      filePickUp(root, this.now());
      return mode;
    };
    const actions = {
      toggle: () => (readMode(root).enabled ? writeMode(root, { enabled: false }) : turnOn()),
      start: () => turnOn(slug),
      allow: () => answerAllowance(root, true),
      keep: () => answerAllowance(root, false),
      choose: () => chooseProject(root, slug, value),
      level: () => chooseProject(root, slug, value),
      priority: () => setProjectPriority(root, slug, value),
      prs: () => setProjectPrMode(root, slug, value),
      // Which of the project's open GitHub issues it files as work by itself: `off`, `labeled` or `all`.
      issues: () => setProjectIssues(root, slug, value),
      // Work mode on one project only: paused, its agents finish and nothing new starts there; resumed, its work is back in the queue.
      pauseProject: () => pauseWork(root, slug),
      resumeProject: () => resumeWork(root, slug),
      // A GitHub issue the user added from the client's GitHub page, as `{ repo, number, title, body, url, labels }`. It goes first in the queue.
      // With `again: true` too, an issue whose work is finished is filed once more as a follow-up.
      issue: () => addIssue(root, slug, value, this.now()),
      grade: () => updateItem(root, slug, value, { grade: extra }),
      skip: () => skipProject(root, slug),
      drop: () => dropProject(root, slug),
      done: () => markDone(root, slug, value),
      run: () => pickNext(root, slug),
      // Start now on a queue row: at once, as one extra worker when none is free. The tick below starts it.
      now: () => triggerRow(root, slug, undefined, { now: true }),
      // One project's readiness for YOLO mode, run now whether YOLO mode is on or off. It starts the same way, and merges nothing.
      ready: () => runReadiness(root, slug, this.now()),
      later: () => skipInQueue(root, slug),
      back: () => putBackInQueue(root, slug),
      retry: () => retryItem(root, slug, value),
      diff: () => openDiff(root, slug, value),
      review: () => requestReview(root, slug, value),
      merge: () => mergeItem(root, slug, value, { ...extra, route: 'key' }),
      decline: () => declineItem(root, slug, value),
      // A review's "Remove and delete branch": `{ look: true }` says what it would delete, and `{ expect }` deletes exactly that.
      deleteBranch: () => deleteItemBranch(root, slug, value, extra),
      // `k` on an agent at work names the run, and how it stops: `decline` or `later`.
      stop: () => this.director.stopFromScreen(slug, value),
      ask: () => askAgent(root, slug, value, extra),
      // The client's AI review found hobkin's own finished change risky: an agent goes back to make it safe, or the user hears what is left.
      fixRisk: () => fixRisk(root, slug, value, extra, this.now()),
      riskStays: () => riskStays(root, slug, value, extra, this.now()),
      pr: () => prView(root, slug, value),
      decide: () => this.decide(slug, value),
      words: () => this.answerWords(slug, value),
      learning: () => this.answerLearning(slug, value),
      mergePr: () => mergePullRequest(root, slug, value, extra),
      // The user approved a finished branch in a review: its PR opens at the commit they approved.
      publish: () => publishItem(root, slug, value, { ...extra, now: this.now() }),
      refreshMerge: () => refreshThenMerge(root, slug, value, { ...extra, now: this.now() }),
      open: () => openPullRequest(root, slug, value),
      // A group's one yes comes as its rows, in the order they go, in place of a project.
      group: () => mergeGroup(root, slug, { ...value, now: this.now() }),
    };
    const result = await actions[action]();
    if (WALK_EVENTS[action]) recordEvent(root, WALK_EVENTS[action], { project: slug, item: value });
    for (const { action: walked, slug: project, item } of result?.walked ?? []) {
      if (WALK_EVENTS[walked]) recordEvent(root, WALK_EVENTS[walked], { project, item });
    }
    for (const told of [action === 'stop' ? [] : result?.told ?? []].flat()) {
      recordCardAction(root, told, this.now());
      this.moods.react({ event: 'card', did: told.did });
    }
    for (const job of [result?.handOff ?? []].flat()) this.handOff(job);
    await this.director.tick();
    // A refresh already under way read the state before this change, and the screen must show the change.
    await this.refreshing?.catch(() => {});
    await this.refresh();
    return result;
  }

  /** The asker hears first, so an answer that cannot reach it stays open for another try. A merge that fails is the same: it throws, and the reason goes on screen. */
  async decide(id, value) {
    const root = this.runtime.directory;
    const { decision, choice } = findDecision(root, id, value);
    const { answerTo } = decision;
    const result = await carryOutAnswer(root, id, { value }, this.now());
    // A question the main agent asked and the user put off is answered here, and the main agent hears the choice in Chat, as if said there.
    if (answerTo?.kind === 'chat') this.tellMain(decision, choice.label);
    // Doing it with hobkin hands the item to the main agent in Chat, and it leaves Action Items. The main agent closes it once it is done.
    if (result.handOff) {
      this.showRow?.({ tab: 'chat' });
      const { tldr, question, why, links = [], from, at, answerTo } = result.handOff;
      const file = answerTo?.file && `${answerTo.subject === 'template' ? 'Template' : 'Routine'} file: ${answerTo.file}`;
      const body = [
        `${from ?? 'hobkin'}: ${tldr}`,
        question !== tldr && question,
        why && `Why the user: ${why}`,
        ...links.map(({ label, url }) => `${label}: ${url}`),
        file,
        `Action item ID: ${id}`,
      ];
      void this.send(result.handOffText ?? 'Help me do this.', { id: `action:${id}`, title: 'Action item', at, body: body.filter(Boolean).join('\n') }).catch(() => {});
    }
    if (answerTo?.kind === 'land' && value === 'walk') this.showDone?.();
    if (value === 'read' && ['merge', 'read'].includes(answerTo?.kind)) this.showDone?.(answerTo);
    if (answerTo?.kind === 'pair' && value === 'read') this.showDone?.();
    return result;
  }

  /**
   * Their own words answer it, and whoever asked hears them. Hobkin's own questions have no asker to hear words, so the main agent gets them
   * with the question, in Chat, and acts on them there.
   */
  async answerInWords(decision, words) {
    const root = this.runtime.directory;
    await carryOutAnswer(root, decision.id, { typed: words }, this.now());
    if (!['work', 'routine', 'outside'].includes(decision.answerTo?.kind)) this.tellMain(decision, words);
    await this.refresh();
  }

  /** The user's answer goes to the main agent in Chat, with the question it answers. */
  tellMain(decision, words) {
    this.showRow?.({ tab: 'chat' });
    void this.send(words, { ...aboutDecision(decision), id: `decision:${decision.id}`, kind: 'decision', at: decision.at }).catch(() => {});
  }

  /** Words typed under a question in Decisions answer that question. */
  async answerWords(id, words) {
    await this.answerInWords(findOpenDecision(this.runtime.directory, id), words);
    return { ok: true, message: 'Answered in your own words.' };
  }

  /** The oldest decision that has not had its moment on screen. The tick awaits nothing, so a log that cannot be read costs this look and nothing more. */
  nextUnshown(root) {
    try {
      return readActionDecisions(root).find(({ shown }) => !shown) ?? null;
    } catch {
      return null;
    }
  }

  /** Nobody was there to see it, so it waits in Decisions and the next brief without opening. */
  parkUnseen(root, decision) {
    try {
      markShown(root, decision.id);
      this.requestRefresh();
    } catch {
      // The next look tries again.
    }
  }

  /**
   * A question from a routine or work mode gets 30 seconds on screen, and after that it waits in Decisions. A choice answers it, or the user's
   * own words. It opens only to a user who is there: one filed while they are away waits for them, and after ten minutes it waits in Decisions
   * and the next brief instead of opening to an empty room.
   */
  async presentDecision() {
    if (this.presenting) return;
    const root = this.runtime.directory;
    const next = this.nextUnshown(root);
    if (!next) return;

    const waited = this.now() - Date.parse(next.at);
    const presence = this.presence?.();
    if (presence && !isPresent(presence, this.now())) {
      if (waited >= UNSEEN_MS) this.parkUnseen(root, next);
      return;
    }
    const overdue = waited >= QUESTION_WAIT_MS;
    this.presenting = true;
    try {
      const { question, choices, id } = next;
      const answer = this.runtime.mainTurn ? undefined : await this.askQuestion?.({ requestId: id, question, choices, other: true, whenQuiet: true, waitMs: QUESTION_WAIT_MS });
      if (answer?.typed) await this.answerInWords(next, answer.typed);
      else if (answer) await this.workAction('decide', id, answer);
      else if (answer === null || overdue) {
        markShown(root, id);
        await this.refresh();
      }
    } catch (error) {
      // It stays in Decisions for another try. The question has left the screen, so what went wrong goes to Chat, and asking again at once would only repeat it.
      markShown(root, next.id);
      this.answerTrouble = {
        id: `notice:answer:${next.id}:${this.now()}`,
        role: 'notice',
        content: error.message,
        tone: 'critical',
        at: new Date(this.now()).toISOString(),
      };
      this.requestRefresh();
    } finally {
      this.presenting = false;
    }
  }

  /**
   * Someone back after a while finds what came in, so hobkin offers a brief, once for each return, in a line that asks nothing. When the user
   * was last here is kept on disk, so a restart, or a night with hobkin closed, still counts as time away. Any trouble costs one look.
   */
  lookForReturn() {
    const now = this.now();
    const presence = this.presence?.();
    if (!presence || now - this.returnLookedAt < PENDING_LOOK_MS) return;
    this.returnLookedAt = now;
    if (!isPresent(presence, now)) return;

    try {
      const root = this.runtime.directory;
      const state = readBriefState(root);
      const since = returnedSince({ lastSeenAt: state.lastSeenAt, seenAt: presence.seenAt });
      const offer = since && state.offer?.since !== since ? this.offerAfter(root, since, now) : null;
      const seen = seenMoved(state, presence.seenAt) ? { lastSeenAt: new Date(presence.seenAt).toISOString() } : {};

      const patch = { ...seen, ...(offer ? { offer } : {}) };
      if (Object.keys(patch).length) writeBriefState(root, patch);
      if (offer) this.requestRefresh();
    } catch {
      // The next look works it out again.
    }
  }

  /** The offer for a return, or none when too little came in while the user was away. */
  offerAfter(root, since, now) {
    const arrived = arrivedSince({
      decisions: readActionDecisions(root),
      reports: this.snapshot.reports ?? [],
      read: readReportIds(root),
      since,
    });
    if (arrivedCount(arrived) < BRIEF_BAR) return null;

    return { since, at: new Date(now).toISOString(), line: offerLine(arrived) };
  }

  /** What a brief is written from, as of now, in the room the message has left. A problem gathering it costs this message its brief, and the words still go. */
  briefBlock(room) {
    try {
      const root = this.runtime.directory;
      const now = this.now();
      const reports = this.snapshot.reports ?? [];
      const material = briefMaterial({
        since: briefSince(readBriefState(root), now),
        now,
        decisions: readActionDecisions(root),
        reports,
        read: readReportIds(root),
        waiting: readPending(root, { now }),
        rows: readWaiting(root, { now }),
        reportPath: id => savedReportPath(root, id),
      });
      return briefNote(material, { most: room });
    } catch {
      return '';
    }
  }

  /** Today's wins and the days in a row, for the Decisions tab. A problem counting them costs this refresh the line and nothing else. */
  winsToday() {
    try {
      return winsNow(this.runtime.directory, this.now());
    } catch {
      return this.snapshot.wins ?? null;
    }
  }

  /** What got done yesterday, as one line in Chat on the first look of a new day. */
  yesterdayWins() {
    try {
      const content = yesterdayLine(this.runtime.directory, this.now());
      const at = new Date(this.now()).toISOString();
      return content && { id: `notice:wins:${at.slice(0, 10)}`, role: 'notice', content, tone: 'useful', at };
    } catch {
      return null;
    }
  }

  /** A crash draft from an earlier run is offered once a start, with its exact bytes, and only a yes sends it. */
  async offerCrash() {
    const root = this.runtime.directory;
    try {
      const draft = crashToOffer(root);
      if (!draft || !this.askQuestion) return;
      const intro = "hobkin stopped on an uncaught error last time and wrote this crash report. Send it to hobkin's developers?";
      const answer = await this.askQuestion({ ...feedbackQuestion(draft, { intro }), whenQuiet: true });
      if (answer === 'keep') discardDraft(root, draft.id);
      if (answer !== 'send') return;

      const sent = await sendApproved(root, draft, this.remote.options);
      this.answerTrouble = {
        id: `notice:feedback:${draft.id}`,
        role: 'notice',
        content: sent.message,
        tone: sent.ok ? 'useful' : 'critical',
        at: new Date(this.now()).toISOString(),
      };
      this.requestRefresh();
    } catch {
      // The draft stays as it was, and the next start offers it again.
    }
  }

  /** What an update brought in routine templates, as one line in Chat. Trouble reading them costs the line and nothing else. */
  templateLine() {
    try {
      const news = templateNews(this.runtime.directory);
      // A new or newer template becomes one item to try, so it waits in Action Items beside the notice.
      fileTemplateNews(this.runtime.directory, news, this.now());
      const content = templateNotice(news);
      const at = new Date(this.now()).toISOString();
      return content && { id: `notice:templates:${at}`, role: 'notice', content, tone: 'useful', at };
    } catch {
      return null;
    }
  }

  /** Every row the card counts, for the Decisions tab. A problem reading them costs this refresh its rows and nothing else. */
  waitingNow() {
    try {
      return readWaiting(this.runtime.directory, { now: this.now() });
    } catch {
      return this.snapshot.waiting ?? null;
    }
  }

  /** The answer is the user's word, so it is recorded here and leaves Decisions at once. A yes also asks the main agent for the plan, as saying yes in Chat does, without holding the screen while it is busy. */
  answerLearning(id, value) {
    const root = this.runtime.directory;
    const proposal = learningState(root).proposals.find(entry => entry.id === id);
    if (!proposal) throw Error('That proposal was already answered.');
    runLearningCommand(root, ['answer', id, value], { now: this.now() });
    if (value === 'later') return { ok: true, message: `"${proposal.title}" comes up again in a week.` };
    if (value === 'no') {
      const repo = /^work\.([^.]+)\./.exec(proposal.scope)?.[1];
      return { ok: true, message: repo ? `No more learning proposals for ${repo}.` : `"${proposal.title}" will not come up again.` };
    }

    this.showRow?.({ tab: 'chat' });
    const about = { id: `learning:${id}`, title: 'Learning proposal', at: proposal.at, body: `${proposalMessage(proposal)}\nProposal ID: ${id}` };
    void this.send('Yes, plan it.', about).catch(() => {});
    if (proposal.kind === DIRECTIONS_KIND) return { ok: true, message: 'The main agent adds them to Your directions and says what it added.' };
    return { ok: true, message: 'The main agent writes the plan, and asks before changing anything.' };
  }

  recordReportRead(read) {
    this.telemetry.recordReportRead(read, this.now());
    recordEvent(this.runtime.directory, 'report_read', { id: read.id, ms: read.dwellMs });
    this.requestRefresh();
  }

  async reset() {
    const result = await this.runtime.reset();
    // The main chat's schedules end with its conversation (056-agent-schedules).
    this.agentSchedules?.endOwner({ kind: 'main' }, 'the chat was reset');
    this.workNoteSeen = null;
    await this.refreshing?.catch(() => {});
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    await this.delivery.syncEvidence();
    this.ledger.sync(await this.runtime.state());
    this.ledger.resetEstimate();
    await this.refresh();
    return result;
  }

  /** Work agents are Pi jobs of this process, so they stop with it, and their items carry on from their branches on the next start. */
  close() {
    if (!this.closing) {
      if (this.openedAt) recordEvent(this.runtime.directory, 'app_closed', { ms: this.now() - this.openedAt });
      this.closing = (async () => {
        clearTimeout(this.refreshTimer);
        clearTimeout(this.pulseTimer);
        this.shortReports?.close();
        this.piDirections?.close();
        this.moods?.stop();
        this.deletionWatcher?.close();
        this.tellWatcher?.close();
        this.teamsAgents?.close();
        try {
          // The dashboard has just cancelled any open question, and a quit must not reach the agent as an answer.
          const children = this.runtime.ownedLifecycle?.close();
          // A scheduled command running now stops too, and the next start counts its run as cut off.
          await Promise.all([children, this.runtime.quitMain(), this.runner?.stop(), this.memoryIndex?.stop(), this.agentSchedules?.close()]);
          // A durable hobkin's turn stopped here reads as cut off, so its record is written before the store closes.
          await this.hobkins?.idle();
          // No turn runs now, so the processes kept for the hobkins' next turns close too.
          await this.hobkins?.closeKept();
          await this.delivery?.close();
          await this.runtime.idle();
          this.pastedImages?.clear();
          await this.refreshing;
          if (this.runner) await this.refresh();
        } finally {
          await this.runtime.close();
        }
      })();
    }
    return this.closing;
  }
}
