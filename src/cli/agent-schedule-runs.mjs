import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from './config.mjs';
import { wakeOutput } from './agent-schedules.mjs';

/**
 * Each schedule's runs as its agent's conversation shows them in the window (the client's `_specs/056-agent-schedules`):
 * when each began and ended, how it ended, whether it woke the agent, and the last lines it printed. The store keeps a
 * schedule's newest ten runs for its own rules (`MOST_HISTORY`) and the newest run's output only, so this keeps more of
 * them, each with its own last lines, in a file of each schedule's own: a run writes its own schedule's file, not the
 * whole store. A schedule's file goes when the schedule leaves the store, a day after it ended.
 */

export const RUNS = join('runtime', 'agent-schedule-runs');
/**
 * The most runs kept of one schedule. hobkin runs a schedule once a minute at most, so two hundred keep over three
 * hours of the most frequent one and over six of a watch every two minutes, longer than the two hours a schedule lives
 * when its agent says nothing, while a schedule's file stays under about 300 KB.
 */
export const MOST_RUNS = 200;
/** What is kept of what one run printed: its last lines, as many as a command step shows before it opens further. */
export const TAIL_LINES = 12;
export const TAIL_CHARS = 1200;

// A schedule's id names its file, so only an id hobkin made does.
const ID = /^[\w-]{1,64}$/;
const CUT_OFF = 'It was cut off before it finished.';

const fileOf = (root, id) => join(root, RUNS, `${id}.json`);

/** The last lines of a run's output, with what went to stderr marked, as a wake carries it. */
export function outputTail(output) {
  const lines = wakeOutput(output).split('\n').slice(-TAIL_LINES).join('\n');
  return lines.length > TAIL_CHARS ? `…${lines.slice(-(TAIL_CHARS - 1))}` : lines;
}

/** One run as kept: its entry in the schedule's history, with the last lines it printed when it printed any. */
function keptRun(entry, output) {
  const tail = output ? outputTail(output) : '';
  return tail ? { ...entry, tail } : { ...entry };
}

/**
 * A schedule's history as runs. Its output is the newest run's that was not cut off, since a run cut off keeps the
 * output of the one before it.
 */
function fromHistory({ history = [], output }) {
  const owner = history.findLastIndex(entry => entry.outcome !== 'interrupted');
  return history.map((entry, index) => keptRun(entry, index === owner ? output : null));
}

function readRuns(root, id) {
  try {
    const stored = JSON.parse(readFileSync(fileOf(root, id), 'utf8'));
    return Array.isArray(stored?.runs) ? stored.runs : null;
  } catch {
    return null;
  }
}

/**
 * Keeps a schedule's newest run, the last of its history, with what it printed. A schedule with no file yet keeps its
 * history first, so the runs it had before are kept too. A file that cannot be written leaves the runs as they were:
 * this never throws.
 */
export function keepRun(root, schedule) {
  const newest = schedule.history?.at(-1);
  if (!newest || !ID.test(schedule.id)) return;
  const kept = readRuns(root, schedule.id);
  const output = newest.outcome === 'interrupted' ? null : schedule.output;
  const runs = kept ? [...kept, keptRun(newest, output)] : fromHistory(schedule);
  try {
    atomicJson(fileOf(root, schedule.id), { version: 1, runs: runs.slice(-MOST_RUNS) });
  } catch {
    // The store's own history still has the newest runs.
  }
}

/** A schedule's runs, oldest first: those its file keeps, or its history while it has no file. */
export function runsOf(root, schedule) {
  const kept = ID.test(schedule.id) ? readRuns(root, schedule.id) : null;
  return kept ?? fromHistory(schedule);
}

/** The files of schedules that left the store. One that cannot be removed is left. */
export function forgetRuns(root, ids) {
  for (const id of ids) {
    if (!ID.test(id)) continue;
    try {
      rmSync(fileOf(root, id), { force: true });
    } catch {
      // A file left behind holds one schedule's runs, and nothing reads it once its schedule is gone.
    }
  }
}

/**
 * A run in the protocol's words (`AgentScheduleRunRecord` in the client's `shared/protocol/schedules.ts`). The window
 * knows no `interrupted`, so a run a restart cut off is one that could not finish, with the line that says why.
 */
function runView(run) {
  const cutOff = run.outcome === 'interrupted';
  const line = cutOff ? CUT_OFF : run.line;
  return {
    at: run.at,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    outcome: cutOff ? 'error' : run.outcome,
    ...(run.exitCode === undefined ? {} : { exitCode: run.exitCode }),
    woke: run.woke === true,
    ...(line ? { line } : {}),
    ...(run.tail ? { tail: run.tail } : {}),
  };
}

/** A schedule with its runs, as its agent's conversation reads it (`AgentScheduleRuns` in the client's protocol). */
export function scheduleRunsView(schedule, runs) {
  return {
    id: schedule.id,
    name: schedule.name,
    does: schedule.command === undefined ? 'wake' : 'shell',
    ...(schedule.command === undefined ? {} : { command: schedule.command }),
    runs: runs.map(runView),
  };
}
