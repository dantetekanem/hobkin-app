import { accessSync, appendFileSync, closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isResourceId, SELECTION_KINDS } from './resource-policy.mjs';

/*
 * What each kind of agent loaded and used of what was chosen for it (the client's `_specs/038-resources`). Chosen, loaded
 * and used stay separate facts. The record stays in hobkin's home for 30 days, on this Mac: it is no telemetry event and
 * is never uploaded. Nothing writes it yet.
 */
export const USE_DAYS = 30;
const DAY_MS = 86400000;
const MOST_USE_BYTES = 16777216;
const MOST_LINE_BYTES = 262144;
const HOBKIN_SOURCE = `${fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]$/, '')}${sep}`;
// Pi's own tools come from `builtin:` paths. These two built-ins are resources the user chooses, so they are not Pi's own.
const CHOOSABLE_BUILT_INS = ['builtin:mcp', 'builtin:llama.cpp'];

export const usePath = root => join(root, 'resources', 'use.jsonl');

const synthetic = path => path.startsWith('builtin:') || path.startsWith('<');
function pathKey(path) {
  if (synthetic(path)) return path;
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function readable(path) {
  try {
    accessSync(path, constants.R_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The facts record of one run, marked: each tool, skill and context file is the chosen resource it came from, Pi's own,
 * hobkin's own, or loaded without being chosen. Under a launcher that manages extensions, its unchosen tools say so. A
 * chosen context file counts as loaded when it is readable as the run begins.
 */
export function loadedFacts(record, { chosen = [], ownPaths = [], managedExtensions = false } = {}) {
  const owners = new Map();
  for (const item of chosen) for (const path of [...item.extensions, ...item.skills, ...item.context]) owners.set(pathKey(path), item.id);
  const own = new Set(ownPaths.map(pathKey));
  const mark = (entry, launcherOwned) => {
    const key = pathKey(entry.path);
    const id = owners.get(key);
    if (id) return { ...entry, origin: 'chosen', id };
    if (entry.path.startsWith('builtin:') && !CHOOSABLE_BUILT_INS.includes(entry.path)) return { ...entry, origin: 'pi' };
    if (entry.path.startsWith('<sdk:') || key.startsWith(HOBKIN_SOURCE) || own.has(key)) return { ...entry, origin: 'hobkin' };
    return { ...entry, origin: 'unchosen', ...(launcherOwned && managedExtensions ? { reason: 'launcher' } : {}) };
  };
  const contextFiles = record.contextFiles.map(({ path }) => mark({ path }, false));
  const found = new Set(contextFiles.map(file => pathKey(file.path)));
  for (const item of chosen) {
    for (const path of item.context) {
      if (!found.has(pathKey(path))) contextFiles.push({ path, origin: readable(path) ? 'chosen' : 'unreadable', id: item.id });
    }
  }
  return {
    tools: record.tools.map(({ name, path }) => mark({ name, path }, true)),
    skills: record.skills.map(({ name, path }) => mark({ name, path }, false)),
    contextFiles,
    ...(record.truncated ? { truncated: true } : {}),
  };
}

// Pi's read tool takes a path relative to the run's folder, with `~` for home and an optional leading `@`.
function readPath(path, cwd, home) {
  const plain = path.startsWith('@') ? path.slice(1) : path;
  if (plain === '~' || plain.startsWith('~/')) return join(home, plain.slice(1));
  return resolve(cwd, plain);
}

/**
 * The uses in a run's events: a call of a chosen extension's tool, whether the model made it or a code mode script did
 * (Pi gives a nested call its own `tool_execution_start`, with `parentToolCallId`), and a `read` of a chosen skill's file.
 */
export function usesFromEvents(events, { loaded, chosen = [], cwd, home = homedir() }) {
  const toolIds = new Map(loaded.tools.filter(tool => tool.origin === 'chosen').map(tool => [tool.name, tool.id]));
  const skillIds = new Map(chosen.flatMap(item => item.skills.map(path => [pathKey(path), item.id])));
  const seen = new Set(), uses = [];
  for (const event of events) {
    if (event?.type !== 'tool_execution_start' || typeof event.toolCallId !== 'string' || seen.has(event.toolCallId)) continue;
    seen.add(event.toolCallId);
    const call = event.toolCallId;
    if (toolIds.has(event.toolName)) uses.push({ call, id: toolIds.get(event.toolName), by: 'tool', name: event.toolName });
    if (event.toolName === 'read' && typeof event.args?.path === 'string') {
      const id = skillIds.get(pathKey(readPath(event.args.path, cwd, home)));
      if (id) uses.push({ call, id, by: 'skill', name: event.toolName });
    }
  }
  return uses;
}

/** How many times each id was used, for one record. */
export const usedCounts = uses => [...uses.reduce((counts, use) => counts.set(use.id, (counts.get(use.id) ?? 0) + 1), new Map())]
  .map(([id, count]) => ({ id, count }));

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const controls = /[\p{Cc}]/u;

function useLine({ kind, run, at, loaded, used }) {
  if (!SELECTION_KINDS.includes(kind) || typeof run !== 'string' || !run || run.length > 200 || controls.test(run)
    || typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || (loaded !== undefined && !plainObject(loaded))
    || (used !== undefined && (!Array.isArray(used) || used.some(use => !plainObject(use) || !isResourceId(use.id)
      || !Number.isInteger(use.count) || use.count < 1 || use.count > 1000000)))) {
    throw Error('Invalid resource use record.');
  }
  const line = JSON.stringify({ version: 1, at, kind, run, ...(loaded ? { loaded } : {}), ...(used?.length ? { used } : {}) });
  if (Buffer.byteLength(line) > MOST_LINE_BYTES) throw Error('A resource use record exceeds its bound.');
  return line;
}

const parsed = line => {
  try {
    const entry = JSON.parse(line);
    return entry?.version === 1 && SELECTION_KINDS.includes(entry.kind) && Number.isFinite(Date.parse(entry.at)) ? entry : undefined;
  } catch {
    return undefined;
  }
};

function firstLine(file) {
  const fd = openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(65536);
    return bytes.subarray(0, readSync(fd, bytes, 0, bytes.length, 0)).toString('utf8').split('\n')[0];
  } finally {
    closeSync(fd);
  }
}

function rewrite(file, text) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

// Kept to the last 30 days, and to a bound, oldest first out. It is checked on each write, cheaply, from the oldest line.
function prune(file, now) {
  const cutoff = now - USE_DAYS * DAY_MS;
  const oldest = parsed(firstLine(file));
  if (oldest && Date.parse(oldest.at) >= cutoff && statSync(file).size <= MOST_USE_BYTES) return;
  const lines = readFileSync(file, 'utf8').split('\n').filter(line => {
    const entry = parsed(line);
    return entry && Date.parse(entry.at) >= cutoff;
  });
  let bytes = lines.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
  while (bytes > MOST_USE_BYTES && lines.length) bytes -= Buffer.byteLength(lines.shift()) + 1;
  rewrite(file, lines.map(line => `${line}\n`).join(''));
}

/** Appends one line: what a run of one kind loaded, what it used, or both. */
export function recordUse(root, entry, { now = Date.now() } = {}) {
  const line = useLine(entry);
  const file = usePath(root);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${line}\n`, { mode: 0o600 });
  prune(file, now);
}

/** For each kind, what its last run that said so loaded, and each id's uses over the last 30 days. */
export function readUse(root, { now = Date.now() } = {}) {
  const result = Object.fromEntries(SELECTION_KINDS.map(kind => [kind, { loaded: null, uses: {} }]));
  const file = usePath(root);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > 2 * MOST_USE_BYTES) return result;
  const cutoff = now - USE_DAYS * DAY_MS;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const entry = parsed(line);
    if (!entry || Date.parse(entry.at) < cutoff) continue;
    const kind = result[entry.kind];
    if (plainObject(entry.loaded) && (!kind.loaded || Date.parse(entry.at) >= Date.parse(kind.loaded.at))) {
      kind.loaded = { at: entry.at, run: entry.run, ...entry.loaded };
    }
    for (const use of Array.isArray(entry.used) ? entry.used : []) {
      if (!isResourceId(use?.id) || !Number.isInteger(use.count)) continue;
      const seen = kind.uses[use.id];
      kind.uses[use.id] = { count: (seen?.count ?? 0) + use.count, last: !seen || Date.parse(entry.at) > Date.parse(seen.last) ? entry.at : seen.last };
    }
  }
  return result;
}
