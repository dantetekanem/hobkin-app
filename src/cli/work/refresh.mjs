import { mergeItem, mergePullRequest, reply, toldOf } from './controls.mjs';
import { findItem, findProject, nameOf } from './names.mjs';
import { ownerView, readItems, readMode, readProject, readProjects, retryItem, updateItem } from './store.mjs';

const REFRESH_NOTE = 'Bring this branch up to date with the default branch: rebase it onto the latest one so both sides\' intent survives, then run its proof again and record it. Add nothing else.';
// Where a run leaves finished work: on its local branch, or on its PR.
const FINISHED = ['branch', 'pr'];
const HANDED_JOB = 'Bring the branch up to date with the default branch, run its proof again, then merge it with hobkin work merge.';

/** Work mode starts the refresh itself unless it is off or held, and then nothing would start it at all. */
function whyWorkModeWaits(mode, now) {
  if (!mode.enabled) return 'work mode is off';
  const until = pause => Boolean(pause) && Date.parse(pause.until) > now;
  if (mode.pausedAt || until(mode.usagePause) || until(mode.subscriptionPause)) return 'work mode is paused';
  return null;
}

/** What work mode cannot start goes to the main agent, which hands it to one session. Nothing is queued, so the job runs once. */
function handOff(project, item, why) {
  const named = `"${item.title}" on ${nameOf(project)}`;
  const message = `${why.charAt(0).toUpperCase()}${why.slice(1)}, so the main agent starts a session to bring ${named} up to date, run its proof again and merge it.`;
  return reply(message, {
    handOff: { project: nameOf(project), item: item.id, title: item.title, branch: item.branch, ...(item.pr ? { pr: item.pr } : {}), asked: HANDED_JOB, why },
    told: toldOf(project, item, 'asked to refresh and merge it', message),
  });
}

/**
 * "Refresh and merge" is the user's word to merge a branch once an agent has brought it up to date with its base and its proof has passed again.
 * The word is kept on the item, because the run that refreshes it clears the note it was sent with. What was left for the user then is kept
 * beside it, so a refresh that leaves something new is told apart from one that changed nothing of the sort.
 */
export function refreshThenMerge(root, reference, id, { read = 'none', readMs = 0, now = Date.now() } = {}) {
  const project = findProject(root, reference);
  const item = findItem(root, project, id);
  if (!FINISHED.includes(item.state) || !item.branch) throw Error(`"${item.title}" is ${item.state}, so there is no branch to refresh.`);
  if (ownerView(root).running.some(run => run.slug === project.slug && run.item === item.id)) {
    throw Error(`"${item.title}" is already running. hobkin work cancel ${item.id} stops it.`);
  }

  const held = whyWorkModeWaits(readMode(root), now);
  if (held) return handOff(project, item, held);

  const mergeWhenFresh = { at: new Date(now).toISOString(), read, readMs, ...(item.left ? { left: item.left } : {}) };
  updateItem(root, project.slug, item.id, { workNote: REFRESH_NOTE, mergeWhenFresh }, now);
  retryItem(root, project.slug, item.id, now);
  const message = `An agent brings "${item.title}" on ${nameOf(project)} up to date and runs its proof again, and hobkin merges it once that run ends well.`;
  return reply(message, { told: toldOf(project, item, 'asked to refresh and merge it', message) });
}

// The run that refreshed it left the work finished again, with nothing new for the user.
const refreshedWell = item => FINISHED.includes(item.state) && (item.left ?? null) === (item.mergeWhenFresh.left ?? null);

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

/** Merges each branch the user said to refresh and merge, once its refresh has ended well. A refresh still to run, or running, waits. */
export async function mergeRefreshed(root, { now = Date.now(), gh = null } = {}) {
  const results = [];
  for (const { slug } of readProjects(root)) {
    const due = readItems(root, slug).filter(item => item.mergeWhenFresh && refreshedWell(item));
    for (const item of due) results.push(await mergeNow(root, slug, item, { now, gh }));
  }
  return results;
}
