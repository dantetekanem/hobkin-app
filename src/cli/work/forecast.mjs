import { existsSync } from 'node:fs';
import { costHistory, estimateRun, fitsDay, fitsHour, hourShareOf } from './budget.mjs';
import { lookTime } from './chat.mjs';
import {
  canStart, discoveryEntry, ideasEntry, lensEntry, MAX_RUNS_A_DAY, MAX_RUNS_AT_ONCE, retryAt, signalsEntry, skipsTheHour, startGap, startsNewWork, waitsOnItsProject, watchEntry,
} from './plan.mjs';
import { chosenProjects, dailyLimit, grades, lookEveryHours, paths, readState, tokenEvents } from './store.mjs';

export const FORECAST_HOURS = 8;
const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const RECENT_RUNS = 12;
const ENOUGH_RUNS = 3;
// How long a run takes before three like it have been timed. Real items have taken up to about a quarter hour, and looks a few minutes.
const firstGuessMs = { do: 15 * MINUTE_MS, discover: 15 * MINUTE_MS, look: 5 * MINUTE_MS };

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
    const recent = timed.filter(run => run.kind === kind).slice(-RECENT_RUNS).map(({ at, startedAt }) => Date.parse(at) - Date.parse(startedAt));
    return recent.length >= ENOUGH_RUNS ? middleOf(recent) : firstGuessMs[kind] ?? firstGuessMs.look;
  };
}

// The first minute in the window a rule holds. Each one only grows truer with time, so halving the window finds it in a few asks.
function firstDue(due, from, to) {
  if (!due(to)) return null;
  if (due(from)) return from;
  let [early, late] = [from, to];
  while (late - early > MINUTE_MS) {
    const middle = early + Math.ceil((late - early) / 2 / MINUTE_MS) * MINUTE_MS;
    [early, late] = due(middle) ? [early, middle] : [middle, late];
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
    rules.push(now => lensEntry(project, state, now, false), now => ideasEntry(project, state, { root, now, budget }), now => signalsEntry(project, state, { root, now }, false));
  }
  const known = new Set(entries.map(({ key }) => key));
  return rules.flatMap(rule => {
    const at = firstDue(rule, start, end - MINUTE_MS);
    const entry = at === null ? null : rule(at);
    return entry && !known.has(entry.key) ? [{ entry, at }] : [];
  });
}

function refused(row, busy, day, hour) {
  const maxFull = row.level === 'max' && (busy.filter(run => run.level === 'max').length >= MAX_RUNS_AT_ONCE || day.maxRuns >= MAX_RUNS_A_DAY);
  if (maxFull || waitsOnItsProject(row, busy.filter(run => run.slug === row.slug))) return 'pace';
  if (!fitsDay(day, row.estimate.fresh)) return 'day';
  return skipsTheHour(row) || fitsHour(hour, row.estimate.fresh) ? null : 'hour';
}

/** A minute at a time, as the owner's ticks go: the top row that can start does, while an agent is free, the gap between starts has passed and the budget allows it. */
function play({ plan: { mode, budget, agents }, queue, from, start, end, running, lengthOf, nextLook }) {
  const active = running.map(run => ({ ...run, until: Math.max(start + MINUTE_MS, (Date.parse(run.startedAt) || start) + lengthOf(run.kind ?? run.lane)) }));
  // What the last hour spent, and what each running agent is expected to spend in all, as the plan counts them.
  const spends = [...budget.hourEvents.map(({ at, tokens }) => ({ at: Date.parse(at), fresh: tokens })), ...running.map(run => ({ at: start, fresh: Math.max(run.tokens ?? 0, run.estimate?.fresh ?? 0) }))];
  let day = { limit: budget.limit, used: budget.used + budget.reserved, reserved: 0, maxRuns: budget.maxRuns + running.filter(run => run.level === 'max').length };
  // The budget is today's, so a stop that ends after midnight starts the next day with all of it.
  let [midnight, lastStart, why] = [nextMidnight(from), -Infinity, null];
  const [held, started] = [{ hour: 0, pace: 0 }, []];
  for (let at = start; at < end; at += MINUTE_MS) {
    if (at >= midnight) [day, midnight] = [{ limit: dailyLimit(mode, at), used: 0, reserved: 0, maxRuns: 0 }, nextMidnight(at)];
    const due = queue.filter(row => row.at <= at);
    if (!due.length) continue;
    const busy = active.filter(run => run.until > at);
    const hour = { hourShare: hourShareOf(day.limit), hourUsed: spends.reduce((sum, spend) => sum + (spend.at > at - HOUR_MS && spend.at <= at ? spend.fresh : 0), 0), reserved: 0 };
    const paced = busy.length >= agents || at - lastStart < startGap(mode, due.length, busy);
    const next = paced ? null : due.find(row => !refused(row, busy, day, hour));
    if (!next) {
      why = paced ? 'pace' : refused(due[0], busy, day, hour);
      held[why] = (held[why] ?? 0) + 1;
      continue;
    }
    queue.splice(queue.indexOf(next), 1);
    started.push(next);
    [lastStart, day.used, day.maxRuns] = [at, day.used + next.estimate.fresh, day.maxRuns + (next.level === 'max' ? 1 : 0)];
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
  return { started, limit: left ? (why === 'day' ? 'day' : held.hour > held.pace ? 'hour' : 'pace') : null };
}

/** One line, the same in the Work tab, the reply to start and the status. With the mode off it says what turning it on would start. */
function forecastLine({ jobs, grades: byGrade, agents, limit, until }, enabled, now) {
  // A time says only today or tomorrow, so one past the window goes unsaid.
  const when = until && Date.parse(until) - now <= FORECAST_HOURS * HOUR_MS ? ` until ${lookTime(until, now)}` : '';
  const why = {
    hand: 'Paused by hand until hobkin work resume.',
    usage: `Paused by a usage limit${when}.`,
    reserve: `Paused to protect the subscription${when}.`,
    day: 'The daily budget caps it.',
    hour: 'The hourly share caps it.',
    pace: 'More is due than fits.',
    ship: 'Shipping first holds new work.',
    picks: 'Auto-pick is off, so only picks start.',
  }[limit];
  const counts = [`about ${counted(jobs, 'job')}`, ...grades.filter(grade => byGrade[grade]).map(grade => `${byGrade[grade]} ${grade}`), `${counted(agents, 'agent')} at a time`];
  const said = jobs ? counts.join(' · ') : limit ? 'nothing starts' : 'nothing is due';
  return [`${enabled ? 'Next' : 'Turned on, next'} ${FORECAST_HOURS}h: ${said}.`, why].filter(Boolean).join(' ');
}

/**
 * About how many runs work mode starts in the next 8 hours, by grade, and what holds the number down. Pure code over what is on disk, so it spends no tokens.
 * It plays the plan forward: what is ready and what comes due goes to the agents in queue order, inside the budget and every stop.
 */
export function forecastWork(root, plan, { now = Date.now(), running = [] } = {}) {
  const { mode, pause, entries, agents } = plan;
  const from = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const end = from + FORECAST_HOURS * HOUR_MS;
  // Turning work mode on ends a pause by hand, so with it off only a limit that ends by itself holds anything.
  const stop = ['usage', 'reserve'].includes(pause?.kind) || (pause?.kind === 'hand' && mode.enabled) ? pause : null;
  // A usage limit gives its end as a date and the reserve as a number.
  const until = stop?.until ? new Date(stop.until).getTime() : null;
  const start = !stop ? from : until ? Math.max(from, Math.ceil(until / MINUTE_MS) * MINUTE_MS) : end;
  const ready = entries.filter(row => canStart(mode, row) && !row.paused);
  const history = costHistory(root);
  const projects = new Map(chosenProjects(root).filter(({ paused }) => !paused).map(project => [project.slug, project]));
  // What comes due later goes behind the user's picks and what is ready at its grade, the first due first.
  const rankOf = grade => ready.findLastIndex(row => row.picked || gradeRank(row.grade) <= gradeRank(grade)) + 0.5;
  const job = (entry, at) => ({ ...entry, at, rank: rankOf(entry.grade), estimate: estimateRun(history, { kind: runKind(entry), level: entry.level }) });
  const wanted = entry => mode.autoPick && !mode.queueSkipped.includes(entry.key) && !(plan.shipFirst.holding && startsNewWork(entry));
  // A look stamps its time as it starts, so the next on its project comes due a full pace later. A first study has a look straight after it.
  const nextLook = ({ slug, kind }, at) => {
    const project = projects.get(slug);
    if (!project || !['study', 'look'].includes(kind)) return null;
    const due = at + (kind === 'look' ? lookEveryHours(project) * HOUR_MS : 0);
    const entry = lensEntry(project, {}, due, false);
    return due < end && wanted(entry) ? job(entry, due) : null;
  };
  const queue = start >= end ? [] : [
    ...ready.map((row, rank) => ({ ...row, rank, at: Math.max(start, retryAt(row) ?? start) })),
    ...laterLooks(root, plan, projects.values(), { start, end, running }).filter(({ entry }) => wanted(entry)).map(({ entry, at }) => job(entry, at)),
  ].toSorted(byRank);
  const { started, limit } = play({ plan, queue, from, start, end, running, lengthOf: runLengths(root), nextLook });
  const counts = Object.fromEntries(grades.map(grade => [grade, started.filter(row => row.grade === grade).length]));
  const holds = stop?.kind ?? limit ?? (plan.shipFirst.holding ? 'ship' : mode.autoPick ? null : 'picks');
  const forecast = { hours: FORECAST_HOURS, jobs: started.length, grades: counts, agents, limit: holds, until: until && new Date(until).toISOString() };
  return { ...forecast, line: forecastLine(forecast, mode.enabled, now) };
}
