import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileActionItem } from '../decisions.mjs';
import { followsUp } from './after-merge.mjs';
import { shortPath } from './chat.mjs';
import { surveyAndClose } from './closing.mjs';
import { deployPathOf } from './deploys.mjs';
import { forecastWork } from './forecast.mjs';
import { offeredIn } from './land-offer.mjs';
import { userTrouble } from './launches.mjs';
import { findItem, findProject, nameOf, projectNamed, runsNamed } from './names.mjs';
import { itemGrade, planWork, rowWait, withPending } from './plan.mjs';
import { NEEDS_AN_OWNER, weighedRows } from './reads.mjs';
import {
  answerAllowance, chooseProject, doableKinds, dropProject, fileItem, itemTree, lookEveryHours, movesFinishedWork, ownerView, paths, pickNext, pickNow, prFile, putBackInQueue, readItems, readMode, readProject, realFolder,
  requestCancel, retryItem, runnableStates, setProjectLevel, setProjectPaused, setProjectPrMode, setProjectPriority, setTrust, skipInQueue, skipProject, slugOf, startWork, tokenLabel, updateItem, writeMode,
} from './store.mjs';
import { BRANCH_PREFIX, currentBranch, defaultBranch, gitOrNothing, gitWithin, isMerged, landBranch, realPlace, retireTree, worktreeOn } from './tree.mjs';
import { AFTER_MERGE, changeFacts, closeMergedPull, ghWithin, landedRecord, landingTip, pullNow, readUnmerged, SHIP_KIND } from './unmerged.mjs';

const run = promisify(execFile);

const QUEUE_KEY = /^(item|look|study|ideas|signals|watch|machines):([^:]+)(?::(.+))?$/;
const LOOKS = ['look', 'study', 'ideas', 'signals', 'watch', 'machines'];
// A finished branch can go round again. Its item goes back to `open`, and the next run picks up from that branch.
const statesThatRun = [...runnableStates, 'branch'];
// A look's pace in the words people use: every hour, every 12 hours, every day, every 3 days, every week.
const everyWords = hours => {
  if (hours % 168 === 0) return hours === 168 ? 'every week' : `every ${hours / 168} weeks`;
  if (hours % 24 === 0) return hours === 24 ? 'every day' : `every ${hours / 24} days`;
  return hours === 1 ? 'every hour' : `every ${hours} hours`;
};
// `done` here is an older record of finished work, and Done lists it as not landed.
const statesThatMerge = ['branch', 'done'];
const OFFER_HOLD_MS = 24 * 3600000;
const PATTERN = /^([^/]+)\/([^/]+)\/.+$/;
const landings = {
  off: 'finished work stays on a local branch with its description, for the user to review',
  draft: 'finished work opens a draft PR',
  published: 'finished work opens a PR',
};

/** One line: what happened and what comes next. A failure throws, and `printWorkCommand` says it the same way. */
export const reply = (message, details = {}) => ({ ok: true, message, ...details });

/** What an action on a card tells: `line` is the whole sentence for Chat, and the rest is what the main agent hears with the user's next message. */
export const toldOf = (project, { id, title, pr }, did, line) => ({
  did,
  project: nameOf(project),
  item: id,
  title,
  ...(pr ? { pr } : {}),
  line,
});

/** A merge's line. When more follows the merge, its issue's closing or what its run left, Chat waits for that (`after-merge.mjs`) to say it once. */
const toldOfMerge = (project, item, did, line) => ({
  ...toldOf(project, item, did, line),
  ...(followsUp(item) ? { follows: { slug: project.slug, item: item.id } } : {}),
});

/** The reply names the work by its title and project. Chat says the same with a PR's link too, so the user can tell which one it was. */
function cardReply(project, item, did, sentence) {
  const named = `"${item.title}" on ${nameOf(project)}`;
  const linked = item.pr ? `${named} (${item.pr})` : named;
  return reply(sentence(named), { told: toldOf(project, item, did, sentence(linked)) });
}

// Long enough for a session to do the job, and short enough that a hand-off nothing came of brings its card back.
const WITH_MAIN_AGENT_MS = 3 * 3600000;
/** Where a run leaves finished work: on its local branch, or on its PR. */
export const isFinished = ({ state }) => ['branch', 'pr'].includes(state);

/** Work mode starts work on a finished branch itself unless it is off or held, and then nothing would start it at all. */
export function whyWorkModeWaits(mode, now) {
  if (!mode.enabled) return 'work mode is off';
  const until = pause => Boolean(pause) && Date.parse(pause.until) > now;
  if (mode.pausedAt || until(mode.usagePause) || until(mode.subscriptionPause)) return 'work mode is paused';
  return null;
}

/**
 * What work mode cannot start goes to the main agent, which hands it to one session. Nothing is queued, so the job runs once, and the card waits with
 * that session, saying what it is `doing`, until its time runs out. `asked` is the session's job, and `to` says it in the reply.
 */
export function handOff(root, { project, item, why, now, also = {} }, { asked, doing, did, to }) {
  const withMainAgent = { until: new Date(now + WITH_MAIN_AGENT_MS).toISOString(), doing };
  updateItem(root, project.slug, item.id, { ...also, withMainAgent }, now);

  const named = `"${item.title}" on ${nameOf(project)}`;
  const message = `${why.charAt(0).toUpperCase()}${why.slice(1)}, so the main agent starts a session to ${to(named)}.`;
  const job = {
    project: nameOf(project),
    item: item.id,
    title: item.title,
    branch: item.branch,
    ...(item.pr ? { pr: item.pr } : {}),
    asked,
    why,
  };
  return reply(message, { handOff: job, told: toldOf(project, item, did, message) });
}

// A job queued while work mode waits starts only once that ends, and the reply says so.
const queuedWhile = held => (held ? ` Nothing starts while ${held}.` : '');

const ASKED_REVIEW = 'asked for a review';
const SENT_BACK = 'sent it back with a note';
const REVIEW_JOB = {
  asked: 'Review this branch with the review tooling you have and fix what it finds that is real, then run its proof again and record it.',
  doing: 'reviewing it',
  did: ASKED_REVIEW,
  to: named => `review ${named}, run its proof again and record it`,
};

/** What a session does with the user's note, in their own words. With no note it closes whatever stops the branch merging, as a run would. */
function noteJob(words) {
  if (!words) {
    return {
      asked: 'Close whatever stops this branch merging, run its proof again and record it.',
      doing: 'getting it ready to merge',
      did: SENT_BACK,
      to: named => `close whatever stops ${named} merging, run its proof again and record it`,
    };
  }
  return {
    asked: `The user's note: "${words}" Make the change the user asked for on this branch, run its proof again and record it.`,
    doing: 'working on your note',
    did: SENT_BACK,
    to: named => `make the requested change on ${named}, run its proof again and record it`,
  };
}

// `low` is how people say the lowest level.
const levelNamed = word => (word === 'low' ? 'casual' : word);

function assertNotRunning(root, { slug }, { id, title }) {
  const running = ownerView(root).running.some(run => run.slug === slug && run.item === id);
  if (running) throw Error(`"${title}" is already running. hobkin work cancel ${id} stops it.`);
}

/** `autoPick` is `start --auto`, the start work mode used to have, where the top of the queue starts by itself. The user's own choice of auto-pick does the same. */
export function startMode(root, requested, { autoPick = false } = {}) {
  const started = startWork(root, requested, { autoPick });
  const { enabled, folder } = started;
  const view = ownerView(root);
  const next = view.owner ? 'The owner picks it up on its next tick.' : NEEDS_AN_OWNER;
  const { line } = forecastWork(root, planWork(root, view), view);
  const itself = started.autoPick ? ', and the top of the queue starts by itself' : '';
  return reply(`Work mode is on, starting from ${shortPath(folder)}${itself}. ${next} ${line}`, { enabled, folder });
}

export function stopMode(root) {
  const { enabled } = writeMode(root, { enabled: false });
  return reply('Work mode is off. Running agents finish, a look for projects stops, and nothing new starts until it is on again.', { enabled });
}

export function pauseWork(root, reference) {
  if (reference) {
    const project = findProject(root, reference);
    setProjectPaused(root, project.slug, true);
    return reply(`Paused ${nameOf(project)}. Work mode stays on, agents there finish, and nothing new starts on it until hobkin work resume ${project.slug}.`);
  }
  if (!readMode(root).enabled) return reply('Work mode is off, so nothing new starts anyway and there is nothing to pause.');
  writeMode(root, { pausedAt: new Date().toISOString() });
  return reply('Paused everywhere. Work mode stays on, running agents finish, and nothing new starts until hobkin work resume.');
}

export function resumeWork(root, reference) {
  const pauseLeft = () => planWork(root, ownerView(root)).pause?.line;
  if (reference) {
    const project = findProject(root, reference);
    setProjectPaused(root, project.slug, false);
    return reply(`Resumed ${nameOf(project)}. ${pauseLeft() ?? 'Its work is back in the queue.'}`);
  }

  const { pausedAt, subscriptionPause } = readMode(root);
  if (pausedAt || subscriptionPause) {
    writeMode(root, { pausedAt: null, subscriptionPause: null });
    return reply(`Resumed. ${pauseLeft() ?? 'The queue carries on at the next tick.'}`);
  }

  const otherPause = pauseLeft();
  return reply(otherPause ? `Nothing changed, because resume does not end this pause. ${otherPause}` : 'Nothing was paused, so nothing changed.');
}

export function takeProject(root, reference, level) {
  if (!reference) throw Error('Say which project.');
  const known = projectNamed(root, reference);
  const project = chooseProject(root, known?.slug ?? reference, levelNamed(level));
  return reply(`Took ${nameOf(project)} as ${project.level}. Its work joins the queue on the next tick.`, { slug: project.slug });
}

/** By hand, a path is checked as it never is for an agent's proposal, and a folder with a known project's name cannot take over that project. */
export function addProject(root, reference, level) {
  if (!reference) throw Error('Say which folder.');
  if (projectNamed(root, reference)) return takeProject(root, reference, level);
  const folder = realFolder(reference);
  if (!existsSync(join(folder, '.git'))) throw Error(`Not a git repository: ${shortPath(folder)}`);
  const known = readProject(root, slugOf(basename(folder)));
  if (known) throw Error(`${known.slug} is already a project, at ${shortPath(known.path ?? known.remote)}.`);
  return takeProject(root, folder, level);
}

/** The key stops a repeat, as it does for agents. A title closed for good comes back, because adding it by hand says what changed. */
export function addItem(root, reference, title, brief) {
  const project = findProject(root, reference);
  if (!title) throw Error('Say the item\'s title.');
  const { slug } = project;
  const key = `hand:${title.toLowerCase()}`;
  const before = readItems(root, slug).find(item => item.key === key);
  const filed = fileItem(root, slug, {
    key,
    kind: 'improvement',
    title,
    brief: brief ?? title,
    ...(before ? { reopen: 'Added again by hand.' } : {}),
  });

  const details = { slug, id: filed.id };
  if (before?.state === filed.state) return reply(`Already filed on ${nameOf(project)} as ${filed.id}, ${filed.state}. Nothing changed.`, details);

  // What the user adds by hand is their own word, so it goes first, in the order they add it.
  if (project.state === 'chosen') pickNext(root, `item:${slug}:${filed.id}`);
  const next = project.state === 'chosen'
    ? 'It goes first in the queue, after anything picked before it.'
    : `Nothing runs until ${nameOf(project)} is taken.`;
  return reply(`Added "${title}" to ${nameOf(project)} as ${filed.id}. ${next}`, details);
}

// The plan's own keys still work, because the tab prints them and older conversations hold them.
function rowNames(reference, target) {
  const [, kind, slug, id] = QUEUE_KEY.exec(reference ?? '') ?? [];
  if (!kind) return { name: reference, wanted: target };
  return { name: slug, wanted: kind === 'item' ? id : kind };
}

const isDiscovery = (root, name) => name === 'discover' && !projectNamed(root, name);

/** A row of the queue. `unnamed` picks one for a project when the caller named none, and a look on a project with no study yet is that study. */
function queueRow(root, reference, target, unnamed = () => null) {
  const { name, wanted } = rowNames(reference, target);
  if (isDiscovery(root, name)) return { key: 'discover', label: 'the look for projects' };
  const project = findProject(root, name);
  const { slug } = project;
  const row = wanted ?? unnamed(project);
  if (!row) throw Error('Say which row: look, study or an item.');
  if (LOOKS.includes(row)) {
    const look = row === 'look' && !existsSync(paths(root, slug).project) ? 'study' : row;
    return { project, key: `${look}:${slug}`, label: `the ${look} on ${nameOf(project)}` };
  }
  const item = findItem(root, project, row);
  return { project, item, key: `item:${slug}:${item.id}`, label: `"${item.title}" on ${nameOf(project)}` };
}

function assertCanRun(root, { project, item }) {
  if (project && project.state !== 'chosen') throw Error(`${nameOf(project)} is ${project.state}, so nothing runs on it until it is taken.`);
  if (!item) return;

  assertNotRunning(root, project, item);
  const { title, state } = item;
  if (!statesThatRun.includes(state)) throw Error(`"${title}" is ${state}, so there is nothing to run.`);
}

function whenItStarts({ mode, pause, waitingOn, entries, free }, key, owner) {
  if (!mode.enabled) return 'Work mode is off, so it waits for hobkin work start.';
  if (!owner) return NEEDS_AN_OWNER;
  if (pause) return pause.line;
  if (waitingOn) return waitingOn;

  const entry = entries.find(row => row.key === key);
  if (!entry) return 'It starts once it is due.';

  const wait = rowWait(entry, free);
  return wait ? `For now it is waiting: ${wait}.` : 'It starts on the next tick.';
}

/** A row started now goes at once, as one extra worker when none is free, and waits out no gap between starts. What still holds it is a stop, the budget or its own wait. */
function whenItStartsNow({ mode, pause, entries, next, free }, key, owner) {
  if (!mode.enabled) return 'Work mode is off, so it waits for hobkin work start.';
  if (!owner) return NEEDS_AN_OWNER;

  const asExtraWorker = free > 0 ? '' : ' as one extra worker';
  if (next?.key === key) return `It starts now${asExtraWorker}.`;
  if (pause) return pause.line;
  const wait = entries.find(row => row.key === key)?.waiting;
  if (wait) return `For now it is waiting: ${wait}.`;
  return 'It starts once it is due.';
}

/**
 * This is the plan's run-now path. It only goes first: the worker ceiling, the gap between starts, the budget and every stop still decide when it
 * starts. `now` is the user's word to start it at once, and then neither the worker ceiling nor the gap between starts counts.
 */
export function triggerRow(root, reference, target, { now = false } = {}) {
  const view = ownerView(root);
  const { entries } = planWork(root, view);
  const nextOnProject = ({ slug }) => {
    const top = entries.find(entry => entry.slug === slug && !entry.skipped);
    return top?.item?.id ?? top?.kind ?? 'look';
  };

  const row = queueRow(root, reference, target, nextOnProject);
  assertCanRun(root, row);
  if (row.item?.state === 'branch') updateItem(root, row.project.slug, row.item.id, { state: 'open' });

  if (now) {
    pickNow(root, row.key);
    const when = whenItStartsNow(planWork(root, view), row.key, view.owner);
    return reply(`Queued ${row.label} to start at once. ${when}`, { key: row.key });
  }

  pickNext(root, row.key);
  const next = whenItStarts(planWork(root, view), row.key, view.owner);
  return reply(`Queued ${row.label} to run next. ${next}`, { key: row.key });
}

// A run names its project by slug and its item by id, and the user knows them by name and title.
function runningItem(root, { slug, item: id }) {
  const project = slug ? readProject(root, slug) : null;
  const item = project && id ? readItems(root, slug).find(entry => entry.id === id) : null;
  return { project, item: item ?? null };
}

/**
 * The same as `k` on a job, from another process: the owner reads the request on its next tick and kills the run. `decline` is `Stop it: not approved`,
 * and a project runs one item at a time, so it has at most one item to say no to.
 */
export function cancelRuns(root, reference, { decline = false } = {}) {
  if (!reference) throw Error('Say what to cancel: a project, a run id or an item id.');
  const { owner, running } = ownerView(root);
  const runs = runsNamed(root, running, reference);
  if (!owner) throw Error('Nothing is running, because no dashboard is open.');
  if (!runs.length) throw Error(`Nothing is running on ${reference}. hobkin work running lists what is.`);
  const notApproved = decline ? runs.find(run => run.item) : null;
  if (decline && !notApproved) throw Error(`Nothing running on ${reference} has an item to say no to, so nothing was cancelled. hobkin work cancel ${reference} stops it for now.`);

  const ids = runs.map(({ id }) => id);
  for (const id of ids) requestCancel(root, id, Date.now(), { decline: id === notApproved?.id });

  const titles = runs.map(({ title }) => title).join(', ');
  if (!notApproved) {
    return reply(`Cancel requested for ${titles}. The owner stops it on its next tick, and a cancelled item goes to the end of the queue until hobkin work back puts it back.`, { runs: ids });
  }

  const { project, item } = runningItem(root, notApproved);
  return reply(`Cancel requested for ${titles}. The owner stops it on its next tick, then records "${item.title}" on ${nameOf(project)} as not approved, so it will not run again. Its branch stays.`, { runs: ids });
}

/** What `k` did once the user picked how a run stops. It is told like an action on a card, so the main agent hears it with their next message. */
export function toldStop(root, run, { decline = false } = {}) {
  if (!run) throw Error('It had already finished, so nothing was stopped.');
  const { project, item } = runningItem(root, run);
  if (item && decline) return cardReply(project, item, 'stopped it: not approved', named => `Stopped ${named}: not approved, so it will not run again.`);
  if (item) return cardReply(project, item, 'stopped it for now', named => `Stopped ${named} for now; it waits at the end of the queue.`);

  const line = `Stopped "${run.title}" for now.`;
  const told = {
    did: 'stopped it for now',
    ...(project ? { project: nameOf(project) } : {}),
    title: run.title,
    line,
  };
  return reply(line, { told });
}

export function skipRow(root, reference, target) {
  const { key, label } = queueRow(root, reference, target);
  skipInQueue(root, key);
  return reply(`Skipped ${label}. It stays at the end of the queue until hobkin work back puts it back.`, { key });
}

export function skipWork(root, reference, target) {
  const { name, wanted } = rowNames(reference, target);
  if (wanted || isDiscovery(root, name)) return skipRow(root, reference, target);
  const project = findProject(root, name);
  skipProject(root, project.slug);
  return reply(`Skipped ${nameOf(project)}. Nothing starts on it, and its items and branches stay.`);
}

export function putBackRow(root, reference, target) {
  const { key, label } = queueRow(root, reference, target);
  putBackInQueue(root, key);
  return reply(`Put ${label} back. It takes its place in the queue again.`, { key });
}

export function retryNow(root, reference, id) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  assertNotRunning(root, project, item);
  if (!statesThatRun.includes(item.state)) throw Error(`"${item.title}" is ${item.state}, so there is nothing to retry.`);
  retryItem(root, project.slug, item.id);
  if (movesFinishedWork(item)) return reply(`"${item.title}" goes to the front of the queue with its tries at zero.`);
  return reply(`"${item.title}" goes back in the queue with its tries at zero. Enter on its row, or hobkin work trigger, starts it now.`);
}

export function setLevel(root, reference, word) {
  const project = findProject(root, reference);
  const { level } = setProjectLevel(root, project.slug, levelNamed(word));
  return reply(`${nameOf(project)} is now ${level}. The next run there uses it, and running agents finish as they are.`);
}

export function setPriority(root, reference, word) {
  const project = findProject(root, reference);
  const changed = setProjectPriority(root, project.slug, word);
  return reply(`${nameOf(project)} is now ${changed.priority}, with a look ${everyWords(lookEveryHours(changed))}. Its work takes its new place in the queue on the next tick.`);
}

export function setPrMode(root, reference, word) {
  const project = findProject(root, reference);
  const { prMode } = setProjectPrMode(root, project.slug, word);
  return reply(`On ${nameOf(project)}, ${landings[prMode]}, from the next run.`);
}

/** `auto` hands the item back to the queue, which works its grade out again. */
export function setGrade(root, reference, id, word) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  if (!word) throw Error('Say a grade: P0 to P3, or auto.');

  const auto = word === 'auto';
  const graded = updateItem(root, project.slug, item.id, { grade: auto ? null : word });
  const grade = itemGrade(withPending(root, project), graded);
  return reply(`"${item.title}" on ${nameOf(project)} is now ${grade}${auto ? ', the grade the queue gives it' : ''}. It takes its new place on the next tick.`);
}

/** Says how to see a branch the way a reviewer sees it, in the repository that holds it: a project's own folder, or the clone Hobkin keeps of a URL. Work mode opens no panes. */
export async function openDiff(root, reference, id) {
  const project = findProject(root, reference);
  const { branch, title } = findItem(root, project, id);
  if (!branch) throw Error(`"${title}" has no branch yet, so there is no diff to show.`);

  const cwd = project.path ?? paths(root, project.slug).clone;
  const range = `${await defaultBranch(cwd)}...${branch}`;
  return reply(`To see it in pi-coder, run Pi in ${shortPath(cwd)} and type /diff ${range}.`, { range, cwd });
}

/**
 * The only way a review starts. `reviewAsked` is the user's word, so the item's next run is that review and no agent can set it. With work mode off or
 * paused a card's review of finished work goes to the main agent instead. No main agent hears a command, so `toMainAgent` is false there and it queues.
 */
export function requestReview(root, reference, id, { toMainAgent = true, now = Date.now() } = {}) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  assertNotRunning(root, project, item);
  if (![...statesThatRun, 'pr'].includes(item.state)) throw Error(`"${item.title}" is ${item.state}, so there is nothing to review.`);
  if (!item.branch) throw Error(`"${item.title}" has no branch yet, so there is nothing to review.`);

  const held = whyWorkModeWaits(readMode(root), now);
  if (held && toMainAgent && isFinished(item)) {
    return handOff(root, { project, item, why: held, now }, REVIEW_JOB);
  }

  updateItem(root, project.slug, item.id, { reviewAsked: true });
  retryItem(root, project.slug, item.id);
  return cardReply(project, item, ASKED_REVIEW, named => `${named} goes to the front of the queue for a review.${queuedWhile(held)} It leaves the list while it is reviewed, and comes back to approve with its grade.`);
}

const firstLine = text => String(text).split('\n', 1)[0];
const whyNoMerge = (error, base, title) => {
  if (error.message === 'conflict') return `"${title}" conflicts with ${base}, so nothing changed. Send an agent back to rebase it.`;
  if (/overwritten|uncommitted|local changes/i.test(`${error.stderr} ${error.message}`)) return 'The folder has uncommitted changes in files this merge touches, so nothing changed.';
  return `"${title}" did not merge: ${firstLine(error.stderr || error.message)}`;
};

/** Finished branches the default branch now holds, because a branch brings along whatever it was built on. Each is a landed change of its own. */
async function closeWhatLanded({ root, repo, slug, merged, target, landing, now }) {
  const finished = readItems(root, slug).filter(item => item.id === merged.id || (item.state === 'branch' && item.branch));
  const held = await Promise.all(finished.map(item => isMerged(repo, item.branch, target)));
  const closing = finished.filter((_item, index) => held[index]);
  const units = readUnmerged(root).projects[slug]?.open ?? [];
  const at = new Date(now).toISOString();
  for (const item of closing) {
    const unit = units.find(({ branch }) => branch === item.branch);
    const { size = null, area = null } = item.id === merged.id ? landing : unit ?? {};
    const landed = landedRecord(item, { ...landing, sha: target, at, safety: unit?.safety, size, area, spot: item.id === merged.id && landing.spot });
    updateItem(root, slug, item.id, { state: 'merged', mergedAt: at, ...AFTER_MERGE, ...(item.kind === SHIP_KIND ? {} : { landed }) }, now);
  }
  return closing.length;
}

const assertSameHead = (title, offered, head) => {
  if (offered && offered !== head) throw Error(`"${title}" moved since it was offered, so nothing merged. It needs reading again.`);
};

/**
 * The only merge in work mode, and only ever the user's word. It stays on this machine: pushing is a separate step they take. `head` is the commit the
 * user was asked about, and `route`, `read` and `readMs` say how they came to say yes, for what `landed` records.
 */
export async function mergeItem(root, reference, id, { route = 'chat', read = 'none', readMs = 0, head = null, now = Date.now() } = {}) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  const { title, branch, state } = item;
  assertNotRunning(root, project, item);
  if (!statesThatMerge.includes(state) || !branch) throw Error(`"${title}" is ${state}, so there is no local branch to merge.`);

  const repo = project.path ?? paths(root, project.slug).clone;
  const base = await defaultBranch(repo);
  const tip = await landingTip(repo, base);
  if (!tip) throw Error(`"${title}" did not merge: ${nameOf(project)} has no ${base || 'default branch'} to merge into.`);
  assertSameHead(title, head, await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`));
  if (await isMerged(repo, branch, tip)) throw Error(`"${title}" holds nothing ${base} lacks, so nothing changed.`);

  const facts = await changeFacts(repo, base, branch);
  const { offer } = weighedRows(root, now).find(({ row }) => row.slug === project.slug && row.item === item.id) ?? {};
  const target = await landBranch({ repo, base, branch, tip, message: `Merge: ${title}` })
    .catch(error => { throw Error(whyNoMerge(error, base, title)); });
  const landing = { ...facts, route, read, readMs, spot: Boolean(offer?.spot) };
  const closed = await closeWhatLanded({ root, repo, slug: project.slug, merged: item, target, landing, now });
  const others = closed - 1;
  const alongside = others > 0 ? ` It brought ${others} earlier ${others === 1 ? 'branch' : 'branches'} with it.` : '';
  const message = `Merged "${title}" into ${base} on ${nameOf(project)}.${alongside} Nothing was pushed.`;
  return reply(message, { target, route, told: toldOfMerge(project, item, 'merged it locally', message) });
}

const MERGE_PR_TIMEOUT_MS = 2 * 60000;
const browserOpener = process.platform === 'darwin' ? 'open' : 'xdg-open';

function prOf(root, reference, id) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  if (item.state !== 'pr' || !item.pr) throw Error(`"${item.title}" is ${item.state}, so it has no open PR.`);
  return { project, item };
}

/**
 * A PR lands on its host, and only on the user's word, so this is the one place hobkin asks its host to merge one. `head` is the commit the user
 * saw, so a PR that moved since is refused there. A merge that went through closes the item now, with what the host says of it.
 */
export async function mergePullRequest(root, reference, id, { head = null, gh = ghWithin(MERGE_PR_TIMEOUT_MS), now = Date.now() } = {}) {
  const { project, item } = prOf(root, reference, id);
  const repo = project.path ?? paths(root, project.slug).clone;
  const pinned = head ? ['--match-head-commit', head] : [];
  await gh(['pr', 'merge', item.pr, '--merge', ...pinned], repo).catch(error => {
    throw Error(`"${item.title}" did not merge: ${firstLine(error.stderr || error.message)}`);
  });
  const pull = await pullNow(item.pr, repo, gh);
  closeMergedPull(root, project.slug, item, pull, now);

  const named = `the PR for "${item.title}" on ${nameOf(project)}`;
  return reply(`Merged ${named}.`, { told: toldOfMerge(project, item, 'merged the PR', `Merged ${named}: ${item.pr}.`) });
}

/** Opens an item's PR in the browser, to read or comment on it there. */
export async function openPullRequest(root, reference, id, { open = url => run(browserOpener, [url]) } = {}) {
  const { item } = prOf(root, reference, id);
  await open(item.pr);
  return reply(`Opened ${item.pr} in the browser.`);
}

const OPENED_PR = 'opened its PR';

/**
 * A PR's body: its branch's description, or else its brief. Work that came from a GitHub issue says it fixes that issue, so GitHub closes the
 * issue when the PR merges, and its description says so too. On a project that deploys, the issue stays open until the deploy that carries it
 * held (`deploys.mjs`), so the PR only refers to it, and a description that says it fixes the issue is made to refer to it instead.
 */
function bodyOf(description, { brief, title, issue }, { deploys }) {
  const named = issue ? `${issue.repo}#${issue.number}` : null;
  const line = named ? `${deploys ? 'Refs' : 'Fixes'} ${named}` : null;
  if (!existsSync(description)) return ['--body', [brief ?? title, line].filter(Boolean).join('\n\n')];
  const text = readFileSync(description, 'utf8');
  // The line a run writes, as `work-do.md` asks, is the one changed.
  const said = deploys && named ? text.split('\n').map(each => (each.trim().toLowerCase() === `fixes ${named}`.toLowerCase() ? line : each)).join('\n') : text;
  const kept = line && !said.toLowerCase().includes(line.toLowerCase()) ? `${said.trimEnd()}\n\n${line}\n` : said;
  if (kept !== text) writeFileSync(description, kept);
  return ['--body-file', description];
}

/** The open PR its host has for a branch, if any, so approving a branch twice never opens a second one. */
async function openPullFor(repo, origin, branch, gh) {
  const list = JSON.parse(await gh(['pr', 'list', '--repo', origin, '--head', branch, '--state', 'open', '--json', 'url,headRefOid'], repo));
  return Array.isArray(list) ? list[0] ?? null : null;
}

/**
 * The user approved a finished branch, and this opens its PR: the branch goes to the project's origin at exactly the commit they approved, and its
 * host gets a PR for it, or the open one it already has is kept. The item then waits on its PR, as one a run opened does, so its card offers to merge
 * that PR. Only ever the user's word. `head` is the commit they approved, so a branch that moved since opens nothing.
 */
export async function publishItem(root, reference, id, { head = null, gh = ghWithin(MERGE_PR_TIMEOUT_MS), now = Date.now() } = {}) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  const { title, branch, state } = item;
  assertNotRunning(root, project, item);
  if (state === 'pr' && item.pr) return cardReply(project, item, OPENED_PR, named => `${named} has its PR open already.`);
  if (!statesThatMerge.includes(state) || !branch) throw Error(`"${title}" is ${state}, so there is no finished branch to open a PR for.`);

  const repo = project.path ?? paths(root, project.slug).clone;
  const tip = await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (!tip) throw Error(`"${title}" has no branch ${branch} here, so no PR was opened.`);
  if (head && head !== tip) throw Error(`"${title}" moved since it was approved, so no PR was opened. It needs reading again.`);
  const origin = await gitOrNothing(repo, 'remote', 'get-url', 'origin');
  if (!origin) throw Error(`${nameOf(project)} has no origin to push to, so no PR was opened.`);

  await run('git', ['-C', repo, 'push', 'origin', `${tip}:refs/heads/${branch}`], { timeout: MERGE_PR_TIMEOUT_MS }).catch(error => {
    throw Error(`"${title}" was not pushed: ${firstLine(error.stderr || error.message)}`);
  });
  const open = await openPullFor(repo, origin, branch, gh);
  let url = open?.url;
  if (!url) {
    const body = bodyOf(prFile(root, project.slug, item.id), item, { deploys: Boolean(deployPathOf(root, project.slug)) });
    const draft = project.prMode === 'draft' ? ['--draft'] : [];
    const base = await defaultBranch(repo);
    const created = await gh(['pr', 'create', '--repo', origin, '--head', branch, '--base', base, '--title', title, ...body, ...draft], repo).catch(error => {
      throw Error(`"${title}" was pushed, and its PR did not open: ${firstLine(error.stderr || error.message)}`);
    });
    url = created.trim().split('\n').at(-1);
  }

  const waiting = updateItem(root, project.slug, item.id, { state: 'pr', pr: url }, now);
  return cardReply(project, waiting, OPENED_PR, named => (open ? `${named} already had a PR open for its branch, and now waits on it.` : `Opened a PR for ${named}.`));
}

/**
 * `done` means no change was needed, so a branch holding commits the default branch lacks is finished work, whatever a run called it.
 * A fix's run works on a branch that belongs to the item that made it. With nothing to read here the run's word stands.
 */
export async function trueOutcome(root, slug, change) {
  if (change.state !== 'done') return change;
  const item = readItems(root, slug).find(({ id }) => id === change.id);
  const branch = change.branch ?? item?.branch;
  const project = readProject(root, slug);
  if (!branch || !project || item?.kind === SHIP_KIND) return change;

  const repo = project.path ?? paths(root, slug).clone;
  const tip = await landingTip(repo, await defaultBranch(repo));
  const ahead = tip && await gitOrNothing(repo, 'rev-list', '--count', `${tip}..refs/heads/${branch}`);
  return Number(ahead) > 0 ? { ...change, state: 'branch', branch } : change;
}

/** A no or a branch sent back counts against its pattern, so this keeps the area it had, which nothing else will once the survey moves on. */
function pushbackOn(root, { slug }, { branch, pushbacks = [] }, now) {
  const unit = (readUnmerged(root).projects[slug]?.open ?? []).find(known => known.branch === branch);
  return { pushbacks: [...pushbacks, { at: new Date(now).toISOString(), area: unit?.area ?? null }] };
}

function recordNo(root, project, item, now) {
  updateItem(root, project.slug, item.id, { state: 'declined', ...pushbackOn(root, project, item, now) }, now);
}

/** A no is the user's answer, and it is what learning reads. The branch stays, so changing their mind costs nothing. */
export function declineItem(root, reference, id, now = Date.now()) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  assertNotRunning(root, project, item);
  recordNo(root, project, item, now);
  return cardReply(project, item, 'said no', named => `Said no to ${named}. Its branch stays, and hobkin learns from this.`);
}

/** The same no, for a run the user stopped as not approved. The owner records it once that run has ended, so nothing the run recorded on its way out stands. */
export function declineStopped(root, slug, id, now = Date.now()) {
  const { project, item } = runningItem(root, { slug, item: id });
  if (item) recordNo(root, project, item, now);
}

// Items nothing works on any more, so a branch only they name is free to go.
const overStates = ['merged', 'done', 'declined', 'dropped'];
const DELETE_BRANCH_TIMEOUT_MS = 2 * 60000;

/** The branch an item made for itself is `hobkin/` and its work name, which starts with its id. A fix on another item's branch has none of its own. */
const isOwnBranch = ({ id }, branch) => branch === `${BRANCH_PREFIX}${id}` || branch.startsWith(`${BRANCH_PREFIX}${id}-`);

/** The files and folders git ignores in a tree, by the pattern that matched them, sorted: `.env`, `build/`. */
async function ignoredIn(tree) {
  const listed = await gitOrNothing(tree, 'status', '--porcelain', '-z', '--ignored=matching', '--untracked-files=normal');
  return listed.split('\0').filter(entry => entry.startsWith('!! ')).map(entry => entry.slice(3)).sort();
}

/** The item's own tree, once it let go of its branch at a commit of that branch: it goes with the branch, or it would hold those commits for good. */
async function treeLeftOn(root, slug, item, tips) {
  const tree = itemTree(root, slug, item);
  if (!statSync(join(tree, '.git'), { throwIfNoEntry: false })?.isFile() || await currentBranch(tree)) return null;
  const at = await gitOrNothing(tree, 'rev-parse', '--verify', '--quiet', 'HEAD');
  const onIt = at ? await Promise.all(tips.map(tip => isMerged(tree, at, tip))) : [];
  return onIt.some(Boolean) ? realPlace(tree) : null;
}

/**
 * What deleting an item's own branch takes, read and never changed: the branch on this Mac and on origin, the hobkin tree that goes with it, and how
 * many commits are on it alone. It refuses, before anything goes, while the item runs, when the branch is not the item's own or another item still
 * works on it, and when the user's own folder, or any folder hobkin did not make, has it checked out. A tree goes only when nothing in it is uncommitted.
 */
async function whatDeletingTakes(root, project, item) {
  const { slug } = project;
  const { title, branch } = item;
  if (ownerView(root).running.some(run => run.slug === slug && run.item === item.id)) throw Error(`"${title}" is running, so its branch cannot be deleted now.`);
  if (!branch) throw Error(`"${title}" has no branch of its own, so there is nothing to delete.`);
  const repo = project.path ?? paths(root, slug).clone;
  if (!isOwnBranch(item, branch) || branch === await defaultBranch(repo)) throw Error(`${branch} is not the branch "${title}" made for itself, so it is not deleted.`);
  const sharing = readItems(root, slug).find(other => other.id !== item.id && other.branch === branch && !overStates.includes(other.state));
  if (sharing) throw Error(`"${sharing.title}" works on ${branch} too, so it is not deleted.`);

  const here = await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`) || null;
  const pushed = await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`) || null;
  if (!here && !pushed) throw Error(`${branch} is gone already, on this Mac and on origin, so there is nothing to delete.`);
  const tips = [here, pushed].filter(Boolean);

  const holder = here ? await worktreeOn(repo, branch) : null;
  if (holder && holder === realPlace(repo)) throw Error(`${branch} is checked out in the project's own folder, ${shortPath(repo)}, so it is not deleted. Switch that folder to another branch first.`);
  if (holder && !holder.startsWith(`${realPlace(paths(root, slug).trees)}${sep}`)) throw Error(`${branch} is checked out in ${shortPath(holder)}, a folder hobkin did not make, so it is not deleted.`);
  const worktree = holder ?? await treeLeftOn(root, slug, item, tips);
  // Every untracked file counts, also where the project's own git config hides them from a plain status.
  if (worktree && await gitOrNothing(worktree, 'status', '--porcelain', '--untracked-files=all')) throw Error(`Its worktree at ${shortPath(worktree)} has changes that were never committed, so nothing is deleted.`);
  // What git ignores in the tree, such as a .env or a build, goes with it, so the preview names it.
  const ignored = worktree ? await ignoredIn(worktree) : [];

  const url = pushed ? await gitOrNothing(repo, 'remote', 'get-url', 'origin') : '';
  // Commits no other branch or tag on this Mac holds. A remote-tracking branch is left out: it can name a branch that origin no longer has.
  // Git says nothing when it cannot count them.
  const lost = await gitOrNothing(repo, 'rev-list', '--count', ...tips, '--not', `--exclude=${branch}`, '--branches', '--tags');
  return { branch, here, remote: pushed ? { name: 'origin', url, sha: pushed } : null, worktree, ignored, lost: lost === '' ? null : Number(lost) };
}

/**
 * Deletes an item's own branch, only ever on the user's word, after they were shown what it takes: `look` reads that and deletes nothing, and the
 * deletion goes only when `expect` is exactly what the look answered. Its tree goes first, because git keeps a branch a tree holds, then the branch
 * on this Mac, then on origin, each pinned to the commit that was shown. A step that fails says what was already done and stops there. Nothing else
 * is touched: no other branch, never the default branch, and never the user's own folder.
 */
export async function deleteItemBranch(root, reference, id, { look = false, expect = null } = {}) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  const plan = await whatDeletingTakes(root, project, item);
  const { branch, here, remote, worktree } = plan;
  const where = [here && 'on this Mac', remote && 'on origin'].filter(Boolean).join(' and ');
  if (look) return reply(`It deletes ${branch} ${where}${worktree ? `, with its worktree${plan.ignored.length ? ' and the files git ignores in it' : ''}` : ''}.`, { plan });
  if (JSON.stringify(expect) !== JSON.stringify(plan)) throw Error(`What deleting ${branch} takes has changed since it was shown, so nothing was deleted.`);

  const repo = project.path ?? paths(root, project.slug).clone;
  const git = gitWithin(DELETE_BRANCH_TIMEOUT_MS);
  const done = [];
  const stopped = (missed, error) => {
    const said = done.length ? `${done.join(' and ')}, but ${missed}` : `Nothing was deleted: ${missed}`;
    return Error(error ? `${said}: ${firstLine(error.stderr || error.message).trim()}` : `${said}.`);
  };
  if (worktree) {
    if (!await retireTree({ repo, tree: worktree })) throw stopped(`git would not remove its worktree at ${shortPath(worktree)}`);
    done.push('Removed its worktree');
  }
  if (here) {
    await git(repo, 'update-ref', '-d', `refs/heads/${branch}`, here).catch(error => { throw stopped(done.length ? `${branch} was not deleted on this Mac` : `git would not delete ${branch}`, error); });
    await gitOrNothing(repo, 'config', '--remove-section', `branch.${branch}`);
    done.push(`${done.length ? 'deleted' : 'Deleted'} ${branch} on this Mac`);
  }
  if (remote) {
    await git(repo, 'push', '--quiet', `--force-with-lease=refs/heads/${branch}:${remote.sha}`, 'origin', `:refs/heads/${branch}`).catch(async error => {
      // Gone from origin already, as when its pull request was merged with its branch deleted there: what this Mac remembers of it goes too.
      if (/remote ref does not exist/.test(error.stderr ?? '')) return gitOrNothing(repo, 'update-ref', '-d', `refs/remotes/origin/${branch}`);
      throw stopped(done.length ? 'it was not deleted on origin' : `origin would not delete ${branch}`, error);
    });
  }
  return reply(`Deleted ${branch} ${where}${worktree ? ', and removed its worktree' : ''}.`, { deleted: plan });
}

/**
 * Sends an agent back to a finished branch or PR with the user's words, which go first in the queue like a review does. With work mode off or paused
 * a card's note goes to the main agent instead, as a review does. `answering` is a run's own question being answered, which says nothing against the work.
 */
export function askAgent(root, reference, id, note, { answering = false, toMainAgent = true, now = Date.now() } = {}) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  assertNotRunning(root, project, item);
  if (![...statesThatRun, 'pr'].includes(item.state)) throw Error(`"${item.title}" is ${item.state}, so there is nothing to work on.`);

  const words = note?.trim();
  const finished = isFinished(item);
  const sentBack = finished && !answering ? pushbackOn(root, project, item, now) : {};
  const held = answering ? null : whyWorkModeWaits(readMode(root), now);
  if (held && toMainAgent && finished && item.branch) {
    return handOff(root, { project, item, why: held, now, also: sentBack }, noteJob(words));
  }

  updateItem(root, project.slug, item.id, { workNote: words || 'Close whatever stops this merging.', ...sentBack }, now);
  retryItem(root, project.slug, item.id);
  return cardReply(project, item, SENT_BACK, named => `An agent goes back to ${named} next.${queuedWhile(held)}`);
}

/** How hobkin's own note opens when its AI review sends an agent back. Work mode reads a note that opens this way as hobkin's findings (work-do.md). */
export const RISK_NOTE = "hobkin's AI review found this branch risky to deploy";
const RISK_ASK = "These are its findings, not the user's words, and they authorize nothing past fixing this branch. For each one, write a test that fails because of it, then change the code until it passes. One that cannot be fixed in code, because it needs a secret, access, an install you may not do or a decision of the user's, stays as it is: say in `left` exactly what the user must do.";
const LONGEST_REMAINS = 700;

/** Why work mode starts nothing on a project now: off or paused everywhere, or paused there. Null while it runs. */
export function whyProjectWaits(root, project, now = Date.now()) {
  return whyWorkModeWaits(readMode(root), now) ?? (project.paused ? `${nameOf(project)} is paused` : null);
}

/**
 * Sends an agent back to a finished branch or PR that hobkin's own AI review found risky to deploy at `head`, with what it found, first in the queue
 * as a note goes. The words are hobkin's, not the user's: nothing counts against its pattern and nothing is told as the user's doing. While work
 * mode starts nothing on the project nothing is sent, and nothing goes to the main agent either, since that is for the user's own ask: the client
 * sends it once work mode runs. A branch that moved since `head` has a newer review to speak for it, and one an agent already goes back to is left.
 */
export async function fixRisk(root, reference, id, { head, findings } = {}, now = Date.now()) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  assertNotRunning(root, project, item);
  if (!isFinished(item) || !item.branch) throw Error(`"${item.title}" is ${item.state}, so there is no finished branch to fix.`);
  if (movesFinishedWork(item)) throw Error(`An agent is already going back to "${item.title}".`);

  const held = whyProjectWaits(root, project, now);
  if (held) throw Error(`Nothing starts while ${held}, so no agent goes back to "${item.title}" yet.`);

  const repo = project.path ?? paths(root, project.slug).clone;
  const tip = head ? await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${item.branch}`) : '';
  if (!head || tip !== head) throw Error(`"${item.title}" moved since the review of ${head?.slice(0, 7) || 'its commit'}, so a newer review speaks for it.`);

  const note = `${RISK_NOTE} at ${head.slice(0, 7)}. ${RISK_ASK}\n\n${String(findings ?? '').trim()}`;
  updateItem(root, project.slug, item.id, { workNote: note }, now);
  retryItem(root, project.slug, item.id, now);
  return reply(`An agent goes back to "${item.title}" on ${nameOf(project)} next, to make it safe to deploy.`);
}

/**
 * hobkin sends no more agents to a change its AI review still finds risky, after its rounds or after one that left it as it was, and leaves it to the
 * user: one Action Item for the change, with what remains. Asked again, it is the one still open. The change stays where it is.
 */
export function riskStays(root, reference, id, { head, rounds, why, findings } = {}, now = Date.now()) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  const named = `"${item.title}" on ${nameOf(project)}`;
  const after = why === 'unchanged' ? 'its agent went back to it and left it as it was.' : `after ${rounds} round${rounds === 1 ? '' : 's'} of fixes.`;
  const remains = String(findings ?? '').trim();
  const remainsShown = remains.length > LONGEST_REMAINS ? `${remains.slice(0, LONGEST_REMAINS - 1).trimEnd()}…` : remains;
  const detail = [
    `hobkin's AI review still finds ${named} risky to deploy at ${String(head ?? '').slice(0, 7)}, ${after}`,
    remainsShown && `What remains: ${remainsShown}`,
  ].filter(Boolean).join(' ');

  const { id: action } = fileActionItem(root, {
    title: `Still risky to deploy: ${item.title}`,
    detail,
    why: 'hobkin sends an agent back to a risky change at most twice, so the rest is yours: fix it, merge it anyway or say no to it from its review.',
    key: `risk:${project.slug}:${item.id}`,
    from: `AI review, ${nameOf(project)}`,
    answerTo: { kind: 'action', risk: { slug: project.slug, item: item.id } },
  }, now);
  return reply(`${named} is still risky to deploy, so it waits in Action Items.`, { action });
}

const stateOf = (root, slug, id) => readItems(root, slug).find(item => item.id === id)?.state;

async function mergeOffered({ root, slug, rows, route, now }) {
  const merged = [];
  for (const { item, head } of rows) {
    // A branch earlier in the list can bring this one along.
    if (stateOf(root, slug, item) !== 'branch') continue;
    try {
      merged.push((await mergeItem(root, slug, item, { route, head, now })).message);
    } catch (error) {
      throw Error(merged.length ? `Merged ${merged.length} of ${rows.length}, then stopped, and the rest are as they were. ${error.message}` : error.message);
    }
  }
  return reply(merged.length === 1 ? merged[0] : `Merged all ${rows.length}. Nothing was pushed.`);
}

/**
 * Carries out the answer to an offer. `later` and `read` hold it for a day, because the same question twice is the worst call hobkin can make. `no` declines.
 * A failed merge throws, so the decision stays open and says why. What has already gone from the list has nothing left to answer.
 */
export async function answerOffer(root, offered, value, now = Date.now()) {
  const { slug } = offered;
  const rows = offeredIn(offered).filter(({ item }) => stateOf(root, slug, item) === 'branch');
  if (!rows.length) return reply('That has already gone from the list, so nothing changed.');
  if (value === 'merge') return mergeOffered({ root, slug, rows, route: offered.also?.length ? 'batch' : 'offer', now });

  for (const { item } of rows) {
    if (value === 'no') declineItem(root, slug, item, now);
    else updateItem(root, slug, item, { offerHeldUntil: new Date(now + OFFER_HOLD_MS).toISOString() }, now);
  }
  return reply(value === 'no' ? 'Said no. The branches stay, and hobkin learns from this.' : 'Held for a day.');
}

/** The user's switch for a pattern, and the only way back on after severe trouble. Its record stays as it is: trouble has already reset that. */
export function trustPattern(root, pattern, word) {
  if (!['on', 'off'].includes(word)) throw Error('Say trust <pattern> on or trust <pattern> off.');
  const [, reference, kind] = PATTERN.exec(pattern ?? '') ?? [];
  if (!doableKinds.includes(kind)) throw Error('A pattern is project/kind/area, as hobkin work offers prints it.');

  const { slug } = findProject(root, reference);
  const named = pattern.replace(reference, slug);
  setTrust(root, named, word === 'on');
  const said = {
    on: `Offers can come for ${named} again. After trouble that means from its next clean merge.`,
    off: `No offers for ${named} until hobkin work trust ${named} on.`,
  };
  return reply(said[word], { pattern: named });
}

/** Asks `git` and `gh` now instead of at the next survey. Past a fetch they only read the repositories: all this changes is Hobkin's own record of its items. */
export async function syncWork(root) {
  const { settled, filed, retired, reviewing, pulse } = await surveyAndClose(root, { launchReviews: false });
  const merged = settled.filter(({ state }) => state === 'merged').length;
  const back = settled.length - merged;
  const found = [
    merged && `${merged} merged`,
    back && `${back} back to a local branch, because a PR was closed`,
    filed.length && `${filed.length} ${filed.length === 1 ? 'branch' : 'branches'} to get ready to merge`,
    retired.length && `${retired.length} dropped as ${retired.length === 1 ? 'a backup of another branch' : 'backups of other branches'}`,
    reviewing.length && `${reviewing.length} sent for a review`,
    pulse.trouble.length && `${pulse.trouble.length} went wrong after landing`,
  ].filter(Boolean).join(', and ');
  return reply(`Checked every project. ${found || 'Nothing was merged or closed'}.`, { settled, filed, retired, reviewing });
}

/** The user's word that a merge went wrong. It takes no proof: it closes the launch as `trouble` and files the fix, and `severe` is for data loss or an outage. */
export function callTrouble(root, reference, id, ...words) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  const severe = words[0] === 'severe';
  const why = words.slice(severe ? 1 : 0).join(' ').trim();
  const fix = userTrouble(root, project.slug, item, { severe, ...(why ? { why } : {}) });
  const next = fix ? `"${fix.title}" is at the front of the queue.` : 'A fix for it is already filed.';
  return reply(`Recorded trouble on "${item.title}". ${next} Nothing was rolled back.`, { fix: fix?.id ?? null });
}

export function dropWork(root, reference, id) {
  const project = findProject(root, reference);
  if (!id) {
    dropProject(root, project.slug);
    return reply(`Dropped ${nameOf(project)}. Agents there finish, nothing new starts, and its items, branches and PRs stay.`);
  }
  const item = findItem(root, project, id);
  assertNotRunning(root, project, item);
  updateItem(root, project.slug, item.id, { state: 'dropped' });
  return reply(`Dropped "${item.title}" from ${nameOf(project)}. It leaves the queue, and its branch and PR stay.`);
}

export function markDone(root, reference, id) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  assertNotRunning(root, project, item);
  updateItem(root, project.slug, item.id, { state: 'done', left: null, closedByUser: true });
  return cardReply(project, item, 'marked it done', named => `${named} is done. It leaves the queue, and any branch or PR stays as it is.`);
}

export function markMax(root, reference, id) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  updateItem(root, project.slug, item.id, { max: true });
  return reply(`"${item.title}" on ${nameOf(project)} is now max: it goes ahead of critical work, one run at a time and six a day.`);
}

export function answerAllow(root, word) {
  if (word === 'no') {
    answerAllowance(root, false);
    return reply('Today\'s limit stays, and nothing asks again today.');
  }
  const { raisedTo } = answerAllowance(root, word ? Number(word) : true);
  return reply(`Today's limit is ${tokenLabel(raisedTo)} until midnight, and the hourly share rises with it.`);
}
