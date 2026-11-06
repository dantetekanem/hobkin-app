import { existsSync } from 'node:fs';
import { costHistory, estimateRun, fitsDay, fitsHour, hourShareOf, outOfStarts, withStart } from './budget.mjs';
import { lookTime } from './chat.mjs';
import {
  canStart, countsAgainst, discoveryEntry, ideasEntry, lensEntry, MAX_RUNS_A_DAY, MAX_RUNS_AT_ONCE, retryAt, signalsEntry, skipsTheHour, startBudgetWait, startGap,
  startsNewWork, waitsOnItsProject, watchEntry,
} from './plan.mjs';
import { chosenProjects, dailyLimit, grades, lookEveryHours, paths, readState, tokenEvents } from './store.mjs';

export const FORECAST_HOURS = 8;
const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const RECENT_RUNS = 12;
const ENOUGH_RUNS = 3;
// How long a run takes before three like it have been timed. Over 157 real runs measured on 2026-11-03, the middle item took about 10 minutes and the middle look about 4. Discovery had no measure.
const firstGuessMs = { do: 10 * MINUTE_MS, discover: 15 * MINUTE_MS, look: 4 * MINUTE_MS };

const runKind = ({ lane, kind }) => (lane === 'do' ? 'do' : kind);
const gradeRank = grade => grades.indexOf(grade);
const middleOf = values => values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)];
const byRank = (left, right) => left.rank - right.rank || left.at - right.at;
const nextMidnight = time => new Date(time).setHours(24, 0, 0, 0);
const counted = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The middle of the last few runs of each kind. The token record a run leaves as it ends says when it began, and every reader has that file already.
 * The runtime's own records hold both times too, but only an open owner can read them, and the event log is too big to read on every tick.
 */
function runLengths(root) {
  const timed = tokenEvents(root).filter(({ startedAt }) => startedAt);
  return kind => {
    const recent = timed
      .filter(run => run.kind === kind)
      .slice(-RECENT_RUNS)
      .map(({ at, startedAt }) => Date.parse(at) - Date.parse(startedAt));
    if (recent.length >= ENOUGH_RUNS) return middleOf(recent);
    return firstGuessMs[kind] ?? firstGuessMs.look;
  };
}

// The first minute in the window a rule holds. Each one only grows truer with time, so halving the window finds it in a few asks.
function firstDue(rule, from, to) {
  if (!rule(to)) return null;
  if (rule(from)) return from;

  let early = from;
  let late = to;
  while (late - early > MINUTE_MS) {
    const middle = early + Math.ceil((late - early) / 2 / MINUTE_MS) * MINUTE_MS;
    if (rule(middle)) late = middle;
    else early = middle;
  }
  return late;
}

/** The looks that come due later in the window, by the plan's own rules. One due now is in the plan already, and the look after it comes from the playing. */
function laterLooks(root, { mode, budget, entries }, projects, { start, end, running }) {
  const rules = [now => discoveryEntry({ root, mode, now, running })[0]];
  for (const project of projects) {
    const state = readState(root, project.slug);
    rules.push(now => watchEntry(project, state, { root, now }, false));
    if (!existsSync(paths(root, project.slug).project)) continue;

    rules.push(
      now => lensEntry(project, state, now, false),
      now => ideasEntry(project, state, { root, now, budget }),
      now => signalsEntry(project, state, { root, now }, false),
    );
  }

  const known = new Set(entries.map(({ key }) => key));
  return rules.flatMap(rule => {
    const at = firstDue(rule, start, end - MINUTE_MS);
    const entry = at === null ? null : rule(at);
    return entry && !known.has(entry.key) ? [{ entry, at }] : [];
  });
}

/** Why a row cannot start this minute, or null when it can. A priority that has had its runs holds its rows whatever the hour has left. */
function refused(row, { mode, busy, day, hour, spent }) {
  const maxRunning = busy.filter(run => run.level === 'max').length;
  const maxFull = row.level === 'max' && (maxRunning >= MAX_RUNS_AT_ONCE || day.maxRuns >= MAX_RUNS_A_DAY);
  const projectBusy = waitsOnItsProject(row, busy.filter(run => run.slug === row.slug));
  if (maxFull || projectBusy) return 'pace';
  if (!fitsDay(day, row.estimate.fresh)) return 'day';
  if (startBudgetWait({ mode, spent }, row)) return 'priority';
  if (skipsTheHour(row) || fitsHour(hour, row.estimate.fresh)) return null;
  return 'hour';
}

const spentInTheHourTo = (spends, at) => spends
  .filter(spend => spend.at > at - HOUR_MS && spend.at <= at)
  .reduce((sum, spend) => sum + spend.fresh, 0);

// What held the most minutes back. A tie goes to the agents' pace and then the hour, as it did before priorities had runs to spend.
const mostHeld = held => ['pace', 'hour', 'priority'].reduce((most, kind) => (held[kind] > held[most] ? kind : most));

/**
 * A minute at a time, as the owner's ticks go: the top row that can start does, while an agent is free, the gap between starts has passed and the budget allows it.
 * A row that starts by itself spends its priority's runs, and a run had long enough ago gives its place back, inside the window too.
 */
function play({ plan: { mode, budget, agents }, queue, from, start, end, running, lengthOf, nextLook }) {
  const active = running.map(run => ({
    ...run,
    until: Math.max(start + MINUTE_MS, (Date.parse(run.startedAt) || start) + lengthOf(run.kind ?? run.lane)),
  }));
  // What the last hour spent, and what each running agent is expected to spend in all, as the plan counts them.
  const spends = [
    ...budget.hourEvents.map(({ at, tokens }) => ({ at: Date.parse(at), fresh: tokens })),
    ...running.map(run => ({ at: start, fresh: Math.max(run.tokens ?? 0, run.estimate?.fresh ?? 0) })),
  ];
  let day = {
    limit: budget.limit,
    used: budget.used + budget.reserved,
    reserved: 0,
    maxRuns: budget.maxRuns + running.filter(run => run.level === 'max').length,
  };
  // The budget is today's, so a stop that ends after midnight starts the next day with all of it.
  let midnight = nextMidnight(from);
  let lastStart = -Infinity;
  let counted = mode.countedStarts;
  let why = null;
  const held = { hour: 0, pace: 0, priority: 0 };
  const started = [];

  for (let at = start; at < end; at += MINUTE_MS) {
    if (at >= midnight) {
      day = { limit: dailyLimit(mode, at), used: 0, reserved: 0, maxRuns: 0 };
      midnight = nextMidnight(at);
    }
    const due = queue.filter(row => row.at <= at);
    if (!due.length) continue;

    const busy = active.filter(run => run.until > at);
    const hour = { hourShare: hourShareOf(day.limit), hourUsed: spentInTheHourTo(spends, at), reserved: 0 };
    const limits = { mode, busy, day, hour, spent: outOfStarts(counted, at) };
    const paced = busy.length >= agents || at - lastStart < startGap(mode, busy);
    const next = paced ? null : due.find(row => !refused(row, limits));
    if (!next) {
      why = paced ? 'pace' : refused(due[0], limits);
      held[why] = (held[why] ?? 0) + 1;
      continue;
    }

    queue.splice(queue.indexOf(next), 1);
    started.push(next);
    lastStart = at;
    const priority = countsAgainst(next);
    if (priority) counted = withStart(counted, priority, at);
    day.used += next.estimate.fresh;
    if (next.level === 'max') day.maxRuns += 1;
    spends.push({ at, fresh: next.estimate.fresh });
    active.push({ slug: next.slug, lane: next.lane, level: next.level, until: at + lengthOf(runKind(next)) });

    const look = nextLook(next, at);
    if (look) {
      queue.push(look);
      queue.sort(byRank);
    }
  }

  // What came due in the last hour and has not come round yet holds nothing down.
  const left = queue.some(row => row.at <= end - HOUR_MS);
  if (!left) return { started, limit: null };
  if (why === 'day') return { started, limit: 'day' };
  return { started, limit: mostHeld(held) };
}

// Turning work mode on ends a pause by hand, so with it off only a limit that ends by itself holds anything.
function stopThatHolds(pause, mode) {
  if (['usage', 'chosen'].includes(pause?.kind)) return pause;
  return pause?.kind === 'hand' && mode.enabled ? pause : null;
}

/** The first minute anything can start: now, when the stop ends, or never in this window for a stop with no end. */
function firstStart(stop, until, from, end) {
  if (!stop) return from;
  if (!until) return end;
  return Math.max(from, Math.ceil(until / MINUTE_MS) * MINUTE_MS);
}

/** What holds the number down, the strongest first. */
function holdOf(stop, limit, { shipFirst, mode }) {
  if (stop) return stop.kind;
  if (limit) return limit;
  if (shipFirst.holding) return 'ship';
  return mode.autoPick ? null : 'picks';
}

/** One line, the same in the Work tab, the reply to start and the status. It counts as if the mode were on, and the status says whether it is. */
function forecastLine({ jobs, grades: byGrade, agents, limit, until }, now) {
  // A time says only today or tomorrow, so one past the window goes unsaid.
  const when = until && Date.parse(until) - now <= FORECAST_HOURS * HOUR_MS ? ` until ${lookTime(until, now)}` : '';
  // Shipping first has a line of its own wherever this one shows, so it adds no sentence here.
  const why = {
    hand: 'Paused by hand until hobkin work resume.',
    usage: `Paused by a usage limit${when}.`,
    chosen: `Paused to protect the subscription${when}, as you chose.`,
    day: 'The daily budget caps it.',
    hour: 'The hourly share caps it.',
    priority: 'The pace by priority caps it.',
    pace: 'More is due than fits.',
    picks: 'Auto-pick is off, so only picks and work on finished branches start.',
  }[limit];
  const counts = [
    `about ${counted(jobs, 'job')}`,
    ...grades.filter(grade => byGrade[grade]).map(grade => `${byGrade[grade]} ${grade}`),
    `${counted(agents, 'agent')} at a time`,
  ];
  const nothing = limit ? 'nothing starts' : 'nothing is due';
  const said = jobs ? counts.join(' · ') : nothing;
  return [`Next ${FORECAST_HOURS}h: ${said}.`, why].filter(Boolean).join(' ');
}

/**
 * About how many runs work mode starts in the next 8 hours, by grade, and what holds the number down. Pure code over what is on disk, so it spends no tokens.
 * It plays the plan forward: what is ready and what comes due goes to the agents in queue order, inside the budget and every stop.
 */
export function forecastWork(root, plan, { now = Date.now(), running = [] } = {}) {
  const { mode, pause, entries, agents } = plan;
  const from = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const end = from + FORECAST_HOURS * HOUR_MS;
  const stop = stopThatHolds(pause, mode);
  const until = stop?.until ? new Date(stop.until).getTime() : null;
  const start = firstStart(stop, until, from, end);

  const ready = entries.filter(row => canStart(mode, row) && !row.paused);
  const history = costHistory(root);
  const projects = new Map(chosenProjects(root).filter(({ paused }) => !paused).map(project => [project.slug, project]));
  // What comes due later goes behind the user's picks and what is ready at its grade, the first due first.
  const rankOf = grade => ready.findLastIndex(row => row.picked || gradeRank(row.grade) <= gradeRank(grade)) + 0.5;
  const job = (entry, at) => ({
    ...entry,
    at,
    rank: rankOf(entry.grade),
    estimate: estimateRun(history, { kind: runKind(entry), level: entry.level }),
  });
  const wanted = entry => mode.autoPick && !mode.queueSkipped.includes(entry.key) && !(plan.shipFirst.holding && startsNewWork(entry));
  // A look stamps its time as it starts, so the next on its project comes due a full pace later. A first study has a look straight after it.
  const nextLook = ({ slug, kind }, at) => {
    const project = projects.get(slug);
    if (!project || !['study', 'look'].includes(kind)) return null;
    const due = at + (kind === 'look' ? lookEveryHours(project) * HOUR_MS : 0);
    const entry = lensEntry(project, {}, due, false);
    return due < end && wanted(entry) ? job(entry, due) : null;
  };

  const nothingStarts = start >= end;
  const readyJobs = nothingStarts ? [] : ready.map((row, rank) => ({ ...row, rank, at: Math.max(start, retryAt(row) ?? start) }));
  const comingJobs = nothingStarts ? [] : laterLooks(root, plan, projects.values(), { start, end, running })
    .filter(({ entry }) => wanted(entry))
    .map(({ entry, at }) => job(entry, at));
  const queue = [...readyJobs, ...comingJobs].toSorted(byRank);
  const { started, limit } = play({ plan, queue, from, start, end, running, lengthOf: runLengths(root), nextLook });

  const forecast = {
    hours: FORECAST_HOURS,
    jobs: started.length,
    grades: Object.fromEntries(grades.map(grade => [grade, started.filter(row => row.grade === grade).length])),
    agents,
    limit: holdOf(stop, limit, plan),
    until: until === null ? null : new Date(until).toISOString(),
  };
  return { ...forecast, line: forecastLine(forecast, now) };
}

// The dashboard asks for its status every second, and the forecast plays the window a minute at a time, so within a minute only what it counts can change it.
const lastForecasts = new Map();

/** The forecast for a caller that asks often: worked out again with each new minute, or as soon as the mode, the queue or what is running changes. */
export function forecastEachMinute(root, plan, { now = Date.now(), running = [] } = {}) {
  const key = JSON.stringify([
    Math.floor(now / MINUTE_MS),
    plan.mode,
    plan.pause,
    plan.shipFirst.holding,
    plan.agents,
    plan.entries.map(({ key: row, grade, waiting }) => [row, grade, waiting]),
    running.map(({ id, startedAt }) => [id, startedAt]),
  ]);
  const last = lastForecasts.get(root);
  if (last?.key === key) return last.forecast;

  const forecast = forecastWork(root, plan, { now, running });
  lastForecasts.set(root, { key, forecast });
  return forecast;
}
