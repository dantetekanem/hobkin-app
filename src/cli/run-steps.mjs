import { readFileSync } from 'node:fs';
import { readVersioned } from './file-version.mjs';
import { JobActivity, MOST_OUTPUT, MOST_STEPS, outputText } from './job-activity.mjs';

/**
 * A run's steps read back from its saved Pi session (`jobs/<harnessId>.jsonl`), for what its live feed let go. Pi saves each message
 * when it ends, so the saved messages, in the order of the session's active branch, are the messages the feed saw. They go through the
 * feed's own reducer, so a saved step has the id, the words and the bounded output its live step had. Nothing here resumes a session.
 */

const SESSION_VERSIONS = new Set([2, 3]);
const object = value => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null);

/**
 * The entries of the session's active branch, oldest first, read as the client's saved-run reader reads them (host `job-session.ts`):
 * a session header first, then entries that each name their parent, followed back from the last one. A last line cut short by a
 * write still under way is left out. Anything else malformed is refused.
 */
function savedBranch(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const rows = new Map();
  let header = false;
  let last = null;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let row;
    try {
      row = object(JSON.parse(line));
    } catch {
      const cutShort = header && index === lines.length - 1 && !text.endsWith('\n');
      if (cutShort) break;
      throw Error('The saved run contains a malformed record.');
    }
    if (!header) {
      if (row?.type !== 'session' || !SESSION_VERSIONS.has(row.version) || typeof row.id !== 'string') throw Error('Unsupported Pi session format.');
      header = true;
      continue;
    }
    if (!row || typeof row.id !== 'string' || rows.has(row.id) || (row.parentId !== null && typeof row.parentId !== 'string')) {
      throw Error('The saved run has an invalid branch.');
    }
    rows.set(row.id, row);
    last = row.id;
  }
  if (!header) throw Error('Unsupported Pi session format.');

  const branch = [];
  const visited = new Set();
  for (let id = last; id !== null;) {
    const row = rows.get(id);
    if (!row || visited.has(id)) throw Error('The saved run has an incomplete or cyclic branch.');
    visited.add(id);
    branch.push(row);
    id = row.parentId;
  }
  return branch.reverse();
}

/** The message a saved entry holds, as Pi streamed it, or null for an entry that was never a message (a model change, a compaction). */
function streamedMessage(entry) {
  if (entry.type === 'message') return object(entry.message);
  if (entry.type !== 'custom_message') return null;
  const { customType, content, display, details } = entry;
  return { role: 'custom', customType, content, display, details };
}

const savedAt = entry => {
  const at = Date.parse(entry.timestamp ?? '');
  return Number.isFinite(at) ? at : entry.message?.timestamp;
};

/** Every step of the saved run, as its live feed would hold them with no limit on their number. */
function replay(file) {
  let at;
  const feed = new JobActivity({ mostOutput: MOST_OUTPUT, now: () => at });
  for (const entry of savedBranch(file)) {
    const message = streamedMessage(entry);
    if (!message) continue;
    at = savedAt(entry);
    // Pi ends a tool's run before it sends the tool's result as a message.
    if (message.role === 'toolResult') {
      feed.accept({
        type: 'tool_execution_end',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        isError: message.isError === true,
        result: { content: message.content, details: message.details },
      });
    }
    feed.accept({ type: 'message_start', message });
    feed.accept({ type: 'message_end', message });
  }
  return feed.snapshot();
}

// A run's page asks for several pages in a row, and the session grows while the run lasts, so its steps are kept per version.
const savedSteps = new Map();

/** Every step of a run's saved session, oldest first, frozen. Throws when the file is missing or is not a Pi session. */
export const runSteps = file => readVersioned(savedSteps, file, () => replay(file), 4);

/**
 * The `most` steps right before the step `before` (a feed entry id such as `tool:<call id>` or `message:<n>:<part>`), newest last, or
 * the newest `most` steps when `before` is null. A feed whose run shares its session with earlier turns can name a step the session
 * numbers differently: then `at`, the step's time in milliseconds, takes the steps saved before it. `more` says older steps remain,
 * and `found` whether the step it was asked about is there.
 */
export function runStepsBefore(file, { before = null, at = null, most = MOST_STEPS } = {}) {
  const steps = runSteps(file);
  let end = before === null ? steps.length : steps.findIndex(step => step.id === before);
  const found = end !== -1;
  if (!found && Number.isFinite(at)) end = steps.filter(step => step.at < at).length;
  if (end === -1) return { steps: [], more: false, found };
  const start = Math.max(0, end - most);
  return { steps: steps.slice(start, end), more: start > 0, found };
}

/** A tool step's whole output, as the feed reads it before keeping only its ends, and its length. Null when no such tool result is saved. */
export function runStepOutput(file, id) {
  const callId = typeof id === 'string' && id.startsWith('tool:') ? id.slice('tool:'.length) : null;
  if (!callId) return null;
  const result = savedBranch(file).map(streamedMessage).findLast(message => message?.role === 'toolResult' && message.toolCallId === callId);
  if (!result) return null;
  const output = outputText(result.content);
  return { id, output, length: output.length };
}
