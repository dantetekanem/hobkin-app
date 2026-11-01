import { lookTime } from './chat.mjs';
import { findProject, nameOf } from './names.mjs';
import { planWork, rowWait } from './plan.mjs';
import {
  byRank, currentRequest, itemStates, nextLookAt, ownerView, readItems, readMode, readProjects, tokenLabel,
} from './store.mjs';

const projectStates = ['chosen', 'proposed', 'skipped', 'dropped'];
const SECOND_MS = 1000;

export const NEEDS_AN_OWNER = 'Nothing runs until the dashboard or hobkin run is open.';

export const itemCounts = items => ({
  open: items.filter(item => ['open', 'doing'].includes(item.state) && item.kind !== 'attention').length,
  prs: items.filter(item => item.state === 'pr').length,
  stuck: items.filter(item => item.state === 'stuck').length,
});

export const needsTheUser = root => readProjects(root).flatMap(({ slug }) => readItems(root, slug)
  .filter(item => (item.kind === 'attention' && item.state === 'open') || item.state === 'stuck')
  .map(({ id, title, state, stuckReason = null }) => ({ slug, id, title, state, reason: stuckReason })));

const pausedProjects = projects => projects.filter(({ paused, state }) => paused && state === 'chosen');

function assertState(state, states) {
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
  const { mode, budget, entries, unmerged } = plan;
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
      unmerged: unmerged.limit,
      unmergedEach: unmerged.each,
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
    state,
    path,
    paused,
    ...itemCounts(readItems(root, slug)),
    nextLookAt: state === 'chosen' ? nextLookAt(root, project) : null,
  };
};

const itemRow = (project, { id, title, kind, state, max, pr = null, stuckReason = null }) => ({
  project: nameOf(project),
  slug: project.slug,
  id,
  title,
  kind,
  state,
  level: max ? 'max' : project.level,
  pr,
  stuckReason,
});

export function projectsView(root, state) {
  assertState(state, projectStates);
  return readProjects(root).filter(project => !state || project.state === state).map(project => projectRow(root, project));
}

export function runningView(root, now = Date.now()) {
  const names = new Map(readProjects(root).map(project => [project.slug, nameOf(project)]));
  return ownerView(root, now).running.map(run => {
    const { id, slug = null, item = null, title, lane, level = null, harness, pane, startedAt, waitingForApproval = false } = run;
    const seconds = Math.max(0, Math.round((now - Date.parse(startedAt)) / SECOND_MS));
    return { id, project: names.get(slug) ?? null, slug, item, title, lane, level, harness, pane, seconds, waitingForApproval };
  });
}

export function queueView(root) {
  const { entries, free } = planWork(root, ownerView(root));
  return entries.map(entry => {
    const { key, project, slug = null, item, title, level = null, why, picked } = entry;
    return { key, project, slug, item: item?.id ?? null, title, level, why, waiting: rowWait(entry, free), picked };
  });
}

export function itemsView(root, reference, state) {
  assertState(state, itemStates);
  const projects = reference ? [findProject(root, reference)] : readProjects(root);
  return projects.flatMap(project => readItems(root, project.slug).filter(item => !state || item.state === state).map(item => itemRow(project, item)));
}

/** Every word has to be there, in any order and any case. Plain matching in code, so it costs nothing and needs no model. */
export function searchView(root, text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) throw Error('Say what to search for.');
  const fits = (...fields) => {
    const searched = fields.filter(Boolean).join(' ').toLowerCase();
    return words.every(word => searched.includes(word));
  };
  const projects = readProjects(root);
  return [
    ...projects.filter(({ name, slug, path }) => fits(name, slug, path)).map(project => ({ type: 'project', ...projectRow(root, project) })),
    ...projects.flatMap(project => readItems(root, project.slug)
      .filter(({ id, title, stuckReason }) => fits(id, title, stuckReason))
      .map(item => ({ type: 'item', ...itemRow(project, item) }))),
  ];
}

/** What the mode itself is holding for the user. A mode that is off holds nothing. */
function modeWaits(mode, row) {
  if (!mode.enabled) return [];

  const asked = currentRequest(mode);
  return [
    ...(asked ? [row('allowance', `Raise today's tokens to ${tokenLabel(asked.proposed)}?`, 'hobkin work allow [number | no]', { reason: asked.reason })] : []),
    ...(mode.mergeStop ? [row('unmerged', 'Work stopped on unmerged work.', 'hobkin work resume keeps going', { reason: mode.mergeStop.line })] : []),
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
  const approvals = ownerView(root).running
    .filter(run => run.waitingForApproval)
    .map(({ slug, item, title, pane }) => row('approval', title, `Answer it in its pane, ${pane}.`, { slug, item }));
  const proposals = projects
    .filter(({ state }) => state === 'proposed')
    .toSorted(byRank)
    .map(({ slug, summary = null }) => row('proposal', names.get(slug), `hobkin work choose ${slug} [level], or skip ${slug}`, { slug, reason: summary }));
  const items = needsTheUser(root).map(({ slug, id, title, state, reason }) => (state === 'stuck'
    ? row('stuck', title, `hobkin work retry ${slug} ${id}, or done ${slug} ${id}`, { slug, item: id, reason })
    : row('item', title, `hobkin work done ${slug} ${id}, once it is sorted`, { slug, item: id })));

  return [...modeWaits(readMode(root), row), ...paused, ...approvals, ...proposals, ...items];
}
