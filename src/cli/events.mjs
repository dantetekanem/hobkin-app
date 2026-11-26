import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { reportTriage } from './reports.mjs';
import { usageLimitIn } from './work/usage.mjs';

const KEPT_MONTHS = 6;
const MONTH_FILE = /^\d{4}-\d{2}\.jsonl$/;

export const eventsFolder = root => join(root, 'runtime', 'events');
const monthOf = time => new Date(time).toISOString().slice(0, 7);
const monthFiles = folder => readdirSync(folder).filter(name => MONTH_FILE.test(name)).sort();

function keepNewestMonths(folder) {
  for (const name of monthFiles(folder).slice(0, -KEPT_MONTHS)) rmSync(join(folder, name), { force: true });
}

/**
 * What happened in hobkin, for anyone asking later, and it never leaves this machine. Any process can append. The owner reads it once a day for its own failures and once a week for the review.
 * Facts only: ids, counts, durations, statuses, tones, moods, routine ids, project slugs and item ids. Nothing an agent or a person wrote.
 */
export function recordEvent(root, type, facts = {}, now = Date.now()) {
  try {
    const at = new Date(now).toISOString();
    const folder = eventsFolder(root);
    const file = join(folder, `${monthOf(now)}.jsonl`);
    const newMonth = !existsSync(file);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    appendFileSync(file, `${JSON.stringify({ at, type, ...facts })}\n`, { mode: 0o600 });
    if (newMonth) keepNewestMonths(folder);
  } catch {
    // Telemetry watches the product, so a write problem can never break it.
  }
}

/** A gap this long or longer is time away, so seeing the user after it is a return. */
export const AWAY_GAP_MS = 15 * 60000;
// A person's day, because that is how anyone reads these.
export const localDay = time => new Date(time).toLocaleDateString('en-CA');
const timeOf = value => (typeof value === 'number' ? value : Date.parse(value ?? ''));

/**
 * When the user is on, as facts: `first` for the first sighting on a local day, and `returned` after a gap of 15 minutes or more. The event
 * is at the moment they were seen again, and they left `awayMs` before it. A smaller gap records nothing. It returns what it recorded, or
 * null, so the caller can keep `seenAt` as when they were last here.
 */
export function recordPresence(root, { lastSeenAt, seenAt }) {
  const left = timeOf(lastSeenAt);
  const known = Number.isFinite(left) && seenAt >= left;
  const awayMs = known ? seenAt - left : undefined;
  const first = !Number.isFinite(left) || localDay(left) !== localDay(seenAt);
  if (!first && !(awayMs >= AWAY_GAP_MS)) return null;

  const facts = { kind: first ? 'first' : 'returned', ...(awayMs === undefined ? {} : { awayMs }) };
  recordEvent(root, 'presence', facts, seenAt);
  return facts;
}

const runFacts = ({ id, kind, work, scheduleId }) => ({ id, kind, lane: work?.lane, routine: scheduleId, project: work?.slug, item: work?.item });

// A limit is the provider saying stop, which says nothing about hobkin, and a routine's failure has only its error to show it. `undefined` leaves the fact out.
function hitLimit({ status, result, error }) {
  if (status !== 'failed') return undefined;
  const [said] = String(result?.error ?? error ?? '').split('\n', 1);
  return result?.usageLimit || usageLimitIn(said, 0) ? true : undefined;
}

/** A main run is a turn with the user, and a run is everything else. Steering joins a turn already under way, so it is neither. */
export function recordRunStarted(root, run) {
  if (run.parentRunId) return;
  if (run.kind === 'main') recordEvent(root, 'turn_started', { id: run.id });
  else recordEvent(root, 'run_started', runFacts(run));
}

export function recordRunFinished(root, run) {
  if (run.parentRunId) return;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  const limited = hitLimit(run);
  if (run.kind === 'main') {
    recordEvent(root, 'turn_finished', { id: run.id, status: run.status, stopReason: run.result?.stopReason, ms, limited });
    return;
  }
  const triage = reportTriage(run);
  recordEvent(root, 'run_finished', {
    ...runFacts(run),
    status: run.status,
    ms,
    usd: run.cost?.usd,
    tokens: run.result?.tokens,
    triage: triage?.level,
    // Only a report with a `Next:` counts as a call, so this says it has one and leaves its words out.
    next: triage?.next ? true : undefined,
    limited,
  });
}

function parseMonth(file) {
  if (!lstatSync(file).isFile()) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap(line => {
    try {
      const event = JSON.parse(line);
      return event?.type && Number.isFinite(Date.parse(event.at)) ? [event] : [];
    } catch {
      return [];
    }
  });
}

/** Oldest first. */
export function readEvents(root, { since = 0 } = {}) {
  const folder = eventsFolder(root);
  if (!lstatSync(folder, { throwIfNoEntry: false })?.isDirectory()) return [];
  return monthFiles(folder)
    .filter(name => name >= monthOf(since))
    .flatMap(name => parseMonth(join(folder, name)))
    .filter(({ at }) => Date.parse(at) >= since)
    .toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

const performanceCache = new Map();
export const PERFORMANCE_TAIL_BYTES = 262144;

/** A bounded fallback, not a complete history or accounting ledger. Unchanged tails are not reread. */
export function recentPerformanceEvents(root) {
  try {
    const folder = eventsFolder(root);
    const files = lstatSync(folder, { throwIfNoEntry: false })?.isDirectory() ? monthFiles(folder).slice(-2) : [];
    const entries = files.map(name => ({ file: join(folder, name), stat: lstatSync(join(folder, name)) }));
    const signature = JSON.stringify(entries.map(({ file, stat }) => [file, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]));
    if (performanceCache.get(root)?.signature === signature) return performanceCache.get(root).result;
    const events = new Map();
    let truncated = false;
    for (const { file, stat } of entries) {
      if (!stat.isFile()) throw Error('Not a regular event file');
      const start = Math.max(0, stat.size - PERFORMANCE_TAIL_BYTES);
      truncated ||= start > 0;
      const buffer = Buffer.alloc(Math.min(stat.size, PERFORMANCE_TAIL_BYTES));
      const fd = openSync(file, 'r');
      let bytes;
      try { bytes = readSync(fd, buffer, 0, buffer.length, start); } finally { closeSync(fd); }
      const lines = buffer.subarray(0, bytes).toString('utf8').split('\n');
      if (start) lines.shift();
      lines.pop(); // An append interrupted before its newline is not a settled event.
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event?.type !== 'run_performance') continue;
          const key = JSON.stringify([event.runId, event.sessionId]);
          if (!events.has(key)) events.set(key, event);
          if (events.size > 100) events.delete(events.keys().next().value);
        } catch { /* A broken line cannot hide subsequent complete events. */ }
      }
    }
    const result = { events: [...events.values()], state: 'available', truncated };
    performanceCache.delete(root);
    performanceCache.set(root, { signature, result });
    if (performanceCache.size > 8) performanceCache.delete(performanceCache.keys().next().value);
    return result;
  } catch {
    return { events: [], state: 'unavailable', truncated: true };
  }
}

const countsOf = values => {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};
const sumOf = (events, field) => events.reduce((sum, event) => sum + (event[field] ?? 0), 0);
const meanMs = events => {
  const timed = events.filter(({ ms }) => Number.isFinite(ms));
  return timed.length ? sumOf(timed, 'ms') / timed.length : null;
};
const dayOf = ({ at }) => localDay(at);

function runTotals(runs, nameOf) {
  const totals = {};
  for (const [name, own] of Map.groupBy(runs, nameOf)) {
    totals[name] = {
      runs: own.length,
      statuses: countsOf(own.map(({ status }) => status)),
      triage: countsOf(own.flatMap(({ triage }) => triage ?? [])),
      usd: sumOf(own, 'usd'),
      tokens: sumOf(own, 'tokens'),
      meanMs: meanMs(own),
    };
  }
  return totals;
}

/** Nothing here but sums, so anything that holds events can be asked about them. */
export function eventRollup(events) {
  const ofType = (...types) => events.filter(({ type }) => types.includes(type));
  const count = (...types) => ofType(...types).length;
  // A run in a pane is counted after it has ended, so its figure arrives as an event of its own.
  const counted = new Map(ofType('run_tokens').map(({ id, tokens }) => [id, tokens]));
  const runs = ofType('run_finished').map(run => ({ ...run, tokens: counted.get(run.id) || run.tokens }));
  const answered = ofType('question_ended').filter(({ how }) => how === 'answered');

  return {
    events: events.length,
    from: events[0]?.at ?? null,
    to: events.at(-1)?.at ?? null,
    byType: countsOf(events.map(({ type }) => type)),
    byDay: Object.fromEntries([...Map.groupBy(events, dayOf)].map(([day, own]) => [day, countsOf(own.map(({ type }) => type))])),
    routines: runTotals(runs.filter(({ project }) => !project), ({ routine }) => routine),
    projects: runTotals(runs.filter(({ project }) => project), ({ project }) => project),
    meanMs: {
      turn: meanMs(ofType('turn_finished')),
      run: meanMs(runs),
      question: meanMs(ofType('question_ended')),
      decision: meanMs(ofType('decision_answered')),
      report: meanMs(ofType('report_read')),
      donePage: meanMs(ofType('done_page')),
    },
    reached: {
      notices: count('notice_posted'),
      questions: count('question_shown'),
      decisions: count('decision_filed'),
      donePages: count('done_page'),
    },
    acted: {
      reports: new Set(ofType('report_read', 'report_messaged').map(({ id }) => id)).size,
      questions: answered.length,
      decisions: count('decision_answered'),
      merged: count('done_merged'),
      declined: count('done_declined'),
      sentBack: count('done_sent_back'),
    },
  };
}
