import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { openCheck } from '../checks.mjs';
import { buildContext } from '../context.mjs';
import { runHarness as defaultRunHarness, workDirections } from '../harnesses.mjs';
import { readMemory } from '../memory.mjs';
import { reportTriage } from '../reports.mjs';
import { hourShareOf } from './budget.mjs';
import { discoveryMessage, hobkinCommand } from './chat.mjs';
import { surveyAndClose } from './closing.mjs';
import { nameOf } from './names.mjs';
import { agentName } from './panes.mjs';
import { ideasWanted, planWork } from './plan.mjs';
import { reviewDue, reviewMessage, reviewView } from './review.mjs';
import {
  answerCancel, chosenProjects, currentRequest, declinedToday, DISCOVERY_EVERY_MS, followUsage, foldersLeft, hasWorkToShow, landing, levels, nextDiscoveryAt, paths, pendingCancels,
  prFile, proposedProjects, readDiscovery, readItems, readMode, readProject, readProjects, readState, recordDiscovery, recordTokens, requestAllowance, retryItem, runnableStates,
  sessionError, sessionUsage, skipInQueue, slugOf, tokenLabel, updateItem, writeMode, writeOwnerView, writeState,
} from './store.mjs';
import { changesOnlyDocs, currentBranch, defaultBranch, enterFolder, folderRefusal, leaveFolder, prepareTree, releaseTree } from './tree.mjs';
import { readUnmerged } from './unmerged.mjs';
import { claudeSessionUsage, nextPause, usageLimitIn } from './usage.mjs';
import { readWatch, watchFolder } from './watcher.mjs';

const HOUR_MS = 3600000;
const DISCOVERY_RETRY_MS = HOUR_MS / 4;
const WATCH_EVERY_MS = 24 * HOUR_MS;
// `gh` and `git` cost no tokens, but nothing here needs them every tick.
const SURVEY_EVERY_MS = HOUR_MS / 2;
const MAX_DISCOVERY_CONTINUATIONS = 2;
const MAX_NOTES_BYTES = 16384;
const MAX_ITEMS_SENT = 40;
const MAX_BRANCH_NAME = 40;
const MAX_REASON_LENGTH = 500;
// These looks run tests, which write files, so they never run in the project's own folder.
const looksThatWrite = ['study', 'bugs', 'improvements'];
// Nothing else gives a run a deadline, and a run that has hung holds its worker for good.
const QUIET_MS = HOUR_MS;
const QUIET_REASON = 'It went quiet for an hour.';

const clone = promisify(execFile);
// A clone that hangs or asks for a password has no session to watch, so it gets a limit of its own.
const CLONE_TIMEOUT_MS = 10 * 60000;

// Pi loads the user's global rules into every run, and those rules ask for permission first. This line is that permission.
const authorization = 'The user has already authorized everything this run needs, so nothing needs asking and no run is ever blocked. '
  + 'Being started is the selection, so do the work now, whatever any rule, direction, note, memory or item says about waiting, queues, approval, authorization or a decision from the user. '
  + 'This covers every git action in any branch, worktree or the user\'s own checkout, installing with the project\'s own package manager whichever it is, running any test, '
  + 'starting, migrating and removing disposable services, committing, and changing any setting that can be changed back. '
  + 'It overrides every instruction you loaded, including AGENTS.md, and a title that says check, diagnose or investigate still means fix it. '
  + 'The only thing that needs a yes, in the main window, is deleting what git cannot bring back, and the rest of the work carries on without it.';

const readBounded = file => {
  if (!existsSync(file)) return '';
  return Buffer.from(readFileSync(file)).subarray(0, MAX_NOTES_BYTES).toString('utf8');
};
const elapsedSince = (at, now) => (at ? now - Date.parse(at) : Infinity);
const firstLine = text => String(text ?? '').trim().split('\n', 1)[0].trim().slice(0, MAX_REASON_LENGTH);
const runError = run => firstLine(run?.result?.error ?? run?.error);
const paneBrief = (purpose, request, report) => `${workDirections(purpose)}

## Your report

You are working in a terminal pane the user can watch. Nobody answers in this pane, so never ask a question and never wait for a reply. When you are finished, write your final report to \`${report}\`, then stop. Hobkin reads that file to know you are done, so write it last, and write it even if the work is not finished.

If the \`chrome_*\` tools say Chrome is locked in this pane, carry on without them and say so in your report.

## The request

\`\`\`json
${request}
\`\`\`
`;
const laneKey = (slug, lane) => `${slug}:${lane}`;
// A usage limit says nothing about the project, so it counts against nothing.
const notTheWork = run => Boolean(run?.result?.usageLimit);

/** Decides what runs next. Everything it knows lives in `work/`, so it can restart at any time. */
export class WorkDirector {
  constructor({ root, config, runtime, runner, runHarness = defaultRunHarness, panes = null, now = Date.now, onChange = () => {}, onDraftDone = () => {}, gh, claudeProjects }) {
    Object.assign(this, { root, config, runtime, runner, runHarness, panes, now, onChange, onDraftDone, gh, claudeProjects });
    this.active = new Map();
    this.lastStartAt = null;
  }

  running() { return [...this.active.values()]; }

  /** What only the owner can know, for the plan and for the tab. A check takes a place, because it shares the same subscription. */
  outlook() {
    return {
      running: this.running(),
      checks: [...this.runner.jobs.keys()].filter(id => !id.startsWith('work:')).length,
      lastStartAt: this.lastStartAt,
      panes: Boolean(this.panes),
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

  // A request is answered before the kill, so one that fails cannot stop every tick after it. This is `k` from another process, and a run that already ended has nothing to do.
  answerCancels() {
    for (const run of pendingCancels(this.root)) {
      answerCancel(this.root, run, this.now());
      this.killRun(run);
    }
  }

  // Turning work mode off starts nothing new. Project agents finish, but a look stops: it only reads, it carries on from its notes, and nothing shows what it spends once the tab is gone.
  async tick() {
    this.recoverDiscovery();
    this.tellNewProposals();
    // Agents keep working after the mode goes off, so these do too.
    this.meterRuns();
    this.answerCancels();
    await this.guardFolders();
    this.publish();
    // Work merges whether the mode is on or not, and finding that costs no tokens.
    this.surveyWork();

    const mode = readMode(this.root);
    this.reviewWeek(mode);
    if (!mode.enabled) {
      this.stopLook();
      return;
    }

    this.watchChanges(mode);

    const current = readMode(this.root);
    const { pause, budget, next } = planWork(this.root, { mode: current, now: this.now(), ...this.outlook() });
    if (['day', 'hour'].includes(pause?.kind)) this.holdDiscovery();
    this.tellPause(pause, current);
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

  /** One start per tick, and the plan keeps them spaced out, so each run shows what it costs before the next one begins. */
  begin(entry, { used, limit }, mode) {
    this.lastStartAt = this.now();
    if (entry.picked) writeMode(this.root, { queueNext: mode.queueNext.filter(key => key !== entry.key) });
    const tokens = { today: used, limit };
    const cost = { estimate: entry.estimate, kind: entry.lane === 'do' ? 'do' : entry.kind };
    if (entry.lane === 'discover') return this.startDiscovery(mode.folder, tokens, cost);
    const project = readProject(this.root, entry.slug);
    if (entry.lane === 'do') return this.startDo(project, entry.item, cost);
    return this.startLook(project, entry.focus, tokens, cost);
  }

  /**
   * Sessions are followed as they grow, so a long run counts while it runs. The final figure replaces this when it ends.
   * A session that stops growing is a run that has hung. One with no session to read, such as a Claude or Codex pane, says nothing either way.
   */
  meterRuns() {
    const now = this.now();
    for (const run of this.running()) {
      const { offset = 0, grewAt = null } = run.meter ?? {};
      const meter = followUsage(run.sessionFile, run.meter);
      run.meter = { ...meter, grewAt: meter.offset > offset ? now : grewAt };
      Object.assign(run, { tokens: meter.tokens, cached: meter.cached });
      if (run.stalled || run.meter.grewAt === null || now - run.meter.grewAt < QUIET_MS) continue;
      run.stalled = true;
      this.killRun(run.id);
    }
  }

  // A run works on its own branch in the user's folder. If the folder has left that branch, whatever it commits next lands somewhere else.
  // During a rebase there is no branch to read, and the run's own rebase is no reason to leave the folder in the middle of one.
  async guardFolders() {
    for (const run of this.running()) {
      const { folder } = run;
      if (!folder?.branch || run.moved) continue;
      const branch = await currentBranch(folder.repo);
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

  surveyWork() {
    if (this.surveying || elapsedSince(readUnmerged(this.root).at, this.now()) < SURVEY_EVERY_MS) return;
    if (!chosenProjects(this.root).length) return;
    this.surveying = surveyAndClose(this.root, { now: this.now(), ...(this.gh ? { gh: this.gh } : {}) })
      .catch(() => {})
      .finally(() => { this.surveying = null; });
  }

  // Once for each pause, in Chat. The tab keeps the live numbers, and a daily pause speaks through its question.
  tellPause(pause, mode) {
    if (!['hour', 'usage', 'reserve'].includes(pause?.kind)) return;
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

  /** `max` is bound to Claude, which only a pane can run. Without panes it takes the best the normal harness has, and it still counts as `max`. */
  settingsFor(level) {
    return levels[level].harness && !this.panes ? levels.critical : levels[level];
  }

  modelFor(level) {
    const { model, harness } = this.settingsFor(level);
    return harness ? model : this.config[model].model;
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
    };
  }

  describe(project) {
    const { slug, name, level, summary } = project;
    const { project: notes, directions } = paths(this.root, slug);
    const items = readItems(this.root, slug).slice(-MAX_ITEMS_SENT)
      .map(({ id, key, kind, title, state, pr }) => ({ id, key, kind, title, state, pr }));
    return {
      project: { slug, name, level, summary, checkout: project.path ?? paths(this.root, slug).clone },
      projectFile: notes,
      projectNotes: readBounded(notes),
      directions: readBounded(directions),
      items,
      commands: { item: this.command(`item ${slug}`), tree: this.command(`tree ${slug}`) },
      authorization,
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
    const sharing = this.running().some(run => run !== entry && run.slug === project.slug);
    const writing = branch ? 'this item rebases' : 'this look runs tests';
    let reason = writes ? writing : sharing ? 'another agent is in this repository' : null;
    if (!reason && resume && await currentBranch(tree) === branch) reason = 'its work is there';
    if (!reason) {
      const { refused, base } = await enterFolder({ repo, branch });
      if (!refused) return { cwd: repo, folder: { repo, branch, base } };
      reason = refused;
    }
    await prepareTree({ repo, tree, branch, resume });
    return { cwd: tree, tree, note: `Worktree: ${reason}` };
  }

  // An item still in the queue has no outcome yet, whoever put it there, and the next run carries on from what this one left.
  recordedOutcome(slug, id) {
    const state = readItems(this.root, slug).find(item => item.id === id)?.state;
    return Boolean(state) && !runnableStates.includes(state);
  }

  /** A run hands the folder back as it found it. If that cannot be done it stays as it is, and the tab says so. A tree lets go of its branch, so the user can check that out. */
  async leave(slug, id, { folder, tree }) {
    if (tree) await releaseTree(tree, { finished: this.recordedOutcome(slug, id) });
    if (!folder) return;
    const left = folder.branch ? await leaveFolder(folder) : await folderRefusal(folder.repo);
    const said = left && !folder.branch ? `After the look, ${left}.` : left;
    writeState(this.root, slug, { folderNote: said });
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
        authorization,
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

  startLook(project, focus, tokens, cost = {}) {
    const { slug, level } = project;
    const state = readState(this.root, slug);
    const now = new Date(this.now()).toISOString();
    const lens = { lastLookAt: now, lastLensAt: now, lensIndex: (state.lensIndex ?? 0) + 1, newCommits: 0 };
    const stamped = { study: { lastLookAt: now }, ideas: { lastIdeasAt: now } }[focus] ?? lens;
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
      model: this.modelFor(level),
      effort: this.settingsFor(level).lookEffort,
      instructions: `Look at ${project.name} with the focus ${focus}.`,
      prepare: entry => this.place(entry, { project, tree, writes: looksThatWrite.includes(focus) }),
      work: place => ({ lane: 'look', focus, tokens, place, ...ideas, ...this.describe(project) }),
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
    return { ...described, commands: { ...described.commands, decide } };
  }

  startDo(project, item, cost = {}) {
    const { slug } = project;
    const level = item.max ? 'max' : project.level;
    const branch = item.branch ?? `hobkin/${item.id}-${slugOf(item.title).slice(0, MAX_BRANCH_NAME)}`;
    const resume = Boolean(item.branch);
    updateItem(this.root, slug, item.id, { state: 'doing', branch }, this.now());

    const tree = paths(this.root, slug).doTree;
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
      model: this.modelFor(level),
      effort: this.settingsFor(level).doEffort,
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
  // A pane closed by hand, or a folder moved under a run, only ended that run: the item stays in the plan.
  // Cancelling one is the user's own stop, so it stays in sight at the end of the queue instead of starting again on the next tick.
  // Any other end means the run did not record an outcome, and one that went quiet is the same however it was stopped.
  // The item goes straight back in the queue, and the next run carries on from the branch with what this one said.
  // A grade is how the user tells what can ship, so a finished branch earns one by itself: the review is its next run, ahead of new work.
  async itemFinished(slug, item) {
    const { id, title, kind, state, branch, reviewAsked, workNote } = item;
    if (reviewAsked || workNote) updateItem(this.root, slug, id, { reviewAsked: false, workNote: null }, this.now());
    if (!['branch', 'pr'].includes(state) || kind === 'pr-fix') return;

    const project = readProject(this.root, slug);
    if (!reviewAsked && state === 'branch' && await this.earnsAReview(project, branch)) {
      updateItem(this.root, slug, id, { reviewAsked: true }, this.now());
      retryItem(this.root, slug, id, this.now());
      return;
    }
    this.onDraftDone({ slug, id, title, project: nameOf(project) });
  }

  // With the mode off nothing new starts, and that holds for a review too.
  async earnsAReview(project, branch) {
    const { enabled, reviewOnFinish } = readMode(this.root);
    if (!enabled || reviewOnFinish === false) return false;
    const repo = project.path ?? paths(this.root, project.slug).clone;
    return !await changesOnlyDocs(repo, await defaultBranch(repo), branch);
  }

  settleItem(slug, id, run, { moved = false, stalled = false } = {}) {
    const interrupted = run?.status === 'interrupted';
    if ((interrupted && this.runner.stopped) || notTheWork(run)) return;
    const item = readItems(this.root, slug).find(entry => entry.id === id);
    if (!item) return;
    if (item.state !== 'doing') return this.itemFinished(slug, item);
    if (moved) writeState(this.root, slug, { folderNote: 'The folder left the run\'s branch, so the run stopped. Nothing was forced.' });
    if (moved || run?.result?.paneClosed) {
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

  // Pi only reports that a run did not finish, so its own words come from the session. Only the first line of an error counts, because a pane's last lines can be about anything.
  // A `max` run bound to Claude has Claude's limit, which says nothing about the subscription everything else runs on, so it pauses only `max` work.
  noteUsageLimit(result, sessionFile, bound) {
    if (result.status !== 'failed') return result;
    const { usagePause, claudePause } = readMode(this.root);
    const limit = usageLimitIn(sessionError(sessionFile) ?? firstLine(result.error), this.now());
    if (!limit) return result;
    if (bound) writeMode(this.root, { claudePause: nextPause(claudePause, limit, this.now()) });
    else writeMode(this.root, { usagePause: nextPause(usagePause, limit, this.now()) });
    return { ...result, usageLimit: true };
  }

  clearUsagePause() {
    const { usagePause } = readMode(this.root);
    if (usagePause && Date.parse(usagePause.until) <= this.now()) writeMode(this.root, { usagePause: null });
  }

  async runInPane({ slug, lane, harnessId, purpose, prompt, cwd, model, effort, sessionFile, signal, paneKind, bound }) {
    const directory = join(paths(this.root, slug).directory, 'runs');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const brief = join(directory, `${harnessId}.md`);
    const report = join(directory, `${harnessId}.report.md`);
    writeFileSync(brief, paneBrief(purpose, prompt, report), { mode: 0o600 });
    const result = await this.panes.run({
      name: agentName(lane, slug),
      kind: paneKind,
      cwd,
      model,
      effort,
      sessionFile,
      brief,
      report,
      signal,
      ...(paneKind === 'claude' ? { claudeSession: harnessId, bound } : {}),
    });
    const { usd, sessionId } = sessionUsage(sessionFile);
    return usd ? { ...result, cost: { usd, kind: 'estimate', cumulative: true, sessionId } } : result;
  }

  start({ key, lane, slug, item, title, purpose, cwd, level, kind = lane, estimate = {}, model, effort, instructions, prepare, work, settle }) {
    const harnessId = randomUUID();
    const id = `work:${slug ?? 'discover'}:${lane}:${harnessId}`;
    const scheduleId = slug ? `work.${slug}.${lane}` : 'work.discover';
    const inPane = Boolean(slug && this.panes);
    const pane = inPane ? agentName(lane, slug) : null;
    const bound = inPane && Boolean(levels[level]?.harness);
    const paneKind = !inPane ? 'pi' : bound ? levels[level].harness : readMode(this.root).harness;
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
      work: { slug, lane, item, ...(pane ? { pane } : {}) },
    };
    const sessionFile = join(this.root, 'jobs', `${harnessId}.jsonl`);
    const startedAt = new Date(this.now()).toISOString();
    const entry = { id, slug, lane, item, title, level, effort, estimate, sessionFile, tokens: 0, cached: 0, harness: paneKind, pane, startedAt };
    const runIn = async (place, signal) => {
      const here = place.cwd;
      const schedule = { id: scheduleId, title, prompt: instructions, cwd: here, harness: 'pi', model, context: [] };
      const { runs } = await this.runtime.state();
      const previous = Object.values(runs)
        .filter(run => run.scheduleId === scheduleId && run.status !== 'running')
        .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];
      const prompt = await buildContext(schedule, previous, readMemory(this.root), openCheck(this.root, scheduleId), work(place.folder ? 'folder' : 'tree'));
      mkdirSync(join(this.root, 'jobs'), { recursive: true, mode: 0o700 });
      if (inPane) return this.runInPane({ slug, lane, harnessId, purpose, prompt, cwd: here, model, effort, sessionFile, signal, paneKind, bound });
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
      }, { onEvent: event => this.runner.onActivity(id, event) });
    };
    const effect = async signal => {
      const place = prepare ? await prepare(entry) : { cwd };
      Object.assign(entry, place);
      try {
        return this.noteUsageLimit(await runIn(place, signal), sessionFile, bound);
      } finally {
        // A folder that went away during the run must not hide how the run ended.
        await this.leave(slug, item, place).catch(() => {});
      }
    };
    this.active.set(key, entry);
    const { work: finished } = this.runner.startTracked(request, effect);
    const closed = finished.then(run => {
      this.active.delete(key);
      const { tokens, cached } = paneKind === 'claude' ? claudeSessionUsage(harnessId, this.claudeProjects) : sessionUsage(sessionFile);
      const facts = { slug, lane, kind, ...(level ? { level } : {}) };
      // Nothing can be read from a pane with no readable usage, so its run counts as what one like it costs, marked so nothing learns from it.
      // A run with no `cwd` never got as far as a place to work, so it spent nothing, however often it comes round.
      // It still leaves a mark, or its project stays left alone and takes every start. With no `level` it is no max run.
      const unseen = paneKind !== 'pi' && Boolean(entry.cwd);
      if (tokens) recordTokens(this.root, { ...facts, tokens, cached }, this.now());
      else if (unseen) recordTokens(this.root, { ...facts, tokens: estimate.fresh ?? 0, cached: estimate.cached ?? 0, estimated: true }, this.now());
      else recordTokens(this.root, { slug, lane, kind, tokens: 0, cached: 0, estimated: true }, this.now());
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
