import { existsSync, readFileSync } from 'node:fs';
import { lookTime } from './chat.mjs';
import { findItem, findProject, nameOf } from './names.mjs';
import { itemGrade, planWork, rowWait, withPending } from './plan.mjs';
import {
  byPriority, byRank, chosenProjects, currentRequest, itemStates, landing, nextLookAt, ownerView, prFile, priorityOf, readItems, readMode, readProjects, runnableStates, tokenLabel,
} from './store.mjs';
import { readUnmerged } from './unmerged.mjs';

const projectStates = ['chosen', 'proposed', 'skipped', 'dropped'];
// Work that is over asks nothing more of the user, whatever its run left.
const overStates = ['merged', 'dropped'];
const SECOND_MS = 1000;
// What the tab and an agent asking need, and a long list would otherwise fill the status.
const MAX_READY_SENT = 50;

export const NEEDS_AN_OWNER = 'Nothing runs until the dashboard is open.';

const leftForTheUser = ({ left, state }) => Boolean(left) && !overStates.includes(state);

export const itemCounts = items => ({
  open: items.filter(item => runnableStates.includes(item.state)).length,
  prs: items.filter(item => item.state === 'pr').length,
  branches: items.filter(item => item.state === 'branch').length,
  left: items.filter(leftForTheUser).length,
});

const pausedProjects = projects => projects.filter(({ paused, state }) => paused && state === 'chosen');

export function assertState(state, states) {
  if (state !== undefined && !states.includes(state)) throw Error(`state must be one of: ${states.join(', ')}`);
}

function nextAction({ mode, next, pause, waitingOn, entries, free, nextStartAt }, owner) {
  if (!mode.enabled) return `Work mode is off. hobkin work start${mode.folder ? '' : ' <folder>'} turns it on.`;
  if (!owner) return NEEDS_AN_OWNER;
  if (pause) return pause.line;
  if (waitingOn) return waitingOn;
  if (next) return `${next.project}: ${next.title} starts next.`;
  const top = entries.find(entry => !entry.skipped);
  if (!top) return 'Nothing is queued. The next look comes round by itself.';
  if (!mode.autoPick && !top.picked) return 'Auto-pick is off, so only what is triggered runs.';
  const wait = rowWait(top, free);
  if (wait) return `${top.project}: ${top.title} is waiting: ${wait}.`;
  return `${top.project}: ${top.title} starts at ${lookTime(nextStartAt, Date.now())}, after the gap between starts.`;
}

export function statusView(root) {
  const view = ownerView(root);
  const plan = planWork(root, view);
  const { mode, budget, entries } = plan;
  const pause = mode.enabled ? plan.pause : null;
  return {
    on: mode.enabled,
    owner: view.owner,
    folder: mode.folder,
    harness: mode.harness,
    autoPick: mode.autoPick,
    paused: Boolean(pause),
    pausedBy: pause?.kind ?? null,
    pauseWhy: pause?.line ?? null,
    pausedProjects: pausedProjects(readProjects(root)).map(({ slug }) => slug),
    running: view.running.length,
    queued: entries.filter(entry => !entry.skipped).length,
    tokens: { today: budget.used, cached: budget.cached, thisHour: budget.hourUsed },
    limits: {
      agents: plan.agents,
      agentsAllowed: mode.agents,
      dailyTokens: budget.limit,
      hourShare: Math.round(budget.hourShare),
    },
    next: nextAction(plan, view.owner),
  };
}

const projectRow = (root, project) => {
  const { slug, level, state, path = null, paused = false } = project;
  return {
    name: nameOf(project),
    slug,
    level,
    priority: priorityOf(project),
    prMode: landing(project),
    state,
    path,
    paused,
    ...itemCounts(readItems(root, slug)),
    nextLookAt: state === 'chosen' ? nextLookAt(root, project) : null,
  };
};

const itemRow = (root, project, item) => {
  const { id, title, kind, state, max, pr = null, branch = null, summary = null, proof = null, left = null, attempts = 0, lastError = null, reason = null } = item;
  const description = prFile(root, project.slug, id);
  return {
    project: nameOf(project),
    slug: project.slug,
    id,
    title,
    kind,
    state,
    grade: itemGrade(project, item),
    level: max ? 'max' : project.level,
    pr,
    branch,
    summary,
    proof,
    left,
    attempts,
    lastError,
    reason,
    ...(existsSync(description) ? { prFile: description } : {}),
  };
};

const inPriorityOrder = (left, right) => byPriority(left, right) || left.name.localeCompare(right.name);

export function projectsView(root, state) {
  assertState(state, projectStates);
  return readProjects(root).filter(project => !state || project.state === state).map(project => projectRow(root, project)).toSorted(inPriorityOrder);
}

export function runningView(root, now = Date.now()) {
  const names = new Map(readProjects(root).map(project => [project.slug, nameOf(project)]));
  return ownerView(root, now).running.map(run => {
    const { id, slug = null, item = null, title, lane, level = null, harness, pane, startedAt } = run;
    const seconds = Math.max(0, Math.round((now - Date.parse(startedAt)) / SECOND_MS));
    return { id, project: names.get(slug) ?? null, slug, item, title, lane, level, harness, pane, seconds };
  });
}

export function queueView(root) {
  const { entries, free } = planWork(root, ownerView(root));
  return entries.map(entry => {
    const { key, project, slug = null, item, title, level = null, grade, why, picked } = entry;
    return { key, project, slug, item: item?.id ?? null, title, level, grade, why, waiting: rowWait(entry, free), picked };
  });
}

export function itemsView(root, reference, state) {
  assertState(state, itemStates);
  const projects = (reference ? [findProject(root, reference)] : readProjects(root)).map(project => withPending(root, project));
  return projects.flatMap(project => readItems(root, project.slug).filter(item => !state || item.state === state).map(item => itemRow(root, project, item)));
}

const nextToMerge = (first, second) => Number(Boolean(first.conflict)) - Number(Boolean(second.conflict))
  || (first.at ?? '').localeCompare(second.at ?? '');

function readyRow(project, item, openUnits = []) {
  const { id, title, branch = null, summary = null, left = null, updatedAt = null } = item;
  const { behind = null, conflict = null } = openUnits.find(unit => unit.branch === branch) ?? {};
  return {
    slug: project.slug,
    project: nameOf(project),
    item: id,
    title,
    branch,
    summary,
    left,
    at: updatedAt,
    behind,
    conflict,
  };
}

/** Local PRs waiting for review: work finished on a branch with no PR. The top is what to merge next: nothing in its way, then the oldest. */
export function readyItems(root) {
  const { projects: surveyed } = readUnmerged(root);
  return chosenProjects(root)
    .flatMap(project => readItems(root, project.slug)
      .filter(item => item.state === 'branch')
      .map(item => readyRow(project, item, surveyed[project.slug]?.open)))
    .toSorted(nextToMerge)
    .slice(0, MAX_READY_SENT);
}

/** One item as a review reads it. `description` is what its run wrote for its branch, if it wrote anything. */
export function prView(root, reference, id) {
  const project = findProject(root, reference);
  const { id: item, title, state, branch = null, summary = null, proof = null, left = null } = findItem(root, project, id);
  const file = prFile(root, project.slug, item);
  return {
    project: nameOf(project),
    item,
    title,
    state,
    branch,
    summary,
    proof,
    left,
    description: existsSync(file) ? readFileSync(file, 'utf8') : null,
  };
}

/** Every word has to be there, in any order and any case. Plain matching in code, so it costs nothing and needs no model. */
export function searchView(root, text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) throw Error('Say what to search for.');
  const fits = (...fields) => {
    const searched = fields.filter(Boolean).join(' ').toLowerCase();
    return words.every(word => searched.includes(word));
  };
  const projects = readProjects(root).map(project => withPending(root, project));
  return [
    ...projects.filter(({ name, slug, path }) => fits(name, slug, path)).map(project => ({ type: 'project', ...projectRow(root, project) })),
    ...projects.flatMap(project => readItems(root, project.slug)
      .filter(({ id, title, summary, left, lastError }) => fits(id, title, summary, left, lastError))
      .map(item => ({ type: 'item', ...itemRow(root, project, item) }))),
  ];
}

/** What the mode itself is holding for the user. A mode that is off holds nothing. */
function modeWaits(mode, row) {
  if (!mode.enabled) return [];

  const asked = currentRequest(mode);
  return [
    ...(asked ? [row('allowance', `Raise today's tokens to ${tokenLabel(asked.proposed)}?`, 'hobkin work allow [number | no]', { reason: asked.reason })] : []),
    ...(mode.pausedAt ? [row('pause', 'Work mode is paused by hand.', 'hobkin work resume')] : []),
  ];
}

/** Each row says how it is answered, so nothing here needs the code or the tab to act on. */
export function attentionView(root) {
  const projects = readProjects(root);
  const names = new Map(projects.map(project => [project.slug, nameOf(project)]));
  const row = (kind, title, answer, { slug = null, item = null, reason = null } = {}) => ({
    kind,
    project: names.get(slug) ?? null,
    slug,
    item,
    title,
    reason,
    answer,
  });

  const paused = pausedProjects(projects).map(({ slug }) => row('pause', `${names.get(slug)} is paused by hand.`, `hobkin work resume ${slug}`, { slug }));
  const proposals = projects
    .filter(({ state }) => state === 'proposed')
    .toSorted(byRank)
    .map(({ slug, summary = null }) => row('proposal', names.get(slug), `hobkin work choose ${slug} [level], or skip ${slug}`, { slug, reason: summary }));
  const items = projects.flatMap(({ slug }) => readItems(root, slug)
    .filter(leftForTheUser)
    .map(({ id, title, left }) => row('item', title, `hobkin work done ${slug} ${id}, once it is sorted`, { slug, item: id, reason: left })));

  return [...modeWaits(readMode(root), row), ...paused, ...proposals, ...items];
}
