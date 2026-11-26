import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { deepFreeze, fileVersion } from './file-version.mjs';
import { JobActivity, MOST_OUTPUT, MOST_STEPS, outputText } from './job-activity.mjs';

/**
 * A run's steps read back from its saved Pi session (`jobs/<harnessId>.jsonl`), for what its live feed let go. Pi saves each message
 * when it ends, so the saved messages, in the order of the session's active branch, are the messages the feed saw. They go through the
 * feed's own reducer, so a saved step has the id, the words and the bounded output its live step had. Nothing here resumes a session.
 * A durable hobkin's turns share one conversation (`hobkins/<id>.jsonl`), so a turn is read between its start and its end.
 *
 * A session is parsed once per version of its file, and every turn's bounds are read from that one parse. Pi only adds lines to a
 * session, so a file that grew is parsed only for the lines it added, and each bounds' feed takes only what the branch added.
 */

const SESSION_VERSIONS = new Set([2, 3]);
const object = value => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null);

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

/** How many bytes, at a session's start and right before where its last read ended, tell a file written anew from one that grew. */
const MARK = 1024;
const NEWLINE = 0x0a;

/**
 * A saved session as far as its file has been read, as the client's saved-run reader reads it (host `job-session.ts`): a session header
 * first, then entries that each name their parent. Each entry is kept as a replay reads it: its id, its parent, the message it holds and
 * when it was saved. `replays` holds a feed for each of the bounds read lately.
 */
class SavedSession {
  header = false;
  entries = new Map();
  last = null;
  /** Where the read ended: after the last whole line, or after a last line that parsed whole with no newline yet (`unterminated`). */
  read = 0;
  unterminated = false;
  /** The file's first bytes and the bytes right before `read`, as the read found them. */
  start = Buffer.alloc(0);
  end = Buffer.alloc(0);
  /** The file's version when it was read, or null when a write overlapped the read, so the next read checks it again. */
  version = null;
  /** The active branch, oldest first, and the last entry it was followed back from. */
  branch = [];
  branchEnd = null;
  replays = new Map();

  constructor(device, inode) {
    this.device = device;
    this.inode = inode;
  }

  /** Takes one parsed line: the header first, then entries that each name their parent. Anything else malformed is refused. */
  take(row) {
    if (!this.header) {
      const supported = row?.type === 'session' && SESSION_VERSIONS.has(row.version) && typeof row.id === 'string';
      if (!supported) throw Error('Unsupported Pi session format.');
      this.header = true;
      return;
    }

    if (!row || typeof row.id !== 'string' || this.entries.has(row.id) || (row.parentId !== null && typeof row.parentId !== 'string')) {
      throw Error('The saved run has an invalid branch.');
    }
    const message = streamedMessage(row);
    this.entries.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      message,
      at: message ? savedAt(row) : undefined,
    });
    this.last = row.id;
  }

  /** Takes what the file open at `handle` holds after `read`, up to `size`. */
  takeFrom(handle, size) {
    const bytes = bytesBetween(handle, this.read, size);
    let taken = this.takeLines(bytes);
    const tookLastLine = this.takeUnterminated(bytes.toString('utf8', taken));
    if (tookLastLine) taken = bytes.length;
    this.advance(bytes, taken);
  }

  /** Takes each whole line of `bytes`, and says where the last of them ends. */
  takeLines(bytes) {
    let taken = 0;
    for (let newline = bytes.indexOf(NEWLINE); newline !== -1; newline = bytes.indexOf(NEWLINE, taken)) {
      const line = bytes.toString('utf8', taken, newline);
      if (line.trim()) this.take(parsedLine(line));
      taken = newline + 1;
      this.unterminated = false;
    }
    return taken;
  }

  /**
   * Takes a last line that has no newline yet when it parses whole, and says whether it did. One cut short by a write still under way
   * is left out, to be read again once it is whole; before the header it is malformed.
   */
  takeUnterminated(line) {
    if (!line.trim()) return false;
    let row;
    try {
      row = object(JSON.parse(line));
    } catch {
      if (!this.header) throw Error('The saved run contains a malformed record.');
      return false;
    }
    this.take(row);
    this.unterminated = true;
    return true;
  }

  /** Moves `read` past the first `taken` of `bytes`, keeping the file's first bytes and the bytes right before the new end. */
  advance(bytes, taken) {
    if (this.start.length < MARK) {
      const more = bytes.subarray(0, Math.min(taken, MARK - this.start.length));
      this.start = Buffer.concat([this.start, more]);
    }
    const before = Buffer.concat([this.end, bytes.subarray(Math.max(0, taken - MARK), taken)]);
    this.end = Buffer.from(before.subarray(-MARK));
    this.read += taken;
  }

  /** Whether the file open at `handle`, `size` bytes long now, is this one grown: the same file, holding what was read where it was. */
  grownTo(handle, { dev, ino }, size) {
    const sameFile = dev === this.device && ino === this.inode;
    if (!sameFile || size < this.read) return false;

    const holdsWhatWasRead = holds(handle, this.start, 0) && holds(handle, this.end, this.read - this.end.length);
    if (!holdsWhatWasRead) return false;

    // A last line read whole with no newline is whole only once the newline comes.
    return !this.unterminated || size === this.read || holds(handle, Buffer.of(NEWLINE), this.read);
  }

  /**
   * The entries of the active branch, oldest first, followed back from the last one. When the walk reaches the end of the branch read
   * before, the rest of the way is that branch, so a branch that only grew is walked only for what it added.
   */
  activeBranch() {
    if (this.branchEnd === this.last) return this.branch;

    const known = this.branch.at(-1);
    const added = [];
    const visited = new Set();
    let before = [];
    for (let id = this.last; id !== null;) {
      const entry = this.entries.get(id);
      if (!entry || visited.has(id)) throw Error('The saved run has an incomplete or cyclic branch.');
      if (entry === known) {
        before = this.branch;
        break;
      }
      visited.add(id);
      added.push(entry);
      id = entry.parentId;
    }

    this.branch = before.concat(added.reverse());
    this.branchEnd = this.last;
    return this.branch;
  }
}

/** A whole line of the session, parsed. One that is no JSON is a malformed record. */
function parsedLine(line) {
  try {
    return object(JSON.parse(line));
  } catch {
    throw Error('The saved run contains a malformed record.');
  }
}

/** The bytes of the file open at `handle` from `position` to `size`, or fewer when it was cut shorter meanwhile. */
function bytesBetween(handle, position, size) {
  const bytes = Buffer.allocUnsafe(size - position);
  let length = 0;
  while (length < bytes.length) {
    const got = readSync(handle, bytes, length, bytes.length - length, position + length);
    if (!got) break;
    length += got;
  }
  return bytes.subarray(0, length);
}

/** Whether the file open at `handle` has `bytes` at `position`. */
function holds(handle, bytes, position) {
  if (!bytes.length) return true;
  const there = Buffer.alloc(bytes.length);
  return readSync(handle, there, 0, bytes.length, position) === bytes.length && there.equals(bytes);
}

/** `file` read as a saved session, from where `kept` ended when the file only grew since, else whole. */
function readSession(file, kept) {
  const handle = openSync(file, 'r');
  try {
    const stat = fstatSync(handle, { bigint: true });
    const size = Number(stat.size);
    const session = kept?.grownTo(handle, stat, size) ? kept : new SavedSession(stat.dev, stat.ino);
    session.takeFrom(handle, size);
    if (!session.header) throw Error('Unsupported Pi session format.');
    return session;
  } finally {
    closeSync(handle);
  }
}

// A run's page asks for several pages in a row, a durable hobkin's page reads each of its turns with that turn's bounds, and the
// session grows while the run lasts. So the sessions read lately are kept, as many as fit in these bytes of their files.
const sessions = new Map();
const MOST_SESSIONS = 4;
const MOST_SESSION_BYTES = 96 * 2 ** 20;
const MOST_BOUNDS = 64;

/**
 * `file` as a saved session, read again only for what changed since its last read. A read that a write overlapped is checked again
 * the next time. Something there that is no regular file, such as a symlink, whose version cannot be told, is read whole and not kept.
 */
function sessionOf(file) {
  const version = fileVersion(file);
  const kept = sessions.get(file);
  sessions.delete(file);
  if (version !== null && kept?.version === version) {
    sessions.set(file, kept);
    return kept;
  }

  const session = readSession(file, version === null ? null : kept);
  if (version === null) return session;

  const unchangedWhileRead = version === fileVersion(file);
  session.version = unchangedWhileRead ? version : null;
  sessions.set(file, session);
  forgetOldSessions();
  return session;
}

/** Lets the sessions read least lately go while more are kept than fit, never the newest. */
function forgetOldSessions() {
  let bytes = 0;
  for (const { read } of sessions.values()) bytes += read;
  for (const [file, { read }] of sessions) {
    const fits = sessions.size <= MOST_SESSIONS && bytes <= MOST_SESSION_BYTES;
    if (fits || sessions.size === 1) break;
    sessions.delete(file);
    bytes -= read;
  }
}

/** Whether a message saved at `at` is between `since` and `until`, either of them open. One saved at no known time is in no bounds. */
const within = (at, since, until) => (since === null && until === null)
  || (Number.isFinite(at) && (since === null || at >= since) && (until === null || at <= until));

/**
 * A feed that replays a branch: how many of the branch's entries it took (`fed`), the last of them (`end`), and when the message it
 * takes now was saved (`at`), which is the feed's clock.
 */
function newReplay() {
  const replay = { fed: 0, end: undefined, at: undefined, feed: null };
  replay.feed = new JobActivity({ mostOutput: MOST_OUTPUT, now: () => replay.at });
  return replay;
}

/** The feed kept for `key` when what it took is the start of `branch`, else a new one. The bounds read least lately go first. */
function replayOf(session, key, branch) {
  const kept = session.replays.get(key);
  session.replays.delete(key);
  const tookStartOfBranch = kept && kept.fed <= branch.length && (kept.fed === 0 || branch[kept.fed - 1] === kept.end);
  const replay = tookStartOfBranch ? kept : newReplay();
  session.replays.set(key, replay);
  if (session.replays.size > MOST_BOUNDS) session.replays.delete(session.replays.keys().next().value);
  return replay;
}

/**
 * Every step of the saved run, as its live feed would hold them with no limit on their number, frozen. With bounds, only what was
 * saved from `since` to `until` is replayed, so the steps are numbered from there, as the turn's own feed numbered them. The feed kept
 * for these bounds takes only the entries the branch added since it last read it; a branch that changed otherwise is replayed anew.
 */
function replayed(session, since, until) {
  const branch = session.activeBranch();
  const replay = replayOf(session, `${since}:${until}`, branch);

  for (let index = replay.fed; index < branch.length; index++) {
    const { message, at } = branch[index];
    if (!message) continue;
    replay.at = at;
    if (!within(at, since, until)) continue;
    // Pi ends a tool's run before it sends the tool's result as a message.
    if (message.role === 'toolResult') {
      replay.feed.accept({
        type: 'tool_execution_end',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        isError: message.isError === true,
        result: { content: message.content, details: message.details },
      });
    }
    replay.feed.accept({ type: 'message_start', message });
    replay.feed.accept({ type: 'message_end', message });
  }

  replay.fed = branch.length;
  replay.end = branch.at(-1);
  return deepFreeze(replay.feed.snapshot());
}

const bound = value => (Number.isFinite(value) ? value : null);

/**
 * Every step of a run's saved session, oldest first, frozen. `since` and `until`, in milliseconds, bound a run that shares its
 * session with other turns: only what was saved between them is the run's. Throws when the file is missing or is not a Pi session.
 */
export function runSteps(file, { since = null, until = null } = {}) {
  return replayed(sessionOf(file), bound(since), bound(until));
}

/**
 * The `most` steps right before the step `before` (a feed entry id such as `tool:<call id>` or `message:<n>:<part>`), newest last, or
 * the newest `most` steps when `before` is null, of the run saved from `since` to `until` (`runSteps`). A feed whose run shares its
 * session with earlier turns can name a step the session numbers differently: then `at`, the step's time in milliseconds, takes the
 * steps saved before it. `more` says older steps remain, and `found` whether the step it was asked about is there.
 */
export function runStepsBefore(file, { before = null, at = null, since = null, until = null, most = MOST_STEPS } = {}) {
  const steps = runSteps(file, { since, until });
  let end = before === null ? steps.length : steps.findIndex(step => step.id === before);
  const found = end !== -1;
  if (!found && Number.isFinite(at)) end = steps.filter(step => step.at < at).length;
  if (end === -1) return { steps: [], more: false, found };

  const start = Math.max(0, end - most);
  return {
    steps: steps.slice(start, end),
    more: start > 0,
    found,
  };
}

/** A tool step's whole output, as the feed reads it before keeping only its ends, and its length. Null when no such tool result is saved. */
export function runStepOutput(file, id) {
  const callId = typeof id === 'string' && id.startsWith('tool:') ? id.slice('tool:'.length) : null;
  if (!callId) return null;
  const branch = sessionOf(file).activeBranch();
  const result = branch.findLast(({ message }) => message?.role === 'toolResult' && message.toolCallId === callId)?.message;
  if (!result) return null;
  const output = outputText(result.content);
  return { id, output, length: output.length };
}
