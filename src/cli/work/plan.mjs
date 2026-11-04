import { existsSync } from 'node:fs';
import { budgetFor, costHistory, dayLine, estimateRun, fitsDay, fitsHour, hourLine } from './budget.mjs';
import { lookTime } from './chat.mjs';
import { openLaunches, watchDue } from './launches.mjs';
import { belowWanted, canWatch, readSignals, signalsDue } from './signals.mjs';
// `reads.mjs` imports this file too. Neither calls the other while loading, so the cycle is safe.
import { readyItems } from './reads.mjs';
import { shipFirst } from './ship.mjs';
import { aheadOfPace, readSubscription, usageWindows } from './usage.mjs';
import {
  chosenProjects, DISCOVERY_EVERY_MS, doableKinds, folderSearched, grades, hasWorkToShow, lenses, levels, lookEveryHours, movesFinishedWork, paths, priorityOf,
  readDiscovery, readItems, readLaunches, readMode, readState, runnableStates, tokenEvents,
} from './store.mjs';
import { pendingMerges } from './unmerged.mjs';

const HOUR_MS = 3600000;
const STUDY_RETRY_MS = HOUR_MS / 4;
const LOOKS_PER_IDEAS = 8;
const LEFT_ALONE_MS = 24 * HOUR_MS;
const SHORTEST_START_GAP_MS = 30000;
const WAIT_PER_TRY_MS = 10 * 60000;
const MOST_TRIES_COUNTED = 6;
const MOST_IDEAS = 3;
const SOME_OPEN_ITEMS = 2;
const PLENTY_OPEN_ITEMS = 5;
// With this much finished work unmerged, more work is not what a project needs. It is the point where its ideas stop too.
const SHIPPING_FIRST_AT = PLENTY_OPEN_ITEMS;
const newWorkKinds = ['feature', 'improvement'];
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
const impactOfKind = { attention: 'high', 'pr-fix': 'high', security: 'high', fix: 'high', update: 'medium', improvement: 'medium', feature: 'medium', chore: 'low' };
const effortOfKind = { attention: 'small', 'pr-fix': 'small', security: 'medium', fix: 'medium', update: 'small', improvement: 'medium', feature: 'large', chore: 'small' };
const lensWorth = { security: 3, bugs: 3, updates: 2, improvements: 2, features: 2, chores: 1, trends: 1 };
// How many grades below its project a row sits.
const impactSteps = { high: 0, medium: 1, low: 2 };
const IDEAS_STEPS = 2;
const entryOrder = ['discover', 'study', 'watch', 'item', 'signals', 'look', 'ideas'];

const elapsedSince = (at, now) => (at ? now - Date.parse(at) : Infinity);
const plainList = parts => parts.filter(Boolean).join(', ');
const gradeRank = grade => grades.indexOf(grade);
const gradeBelow = (grade, steps) => grades[Math.min(gradeRank(grade) + steps, grades.length - 1)];
const bestGrade = candidates => grades.find(grade => candidates.includes(grade));
const impactOf = item => item.impact ?? impactOfKind[item.kind];
// What brings finished work closer to landing goes ahead of making more, because it is the shortest way to something shipped.
const CLOSING_GRADE = 'P1';
const closesASignalGap = ({ key }) => Boolean(key?.startsWith('signal:'));
const closesAGap = item => movesFinishedWork(item) || closesASignalGap(item);
const stillRuns = item => item.state === 'doing' || item.urgent || item.kind === 'attention' || movesFinishedWork(item);

/** What the pile holds back: anything that adds to it. A pick is the user's own word, and a watch looks after what already landed. */
export const startsNewWork = ({ picked, focus, item }) => !picked && focus !== 'watch' && !(item && stillRuns(item));

/** A project as the plan grades it, with how much of its finished work is waiting on a merge and whether it sees less than it wants to. */
export const withPending = (root, project) => ({
  ...project,
  pending: pendingMerges(root, project.slug).length,
  underSignal: belowWanted(readSignals(root, project.slug)),
});

const canStepDown = item => newWorkKinds.includes(item.kind) && !item.grade && !item.urgent && !item.max;

/** New work steps down a grade on a project with plenty to merge, unless someone marked it by hand. This moves a row. What stops new work is the pile across every project, in `startsNewWork`. */
const shippingFirst = ({ pending = 0 }, item) => pending >= SHIPPING_FIRST_AT && canStepDown(item);

/** The same on a project that cannot see what it wants to, because more changes there are changes nobody can watch. This only ever moves a row too. */
const seeingFirst = ({ underSignal }, item) => Boolean(underSignal) && canStepDown(item) && !closesASignalGap(item);

/**
 * The user's grade wins. Urgent and attention work go first, and everything else follows its project down by its impact.
 * Each failed try moves an item down one more, so one that always fails cannot take every start from the work behind it.
 */
export function itemGrade(project, item) {
  if (item.grade) return item.grade;
  const first = item.urgent || item.kind === 'attention';
  const steps = impactSteps[impactOf(item)] + (shippingFirst(project, item) ? 1 : 0) + (seeingFirst(project, item) ? 1 : 0);
  const ranked = first ? 'P0' : gradeBelow(item.max ? 'P0' : priorityOf(project), steps);
  const graded = closesAGap(item) ? bestGrade([ranked, CLOSING_GRADE]) : ranked;
  return gradeBelow(graded, item.attempts ?? 0);
}

/** Ideas add work, so a project already full of it gets fewer, open or waiting to merge, and so does a day that has used most of its tokens. */
export function ideasWanted(root, slug, { used, limit }) {
  const open = readItems(root, slug).filter(item => runnableStates.includes(item.state)).length;
  const waiting = open + pendingMerges(root, slug).length;
  if (waiting >= PLENTY_OPEN_ITEMS) return 0;
  const wanted = waiting >= SOME_OPEN_ITEMS ? 1 : MOST_IDEAS;
  return used >= limit / 2 ? Math.min(wanted, 1) : wanted;
}

const levelWord = level => (['max', 'critical'].includes(level) ? level : '');
const triedWords = (attempts = 0) => (attempts > 0 && `tried ${attempts} ${attempts === 1 ? 'time' : 'times'}`);
const ofProject = project => {
  const { slug, name = slug, level } = project;
  return { slug, project: name, level, priority: priorityOf(project) };
};

function itemEntry(project, item) {
  const { slug } = project;
  const level = item.max ? 'max' : project.level;
  const impact = impactOf(item);
  const effort = item.effort ?? effortOfKind[item.kind];
  const started = item.state === 'doing';
  const worth = levelWorth[level] * impactWorth[impact] / effortCost[effort];
  return {
    ...ofProject(project),
    key: `item:${slug}:${item.id}`,
    kind: 'item',
    lane: 'do',
    level,
    grade: itemGrade(project, item),
    title: item.title,
    effort,
    urgent: item.urgent,
    item,
    score: worth * (item.urgent ? URGENT_FACTOR : 1) * (started ? STARTED_FACTOR : 1),
    why: plainList([
      started && 'started',
      item.urgent && 'urgent',
      shippingFirst(project, item) && 'shipping first',
      seeingFirst(project, item) && 'seeing first',
      levelWord(level),
      `${impact} impact`,
      effort,
      triedWords(item.attempts),
    ]),
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
    grade: bestGrade([priorityOf(project), ...unlocked.map(entry => entry.grade)]),
    title: 'first study',
    effort: 'medium',
    score: Math.max(worth, ...unlocked.map(entry => entry.score)),
    why: plainList(['first study', levelWord(level), unlocked.length && `unlocks ${unlocked.length}`]),
  };
}

/** The lens that is due next on a project. New commits bring it forward and move it up, and start nothing by themselves. */
export function lensEntry(project, state, now, triggered) {
  const { slug, level } = project;
  const every = lookEveryHours(project) * HOUR_MS / (state.newCommits ? 2 : 1);
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
    // Its pace is what limits a look, and a lower grade would leave it behind that pace.
    grade: priorityOf(project),
    title: `${focus} look`,
    effort: 'small',
    score: levelWorth[level] * lensWorth[focus] / effortCost.medium * overdue * moved,
    why: plainList([levelWord(level), state.newCommits ? 'new commits' : 'due']),
  };
}

export function ideasEntry(project, state, { root, now, budget }) {
  const { slug, level } = project;
  const every = lookEveryHours(project) * LOOKS_PER_IDEAS * HOUR_MS;
  if (elapsedSince(state.lastIdeasAt, now) < every || !ideasWanted(root, slug, budget)) return null;
  return {
    ...ofProject(project),
    key: `ideas:${slug}`,
    kind: 'ideas',
    lane: 'look',
    focus: 'ideas',
    grade: gradeBelow(priorityOf(project), IDEAS_STEPS),
    title: 'new ideas',
    effort: 'small',
    score: levelWorth[level] * impactWorth.low / effortCost.medium,
    why: 'due',
  };
}

/**
 * One look however many changes a project has out, and none under signal 2, because there would be nothing for it to read.
 * It starts nothing with the mode off, and what is due then goes ahead when the mode comes back. A trigger makes it due while anything is open.
 */
export function watchEntry(project, state, { root, now }, triggered) {
  const { slug, level } = project;
  if (!canWatch(readSignals(root, slug))) return null;
  const launches = readLaunches(root, slug);
  const { due, suspected } = watchDue(launches, state.lastWatchAt, now);
  if (!due && !(triggered && openLaunches(launches).length)) return null;
  return {
    ...ofProject(project),
    key: `watch:${slug}`,
    kind: 'watch',
    lane: 'look',
    focus: 'watch',
    grade: suspected ? 'P0' : priorityOf(project),
    title: 'watch look',
    effort: 'small',
    urgent: suspected,
    score: levelWorth[level] * impactWorth.high / effortCost.medium,
    why: suspected ? 'trouble suspected' : 'due',
  };
}

/** Once on a studied project and again each month, because what a project shows changes as it does. A trigger makes it due. */
export function signalsEntry(project, state, { root, now }, triggered) {
  const { slug, level } = project;
  const signals = readSignals(root, slug);
  if (!triggered && !signalsDue(signals, state.lastSignalsAt, now)) return null;
  return {
    ...ofProject(project),
    key: `signals:${slug}`,
    kind: 'signals',
    lane: 'look',
    focus: 'signals',
    grade: priorityOf(project),
    title: 'signals look',
    effort: 'small',
    score: levelWorth[level] * impactWorth.medium / effortCost.medium,
    why: signals ? 'a month old' : 'what it can show is not known yet',
  };
}

/** A project has one look due at most: its study until that is done, then a lens, then ideas. A trigger makes a look due, and nothing else about it changes. */
function lookEntry(context, project, state, studied, items) {
  const triggered = kind => context.mode.queueNext.includes(`${kind}:${project.slug}`);
  if (triggered('study')) return studyEntry(project, items);
  if (studied) return lensEntry(project, state, context.now, triggered('look')) ?? ideasEntry(project, state, context);
  if (elapsedSince(state.lastLookAt, context.now) < STUDY_RETRY_MS) return null;
  // Once a study has been tried the items run without it, so trying again unlocks nothing.
  return studyEntry(project, state.lastLookAt ? [] : items);
}

function projectEntries(context, project) {
  const { root, running } = context;
  const { slug, paused } = project;
  const state = readState(root, slug);
  const studied = existsSync(paths(root, slug).project);
  const items = readItems(root, slug)
    .filter(item => runnableStates.includes(item.state) && doableKinds.includes(item.kind))
    .filter(item => !running.some(run => run.slug === slug && run.item === item.id))
    .map(item => itemEntry(project, item));
  const triggered = kind => context.mode.queueNext.includes(`${kind}:${slug}`);
  const look = lookEntry(context, project, state, studied, items);
  const watch = watchEntry(project, state, context, triggered('watch'));
  const signals = studied ? signalsEntry(project, state, context, triggered('signals')) : null;
  const entries = [...items, ...[look, watch, signals].filter(Boolean)];
  // A study that keeps failing must never hold a project's items, so they wait for its first try and no longer.
  const unstudied = !studied && !state.lastLookAt;
  return entries.map(entry => ({ ...entry, paused, unstudied: unstudied && entry.kind === 'item' }));
}

export function discoveryEntry({ root, mode, now, running }) {
  if (!mode.folder || running.some(run => run.lane === 'discover')) return [];
  // A trigger is the user's own word, so it can still look again at a folder that is done.
  if (folderSearched(root, mode.folder) && !mode.queueNext.includes('discover')) return [];
  const { status, folder } = readDiscovery(root);
  const looked = folder === mode.folder && lookOutcomes.includes(status);
  const first = !looked && !hasWorkToShow(root);
  if (!first && elapsedSince(mode.lastDiscoveryAt, now) < DISCOVERY_EVERY_MS) return [];
  const grade = first ? 'P0' : 'P3';
  return [{
    key: 'discover',
    kind: 'discover',
    lane: 'discover',
    project: 'Projects',
    grade,
    priority: grade,
    title: 'find projects',
    effort: 'small',
    score: first ? FIRST_DISCOVERY_WORTH : REPEAT_DISCOVERY_WORTH,
    why: first ? 'nothing to work on yet' : 'daily look',
  }];
}

// A row runs among its project's priority, and each failed try moves it down one, so work that keeps failing cannot hold a band.
// Discovery has no project, so its own grade stands in.
const bandOf = entry => gradeBelow(entry.priority ?? entry.grade, entry.item?.attempts ?? 0);

// At P3 an item that keeps failing has no lower to go, so it comes round behind the others there.
// The sort is stable, so work of equal worth keeps the order it was filed in.
const byGrade = (left, right) => gradeRank(left.grade) - gradeRank(right.grade)
  || (left.item?.attempts ?? 0) - (right.item?.attempts ?? 0)
  || gradeRank(left.priority) - gradeRank(right.priority)
  || right.score - left.score
  || entryOrder.indexOf(left.kind) - entryOrder.indexOf(right.kind)
  || (left.item?.at ?? '').localeCompare(right.item?.at ?? '');

/** `max` work has limits of its own, because each run is the dearest there is. Without panes it runs on the normal harness, so Claude's limit says nothing about it. */
function maxWait({ mode, now, running, budget, panes }) {
  if (panes && mode.claudePause && Date.parse(mode.claudePause.until) > now) return 'Claude usage limit';
  const runningNow = running.filter(run => run.level === 'max').length;
  if (runningNow >= MAX_RUNS_AT_ONCE) return 'one max run at a time';
  return budget.maxRuns + runningNow >= MAX_RUNS_A_DAY ? `${MAX_RUNS_A_DAY} max runs a day` : null;
}

/** Only a row that can start holds another back. A skipped one stays where it is, and with auto-pick off only a pick ever starts, so waiting on anything else never ends. */
export const canStart = ({ autoPick }, row) => !row.skipped && !row.held && (autoPick || row.picked);

const needsItsStudy = (mode, entry, entries) => entry.unstudied && !entry.picked
  && entries.some(other => other.slug === entry.slug && other.kind === 'study' && canStart(mode, other));

// A started item goes before the rest of its project, so work already begun ends first. One that cannot start holds nothing back, and its own tree keeps its work meanwhile.
const behindItsStartedItem = (mode, entry, entries) => entry.kind === 'item' && entry.item.state !== 'doing'
  && entries.some(other => other.slug === entry.slug && other.item?.state === 'doing' && canStart(mode, other));

// With starts this quick, a row that fails every time would spend tokens on nothing all day. It waits longer after each try while everything else goes past it, and it always comes round.
export function retryAt({ item, picked }) {
  if (!item?.attempts || picked) return null;
  return Date.parse(item.updatedAt ?? item.at) + Math.min(item.attempts, MOST_TRIES_COUNTED) * WAIT_PER_TRY_MS;
}

function retryWait(entry, now) {
  const at = retryAt(entry);
  return at > now ? `tries again at ${lookTime(at, now)}` : null;
}

/** What the runs already going on a project hold back. Waiting keeps a run in the project's own folder. Small work is soon done, so it waits, and the rest takes a worktree. */
export function waitsOnItsProject(entry, here) {
  if (here.some(run => run.lane === entry.lane)) return entry.lane === 'do' ? 'one item at a time here' : 'a look is running here';
  return here.length > 0 && entry.effort === 'small' && !entry.urgent && !entry.picked ? 'another run here' : null;
}

/** Why this entry cannot start now, leaving out what stops the whole plan and the budget. */
function ownWait(entry, entries, context) {
  const { mode, running, now } = context;
  const here = running.filter(run => run.slug === entry.slug);
  if (entry.skipped) return 'skipped';
  if (entry.paused) return 'paused';
  if (entry.held) return 'shipping first';
  const retry = retryWait(entry, now);
  if (retry) return retry;
  if (needsItsStudy(mode, entry, entries)) return 'needs its study';
  const busy = waitsOnItsProject(entry, here);
  if (busy) return busy;
  if (behindItsStartedItem(mode, entry, entries)) return 'after its started item';
  return entry.level === 'max' ? maxWait(context) : null;
}

/** Projects with no run for a day and none going now. Every run leaves its mark in the token log, so one that was never in it counts too. */
function leftAlone({ root, now, running }) {
  const ranLately = new Set(tokenEvents(root).filter(({ at }) => now - Date.parse(at) < LEFT_ALONE_MS).map(({ slug }) => slug));
  return ({ slug }) => !ranLately.has(slug) && !running.some(run => run.slug === slug);
}

/** One row for each project left alone: its top one that can go. A P0 row is at the front already, and the rest are lifted only among their own priority. */
function liftedRows(mode, entries, isLeftAlone) {
  const canGo = entry => entry.slug && !entry.paused && !entry.skipped && !entry.held && !behindItsStartedItem(mode, entry, entries);
  const tops = entries.filter(canGo).filter((entry, index, rows) => rows.findIndex(row => row.slug === entry.slug) === index);
  return tops.filter(entry => isLeftAlone(entry) && !entry.picked && entry.grade !== 'P0');
}

/**
 * The user's picks go first in the order they were made, then P0 rows, then each project priority in turn, so a P2 or P3 project never
 * jumps a P1 one. Within a priority, a project left alone for a day goes first. What the user skipped stays in sight at the end.
 */
function inQueueOrder(mode, entries, isLeftAlone) {
  const lifted = liftedRows(mode, entries, isLeftAlone);
  const rest = entries.filter(entry => !entry.picked && !entry.skipped && !lifted.includes(entry));
  const inBand = band => entry => entry.grade !== 'P0' && bandOf(entry) === band;
  return [
    ...mode.queueNext.flatMap(key => entries.filter(entry => entry.key === key)),
    ...rest.filter(entry => entry.grade === 'P0'),
    ...grades.flatMap(band => [
      ...lifted.filter(inBand(band)).map(entry => ({ ...entry, why: plainList(['left alone', entry.why]) })),
      ...rest.filter(inBand(band)),
    ]),
    ...entries.filter(entry => entry.skipped && !entry.picked),
  ];
}

/** What a row waits on, with what stops the whole plan left to the pause. */
export const rowWait = ({ waiting }, free) => waiting ?? (free > 0 ? null : 'a free worker');

// Urgent work may pass the hour's share. A look is routine, however high it ranks.
export const skipsTheHour = entry => entry.grade === 'P0' && entry.kind !== 'look';

function budgetWait(entry, budget) {
  if (!fitsDay(budget, entry.estimate.fresh)) return 'over today\'s budget';
  return skipsTheHour(entry) || fitsHour(budget, entry.estimate.fresh) ? null : 'over this hour\'s share';
}

/**
 * A limit the plan cannot work around stops everything, and nothing but its own end or the user clears it. Work ahead of the subscription's pace
 * is asked about, never a stop by itself, because a pause hobkin forced was a block. A pause the user chose for it is theirs, and so is a stop.
 */
function hardStop({ mode, now }) {
  if (mode.pausedAt) return { kind: 'hand', line: 'Paused by hand. What is running finishes, and nothing new starts until hobkin work resume.' };
  const paused = mode.usagePause;
  if (paused && Date.parse(paused.until) > now) {
    const line = `Paused by a usage limit: ${paused.reason} It tries again at ${lookTime(paused.until, now)}.`;
    return { kind: 'usage', line, until: paused.until };
  }
  const chosen = mode.subscriptionPause;
  if (chosen && Date.parse(chosen.until) > now) {
    const line = `Paused until ${lookTime(chosen.until, now)} to protect the subscription, as you chose. hobkin work resume starts it sooner.`;
    return { kind: 'chosen', line, until: chosen.until };
  }
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

/** While a run is going each start waits the whole gap, however long the queue, so work spreads out instead of racing. With nothing running only a breath. */
export const startGap = ({ startGapMs }, running) => (running.length ? startGapMs : Math.min(startGapMs, SHORTEST_START_GAP_MS));

/**
 * One ranked list of everything that could run next. Pure code over what is on disk, so it spends no tokens and anyone can ask.
 * `running`, `checks` and `panes` come from the owner. Without them the list is what would run on an idle machine.
 */
export function planWork(root, { mode = readMode(root), now = Date.now(), running = [], checks = 0, lastStartAt = null, panes = true } = {}) {
  const budget = budgetFor(root, mode, now, running);
  const reading = readSubscription(root);
  const context = { root, mode, now, running, budget, reading, panes };
  const history = costHistory(root);
  const projects = chosenProjects(root).map(project => withPending(root, project));
  const shipping = shipFirst(readyItems(root, Infinity), mode, now);
  const sorted = [...discoveryEntry(context), ...projects.flatMap(project => projectEntries(context, project))]
    .map(entry => {
      const row = {
        ...entry,
        skipped: mode.queueSkipped.includes(entry.key),
        picked: mode.queueNext.includes(entry.key),
        estimate: estimateRun(history, { kind: entry.lane === 'do' ? 'do' : entry.kind, level: entry.level }),
      };
      return { ...row, held: shipping.holding && startsNewWork(row) };
    })
    .toSorted(byGrade);
  const ranked = inQueueOrder(mode, sorted, leftAlone(context));
  const entries = ranked.map(entry => {
    const own = ownWait(entry, ranked, context);
    return { ...entry, ownWait: own, waiting: own ?? budgetWait(entry, budget) };
  });

  const subscription = { known: Boolean(reading), windows: usageWindows(reading, now), ahead: aheadOfPace(reading, now) };
  const agents = subscription.known && mode.harness === 'pi' ? mode.agents : 1;
  const free = agents - running.length - checks;
  const startsAt = lastStartAt === null ? null : lastStartAt + startGap(mode, running);
  const stop = hardStop(context);
  const pause = stop ?? budgetPause(entries.filter(entry => !entry.skipped), budget, now);
  const spaced = startsAt !== null && startsAt > now;
  const waitingOn = checks && free <= 0 ? 'Scheduled checks are running, so nothing new starts until they finish.' : null;
  const first = entries.find(entry => !entry.waiting && (mode.autoPick || entry.picked));
  // A pick goes first, and it waits out the gap like any start, because two at once is the race the gap is there to stop.
  const next = stop || free <= 0 || spaced ? null : first ?? null;
  return {
    mode, entries, next, pause, budget, subscription, agents, free, waitingOn, shipFirst: shipping,
    nextStartAt: spaced ? new Date(startsAt).toISOString() : null,
  };
}
