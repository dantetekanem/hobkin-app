import { appendFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism, homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { atomicJson } from '../config.mjs';

export const levels = {
  critical: { rank: 0, lookEveryHours: 8, lookEffort: 'high', doEffort: 'xhigh', model: 'main' },
  important: { rank: 1, lookEveryHours: 24, lookEffort: 'medium', doEffort: 'high', model: 'main' },
  casual: { rank: 2, lookEveryHours: 72, lookEffort: 'low', doEffort: 'medium', model: 'background' },
};
export const lenses = ['security', 'bugs', 'updates', 'chores', 'improvements', 'features', 'trends'];
export const workHarnesses = ['pi', 'claude', 'codex'];

const doableKinds = ['pr-fix', 'security', 'fix', 'update', 'chore', 'improvement', 'feature'];
const itemKinds = [...doableKinds, 'attention'];
const closedForGood = ['declined', 'dropped'];
const MAX_NAME_LENGTH = 60;

const workRoot = root => join(root, 'work');
const modePath = root => join(workRoot(root), 'mode.json');
const projectsPath = root => join(workRoot(root), 'projects.jsonl');

export const paths = (root, slug) => {
  const directory = join(workRoot(root), slug);
  return {
    directory,
    project: join(directory, 'project.md'),
    directions: join(directory, 'directions.md'),
    items: join(directory, 'items.jsonl'),
    state: join(directory, 'state.json'),
    lookTree: join(directory, 'trees', 'look'),
    doTree: join(directory, 'trees', 'do'),
    clone: join(directory, 'repo'),
  };
};

export const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_NAME_LENGTH);

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseEvents(file) {
  if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap(entry => {
    try {
      const event = JSON.parse(entry);
      return event && typeof event === 'object' ? [event] : [];
    } catch {
      return [];
    }
  });
}

// The owner and a run's CLI call can write at once, so these files only ever grow; the last event for an ID wins.
function appendEvent(file, event) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function fold(events, identify) {
  const folded = new Map();
  for (const event of events) {
    const id = identify(event);
    folded.set(id, { ...folded.get(id), ...event });
  }
  return [...folded.values()];
}

export function readMode(root) {
  const pool = Math.max(2, Math.floor(availableParallelism() / 2));
  return { version: 1, enabled: false, pool, folder: null, harness: 'pi', lastDiscoveryAt: null, ...readJson(modePath(root), {}) };
}

export function writeMode(root, change) {
  const mode = { ...readMode(root), ...change };
  atomicJson(modePath(root), mode);
  return mode;
}

function realFolder(path) {
  try {
    const folder = realpathSync(path.replace(/^~(?=$|\/)/, homedir()));
    if (statSync(folder).isDirectory()) return folder;
  } catch {
    // Reported below, with the path the user gave.
  }
  throw Error(`Not a folder: ${path}`);
}

/** Discovery searches only where the user said to start, so the first start needs a folder. */
export function startWork(root, requested) {
  const { folder: saved } = readMode(root);
  const folder = requested ? realFolder(requested) : saved;
  if (!folder) throw Error('Say which folder to start from.');
  return writeMode(root, { enabled: true, folder, ...(requested ? { lastDiscoveryAt: null } : {}) });
}

export function setHarness(root, harness) {
  if (!workHarnesses.includes(harness)) throw Error(`harness must be one of: ${workHarnesses.join(', ')}`);
  return writeMode(root, { harness });
}

export const readProjects = root => fold(parseEvents(projectsPath(root)), event => event.slug);

export function readProject(root, slug) {
  return readProjects(root).find(project => project.slug === slug) ?? null;
}

export function proposeProject(root, proposal, now = Date.now()) {
  const slug = slugOf(proposal.slug ?? proposal.name);
  if (!slug) throw Error('A proposal needs a name.');
  if (!proposal.path && !proposal.remote) throw Error('A proposal needs a path or a remote.');
  if (!levels[proposal.level]) throw Error(`level must be one of: ${Object.keys(levels).join(', ')}`);

  const known = readProject(root, slug);
  if (known && known.state !== 'proposed') return known;
  appendEvent(projectsPath(root), { ...proposal, slug, state: 'proposed', at: new Date(now).toISOString() });
  return readProject(root, slug);
}

function projectFor(root, reference) {
  if (!isAbsolute(reference)) return readProject(root, reference);
  return readProjects(root).find(project => project.path === reference)
    ?? { slug: slugOf(basename(reference)), name: basename(reference), path: reference, level: 'important', first: [] };
}

export function chooseProject(root, reference, level, now = Date.now()) {
  const project = projectFor(root, reference);
  if (!project) throw Error(`Unknown project: ${reference}`);
  if (level !== undefined && !levels[level]) throw Error(`level must be one of: ${Object.keys(levels).join(', ')}`);

  const chosenLevel = level ?? project.level;
  appendEvent(projectsPath(root), { ...project, level: chosenLevel, state: 'chosen', at: new Date(now).toISOString() });
  for (const item of project.first ?? []) fileItem(root, project.slug, item, now);
  return readProject(root, project.slug);
}

function answerProject(root, slug, state, now) {
  if (!readProject(root, slug)) throw Error(`Unknown project: ${slug}`);
  appendEvent(projectsPath(root), { slug, state, at: new Date(now).toISOString() });
  return readProject(root, slug);
}

export const skipProject = (root, slug, now = Date.now()) => answerProject(root, slug, 'skipped', now);
export const dropProject = (root, slug, now = Date.now()) => answerProject(root, slug, 'dropped', now);

export const readItems = (root, slug) => fold(parseEvents(paths(root, slug).items), event => event.id);

export function fileItem(root, slug, item, now = Date.now()) {
  const { key, kind, title, brief, urgent = false, reopen } = item;
  if (!key) throw Error('An item needs a stable key.');
  if (!itemKinds.includes(kind)) throw Error(`kind must be one of: ${itemKinds.join(', ')}`);
  if (!title || !brief) throw Error('An item needs a title and a brief.');

  const known = readItems(root, slug).find(existing => existing.key === key);
  if (known && !(closedForGood.includes(known.state) && reopen)) return known;

  const id = known?.id ?? createHash('sha256').update(key).digest('hex').slice(0, 6);
  const filed = { id, key, kind, title, brief, urgent, state: 'open', attempts: 0, at: new Date(now).toISOString() };
  appendEvent(paths(root, slug).items, reopen ? { ...filed, reopen } : filed);
  return readItems(root, slug).find(existing => existing.id === id);
}

export function updateItem(root, slug, id, change, now = Date.now()) {
  if (!readItems(root, slug).some(existing => existing.id === id)) throw Error(`Unknown item: ${id}`);
  appendEvent(paths(root, slug).items, { ...change, id, updatedAt: new Date(now).toISOString() });
  return readItems(root, slug).find(existing => existing.id === id);
}

/** An interrupted item comes first, because its work is already in the tree. */
export function nextItem(root, slug) {
  const candidates = readItems(root, slug)
    .filter(item => ['open', 'doing'].includes(item.state) && doableKinds.includes(item.kind));
  const rank = item => [
    item.state === 'doing' ? 0 : 1,
    item.urgent ? 0 : 1,
    doableKinds.indexOf(item.kind),
  ];
  const compare = (left, right) => {
    const [a, b] = [rank(left), rank(right)];
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || left.at.localeCompare(right.at);
  };
  return candidates.toSorted(compare)[0] ?? null;
}

export const landing = (level, kind) => {
  if (level === 'critical') return 'draft';
  return level === 'important' && kind === 'feature' ? 'draft' : 'pr';
};

export const readState = (root, slug) => readJson(paths(root, slug).state, {});

export function writeState(root, slug, change) {
  atomicJson(paths(root, slug).state, { ...readState(root, slug), ...change });
}
