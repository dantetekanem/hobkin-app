import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from '../migration/admission.mjs';
import {
  addItem, addProject, answerAllow, askAgent, callTrouble, cancelRuns, declineItem, dropWork, markDone, markMax, mergeItem, openDiff, pauseWork, publishItem, putBackRow, reply, requestReview, resumeWork, retryNow, setGrade, setLevel, setPriority, setPrMode, skipRow,
  skipWork, startMode, stopMode, syncWork, takeProject, triggerRow, trueOutcome, trustPattern,
} from './controls.mjs';
import { forecastEachMinute } from './forecast.mjs';
import { offersView } from './land-offer.mjs';
import { assertLaunch, recordWatch } from './launches.mjs';
import { findProject, nameOf } from './names.mjs';
import { fileFirstPair, setShipFirst } from './pairs.mjs';
import { filePickUp } from './pick-up.mjs';
import { finishesWork, MAX_RUNS_A_DAY, MAX_RUNS_AT_ONCE, planWork, rowWait } from './plan.mjs';
import { assertState, attentionView, closingItems, itemCounts, itemsView, landingList, projectsView, prView, queueView, readyItems, runningView, searchView, statusView, watchingView } from './reads.mjs';
import { reviewView } from './review.mjs';
import { readSignals, recordSignals, signalGaps } from './signals.mjs';
import {
  agentStates, chooseAutoPick, currentRequest, fileItem, folderSearched, landing, MAX_AGENTS, nextDiscoveryAt, nextLookAt, noteDiscovery, ownerView, paths, priorityOf, proposeProject, readDiscovery, readItems,
  readMode, readProject, readProjects, readState, setAgents, setDailyTokens, tokenLabel, updateItem, writeMode,
} from './store.mjs';
import { gitOrNothing, prepareTree } from './tree.mjs';
import { unmergedNow } from './unmerged.mjs';
import { readWatch } from './watcher.mjs';

const HELP = `Usage: hobkin work [command] [--home folder]. With no command, the full status.
Read, as JSON, with nothing running:
  status                               on or off, pauses, tokens, limits, next
  projects [--state state]             chosen, proposed, skipped or dropped
  running, queue                       agents at work; the plan and its waits
  items [project] [--state state]      state, grade, branch, PR, what is left
  ready                                what can land at its commit, and why not
  pr, diff <project> <item>            a local PR; diff says how to open it in pi-coder
  review [project item]                the last week; or ask to review that item
  search <text>                        by name, path, title, summary or error
  attention, offers                    what is left for the user; what can land
  watching, signals <project>          what landed; what a project can show
Change, printing ok and message. Project: name, slug or path. Item: id start.
  start [folder] [--auto], stop       on, only picks run; off: agents finish
  pause, resume [project]              agents finish, none start; resume ends it
  trigger <project> [look|study|item]  run it next, inside limits (was run)
  cancel <project|run id|item> [--decline]  stop it; --decline: not approved
  sync                                 find what merged or closed, file rebases
  add project <path|name> [level]      take a project (was choose)
  add item <project> <title> [--brief text]  add work by hand
  skip <project> [look|study|item]     skip a proposal or a row (was later)
  back <project> <look|study|item>     put a skipped row back
  retry, ask <project> <item> [note]    tries reset; ask runs your note first
  done, merge, decline <project> <item>  close; merge locally; or say no
  publish <project> <item> [commit]    approved: push it at that commit, open its PR
  trust <pattern> <on|off>             the user's switch for a pattern's offers
  trouble <project> <item> [severe] [why]  a merge went wrong: files the fix
  drop <project> [item]                stop work on it; branches and PRs stay
  grade <project> <item> <P0..P3|auto> set an item's grade; auto clears it
  max <project> <item>                 make one item max: ahead of critical
  level <project> <low..max>           casual (low), important, critical, max
  priority <project> <P0..P3>          how often it runs, and its queue place
  prs <project> <off|draft|published>  local PR, draft PR or published PR
  auto, reviews, ship [on|off]         pick alone; review; ship before new work
  agents <1-${MAX_AGENTS}>                         how many agents work at once
  tokens <number>, allow [number|no]   the daily limit; or a yes for today
  reset                                forget what it found; it must be off
Used by agents inside a run:
  item, signals, watch <project>       JSON on stdin: an item; what a look found
  propose, progress                    JSON on stdin: a project; a look's place
  tree <project>                       a worktree for a look that needs tests
`;
// What the tab and an agent asking need, and a long plan would otherwise fill the status.
const MAX_PLAN_SENT = 50;
// No main agent hears a command's reply, so a note or a review asked here waits in the queue whatever the mode.
const QUEUED = { toMainAgent: false };

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

const reviewsLine = on => (on
  ? 'Each finished branch gets a review by itself, about $2 and 14 minutes of a worker each.'
  : 'A review runs only when asked for: Get it reviewed on a card, or hobkin work review <project> <item>.');

async function readText(input) {
  let text = '';
  for await (const chunk of input) text += chunk;
  return text;
}

const readJson = async input => JSON.parse(await readText(input));

/** With nothing piped this only reads. A terminal has no end to read to, so it is not read at all. */
async function signalsCommand(root, reference, input) {
  const project = findProject(root, reference);
  const report = input && !input.isTTY ? await readText(input) : '';
  if (!report.trim()) return readSignals(root, project.slug) ?? { signal: null, wants: null, checkedAt: null };

  const signals = recordSignals(root, project.slug, JSON.parse(report));
  const { signal, wants } = signals;
  return reply(`${nameOf(project)} is at signal ${signal} and wants ${wants}.`, { signal, wants, gaps: signalGaps(signals) });
}

async function watchCommand(root, reference, input) {
  const project = findProject(root, reference);
  const { recorded, trouble } = recordWatch(root, project.slug, await readJson(input));
  const said = trouble.length ? `${trouble.length} went wrong, and an urgent fix is filed for each.` : 'Nothing went wrong.';
  return reply(`Recorded ${recorded} on ${nameOf(project)}. ${said}`, { recorded, trouble });
}

// `finishes` marks work on a finished branch, which starts even with auto-pick off.
const planRow = (entry, free) => {
  const { key, kind, lane, slug, project, level, grade, item, title, why, estimate, waiting, skipped, picked } = entry;
  return { key, kind, lane, slug, project, level, grade, item: item?.id ?? null, title, why, estimate, skipped, picked, finishes: finishesWork(entry), waiting: rowWait({ waiting }, free) };
};
const runningRow = ({ id, tokens = 0, cached = 0, note = null, estimate }) => ({ id, tokens, cached, estimate, note });

function watchSummary(root) {
  const watch = readWatch(root);
  if (!watch) return null;
  const { at, noted: { added = [], changed = [], removed = [], proposed = [] } = {} } = watch;
  return { at, added: added.length, changed: changed.length, removed: removed.length, proposed: proposed.length };
}

/**
 * Starting with a pile says so with the real count, and the first two are filed at once, so a start never floods agents. Without `--auto`, which goes
 * before or after the folder, nothing new starts by itself, and what to pick up first waits in Action Items.
 */
function startWithPile(root, args) {
  const folder = args.find(arg => arg !== '--auto');
  const started = startMode(root, folder, { autoPick: args.includes('--auto') });
  const pile = fileFirstPair(root);
  const pickUp = filePickUp(root) ? 'What to start first waits in Action Items.' : null;
  return { ...started, message: [started.message, pile, pickUp].filter(Boolean).join(' ') };
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
      signal: readSignals(root, project.slug)?.signal ?? null,
    };
  });
  const { enabled, folder, autoPick } = mode;
  const visible = entries.filter(entry => !entry.skipped).slice(0, MAX_PLAN_SENT);
  return {
    enabled,
    folder,
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
    harnessLines: mode.harnessLines ?? [],
    folderLines: mode.folderLines ?? [],
    shipFirst: plan.shipFirst,
    shipNotice: mode.ship?.notice ?? null,
    waitingOn: plan.waitingOn,
    nextStartAt: plan.nextStartAt,
    forecast: forecastEachMinute(root, plan, { running: outlook.running ?? [] }),
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
    watching: watchingView(root),
  };
}

/** Forgets what work mode found, so the next start looks from nothing. Everything it held moves aside and nothing is deleted. Its folder, limits, directions and every branch stay. */
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
    case 'review': return args.length ? requestReview(root, args[0], args[1], QUEUED) : reviewView(root);
    case 'search': return searchView(root, args.join(' '));
    case 'attention': return attentionView(root);
    case 'offers': return offersView(root);
    case 'trust': return trustPattern(root, ...args);
    case 'watching': return watchingView(root);
    case 'start':
    case 'on': return startWithPile(root, args);
    case 'stop':
    case 'off': return stopMode(root);
    case 'pause': return pauseWork(root, args[0]);
    case 'resume': return resumeWork(root, args[0]);
    case 'trigger':
    case 'run': return triggerRow(root, ...args);
    case 'cancel': return cancelRuns(root, args.find(arg => arg !== '--decline'), { decline: args.includes('--decline') });
    case 'sync': return syncWork(root);
    case 'ship': return setShipFirst(root, args[0]);
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
    case 'merge': return mergeItem(root, args[0], args[1]);
    case 'publish': return publishItem(root, args[0], args[1], { head: args[2] ?? null });
    case 'decline': return declineItem(root, args[0], args[1]);
    case 'ask': return askAgent(root, args[0], args[1], args.slice(2).join(' '), QUEUED);
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
    case 'agents': return reply(`Up to ${setAgents(root, Number(args[0])).agents} agents may run at once, from the next start.`);
    case 'tokens': return reply(`The daily limit is ${tokenLabel(setDailyTokens(root, Number(args[0])).dailyTokens)} fresh tokens, from now on.`);
    case 'auto': {
      if (!args[0]) return { autoPick: readMode(root).autoPick };
      const { autoPick } = chooseAutoPick(root, autoPickFrom(args[0]));
      return reply(autoPick ? 'Auto-pick is on. The top of the queue starts by itself.' : 'Auto-pick is off. Work mode stays on, and only what is triggered runs.');
    }
    case 'reviews': {
      // Off unless the user turns them on, because each review costs a whole run.
      if (!args[0]) {
        const reviewOnFinish = readMode(root).reviewOnFinish === true;
        return { reviewOnFinish, line: reviewsLine(reviewOnFinish) };
      }
      const { reviewOnFinish } = writeMode(root, { reviewOnFinish: reviewsFrom(args[0]) });
      return reply(reviewsLine(reviewOnFinish));
    }
    case 'allow': return answerAllow(root, args[0]);
    case 'progress': return noteDiscovery(root, await readJson(input));
    case 'propose': {
      // A level is only a suggestion the user answers, but `priority` and `prMode` would pass unseen, and they are only ever the user's word.
      const { priority, prMode, ...proposal } = await readJson(input);
      return proposeProject(root, proposal);
    }
    case 'item': {
      // Agents file work through this, and `max`, `grade`, `reviewAsked`, `reviewAskedFor`, `workNote` and what a merge or an offer records are only ever hobkin's or the user's word, so none can arrive here.
      const { max, grade, reviewAsked, reviewAskedFor, workNote, landed, closedByUser, offerHeldUntil, pushbacks, withMainAgent, ...item } = await readJson(input);
      if (!item.id) return fileItem(root, args[0], item);
      assertState(item.state, agentStates);
      if (item.launch) assertLaunch(item.launch);
      // A session the main agent was handed this work by has said how it went, so its card comes back now, not when the hand-off runs out.
      const reported = item.state || item.proof ? { withMainAgent: null } : {};
      return updateItem(root, args[0], item.id, { ...(await trueOutcome(root, args[0], item)), ...reported });
    }
    case 'tree': return treeFor(root, args[0]);
    case 'signals': return signalsCommand(root, args[0], input);
    case 'watch': return watchCommand(root, args[0], input);
    case 'trouble': return callTrouble(root, ...args);
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
