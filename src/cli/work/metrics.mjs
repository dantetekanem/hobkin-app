import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventsFolder } from '../events.mjs';
import { isRunId, proofsFolder, runFolder } from '../proof/record.mjs';
import { nameOf } from './names.mjs';
import { paths } from './store.mjs';

/**
 * Work in numbers (hobkin-client's _specs/053-work-control-room): what work mode did on each local day of a period, for
 * all projects together and for each project it took, folded from records hobkin already keeps, so the first read has
 * history. The client's host adds the AI reviews, which only it keeps, and answers `work.metrics` with this shape (its
 * `shared/protocol/metrics.ts`). Nothing here writes. A record that cannot be read is named in `gaps` and the rest
 * still counts. A file that does not exist yet holds nothing, so it is no gap.
 */

export const DAYS_DEFAULT = 30;
export const DAYS_MAX = 180;
/** The most decided changes one read lists (`DECIDED_MAX` in the client's contract). */
export const DECIDED_MAX = 500;
const OUTCOMES = { mergedByItself: 'merged-by-itself', mergedByYou: 'merged-by-you', declined: 'declined' };
const SHORT_SHA = 7;

// A change merges by itself only in YOLO mode. Every other route is the user's yes, wherever they gave it.
const BY_ITSELF = 'yolo';
// A finished change waits for the user as a local branch or a PR (`isFinished` in controls.mjs).
const FINISHED = ['branch', 'pr'];
// What a question about work answers (`DECISION_SOURCE` in telemetry/events.mjs, and the deploy question of deploys.mjs).
const WORK_QUESTIONS = ['work', 'merge', 'land', 'pair', 'pickup', 'subscription', 'deploy'];
// The director writes this when the user stops a run from the window.
const STOPPED = 'work_stopped';
const PROOF_COUNTS = { holds: 'proofsHold', broken: 'proofsBroken' };
const MONTH_FILE = /^\d{4}-\d{2}\.jsonl$/;
const DAY_MS = 86400000;
const COUNTS = [
  'started', 'finished', 'mergedByItself', 'mergedByYou', 'declined', 'sentBack', 'firstPass', 'reviewsSafe', 'reviewsRisky',
  'reviewsFailed', 'proofsHold', 'proofsBroken', 'questions', 'stops', 'tokens', 'regressed',
];

/** A person's day, as `YYYY-MM-DD`, the way `eventRollup` reads days. */
export const dayOf = time => new Date(time).toLocaleDateString('en-CA');

export const emptyDay = day => ({ day, ...Object.fromEntries(COUNTS.map(count => [count, 0])) });

/** The median and 90th percentile of what was measured, in whole milliseconds, or nulls with nothing measured. */
export function spanOf(durations) {
  const sorted = durations.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (!sorted.length) return { median: null, p90: null, count: 0 };
  const at = share => {
    const place = (sorted.length - 1) * share;
    const below = sorted[Math.floor(place)];
    return Math.round(below + (sorted[Math.ceil(place)] - below) * (place - Math.floor(place)));
  };
  return { median: at(0.5), p90: at(0.9), count: sorted.length };
}

/** The local days of the period that ends today, oldest first, and the local midnight it starts at. */
export function periodOf(days, now = Date.now()) {
  const count = Number.isInteger(days) ? Math.min(Math.max(days, 1), DAYS_MAX) : DAYS_DEFAULT;
  const today = new Date(now);
  const localDate = (back, hour) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, hour);
  // Noon is never skipped or doubled by a change of clocks.
  return { days: Array.from({ length: count }, (_, index) => dayOf(localDate(count - 1 - index, 12))), since: localDate(count - 1, 0).getTime() };
}

const capital = text => text.charAt(0).toUpperCase() + text.slice(1);

const parsed = line => {
  try {
    const record = JSON.parse(line);
    return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
  } catch {
    return null;
  }
};

function readText(file, label, gaps) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') gaps.push(`${capital(label)} could not be read, so nothing in it is counted.`);
    return null;
  }
}

function readFolder(folder, label, gaps) {
  try {
    return readdirSync(folder);
  } catch (error) {
    if (error.code !== 'ENOENT') gaps.push(`${capital(label)} could not be read, so nothing in it is counted.`);
    return [];
  }
}

/** A JSON-lines file's records, oldest first. A line that does not parse costs that line, and is named in `gaps`. */
function readRecords(file, label, gaps) {
  const text = readText(file, label, gaps);
  if (text === null) return [];
  const lines = text.split('\n');
  // The last line has no newline yet while an append is under way, so it counts once it is whole and is no gap before.
  const tail = parsed(lines.pop());
  const records = lines.filter(line => line.trim()).map(parsed);
  const bad = records.filter(record => !record).length;
  if (bad) gaps.push(`${bad === 1 ? 'A line' : `${bad} lines`} of ${label} could not be read, so ${bad === 1 ? 'it is' : 'they are'} not counted.`);
  return [...records.filter(Boolean), ...(tail ? [tail] : [])];
}

/** The counts of each day and what each span measured, for all projects and for each one listed. */
function tallyOf(days, slugs) {
  const place = new Map(days.map((day, index) => [day, index]));
  const fresh = () => ({ days: days.map(emptyDay), waitForYou: [], startToMerge: [] });
  const all = fresh();
  const projects = new Map(slugs.map(slug => [slug, fresh()]));
  const decided = [];
  /** Whether the time falls in the period, so a row is listed only where its day counts it. */
  const onDay = (time, slug, apply) => {
    const index = place.get(dayOf(time));
    if (index === undefined) return false;
    for (const series of [all, projects.get(slug)]) if (series) apply(series, index);
    return true;
  };
  const seriesOf = ({ days: counted, waitForYou, startToMerge }) => ({
    days: counted,
    // The AI reviews are the host's own, so their span is the host's to fill.
    spans: { waitForYou: spanOf(waitForYou), startToMerge: spanOf(startToMerge), aiReview: spanOf([]) },
  });
  return {
    count: (name, time, slug, amount = 1) => onDay(time, slug, (series, index) => { series.days[index][name] += amount; }),
    measure: (name, time, slug, ms) => {
      if (ms >= 0) onDay(time, slug, series => series[name].push(ms));
    },
    list: row => decided.push(row),
    all: () => seriesOf(all),
    project: slug => seriesOf(projects.get(slug)),
    // Newest first, and a sort keeps the order they came in when two share a time.
    decided: () => decided.toSorted((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, DECIDED_MAX),
  };
}

/** Each project by its slug, as its record stands after every line, the way the store folds them. */
function readProjectList(root, gaps) {
  const folded = new Map();
  for (const line of readRecords(join(root, 'work', 'projects.jsonl'), 'the list of projects (work/projects.jsonl)', gaps)) {
    if (typeof line.slug === 'string') folded.set(line.slug, { ...folded.get(line.slug), ...line });
  }
  return [...folded.values()];
}

/**
 * A yes or a no on a change, counted on its day and listed as a row there, so the two always agree. First pass is a yes
 * or no with no sending back before it. `head` is the commit a merge landed at.
 */
function decided(tally, slug, change, time, how, head = null) {
  const at = Date.parse(time);
  const sentBack = change.sentBack.filter(sent => sent < at).length;
  if (tally.count(how, time, slug)) {
    tally.list({ slug, item: change.id, title: change.title, at: time, outcome: OUTCOMES[how], sentBack, ...(head ? { head: head.slice(0, SHORT_SHA) } : {}) });
  }
  if (!sentBack) tally.count('firstPass', time, slug);
  if (how !== 'mergedByItself' && change.finishedAt) tally.measure('waitForYou', time, slug, at - Date.parse(change.finishedAt));
  if (how !== 'declined' && change.startedAt) tally.measure('startToMerge', time, slug, at - Date.parse(change.startedAt));
}

/**
 * One project's items, line by line, since a count needs each change of state and not only where it ended. Every way
 * the user answers writes here: a merge writes `landed` with its route, a no the declined state, and sending a finished
 * change back a pushback. The window's `done_*` events cover only its own keys, and each of those writes here too.
 */
function foldItems(records, slug, tally) {
  const changes = new Map();
  for (const line of records) {
    if (typeof line.id !== 'string') continue;
    const time = line.updatedAt ?? line.at;
    const known = changes.get(line.id);
    // Filing an item, or filing it again after a no, starts the change afresh. Its pushbacks and merges stay on the record.
    const filed = typeof line.key === 'string' && !line.updatedAt;
    const change = known && !filed
      ? known
      : { id: line.id, title: known?.title ?? line.id, state: null, pushbacks: known?.pushbacks ?? 0, merges: known?.merges ?? new Set(), sentBack: [], finishedAt: null, startedAt: null };
    changes.set(line.id, change);
    if (typeof line.title === 'string') change.title = line.title;

    const pushbacks = Array.isArray(line.pushbacks) ? line.pushbacks : [];
    // A no writes a pushback of its own, and only the others sent the change back for more work.
    for (const pushback of line.state === 'declined' ? [] : pushbacks.slice(change.pushbacks)) {
      tally.count('sentBack', pushback?.at, slug);
      change.sentBack.push(Date.parse(pushback?.at));
    }
    change.pushbacks = Math.max(change.pushbacks, pushbacks.length);

    if (typeof line.state === 'string' && line.state !== change.state) {
      // A do run marks its item doing as it starts.
      if (line.state === 'doing') change.startedAt ??= time;
      if (FINISHED.includes(line.state) && !FINISHED.includes(change.state)) {
        tally.count('finished', time, slug);
        change.finishedAt = time;
      }
      if (line.state === 'declined') decided(tally, slug, change, time, 'declined');
      change.state = line.state;
    }
    const { landed } = line;
    if (typeof landed?.at === 'string' && !change.merges.has(landed.at)) {
      change.merges.add(landed.at);
      const head = typeof landed.sha === 'string' && landed.sha ? landed.sha : null;
      decided(tally, slug, change, landed.at, landed.route === BY_ITSELF ? 'mergedByItself' : 'mergedByYou', head);
    }
  }
}

/** The events of every month file the period reaches into, oldest month first. */
function readEventsSince(root, since, gaps) {
  const folder = eventsFolder(root);
  // A file holds a month in UTC, as `recordEvent` names it.
  const first = new Date(since).toISOString().slice(0, 7);
  return readFolder(folder, 'the events (runtime/events)', gaps)
    .filter(name => MONTH_FILE.test(name) && name.slice(0, 7) >= first)
    .sort()
    .flatMap(name => readRecords(join(folder, name), `the events of ${name.slice(0, 7)} (runtime/events/${name})`, gaps));
}

/** The project a question is about, by its id, from the question's own record. One about no single project has none. */
function projectsAskedAbout(root, gaps) {
  const about = new Map();
  for (const line of readRecords(join(root, 'decisions.jsonl'), 'the questions (decisions.jsonl)', gaps)) {
    if (typeof line.id === 'string' && typeof line.answerTo?.slug === 'string') about.set(line.id, line.answerTo.slug);
  }
  return about;
}

function foldEvents(root, since, tally, gaps) {
  let about = null;
  for (const event of readEventsSince(root, since, gaps)) {
    // A run with a lane is work mode's. A routine's run has none.
    if (event.type === 'run_started' && event.lane) tally.count('started', event.at, event.project);
    if (event.type === STOPPED) tally.count('stops', event.at, event.project);
    if (event.type === 'decision_filed' && WORK_QUESTIONS.includes(event.source)) {
      about ??= projectsAskedAbout(root, gaps);
      tally.count('questions', event.at, about.get(event.id));
    }
  }
}

/** Each reading after a deploy that YOLO mode merged names what regressed. A change counts once, on the day it first showed. */
function foldLedger(root, tally, gaps) {
  const regressed = new Set();
  for (const line of readRecords(join(root, 'work', 'yolo.jsonl'), "YOLO mode's ledger (work/yolo.jsonl)", gaps)) {
    const change = `${line.slug}:${line.item}`;
    if (!line.after || !Array.isArray(line.regressed) || !line.regressed.length || regressed.has(change)) continue;
    regressed.add(change);
    tally.count('regressed', line.at, line.slug);
  }
}

/** Proof runs that ended holding or broken. A run's id starts with when it began, in UTC, so one begun well before the period is not read. */
function foldProofs(root, since, tally, gaps) {
  const earliest = new Date(since - DAY_MS).toISOString().slice(0, 10).replaceAll('-', '');
  for (const id of readFolder(proofsFolder(root), 'the proof runs (proofs)', gaps)) {
    if (!isRunId(id) || id.slice(0, 8) < earliest) continue;
    const label = `the proof run ${id} (proofs/${id}/result.json)`;
    // A run still going has no result yet.
    const text = readText(join(runFolder(root, id), 'result.json'), label, gaps);
    if (text === null) continue;
    const run = parsed(text);
    if (!run) {
      gaps.push(`${capital(label)} could not be read, so it is not counted.`);
      continue;
    }
    const count = PROOF_COUNTS[run.outcome];
    if (count) tally.count(count, run.finished ?? run.started, run.project);
  }
}

/**
 * What work mode did on each local day of the last `days` (30 unless asked, 180 at most) up to today, for all projects
 * and for each project work mode has taken. Every day of the period is there, with zeros where nothing happened. The
 * counts of AI reviews and their span stay at nothing: the host keeps those reviews and adds them. `decided` lists each
 * change merged or declined in the period, newest first, from the same records as the day counts.
 */
export function workMetrics(root, { days, now = Date.now() } = {}) {
  const gaps = [];
  const period = periodOf(days, now);
  const projects = readProjectList(root, gaps);
  const taken = projects.filter(({ state }) => state === 'chosen').toSorted((left, right) => nameOf(left).localeCompare(nameOf(right)));
  const tally = tallyOf(period.days, taken.map(({ slug }) => slug));

  // Every project ever chosen, because one dropped since still did what it did.
  for (const project of projects) {
    const { slug } = project;
    foldItems(readRecords(paths(root, slug).items, `${nameOf(project)}'s work items (work/${slug}/items.jsonl)`, gaps), slug, tally);
  }
  foldEvents(root, period.since, tally, gaps);
  for (const line of readRecords(join(root, 'work', 'tokens.jsonl'), 'the record of tokens (work/tokens.jsonl)', gaps)) {
    if (Number.isFinite(line.tokens)) tally.count('tokens', line.at, line.slug, line.tokens);
  }
  foldLedger(root, tally, gaps);
  foldProofs(root, period.since, tally, gaps);

  return {
    from: period.days[0],
    to: period.days.at(-1),
    at: new Date(now).toISOString(),
    all: tally.all(),
    projects: taken.map(project => ({ slug: project.slug, name: nameOf(project), ...tally.project(project.slug) })),
    gaps,
    decided: tally.decided(),
  };
}
