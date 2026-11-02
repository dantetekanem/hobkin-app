import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from '../migration/admission.mjs';
import {
  addItem, addProject, answerAllow, askAgent, cancelRuns, declineItem, dropWork, markDone, markMax, mergeItem, openDiff, pauseWork, putBackRow, reply, requestReview, resumeWork, retryNow, setGrade, setLevel, setPriority, setPrMode, skipRow,
  skipWork, startMode, stopMode, syncWork, takeProject, triggerRow,
} from './controls.mjs';
import { MAX_RUNS_A_DAY, MAX_RUNS_AT_ONCE, planWork, rowWait } from './plan.mjs';
import { assertState, attentionView, closingItems, itemCounts, itemsView, landingList, projectsView, prView, queueView, readyItems, runningView, searchView, statusView } from './reads.mjs';
import { reviewView } from './review.mjs';
import {
  agentStates, currentRequest, fileItem, folderSearched, landing, MAX_AGENTS, nextDiscoveryAt, nextLookAt, noteDiscovery, ownerView, paths, priorityOf, proposeProject, readDiscovery, readItems,
  readMode, readProject, readProjects, readState, setAgents, setDailyTokens, setHarness, tokenLabel, updateItem, writeMode,
} from './store.mjs';
import { gitOrNothing, prepareTree } from './tree.mjs';
import { unmergedNow } from './unmerged.mjs';
import { readWatch } from './watcher.mjs';

const HELP = `Usage: hobkin work [command] [--home folder]. With no command, the full status.
Read, as JSON, with nothing running:
  status                               on or off, pauses, tokens, limits, next
  projects [--state state]             chosen, proposed, skipped or dropped
  running                              each agent, its pane and how long
  queue                                the plan, each row's grade and its wait
  items [project] [--state state]      state, grade, branch, PR, what is left
  ready                                what can land by real grades; why the rest cannot
  pr, diff <project> <item>            a local PR; diff opens it in pi-coder
  review [project item]                the last week; or ask to review that item
  search <text>                        by name, path, title, summary or error
  attention                            what is left for the user, and the answer
Change, printing ok and message. Project: name, slug or path. Item: id start.
  start [folder]                       same as on, and ends any pause
  stop                                 same as off: agents finish, none start
  pause, resume [project]              agents finish, none start; resume ends it
  trigger <project> [look|study|item]  run it next, inside limits (was run)
  cancel <project|run id|item>         ask the owner to cancel running work
  sync                                 find what merged or closed, file rebases
  add project <path|name> [level]      take a project (was choose)
  add item <project> <title> [--brief text]  add work by hand
  skip <project> [look|study|item]     skip a proposal or a row (was later)
  back <project> <look|study|item>     put a skipped row back
  retry, ask <project> <item> [note]    run it first; ask carries your note
  done, merge, decline <project> <item>  close; merge locally; or say no
  drop <project> [item]                stop work on it; branches and PRs stay
  grade <project> <item> <P0..P3|auto> set an item's grade; auto clears it
  max <project> <item>                 make one item max: Claude Opus at max
  level <project> <low..max>           casual (low), important, critical, max
  priority <project> <P0..P3>          how often it runs, and its queue place
  prs <project> <off|draft|published>  local PR, draft PR or published PR
  auto, reviews [on|off]               pick by itself; review what finishes
  harness <pi|claude|codex>            which agent works on projects
  agents <1-${MAX_AGENTS}>                         how many run at once
  tokens <number>                      the daily limit, from now on
  allow [number|no]                    answer a request, for today only
  reset                                forget what it found; it must be off
Used by agents inside a run:
  item <project>                       JSON on stdin: file or update an item
  propose, progress                    JSON on stdin: a project; a look's place
  tree <project>                       a worktree for a look that needs tests
`;
// What the tab and an agent asking need, and a long plan would otherwise fill the status.
const MAX_PLAN_SENT = 50;

/** A wrong command needs nothing but the help. */
class WrongCommand extends Error {}

function autoPickFrom(word) {
  if (!['on', 'off'].includes(word)) throw Error('Say auto on or auto off.');
  return word === 'on';
}

function reviewsFrom(word) {
  if (!['on', 'off'].includes(word)) throw Error('Say reviews on or reviews off.');
  return word === 'on';
}

async function readJson(input) {
  let text = '';
  for await (const chunk of input) text += chunk;
  return JSON.parse(text);
}

const planRow = ({ key, kind, lane, slug, project, level, grade, item, title, why, estimate, waiting, skipped, picked }, free) => ({
  key, kind, lane, slug, project, level, grade, item: item?.id ?? null, title, why, estimate, skipped, picked, waiting: rowWait({ waiting }, free),
});
const runningRow = ({ id, tokens = 0, cached = 0, note = null, estimate }) => ({ id, tokens, cached, estimate, note });

function watchSummary(root) {
  const watch = readWatch(root);
  if (!watch) return null;
  const { at, noted: { added = [], changed = [], removed = [], proposed = [] } = {} } = watch;
  return { at, added: added.length, changed: changed.length, removed: removed.length, proposed: proposed.length };
}

/** Status for agents and for the Work tab. `open`, `prs`, `branches` and `left` count what each project has going. `outlook` is what only the owner knows. */
export function workStatus(root, outlook = {}) {
  const mode = readMode(root);
  const plan = planWork(root, { mode, ...outlook });
  const { budget, entries, pause, subscription } = plan;
  const unmerged = unmergedNow(root);
  const projects = readProjects(root).map(project => {
    const items = readItems(root, project.slug);
    const { lookError = null, folderNote = null } = readState(root, project.slug);
    return {
      ...project,
      priority: priorityOf(project),
      prMode: landing(project),
      ...itemCounts(items),
      unmerged: unmerged.perProject[project.slug] ?? 0,
      nextLookAt: project.state === 'chosen' ? nextLookAt(root, project) : null,
      lookError,
      folderNote,
    };
  });
  const { enabled, folder, harness, autoPick } = mode;
  const visible = entries.filter(entry => !entry.skipped).slice(0, MAX_PLAN_SENT);
  return {
    enabled,
    folder,
    harness,
    autoPick,
    agents: plan.agents,
    agentsAllowed: mode.agents,
    maxRuns: {
      running: (outlook.running ?? []).filter(run => run.level === 'max').length,
      today: budget.maxRuns,
      atOnce: MAX_RUNS_AT_ONCE,
      perDay: MAX_RUNS_A_DAY,
    },
    dailyTokens: budget.limit,
    tokensToday: budget.used,
    tokensCached: budget.cached,
    hourShare: budget.hourShare,
    tokensThisHour: budget.hourUsed,
    pacing: pause?.kind === 'hour',
    paused: enabled && Boolean(pause),
    pause: enabled ? pause : null,
    pauseNotice: enabled && pause ? mode.pauseNotice ?? null : null,
    review: mode.review ?? null,
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
    nextDiscoveryAt: folderSearched(root, folder) ? null : nextDiscoveryAt(mode),
    projects,
    ready: readyItems(root),
    closing: closingItems(root),
  };
}

/** Forgets what work mode found, so the next start looks from nothing. Everything it held moves aside and nothing is deleted. Its folder, harness, limits, directions and every branch stay. */
async function resetWork(root) {
  const mode = readMode(root);
  if (mode.enabled) throw Error('Turn work mode off first, so nothing is running in the trees this moves.');
  const { running } = ownerView(root);
  if (running.length) throw Error(`Agents are still running, so nothing was reset: ${running.map(({ title }) => title).join(', ')}.`);
  const projects = readProjects(root);
  const aside = join(root, 'runtime', `work-reset-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(aside, { recursive: true, mode: 0o700 });
  for (const { slug, path } of projects) {
    const { directory } = paths(root, slug);
    // A tree's uncommitted work, a clone's branches, a local PR's description and the user's directions may exist nowhere else.
    if (existsSync(directory)) renameSync(directory, join(aside, slug));
    // Git goes on holding a moved tree's branch until it is told.
    if (path) await gitOrNothing(path, 'worktree', 'prune');
  }
  for (const name of ['projects.jsonl', 'discovery.jsonl', 'unmerged.json', 'watch.json']) {
    const file = join(root, 'work', name);
    if (existsSync(file)) renameSync(file, join(aside, name));
  }
  const checks = join(root, 'checks');
  // A check's name has a dot in it, and a project's slug cannot.
  for (const check of existsSync(checks) ? readdirSync(checks, { withFileTypes: true }) : []) {
    if (check.isDirectory() && check.name.startsWith('work.')) renameSync(join(checks, check.name), join(aside, check.name));
  }
  writeMode(root, { lastDiscoveryAt: null });
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
export async function runWorkCommand(requestedRoot, [action, ...args], input, { state, brief } = {}) {
  const root = resolveDataRoot(requestedRoot);
  switch (action) {
    case undefined: return workStatus(root);
    case 'help': return HELP;
    case 'status': return statusView(root);
    case 'projects': return projectsView(root, state);
    case 'running': return runningView(root);
    case 'queue': return queueView(root);
    case 'items': return itemsView(root, args[0], state);
    case 'ready': return landingList(root);
    case 'pr': return prView(root, ...args);
    case 'diff': return openDiff(root, ...args);
    case 'review': return args.length ? requestReview(root, ...args) : reviewView(root);
    case 'search': return searchView(root, args.join(' '));
    case 'attention': return attentionView(root);
    case 'start':
    case 'on': return startMode(root, args[0]);
    case 'stop':
    case 'off': return stopMode(root);
    case 'pause': return pauseWork(root, args[0]);
    case 'resume': return resumeWork(root, args[0]);
    case 'trigger':
    case 'run': return triggerRow(root, ...args);
    case 'cancel': return cancelRuns(root, args[0]);
    case 'sync': return syncWork(root);
    case 'add': {
      const [what, reference, ...rest] = args;
      if (what === 'project') return addProject(root, reference, ...rest);
      if (what === 'item') return addItem(root, reference, rest.join(' '), brief);
      throw new WrongCommand(HELP);
    }
    case 'choose': return takeProject(root, ...args);
    case 'skip': return skipWork(root, ...args);
    case 'later': return skipRow(root, ...args);
    case 'back': return putBackRow(root, ...args);
    case 'retry': return retryNow(root, ...args);
    case 'done': return markDone(root, ...args);
    case 'merge': return mergeItem(root, ...args);
    case 'decline': return declineItem(root, ...args);
    case 'ask': return askAgent(root, args[0], args[1], args.slice(2).join(' '));
    case 'drop': return dropWork(root, ...args);
    case 'grade': return setGrade(root, ...args);
    case 'max': return markMax(root, ...args);
    case 'level': return setLevel(root, ...args);
    case 'priority': return setPriority(root, ...args);
    case 'prs': return setPrMode(root, ...args);
    case 'reset': {
      const { forgot, kept } = await resetWork(root);
      return reply(`Forgot ${forgot} projects. The next start looks from nothing, and everything they held is in ${kept}.`, { forgot, kept });
    }
    case 'harness': return reply(`The next run uses ${setHarness(root, args[0]).harness}.`);
    case 'agents': return reply(`Up to ${setAgents(root, Number(args[0])).agents} agents may run at once, from the next start.`);
    case 'tokens': return reply(`The daily limit is ${tokenLabel(setDailyTokens(root, Number(args[0])).dailyTokens)} fresh tokens, from now on.`);
    case 'auto': {
      if (!args[0]) return { autoPick: readMode(root).autoPick };
      const { autoPick } = writeMode(root, { autoPick: autoPickFrom(args[0]) });
      return reply(autoPick ? 'Auto-pick is on. The top of the queue starts by itself.' : 'Auto-pick is off. Work mode stays on, and only what is triggered runs.');
    }
    case 'reviews': {
      if (!args[0]) return { reviewOnFinish: readMode(root).reviewOnFinish !== false };
      const { reviewOnFinish } = writeMode(root, { reviewOnFinish: reviewsFrom(args[0]) });
      return reply(reviewOnFinish ? 'Each finished branch gets a review, for its safety grade.' : 'Reviews run only when asked for.');
    }
    case 'allow': return answerAllow(root, args[0]);
    case 'progress': return noteDiscovery(root, await readJson(input));
    case 'propose': {
      // A level is only a suggestion the user answers, but `priority` and `prMode` would pass unseen, and they are only ever the user's word.
      const { priority, prMode, ...proposal } = await readJson(input);
      return proposeProject(root, proposal);
    }
    case 'item': {
      // Agents file work through this, and `max`, `grade`, `reviewAsked` and `workNote` are only ever hobkin's or the user's word, so none can arrive here.
      const { max, grade, reviewAsked, workNote, ...item } = await readJson(input);
      if (!item.id) return fileItem(root, args[0], item);
      assertState(item.state, agentStates);
      return updateItem(root, args[0], item.id, item);
    }
    case 'tree': return treeFor(root, args[0]);
    default: throw new WrongCommand(HELP);
  }
}

// One row to a line keeps a long list short to read and cheap for an agent.
const jsonText = result => (Array.isArray(result) && result.length
  ? `[\n${result.map(row => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
  : `${JSON.stringify(result, null, 2)}\n`);

/** Every outcome goes to `output`, because that is what an agent reads, and the exit code says which it was. */
export async function printWorkCommand({ root, args, state, brief }, output, input) {
  try {
    const result = await runWorkCommand(root, args, input, { state, brief });
    output.write(typeof result === 'string' ? result : jsonText(result));
    return 0;
  } catch (error) {
    const { message, matches } = error;
    const failure = { ok: false, message, ...(matches ? { matches } : {}) };
    output.write(error instanceof WrongCommand ? message : jsonText(failure));
    return 1;
  }
}
