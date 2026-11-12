import { handOff, isFinished, mergeItem, mergePullRequest, reply, toldOf, whyWorkModeWaits } from './controls.mjs';
import { findItem, findProject, nameOf } from './names.mjs';
import { ownerView, readItems, readMode, readProject, readProjects, retryItem, updateItem } from './store.mjs';

const REFRESH_NOTE = 'Bring this branch up to date with the default branch: rebase it onto the latest one so both sides\' intent survives, then run its proof again and record it. Add nothing else.';
// What a session does when work mode cannot start the refresh.
const REFRESH_JOB = {
  asked: 'Bring the branch up to date with the default branch, run its proof again, then merge it with hobkin work merge.',
  doing: 'refreshing it, then merging it',
  did: 'asked to refresh and merge it',
  to: named => `bring ${named} up to date, run its proof again and merge it`,
};

/**
 * "Refresh and merge" is the user's word to merge a branch once an agent has brought it up to date with its base and its proof has passed again.
 * The word is kept on the item, because the run that refreshes it clears the note it was sent with. What was left for the user then is kept
 * beside it, so a refresh that leaves something new is told apart from one that changed nothing of the sort.
 */
export function refreshThenMerge(root, reference, id, { read = 'none', readMs = 0, now = Date.now() } = {}) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  // Work an agent once called done while its branch still waits is finished work too. One the user closed stays closed.
  const waits = isFinished(item) || (item.state === 'done' && !item.closedByUser);
  if (!waits || !item.branch) throw Error(`"${item.title}" is ${item.state}, so there is no branch to refresh.`);
  if (ownerView(root).running.some(run => run.slug === project.slug && run.item === item.id)) {
    throw Error(`"${item.title}" is already running. hobkin work cancel ${item.id} stops it.`);
  }

  const held = whyWorkModeWaits(readMode(root), now);
  if (held) return handOff(root, { project, item, why: held, now }, REFRESH_JOB);

  const mergeWhenFresh = { at: new Date(now).toISOString(), read, readMs, ...(item.left ? { left: item.left } : {}) };
  updateItem(root, project.slug, item.id, { workNote: REFRESH_NOTE, mergeWhenFresh }, now);
  retryItem(root, project.slug, item.id, now);
  const message = `An agent brings "${item.title}" on ${nameOf(project)} up to date and runs its proof again, and hobkin merges it once that run ends well.`;
  return reply(message, { told: toldOf(project, item, 'asked to refresh and merge it', message) });
}

// The run that refreshed it left the work finished again, with nothing new for the user. An empty `left` is nothing left, as it is when the word is kept.
const refreshedWell = item => isFinished(item) && (item.left || null) === (item.mergeWhenFresh.left || null);

const lowerFirst = text => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/**
 * The word is used once, whatever the merge does, so a merge that fails goes back to the user rather than trying again by itself. Either way the
 * result is told like an action on a card, because the user's choice on the card is what it carries out.
 */
async function mergeNow(root, slug, item, { now, gh }) {
  const { read, readMs } = item.mergeWhenFresh;
  updateItem(root, slug, item.id, { mergeWhenFresh: null }, now);
  const project = readProject(root, slug);
  try {
    const merged = item.state === 'pr'
      ? await mergePullRequest(root, slug, item.id, gh ? { gh, now } : { now })
      : await mergeItem(root, slug, item.id, { route: 'refresh', read, readMs, now });
    const line = `After its refresh, ${lowerFirst(merged.told?.line ?? merged.message)}`;
    return { ok: true, message: line, told: toldOf(project, item, 'merged it after its refresh', line) };
  } catch (error) {
    const line = `After its refresh, ${error.message}`;
    return { ok: false, message: line, told: toldOf(project, item, 'could not merge it after its refresh', line) };
  }
}

/**
 * Merges each branch the user said to refresh and merge, once its refresh has ended well. A refresh still to run, or running, waits.
 * The run records the branch finished a moment before it ends, and a merge tried then is refused as already running. That refusal used up the
 * user's word, so a branch whose run is still going waits for a tick after the run has gone.
 */
export async function mergeRefreshed(root, { now = Date.now(), gh = null } = {}) {
  const results = [];
  const { running } = ownerView(root, now);
  const runGoing = (slug, item) => running.some(run => run.slug === slug && run.item === item.id);
  for (const { slug } of readProjects(root)) {
    const due = readItems(root, slug).filter(item => item.mergeWhenFresh && refreshedWell(item) && !runGoing(slug, item));
    for (const item of due) results.push(await mergeNow(root, slug, item, { now, gh }));
  }
  return results;
}
