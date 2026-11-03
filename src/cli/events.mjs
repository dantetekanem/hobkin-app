import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
  if (run.kind === 'main') recordEvent(root, 'turn_finished', { id: run.id, status: run.status, stopReason: run.result?.stopReason, ms, limited });
  else recordEvent(root, 'run_finished', { ...runFacts(run), status: run.status, ms, usd: run.cost?.usd, tokens: run.result?.tokens, triage: reportTriage(run)?.level, limited });
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
// A person's day, because that is how anyone reads these.
const dayOf = ({ at }) => new Date(at).toLocaleDateString('en-CA');

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
