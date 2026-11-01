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

// Criticality times impact over effort: a quick high-value fix beats a slow low-value one, and small work is favoured.
const levelWorth = { critical: 3, important: 2, casual: 1 };
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

function itemEntry(project, item) {
  const { slug, name = slug, level } = project;
  const impact = item.impact ?? impactOfKind[item.kind];
  const effort = item.effort ?? effortOfKind[item.kind];
  const started = item.state === 'doing';
  const score = levelWorth[level] * impactWorth[impact] / effortCost[effort] * (item.urgent ? URGENT_FACTOR : 1) * (started ? STARTED_FACTOR : 1);
  const why = plainList([started && 'started', item.urgent && 'urgent', level === 'critical' && 'critical', `${impact} impact`, effort]);
  return { key: `item:${slug}:${item.id}`, kind: 'item', lane: 'do', slug, project: name, level, title: item.title, effort, urgent: item.urgent, item, score, why };
}

/** A study takes the rank of the best thing it unlocks, because nothing on the project can run before it. */
function studyEntry(project, unlocked) {
  const { slug, name = slug, level } = project;
  const worth = levelWorth[level] * impactWorth.high / effortCost.medium;
  const score = Math.max(worth, ...unlocked.map(entry => entry.score));
  const why = plainList(['first study', level === 'critical' && 'critical', unlocked.length && `unlocks ${unlocked.length}`]);
  return { key: `study:${slug}`, kind: 'study', lane: 'look', focus: 'study', slug, project: name, level, title: 'first study', effort: 'medium', score, why };
}

/** The lens that is due next on a project. New commits bring it forward and move it up, and start nothing by themselves. */
function lensEntry(project, state, now) {
  const { slug, name = slug, level } = project;
  const every = levels[level].lookEveryHours * HOUR_MS / (state.newCommits ? 2 : 1);
  const elapsed = elapsedSince(state.lastLensAt, now);
  if (elapsed < every) return null;

  const focus = lenses[(state.lensIndex ?? 0) % lenses.length];
  const overdue = 1 + Math.min(1, (elapsed - every) / every);
  const moved = state.newCommits ? NEW_COMMITS_FACTOR : 1;
  const score = levelWorth[level] * lensWorth[focus] / effortCost.medium * overdue * moved;
  const why = plainList([level === 'critical' && 'critical', state.newCommits ? 'new commits' : 'due']);
  return { key: `look:${slug}`, kind: 'look', lane: 'look', focus, slug, project: name, level, title: `${focus} look`, effort: 'small', score, why };
}

function ideasEntry(project, state, { root, now, budget }) {
  const { slug, name = slug, level } = project;
  if (elapsedSince(state.lastIdeasAt, now) < IDEAS_EVERY_MS || !ideasWanted(root, slug, budget)) return null;
  const score = levelWorth[level] * impactWorth.low / effortCost.medium;
  return { key: `ideas:${slug}`, kind: 'ideas', lane: 'look', focus: 'ideas', slug, project: name, level, title: 'new ideas', effort: 'small', score, why: 'daily ideas' };
}

function projectEntries(context, project) {
  const { root, now, running } = context;
  const { slug } = project;
  const state = readState(root, slug);
  const held = (state.heldUntil && Date.parse(state.heldUntil) > now) ? state.heldReason : null;
  const items = readItems(root, slug)
    .filter(item => ['open', 'doing'].includes(item.state) && doableKinds.includes(item.kind))
    .filter(item => !running.some(run => run.slug === slug && run.item === item.id))
    .map(item => itemEntry(project, item));
  const studied = existsSync(paths(root, slug).project);
  const canStudy = elapsedSince(state.lastLookAt, now) >= STUDY_RETRY_MS;
  const look = studied ? lensEntry(project, state, now) ?? ideasEntry(project, state, context) : canStudy ? studyEntry(project, items) : null;
  const entries = [...items, ...(look ? [look] : [])];
  return entries.map(entry => ({ ...entry, held, unstudied: !studied && entry.kind === 'item' }));
}

function discoveryEntry({ root, mode, now, running }) {
  if (!mode.folder || running.some(run => run.lane === 'discover')) return [];
  const { status, folder } = readDiscovery(root);
  const looked = folder === mode.folder && lookOutcomes.includes(status);
  const first = !looked && !hasWorkToShow(root);
  if (!first && elapsedSince(mode.lastDiscoveryAt, now) < DISCOVERY_EVERY_MS) return [];
  return [{
    key: 'discover', kind: 'discover', lane: 'discover', project: 'Projects', title: 'find projects', effort: 'small',
    score: first ? FIRST_DISCOVERY_WORTH : REPEAT_DISCOVERY_WORTH, why: first ? 'nothing to work on yet' : 'daily look',
  }];
}

const byWorth = (left, right) => right.score - left.score
  || entryOrder.indexOf(left.kind) - entryOrder.indexOf(right.kind)
  || (left.item?.at ?? '').localeCompare(right.item?.at ?? '')
  || left.key.localeCompare(right.key);

/** Why this entry cannot start now, leaving out what stops the whole plan and the budget. */
function ownWait(entry, entries, { running, unmerged }) {
  const here = running.filter(run => run.slug === entry.slug);
  if (entry.held) return entry.held;
  if (entry.unstudied) return 'needs its study';
  if (here.some(run => run.lane === entry.lane)) return entry.lane === 'do' ? 'one item at a time here' : 'a look is running here';
  // Waiting keeps a run in the project's own folder. Small work is soon done, so it waits, and the rest takes a worktree.
  if (here.length && entry.effort === 'small' && !entry.urgent) return 'waits for the run here';
  if (entry.kind === 'item' && entry.item.state !== 'doing' && entries.some(other => other.slug === entry.slug && other.item?.state === 'doing')) return 'after its started item';
  if (unmerged.full.includes(entry.slug) && entry.kind !== 'study') return `${unmerged.perProject[entry.slug]} unmerged here`;
  return null;
}

const skipsTheHour = entry => Boolean(entry.urgent && entry.level === 'critical');

function budgetWait(entry, budget) {
  if (!fitsDay(budget, entry.estimate.fresh)) return 'over today\'s budget';
  return skipsTheHour(entry) || fitsHour(budget, entry.estimate.fresh) ? null : 'over this hour\'s share';
}

/** A limit the plan cannot work around stops everything, and nothing but its own end or the user clears it. */
function hardStop({ mode, now, reading }) {
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

  const smallest = Math.min(...ready.map(entry => entry.estimate.fresh), 0);
  const blocked = ready.length && ready.every(entry => entry.waiting);
  if (budget.hourUsed < budget.hourShare && !blocked) return null;
  if (ready.some(skipsTheHour)) return null;
  return { kind: 'hour', line: hourLine(budget, smallest, now) };
}

/**
 * One ranked list of everything that could run next. Pure code over what is on disk, so it spends no tokens and anyone can ask.
 * `running`, `chatBusy` and `checks` come from the owner. Without them the list is what would run on an idle machine.
 */
export function planWork(root, { mode = readMode(root), now = Date.now(), running = [], chatBusy = false, checks = 0, lastStartAt = null } = {}) {
  const budget = budgetFor(root, mode, now, running);
  const unmerged = unmergedNow(root, mode);
  const reading = readSubscription(root);
  const context = { root, mode, now, running, budget, unmerged, reading };
  const history = costHistory(root);
  const projects = readProjects(root).filter(project => project.state === 'chosen');
  const ranked = [...discoveryEntry(context), ...projects.flatMap(project => projectEntries(context, project))]
    .map(entry => ({ ...entry, estimate: estimateRun(history, { kind: entry.lane === 'do' ? 'do' : entry.kind, level: entry.level }) }))
    .toSorted(byWorth);
  const entries = ranked.map(entry => {
    const own = ownWait(entry, ranked, context);
    return { ...entry, ownWait: own, waiting: own ?? budgetWait(entry, budget) };
  });

  const subscription = { known: Boolean(reading), windows: usageWindows(reading, now) };
  const agents = subscription.known && mode.harness === 'pi' ? mode.agents : 1;
  const free = agents - running.length - checks;
  const startsAt = lastStartAt === null ? null : lastStartAt + mode.startGapMs;
  const stop = hardStop(context);
  const pause = stop ?? budgetPause(entries, budget, now);
  const spaced = startsAt !== null && startsAt > now;
  const waitingOn = chatBusy ? 'Chat is busy, so nothing new starts until it is free.'
    : checks && free <= 0 ? 'Scheduled checks are running, so nothing new starts until they finish.' : null;
  const next = stop || chatBusy || free <= 0 || spaced ? null : entries.find(entry => !entry.waiting) ?? null;
  return {
    mode, entries, next, pause, budget, subscription, unmerged, agents, waitingOn,
    nextStartAt: spaced ? new Date(startsAt).toISOString() : null,
  };
}
