import { postClientNotice } from '../client-notices.mjs';
import { mergePullRequest } from './controls.mjs';
import { nameOf } from './names.mjs';
import { pullRequestRows } from './reads.mjs';
import { paths, readItems, readProject, updateItem } from './store.mjs';
import { BRANCH_PREFIX, defaultBranch } from './tree.mjs';
import { ghWithin, readUnmerged } from './unmerged.mjs';

/**
 * A change of hobkin's own that waits on its open pull request merges by itself on the code host, under every rule a local branch is under
 * (`yolo-pass.mjs`), and then only once the code host, read again just before, says the pull request is still the one hobkin opened, from the
 * signed-in user, on the item's own branch, into the default branch, at the commit its review scored, and that it is open, not a draft, can
 * merge, needs no approval, has every check passed at that commit and nothing in branch protection blocks it. Anything that cannot be read
 * keeps it asking. The merge is the one the user's own yes on a pull request makes (`mergePullRequest`), pinned to that commit, and never
 * bypasses a protection.
 */

/**
 * Whether YOLO mode takes a change waiting on its own pull request at all: merging it, and starting its scored review by itself. Off until
 * a verifier has run its scenarios against this code again and the user says so. While it is off, a pull request item is as it was before
 * YOLO mode knew of them: no review starts for it by itself, and it keeps asking. A test turns it on with `pullRequestsMergeForTests`.
 */
const PULL_REQUESTS_MERGE = false;
let forTests = null;
export const pullRequestsMerge = () => forTests ?? PULL_REQUESTS_MERGE;
/** For a test file alone, which runs in a process of its own: true or false, or null to go back to the constant. */
export const pullRequestsMergeForTests = on => {
  forTests = on;
};
/** What a change waiting on its pull request says while YOLO mode does not take pull requests. */
export const PULLS_OFF = 'its pull request merges by itself once that is turned on';

const GH_TIMEOUT_MS = 2 * 60000;
const SHORT_SHA = 7;
const VIEW_FIELDS = 'url,state,isDraft,author,headRefName,headRefOid,baseRefName,isCrossRepository,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup';
export const defaultPullGh = ghWithin(GH_TIMEOUT_MS);

const bucketWords = { fail: 'failed', pending: 'pending', skipping: 'skipped', cancel: 'cancelled' };
const mergeStateWords = {
  BLOCKED: 'branch protection blocks its pull request',
  BEHIND: 'its pull request is behind its base branch',
  DIRTY: 'its pull request conflicts with its base branch',
  DRAFT: 'its pull request is a draft',
  UNKNOWN: 'the code host has not worked out yet whether its pull request can merge',
};
const firstLine = text => String(text ?? '').trim().split('\n', 1)[0];

/** Each item waiting on its open pull request, with its row and what the last survey read of that pull request, as the pass reads a branch. */
export function pullCandidates(root) {
  const { projects } = readUnmerged(root);
  return pullRequestRows(root).flatMap(row => {
    const item = readItems(root, row.slug).find(({ id }) => id === row.item);
    if (!item) return [];
    const unit = (projects[row.slug]?.open ?? []).find(open => open.kind === 'pr' && open.branch === item.branch) ?? {};
    return [{ row, item, unit }];
  });
}

/** What the last survey read of the change's own pull request that keeps it asking, before anything is read again. */
export function pullSurveyed(item, unit) {
  if (!item.pr || !String(item.branch ?? '').startsWith(BRANCH_PREFIX)) return 'its pull request is not on a branch of hobkin\'s own';
  if (unit.kind !== 'pr') return 'the last survey saw no open pull request for it';
  if (unit.draft) return 'its pull request is a draft';
  if (unit.conflict) return 'its pull request conflicts with its base branch';
  if (unit.review === 'CHANGES_REQUESTED') return 'changes were requested on its pull request';
  if (unit.review === 'REVIEW_REQUIRED') return 'its pull request needs a review approval';
  if (unit.ci === 'none') return 'its pull request has no checks at this commit';
  if (unit.ci !== 'passing') return `its pull request's checks have not all passed at this commit: they are ${unit.ci}`;
  return null;
}

const parsed = text => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// A check run says its conclusion once it completed, and a status its state. Only a success or a neutral end is a pass.
function checkWord({ conclusion, state, status }) {
  const result = String(conclusion || state || status || '').toUpperCase();
  if (['SUCCESS', 'NEUTRAL'].includes(result)) return null;
  if (result === 'SKIPPED') return 'skipped';
  if (result === 'STALE') return 'stale';
  return /FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED/.test(result) ? 'failed' : 'pending';
}
const checkName = check => check.name || check.context || 'a check';

/**
 * The checks GitHub's branch protection requires, each with its bucket, or [] when none is required, or null when they cannot be read. `gh`
 * ends with an error when a check failed or waits, and still prints them.
 */
async function requiredChecks(gh, url, repo) {
  try {
    const listed = parsed(await gh(['pr', 'checks', url, '--required', '--json', 'name,bucket'], repo));
    return Array.isArray(listed) ? listed : null;
  } catch (error) {
    const listed = parsed(error.stdout);
    if (Array.isArray(listed)) return listed;
    return /no required checks/i.test(`${error.stderr ?? ''} ${error.message ?? ''}`) ? [] : null;
  }
}

/**
 * Every check at the pull request's head that has not passed. A required check passes only as a pass: pending, failed, skipped or cancelled is
 * not one. Any other check that failed, waits or is stale holds it too, and with no check marked required every check counts as one.
 */
function notPassed(rollup, required) {
  const saidOf = check => `${checkName(check)} (${checkWord(check)})`;
  if (!required.length) return [...new Set(rollup.filter(check => checkWord(check)).map(saidOf))];

  const requiredNames = new Set(required.map(({ name }) => name));
  const requiredNotPassed = required
    .filter(({ bucket }) => bucket !== 'pass')
    .map(({ name, bucket }) => `${name} (${bucketWords[bucket] ?? bucket})`);
  const othersHolding = rollup
    .filter(check => !requiredNames.has(checkName(check)) && !['skipped', null].includes(checkWord(check)))
    .map(saidOf);
  return [...new Set([...requiredNotPassed, ...othersHolding])];
}

/** The signed-in user on the code host, whose pull requests hobkin opens, or null when it cannot be read. */
export async function signedInUser(gh, repo) {
  try {
    return firstLine(await gh(['api', 'user', '--jq', '.login'], repo)) || null;
  } catch {
    return null;
  }
}

/** Why the pull request, read again from the code host now, keeps the change asking, or null when it may merge. Checked in this order. */
export async function pullHolds({ gh, repo, item, unit, user }) {
  const view = await gh(['pr', 'view', item.pr, '--json', VIEW_FIELDS], repo).then(parsed, () => null);
  if (!view?.state) return 'its pull request could not be read, so nothing merges';
  if (view.state !== 'OPEN') return `its pull request is ${view.state.toLowerCase()}`;
  if (view.url !== item.pr) return 'its pull request is not the one hobkin opened for it';
  if (view.headRefName !== item.branch) return `its pull request is on ${view.headRefName}, not on its own branch`;
  if (view.isCrossRepository !== false) return 'its pull request comes from another repository';
  if (!user) return 'who is signed in to the code host could not be read, so nothing merges';
  if (view.author?.login !== user) return `its pull request was opened by ${view.author?.login ?? 'someone else'}, so it is theirs to merge`;
  const base = await defaultBranch(repo);
  if (!base || view.baseRefName !== base) return `its pull request goes into ${view.baseRefName}, not ${base || 'the default branch'}`;
  if (view.headRefOid !== unit.sha) return `its pull request moved to ${String(view.headRefOid).slice(0, SHORT_SHA)} since its review scored it`;
  if (view.isDraft !== false) return 'its pull request is a draft';
  if (view.mergeable !== 'MERGEABLE') return view.mergeable === 'CONFLICTING' ? 'its pull request conflicts with its base branch' : mergeStateWords.UNKNOWN;
  if (view.reviewDecision === 'CHANGES_REQUESTED') return 'changes were requested on its pull request';
  if (!['', 'APPROVED', null, undefined].includes(view.reviewDecision)) return 'its pull request needs a review approval';

  const rollup = Array.isArray(view.statusCheckRollup) ? view.statusCheckRollup : [];
  if (!rollup.length) return 'its pull request has no checks at this commit';
  const required = await requiredChecks(gh, item.pr, repo);
  if (!required) return 'its pull request\'s checks could not be read, so nothing merges';
  const failing = notPassed(rollup, required);
  if (failing.length) return `its pull request's checks have not all passed at this commit: ${failing.join(', ')}`;
  if (view.mergeStateStatus !== 'CLEAN') return mergeStateWords[view.mergeStateStatus] ?? `the code host says its pull request is ${String(view.mergeStateStatus).toLowerCase()}, not clean to merge`;
  return null;
}

/**
 * The reason a pull request kept asking at the pass, kept on its item for its report, when it changed. `tried` says a merge was asked for at
 * that commit and did not happen, so the pass asks no more until the pull request moves.
 */
function noteWhy(root, slug, item, head, why, now, { tried = false } = {}) {
  const known = item.yoloPull;
  if (known?.head === head && known?.why === why && Boolean(known.tried) === tried) return;
  updateItem(root, slug, item.id, { yoloPull: { head, why, ...(tried ? { tried } : {}) } }, now);
}

const QUEUED = 'its host queued its pull request or set it to merge by itself instead of merging it';

/**
 * A merge call that ended well and left the pull request open: on a branch that asks for a merge queue, gh queues it or turns auto-merge on,
 * which is the opposite of what the user allowed. hobkin turns auto-merge off where its host lets it, says so in Chat, and the change asks.
 */
async function turnBackQueued(root, { project, repo, row, item, unit, gh, now }) {
  const refused = await gh(['pr', 'merge', item.pr, '--disable-auto'], repo).then(() => null, error => firstLine(error.stderr || error.message));
  const named = `"${item.title}" on ${nameOf(project)}`;
  const asked = `YOLO mode asked to merge ${named}, and its host queued the pull request or set it to merge by itself instead.`;
  const why = refused ? `${QUEUED}, and hobkin could not turn that off (${refused}), so it may still merge there` : `${QUEUED}, so hobkin turned that off`;
  const line = refused ? `${asked} hobkin could not turn that off (${refused}), so it may still merge there. It asks you.` : `${asked} hobkin turned that off, and it asks you.`;
  noteWhy(root, row.slug, item, unit.sha, why, now, { tried: true });
  postClientNotice(root, { key: `yolo-queued:${row.slug}:${item.id}:${unit.sha}`, line, tone: refused ? 'critical' : 'useful' }, now);
  return null;
}

/** What the pass found kept a pull request asking, while the survey still reads the same commit. */
export const pullNoted = (item, unit) => (item.yoloPull && item.yoloPull.head === unit.sha ? item.yoloPull.why : null);

/**
 * Merges one change's own pull request on the code host by the user's own path, pinned to the commit its review scored, and answers the merge
 * commit the default branch got there (null when the host did not say it) with the pull request, or null when it did not merge, with why noted
 * on its item. `user` reads the signed-in user once a pass.
 */
export async function mergeOwnPull(root, { row, item, unit, gh, user, now }) {
  // A merge asked for at this commit that did not happen is not asked for again until the pull request moves.
  if (item.yoloPull?.head === unit.sha && item.yoloPull.tried) return null;
  const project = readProject(root, row.slug);
  const repo = project.path ?? paths(root, row.slug).clone;
  const why = await pullHolds({ gh, repo, item, unit, user: await user() });
  if (why) {
    noteWhy(root, row.slug, item, unit.sha, why, now);
    return null;
  }

  try {
    await mergePullRequest(root, row.slug, item.id, { head: unit.sha, gh, now });
  } catch (error) {
    if (error.notMerged && error.pull?.state === 'OPEN') return turnBackQueued(root, { project, repo, row, item, unit, gh, now });
    const said = error.notMerged ? `its host has not said its pull request merged, so nothing is recorded: ${firstLine(error.message)}` : `its pull request did not merge: ${firstLine(error.message).replace(/^"[^"]*" did not merge: /, '')}`;
    noteWhy(root, row.slug, item, unit.sha, said, now, { tried: Boolean(error.notMerged) });
    return null;
  }
  // The item closed only once its host said it merged, with its merge commit (`mergePullRequest`).
  const merged = readItems(root, row.slug).find(({ id }) => id === item.id);
  if (merged?.state !== 'merged' || !merged.landed?.sha) return null;
  // It merged on YOLO mode's word, not the user's.
  updateItem(root, row.slug, item.id, { landed: { ...merged.landed, route: 'yolo' } }, now);
  return { target: merged.landed.sha, pr: item.pr };
}
