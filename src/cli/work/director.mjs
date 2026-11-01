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
import { discoveryMessage, hobkinCommand } from './chat.mjs';
import { agentName } from './panes.mjs';
import {
  currentRequest, dailyLimit, declinedToday, DISCOVERY_EVERY_MS, foldersLeft, hasWorkToShow, isPacing, landing, lenses, levels, nextDiscoveryAt, nextItem, paths,
  proposedProjects, readDiscovery, readItems, readMode, readProjects, readState, recordDiscovery, recordTokens, requestAllowance, sessionUsage, slugOf, tokenLabel,
  tokensToday, updateItem, writeMode, writeState,
} from './store.mjs';
import { prepareTree } from './tree.mjs';

const HOUR_MS = 3600000;
const STUDY_RETRY_MS = HOUR_MS / 4;
const DISCOVERY_RETRY_MS = HOUR_MS / 4;
const IDEAS_EVERY_MS = 24 * HOUR_MS;
const MOST_IDEAS = 3;
const SOME_OPEN_ITEMS = 2;
const PLENTY_OPEN_ITEMS = 5;
const MAX_ATTEMPTS = 2;
const MAX_DISCOVERY_CONTINUATIONS = 2;
const MAX_NOTES_BYTES = 16384;
const MAX_ITEMS_SENT = 40;
const MAX_BRANCH_NAME = 40;
const MAX_REASON_LENGTH = 500;
// A look that ended one of these ways has had its say, so an empty tab is not a reason to look again today.
const lookOutcomes = ['finished', 'failed', 'unfinished', 'cancelled'];

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

/** Decides what runs next. Everything it knows lives in `work/`, so it can restart at any time. */
export class WorkDirector {
  constructor({ root, config, runtime, runner, runHarness = defaultRunHarness, panes = null, now = Date.now, onChange = () => {} }) {
    Object.assign(this, { root, config, runtime, runner, runHarness, panes, now, onChange });
    this.active = new Map();
  }

  running() { return [...this.active.values()]; }

  // Turning work mode off starts nothing new. Project agents finish, but a look stops: it only reads, it carries on from its notes, and nothing shows what it spends once the tab is gone.
  async tick() {
    this.recoverDiscovery();
    this.tellNewProposals();
    const mode = readMode(this.root);
    if (!mode.enabled) {
      const look = this.active.get('discover');
      if (look) await this.runner.kill(look.id);
      return;
    }

    const tokens = { today: tokensToday(this.root, this.now()), limit: dailyLimit(mode, this.now()) };
    const atLimit = tokens.today >= tokens.limit;
    const holding = atLimit || isPacing(this.root, tokens.limit, this.now());
    const hasRoom = () => this.active.size < mode.pool;
    if (holding) this.holdDiscovery();
    if (hasRoom() && !holding && this.discoveryDue(mode)) this.startDiscovery(mode.folder, tokens);

    const projects = readProjects(this.root)
      .filter(project => project.state === 'chosen')
      .toSorted((left, right) => levels[left.level].rank - levels[right.level].rank);
    if (holding) this.askForAllowance(mode, projects, tokens, atLimit);
    for (const project of projects) {
      if (holding || !hasRoom() || this.active.has(laneKey(project.slug, 'look'))) continue;
      const focus = this.nextLook(project, tokens);
      if (focus) this.startLook(project, focus, tokens);
    }
    for (const project of projects) {
      if (!hasRoom() || this.active.has(laneKey(project.slug, 'do'))) continue;
      if (!existsSync(paths(this.root, project.slug).project)) continue;
      const item = nextItem(this.root, project.slug);
      if (item && (!holding || item.urgent)) this.startDo(project, item);
    }
  }

  // Pausing is not stopping: running agents finish and items stay. The user just gets the choice, once, with the reason.
  askForAllowance(mode, projects, { today, limit }, atLimit) {
    const asked = currentRequest(mode, this.now());
    const alreadyAsked = asked?.limit === limit && asked.atLimit === atLimit;
    if (alreadyAsked || declinedToday(mode, this.now())) return;

    const waiting = projects.flatMap(project => readItems(this.root, project.slug)
      .filter(item => ['open', 'doing'].includes(item.state) && item.kind !== 'attention')
      .map(item => ({ item, project })));
    if (!waiting.length) return;

    const proposed = limit * 2;
    const [{ item, project }] = waiting;
    const used = atLimit ? `it has used ${tokenLabel(today)} of today's ${tokenLabel(limit)} tokens`
      : `it used this hour's share of today's ${tokenLabel(limit)} tokens`;
    const count = waiting.length === 1 ? '1 item is' : `${waiting.length} items are`;
    const otherwise = atLimit ? 'they wait until tomorrow' : 'they carry on as the hour moves on';
    const reason = `Work mode paused: ${used}. ${count} waiting, starting with "${item.title}" on ${project.name}. `
      + `Raising today's allowance to ${tokenLabel(proposed)} lets them run now; otherwise ${otherwise}.`;
    requestAllowance(this.root, { limit, proposed, atLimit, reason }, this.now());
    this.onChange();
  }

  // The clock is for looking again. With nothing to show, it counts only if a look at this folder really ended.
  discoveryDue(mode) {
    if (!mode.folder || this.active.has('discover')) return false;
    const { status, folder } = readDiscovery(this.root);
    const looked = folder === mode.folder && lookOutcomes.includes(status);
    if (!looked && !hasWorkToShow(this.root)) return true;
    return elapsedSince(mode.lastDiscoveryAt, this.now()) >= DISCOVERY_EVERY_MS;
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

  nextLook({ slug, level }, tokens) {
    const state = readState(this.root, slug);
    const elapsed = at => elapsedSince(at, this.now());
    if (!existsSync(paths(this.root, slug).project)) return elapsed(state.lastLookAt) >= STUDY_RETRY_MS ? 'study' : null;
    if (elapsed(state.lastLensAt) >= levels[level].lookEveryHours * HOUR_MS) return lenses[(state.lensIndex ?? 0) % lenses.length];
    return elapsed(state.lastIdeasAt) >= IDEAS_EVERY_MS && this.ideasWanted(slug, tokens) ? 'ideas' : null;
  }

  // Ideas add work, so a project already full of it gets fewer, and so does a day that has used most of its tokens.
  ideasWanted(slug, tokens) {
    const open = readItems(this.root, slug)
      .filter(item => ['open', 'doing'].includes(item.state) && item.kind !== 'attention').length;
    if (open >= PLENTY_OPEN_ITEMS) return 0;
    const wanted = open >= SOME_OPEN_ITEMS ? 1 : MOST_IDEAS;
    return tokens.today >= tokens.limit / 2 ? Math.min(wanted, 1) : wanted;
  }

  modelFor(level) {
    return this.config[levels[level].model].model;
  }

  command(subcommand) {
    return hobkinCommand(this.root, `work ${subcommand}`);
  }

  /** Exact commands, so the main agent's answer lands in this home whatever is on its path. */
  answerCommands() {
    return {
      choose: this.command('choose <slug> [critical|important|casual]'),
      skip: this.command('skip <slug>'),
      allow: this.command('allow [tokens | no]'),
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
      commands: { item: this.command(`item ${slug}`) },
      authorization,
    };
  }

  async repositoryFor(project) {
    const repo = project.path ?? paths(this.root, project.slug).clone;
    if (!existsSync(repo) && project.remote) await clone('git', ['clone', '--quiet', project.remote, repo]);
    return repo;
  }

  // Only a look that finished starts clean. Anything else left a list to pick up, here and in `checkMemory`.
  startDiscovery(folder, tokens) {
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
    const { status, reason } = closing ? { status: 'interrupted' } : this.discoveryOutcome(run, enabled);

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

  startLook(project, focus, tokens) {
    const { slug, level } = project;
    const state = readState(this.root, slug);
    const now = new Date(this.now()).toISOString();
    const lens = { lastLookAt: now, lastLensAt: now, lensIndex: (state.lensIndex ?? 0) + 1 };
    writeState(this.root, slug, { study: { lastLookAt: now }, ideas: { lastIdeasAt: now } }[focus] ?? lens);
    const ideas = focus === 'ideas' ? { ideas: this.ideasWanted(slug, tokens) } : {};

    const cwd = paths(this.root, slug).lookTree;
    this.start({
      key: laneKey(slug, 'look'),
      lane: 'look',
      slug,
      title: `${project.name}: ${focus}`,
      purpose: 'work-look',
      cwd,
      model: this.modelFor(level),
      effort: levels[level].lookEffort,
      instructions: `Look at ${project.name} with the focus ${focus}.`,
      prepare: async () => { await prepareTree({ repo: await this.repositoryFor(project), tree: cwd }); },
      work: () => ({ lane: 'look', focus, tokens, ...ideas, ...this.describe(project) }),
      settle: run => this.settleLook(slug, run),
    });
  }

  // The tab is the only place a failed look shows, because a busy project stays out of Chat.
  settleLook(slug, run) {
    if (run?.status === 'interrupted') return;

    const lookError = run?.status === 'completed' ? null : runError(run) || 'The look failed.';
    writeState(this.root, slug, { lookError });
  }

  startDo(project, item) {
    const { slug, level } = project;
    const branch = item.branch ?? `hobkin/${item.id}-${slugOf(item.title).slice(0, MAX_BRANCH_NAME)}`;
    const resume = Boolean(item.branch);
    updateItem(this.root, slug, item.id, { state: 'doing', branch }, this.now());

    const cwd = paths(this.root, slug).doTree;
    this.start({
      key: laneKey(slug, 'do'),
      lane: 'do',
      slug,
      item: item.id,
      title: `${project.name}: ${item.title}`,
      purpose: 'work-do',
      cwd,
      model: this.modelFor(level),
      effort: levels[level].doEffort,
      instructions: `Finish this item on ${project.name}: ${item.title}`,
      prepare: async () => { await prepareTree({ repo: await this.repositoryFor(project), tree: cwd, branch, resume }); },
      work: () => ({
        lane: 'do',
        item: { ...item, branch },
        landing: landing(level, item.kind),
        ...this.describe(project),
      }),
      settle: run => this.settleItem(slug, item.id, run),
    });
  }

  // A run that ended without recording an outcome did not finish. Closing Hobkin keeps the item, so it resumes.
  // Cancelling one is the user saying stop, so it waits for them instead of starting again on the next tick.
  settleItem(slug, id, run) {
    const interrupted = run?.status === 'interrupted';
    if (interrupted && this.runner.stopped) return;
    const item = readItems(this.root, slug).find(entry => entry.id === id);
    if (item?.state !== 'doing') return;
    const attempts = (item.attempts ?? 0) + 1;
    updateItem(this.root, slug, id, { state: interrupted || attempts >= MAX_ATTEMPTS ? 'stuck' : 'open', attempts }, this.now());
  }

  async runInPane({ slug, lane, harnessId, purpose, prompt, cwd, model, effort, sessionFile, signal }) {
    const directory = join(paths(this.root, slug).directory, 'runs');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const brief = join(directory, `${harnessId}.md`);
    const report = join(directory, `${harnessId}.report.md`);
    writeFileSync(brief, paneBrief(purpose, prompt, report), { mode: 0o600 });
    const result = await this.panes.run({
      name: agentName(lane, slug),
      kind: readMode(this.root).harness,
      cwd,
      model,
      effort,
      sessionFile,
      brief,
      report,
      signal,
    });
    const { usd, sessionId } = sessionUsage(sessionFile);
    return usd ? { ...result, cost: { usd, kind: 'estimate', cumulative: true, sessionId } } : result;
  }

  start({ key, lane, slug, item, title, purpose, cwd, model, effort, instructions, prepare, work, settle }) {
    const harnessId = randomUUID();
    const id = `work:${slug ?? 'discover'}:${lane}:${harnessId}`;
    const scheduleId = slug ? `work.${slug}.${lane}` : 'work.discover';
    const inPane = Boolean(slug && this.panes);
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
    const effect = async signal => {
      await prepare?.();
      const schedule = { id: scheduleId, title, prompt: instructions, cwd, harness: 'pi', model, context: [] };
      const { runs } = await this.runtime.state();
      const previous = Object.values(runs)
        .filter(run => run.scheduleId === scheduleId && run.status !== 'running')
        .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];
      const prompt = await buildContext(schedule, previous, readMemory(this.root), openCheck(this.root, scheduleId), work());
      mkdirSync(join(this.root, 'jobs'), { recursive: true, mode: 0o700 });
      if (inPane) return this.runInPane({ slug, lane, harnessId, purpose, prompt, cwd, model, effort, sessionFile, signal });
      return this.runHarness({
        id: harnessId,
        harness: 'pi',
        purpose,
        cwd,
        model,
        effort,
        prompt,
        sessionFile,
        signal,
      }, { onEvent: event => this.runner.onActivity(id, event) });
    };
    this.active.set(key, { id, slug, lane, title, effort });
    const { work: finished } = this.runner.startTracked(request, effect);
    finished.then(run => {
      this.active.delete(key);
      const { tokens } = sessionUsage(sessionFile);
      if (tokens) recordTokens(this.root, { slug, lane, tokens }, this.now());
      settle?.(run);
      this.onChange();
    });
    this.onChange();
  }
}
