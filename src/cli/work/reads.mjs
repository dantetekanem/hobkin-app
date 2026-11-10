import { existsSync, readFileSync } from 'node:fs';
import { learningEnabled } from '../config.mjs';
import { lookTime } from './chat.mjs';
import { forecastWork } from './forecast.mjs';
import { knownSoFar, launchSince, openLaunches } from './launches.mjs';
import { findItem, findProject, nameOf } from './names.mjs';
import { offerFor, trackRecords } from './patterns.mjs';
import { canStart, itemGrade, planWork, rowWait, withPending } from './plan.mjs';
import {
  byPriority, byRank, chosenProjects, currentRequest, itemStates, landing, nextLookAt, ownerView, prFile, priorityOf, readItems, readLaunches, readMode, readProjects, readTrust, runnableStates, tokenLabel,
} from './store.mjs';
import { BRANCH_PREFIX } from './tree.mjs';
import { finishedOnBranch, readUnmerged, SHIP_KIND } from './unmerged.mjs';

const projectStates = ['chosen', 'proposed', 'skipped', 'dropped'];
// Work that is over asks nothing more of the user, whatever its run left, and that includes work they said no to.
const overStates = ['merged', 'dropped', 'declined'];
const SECOND_MS = 1000;
const SHORT_SHA = 7;
// What the tab and an agent asking need, and a long list would otherwise fill the status.
const MAX_READY_SENT = 50;

export const NEEDS_AN_OWNER = 'Nothing runs until the dashboard is open.';

const leftForTheUser = ({ left, state }) => Boolean(left) && !overStates.includes(state);

export const itemCounts = items => ({
  open: items.filter(item => runnableStates.includes(item.state)).length,
  prs: items.filter(item => item.state === 'pr').length,
  branches: items.filter(item => item.state === 'branch').length,
  left: items.filter(leftForTheUser).length,
  merged: items.filter(item => item.state === 'merged').length,
});

const pausedProjects = projects => projects.filter(({ paused, state }) => paused && state === 'chosen');

export function assertState(state, states) {
  if (state !== undefined && !states.includes(state)) throw Error(`state must be one of: ${states.join(', ')}`);
}

function nextAction({ mode, next, pause, waitingOn, entries, free, nextStartAt, shipFirst }, owner) {
  if (!mode.enabled) return `Work mode is off. hobkin work start${mode.folder ? '' : ' <folder>'} turns it on.`;
  if (!owner) return NEEDS_AN_OWNER;
  if (pause) return pause.line;
  if (waitingOn) return waitingOn;
  if (shipFirst.holding) return [shipFirst.line, next && `${next.project}: ${next.title} starts next.`].filter(Boolean).join(' ');
  if (next) return `${next.project}: ${next.title} starts next.`;
  const top = entries.find(entry => !entry.skipped);
  if (!top) return 'Nothing is queued. The next look comes round by itself.';
  if (!canStart(mode, top)) return 'Auto-pick is off, so only what is triggered runs.';
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
    forecast: forecastWork(root, plan, view),
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
    const { id, slug = null, item = null, title, lane, level = null, harness, startedAt } = run;
    const seconds = Math.max(0, Math.round((now - Date.parse(startedAt)) / SECOND_MS));
    return { id, project: names.get(slug) ?? null, slug, item, title, lane, level, harness, seconds };
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

// A branch with no grade yet says nothing either way, so it sits between what a review passed and what it questioned.
const safetyOrder = { safe: 0, medium: 2, risky: 3 };
const NOT_GRADED = 1;
const safetyRank = ({ safety }) => (safety && !safety.stale ? safetyOrder[safety.grade] : NOT_GRADED);
// No grade sits between a good one and a poor one, for the same reason.
const qualityOrder = { A: 0, B: 1, C: 3, D: 4, E: 5, F: 6 };
const NO_QUALITY = 2;
const qualityRank = ({ quality }) => (quality && !quality.stale ? qualityOrder[quality.rating] ?? NO_QUALITY : NO_QUALITY);
const linesChanged = ({ size }) => (size?.additions ?? 0) + (size?.deletions ?? 0);

/** What is easiest to say yes to comes first: nothing in its way, the safest, the best made, the smallest, then the oldest. */
const nextToMerge = (first, second) => Number(Boolean(first.conflict)) - Number(Boolean(second.conflict))
  || safetyRank(first) - safetyRank(second)
  || qualityRank(first) - qualityRank(second)
  || linesChanged(first) - linesChanged(second)
  || (first.at ?? '').localeCompare(second.at ?? '');

/** Finished work the user chose on a card while work mode could not start it is a session's, through the main agent, until its time runs out. */
const withMainAgent = item => Date.parse(item.withMainAgent?.until ?? '') > Date.now();
const closingNow = item => withMainAgent(item)
  || (runnableStates.includes(item.state) && (item.kind === SHIP_KIND || item.reviewAsked || item.workNote));

function gapOf(item, unit, items) {
  if (item.kind === 'yours') return 'yours';
  if (unit.landedOn) return 'elsewhere';
  if (unit.stackedUnder) return 'stacked';
  if (items.some(other => closingNow(other) && other.branch === item.branch)) return 'closing';
  if (item.state === 'done') return 'unlanded';
  return unit.conflict ? 'rebase' : 'land';
}

/** Everything a branch would bring with it, because merging it merges them too. A grade on the top one says nothing about these. */
const stackedBeneath = ({ branch }, units) => units.filter(unit => unit.heldBy?.includes(branch));

// A card says what the work did in a few lines, so this is enough of a description or a proof to read at a glance.
const LONGEST_ABOUT = 420;
const LONGEST_PROOF = 260;
// What it said first is all a card shows, so the rest of a long description is not read.
const MOST_DESCRIPTION_READ = 8192;
const oneLine = (text, most) => String(text).replace(/\s+/g, ' ').trim().slice(0, most);

/** What the work did, in its own words: the first paragraph of its description past the title, the issue line and headings, or else its summary. */
function aboutOf(file, summary) {
  try {
    const paragraphs = readFileSync(file, 'utf8')
      .slice(0, MOST_DESCRIPTION_READ)
      .split(/\n\s*\n/)
      .map(part => part.trim())
      .filter(Boolean);
    const body = paragraphs.slice(1).find(part => !/^(#|issue id:)/i.test(part));
    if (body) return oneLine(body, LONGEST_ABOUT);
  } catch {
    // An item that wrote no description still has its summary.
  }
  return summary ? oneLine(summary, LONGEST_ABOUT) : null;
}

function readyRow(root, project, item, items, openUnits = []) {
  const { id, title, branch = null, summary = null, left = null, proof = null, updatedAt = null, quality = null, notices = null, launch = null } = item;
  const unit = openUnits.find(({ branch: name }) => name === branch) ?? {};
  const { behind = null, conflict = null, size = null, safety = null, onlyDocs = false, landedOn = null, sha = null } = unit;
  return {
    slug: project.slug,
    project: nameOf(project),
    item: id,
    title,
    // How much the work matters, as the queue ranks it, without what earlier tries took off.
    grade: itemGrade(project, { ...item, attempts: 0 }),
    kind: item.kind ?? null,
    branch,
    head: sha,
    summary,
    about: aboutOf(prFile(root, project.slug, id), summary),
    proof: proof ? oneLine(proof, LONGEST_PROOF) : null,
    left,
    at: updatedAt,
    behind,
    conflict,
    size,
    safety,
    quality: quality && { rating: quality.rating, reason: quality.reason, stale: quality.head !== unit.sha },
    notices,
    launch,
    onlyDocs,
    landedOn,
    gap: gapOf(item, unit, items),
    holds: stackedBeneath(unit, openUnits).length,
    described: existsSync(prFile(root, project.slug, id)),
    proved: Boolean(proof),
  };
}

/**
 * An item that says `done` with work still on its branch, which an agent recorded before `done` meant no change was needed. The survey lists a branch only while it
 * holds commits the default branch lacks. A fix's work is its maker's, and a branch another item stands for is already on the list.
 */
export function saysDoneButWaits(item, items, units) {
  const { state, kind, branch, closedByUser } = item;
  if (state !== 'done' || !branch || closedByUser || [SHIP_KIND, 'yours'].includes(kind)) return false;
  const surveyed = units.some(unit => unit.kind === 'branch' && unit.branch === branch);
  return surveyed && !items.some(other => other.branch === branch && finishedOnBranch.includes(other.state));
}

const isOpenStep = ({ kind, state }) => kind === 'yours' && runnableStates.includes(state);

const isWaiting = (item, items, units) => item.state === 'branch' || isOpenStep(item) || saysDoneButWaits(item, items, units);

/** What has landed on every project and what came of it, by pattern. With learning off nothing is judged, so nothing should ask for this. */
export function readTrackRecords(root, now = Date.now()) {
  const projects = chosenProjects(root).map(({ slug }) => ({ slug, items: readItems(root, slug), launches: readLaunches(root, slug) }));
  return trackRecords(projects, readTrust(root), now);
}

const likeOf = ({ precedent }, slug) => precedent && {
  merged: precedent.merged,
  watching: precedent.watching,
  ...(precedent.slug === slug ? {} : { from: precedent.slug }),
};

function weighedRow({ root, project, item, items, units, records }) {
  const { slug } = project;
  const row = readyRow(root, project, item, items, units);
  const unit = units.find(({ branch }) => branch === item.branch);
  const beneath = unit ? stackedBeneath(unit, units) : [];
  const offer = records && offerFor({ slug, item, unit, gap: row.gap, records, beneath });
  return { row: { ...row, like: offer ? likeOf(offer, slug) : null }, item, unit, offer };
}

/** Each waiting row beside what it can be offered, top first. `offer` is null with learning off, and rows stay light because a unit's paths go no further than this. */
export function weighedRows(root, now = Date.now()) {
  const { projects: surveyed } = readUnmerged(root);
  const records = learningEnabled(root) ? readTrackRecords(root, now) : null;
  return chosenProjects(root)
    .flatMap(project => {
      const items = readItems(root, project.slug);
      const units = surveyed[project.slug]?.open ?? [];
      return items
        .filter(item => isWaiting(item, items, units))
        .map(item => weighedRow({ root, project, item, items, units, records }));
    })
    .toSorted((first, second) => nextToMerge(first.row, second.row));
}

/** Work finished on a branch with no PR. `gap` says what stands between each one and landing, and the top is what to merge next. */
export const readyItems = (root, most = MAX_READY_SENT) => weighedRows(root).slice(0, most).map(({ row }) => row);

/** A grade is information, never a gate: only a review that rated this very commit below safe holds work back. No grade, or one for an older commit, does not. */
export const heldByItsGrade = ({ safety }) => Boolean(safety) && !safety.stale && safety.grade !== 'safe';

const gapWords = {
  yours: 'only a person can do it',
  elsewhere: 'it is already on another branch',
  stacked: 'it lands with the branch above it',
  closing: 'an agent is still working on it',
  rebase: 'it conflicts with the default branch',
  unlanded: 'its item says done, so it goes through the walk',
};

export function ratingWords({ safety }) {
  if (!safety) return 'it has no grade';
  return safety.stale ? 'its grade is for an older commit' : `it is rated ${safety.grade} ${safety.rating}`;
}

/** The first thing a merge of this row would bring along that a review held back. */
export const weakEarlierWork = (row, units) => stackedBeneath(row, units).find(heldByItsGrade);

/** Work lands on its proof, at the commit the survey read. A row the survey never read has no commit to pin a yes to. */
function whyLeftOut(row, units) {
  if (row.gap === 'elsewhere' && row.landedOn) return `it is already on ${row.landedOn}`;
  if (row.gap !== 'land') return gapWords[row.gap];
  if (row.left) return `it still has work left: ${row.left}`;
  if (heldByItsGrade(row)) return ratingWords(row);
  if (!row.head) return 'the last survey did not read its branch, and hobkin work sync reads it';
  if (row.proved === false) return 'it has no proof';
  const weak = weakEarlierWork(row, units);
  return weak ? `it brings ${weak.branch}, and ${ratingWords(weak)}` : null;
}

function gradeOf(safety) {
  if (!safety) return null;
  const grade = `${safety.grade} ${safety.rating}`;
  return safety.stale ? `${grade} on an older commit` : grade;
}

const landingRow = ({ project, slug, item, title, head, safety, size, pr }, why) => ({
  project,
  slug,
  item,
  title,
  head,
  grade: gradeOf(safety),
  lines: (size?.additions ?? 0) + (size?.deletions ?? 0),
  files: size?.files ?? 0,
  ...(pr ? { pr } : {}),
  ...(why ? { why } : {}),
});

/** Why a PR has no grade to show, when the survey could not read one. */
function unreadPr({ branch }, open) {
  if (!branch) return 'it names no branch, so the survey cannot find its PR';
  if (!branch.startsWith(BRANCH_PREFIX)) return `its PR is on ${branch}, which is not a hobkin branch, so the survey does not read it`;
  if (!open) return 'the last survey saw no open PR for it';
  return open.sha ? null : 'the last survey did not read its head, and hobkin work sync reads it';
}

/** An item recorded as a PR, read against the PR the survey found open on its branch. Without its head there is nothing to grade, whatever its branch holds. */
function prRow(root, project, item, items, units) {
  const open = units.find(unit => unit.kind === 'pr' && unit.branch === item.branch);
  const unread = unreadPr(item, open);
  if (!open) return { ...readyRow(root, project, item, items), pr: item.pr ?? null, unread };
  return { ...readyRow(root, project, item, items, units), pr: open.url, unread };
}

/** One branch is one piece of work, however many items stand for it. The first row for a branch stays, so the caller puts the one that should speak first. */
function oncePerBranch(rows) {
  const seen = new Set();
  return rows.filter(({ slug, branch }) => {
    if (!branch) return true;
    if (seen.has(`${slug}:${branch}`)) return false;
    seen.add(`${slug}:${branch}`);
    return true;
  });
}

/** Every item recorded as a PR, read against what the last survey found open. Each row carries its `pr`, or `unread` when there is nothing to grade. */
export function pullRequestRows(root) {
  const { projects: surveyed } = readUnmerged(root);
  return chosenProjects(root).flatMap(project => {
    const items = readItems(root, project.slug);
    const units = surveyed[project.slug]?.open ?? [];
    return items.filter(({ state }) => state === 'pr').map(item => prRow(root, project, item, items, units));
  });
}

/** Everything waiting to land, uncut. A PR merges on its host, so it stays out of the walk, but bulk landing has to see it. An open PR speaks for its branch. */
function landingRows(root) {
  const prs = pullRequestRows(root);
  const waiting = weighedRows(root).map(({ row }) => row);
  const ordered = [...prs.filter(({ unread }) => !unread), ...waiting, ...prs.filter(({ unread }) => unread)];
  return oncePerBranch(ordered).toSorted(nextToMerge);
}

/**
 * The only evidence for landing work in bulk: work goes on its proof, pinned to the commit the survey read, and a grade is what the review of that
 * exact commit found, never what an item says about itself. What cannot go says why, so a plan can show what it left out. A PR row carries its `pr`,
 * because it lands on its host and not here. `surveyedAt` says how old this is, and `hobkin work sync` brings it up to date.
 */
export function landingList(root) {
  const { at, projects } = readUnmerged(root);
  const rows = landingRows(root).map(row => [row, row.unread ?? whyLeftOut(row, projects[row.slug]?.open ?? [])]);
  return {
    surveyedAt: at,
    landable: rows.filter(([, why]) => !why).map(([row]) => landingRow(row)),
    leftOut: rows.filter(([, why]) => why).map(([row, why]) => landingRow(row, why)),
  };
}

const closingWords = item => {
  // A hand-off says what its session is doing. One older than that was always a refresh.
  if (withMainAgent(item)) return item.withMainAgent.doing ?? 'refreshing it, then merging it';
  if (item.kind === SHIP_KIND) return 'getting it ready to merge';
  return item.reviewAsked ? 'reviewing it' : 'working on your note';
};

/** Finished work an agent has gone back to, so the user can see it is not forgotten. */
export function closingItems(root) {
  return chosenProjects(root).flatMap(project => readItems(root, project.slug)
    .filter(closingNow)
    .map(item => ({ slug: project.slug, project: nameOf(project), item: item.id, title: item.title, branch: item.branch ?? null, doing: closingWords(item) })));
}

/** What landed and is still being watched: how far it got, since when, and what is known so far. */
export function watchingView(root) {
  return chosenProjects(root).flatMap(project => {
    const items = readItems(root, project.slug);
    return openLaunches(readLaunches(root, project.slug)).map(launch => ({
      slug: project.slug,
      project: nameOf(project),
      item: launch.item,
      title: items.find(({ id }) => id === launch.item)?.title ?? null,
      sha: launch.sha?.slice(0, SHORT_SHA) ?? null,
      stage: launch.stage,
      since: launchSince(launch),
      known: knownSoFar(launch),
    }));
  });
}

/** One item as a review reads it. `description` is what its run wrote for its branch, if it wrote anything. */
export function prView(root, reference, id) {
  const project = findProject(root, reference);
  const { id: item, title, state, branch = null, summary = null, proof = null, left = null, launch = null } = findItem(root, project, id);
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
    launch,
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

/** Each row says how it is answered, so nothing here needs the code or the tab to act on. What is left for the user counts only on a project still being worked on, as its rows do. */
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
  const items = projects
    .filter(({ state }) => state === 'chosen')
    .flatMap(({ slug }) => readItems(root, slug)
      .filter(leftForTheUser)
      .map(({ id, title, left }) => row('item', title, `hobkin work done ${slug} ${id}, once it is sorted`, { slug, item: id, reason: left })));

  return [...modeWaits(readMode(root), row), ...paused, ...proposals, ...items];
}
