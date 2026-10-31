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
const DEFAULT_DAILY_TOKENS = 100000000;
const HOUR_MS = 3600000;
const HOURS_IN_DAY = 24;
export const DISCOVERY_EVERY_MS = HOURS_IN_DAY * HOUR_MS;

const workRoot = root => join(root, 'work');
const modePath = root => join(workRoot(root), 'mode.json');
const projectsPath = root => join(workRoot(root), 'projects.jsonl');
const tokensPath = root => join(workRoot(root), 'tokens.jsonl');
const discoveryPath = root => join(workRoot(root), 'discovery.jsonl');

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
  const defaults = { version: 1, enabled: false, pool, folder: null, harness: 'pi', dailyTokens: DEFAULT_DAILY_TOKENS, lastDiscoveryAt: null };
  return { ...defaults, ...readJson(modePath(root), {}) };
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

/**
 * Discovery searches only where the user said to start, so the first start needs a folder.
 * The daily clock is for looking again at projects that exist, so with nothing to show a start looks now.
 */
export function startWork(root, requested) {
  const { folder: saved } = readMode(root);
  const folder = requested ? realFolder(requested) : saved;
  if (!folder) throw Error('Say which folder to start from.');
  const looksNow = requested || !hasWorkToShow(root);
  return writeMode(root, { enabled: true, folder, ...(looksNow ? { lastDiscoveryAt: null } : {}) });
}

export function setHarness(root, harness) {
  if (!workHarnesses.includes(harness)) throw Error(`harness must be one of: ${workHarnesses.join(', ')}`);
  return writeMode(root, { harness });
}

const localDay = now => new Date(now).toDateString();
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const tokenLabel = tokens => compactNumber.format(tokens).toLowerCase();

export const dailyLimit = (mode, now = Date.now()) => (mode.raisedOn === localDay(now) ? mode.raisedTo : mode.dailyTokens);

/** A request only stands on the day it was made; the limit is back to normal the next morning. */
export const currentRequest = (mode, now = Date.now()) => (mode.allowanceRequest?.day === localDay(now) ? mode.allowanceRequest : null);

export const declinedToday = (mode, now = Date.now()) => mode.declinedOn === localDay(now);

export function requestAllowance(root, request, now = Date.now()) {
  const asked = { ...request, day: localDay(now), at: new Date(now).toISOString() };
  return writeMode(root, { allowanceRequest: asked });
}

/** `answer` is true for what Hobkin proposed, a number for the user's own figure, or false to stay paused today. */
export function answerAllowance(root, answer, now = Date.now()) {
  if (answer === false) return writeMode(root, { allowanceRequest: null, declinedOn: localDay(now) });

  const proposed = currentRequest(readMode(root), now)?.proposed;
  if (answer === true && !proposed) throw Error('Nothing is waiting for a higher allowance.');

  const raisedTo = answer === true ? proposed : answer;
  if (!Number.isInteger(raisedTo) || raisedTo <= 0) throw Error('The allowance must be a positive number.');
  return writeMode(root, { allowanceRequest: null, declinedOn: null, raisedTo, raisedOn: localDay(now) });
}

export function setDailyTokens(root, tokens) {
  if (!Number.isInteger(tokens) || tokens <= 0) throw Error('The daily token limit must be a positive number.');
  return writeMode(root, { dailyTokens: tokens, raisedTo: null, raisedOn: null, allowanceRequest: null, declinedOn: null });
}

export const nextDiscoveryAt = ({ lastDiscoveryAt }) => (lastDiscoveryAt
  ? new Date(Date.parse(lastDiscoveryAt) + DISCOVERY_EVERY_MS).toISOString() : null);

const folderNames = value => [value].flat().filter(Boolean).map(folder => basename(String(folder)));

/** The latest discovery: the event that started it, and everything written since. */
export function readDiscovery(root) {
  const events = parseEvents(discoveryPath(root));
  return Object.assign({}, ...events.slice(Math.max(0, events.findLastIndex(event => event.startedAt))));
}

export const recordDiscovery = (root, change) => appendEvent(discoveryPath(root), change);

/** What the agent says as it goes. The lists only grow, so a run that stops leaves them for the next one. */
export function noteDiscovery(root, { folder, doing, repositories, rootFolders, finishedFolders }) {
  const { repositories: found = [], finishedFolders: finished = [] } = readDiscovery(root);
  recordDiscovery(root, {
    current: folder,
    doing,
    rootFolders: rootFolders && folderNames(rootFolders),
    repositories: [...new Set([...found, ...[repositories].flat().filter(Boolean)])],
    finishedFolders: [...new Set([...finished, ...folderNames(finishedFolders)])],
  });
  return readDiscovery(root);
}

/** The root folders still to do, or `null` while the agent has not said which there are. Only an empty list is a finished look. */
export const foldersLeft = ({ rootFolders, finishedFolders = [] }) => (rootFolders
  ? rootFolders.filter(folder => !finishedFolders.includes(folder)) : null);

/** Fresh tokens only: cache reads repeat earlier context, so counting them would swamp what a run really used. */
export function sessionUsage(file) {
  const entries = parseEvents(file);
  const usages = entries.flatMap(({ message }) => (message?.role === 'assistant' && message.usage ? [message.usage] : []));
  return {
    tokens: usages.reduce((sum, usage) => sum + (usage.input ?? 0) + (usage.cacheWrite ?? 0) + (usage.output ?? 0), 0),
    usd: usages.reduce((sum, usage) => sum + (usage.cost?.total ?? 0), 0),
    sessionId: entries[0]?.id ?? null,
  };
}

export function recordTokens(root, { slug, lane, tokens }, now = Date.now()) {
  appendEvent(tokensPath(root), { at: new Date(now).toISOString(), slug, lane, tokens });
}

export function tokensToday(root, now = Date.now()) {
  return parseEvents(tokensPath(root))
    .filter(event => localDay(event.at) === localDay(now))
    .reduce((sum, event) => sum + event.tokens, 0);
}

export function tokensLastHour(root, now = Date.now()) {
  return parseEvents(tokensPath(root))
    .filter(event => now - Date.parse(event.at) < HOUR_MS)
    .reduce((sum, event) => sum + event.tokens, 0);
}

/** A rolling hour spreads work wherever it starts, so turning the mode on late cannot release the whole day at once. */
export const isPacing = (root, dailyTokens, now = Date.now()) => tokensLastHour(root, now) >= dailyTokens / HOURS_IN_DAY;

export const readProjects = root => fold(parseEvents(projectsPath(root)), event => event.slug);

export function readProject(root, slug) {
  return readProjects(root).find(project => project.slug === slug) ?? null;
}

export const hasWorkToShow = root => readProjects(root).some(project => ['proposed', 'chosen'].includes(project.state));

export const byRank = (left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity);

export const proposedProjects = root => readProjects(root).filter(project => project.state === 'proposed').toSorted(byRank);

function assertItem({ key, kind, title, brief }) {
  if (!key) throw Error('An item needs a stable key.');
  if (!itemKinds.includes(kind)) throw Error(`kind must be one of: ${itemKinds.join(', ')}`);
  if (!title || !brief) throw Error('An item needs a title and a brief.');
}

export function proposeProject(root, proposal, now = Date.now()) {
  const slug = slugOf(proposal.slug ?? proposal.name);
  if (!slug) throw Error('A proposal needs a name.');
  if (!proposal.path && !proposal.remote) throw Error('A proposal needs a path or a remote.');
  if (!levels[proposal.level]) throw Error(`level must be one of: ${Object.keys(levels).join(', ')}`);
  (proposal.first ?? []).forEach(assertItem);

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
  assertItem(item);

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

export function nextLookAt(root, { slug, level }) {
  const { lastLensAt } = readState(root, slug);
  return lastLensAt ? new Date(Date.parse(lastLensAt) + levels[level].lookEveryHours * HOUR_MS).toISOString() : null;
}
