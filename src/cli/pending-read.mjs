import { readDismissedActionIds, recordActionDismissals } from './action-dismissal.mjs';
import { learningEnabled } from './config.mjs';
import { isActionItem, openDecisions, waitingDecisions } from './decisions.mjs';
import { proposalQuestion } from './learning/lessons.mjs';
import { learningState } from './learning/store.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { pendingCard, waitingRows } from './pending.mjs';
import { nameOf } from './work/names.mjs';
import { oneRead } from './work/one-read.mjs';
import { attentionView, pullRequestRows, readyItems } from './work/reads.mjs';
import { readItems, readLaunches, readProjects } from './work/store.mjs';

// The watch closes a launch the moment it goes wrong, so what ends the trouble for the user is the fix it filed.
const FIX_OVER = ['merged', 'done', 'dropped', 'declined'];

function launchesOf(root, project) {
  const { slug } = project;
  const fixes = readItems(root, slug).filter(({ causedBy, state }) => causedBy && FIX_OVER.includes(state));
  return readLaunches(root, slug).map(launch => ({
    ...launch,
    slug,
    project: nameOf(project),
    fixed: fixes.some(({ causedBy }) => causedBy === launch.item),
  }));
}

const launchesIn = root => readProjects(root).flatMap(project => launchesOf(root, project));

const proposalsIn = root => (learningEnabled(root) ? learningState(root).proposals : [])
  .map(proposal => ({ ...proposal, question: proposalQuestion(proposal) }));

// An open PR speaks for its branch, so a branch row that has one is left to the PR.
function readyAndPulls(root) {
  const pulls = pullRequestRows(root);
  const published = new Set(pulls.map(({ slug, branch }) => `${slug}:${branch}`));
  return [...pulls, ...readyItems(root, Infinity).filter(({ slug, branch }) => !published.has(`${slug}:${branch}`))];
}

// The desktop Action Items list includes filed decisions and offers with multiple choices.
// Native pending also includes Work rows such as finished branches and single-step follow-ups.
const projectOfferId = row => row.kind === 'proposal' && row.slug ? `project:${row.slug}:${row.offeredAt ?? ''}` : null;
const learningOfferId = row => /^[0-9a-f]{6}$/.test(row.id) ? `learning:${row.id}:${row.at ?? ''}` : null;

function cardSources(root, hidden) {
  return {
    attention: attentionView(root).filter(row => !hidden.has(projectOfferId(row))),
    proposals: proposalsIn(root).filter(row => !hidden.has(learningOfferId(row))),
  };
}

function pendingInputs(root, now) {
  const hidden = new Set(readDismissedActionIds(root));
  return {
    ...cardSources(root, hidden),
    ready: readyAndPulls(root),
    decisions: openDecisions(root).filter(({ id }) => !hidden.has(id)),
    launches: launchesIn(root),
    now,
  };
}

/** Native pending retains the broader Work queue but omits the same dismissed cards. */
export const readPending = (requestedRoot, { now = Date.now() } = {}) => pendingCard(pendingInputs(resolveDataRoot(requestedRoot), now));

const visibleDecisions = (root, hidden) => waitingDecisions(root).filter(({ id }) => !hidden.has(id));

export function readActionDecisions(requestedRoot) {
  const root = resolveDataRoot(requestedRoot);
  return visibleDecisions(root, new Set(readDismissedActionIds(root)));
}

/** The dashboard's generated waiting rows, including Work rows that aren't desktop Action Items. */
export function readWaiting(requestedRoot, { now = Date.now() } = {}) {
  const root = resolveDataRoot(requestedRoot);
  return waitingRows(oneRead(() => pendingInputs(root, now)));
}

export function listActionItems(requestedRoot) {
  const root = resolveDataRoot(requestedRoot);
  const hidden = new Set(readDismissedActionIds(root));
  const { attention, proposals } = cardSources(root, hidden);
  const items = visibleDecisions(root, hidden).map(decision => ({
    id: decision.id,
    group: isActionItem(decision) ? 'to_do' : 'question',
    title: decision.tldr,
  }));
  for (const row of attention) {
    const id = projectOfferId(row);
    if (id) items.push({ id, group: 'project', title: row.title });
  }
  for (const row of proposals) {
    const id = learningOfferId(row);
    if (id) items.push({ id, group: 'learning', title: row.question });
  }
  return { items, total: items.length };
}

/** The host selects one ID or takes a fresh snapshot; repair scripts can supply a previously reviewed snapshot. */
export function dismissActionItems(requestedRoot, selector, { now = Date.now() } = {}) {
  const { id, ids, all } = selector ?? {};
  const validId = value => typeof value === 'string' && value.trim().length > 0;
  const exactSnapshot = Array.isArray(ids) && ids.every(validId);
  if (Object.keys(selector ?? {}).length !== 1 || !(all === true || validId(id) || exactSnapshot)) {
    throw Error('Select one Action Item ID, an exact snapshot, or explicitly select all.');
  }
  const root = resolveDataRoot(requestedRoot);
  const requested = new Set(ids ?? [id]);
  const selected = listActionItems(root).items
    .filter(item => all === true || requested.has(item.id))
    .map(item => item.id);
  recordActionDismissals(root, selected, now);
  return { dismissed: selected.length, remaining: listActionItems(root).total };
}
