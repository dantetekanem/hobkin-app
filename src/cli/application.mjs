import { watch } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { HobkinRuntime, MAIN_BUSY, MAX_MESSAGE_BYTES } from './runtime.mjs';
import { HobkinRunner } from './runner.mjs';
import { JobActivity } from './job-activity.mjs';
import { CompatibilityDelivery } from './compatibility.mjs';
import { namingExtensions, runHarness as defaultRunHarness } from './harnesses.mjs';
import { UsageLedger } from './usage.mjs';
import { Telemetry } from './telemetry.mjs';
import { recordEvent } from './events.mjs';
import { memoryBytes } from './memory.mjs';
import { callName, readProfile } from './profile.mjs';
import { MemoryIndex } from './memory-index.mjs';
import { CHROME_NOTE } from './chrome.mjs';
import { compactionDue, nextRunIn } from './compaction.mjs';
import { editReport } from './report-editor.mjs';
import { moveRoutinesFolder } from './schedules.mjs';
import { holdBrief, isHoldBrief, nextHoldTurn } from './holds.mjs';
import { markHeard, markPosted, markWoken, sessionNotice, sessionReports, sessionsToPost, sessionsToTell, sessionsToWake } from './session-log.mjs';
import { failureKey, handOffBrief, isQuietScheduledRun, isWakeBrief, scheduledBrief, scheduledFailure, sessionsBrief } from './wake.mjs';
import { templateNews, templateNotice } from './routine-templates.mjs';
import { cardActionNotice, cardActionsToPost, cardActionsToTell, markCardActionsHeard, markCardActionsPosted, recordCardAction } from './work/card-actions.mjs';
import { askReminders, handAnswer, inboxNews, inboxNotice, inboxToPost, inboxToTell, markInboxHeard, markInboxPosted, remindTomorrow } from './inbox.mjs';
import { finishedLine, foldFinishedLines, withoutWorkNote, workNote } from './work/chat.mjs';
import { WorkDirector } from './work/director.mjs';
import { insideHerdr, WorkPanes } from './work/panes.mjs';
import { workStatus } from './work/commands.mjs';
import { answerOffer, askAgent, declineItem, markDone, mergeItem, mergePullRequest, openDiff, openPullRequest, requestReview } from './work/controls.mjs';
import { answerPickUp, filePickUp, retirePickUp } from './work/pick-up.mjs';
import { mergeRefreshed, refreshThenMerge } from './work/refresh.mjs';
import { answerSubscriptionPause } from './work/subscription.mjs';
import { prView } from './work/reads.mjs';
import { LandOffers, notSurveyed, offerDecisions, retireOffers } from './work/land-offer.mjs';
import { answerPair, fileFirstPair } from './work/pairs.mjs';
import { noteForCheck, stalled } from './checks.mjs';
import { answerDecision, fileDecision, findDecision, lastCard, markShown, openDecisions, QUESTION_WAIT_MS } from './decisions.mjs';
import { canShowCard, cardChoices, cardDue, cardEvidence, cardQuestion } from './pending.mjs';
import { readPending, readWaiting } from './pending-read.mjs';
import {
  answerAllowance, chooseProject, dropProject, pickNext, putBackInQueue, readMode, retryItem, setProjectPrMode, setProjectPriority, skipInQueue, skipProject, startWork, updateItem, writeMode,
} from './work/store.mjs';
import { readingUsage } from './work/usage.mjs';
import { atomicJson, learningEnabled, loadConfig, setLearning } from './config.mjs';
import { runLearningCommand } from './learning/commands.mjs';
import { Learner, proposalMessage } from './learning/learner.mjs';
import { learningState } from './learning/store.mjs';
import { withoutLearningNote } from './learning/note.mjs';
import { Moods, searchingTool } from './mood.mjs';
import { readLocalView } from './view.mjs';
import { PastedImages } from './paste-image.mjs';
import { deletedReportIds, isQuietRun, readReport, referToReport, reportText, reportTriage, runOutcomeText, splitReportReference } from './reports.mjs';
export { readLocalView } from './view.mjs';

const textOf = message => (typeof message.content === 'string' ? message.content
  : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n'));
const SIGN_IN_TROUBLE = /\b40[13]\b|unauthori[sz]ed|authentication|api key|credential|log ?in\b/i;
/** A refused turn has no text of its own, so without this the chat just goes quiet. */
const turnFailure = ({ stopReason, errorMessage }) => {
  if (stopReason !== 'error' || !errorMessage) return '';

  const reason = errorMessage.match(/"message":"([^"]+)"/)?.[1] ?? errorMessage.split('\n', 1)[0];
  const fix = SIGN_IN_TROUBLE.test(errorMessage) ? ' Run `hobkin login` in a terminal, then reopen hobkin.' : '';
  return `The model did not answer: ${reason.slice(0, 300)}${fix}`;
};
const imagesIn = message => (Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image').length;
// Every refresh hashes the whole chat, and an image would be most of what it hashes.
const withoutImageData = (_, value) => (value?.type === 'image' ? { ...value, data: '' } : value);
const chatMessage = (message, index, shown) => {
  const { text, about } = splitReportReference(withoutLearningNote(withoutWorkNote(textOf(message))));
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
const isVisibleScheduledReport = run => run.kind === 'background'
  && typeof run.scheduleId === 'string' && run.scheduleId.length > 0
  && run.status !== 'running' && (run.status !== 'no_change' || run.trigger === 'manual');
const pauseNote = ({ nextRun, timezone }) => {
  const resumes = new Date(nextRun.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: timezone });
  return ` Paused until ${resumes}; running it manually or editing the routine resumes it sooner.`;
};
const messageTime = message => {
  const value = message.at ?? message.timestamp;
  const time = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(time) ? time : null;
};
const DISCOVERY_POST = 'notice:work-discovery:';
const isOwnPost = message => message.role === 'notice' || message.id?.startsWith('notice:');

const BUSY_RETRY_MS = 100;
// The keys of the Done walk, which only the user presses.
const WALK_EVENTS = { diff: 'done_diff', merge: 'done_merged', decline: 'done_declined', ask: 'done_sent_back' };
// A tick comes every second, and what is waiting rarely changes that fast.
const PENDING_LOOK_MS = 30000;

export class HobkinApplication {
  jobActivity = new Map();
  activeJobIds = new Set();
  outgoing = Promise.resolve();
  sending = 0;
  // Holds this process has nothing more to do for: one try each, and the next start picks up a turn that was cut off.
  handledHolds = new Set();
  // Scheduled failures already told, and when this process opened. The scheduler stamps its messages by the wall clock, so this does too.
  failuresTold = new Set();
  openedAt = Date.now();
  pendingLookedAt = -Infinity;

  observeActivity(id, event) {
    try {
      if (!this.jobActivity.has(id)) {
        this.jobActivity.set(id, new JobActivity());
      }
      this.jobActivity.get(id).accept(event);
      this.requestRefresh();
    } catch {
      /* Preview observers cannot fail a job. */
    }
  }

  static async open(root, { createMain, askQuestion, askPending, showDone, showRow, presence, runHarness, sessionDependencies, shell, now, intervalMs, signal, onChange = null, memoryIndex = null, clipboard } = {}) {
    signal?.throwIfAborted();
    const app = new HobkinApplication();
    app.onChange = onChange;
    app.now = () => new Date(now?.() ?? Date.now()).getTime();
    app.config = loadConfig(root);
    // Every job starts its Pi through the configured launcher, which owns Pi's extensions; without one Hobkin names them.
    const { launcher } = app.config;
    if (launcher) {
      const run = runHarness ?? defaultRunHarness;
      runHarness = (request, options) => run({ ...request, launcher }, options);
    }
    runHarness ??= namingExtensions(readingUsage(defaultRunHarness));
    app.snapshot = readLocalView(root);
    app.moods = new Moods({
      now: () => new Date(app.now()).getTime(),
      onChange: () => app.requestRefresh(),
    });
    app.runtime = await HobkinRuntime.open(root, app.config, {
      createMain,
      askQuestion,
      triggerSchedule: (...args) => app.runner.trigger(...args),
      messageCheck: request => app.runner.messageCheck(request),
      editReport: (result, job) => editReport(result, { ...job, binding: app.config.background, runHarness }),
      onChange: () => app.requestRefresh(),
    });
    try {
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
      app.ledger = UsageLedger.open(app.runtime.directory, app.config.initializedAt);
      app.telemetry = Telemetry.open(app.runtime.directory, app.now());
      app.learner = new Learner({ root: app.runtime.directory, telemetry: app.telemetry, now: app.now });
      app.runner = new HobkinRunner({
        runtime: app.runtime,
        root: app.runtime.directory,
        config: app.config,
        runHarness,
        now,
        compatibility: app.delivery.adapter,
        onActivity: (id, event) => app.observeActivity(id, event),
        onTick: async () => {
          await app.tickWork();
          await app.tickRefreshed();
          await app.tickHolds();
          app.tickWakes();
          app.tickCompaction();
          retireOffers(app.runtime.directory, app.now());
          retirePickUp(app.runtime.directory, app.now());
          app.tickInbox();
          app.landOffers.next();
          // Not awaited: each holds a question on screen for as long as it stays there. The card goes first, because it stands for the whole pile.
          app.presentPending();
          app.presentDecision();
        },
      });
      Object.assign(app, { askQuestion, askPending, showDone, showRow, presence });
      app.landOffers = new LandOffers({
        file: decision => fileDecision(app.runtime.directory, decision, app.now()),
        offers: () => offerDecisions(app.runtime.directory, app.now()),
        unread: draft => notSurveyed(app.runtime.directory, draft),
        now: app.now,
      });
      app.director = new WorkDirector({
        root: app.runtime.directory,
        config: app.config,
        runtime: app.runtime,
        runner: app.runner,
        ...(runHarness ? { runHarness } : {}),
        panes: insideHerdr() ? new WorkPanes() : null,
        now: app.now,
        onChange: () => app.requestRefresh(),
        onDraftDone: draft => app.landOffers.add(draft),
      });
      signal?.throwIfAborted();
      // A crash leaves what its runs had opened, and no run is left to take it away.
      app.director.panes?.closeLeftovers();
      app.runner.start({ intervalMs });
      // `hobkin reports delete` runs in another process and changes no runtime state.
      app.deletionWatcher = watch(join(app.runtime.directory, 'runtime'), (event, name) => {
        if (name?.startsWith('deleted-reports.json')) app.requestRefresh();
      });
      app.deletionWatcher.unref();
      // Only `main` asks for this, so nothing else that opens an application can start a real qmd.
      if (memoryIndex) {
        app.memoryIndex = new MemoryIndex({ ...memoryIndex, root: app.runtime.directory, onNote: () => app.requestRefresh() });
        app.memoryIndex.start();
      }
      await app.refresh();
      app.openedAt = app.now();
      recordEvent(app.runtime.directory, 'app_opened');
      return app;
    } catch (error) {
      await app.close();
      throw error;
    }
  }

  requestRefresh() {
    if (this.closing || !this.runner) return;
    this.refreshDirty = true;
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh().catch(error => {
        this.snapshot = { ...this.snapshot, error: error.message };
        recordEvent(this.runtime.directory, 'error_shown', { from: 'refresh' });
        this.onChange?.(this.snapshot);
      });
    }, 25);
    this.refreshTimer.unref();
  }

  refresh() {
    if (!this.refreshing) {
      this.refreshDirty = false;
      this.refreshing = this.project().finally(() => {
        this.refreshing = null;
        if (this.refreshDirty) this.requestRefresh();
      });
    }
    return this.refreshing;
  }

  async project() {
    await this.delivery.syncEvidence();
    const state = await this.runtime.state();
    const loaded = await this.runner.snapshot();
    const runs = Object.values(state.runs).sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    const deleted = deletedReportIds(this.runtime.directory);
    const sessionsEnded = sessionsToPost(this.runtime.directory);
    const cardActions = cardActionsToPost(this.runtime.directory);
    const handedOver = inboxToPost(this.runtime.directory, this.now());
    const runReports = runs
      .filter(run => run.kind !== 'main' && run.status !== 'running' && (run.status !== 'no_change' || run.trigger === 'manual'))
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
    const reports = [...runReports, ...sessionReports(this.runtime.directory, deleted)].toSorted((left, right) => (right.at ?? '').localeCompare(left.at ?? ''));
    const notices = (this.snapshot.messages ?? []).filter(isOwnPost);
    // What was in Chat when this process opened is not news. One that scrolled away is worked out again on each refresh, so a count needs a memory of its own.
    this.noticesCounted ??= new Set(notices.map(({ id }) => id));
    const noticeIds = new Set(notices.map(message => message.id));
    const noticedRunIds = new Set(this.noticeRunIds);
    const work = this.workView();
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
    for (const { key, line, at } of work.harnessLines) {
      const id = `notice:${key}`;
      if (noticeIds.has(id)) continue;
      notices.push({ id, role: 'notice', content: line, tone: 'quiet', at });
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
    if (this.answerTrouble) notices.push(this.answerTrouble);
    this.answerTrouble = null;
    const handedLines = handedOver.map(entry => inboxNotice(entry, this.now()));
    for (const notice of [...sessionsEnded.map(sessionNotice), ...cardActions.map(cardActionNotice), ...handedLines]) {
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
      ...this.runtime.messages()
        .filter(message => ['user', 'assistant', 'custom'].includes(message.role) && message.customType !== CHROME_NOTE)
        // `display: false` is how an extension says a note is for the agent and not for the user.
        .filter(message => message.display !== false)
        .filter(message => !isHoldBrief(textOf(message)) && !isWakeBrief(textOf(message)))
        .filter(message => !isQuietScheduledRun(message))
        .slice(-100)
        .map(chatMessage),
      ...notices,
    ].map((message, index) => ({ message, index, time: messageTime(message) }))
      .sort((left, right) => {
        if (left.time === null) return right.time === null ? left.index - right.index : -1;
        if (right.time === null) return 1;
        return left.time - right.time || left.index - right.index;
      })
      .map(({ message }) => message)).slice(-100);
    const visible = {
      version: 1,
      savedAt: new Date().toISOString(),
      reports: [...reports, ...this.snapshot.history.reports.filter(report => !deleted.has(report.id))].slice(0, 200),
      messages,
      context: this.runtime.contextInfo(),
      runs: [
        ...loaded.errors.map(error => ({ title: `${error.path}: ${error.message}`, state: 'invalid' })),
        ...runs.filter((run, index) => run.status === 'running' || index < 100).map(run => ({
          id: run.id,
          title: run.title ?? run.id,
          state: run.status,
          kind: run.kind,
          scheduleId: run.scheduleId,
          harness: run.harness,
          model: run.model,
          effort: run.effort,
          harnessId: run.harnessId,
          cwd: run.cwd ?? (run.kind === 'main' ? this.config.main.cwd : undefined),
          startedAt: run.startedAt,
          work: run.work,
          stalled: stalled(run),
          stopReason: run.result?.stopReason,
        })),
      ],
      lastTick: loaded.lastTick,
      error: this.runtime.mainFault
        ? `Main chat stopped: ${this.runtime.mainFault.message} Restart hobkin to reconnect; scheduled checks keep running.`
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
    const active = new Set(runs
      .filter(run => run.kind === 'background' && run.scheduleId && run.status === 'running')
      .map(run => run.id));
    const completedJobReports = {};
    for (const id of this.activeJobIds) {
      const run = state.runs[id];
      if (!run || run.status === 'running') continue;
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
    for (const id of this.jobActivity.keys()) {
      if (!active.has(id)) this.jobActivity.delete(id);
    }
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
      jobActivity: Object.fromEntries(
        [...this.jobActivity].map(([id, feed]) => [id, feed.snapshot()]),
      ),
      completedJobReports,
      counts: loaded.counts,
      schedules: loaded.schedules,
      usage: this.ledger.sync(state),
      memoryBytes: memoryBytes(this.runtime.directory),
      reportAttention: this.telemetry.attention(runs, this.now()),
      work,
      decisions: openDecisions(this.runtime.directory),
      waiting: this.waitingNow(visible.reports),
      connection: 'connected',
      busy: this.runtime.mainBusy,
      searching: searchingTool(this.runtime.mainTool),
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

  notePause(kind) {
    const was = this.pauseKind ?? null;
    this.pauseKind = kind;
    if (kind === was) return;
    if (was) recordEvent(this.runtime.directory, 'work_resumed', { pause: was });
    if (kind) recordEvent(this.runtime.directory, 'work_paused', { pause: kind });
  }

  // Messages go out in the order they were typed, and one the conversation cannot take yet waits here.
  send(text, report, images = []) {
    this.sending++;
    const sent = this.outgoing.then(() => this.deliver(text, report, images)).finally(() => { this.sending--; });
    this.outgoing = sent.catch(() => {});
    return sent;
  }

  async deliver(text, report, images = []) {
    const message = report ? referToReport(this.runtime.directory, report, text) : text;
    const sessions = sessionsToTell(this.runtime.directory);
    const userDid = cardActionsToTell(this.runtime.directory);
    const handedOver = inboxToTell(this.runtime.directory, this.now());
    const note = workNote({ ...workStatus(this.runtime.directory, this.director.outlook()), sessions, userDid, handed: inboxNews(handedOver) }, this.director.answerCommands());
    const opening = note === this.workNoteSeen ? '' : note;
    const learned = this.learner.note(this.runtime.messages());
    // A message with no room for the note still goes, and the note goes with the next one.
    const fits = Buffer.byteLength(`${opening}${learned}${message}`) <= MAX_MESSAGE_BYTES;
    const accepted = await this.sendWhenFree(`${opening}${fits ? learned : ''}${message}`, images);
    this.pastedImages.remove(images);
    this.workNoteSeen = note;
    markHeard(this.runtime.directory, sessions);
    markCardActionsHeard(this.runtime.directory, userDid);
    markInboxHeard(this.runtime.directory, handedOver);
    if (report) {
      this.telemetry.recordReportDiscussed(report.id, this.now());
      recordEvent(this.runtime.directory, 'report_messaged', { id: report.id });
      this.learner.noteReply(report.id, text);
    }
    this.requestRefresh();
    return accepted;
  }

  async sendWhenFree(message, attachments) {
    const images = attachments.length ? this.pastedImages.contents(attachments) : undefined;
    for (;;) {
      try {
        return await this.runtime.send(message, undefined, images);
      } catch (error) {
        if (error.message !== MAIN_BUSY) throw error;
        await wait(BUSY_RETRY_MS);
      }
    }
  }

  pasteImage() { return this.pastedImages.paste(this.runtime.imageRefusal); }
  dropImages(images) { this.pastedImages.remove(images); }

  kill(runId) { return this.runner.kill(runId); }

  workView() {
    const discovering = this.director.running().some(run => run.lane === 'discover');
    return { ...workStatus(this.runtime.directory, this.director.outlook()), discovering };
  }

  // Agents file work from their own processes, and nothing else tells the dashboard it changed.
  async tickWork() {
    this.moods.notice();
    await this.director.tick();
    await this.learn();
    const root = this.runtime.directory;
    const signature = JSON.stringify({ work: workStatus(root, this.director.outlook()), decisions: openDecisions(root), learning: learningEnabled(root) });
    if (signature === this.workSignature) return;
    this.workSignature = signature;
    this.requestRefresh();
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
    if (due && this.canStartHoldTurn()) return this.runtime.compactMain();
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
    if (!this.canStartHoldTurn()) return;
    if (this.handOffs?.length) {
      void this.runtime.send(handOffBrief(this.handOffs.splice(0))).catch(() => {});
      return;
    }
    const root = this.runtime.directory;
    const sessions = sessionsToWake(root);
    if (sessions.length) {
      markWoken(root, sessions);
      markHeard(root, sessions);
      void this.runtime.send(sessionsBrief(sessions)).catch(() => {});
      return;
    }
    const failures = this.untoldFailures();
    if (!failures.length) return;
    for (const failure of failures) this.failuresTold.add(failureKey(failure));
    void this.runtime.send(scheduledBrief(failures)).catch(() => {});
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
      grade: () => updateItem(root, slug, value, { grade: extra }),
      skip: () => skipProject(root, slug),
      drop: () => dropProject(root, slug),
      done: () => markDone(root, slug, value),
      run: () => pickNext(root, slug),
      later: () => skipInQueue(root, slug),
      back: () => putBackInQueue(root, slug),
      retry: () => retryItem(root, slug, value),
      diff: () => openDiff(root, slug, value),
      review: () => requestReview(root, slug, value),
      merge: () => mergeItem(root, slug, value, { ...extra, route: 'key' }),
      decline: () => declineItem(root, slug, value),
      ask: () => askAgent(root, slug, value, extra),
      pr: () => prView(root, slug, value),
      decide: () => this.decide(slug, value),
      learning: () => this.answerLearning(slug, value),
      mergePr: () => mergePullRequest(root, slug, value, extra),
      refreshMerge: () => refreshThenMerge(root, slug, value, { ...extra, now: this.now() }),
      open: () => openPullRequest(root, slug, value),
    };
    const result = await actions[action]();
    if (WALK_EVENTS[action]) recordEvent(root, WALK_EVENTS[action], { project: slug, item: value });
    if (result?.told) recordCardAction(root, result.told, this.now());
    if (result?.handOff) this.handOff(result.handOff);
    await this.director.tick();
    // A refresh already under way read the state before this change, and the screen must show the change.
    await this.refreshing?.catch(() => {});
    await this.refresh();
    return result;
  }

  /** The asker hears first, so an answer that cannot reach it stays open for another try. A merge that fails is the same: it throws, and the reason goes on screen. */
  async decide(id, value) {
    const root = this.runtime.directory;
    const { decision: { question, answerTo, at, from }, choice } = findDecision(root, id, value);
    const said = `The user was asked: ${question} They answered: ${choice.label}`;
    if (answerTo?.kind === 'work') askAgent(root, answerTo.slug, answerTo.item, said, { answering: true });
    if (answerTo?.kind === 'routine') noteForCheck(root, answerTo.id, said);
    if (answerTo?.kind === 'outside') handAnswer(root, { from, question, answer: choice.label }, this.now());
    const snoozed = answerTo?.kind === 'reminder' && value === 'tomorrow' ? remindTomorrow(root, answerTo.id, this.now()) : null;
    if (answerTo?.kind === 'land' && value === 'walk') this.showDone?.();
    if (answerTo?.kind === 'pending') this.tackle(id, choice, answerTo);
    const offered = answerTo?.kind === 'merge' ? await answerOffer(root, answerTo, value, this.now()) : null;
    if (value === 'read' && ['merge', 'read'].includes(answerTo?.kind)) this.showDone?.(answerTo);
    if (answerTo?.kind === 'pair' && value === 'read') this.showDone?.();
    const moved = answerTo?.kind === 'pair' ? await answerPair(root, value, answerTo.rows, this.now()) : null;
    const picked = answerTo?.kind === 'pickup' ? answerPickUp(root, value, answerTo.keys) : null;
    const chose = answerTo?.kind === 'subscription' ? answerSubscriptionPause(root, value, answerTo.until, this.now()) : null;
    answerDecision(root, id, value, this.now());
    recordEvent(root, 'decision_answered', { id, source: answerTo?.kind, ms: this.now() - Date.parse(at) });
    return offered ?? moved ?? picked ?? chose ?? snoozed ?? { ok: true, message: `Answered: ${choice.label}.` };
  }

  /** A question from a routine or work mode gets 30 seconds on screen, and after that it waits in Decisions. Only a choice answers it. */
  async presentDecision() {
    const root = this.runtime.directory;
    const next = openDecisions(root).find(({ shown }) => !shown);
    if (this.presenting || !next) return;

    const overdue = this.now() - Date.parse(next.at) >= QUESTION_WAIT_MS;
    this.presenting = true;
    try {
      const { question, choices, id } = next;
      const answer = this.runtime.mainTurn ? undefined : await this.askQuestion?.({ question, choices, whenQuiet: true, waitMs: QUESTION_WAIT_MS });
      if (answer) await this.workAction('decide', id, answer);
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

  /** The card to bring up now, if any. Nothing is read until the user is there and the screen is free. */
  dueCard() {
    const now = this.now();
    const presence = this.presence?.();
    if (!presence || now - this.pendingLookedAt < PENDING_LOOK_MS) return null;
    if (!canShowCard({ presence, busy: Boolean(this.sending || this.runtime.mainTurn), now })) return null;

    this.pendingLookedAt = now;
    const root = this.runtime.directory;
    const card = readPending(root, { now, reports: this.snapshot.reports });
    return cardDue({ ...card, last: lastCard(root), now }) ? card : null;
  }

  /** The card only ever asks. Nothing waits for it and nothing stops for it, so any trouble here costs one card and no more. */
  async presentPending() {
    if (this.presenting) return;
    try {
      const card = this.dueCard();
      if (!card) return;
      this.presenting = true;
      await this.askAboutCard(card);
    } catch {
      // The next look works it all out again.
    } finally {
      this.presenting = false;
    }
  }

  /** A card that opened goes on record however it ended, and that record is what keeps it quiet. It never waits in Decisions, because a call about calls helps nobody. */
  async askAboutCard(card) {
    const root = this.runtime.directory;
    const shownAt = this.now();
    const [question, choices] = [cardQuestion(card), cardChoices(card)];
    const answer = await this.askPending({ question, choices, groups: card.groups, other: true, whenQuiet: true, waitMs: QUESTION_WAIT_MS });
    if (answer === undefined) return;

    const { total, trouble, walk } = card;
    const answerTo = { kind: 'pending', total, trouble, walk, evidence: cardEvidence(card) };
    const { id } = fileDecision(root, { from: 'hobkin', question, choices, answerTo }, shownAt);
    if (answer?.typed) {
      answerDecision(root, id, 'typed', this.now());
      await this.askMain(id, answer.typed, answerTo);
    } else if (answer) await this.workAction('decide', id, answer);
    else answerDecision(root, id, 'dismissed', this.now());
  }

  /** Decisions lists everything the card counts, with work mode on or off. A launch in trouble lives on the Work tab, which work mode hides, so with it off the main agent takes that one. */
  tackle(id, { value, label }, answerTo) {
    if (value === 'later' || (value === 'ready' && this.landOffers.offerReady())) return;

    const { trouble, walk } = answerTo;
    const target = value === 'wrong' ? trouble[0] : { tab: value === 'ready' ? 'decisions' : walk };
    const hidden = target.tab === 'work' && !readMode(this.runtime.directory).enabled;
    if (target.tab === 'chat' || hidden) void this.askMain(id, label, answerTo).catch(() => {});
    else this.showRow?.(target);
  }

  /** What an update brought in routine templates, as one line in Chat. Trouble reading them costs the line and nothing else. */
  templateLine() {
    try {
      const content = templateNotice(templateNews(this.runtime.directory));
      const at = new Date(this.now()).toISOString();
      return content && { id: `notice:templates:${at}`, role: 'notice', content, tone: 'useful', at };
    } catch {
      return null;
    }
  }

  /** Every row the card counts, for the Decisions tab. A problem reading them costs this refresh its rows and nothing else. */
  waitingNow(reports) {
    try {
      return readWaiting(this.runtime.directory, { now: this.now(), reports });
    } catch {
      return this.snapshot.waiting ?? null;
    }
  }

  /** The answer is the user's word, so it is recorded here and leaves Decisions at once. A yes also asks the main agent for the plan, as saying yes in Chat does, without holding the screen while it is busy. */
  answerLearning(id, value) {
    const root = this.runtime.directory;
    const proposal = learningState(root).proposals.find(entry => entry.id === id);
    if (!proposal) throw Error('That proposal was already answered.');
    runLearningCommand(root, ['answer', id, value]);
    if (value === 'no') return { ok: true, message: 'It will not come up again.' };

    this.showRow?.({ tab: 'chat' });
    const about = { id: `learning:${id}`, title: 'Learning proposal', at: proposal.at, body: `${proposalMessage(proposal)}\nProposal ID: ${id}` };
    void this.send('Yes, plan it.', about).catch(() => {});
    return { ok: true, message: 'The main agent writes the plan, and asks before changing anything.' };
  }

  askMain(id, text, { evidence }) {
    this.showRow?.({ tab: 'chat' });
    return this.send(text, { id: `pending:${id}`, title: 'Pending card', at: new Date(this.now()).toISOString(), body: evidence });
  }

  recordReportRead(read) {
    this.telemetry.recordReportRead(read, this.now());
    recordEvent(this.runtime.directory, 'report_read', { id: read.id, ms: read.dwellMs });
    this.requestRefresh();
  }

  async reset() {
    const result = await this.runtime.reset();
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

  /** Agents in panes can outlive hobkin, so these are what a quit has to ask about. */
  agentsAtWork() {
    return this.director?.agentsInPanes().length ?? 0;
  }

  close({ letFinish = false } = {}) {
    if (!this.closing) {
      if (this.openedAt) recordEvent(this.runtime.directory, 'app_closed', { ms: this.now() - this.openedAt });
      if (letFinish) this.director?.handOff();
      this.closing = (async () => {
        clearTimeout(this.refreshTimer);
        this.moods?.stop();
        this.deletionWatcher?.close();
        try {
          // The dashboard has just cancelled any open question, and a quit must not reach the agent as an answer.
          await Promise.all([this.runtime.main?.abort(), this.runner?.stop(), this.memoryIndex?.stop()]);
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
