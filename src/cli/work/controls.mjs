import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { followInBackground } from '../session.mjs';
import { shortPath } from './chat.mjs';
import { findItem, findProject, nameOf, projectNamed, runsNamed } from './names.mjs';
import { agentName, insideHerdr, SESSION_TAB, WorkPanes } from './panes.mjs';
import { itemGrade, planWork, rowWait, withPending } from './plan.mjs';
import { NEEDS_AN_OWNER } from './reads.mjs';
import {
  answerAllowance, chooseProject, dropProject, fileItem, lookEveryHours, ownerView, paths, pickNext, putBackInQueue, readItems, readMode, readProject, realFolder, requestCancel,
  retryItem, runnableStates, setProjectLevel, setProjectPaused, setProjectPrMode, setProjectPriority, skipInQueue, skipProject, slugOf, startWork, tokenLabel, updateItem, writeMode,
} from './store.mjs';
import { defaultBranch } from './tree.mjs';
import { surveyUnmerged } from './unmerged.mjs';

const QUEUE_KEY = /^(item|look|study|ideas):([^:]+)(?::(.+))?$/;
const LOOKS = ['look', 'study', 'ideas'];
// A finished branch can go round again. Its item goes back to `open`, and the next run picks up from that branch.
const statesThatRun = [...runnableStates, 'branch'];
const landings = {
  off: 'finished work stays on a local branch with its description, for the user to review',
  draft: 'finished work opens a draft PR',
  published: 'finished work opens a PR',
};

/** One line: what happened and what comes next. A failure throws, and `printWorkCommand` says it the same way. */
export const reply = (message, details = {}) => ({ ok: true, message, ...details });

// `low` is how people say the lowest level.
const levelNamed = word => (word === 'low' ? 'casual' : word);

function assertNotRunning(root, { slug }, { id, title }) {
  const running = ownerView(root).running.some(run => run.slug === slug && run.item === id);
  if (running) throw Error(`"${title}" is already running. hobkin work cancel ${id} stops it.`);
}

export function startMode(root, requested) {
  const { enabled, folder } = startWork(root, requested);
  const next = ownerView(root).owner ? 'The owner picks it up on its next tick.' : NEEDS_AN_OWNER;
  return reply(`Work mode is on, starting from ${shortPath(folder)}. ${next}`, { enabled, folder });
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

  if (readMode(root).pausedAt) {
    writeMode(root, { pausedAt: null });
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

  const next = project.state === 'chosen'
    ? `It takes its place in the queue, and hobkin work trigger ${slug} ${filed.id} runs it next.`
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

/** This is the plan's run-now path. It only goes first: the worker ceiling, the budget and every stop still decide when it starts. */
export function triggerRow(root, reference, target) {
  const view = ownerView(root);
  const { entries } = planWork(root, view);
  const nextOnProject = ({ slug }) => {
    const top = entries.find(entry => entry.slug === slug && !entry.skipped);
    return top?.item?.id ?? top?.kind ?? 'look';
  };

  const row = queueRow(root, reference, target, nextOnProject);
  assertCanRun(root, row);
  if (row.item?.state === 'branch') updateItem(root, row.project.slug, row.item.id, { state: 'open' });
  pickNext(root, row.key);

  const next = whenItStarts(planWork(root, view), row.key, view.owner);
  return reply(`Queued ${row.label} to run next. ${next}`, { key: row.key });
}

/** The same as `k` on a job, from another process: the owner reads the request on its next tick and kills the run. */
export function cancelRuns(root, reference) {
  if (!reference) throw Error('Say what to cancel: a project, a run id or an item id.');
  const { owner, running } = ownerView(root);
  const runs = runsNamed(root, running, reference);
  if (!owner) throw Error('Nothing is running, because no dashboard is open.');
  if (!runs.length) throw Error(`Nothing is running on ${reference}. hobkin work running lists what is.`);
  const ids = runs.map(({ id }) => id);
  for (const id of ids) requestCancel(root, id);

  const titles = runs.map(({ title }) => title).join(', ');
  return reply(`Cancel requested for ${titles}. The owner stops it on its next tick, and a cancelled item goes to the end of the queue until hobkin work back puts it back.`, { runs: ids });
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
  return reply(`"${item.title}" goes to the front of the queue with its tries at zero.`);
}

export function setLevel(root, reference, word) {
  const project = findProject(root, reference);
  const { level } = setProjectLevel(root, project.slug, levelNamed(word));
  return reply(`${nameOf(project)} is now ${level}. The next run there uses it, and running agents finish as they are.`);
}

export function setPriority(root, reference, word) {
  const project = findProject(root, reference);
  const changed = setProjectPriority(root, project.slug, word);
  return reply(`${nameOf(project)} is now ${changed.priority}, with a look every ${lookEveryHours(changed)} hours. Its work takes its new place in the queue on the next tick.`);
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

const diffPanes = () => (insideHerdr() ? new WorkPanes({ tab: SESSION_TAB }) : null);

/** Shows a branch the way a reviewer sees it, in the repository that holds it: a project's own folder, or the clone Hobkin keeps of a URL. */
export async function openDiff(root, reference, id, { panes = diffPanes(), follow = followInBackground } = {}) {
  const project = findProject(root, reference);
  const { branch, title } = findItem(root, project, id);
  if (!branch) throw Error(`"${title}" has no branch yet, so there is no diff to show.`);

  const cwd = project.path ?? paths(root, project.slug).clone;
  const range = `${await defaultBranch(cwd)}...${branch}`;
  if (!panes) return reply(`Outside Herdr there is no pane to open. Run Pi in ${shortPath(cwd)} and type /diff ${range}.`, { range, cwd });

  // Herdr refuses a name already in use, and the same diff can be open twice.
  const name = agentName('diff', `${randomBytes(2).toString('hex')}-${project.slug}`);
  const { pane } = await panes.startDiff({ name, cwd, range });
  follow({ name, pane });
  return reply(`"${title}" is open in pi-coder, in pane ${pane}. It closes by itself a few minutes after you leave it.`, { range, cwd, pane });
}

/** Asks `git` and `gh` now instead of at the next survey. They only read the repositories: all this changes is Hobkin's own record of its items. */
export async function syncWork(root) {
  const { settled, filed } = await surveyUnmerged(root);
  const merged = settled.filter(({ state }) => state === 'merged').length;
  const back = settled.length - merged;
  const found = [
    merged && `${merged} merged`,
    back && `${back} back to a local branch, because a PR was closed`,
    filed.length && `${filed.length} ${filed.length === 1 ? 'branch' : 'branches'} to get ready to merge`,
  ].filter(Boolean).join(', and ');
  return reply(`Checked every project. ${found || 'Nothing was merged or closed'}.`, { settled, filed });
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
  updateItem(root, project.slug, item.id, { state: 'done', left: null });
  return reply(`"${item.title}" on ${nameOf(project)} is done. It leaves the queue, and any branch or PR stays as it is.`);
}

export function markMax(root, reference, id) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  updateItem(root, project.slug, item.id, { max: true });
  return reply(`"${item.title}" on ${nameOf(project)} is now max: Claude Opus at max effort in a Herdr pane, whatever harness is set, and the normal harness at its best outside one.`);
}

export function answerAllow(root, word) {
  if (word === 'no') {
    answerAllowance(root, false);
    return reply('Today\'s limit stays, and nothing asks again today.');
  }
  const { raisedTo } = answerAllowance(root, word ? Number(word) : true);
  return reply(`Today's limit is ${tokenLabel(raisedTo)} until midnight, and the hourly share rises with it.`);
}
