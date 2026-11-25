import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
// What each home's tick last saw: the settings by config.json's version, the local day the daily catch-up last came
// due, and the listed reports, so it knows when one finished.
const ticks = new Map();

const isClockTime = value => typeof value === 'string' && CLOCK_TIME.test(value);
const isCount = value => Number.isInteger(value) && value >= 1;
const statePath = home => join(home, 'runtime', 'catch-up.json');
// `hobkin reports catch-up` runs in another process and leaves this for the running hobkin's next tick.
const askedPath = home => join(home, 'runtime', 'catch-up-asked.json');
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A saved setting: null when it is off, and its default when it is missing or not one hobkin can use. */
function savedSetting(value, isValid, fallback) {
  if (value === null) return null;
  return isValid(value) ? value : fallback;
}

/** The two triggers as saved. One left out has its default, and one set to null is off. */
function settings(home) {
  const saved = loadConfig(home).catchUp ?? {};
  return {
    daily: savedSetting(saved.daily, isClockTime, DEFAULTS.daily),
    pileUp: savedSetting(saved.pileUp, isCount, DEFAULTS.pileUp),
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

const triageOf = report => reportTriage({ status: report.outcome, result: { text: report.body } });
const saidNothingNew = report => report.outcome === 'no_change' || triageOf(report)?.level === 'nothing';

/**
 * The listed reports a catch-up would cover, newest first: unread, from a run that finished since hobkin began to watch
 * reads, and neither one that said nothing new nor a catch-up of its own. Imported history never counts.
 */
export function uncoveredReports(home, reports) {
  const since = trackingSince(home);
  if (since === null) return [];

  const states = reportReadStates(home);
  const isUncovered = report => !states.has(report.id)
    && report.scheduleId !== CATCH_UP
    && report.outcome !== 'imported'
    && Date.parse(report.at) >= since
    && !saidNothingNew(report);
  return reports
    .filter(isUncovered)
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
  const triage = triageOf(report);
  if (!triage?.message) return null;

  const label = `${triage.level[0].toUpperCase()}${triage.level.slice(1)}`;
  return `${label}: ${triage.message}`;
}

function excerpt(body) {
  const text = reportText(body);
  if (text.length <= EXCERPT_CHARACTERS) return text;
  return `${text.slice(0, EXCERPT_CHARACTERS).trimEnd()}…`;
}

/** What a catch-up is told about one report it covers. */
const coveredEntry = report => ({
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
    return schedules
      .filter(({ scheduleId }) => scheduleId !== CATCH_UP)
      .map(({ scheduleId, title, reports, read, nothingNew, critical, usd, ignored }) => ({
        routine: scheduleId,
        title,
        reports,
        read,
        nothingNew,
        critical,
        usd,
        ignored,
      }));
  } catch {
    return [];
  }
}

/**
 * What one catch-up is given, as JSON: the newest uncovered reports whose entries fit the bound, at least one, and each
 * routine's attention numbers. Each entry costs its own bytes and the comma before the next.
 */
function catchUpMaterial(home, uncovered) {
  const routines = routineAttention(home);
  const reports = [];
  let bytes = Buffer.byteLength(JSON.stringify({ reports, routines }));
  for (const report of uncovered) {
    const entry = coveredEntry(report);
    const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (reports.length && bytes + size > MOST_MATERIAL_BYTES) break;

    reports.push(entry);
    bytes += size;
  }
  return { reports, routines };
}

/** The reports a finished catch-up covered count as caught up from now, and the window shows it. */
function coverReports(home, app, catchUpId, reports) {
  const at = app.now();
  app.telemetry.recordCaughtUp(reports.map(report => report.id), catchUpId, at);
  atomicJson(statePath(home), { ...readState(home), version: 1, lastAt: new Date(at).toISOString() });
  app.requestRefresh();
}

/**
 * Runs one catch-up as hobkin's own background run, on the fast tier with low effort, so it is listed in Reports like
 * any other. Only once it has finished with a report does each report it was given count as caught up.
 */
async function writeCatchUp(home, app, material, binding, trigger) {
  const id = `${CATCH_UP}:${randomUUID()}`;
  const harnessId = randomUUID();
  const jobs = join(home, 'jobs');
  mkdirSync(jobs, { recursive: true, mode: 0o700 });

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
    prompt: JSON.stringify(material),
    sessionFile: join(jobs, `${harnessId}.jsonl`),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIME_LIMIT_MS)]),
  }));

  const ended = await work;
  const wroteReport = ended?.status === 'completed' && Boolean(ended.result?.text?.trim());
  if (wroteReport) coverReports(home, app, id, material.reports);
}

/** The fast tier's model, or null when there is none or config.json cannot be read. */
function fastModel(home) {
  try {
    return fastBinding(home);
  } catch {
    return null;
  }
}

/**
 * Starts a catch-up now over the reports `app` lists, and says so in hobkin's words. With nothing to cover, with one
 * already being written, or with no fast model, it starts nothing and says why. `trigger` is `manual` for the user's or
 * an agent's ask, and `scheduled` for the daily time and a pile-up.
 */
export function startCatchUp(root, app, { trigger = 'manual' } = {}) {
  const home = resolveDataRoot(root);
  if (writing.has(home)) return { message: ALREADY };

  const listed = app.snapshot?.reports ?? readLocalView(home).reports;
  const material = catchUpMaterial(home, uncoveredReports(home, listed));
  if (!material.reports.length) return { message: NOTHING };

  const binding = fastModel(home);
  if (!binding) return { message: NO_MODEL };

  // A catch-up that fails covers nothing, and the next trigger tries again.
  const run = writeCatchUp(home, app, material, binding, trigger)
    .catch(() => {})
    .finally(() => writing.delete(home));
  writing.set(home, run);
  const count = plural(material.reports.length, 'unread report');
  return { message: `hobkin is writing a catch-up of ${count}. It shows in Reports when it is done, in about a minute.` };
}

/** Resolves once no catch-up is being written for this home. */
export const catchUpIdle = root => writing.get(resolveDataRoot(root)) ?? Promise.resolve();

/** The user's change to either trigger. A setting left out stays as it was, and null turns it off. */
export function setCatchUp(root, { daily, pileUp } = {}) {
  if (daily !== undefined && daily !== null && !isClockTime(daily)) throw Error(BAD_TIME);
  if (pileUp !== undefined && pileUp !== null && !isCount(pileUp)) throw Error(BAD_COUNT);
  const home = resolveDataRoot(root);
  const current = settings(home);
  const catchUp = {
    daily: daily === undefined ? current.daily : daily,
    pileUp: pileUp === undefined ? current.pileUp : pileUp,
  };
  atomicJson(join(home, 'config.json'), { ...loadConfig(home), catchUp });
  return readCatchUp(home);
}

/** An agent's or the user's ask from another process, for the running hobkin to start on its next tick. */
export function requestCatchUp(root) {
  const home = resolveDataRoot(root);
  const uncovered = uncoveredReports(home, readLocalView(home).reports).length;
  if (!uncovered) return { message: NOTHING };

  atomicJson(askedPath(home), { version: 1, at: new Date().toISOString() });
  const count = plural(uncovered, 'unread report');
  return { message: `Asked hobkin for a catch-up of ${count}. It starts within a second while hobkin runs, and shows in Reports when it is done.` };
}

/** Whether `hobkin reports catch-up` left an ask since the last look. Taking it removes it, so it is answered once. */
function takeAsk(home) {
  if (!lstatSync(askedPath(home), { throwIfNoEntry: false })) return false;
  rmSync(askedPath(home), { force: true });
  return true;
}

/** The settings, read again only once config.json has changed. */
function tickSettings(home, seen) {
  const stat = lstatSync(join(home, 'config.json'));
  const version = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if (seen.version !== version) Object.assign(seen, { version, settings: settings(home) });
  return seen.settings;
}

const twoDigits = number => String(number).padStart(2, '0');
const localDay = clock => `${clock.getFullYear()}-${twoDigits(clock.getMonth() + 1)}-${twoDigits(clock.getDate())}`;

/** Once its local time has come each day: a catch-up when anything is uncovered, and none when one is being written already. */
function tickDaily(home, app, daily, seen) {
  if (daily === null) return;

  const clock = new Date(app.now());
  const [hours, minutes] = daily.split(':').map(Number);
  const minuteNow = clock.getHours() * 60 + clock.getMinutes();
  if (minuteNow < hours * 60 + minutes) return;

  const today = localDay(clock);
  seen.dailyOn ??= readState(home).dailyOn ?? null;
  if (seen.dailyOn === today) return;
  seen.dailyOn = today;
  atomicJson(statePath(home), { ...readState(home), version: 1, dailyOn: today });
  if (!writing.has(home)) startCatchUp(home, app, { trigger: 'scheduled' });
}

/**
 * When a report has finished since the last look, a catch-up once the uncovered reports reach the pile size. A catch-up's
 * own report never counts as one finishing, so one that failed is not tried again until another report comes in.
 */
function tickPileUp(home, app, pileUp, seen) {
  const reports = app.snapshot?.reports;
  if (!Array.isArray(reports) || reports === seen.reports) return;

  const before = seen.ids;
  seen.reports = reports;
  seen.ids = new Set(reports.map(report => report.id));
  if (!before || pileUp === null || writing.has(home)) return;

  const finished = reports.some(report => !before.has(report.id) && report.scheduleId !== CATCH_UP);
  if (!finished) return;
  if (uncoveredReports(home, reports).length >= pileUp) startCatchUp(home, app, { trigger: 'scheduled' });
}

/**
 * The catch-up's part of hobkin's tick, each second: an ask left by `hobkin reports catch-up`, the daily time, and a
 * pile-up once a report has finished. The first look at the list only learns what is there. It never fails the tick.
 */
export function tickCatchUp(root, app) {
  const home = resolveDataRoot(root);
  const seen = ticks.get(home) ?? {};
  ticks.set(home, seen);
  try {
    if (takeAsk(home)) startCatchUp(home, app);
    const { daily, pileUp } = tickSettings(home, seen);
    tickDaily(home, app, daily, seen);
    tickPileUp(home, app, pileUp, seen);
  } catch {
    // The next tick looks again.
  }
}
