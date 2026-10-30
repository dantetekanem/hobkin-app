import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { openCheck } from '../checks.mjs';
import { buildContext } from '../context.mjs';
import { runHarness as defaultRunHarness, workDirections } from '../harnesses.mjs';
import { readMemory } from '../memory.mjs';
import { agentName } from './panes.mjs';
import {
  landing, lenses, levels, nextItem, paths, readItems, readMode, readProjects, readState, slugOf, updateItem, writeMode, writeState,
} from './store.mjs';
import { prepareTree } from './tree.mjs';

const HOUR_MS = 3600000;
const DISCOVERY_EVERY_MS = 24 * HOUR_MS;
const STUDY_RETRY_MS = HOUR_MS / 4;
const DISCOVERY_RETRY_MS = HOUR_MS / 4;
const MAX_ATTEMPTS = 2;
const MAX_NOTES_BYTES = 16384;
const MAX_ITEMS_SENT = 40;
const MAX_BRANCH_NAME = 40;

const mainScript = fileURLToPath(new URL('../main.mjs', import.meta.url));
const shellWord = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const clone = promisify(execFile);

// Pi loads the user's global rules into every run, and those ask for explicit permission for these actions.
const authorization = 'Turning on work mode and taking this project is the user\'s authorization to install dependencies in the '
  + 'tree, run the full test suite, commit to companion/* branches, push them and open pull requests.';

const readBounded = file => {
  if (!existsSync(file)) return '';
  return Buffer.from(readFileSync(file)).subarray(0, MAX_NOTES_BYTES).toString('utf8');
};
const elapsedSince = (at, now) => (at ? now - Date.parse(at) : Infinity);
const paneBrief = (purpose, request, report) => `${workDirections(purpose)}

## Your report

You are working in a terminal pane the user can watch. When you are finished, write your final report to \`${report}\`, then stop. Companion reads that file to know you are done, so write it last, and write it even if you are blocked.

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

  async tick() {
    const mode = readMode(this.root);
    if (!mode.enabled) {
      if (this.active.size) await this.stopRuns();
      return;
    }
    const hasRoom = () => this.active.size < mode.pool;
    if (hasRoom() && this.discoveryDue(mode)) this.startDiscovery(mode.folder);

    const projects = readProjects(this.root)
      .filter(project => project.state === 'chosen')
      .toSorted((left, right) => levels[left.level].rank - levels[right.level].rank);
    for (const project of projects) {
      if (hasRoom() && !this.active.has(laneKey(project.slug, 'look')) && this.lookDue(project)) this.startLook(project);
    }
    for (const project of projects) {
      if (!hasRoom() || this.active.has(laneKey(project.slug, 'do'))) continue;
      if (!existsSync(paths(this.root, project.slug).project)) continue;
      const item = nextItem(this.root, project.slug);
      if (item) this.startDo(project, item);
    }
  }

  async stopRuns() {
    await Promise.all(this.running().map(({ id }) => this.runner.kill(id)));
  }

  discoveryDue(mode) {
    return Boolean(mode.folder) && !this.active.has('discover')
      && elapsedSince(mode.lastDiscoveryAt, this.now()) >= DISCOVERY_EVERY_MS;
  }

  lookDue({ slug, level }) {
    const state = readState(this.root, slug);
    if (!existsSync(paths(this.root, slug).project)) return elapsedSince(state.lastLookAt, this.now()) >= STUDY_RETRY_MS;
    return elapsedSince(state.lastLensAt, this.now()) >= levels[level].lookEveryHours * HOUR_MS;
  }

  modelFor(level) {
    return this.config[levels[level].model].model;
  }

  command(subcommand) {
    return `${shellWord(process.execPath)} ${shellWord(mainScript)} work ${subcommand} --home ${shellWord(this.root)}`;
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

  startDiscovery(folder) {
    writeMode(this.root, { lastDiscoveryAt: new Date(this.now()).toISOString() });
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
      instructions: `Find the projects in ${folder} and propose the ones worth working on.`,
      work: () => ({
        lane: 'discover',
        folder,
        known: readProjects(this.root).map(({ slug, path, state }) => ({ slug, path, state })),
        commands: { propose: this.command('propose') },
      }),
      settle: run => this.settleDiscovery(run),
    });
  }

  // A run that did not finish found nothing the user can rely on, so it must not count as today's discovery.
  settleDiscovery(run) {
    if (run?.status === 'completed') return;
    if (run?.status === 'interrupted') {
      writeMode(this.root, { lastDiscoveryAt: null });
      return;
    }
    const retryAt = this.now() - DISCOVERY_EVERY_MS + DISCOVERY_RETRY_MS;
    writeMode(this.root, { lastDiscoveryAt: new Date(retryAt).toISOString() });
  }

  startLook(project) {
    const { slug, level } = project;
    const state = readState(this.root, slug);
    const studied = existsSync(paths(this.root, slug).project);
    const index = state.lensIndex ?? 0;
    const focus = studied ? lenses[index % lenses.length] : 'study';
    const now = new Date(this.now()).toISOString();
    writeState(this.root, slug, studied ? { lastLookAt: now, lastLensAt: now, lensIndex: index + 1 } : { lastLookAt: now });

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
      work: () => ({ lane: 'look', focus, ...this.describe(project) }),
    });
  }

  startDo(project, item) {
    const { slug, level } = project;
    const branch = item.branch ?? `companion/${item.id}-${slugOf(item.title).slice(0, MAX_BRANCH_NAME)}`;
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

  // A run that ended without recording an outcome did not finish. An interruption keeps the item, so it resumes.
  settleItem(slug, id, run) {
    if (run?.status === 'interrupted') return;
    const item = readItems(this.root, slug).find(entry => entry.id === id);
    if (item?.state !== 'doing') return;
    const attempts = (item.attempts ?? 0) + 1;
    updateItem(this.root, slug, id, { state: attempts >= MAX_ATTEMPTS ? 'stuck' : 'open', attempts }, this.now());
  }

  runInPane({ slug, lane, harnessId, purpose, prompt, cwd, model, effort, sessionFile, signal }) {
    const directory = join(paths(this.root, slug).directory, 'runs');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const brief = join(directory, `${harnessId}.md`);
    const report = join(directory, `${harnessId}.report.md`);
    writeFileSync(brief, paneBrief(purpose, prompt, report), { mode: 0o600 });
    return this.panes.run({
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
  }

  start({ key, lane, slug, item, title, purpose, cwd, model, effort, instructions, prepare, work, settle }) {
    const harnessId = randomUUID();
    const id = `work:${slug ?? 'discover'}:${lane}:${harnessId}`;
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
      work: { slug, lane, item },
    };
    const effect = async signal => {
      await prepare?.();
      const schedule = { id: scheduleId, title, prompt: instructions, cwd, harness: 'pi', model, context: [] };
      const { runs } = await this.runtime.state();
      const previous = Object.values(runs)
        .filter(run => run.scheduleId === scheduleId && run.status !== 'running')
        .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];
      const prompt = await buildContext(schedule, previous, readMemory(this.root), openCheck(this.root, scheduleId), work());
      const directory = join(this.root, 'jobs');
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const sessionFile = join(directory, `${harnessId}.jsonl`);
      if (slug && this.panes) {
        return this.runInPane({ slug, lane, harnessId, purpose, prompt, cwd, model, effort, sessionFile, signal });
      }
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
      settle?.(run);
      this.onChange();
    });
    this.onChange();
  }
}
