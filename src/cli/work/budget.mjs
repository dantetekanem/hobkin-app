import { lookTime } from './chat.mjs';
import { dailyLimit, readProjects, tokenEvents, tokenLabel } from './store.mjs';

const HOUR_MS = 3600000;
// Any rolling hour may use a 12th of the day. A heavy real hour is 12 starts at about 550k each, or 6.6m, so at 100m a day
// this stops a runaway hour and leaves real work alone. A 24th would stop it. The subscription has its own guards in `usage.mjs`.
const HOURS_OF_WORK = 12;
const RECENT_RUNS = 12;
const ENOUGH_RUNS = 3;
const DAY_MS = 24 * HOUR_MS;

/**
 * The runs each priority starts by itself in any window this long, all its projects together, so a queue that never empties spreads over the days.
 * P0 starts whenever it is needed. A pick is the user's own word and closing work only lands what exists, so neither counts here.
 */
export const startBudgets = {
  P1: { runs: 4, withinMs: DAY_MS, period: 'today' },
  P2: { runs: 1, withinMs: DAY_MS, period: 'today' },
  P3: { runs: 1, withinMs: 7 * DAY_MS, period: 'this week' },
};

/** What a run costs before Hobkin has seen enough like it: a little over the worst of real sessions, in fresh and cached tokens. */
export const firstGuess = {
  discover: { fresh: 500000, cached: 10000000 },
  study: { fresh: 300000, cached: 2000000 },
  look: { fresh: 300000, cached: 2000000 },
  ideas: { fresh: 200000, cached: 1000000 },
  signals: { fresh: 200000, cached: 1000000 },
  watch: { fresh: 200000, cached: 1000000 },
  do: { fresh: 1000000, cached: 2500000 },
};

/** Real runs only. A guess for a pane nobody could measure must not teach the plan its own guess. */
export function costHistory(root) {
  const levelOf = new Map(readProjects(root).map(({ slug, level }) => [slug, level]));
  return tokenEvents(root)
    .filter(event => !event.estimated && event.tokens > 0)
    .map(({ kind, lane, level, slug, tokens, cached }) => ({ kind: kind ?? lane, level: level ?? levelOf.get(slug), tokens, cached }));
}

const upperQuartile = values => values.toSorted((left, right) => left - right)[Math.floor(values.length * 0.75)];

/** The upper quartile of recent runs like this one, because a plan that runs short is the one that overspends. */
export function estimateRun(history, { kind, level }) {
  const sameKind = history.filter(run => run.kind === kind);
  const similar = [sameKind.filter(run => run.level === level), sameKind].find(runs => runs.length >= ENOUGH_RUNS);
  const guess = firstGuess[kind];
  if (!similar) return guess;

  const recent = similar.slice(-RECENT_RUNS);
  const cached = recent.flatMap(run => (Number.isFinite(run.cached) ? [run.cached] : []));
  return { fresh: upperQuartile(recent.map(run => run.tokens)), cached: cached.length ? upperQuartile(cached) : guess.cached };
}

const totalOf = (list, field) => list.reduce((sum, entry) => sum + (entry[field] ?? 0), 0);
const sameDay = (left, right) => new Date(left).toDateString() === new Date(right).toDateString();

/** Where today stands. A running agent counts for what it has spent so far, and what it is still expected to spend is held for it. */
export function budgetFor(root, mode, now, running = []) {
  const limit = dailyLimit(mode, now);
  const events = tokenEvents(root);
  const today = events.filter(event => sameDay(event.at, now));
  const hour = events.filter(event => now - Date.parse(event.at) < HOUR_MS);
  const spending = totalOf(running, 'tokens');
  const reserved = running.reduce((sum, run) => sum + Math.max(0, (run.estimate?.fresh ?? 0) - (run.tokens ?? 0)), 0);
  return {
    limit,
    used: totalOf(today, 'tokens') + spending,
    cached: totalOf(today, 'cached') + totalOf(running, 'cached'),
    maxRuns: today.filter(event => event.level === 'max').length,
    hourShare: limit / HOURS_OF_WORK,
    hourUsed: totalOf(hour, 'tokens') + spending,
    hourEvents: hour,
    reserved,
  };
}

export const fitsDay = ({ limit, used, reserved }, fresh) => fresh <= limit - used - reserved;

/** An empty hour takes any run, or a low limit could never start one. */
export const fitsHour = ({ hourShare, hourUsed, reserved }, fresh) => fresh <= hourShare - hourUsed - reserved || hourUsed + reserved === 0;

/** When enough of this hour's tokens have aged out for a run of `fresh` tokens to fit. */
function hourFreesAt({ hourEvents, hourShare, hourUsed }, fresh, now) {
  let used = hourUsed;
  let at = now;
  for (const event of hourEvents.toSorted((left, right) => left.at.localeCompare(right.at))) {
    if (used + fresh <= hourShare) break;
    used -= event.tokens;
    at = Date.parse(event.at) + HOUR_MS;
  }
  return at;
}

export const dayLine = ({ used, limit }) => `Paused for today: ${tokenLabel(used)} of the ${tokenLabel(limit)} daily limit used. Resumes tomorrow.`;

export const hourShareOf = limit => limit / HOURS_OF_WORK;

/** A start counts while it is inside its priority's window. One for a priority with no budget never counts. */
const stillCounts = now => ({ at, priority }) => {
  const withinMs = startBudgets[priority]?.withinMs ?? 0;
  return now - Date.parse(at) < withinMs;
};

function spentWords(priority, { runs, period }) {
  const had = runs === 1 ? 'its run' : `its ${runs} runs`;
  return `${priority} has had ${had} ${period}`;
}

/** The priorities that have had all their runs inside their window at `now`, each with the words a row of theirs waits on. */
export function outOfStarts(starts, now) {
  const counting = starts.filter(stillCounts(now));
  const spent = {};
  for (const [priority, budget] of Object.entries(startBudgets)) {
    const had = counting.filter(start => start.priority === priority).length;
    if (had >= budget.runs) spent[priority] = spentWords(priority, budget);
  }
  return spent;
}

/** The starts that still count once this one is added, so the list is never longer than its windows. */
export function withStart(starts, priority, now) {
  const start = { at: new Date(now).toISOString(), priority };
  return [...starts, start].filter(stillCounts(now));
}

/** Always the limit that was really hit, with its real numbers. A daily figure alone reads as the day being gone. */
export function hourLine(budget, fresh, now) {
  const { used, limit, hourUsed, hourShare } = budget;
  const resumes = lookTime(hourFreesAt(budget, fresh, now), now);
  return `Paused for the hour: ${tokenLabel(hourUsed)} of the ${tokenLabel(hourShare)} hourly share used. Today ${tokenLabel(used)} of ${tokenLabel(limit)}. Resumes around ${resumes}.`;
}
