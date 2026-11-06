import { appendFileSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { atomicJson } from '../config.mjs';

export const levels = {
  // Super critical work runs on Claude whatever harness is set, in a pane, because nothing else can run it. Each run is the dearest there is, so its looks stay this far apart at any priority.
  max: { rank: -1, priority: 'P0', fewestHoursBetweenLooks: 12, lookEffort: 'max', doEffort: 'max', model: 'claude-opus-5-5', harness: 'claude' },
  critical: { rank: 0, priority: 'P0', lookEffort: 'high', doEffort: 'xhigh', model: 'main' },
  important: { rank: 1, priority: 'P1', lookEffort: 'medium', doEffort: 'high', model: 'main' },
  casual: { rank: 2, priority: 'P2', lookEffort: 'low', doEffort: 'medium', model: 'background' },
};
export const grades = ['P0', 'P1', 'P2', 'P3'];
// Each look takes one of seven lenses in turn, so these bring every lens round in 7 hours at P0, a week at P1, three weeks at P2 and seven weeks at P3.
const hoursBetweenLooks = { P0: 1, P1: 24, P2: 72, P3: 168 };
export const prModes = ['off', 'draft', 'published'];
export const lenses = ['security', 'bugs', 'updates', 'chores', 'improvements', 'features', 'trends'];
export const workHarnesses = ['pi', 'claude', 'codex'];
// `branch` is finished on a branch with no PR. `stuck` is only ever on older records, and they run again like anything open.
export const itemStates = ['open', 'doing', 'waiting', 'branch', 'pr', 'merged', 'done', 'declined', 'dropped', 'stuck', 'noted'];
export const runnableStates = ['open', 'doing', 'stuck'];
// What an agent may record. Any other state leaves an item out of the plan with no way back.
export const agentStates = ['open', 'branch', 'pr', 'done', 'dropped'];
export const impacts = ['high', 'medium', 'low'];
export const efforts = ['small', 'medium', 'large'];
export const doableKinds = ['attention', 'pr-fix', 'security', 'fix', 'update', 'chore', 'improvement', 'feature'];
// `yours` is a step only a person can take, so it is filed like work and no agent ever takes it.
const itemKinds = [...doableKinds, 'yours'];
// The most agents work mode will ever run, whatever is asked for. The default sits well below it, and the reason is in docs/guide.md.
export const MAX_AGENTS = 8;

const closedForGood = ['declined', 'dropped'];
const MAX_NAME_LENGTH = 60;
const MAX_BRANCH_NAME = 40;
const DEFAULT_DAILY_TOKENS = 100000000;
const DEFAULT_AGENTS = 2;
const HOUR_MS = 3600000;
// An open owner refreshes its lock every 10 seconds, so a minute without one means it is gone.
const OWNER_FRESH_MS = 60000;
const HOURS_IN_DAY = 24;
// Long enough for a run's first replies to show what it costs before the next one starts.
const START_GAP_MS = HOUR_MS / 12;
export const DISCOVERY_EVERY_MS = HOURS_IN_DAY * HOUR_MS;

const workRoot = root => join(root, 'work');
const modePath = root => join(workRoot(root), 'mode.json');
const projectsPath = root => join(workRoot(root), 'projects.jsonl');
const tokensPath = root => join(workRoot(root), 'tokens.jsonl');
const discoveryPath = root => join(workRoot(root), 'discovery.jsonl');
const ownerPath = root => join(workRoot(root), 'owner.json');
const handedPath = root => join(workRoot(root), 'handed.json');
const cancelsPath = root => join(workRoot(root), 'cancels.jsonl');
const trustPath = root => join(workRoot(root), 'trust.jsonl');

export const paths = (root, slug) => {
  const directory = join(workRoot(root), slug);
  const trees = join(directory, 'trees');
  return {
    directory,
    project: join(directory, 'project.md'),
    directions: join(directory, 'directions.md'),
    items: join(directory, 'items.jsonl'),
    launches: join(directory, 'launches.jsonl'),
    signals: join(directory, 'signals.json'),
    state: join(directory, 'state.json'),
    prs: join(directory, 'prs'),
    trees,
    // A project runs one look at a time, so its looks share one tree.
    lookTree: join(trees, 'look'),
    // Every item's runs shared this tree before each item had one of its own.
    oldDoTree: join(trees, 'do'),
    clone: join(directory, 'repo'),
  };
};

export const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_NAME_LENGTH);

/** What an item's work is called. Its branch is `hobkin/` and this, and its tree is this, so no two items of a project share either. */
export const workName = ({ id, title }) => `${id}-${slugOf(title).slice(0, MAX_BRANCH_NAME)}`;

export const itemTree = (root, slug, item) => join(paths(root, slug).trees, workName(item));

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const parseLines = text => text.split('\n').flatMap(entry => {
  try {
    const event = JSON.parse(entry);
    return event && typeof event === 'object' ? [event] : [];
  } catch {
    return [];
  }
});

function parseEvents(file) {
  if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) return [];
  return parseLines(readFileSync(file, 'utf8'));
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

/** `countedStarts` is what started by itself and spends its priority's runs, as `{ at, priority }`, kept only while its window lasts. */
export function readMode(root) {
  const defaults = {
    version: 1, enabled: false, agents: DEFAULT_AGENTS, folder: null, harness: 'pi', dailyTokens: DEFAULT_DAILY_TOKENS,
    startGapMs: START_GAP_MS, lastDiscoveryAt: null, autoPick: true, queueSkipped: [], queueNext: [], countedStarts: [],
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

export function realFolder(path) {
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
 * The daily clock is for looking again at projects that exist, so with nothing to show a start makes the look due now, unless the look at this folder already finished.
 * Turning it on starts nothing new by itself until the user chooses auto-pick: they see the queue and pick what runs first. Their choice stands at every
 * turn-on, and `autoPick` is `start --auto`, the old start, which turns auto-pick on whatever they chose.
 */
export function startWork(root, requested, { autoPick = false } = {}) {
  const { folder: saved, autoPickChoice = false } = readMode(root);
  const folder = requested ? realFolder(requested) : saved;
  if (!folder) throw Error('Say which folder to start from.');
  const looksNow = requested || !hasWorkToShow(root);
  return writeMode(root, { enabled: true, folder, pausedAt: null, autoPick: autoPick || autoPickChoice, ...(looksNow ? { lastDiscoveryAt: null } : {}) });
}

/** The user's own word on auto-pick, kept beside the switch, so turning work mode on again keeps it. Until they say, there is none. */
export const chooseAutoPick = (root, on) => writeMode(root, { autoPick: on, autoPickChoice: on });

export function setHarness(root, harness) {
  if (!workHarnesses.includes(harness)) throw Error(`harness must be one of: ${workHarnesses.join(', ')}`);
  return writeMode(root, { harness });
}

export function setAgents(root, agents) {
  if (!Number.isInteger(agents) || agents < 1 || agents > MAX_AGENTS) throw Error(`The number of agents must be between 1 and ${MAX_AGENTS}.`);
  return writeMode(root, { agents });
}

/** Queue keys are the plan's own, such as `item:api:abc123` or `look:api`. Picking one puts it first, and takes it back out of skipped. */
export function pickNext(root, key) {
  const { queueNext, queueSkipped } = readMode(root);
  return writeMode(root, { queueNext: [...new Set([...queueNext, key])], queueSkipped: queueSkipped.filter(entry => entry !== key) });
}

export function skipInQueue(root, key) {
  const { queueNext, queueSkipped } = readMode(root);
  return writeMode(root, { queueNext: queueNext.filter(entry => entry !== key), queueSkipped: [...new Set([...queueSkipped, key])] });
}

export const putBackInQueue = (root, key) => writeMode(root, { queueSkipped: readMode(root).queueSkipped.filter(entry => entry !== key) });

/** What only the owner knows, left where a command in another process can read it. */
/** Runs a closing hobkin left going in their panes, for the next one to pick up. Taking them empties the list, so each is picked up once. */
export const writeHanded = (root, runs) => atomicJson(handedPath(root), runs);
export function takeHanded(root) {
  const runs = readJson(handedPath(root), []);
  if (runs.length) atomicJson(handedPath(root), []);
  return runs;
}

export const writeOwnerView = (root, view) => atomicJson(ownerPath(root), view);

/** With no owner open nothing can be running, whatever the last one left behind. */
export function ownerView(root, now = Date.now()) {
  const lock = lstatSync(join(root, 'runtime.lock'), { throwIfNoEntry: false });
  const owner = Boolean(lock) && now - lock.mtimeMs < OWNER_FRESH_MS;
  return { running: [], ...(owner ? readJson(ownerPath(root), {}) : {}), owner };
}

/** Commands take no lock and cannot reach a run, so they leave a request here and the owner answers it on its next tick. `decline` is the user's no to the run's item. */
export function requestCancel(root, run, now = Date.now(), { decline = false } = {}) {
  const request = { run, at: new Date(now).toISOString() };
  appendEvent(cancelsPath(root), decline ? { ...request, decline } : request);
}

export const answerCancel = (root, run, now = Date.now()) => appendEvent(cancelsPath(root), { run, answeredAt: new Date(now).toISOString() });

export function pendingCancels(root) {
  const requests = fold(parseEvents(cancelsPath(root)), event => event.run);
  return requests
    .filter(request => !request.answeredAt)
    .map(({ run, decline = false }) => ({ run, decline }));
}

export const localDay = now => new Date(now).toDateString();
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

/** A finished look ends the search of that folder, and the watcher proposes what turns up there later for no tokens. */
export function folderSearched(root, folder) {
  const { folder: looked, status } = readDiscovery(root);
  return looked === folder && status === 'finished';
}

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

const usagesIn = entries => entries.flatMap(({ message }) => (message?.role === 'assistant' && message.usage ? [message.usage] : []));
const freshTokens = usages => usages.reduce((sum, usage) => sum + (usage.input ?? 0) + (usage.cacheWrite ?? 0) + (usage.output ?? 0), 0);
const cachedTokens = usages => usages.reduce((sum, usage) => sum + (usage.cacheRead ?? 0), 0);

/** `tokens` is fresh tokens, the only ones that count against a limit. `cached` is the rest: reads of context a run already sent. */
export function sessionUsage(file) {
  const entries = parseEvents(file);
  const usages = usagesIn(entries);
  return {
    tokens: freshTokens(usages),
    cached: cachedTokens(usages),
    usd: usages.reduce((sum, usage) => sum + (usage.cost?.total ?? 0), 0),
    sessionId: entries[0]?.id ?? null,
  };
}

/** What a running session has spent. Only what was added since `seen` is read, so this is cheap enough for every tick. */
export function followUsage(file, seen = { offset: 0, tokens: 0, cached: 0 }) {
  const size = lstatSync(file, { throwIfNoEntry: false })?.size ?? 0;
  if (size <= seen.offset) return seen;

  const added = Buffer.alloc(size - seen.offset);
  const descriptor = openSync(file, 'r');
  try {
    readSync(descriptor, added, 0, added.length, seen.offset);
  } finally {
    closeSync(descriptor);
  }
  const end = added.lastIndexOf(10);
  if (end < 0) return seen;

  const usages = usagesIn(parseLines(added.subarray(0, end).toString('utf8')));
  return { offset: seen.offset + end + 1, tokens: seen.tokens + freshTokens(usages), cached: seen.cached + cachedTokens(usages) };
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

export const readProjects = root => fold(parseEvents(projectsPath(root)), event => event.slug);

export function readProject(root, slug) {
  return readProjects(root).find(project => project.slug === slug) ?? null;
}

/** Events like any other on a project, so neither can be lost to the owner writing at the same moment, and `at` keeps meaning when it was answered. */
export const setProjectPaused = (root, slug, paused) => appendEvent(projectsPath(root), { slug, paused });

export function setProjectLevel(root, slug, level) {
  assertLevel(level);
  appendEvent(projectsPath(root), { slug, level });
  return readProject(root, slug);
}

export function setProjectPriority(root, slug, priority) {
  if (!grades.includes(priority)) throw Error(`priority must be one of: ${grades.join(', ')}`);
  appendEvent(projectsPath(root), { slug, priority });
  return readProject(root, slug);
}

export function setProjectPrMode(root, slug, prMode) {
  if (!prModes.includes(prMode)) throw Error(`PR mode must be one of: ${prModes.join(', ')}`);
  appendEvent(projectsPath(root), { slug, prMode });
  return readProject(root, slug);
}

export const priorityOf = ({ priority, level }) => priority ?? levels[level]?.priority;

/** A project's priority sets how often it runs, so P0 comes round far more than P3. Its level sets the model and how hard it thinks. */
export const lookEveryHours = project => Math.max(hoursBetweenLooks[priorityOf(project)], levels[project.level].fewestHoursBetweenLooks ?? 0);

export const byPriority = (left, right) => grades.indexOf(left.priority) - grades.indexOf(right.priority);

export const hasWorkToShow = root => readProjects(root).some(project => ['proposed', 'chosen'].includes(project.state));

export const byRank = (left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity);

export const proposedProjects = root => readProjects(root).filter(project => project.state === 'proposed').toSorted(byRank);

export const chosenProjects = root => readProjects(root).filter(project => project.state === 'chosen');

function assertLevel(level) {
  if (!levels[level]) throw Error(`level must be one of: ${Object.keys(levels).join(', ')}`);
}

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
  assertLevel(proposal.level);
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
  if (level !== undefined) assertLevel(level);

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
  const { key, kind, title, brief, urgent = false, impact, effort, reopen, causedBy } = item;
  assertItem(item);

  const known = readItems(root, slug).find(existing => existing.key === key);
  if (known && !(closedForGood.includes(known.state) && reopen)) return known;

  const id = known?.id ?? createHash('sha256').update(key).digest('hex').slice(0, 6);
  const filed = { id, key, kind, title, brief, urgent, state: 'open', attempts: 0, at: new Date(now).toISOString() };
  const sized = { ...filed, ...(impact ? { impact } : {}), ...(effort ? { effort } : {}), ...(causedBy ? { causedBy } : {}) };
  appendEvent(paths(root, slug).items, reopen ? { ...sized, reopen } : sized);
  return readItems(root, slug).find(existing => existing.id === id);
}

export function updateItem(root, slug, id, change, now = Date.now()) {
  if (!readItems(root, slug).some(existing => existing.id === id)) throw Error(`Unknown item: ${id}`);
  assertSize(change);
  if (change.grade != null && !grades.includes(change.grade)) throw Error(`grade must be one of: ${grades.join(', ')}`);
  appendEvent(paths(root, slug).items, { ...change, id, updatedAt: new Date(now).toISOString() });
  return readItems(root, slug).find(existing => existing.id === id);
}

/** A review or a fix on work already finished. It brings that work closer to landing, so it goes ahead of making more. */
export const movesFinishedWork = ({ kind, reviewAsked, workNote }) => kind === 'pr-fix' || reviewAsked || workNote;

/**
 * An item goes back in the queue with its count of tries back at zero. One already started stays started, so it still goes before the rest of its project.
 * A pick jumps the queue and the gap between starts, so a plain retry only goes back in line, for auto-pick or the user to start. A review or a fix for finished work still goes first by itself.
 */
export function retryItem(root, slug, id, now = Date.now()) {
  const started = readItems(root, slug).some(item => item.id === id && item.state === 'doing');
  const fresh = { attempts: 0, lastError: null };
  const retried = updateItem(root, slug, id, started ? fresh : { ...fresh, state: 'open' }, now);
  const key = `item:${slug}:${id}`;
  return movesFinishedWork(retried) ? pickNext(root, key) : putBackInQueue(root, key);
}

/** What became of a change after it landed, one record for each merged item. A CLI call and the owner can write at once, as they can on items. */
export const readLaunches = (root, slug) => fold(parseEvents(paths(root, slug).launches), event => event.item);

export const recordLaunch = (root, slug, change, now = Date.now()) => appendEvent(paths(root, slug).launches, { ...change, updatedAt: new Date(now).toISOString() });

/** The user's own word on a pattern, from `hobkin work trust`. The last word on each stands. */
export const readTrust = root => fold(parseEvents(trustPath(root)), event => event.pattern);

export const setTrust = (root, pattern, on, now = Date.now()) => appendEvent(trustPath(root), { pattern, on, at: new Date(now).toISOString() });

/** How a finished item leaves its branch. `off` opens no PR: the branch and its description are a local PR for the user to review. */
export const landing = project => project.prMode ?? 'off';

export const prFile = (root, slug, id) => join(paths(root, slug).prs, `${id}.md`);

export const readState = (root, slug) => readJson(paths(root, slug).state, {});

export function writeState(root, slug, change) {
  atomicJson(paths(root, slug).state, { ...readState(root, slug), ...change });
}

export function nextLookAt(root, project) {
  const { lastLensAt } = readState(root, project.slug);
  return lastLensAt ? new Date(Date.parse(lastLensAt) + lookEveryHours(project) * HOUR_MS).toISOString() : null;
}
