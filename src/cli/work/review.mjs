import { readEvents } from '../events.mjs';
import { nameOf } from './names.mjs';
import { landedRecords, scoreboard } from './scoreboard.mjs';
import { byPriority, chosenProjects, priorityOf, readItems, readMode, runnableStates, tokenEvents, tokenLabel } from './store.mjs';
import { pendingMerges, readUnmerged } from './unmerged.mjs';

const DAY_MS = 86400000;
export const REVIEW_EVERY_MS = 7 * DAY_MS;

const finishedStates = ['branch', 'pr', 'merged', 'done'];
const verdictLines = {
  off: 'work mode is off, so nothing new starts',
  idle: 'work mode is on, but nothing ran',
  stalled: 'work mode is running, but nothing finished',
  progressing: 'work mode is progressing',
};

const counted = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const inStates = (items, states) => items.filter(item => states.includes(item.state));
const sumOf = (rows, field) => rows.reduce((sum, row) => sum + (row[field] ?? 0), 0);
const inPriorityOrder = (left, right) => byPriority(left, right) || left.project.localeCompare(right.project);

/** The first tick only stamps the clock, so every review has a full week to look at. */
export const reviewDue = ({ lastReviewAt }, now) => Boolean(lastReviewAt) && now - Date.parse(lastReviewAt) >= REVIEW_EVERY_MS;

function whyStale({ runs, tokens, open }) {
  if (runs) return `Spent ${tokenLabel(tokens)} tokens on ${counted(runs, 'run')} and finished nothing.`;
  return open ? `${counted(open, 'item')} open and nothing ran.` : 'Nothing ran and nothing is open.';
}

function oldestInDays(units, now) {
  if (!units.length) return null;
  const oldestAt = Math.min(...units.map(unit => Date.parse(unit.openedAt)));
  return Math.floor((now - oldestAt) / DAY_MS);
}

function reviewRow(root, project, { on, now, since, inWeek, events, surveyed }) {
  const { slug, level, paused } = project;
  const items = readItems(root, slug);
  const ran = events.filter(event => event.slug === slug);
  const finished = inStates(items, finishedStates).filter(item => inWeek(item.updatedAt));
  const merged = inWeek(surveyed[slug]?.lastMergeAt) || finished.some(item => item.state === 'merged');
  const waiting = pendingMerges(root, slug);
  const row = {
    project: nameOf(project),
    slug,
    priority: priorityOf(project),
    level,
    runs: ran.length,
    tokens: sumOf(ran, 'tokens'),
    finished: finished.length,
    merged,
    open: inStates(items, runnableStates).length,
    branches: inStates(items, ['branch']).length,
    prs: inStates(items, ['pr']).length,
    left: items.filter(item => item.left).length,
    waiting: waiting.length,
    oldestDays: oldestInDays(waiting, now),
  };
  // Nothing was meant to run with the mode off or on a paused project, and a new one has not had its week yet.
  const hadItsWeek = on && !paused && Date.parse(project.at) < since;
  const stale = hadItsWeek && !finished.length && !merged && !waiting.length;
  return { ...row, stale, why: stale ? whyStale(row) : null };
}

function verdictOf({ on, runs, finished }) {
  if (!on) return 'off';
  if (!runs) return 'idle';
  return finished ? 'progressing' : 'stalled';
}

/**
 * What the last week came to, for the chosen projects. Plain code over what is on disk, so it spends no tokens and changes nothing.
 * `runs` and `tokens` are every run, because a look for projects or a project dropped since still spent them.
 */
export function reviewView(root, now = Date.now()) {
  const since = now - REVIEW_EVERY_MS;
  // Reviews a week apart share an edge, so what lands exactly on it counts once, in the review that ends there.
  const inWeek = at => Date.parse(at) > since && Date.parse(at) <= now;
  const events = tokenEvents(root).filter(event => inWeek(event.at));
  const surveyed = readUnmerged(root).projects;
  const on = Boolean(readMode(root).enabled);
  const projects = chosenProjects(root)
    .map(project => reviewRow(root, project, { on, now, since, inWeek, events, surveyed }))
    .toSorted(inPriorityOrder);
  const runs = events.length;
  const finished = sumOf(projects, 'finished');
  const waiting = sumOf(projects, 'waiting');
  return {
    since: new Date(since).toISOString(),
    until: new Date(now).toISOString(),
    on,
    verdict: verdictOf({ on, runs, finished }),
    runs,
    tokens: sumOf(events, 'tokens'),
    finished,
    merged: projects.filter(row => row.merged).length,
    waiting,
    oldestDays: waiting ? Math.max(...projects.map(row => row.oldestDays ?? 0)) : null,
    projects,
    stale: projects.filter(row => row.stale).map(row => row.slug),
    scoreboard: scoreboard(readEvents(root, { since }).filter(({ at }) => inWeek(at)), landedRecords(root).filter(({ at }) => inWeek(at))),
  };
}

const staleLine = ({ project, slug, why }) => `- **${project}**: ${why} \`hobkin work drop ${slug}\``;

function waitingWords(waiting, oldestDays) {
  if (!waiting) return '';
  const age = oldestDays ? `${counted(oldestDays, 'day')} old` : 'less than a day old';
  return ` ${waiting} waiting to merge, ${waiting === 1 ? '' : 'the oldest '}${age}.`;
}

/** The Chat text for a week. It names the command and leaves the dropping to the user. */
export function reviewMessage({ verdict, runs, finished, merged, tokens, projects, waiting, oldestDays, scoreboard: { lines: score = [] } = {} }) {
  const numbers = `${counted(runs, 'run')}, ${counted(finished, 'item')} finished, ${counted(merged, 'project')} merged something, ${tokenLabel(tokens)} tokens.`;
  const opening = `Weekly review: ${verdictLines[verdict]}. ${numbers}${waitingWords(waiting, oldestDays)}`;
  const stale = projects.filter(row => row.stale);
  const each = stale.length === 1 ? 'This one is' : 'Each of these is';
  const staleness = stale.length ? [...stale.map(staleLine), '', `${each} worth dropping, and dropping keeps its branches and PRs.`] : ['No project is stale.'];
  return [opening, '', ...staleness, ...(score.length ? ['', ...score] : [])].join('\n');
}
