import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOutcomeText } from './reports.mjs';

const OPENING = '<hobkin-hold>';
// A run from before the hold shows what the check could still do.
const RUNS_SHOWN = 3;
const TOOL_ERRORS_SHOWN = 6;
const MAX_REPORT_LENGTH = 2048;
const MAX_ERROR_LENGTH = 512;
// A turn that never finishes explained nothing, but it is not worth paying for without end.
const MAX_TURNS = 3;

export const isHoldBrief = text => text.startsWith(`${OPENING}\n`);

/** Receipts survive a restart, so a turn that finished is never repeated and one that was cut off is picked up. */
export function nextHoldTurn(holdId, runs) {
  const ids = Array.from({ length: MAX_TURNS }, (_, index) => `hold:${holdId}:${index + 1}`);
  const turns = runs.filter(run => ids.includes(run.id));
  if (turns.length === MAX_TURNS || turns.some(run => run.status === 'completed')) return null;
  return { id: ids[turns.length], resumed: turns.length > 0 };
}

/** Code mode reports a failed call in its details, and its own result can still read as a success. */
function errorsIn(message) {
  const failedCalls = (message.details?.calls ?? []).filter(call => call.error);
  if (failedCalls.length) return failedCalls.map(call => ({ tool: call.name, error: String(call.error) }));
  if (!message.isError) return [];

  const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  return [{ tool: message.toolName, error: text }];
}

function errorsInLine(line) {
  try {
    const { message } = JSON.parse(line);
    return message?.role === 'toolResult' ? errorsIn(message) : [];
  } catch {
    // A crash can cut the last line short.
    return [];
  }
}

function toolErrors(transcript) {
  let text;
  try {
    text = readFileSync(transcript, 'utf8');
  } catch {
    // A run that never reached Pi left no transcript.
    return [];
  }
  return text.split('\n')
    .filter(line => line.includes('"toolResult"'))
    .flatMap(errorsInLine)
    .slice(-TOOL_ERRORS_SHOWN)
    .map(({ tool, error }) => ({ tool, error: error.slice(0, MAX_ERROR_LENGTH) }));
}

function runDetails(root, run) {
  const transcript = join(root, 'jobs', `${run.harnessId}.jsonl`);
  return {
    finishedAt: run.finishedAt,
    trigger: run.trigger ?? 'scheduled',
    status: run.status,
    report: runOutcomeText(run).slice(0, MAX_REPORT_LENGTH),
    toolErrors: toolErrors(transcript),
    transcript,
  };
}

/**
 * What the main agent gets for a turn nobody typed. It stays out of Chat, and it holds what a check's own log leaves
 * out: the failing runs' reports and tool errors. Escaping `</` means a run's text can never end the block early.
 */
export function holdBrief(root, schedule, runs, { resumed = false } = {}) {
  const { id, title, path, nextRun } = schedule;
  const folder = join(root, 'checks', id);
  const latest = runs.filter(run => run.scheduleId === id && run.finishedAt)
    .toSorted((a, b) => a.finishedAt.localeCompare(b.finishedAt))
    .slice(-RUNS_SHOWN);
  const details = {
    scheduleId: id,
    title,
    reason: nextRun.reason,
    retriesAt: nextRun.at,
    scheduleFile: path,
    log: join(folder, 'log.md'),
    memory: join(folder, 'memory.md'),
    runs: latest.map(run => runDetails(root, run)),
    ...(resumed ? { resumed } : {}),
  };
  return `${OPENING}\n${JSON.stringify(details).replaceAll('</', '<\\/')}\n</hobkin-hold>`;
}
