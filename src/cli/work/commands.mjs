import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from '../migration/admission.mjs';
import { MAX_RUNS_A_DAY, MAX_RUNS_AT_ONCE, planWork } from './plan.mjs';
import {
  answerAllowance, chooseProject, currentRequest, dropProject, fileItem, MAX_AGENTS, nextDiscoveryAt, nextLookAt, noteDiscovery, paths, pickNext, proposeProject,
  putBackInQueue, readDiscovery, readItems, readMode, readProject, readProjects, readState, retryItem, setAgents, setDailyTokens, setHarness, setUnmergedLimit,
  skipInQueue, skipProject, startWork, updateItem, writeMode,
} from './store.mjs';
import { prepareTree, removeTree } from './tree.mjs';
import { readWatch } from './watcher.mjs';

const USAGE = `Usage: hobkin work [on [folder] | off | reset | harness <kind> | agents <1-${MAX_AGENTS}> | tokens <daily limit> | allow [tokens | no] | unmerged <limit> | resume | auto [on | off] | run <queue key> | later <queue key> | back <queue key> | retry <slug> <item> | max <slug> <item> | progress | propose | choose <slug or path> [level] | skip <slug> | drop <slug> | item <slug> | tree <slug>]`;
// What the tab and an agent asking need, and a long plan would otherwise fill the status.
const MAX_PLAN_SENT = 50;

function autoPickFrom(word) {
  if (!['on', 'off'].includes(word)) throw Error('Say auto on or auto off.');
  return word === 'on';
}

async function readJson(input) {
  let text = '';
  for await (const chunk of input) text += chunk;
  return JSON.parse(text);
}

const planRow = ({ key, kind, lane, slug, project, level, title, why, estimate, waiting, skipped, picked }, free) => ({
  key, kind, lane, slug, project, level, title, why, estimate, skipped, picked, waiting: waiting ?? (free > 0 ? null : 'a free worker'),
});
const runningRow = ({ id, tokens = 0, cached = 0, note = null, estimate, waitingForApproval }) => ({
  id, tokens, cached, estimate, note: waitingForApproval ? 'Waiting for approval in its pane.' : note,
});

function watchSummary(root) {
  const watch = readWatch(root);
  if (!watch) return null;
  const { at, noted: { added = [], changed = [], removed = [], proposed = [] } = {} } = watch;
  return { at, added: added.length, changed: changed.length, removed: removed.length, proposed: proposed.length };
}

/** Status for agents and for the Work tab. `open` and `prs` count what each project has going. `outlook` is what only the owner knows. */
export function workStatus(root, outlook = {}) {
  const mode = readMode(root);
  const plan = planWork(root, { mode, ...outlook });
  const { budget, entries, pause, subscription, unmerged } = plan;
  const projects = readProjects(root).map(project => {
    const items = readItems(root, project.slug);
    const { lookError = null, folderNote = null } = readState(root, project.slug);
    return {
      ...project,
      open: items.filter(item => ['open', 'doing'].includes(item.state) && item.kind !== 'attention').length,
      prs: items.filter(item => item.state === 'pr').length,
      stuck: items.filter(item => item.state === 'stuck').length,
      unmerged: unmerged.perProject[project.slug] ?? 0,
      nextLookAt: project.state === 'chosen' ? nextLookAt(root, project) : null,
      lookError,
      folderNote,
    };
  });
  const attention = readProjects(root).flatMap(({ slug }) => readItems(root, slug)
    .filter(item => (item.kind === 'attention' && item.state === 'open') || item.state === 'stuck')
    .map(({ id, title, state, stuckReason = null }) => ({ slug, id, title, state, reason: stuckReason })));
  const { enabled, folder, harness, autoPick } = mode;
  const visible = entries.filter(entry => !entry.skipped).slice(0, MAX_PLAN_SENT);
  return {
    enabled,
    folder,
    harness,
    autoPick,
    agents: plan.agents,
    agentsAllowed: mode.agents,
    maxRuns: { running: (outlook.running ?? []).filter(run => run.level === 'max').length, today: budget.maxRuns, atOnce: MAX_RUNS_AT_ONCE, perDay: MAX_RUNS_A_DAY },
    dailyTokens: budget.limit,
    tokensToday: budget.used,
    tokensCached: budget.cached,
    hourShare: budget.hourShare,
    tokensThisHour: budget.hourUsed,
    pacing: pause?.kind === 'hour',
    paused: enabled && Boolean(pause),
    pause: enabled ? pause : null,
    pauseNotice: enabled && pause ? mode.pauseNotice ?? null : null,
    waitingOn: plan.waitingOn,
    nextStartAt: plan.nextStartAt,
    allowanceRequest: enabled ? currentRequest(mode) : null,
    subscription,
    unmerged,
    running: (outlook.running ?? []).map(runningRow),
    queued: entries.filter(entry => !entry.skipped).length,
    plan: [...visible, ...entries.filter(entry => entry.skipped)].map(entry => planRow(entry, plan.free)),
    watch: watchSummary(root),
    discovery: readDiscovery(root),
    nextDiscoveryAt: nextDiscoveryAt(mode),
    projects,
    attention,
  };
}

/** Forgets what work mode found, so the next start looks from nothing. Its folder, harness, limits, directions and every branch stay. */
async function resetWork(root) {
  const mode = readMode(root);
  if (mode.enabled) throw Error('Turn work mode off first, so nothing is running in the trees this removes.');
  const projects = readProjects(root);
  const aside = join(root, 'runtime', `work-reset-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(aside, { recursive: true, mode: 0o700 });
  for (const { slug, path } of projects) {
    const { directory, lookTree, doTree, clone } = paths(root, slug);
    for (const tree of [lookTree, doTree]) await removeTree({ repo: path, tree });
    // A clone of Hobkin's own can hold branches found nowhere else.
    if (existsSync(clone)) renameSync(clone, join(aside, `${slug}-repo`));
    rmSync(directory, { recursive: true, force: true });
  }
  for (const name of ['projects.jsonl', 'discovery.jsonl', 'unmerged.json', 'watch.json']) {
    const file = join(root, 'work', name);
    if (existsSync(file)) renameSync(file, join(aside, name));
  }
  for (const check of readdirSync(join(root, 'checks'), { withFileTypes: true })) {
    if (check.isDirectory() && check.name.startsWith('work.')) rmSync(join(root, 'checks', check.name), { recursive: true, force: true });
  }
  writeMode(root, { lastDiscoveryAt: null, mergeStop: null });
  return { forgot: projects.length, kept: aside };
}

/** For a look that turns out to need tests or a build, which never run in the user's own folder. */
async function treeFor(root, slug) {
  const project = readProject(root, slug);
  if (!project) throw Error(`Unknown project: ${slug}`);
  const { clone, lookTree } = paths(root, slug);
  await prepareTree({ repo: project.path ?? clone, tree: lookTree });
  return { tree: lookTree };
}

/** These take no lock. They only append or rewrite `mode.json`, and the owner picks that up on its next tick. */
export async function runWorkCommand(requestedRoot, [action, ...args], input) {
  const root = resolveDataRoot(requestedRoot);
  switch (action) {
    case undefined: return workStatus(root);
    case 'on': return startWork(root, args[0]);
    case 'off': return writeMode(root, { enabled: false });
    case 'reset': return resetWork(root);
    case 'harness': return setHarness(root, args[0]);
    case 'agents': return setAgents(root, Number(args[0]));
    case 'tokens': return setDailyTokens(root, Number(args[0]));
    case 'unmerged': return setUnmergedLimit(root, Number(args[0]));
    case 'resume': return writeMode(root, { keptGoingAt: new Date().toISOString(), mergeStop: null });
    case 'auto': return args[0] ? writeMode(root, { autoPick: autoPickFrom(args[0]) }) : { autoPick: readMode(root).autoPick };
    case 'run': return pickNext(root, args[0]);
    case 'later': return skipInQueue(root, args[0]);
    case 'back': return putBackInQueue(root, args[0]);
    case 'retry': return retryItem(root, args[0], args[1]);
    case 'max': return updateItem(root, args[0], args[1], { max: true });
    case 'allow': {
      if (args[0] === 'no') return answerAllowance(root, false);
      return answerAllowance(root, args[0] ? Number(args[0]) : true);
    }
    case 'progress': return noteDiscovery(root, await readJson(input));
    case 'propose': return proposeProject(root, await readJson(input));
    case 'choose': return chooseProject(root, args[0], args[1]);
    case 'skip': return skipProject(root, args[0]);
    case 'drop': return dropProject(root, args[0]);
    case 'item': {
      // Agents file work through this, and `max` is only ever the user's word, so it cannot arrive here.
      const { max, ...item } = await readJson(input);
      return item.id ? updateItem(root, args[0], item.id, item) : fileItem(root, args[0], item);
    }
    case 'tree': return treeFor(root, args[0]);
    default: throw Error(USAGE);
  }
}
