import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, loadConfig } from './config.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { reportText, reportTriage } from './reports.mjs';
import { fastBinding } from './short-reports.mjs';
import { reportReadStates, trackingSince } from './telemetry.mjs';
import { readLocalView } from './view.mjs';

/**
 * The reports catch-up (069-report-catch-up). When unread reports pile up, and once a day, hobkin writes one short
 * report over the unread reports no catch-up has covered yet: what happened, what is worth opening, and what looks not
 * useful or is usually skipped. The reports it covered count as caught up, which is not read. Both triggers are on by
 * default and kept in config.json under `catchUp`.
 */

/** The source of a catch-up's own reports, which no catch-up covers. */
export const CATCH_UP = 'catch-up';

const DEFAULTS = { daily: '08:00', pileUp: 8 };
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const BAD_TIME = 'The daily catch-up time is HH:MM on a 24-hour clock, such as 08:00.';
const BAD_COUNT = 'A pile-up is a whole number of reports, 1 or more.';

const TITLE = 'Catch-up';
// What a catch-up reads of a report with no short version.
const EXCERPT_CHARACTERS = 600;
// A prompt this size still fits the model with room to spare. A pile too big for it is covered newest first, over several catch-ups.
const MOST_MATERIAL_BYTES = 65536;
// A catch-up nobody waits for still should not hold a model for long.
const TIME_LIMIT_MS = 180000;
const NOTHING = 'Nothing to catch up on: every report is read or already in a catch-up.';
const ALREADY = 'hobkin is already writing a catch-up. Reports that came in since go in the next one.';
const NO_MODEL = 'hobkin has no fast model to write a catch-up with. Choose one for the fast tier in Settings.';

// The catch-up being written for each home, one at a time, until it has ended.
const writing = new Map();

const isClockTime = value => typeof value === 'string' && CLOCK_TIME.test(value);
const isCount = value => Number.isInteger(value) && value >= 1;
const statePath = home => join(home, 'runtime', 'catch-up.json');
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The two triggers as saved. One left out has its default, and one set to null is off. */
function settings(home) {
  const saved = loadConfig(home).catchUp ?? {};
  return {
    daily: saved.daily === null ? null : isClockTime(saved.daily) ? saved.daily : DEFAULTS.daily,
    pileUp: saved.pileUp === null ? null : isCount(saved.pileUp) ? saved.pileUp : DEFAULTS.pileUp,
  };
}

/** What hobkin keeps between starts: the local day the daily catch-up last came due, and when the last one finished. */
function readState(home) {
  try {
    const stat = lstatSync(statePath(home), { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > 4096) return {};
    const saved = JSON.parse(readFileSync(statePath(home), 'utf8'));
    return saved?.version === 1 ? saved : {};
  } catch {
    return {};
  }
}

const saidNothingNew = report => report.outcome === 'no_change'
  || reportTriage({ status: report.outcome, result: { text: report.body } })?.level === 'nothing';

/**
 * The listed reports a catch-up would cover, newest first: unread, from a run that finished since hobkin began to watch
 * reads, and neither one that said nothing new nor a catch-up of its own. Imported history never counts.
 */
export function uncoveredReports(home, reports) {
  const since = trackingSince(home);
  if (since === null) return [];
  const states = reportReadStates(home);
  return reports
    .filter(report => !states.has(report.id) && report.scheduleId !== CATCH_UP && report.outcome !== 'imported'
      && Date.parse(report.at) >= since && !saidNothingNew(report))
    .toSorted((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

/** The catch-up as the window shows it: both triggers, whether one is being written, when the last finished, and how many reports wait. */
export function readCatchUp(root) {
  const home = resolveDataRoot(root);
  return {
    ...settings(home),
    running: writing.has(home),
    lastAt: readState(home).lastAt ?? null,
    uncovered: uncoveredReports(home, readLocalView(home).reports).length,
  };
}

/** A report's triage line as it opens the report, or null when it has none. */
function triageLine(report) {
  const triage = reportTriage({ status: report.outcome, result: { text: report.body } });
  return triage?.message ? `${triage.level[0].toUpperCase()}${triage.level.slice(1)}: ${triage.message}` : null;
}

function excerpt(body) {
  const text = reportText(body);
  return text.length > EXCERPT_CHARACTERS ? `${text.slice(0, EXCERPT_CHARACTERS).trimEnd()}…` : text;
}

const given = report => ({
  id: report.id,
  title: report.title,
  routine: report.scheduleId ?? null,
  at: report.at,
  outcome: report.outcome,
  triage: triageLine(report),
  text: report.short ?? excerpt(report.body),
});

/** How the user treats each routine's latest reports, as `report-attention.json` keeps it, leaving out the catch-ups' own. */
function routineAttention(home) {
  try {
    const { schedules } = JSON.parse(readFileSync(join(home, 'runtime', 'report-attention.json'), 'utf8'));
    return schedules.filter(({ scheduleId }) => scheduleId !== CATCH_UP)
      .map(({ scheduleId, title, reports, read, nothingNew, critical, usd, ignored }) => ({ routine: scheduleId, title, reports, read, nothingNew, critical, usd, ignored }));
  } catch {
    return [];
  }
}

/** What one catch-up is given: the newest uncovered reports that fit, and each routine's attention numbers. */
function material(home, uncovered) {
  const routines = routineAttention(home);
  const reports = [];
  let bytes = Buffer.byteLength(JSON.stringify({ reports, routines }, null, 2));
  for (const report of uncovered) {
    const entry = given(report);
    const size = Buffer.byteLength(JSON.stringify(entry, null, 2)) + 8;
    if (reports.length && bytes + size > MOST_MATERIAL_BYTES) break;
    reports.push(entry);
    bytes += size;
  }
  return { reports, routines };
}

/**
 * Runs one catch-up as hobkin's own background run, on the fast tier with low effort, so it is listed in Reports like
 * any other. Only once it has finished with a report does each report it was given count as caught up.
 */
async function write(home, app, given, binding, trigger) {
  const id = `${CATCH_UP}:${randomUUID()}`;
  const harnessId = randomUUID();
  const jobs = join(home, 'jobs');
  mkdirSync(jobs, { recursive: true, mode: 0o700 });
  const prompt = JSON.stringify(given, null, 2);
  const { work } = app.runner.startTracked({
    id,
    kind: 'background',
    scheduleId: CATCH_UP,
    title: TITLE,
    ...(trigger === 'manual' ? { trigger } : {}),
    requestedAt: new Date(app.now()).toISOString(),
    harness: 'pi',
    model: binding.model,
    effort: 'low',
    cwd: home,
    harnessId,
  }, signal => app.runner.runHarness({
    id: harnessId,
    harness: 'pi',
    purpose: 'catch-up',
    model: binding.model,
    effort: 'low',
    cwd: home,
    prompt,
    sessionFile: join(jobs, `${harnessId}.jsonl`),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIME_LIMIT_MS)]),
  }));
  const ended = await work;
  if (ended?.status !== 'completed' || !ended.result?.text?.trim()) return;
  const at = app.now();
  app.telemetry.recordCaughtUp(given.reports.map(report => report.id), id, at);
  atomicJson(statePath(home), { ...readState(home), version: 1, lastAt: new Date(at).toISOString() });
  app.requestRefresh();
}

/**
 * Starts a catch-up now over the reports `app` lists, and says so in hobkin's words. With nothing to cover, with one
 * already being written, or with no fast model, it starts nothing and says why. `trigger` is `manual` for the user's or
 * an agent's ask, and `scheduled` for the daily time and a pile-up.
 */
export function startCatchUp(root, app, { trigger = 'manual' } = {}) {
  const home = resolveDataRoot(root);
  if (writing.has(home)) return { message: ALREADY };
  const covered = material(home, uncoveredReports(home, app.snapshot?.reports ?? readLocalView(home).reports));
  if (!covered.reports.length) return { message: NOTHING };
  let binding = null;
  try {
    binding = fastBinding(home);
  } catch {
    // A config that cannot be read has no model to ask.
  }
  if (!binding) return { message: NO_MODEL };
  // A catch-up that fails covers nothing, and the next trigger tries again.
  const run = write(home, app, covered, binding, trigger).catch(() => {}).finally(() => writing.delete(home));
  writing.set(home, run);
  return { message: `hobkin is writing a catch-up of ${plural(covered.reports.length, 'unread report')}. It shows in Reports when it is done, in about a minute.` };
}

/** Resolves once no catch-up is being written for this home. */
export const catchUpIdle = root => writing.get(resolveDataRoot(root)) ?? Promise.resolve();

/** The user's change to either trigger. A setting left out stays as it was, and null turns it off. */
export function setCatchUp(root, { daily, pileUp } = {}) {
  if (daily !== undefined && daily !== null && !isClockTime(daily)) throw Error(BAD_TIME);
  if (pileUp !== undefined && pileUp !== null && !isCount(pileUp)) throw Error(BAD_COUNT);
  const home = resolveDataRoot(root);
  const current = settings(home);
  const catchUp = { daily: daily === undefined ? current.daily : daily, pileUp: pileUp === undefined ? current.pileUp : pileUp };
  atomicJson(join(home, 'config.json'), { ...loadConfig(home), catchUp });
  return readCatchUp(home);
}
