import { randomUUID } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Which of hobkin's memories agents read (075-chief-of-staff): each recall that gave a memory whole, and each index
 * built for a prompt that listed it, by who read it: the main chat, a durable hobkin, a run or a helper. An index is
 * built on every prompt, so a use adds to one line a day and a memory instead of adding a line. Memory names are the
 * user's own words: the record stays in the home's `runtime/` on this Mac, is never an event and is never uploaded.
 * Two writers at once can lose one's count, never a line.
 */
export const MEMORY_USE_KINDS = Object.freeze(['recall', 'index']);
export const MEMORY_USERS = Object.freeze(['main', 'hobkin', 'run', 'helper']);
export const MEMORY_USE_DAYS = 30;
const MOST_DAYS = 3650;
const MOST_USE_BYTES = 512 << 10;
const KEPT_USE_BYTES = 384 << 10;
const NAME = /^[a-z0-9][a-z0-9-]{1,59}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Each kind of use and the name the reader gives its count.
const COUNTS = [['recall', 'recalls'], ['index', 'indexed']];

export const memoryUsePath = root => join(root, 'runtime', 'memory-use.jsonl');

/** The day on this machine's calendar, as memories read their `until` against it. */
function dayOf(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysBefore(at, count) {
  const date = new Date(at);
  date.setDate(date.getDate() - count);
  return date.getTime();
}

const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const later = (a, b) => (!validTime(b) ? a : !a || Date.parse(b) > Date.parse(a) ? b : a);

/** Each reader's count in one line, as whole numbers above zero; anything else in it is no count. */
function countsOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(MEMORY_USERS.filter(by => Number.isInteger(value[by]) && value[by] > 0).map(by => [by, value[by]]));
}

function parsed(line) {
  try {
    const entry = JSON.parse(line);
    return entry && typeof entry === 'object' && DAY.test(entry.day) && NAME.test(entry.name) ? entry : null;
  } catch {
    // A line cut short costs that day's count for that memory and nothing else.
    return null;
  }
}

// The day comes first in every line, so a line of another day is told by its start and left unparsed.
const lineOf = ({ day, name, recall, index, last, lastRecall }) => JSON.stringify({
  day, name, ...(recall ? { recall } : {}), ...(index ? { index } : {}), last, ...(lastRecall ? { lastRecall } : {}),
});

/** The file's lines, or none when it is not there or is not a file of a size hobkin wrote. */
function readLines(file) {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > 2 * MOST_USE_BYTES) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

/**
 * The file made whole beside itself and moved into place, so no reader meets half of it. Unlike `writePrivate` it does
 * not wait for the disk, which costs about 4 ms on every prompt: a crash can cost the newest counts, never a prompt.
 */
function replace(file, text) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeSync(fd, text);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Past its cap, the newest lines that fit what is kept, as `changes.jsonl` is trimmed. */
function newestOf(lines) {
  let total = lines.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
  if (total <= MOST_USE_BYTES) return lines;
  const kept = [];
  total = 0;
  for (let index = lines.length - 1; index >= 0 && total + Buffer.byteLength(lines[index]) + 1 <= KEPT_USE_BYTES; index -= 1) {
    kept.unshift(lines[index]);
    total += Buffer.byteLength(lines[index]) + 1;
  }
  return kept;
}

/**
 * Adds one use to today's line of each memory `names` holds: `kind` is `recall` or `index`, and `by` who read them,
 * `main`, `hobkin`, `run` or `helper`. What is not a memory's name is left out, and with none nothing is written. It
 * throws for a kind or a reader it does not know, and for a file it cannot write: a caller's use is never worth its
 * recall or its prompt, so the caller catches.
 */
export function recordMemoryUse(root, { kind, names, by } = {}, { now = Date.now() } = {}) {
  if (!MEMORY_USE_KINDS.includes(kind)) throw Error('A memory use is a recall or an index.');
  if (!MEMORY_USERS.includes(by)) throw Error('A memory use is by main, hobkin, run or helper.');
  const used = [...new Set((Array.isArray(names) ? names : []).filter(name => typeof name === 'string' && NAME.test(name)))];
  if (!used.length) return;
  const file = memoryUsePath(root);
  const day = dayOf(now);
  const at = new Date(now).toISOString();
  const start = `{"day":"${day}",`;
  const earlier = [];
  const today = new Map();
  for (const line of readLines(file)) {
    const entry = line.startsWith(start) ? parsed(line) : null;
    if (entry) today.set(entry.name, entry);
    else earlier.push(line);
  }
  for (const name of used) {
    const entry = today.get(name) ?? { day, name };
    const counts = countsOf(entry[kind]);
    today.set(name, { ...entry, [kind]: { ...counts, [by]: (counts[by] ?? 0) + 1 }, last: at, ...(kind === 'recall' ? { lastRecall: at } : {}) });
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  replace(file, `${newestOf([...earlier, ...[...today.values()].map(lineOf)]).join('\n')}\n`);
}

/**
 * Each memory used in the last `days` days, today among them (30 unless asked, 3650 at most): `{ name, recalls, indexed, last,
 * lastRecall, by }`, where `last` is its newest use of either kind, `lastRecall` its newest recall or null, and `by`
 * each reader's `{ recalls, indexed }`. The most recalled come first, then the most listed, then by name. A file it
 * cannot read is no uses.
 */
export function readMemoryUse(root, { days = MEMORY_USE_DAYS, now = Date.now() } = {}) {
  const span = Number.isInteger(days) && days > 0 ? Math.min(days, MOST_DAYS) : MEMORY_USE_DAYS;
  const since = dayOf(daysBefore(now, span - 1));
  let lines;
  try {
    lines = readLines(memoryUsePath(root));
  } catch {
    return [];
  }
  const uses = new Map();
  for (const line of lines) {
    const entry = parsed(line);
    if (!entry || entry.day < since) continue;
    const use = uses.get(entry.name) ?? { name: entry.name, recalls: 0, indexed: 0, last: null, lastRecall: null, by: {} };
    for (const [kind, field] of COUNTS) {
      for (const [by, count] of Object.entries(countsOf(entry[kind]))) {
        use[field] += count;
        use.by[by] ??= { recalls: 0, indexed: 0 };
        use.by[by][field] += count;
      }
    }
    use.last = later(use.last, entry.last);
    use.lastRecall = later(use.lastRecall, entry.lastRecall);
    uses.set(entry.name, use);
  }
  return [...uses.values()].sort((a, b) => b.recalls - a.recalls || b.indexed - a.indexed || a.name.localeCompare(b.name));
}
