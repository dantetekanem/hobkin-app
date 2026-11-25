import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, loadConfig } from './config.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { reportTriage } from './reports.mjs';
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

const isClockTime = value => typeof value === 'string' && CLOCK_TIME.test(value);
const isCount = value => Number.isInteger(value) && value >= 1;
const statePath = home => join(home, 'runtime', 'catch-up.json');

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
    running: false,
    lastAt: readState(home).lastAt ?? null,
    uncovered: uncoveredReports(home, readLocalView(home).reports).length,
  };
}

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
