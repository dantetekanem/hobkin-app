import { existsSync } from 'node:fs';
import { budgetFor, costHistory, dayLine, estimateRun, fitsDay, fitsHour, hourLine } from './budget.mjs';
import { lookTime } from './chat.mjs';
import { unmergedNow } from './unmerged.mjs';
import { overReserve, readSubscription, usageWindows } from './usage.mjs';
import {
  DISCOVERY_EVERY_MS, doableKinds, hasWorkToShow, lenses, levels, paths, readDiscovery, readItems, readMode, readProjects, readState,
} from './store.mjs';

const HOUR_MS = 3600000;
const STUDY_RETRY_MS = HOUR_MS / 4;
const IDEAS_EVERY_MS = 24 * HOUR_MS;
const MOST_IDEAS = 3;
const SOME_OPEN_ITEMS = 2;
const PLENTY_OPEN_ITEMS = 5;
// A look that ended one of these ways has had its say, so an empty tab is not a reason to look again today.
const lookOutcomes = ['finished', 'failed', 'unfinished', 'cancelled'];

// Opus at max effort is the dearest run there is and shares a subscription with the user's own Claude work, so these stay few.
export const MAX_RUNS_AT_ONCE = 1;
export const MAX_RUNS_A_DAY = 6;
// Criticality times impact over effort: a quick high-value fix beats a slow low-value one, and small work is favoured.
const levelWorth = { max: 5, critical: 3, important: 2, casual: 1 };
const impactWorth = { high: 3, medium: 2, low: 1 };
const effortCost = { small: 1, medium: 2, large: 4 };
const URGENT_FACTOR = 3;
const STARTED_FACTOR = 2;
const NEW_COMMITS_FACTOR = 1.5;
// With a user waiting on an empty tab, finding projects comes first. A daily look again comes when nothing better is ready.
const FIRST_DISCOVERY_WORTH = 100;
const REPEAT_DISCOVERY_WORTH = 1;
// Older items have no impact or effort, so their kind stands in.
const impactOfKind = { 'pr-fix': 'high', security: 'high', fix: 'high', update: 'medium', improvement: 'medium', feature: 'medium', chore: 'low' };
const effortOfKind = { 'pr-fix': 'small', security: 'medium', fix: 'medium', update: 'small', improvement: 'medium', feature: 'large', chore: 'small' };
const lensWorth = { security: 3, bugs: 3, updates: 2, improvements: 2, features: 2, chores: 1, trends: 1 };
const entryOrder = ['discover', 'study', 'item', 'look', 'ideas'];

const elapsedSince = (at, now) => (at ? now - Date.parse(at) : Infinity);
const plainList = parts => parts.filter(Boolean).join(', ');

/** Ideas add work, so a project already full of it gets fewer, and so does a day that has used most of its tokens. */
export function ideasWanted(root, slug, { used, limit }) {
  const open = readItems(root, slug).filter(item => ['open', 'doing'].includes(item.state) && item.kind !== 'attention').length;
  if (open >= PLENTY_OPEN_ITEMS) return 0;
  const wanted = open >= SOME_OPEN_ITEMS ? 1 : MOST_IDEAS;
  return used >= limit / 2 ? Math.min(wanted, 1) : wanted;
}

const levelWord = level => (['max', 'critical'].includes(level) ? level : '');
const ofProject = ({ slug, name = slug, level }) => ({ slug, project: name, level });

function itemEntry(project, item) {
  const { slug } = project;
  const level = item.max ? 'max' : project.level;
  const impact = item.impact ?? impactOfKind[item.kind];
  const effort = item.effort ?? effortOfKind[item.kind];
  const started = item.state === 'doing';
  const worth = levelWorth[level] * impactWorth[impact] / effortCost[effort];
  return {
    ...ofProject(project),
    key: `item:${slug}:${item.id}`,
    kind: 'item',
    lane: 'do',
    level,
    title: item.title,
    effort,
    urgent: item.urgent,
    item,
    score: worth * (item.urgent ? URGENT_FACTOR : 1) * (started ? STARTED_FACTOR : 1),
    why: plainList([started && 'started', item.urgent && 'urgent', levelWord(level), `${impact} impact`, effort]),
  };
}

/** A study takes the rank of the best thing it unlocks, because nothing on the project can run before it. */
function studyEntry(project, unlocked) {
  const { slug, level } = project;
  const worth = levelWorth[level] * impactWorth.high / effortCost.medium;
  return {
    ...ofProject(project),
    key: `study:${slug}`,
    kind: 'study',
    lane: 'look',
    focus: 'study',
    title: 'first study',
    effort: 'medium',
    score: Math.max(worth, ...unlocked.map(entry => entry.score)),
    why: plainList(['first study', levelWord(level), unlocked.length && `unlocks ${unlocked.length}`]),
  };
}

/** The lens that is due next on a project. New commits bring it forward and move it up, and start nothing by themselves. */
function lensEntry(project, state, now, triggered) {
  const { slug, level } = project;
  const every = levels[level].lookEveryHours * HOUR_MS / (state.newCommits ? 2 : 1);
  const elapsed = elapsedSince(state.lastLensAt, now);
  if (elapsed < every && !triggered) return null;

  const focus = lenses[(state.lensIndex ?? 0) % lenses.length];
  const overdue = 1 + Math.min(1, (elapsed - every) / every);
  const moved = state.newCommits ? NEW_COMMITS_FACTOR : 1;
  return {
    ...ofProject(project),
    key: `look:${slug}`,
    kind: 'look',
    lane: 'look',
    focus,
    title: `${focus} look`,
    effort: 'small',
    score: levelWorth[level] * lensWorth[focus] / effortCost.medium * overdue * moved,
    why: plainList([levelWord(level), state.newCommits ? 'new commits' : 'due']),
  };
}

function ideasEntry(project, state, { root, now, budget }) {
  const { slug, level } = project;
  if (elapsedSince(state.lastIdeasAt, now) < IDEAS_EVERY_MS || !ideasWanted(root, slug, budget)) return null;
  return {
    ...ofProject(project),
    key: `ideas:${slug}`,
    kind: 'ideas',
    lane: 'look',
    focus: 'ideas',
    title: 'new ideas',
    effort: 'small',
    score: levelWorth[level] * impactWorth.low / effortCost.medium,
    why: 'daily ideas',
  };
}

/** A project has one look due at most: its study until that is done, then a lens, then ideas. A trigger makes a look due, and nothing else about it changes. */
function lookEntry(context, project, state, studied, items) {
  const triggered = kind => context.mode.queueNext.includes(`${kind}:${project.slug}`);
  if (triggered('study')) return studyEntry(project, items);
  if (studied) return lensEntry(project, state, context.now, triggered('look')) ?? ideasEntry(project, state, context);
  return elapsedSince(state.lastLookAt, context.now) >= STUDY_RETRY_MS ? studyEntry(project, items) : null;
}

function projectEntries(context, project) {
  const { root, now, running } = context;
  const { slug } = project;
  const state = readState(root, slug);
  const hold = state.heldUntil && Date.parse(state.heldUntil) > now ? state.heldReason : null;
  const held = project.paused ? 'paused' : hold;
  const studied = existsSync(paths(root, slug).project);
  const items = readItems(root, slug)
    .filter(item => ['open', 'doing'].includes(item.state) && doableKinds.includes(item.kind))
    .filter(item => !running.some(run => run.slug === slug && run.item === item.id))
    .map(item => itemEntry(project, item));
  const look = lookEntry(context, project, state, studied, items);
  const entries = look ? [...items, look] : items;
  return entries.map(entry => ({ ...entry, held, unstudied: !studied && entry.kind === 'item' }));
}

function discoveryEntry({ root, mode, now, running }) {
  if (!mode.folder || running.some(run => run.lane === 'discover')) return [];
  const { status, folder } = readDiscovery(root);
  const looked = folder === mode.folder && lookOutcomes.includes(status);
  const first = !looked && !hasWorkToShow(root);
  if (!first && elapsedSince(mode.lastDiscoveryAt, now) < DISCOVERY_EVERY_MS) return [];
  return [{
    key: 'discover',
    kind: 'discover',
    lane: 'discover',
    project: 'Projects',
    title: 'find projects',
    effort: 'small',
    score: first ? FIRST_DISCOVERY_WORTH : REPEAT_DISCOVERY_WORTH,
    why: first ? 'nothing to work on yet' : 'daily look',
  }];
}

// The sort is stable, so work of equal worth keeps the order it was filed in.
const byWorth = (left, right) => right.score - left.score
  || entryOrder.indexOf(left.kind) - entryOrder.indexOf(right.kind)
  || (left.item?.at ?? '').localeCompare(right.item?.at ?? '');

/** Claude panes share no limits with anything else here, so `max` work has its own, and it needs a pane to run in. */
function maxWait({ mode, now, running, budget, panes }) {
  if (!panes) return 'needs Herdr';
  if (mode.claudePause && Date.parse(mode.claudePause.until) > now) return 'Claude usage limit';
  const runningNow = running.filter(run => run.level === 'max').length;
  if (runningNow >= MAX_RUNS_AT_ONCE) return 'one max run at a time';
  return budget.maxRuns + runningNow >= MAX_RUNS_A_DAY ? `${MAX_RUNS_A_DAY} max runs a day` : null;
}

/** Why this entry cannot start now, leaving out what stops the whole plan and the budget. */
function ownWait(entry, entries, context) {
  const { running, unmerged } = context;
  const here = running.filter(run => run.slug === entry.slug);
  if (entry.skipped) return 'skipped';
  if (entry.held) return entry.held;
  if (entry.unstudied) return 'needs its study';
  if (here.some(run => run.lane === entry.lane)) return entry.lane === 'do' ? 'one item at a time here' : 'a look is running here';
  // Waiting keeps a run in the project's own folder. Small work is soon done, so it waits, and the rest takes a worktree.
  if (here.length && entry.effort === 'small' && !entry.urgent && !entry.picked) return 'another run here';
  if (entry.kind === 'item' && entry.item.state !== 'doing' && entries.some(other => other.slug === entry.slug && other.item?.state === 'doing')) return 'after its started item';
  if (unmerged.full.includes(entry.slug) && entry.kind !== 'study') return `${unmerged.perProject[entry.slug]} unmerged here`;
  return entry.level === 'max' ? maxWait(context) : null;
}

/** The user's picks go first in the order they were made, and what they skipped stays in sight at the end. */
const inQueueOrder = ({ queueNext }) => entries => [
  ...queueNext.flatMap(key => entries.filter(entry => entry.key === key)),
  ...entries.filter(entry => !entry.picked && !entry.skipped),
  ...entries.filter(entry => entry.skipped && !entry.picked),
];

/** What a row waits on, with what stops the whole plan left to the pause. */
export const rowWait = ({ waiting }, free) => waiting ?? (free > 0 ? null : 'a free worker');

const skipsTheHour = entry => Boolean(entry.urgent && entry.level === 'critical');

function budgetWait(entry, budget) {
  if (!fitsDay(budget, entry.estimate.fresh)) return 'over today\'s budget';
  return skipsTheHour(entry) || fitsHour(budget, entry.estimate.fresh) ? null : 'over this hour\'s share';
}

/** A limit the plan cannot work around stops everything, and nothing but its own end or the user clears it. */
function hardStop({ mode, now, reading }) {
  if (mode.pausedAt) return { kind: 'hand', line: 'Paused by hand. What is running finishes, and nothing new starts until hobkin work resume.' };
  const paused = mode.usagePause;
  if (paused && Date.parse(paused.until) > now) {
    const line = `Paused by a usage limit: ${paused.reason} It tries again at ${lookTime(paused.until, now)}.`;
    return { kind: 'usage', line, until: paused.until };
  }
  const over = overReserve(reading, now);
  if (over) {
    const until = over.until ? ` It carries on around ${lookTime(over.until, now)}.` : '';
    const percent = Math.round(over.allowedPercent);
    return { kind: 'reserve', line: `Paused to protect the subscription: ${over.label} window ${Math.round(over.usedPercent)}% used, and work may use ${percent}% for now.${until}`, until: over.until };
  }
  if (mode.mergeStop) return { kind: 'merges', line: mode.mergeStop.line };
  return null;
}

function budgetPause(entries, budget, now) {
  const ready = entries.filter(entry => !entry.ownWait);
  const dayLeft = budget.limit - budget.used;
  if (dayLeft <= 0 || (ready.length && ready.every(entry => entry.estimate.fresh > dayLeft))) return { kind: 'day', line: dayLine(budget) };

  // Only tokens really spent make a pause. What is held for running agents is not gone, and a row waiting on it says so itself.
  const hourLeft = budget.hourShare - budget.hourUsed;
  const fitsWhatIsLeft = entry => entry.estimate.fresh <= hourLeft || budget.hourUsed === 0;
  const hourGone = hourLeft <= 0 || (ready.length > 0 && !ready.some(fitsWhatIsLeft));
  if (!hourGone || ready.some(skipsTheHour)) return null;
  const smallest = ready.length ? Math.min(...ready.map(entry => entry.estimate.fresh)) : 0;
  return { kind: 'hour', line: hourLine(budget, smallest, now) };
}

/**
 * One ranked list of everything that could run next. Pure code over what is on disk, so it spends no tokens and anyone can ask.
 * `running`, `chatBusy`, `checks` and `panes` come from the owner. Without them the list is what would run on an idle machine.
 */
export function planWork(root, { mode = readMode(root), now = Date.now(), running = [], chatBusy = false, checks = 0, lastStartAt = null, panes = true } = {}) {
  const budget = budgetFor(root, mode, now, running);
  const unmerged = unmergedNow(root, mode);
  const reading = readSubscription(root);
  const context = { root, mode, now, running, budget, unmerged, reading, panes };
  const history = costHistory(root);
  const projects = readProjects(root).filter(project => project.state === 'chosen');
  const ranked = inQueueOrder(mode)([...discoveryEntry(context), ...projects.flatMap(project => projectEntries(context, project))]
    .map(entry => ({
      ...entry,
      skipped: mode.queueSkipped.includes(entry.key),
      picked: mode.queueNext.includes(entry.key),
      estimate: estimateRun(history, { kind: entry.lane === 'do' ? 'do' : entry.kind, level: entry.level }),
    }))
    .toSorted(byWorth));
  const entries = ranked.map(entry => {
    const own = ownWait(entry, ranked, context);
    return { ...entry, ownWait: own, waiting: own ?? budgetWait(entry, budget) };
  });

  const subscription = { known: Boolean(reading), windows: usageWindows(reading, now) };
  const agents = subscription.known && mode.harness === 'pi' ? mode.agents : 1;
  const free = agents - running.length - checks;
  const startsAt = lastStartAt === null ? null : lastStartAt + mode.startGapMs;
  const stop = hardStop(context);
  const pause = stop ?? budgetPause(entries.filter(entry => !entry.skipped), budget, now);
  const spaced = startsAt !== null && startsAt > now;
  const waitingOn = chatBusy ? 'Chat is busy, so nothing new starts until it is free.'
    : checks && free <= 0 ? 'Scheduled checks are running, so nothing new starts until they finish.' : null;
  const first = entries.find(entry => !entry.waiting && (mode.autoPick || entry.picked));
  // A pick is the user's own word, so it does not wait out the gap between starts.
  const next = stop || chatBusy || free <= 0 || (spaced && !first?.picked) ? null : first ?? null;
  return {
    mode, entries, next, pause, budget, subscription, unmerged, agents, free, waitingOn,
    nextStartAt: spaced ? new Date(startsAt).toISOString() : null,
  };
}
