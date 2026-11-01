import { appendFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { atomicJson } from '../config.mjs';

export const levels = {
  critical: { rank: 0, lookEveryHours: 8, lookEffort: 'high', doEffort: 'xhigh', model: 'main' },
  important: { rank: 1, lookEveryHours: 24, lookEffort: 'medium', doEffort: 'high', model: 'main' },
  casual: { rank: 2, lookEveryHours: 72, lookEffort: 'low', doEffort: 'medium', model: 'background' },
};
export const lenses = ['security', 'bugs', 'updates', 'chores', 'improvements', 'features', 'trends'];
export const workHarnesses = ['pi', 'claude', 'codex'];
export const impacts = ['high', 'medium', 'low'];
export const efforts = ['small', 'medium', 'large'];
export const doableKinds = ['pr-fix', 'security', 'fix', 'update', 'chore', 'improvement', 'feature'];
// The most agents work mode will ever run, whatever is asked for. The default sits well below it, and the reason is in the README.
export const MAX_AGENTS = 8;

const itemKinds = [...doableKinds, 'attention'];
const closedForGood = ['declined', 'dropped'];
const MAX_NAME_LENGTH = 60;
const DEFAULT_DAILY_TOKENS = 100000000;
const DEFAULT_AGENTS = 2;
const DEFAULT_UNMERGED_LIMIT = 30;
const HOUR_MS = 3600000;
const HOURS_IN_DAY = 24;
// Long enough for a run's first replies to show what it costs before the next one starts.
const START_GAP_MS = HOUR_MS / 12;
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

export function readJson(file, fallback) {
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
  const defaults = {
    version: 1, enabled: false, agents: DEFAULT_AGENTS, folder: null, harness: 'pi', dailyTokens: DEFAULT_DAILY_TOKENS,
    unmergedLimit: DEFAULT_UNMERGED_LIMIT, startGapMs: START_GAP_MS, lastDiscoveryAt: null,
  };
  // `pool` came from the size of the machine and was saved on any change. Nobody chose it, so it does not carry over.
  const { pool, ...saved } = readJson(modePath(root), {});
  return { ...defaults, ...saved };
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

export function setAgents(root, agents) {
  if (!Number.isInteger(agents) || agents < 1 || agents > MAX_AGENTS) throw Error(`The number of agents must be between 1 and ${MAX_AGENTS}.`);
  return writeMode(root, { agents });
}

export function setUnmergedLimit(root, unmergedLimit) {
  if (!Number.isInteger(unmergedLimit) || unmergedLimit <= 0) throw Error('The unmerged limit must be a positive number.');
  return writeMode(root, { unmergedLimit });
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

/** What stopped a run, in the provider's own words. A run that recovered and carried on has nothing to say here. */
export function sessionError(file) {
  const last = parseEvents(file).findLast(({ message }) => message?.role === 'assistant')?.message;
  return last?.stopReason === 'error' ? last.errorMessage ?? null : null;
}

/** `kind` and `level` tell what kind of run this was, so the next one like it can be costed from it. */
export function recordTokens(root, { slug, lane, tokens, ...details }, now = Date.now()) {
  appendEvent(tokensPath(root), { at: new Date(now).toISOString(), slug, lane, tokens, ...details });
}

export const tokenEvents = root => parseEvents(tokensPath(root));

export function tokensToday(root, now = Date.now()) {
  return tokenEvents(root)
    .filter(event => localDay(event.at) === localDay(now))
    .reduce((sum, event) => sum + event.tokens, 0);
}

export function tokensLastHour(root, now = Date.now()) {
  return tokenEvents(root)
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

function assertSize({ impact, effort }) {
  if (impact !== undefined && !impacts.includes(impact)) throw Error(`impact must be one of: ${impacts.join(', ')}`);
  if (effort !== undefined && !efforts.includes(effort)) throw Error(`effort must be one of: ${efforts.join(', ')}`);
}

function assertItem(item) {
  const { key, kind, title, brief } = item;
  if (!key) throw Error('An item needs a stable key.');
  if (!itemKinds.includes(kind)) throw Error(`kind must be one of: ${itemKinds.join(', ')}`);
  if (!title || !brief) throw Error('An item needs a title and a brief.');
  assertSize(item);
}

/** `reoffer` is the watcher's alone: a skipped project that came back to life can be offered once more. */
export function proposeProject(root, proposal, now = Date.now(), { reoffer = false } = {}) {
  const slug = slugOf(proposal.slug ?? proposal.name);
  if (!slug) throw Error('A proposal needs a name.');
  if (!proposal.path && !proposal.remote) throw Error('A proposal needs a path or a remote.');
  if (!levels[proposal.level]) throw Error(`level must be one of: ${Object.keys(levels).join(', ')}`);
  (proposal.first ?? []).forEach(assertItem);

  const known = readProject(root, slug);
  const offered = known?.state === 'proposed' || (reoffer && known?.state === 'skipped');
  if (known && !offered) return known;
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
  const { key, kind, title, brief, urgent = false, impact, effort, reopen } = item;
  assertItem(item);

  const known = readItems(root, slug).find(existing => existing.key === key);
  if (known && !(closedForGood.includes(known.state) && reopen)) return known;

  const id = known?.id ?? createHash('sha256').update(key).digest('hex').slice(0, 6);
  const filed = { id, key, kind, title, brief, urgent, state: 'open', attempts: 0, at: new Date(now).toISOString() };
  const sized = { ...filed, ...(impact ? { impact } : {}), ...(effort ? { effort } : {}) };
  appendEvent(paths(root, slug).items, reopen ? { ...sized, reopen } : sized);
  return readItems(root, slug).find(existing => existing.id === id);
}

export function updateItem(root, slug, id, change, now = Date.now()) {
  if (!readItems(root, slug).some(existing => existing.id === id)) throw Error(`Unknown item: ${id}`);
  assertSize(change);
  appendEvent(paths(root, slug).items, { ...change, id, updatedAt: new Date(now).toISOString() });
  return readItems(root, slug).find(existing => existing.id === id);
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
