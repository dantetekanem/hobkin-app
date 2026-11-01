import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { openCheck } from '../checks.mjs';
import { buildContext } from '../context.mjs';
import { runHarness as defaultRunHarness, workDirections } from '../harnesses.mjs';
import { readMemory } from '../memory.mjs';
import { reportTriage } from '../reports.mjs';
import { hourShareOf } from './budget.mjs';
import { discoveryMessage, hobkinCommand } from './chat.mjs';
import { agentName } from './panes.mjs';
import { ideasWanted, planWork } from './plan.mjs';
import {
  currentRequest, declinedToday, DISCOVERY_EVERY_MS, followUsage, foldersLeft, hasWorkToShow, landing, levels, nextDiscoveryAt, paths, proposedProjects,
  readDiscovery, readItems, readMode, readProject, readProjects, readState, recordDiscovery, recordTokens, requestAllowance, sessionError, sessionUsage, slugOf,
  tokenLabel, updateItem, writeMode, writeState,
} from './store.mjs';
import { currentBranch, enterFolder, folderRefusal, FolderRefused, leaveFolder, prepareTree } from './tree.mjs';
import { readUnmerged, surveyUnmerged, unmergedNow } from './unmerged.mjs';
import { claudeSessionUsage, nextPause, usageLimitIn } from './usage.mjs';
import { readWatch, watchFolder } from './watcher.mjs';

const HOUR_MS = 3600000;
const DISCOVERY_RETRY_MS = HOUR_MS / 4;
const FOLDER_RETRY_MS = HOUR_MS / 4;
const WATCH_EVERY_MS = 24 * HOUR_MS;
// `gh` and `git` cost no tokens, but nothing here needs them every tick.
const SURVEY_EVERY_MS = HOUR_MS / 2;
const MAX_ATTEMPTS = 2;
const MAX_DISCOVERY_CONTINUATIONS = 2;
const MAX_NOTES_BYTES = 16384;
const MAX_ITEMS_SENT = 40;
const MAX_BRANCH_NAME = 40;
const MAX_REASON_LENGTH = 500;
// These looks run tests, which write files, so they never run in the project's own folder.
const looksThatWrite = ['study', 'bugs', 'improvements'];

const clone = promisify(execFile);

// Pi loads the user's global rules into every run, and those ask for explicit permission for these actions.
const authorization = 'Turning on work mode and taking this project is the user\'s authorization to install dependencies in the '
  + 'tree, run the full test suite, commit to hobkin/* branches, push them and open pull requests.';

const readBounded = file => {
  if (!existsSync(file)) return '';
  return Buffer.from(readFileSync(file)).subarray(0, MAX_NOTES_BYTES).toString('utf8');
};
const elapsedSince = (at, now) => (at ? now - Date.parse(at) : Infinity);
const firstLine = text => String(text ?? '').trim().split('\n', 1)[0].trim().slice(0, MAX_REASON_LENGTH);
const runError = run => firstLine(run?.result?.error ?? run?.error);
const paneBrief = (purpose, request, report) => `${workDirections(purpose)}

## Your report

You are working in a terminal pane the user can watch. When you are finished, write your final report to \`${report}\`, then stop. Hobkin reads that file to know you are done, so write it last, and write it even if you are blocked.

If the \`chrome_*\` tools say Chrome is locked in this pane, carry on without them and say so in your report.

## The request

\`\`\`json
${request}
\`\`\`
`;
const laneKey = (slug, lane) => `${slug}:${lane}`;
// None of these says anything about the project, so they count against nothing.
const notTheWork = run => Boolean(run?.result?.usageLimit || run?.result?.refused);

/** Decides what runs next. Everything it knows lives in `work/`, so it can restart at any time. */
export class WorkDirector {
  constructor({ root, config, runtime, runner, runHarness = defaultRunHarness, panes = null, now = Date.now, onChange = () => {}, gh, claudeProjects }) {
    Object.assign(this, { root, config, runtime, runner, runHarness, panes, now, onChange, gh, claudeProjects });
    this.active = new Map();
    this.lastStartAt = null;
  }

  running() { return [...this.active.values()]; }

  /** What only the owner can know, for the plan and for the tab. A check takes a place, because it shares the same subscription. */
  outlook() {
    return {
      running: this.running(),
      chatBusy: Boolean(this.runtime.mainBusy),
      checks: [...this.runner.jobs.keys()].filter(id => !id.startsWith('work:')).length,
      lastStartAt: this.lastStartAt,
      panes: Boolean(this.panes),
    };
  }

  // Turning work mode off starts nothing new. Project agents finish, but a look stops: it only reads, it carries on from its notes, and nothing shows what it spends once the tab is gone.
  async tick() {
    this.recoverDiscovery();
    this.tellNewProposals();
    // Agents keep working after the mode goes off, so these do too.
    this.meterRuns();
    await this.guardFolders();
    const mode = readMode(this.root);
    if (!mode.enabled) {
      const look = this.active.get('discover');
      if (look) await this.runner.kill(look.id);
      return;
    }

    this.watchChanges(mode);
    this.surveyWork();

    const current = readMode(this.root);
    const { pause, budget, next } = planWork(this.root, { mode: current, now: this.now(), ...this.outlook() });
    if (['day', 'hour'].includes(pause?.kind)) this.holdDiscovery();
    this.tellPause(pause, current);
    if (pause?.kind === 'day') this.askForAllowance(current, budget);
    if (next) this.begin(next, budget, current);
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

  /** Sessions are followed as they grow, so a long run counts while it runs. The final figure replaces this when it ends. */
  meterRuns() {
    for (const run of this.running()) {
      run.meter = followUsage(run.sessionFile, run.meter);
      Object.assign(run, { tokens: run.meter.tokens, cached: run.meter.cached });
    }
  }

  // A run works on its own branch in the user's folder. If the folder has left that branch, whatever it commits next lands somewhere else.
  async guardFolders() {
    for (const run of this.running()) {
      const { folder } = run;
      if (!folder?.branch || run.moved || await currentBranch(folder.repo) === folder.branch) continue;
      run.moved = true;
      await this.runner.kill(run.id);
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
    this.surveying = surveyUnmerged(this.root, { now: this.now(), ...(this.gh ? { gh: this.gh } : {}) })
      .then(() => this.settleStop())
      .catch(() => {})
      .finally(() => { this.surveying = null; });
  }

  /** A stop follows the real state: a merge ends it, and so does the user closing enough of what is open. */
  settleStop() {
    const mode = readMode(this.root);
    const { stalled, stretch, since } = unmergedNow(this.root, mode);
    if (stalled === Boolean(mode.mergeStop)) return;
    const when = since ? `since ${since.slice(0, 10)}` : 'yet';
    const line = `Stopped: ${stretch} unmerged and none merged ${when}. What is running finishes, and nothing new starts until work moves.`;
    writeMode(this.root, { mergeStop: stalled ? { at: new Date(this.now()).toISOString(), stretch, line } : null });
    this.onChange();
  }

  // Once for each pause, in Chat. The tab keeps the live numbers, and a daily pause speaks through its question.
  tellPause(pause, mode) {
    if (!['hour', 'usage', 'reserve'].includes(pause?.kind)) return;
    const day = new Date(this.now()).toDateString();
    const id = pause.kind === 'usage' ? `usage:${mode.usagePause.at}` : `${pause.kind}:${day}`;
    if (mode.pauseNotice?.id === id) return;
    writeMode(this.root, { pauseNotice: { id, at: new Date(this.now()).toISOString(), line: pause.line, tone: pause.kind === 'hour' ? 'useful' : 'critical' } });
    this.onChange();
  }

  // Pausing is not stopping: running agents finish and items stay. The user just gets the choice, once, with what it would change.
  askForAllowance(mode, { used, limit }) {
    const asked = currentRequest(mode, this.now());
    if (asked?.limit === limit || declinedToday(mode, this.now())) return;

    const waiting = readProjects(this.root).filter(project => project.state === 'chosen')
      .flatMap(project => readItems(this.root, project.slug)
        .filter(item => ['open', 'doing'].includes(item.state) && item.kind !== 'attention')
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

  modelFor(level) {
    const { model, harness } = levels[level];
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
    if (!existsSync(repo) && project.remote) await clone('git', ['clone', '--quiet', project.remote, repo]);
    return repo;
  }

  /**
   * Where a run works, decided as it starts: the project's own folder when that is safe right now, and a worktree when it is not.
   * Only the worktree path resets anything, so the folder the user works in can be switched and never cleaned.
   */
  async place(entry, { project, tree, branch, resume, writes = false }) {
    const repo = await this.repositoryFor(project);
    const sharing = this.running().some(run => run !== entry && run.slug === project.slug);
    let reason = writes ? 'this look runs tests' : sharing ? 'another agent is in this repository' : null;
    if (!reason && resume && await currentBranch(tree) === branch) reason = 'its work is there';
    if (!reason) {
      const { refused, base } = await enterFolder({ repo, branch });
      if (!refused) return { cwd: repo, folder: { repo, branch, base } };
      reason = refused;
    }
    await prepareTree({ repo, tree, branch, resume });
    return { cwd: tree, note: `Worktree: ${reason}` };
  }

  /** A run hands the folder back as it found it. If that cannot be done it stays as it is, and the tab says so. */
  async leave(slug, { folder }) {
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

    const carriesOn = enabled && triage?.level !== 'blocked' && (discovery.continuation ?? 0) < MAX_DISCOVERY_CONTINUATIONS;
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

  /** Each proposal is told once, a repeated failure is not told again, and a quiet day with projects says nothing. */
  concludeDiscovery({ status, reason, folder, nextAt = nextDiscoveryAt(readMode(this.root)) }) {
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
      effort: levels[level].lookEffort,
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

  startDo(project, item, cost = {}) {
    const { slug } = project;
    const level = item.max ? 'max' : project.level;
    const branch = item.branch ?? `hobkin/${item.id}-${slugOf(item.title).slice(0, MAX_BRANCH_NAME)}`;
    const resume = Boolean(item.branch);
    updateItem(this.root, slug, item.id, { state: 'doing', branch }, this.now());

    const tree = paths(this.root, slug).doTree;
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
      effort: levels[level].doEffort,
      instructions: `Finish this item on ${project.name}: ${item.title}`,
      prepare: entry => this.place(entry, { project, tree, branch, resume }),
      work: place => ({
        lane: 'do',
        place,
        item: { ...item, branch },
        landing: landing(level, item.kind),
        ...this.describe(project),
      }),
      settle: (run, entry) => this.settleItem(slug, item.id, run, entry),
    });
  }

  // A run that ended without recording an outcome did not finish. Closing Hobkin keeps the item, so it resumes, and so does anything that was not the item's doing.
  // Cancelling one is the user saying stop, so it waits for them instead of starting again on the next tick.
  // A pane closed by hand, or a folder moved under a run, only ended that run: the item stays in the plan.
  settleItem(slug, id, run, { moved = false } = {}) {
    const interrupted = run?.status === 'interrupted';
    if ((interrupted && this.runner.stopped) || notTheWork(run)) return;
    const item = readItems(this.root, slug).find(entry => entry.id === id);
    if (item?.state !== 'doing') return;
    if (moved) writeState(this.root, slug, { folderNote: 'The folder left the run\'s branch, so the run stopped. Nothing was forced.' });
    if (moved || run?.result?.paneClosed) {
      updateItem(this.root, slug, id, { state: 'open' }, this.now());
      return;
    }
    const attempts = (item.attempts ?? 0) + 1;
    const stuck = interrupted || attempts >= MAX_ATTEMPTS;
    const stuckReason = interrupted ? 'Cancelled by hand.' : runError(run) || 'It ended twice without recording an outcome.';
    updateItem(this.root, slug, id, { state: stuck ? 'stuck' : 'open', attempts, ...(stuck ? { stuckReason } : {}) }, this.now());
  }

  // Pi only reports that a run did not finish, so its own words come from the session. Another harness has only its last lines.
  // A `max` run's limit is Claude's, and says nothing about the subscription everything else runs on, so it pauses only `max` work.
  noteUsageLimit(result, sessionFile, paneKind, level) {
    if (result.status !== 'failed') return result;
    const { usagePause, claudePause } = readMode(this.root);
    const said = sessionError(sessionFile) ?? (paneKind === 'pi' ? firstLine(result.error) : result.error);
    const limit = usageLimitIn(said, this.now());
    if (!limit) return result;
    if (level === 'max') writeMode(this.root, { claudePause: nextPause(claudePause, limit, this.now()) });
    else writeMode(this.root, { usagePause: nextPause(usagePause, limit, this.now()) });
    return { ...result, usageLimit: true };
  }

  clearUsagePause() {
    const { usagePause } = readMode(this.root);
    if (usagePause && Date.parse(usagePause.until) <= this.now()) writeMode(this.root, { usagePause: null });
  }

  // A folder that cannot be used costs nothing and says nothing about the work, so the project only waits a while and the tab says why.
  holdProject(slug, reason) {
    const heldUntil = new Date(this.now() + FOLDER_RETRY_MS).toISOString();
    writeState(this.root, slug, { heldUntil, heldReason: reason.split(/[,.:]/, 1)[0], folderNote: reason });
  }

  async runInPane({ slug, lane, harnessId, purpose, prompt, cwd, model, effort, sessionFile, signal, paneKind, bound, entry }) {
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
      onStatus: status => {
        const waiting = status === 'blocked';
        if (Boolean(entry.waitingForApproval) === waiting) return;
        entry.waitingForApproval = waiting;
        this.onChange();
      },
    });
    const { usd, sessionId } = sessionUsage(sessionFile);
    return usd ? { ...result, cost: { usd, kind: 'estimate', cumulative: true, sessionId } } : result;
  }

  start({ key, lane, slug, item, title, purpose, cwd, level, kind = lane, estimate = {}, model, effort, instructions, prepare, work, settle }) {
    const harnessId = randomUUID();
    const id = `work:${slug ?? 'discover'}:${lane}:${harnessId}`;
    const scheduleId = slug ? `work.${slug}.${lane}` : 'work.discover';
    const inPane = Boolean(slug && this.panes);
    const bound = Boolean(levels[level]?.harness);
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
      work: { slug, lane, item, ...(inPane ? { pane: agentName(lane, slug) } : {}) },
    };
    const sessionFile = join(this.root, 'jobs', `${harnessId}.jsonl`);
    const entry = { id, slug, lane, item, title, level, effort, estimate, sessionFile, tokens: 0, cached: 0 };
    const runIn = async (place, signal) => {
      const here = place.cwd;
      const schedule = { id: scheduleId, title, prompt: instructions, cwd: here, harness: 'pi', model, context: [] };
      const { runs } = await this.runtime.state();
      const previous = Object.values(runs)
        .filter(run => run.scheduleId === scheduleId && run.status !== 'running')
        .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];
      const prompt = await buildContext(schedule, previous, readMemory(this.root), openCheck(this.root, scheduleId), work(place.folder ? 'folder' : 'tree'));
      mkdirSync(join(this.root, 'jobs'), { recursive: true, mode: 0o700 });
      if (inPane) return this.runInPane({ slug, lane, harnessId, purpose, prompt, cwd: here, model, effort, sessionFile, signal, paneKind, bound, entry });
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
      let place = { cwd };
      try {
        if (prepare) place = await prepare(entry);
      } catch (error) {
        if (!(error instanceof FolderRefused)) throw error;
        this.holdProject(slug, error.message);
        return { status: 'failed', cost: null, noModel: true, refused: true, error: error.message };
      }
      Object.assign(entry, place);
      try {
        return this.noteUsageLimit(await runIn(place, signal), sessionFile, paneKind, level);
      } finally {
        // A folder that went away during the run must not hide how the run ended.
        await this.leave(slug, place).catch(() => {});
      }
    };
    this.active.set(key, entry);
    const { work: finished } = this.runner.startTracked(request, effect);
    finished.then(run => {
      this.active.delete(key);
      const { tokens, cached } = paneKind === 'claude' ? claudeSessionUsage(harnessId, this.claudeProjects) : sessionUsage(sessionFile);
      const facts = { slug, lane, kind, ...(level ? { level } : {}) };
      // Nothing can be read from a pane with no readable usage, so its run counts as what one like it costs, marked so nothing learns from it.
      const unseen = paneKind !== 'pi' && !run?.result?.refused;
      if (tokens) recordTokens(this.root, { ...facts, tokens, cached }, this.now());
      else if (unseen) recordTokens(this.root, { ...facts, tokens: estimate.fresh ?? 0, cached: estimate.cached ?? 0, estimated: true }, this.now());
      if (run?.status === 'completed') this.clearUsagePause();
      settle?.(run, entry);
      this.onChange();
    });
    this.onChange();
  }
}
