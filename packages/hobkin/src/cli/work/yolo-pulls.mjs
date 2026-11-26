import { postClientNotice } from '../client-notices.mjs';
import { mergePullRequest } from './controls.mjs';
import { nameOf } from './names.mjs';
import { pullRequestRows } from './reads.mjs';
import { paths, readItems, readProject, updateItem } from './store.mjs';
import { BRANCH_PREFIX, defaultBranch } from './tree.mjs';
import { closeMergedPull, ghWithin, pullNow, readUnmerged } from './unmerged.mjs';
import { rulesOf } from './yolo-rules.mjs';

/**
 * A change of hobkin's own that waits on its open pull request merges by itself on the code host, under every rule a local branch is under
 * (`yolo-pass.mjs`), and then only once the code host, read again just before, says the pull request is still the one hobkin opened, from the
 * signed-in user, on the item's own branch, into the default branch, at the commit its review scored, and that it is open, not a draft, can
 * merge, needs no approval, has every check passed at that commit and nothing in branch protection blocks it. Anything that cannot be read
 * keeps it asking. The merge is the one the user's own yes on a pull request makes (`mergePullRequest`), pinned to that commit, and never
 * bypasses a protection.
 */

/**
 * Whether YOLO mode takes a change waiting on its own pull request on this project: the project's setting "Merge hobkin's own pull requests",
 * which is off until the user turns it on in the window (`yolo-rules.mjs`). While it is off, a pull request item keeps asking.
 */
export const pullRequestsMerge = (root, slug) => Boolean(root && slug) && rulesOf(root, slug).mergePulls === true;
/** What a change waiting on its pull request says while YOLO mode does not take pull requests. */
export const PULLS_OFF = 'automatic PR merges are off';

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
export function* pullSurveyHolds(item, unit) {
  if (!item.pr || !String(item.branch ?? '').startsWith(BRANCH_PREFIX)) yield 'its pull request is not on a branch of hobkin\'s own';
  if (unit.kind !== 'pr') {
    yield 'the last survey saw no open pull request for it';
    return;
  }
  // The survey lists the pull requests of the project's own repository, by branch. A run's outcome can name any address, so only that one counts.
  if (item.pr !== unit.url) {
    yield `its item names ${item.pr}, not the pull request the survey found on its branch in this repository`;
    return;
  }
  if (unit.headHere === false) yield `its pull request's head ${String(unit.sha).slice(0, SHORT_SHA)} is not in this repository, so its files cannot be read, and hobkin fetches nothing`;
  if (unit.draft) yield 'its pull request is a draft';
  if (unit.conflict) yield 'its pull request conflicts with its base branch';
  if (unit.review === 'CHANGES_REQUESTED') yield 'changes were requested on its pull request';
  if (unit.review === 'REVIEW_REQUIRED') yield 'its pull request needs a review approval';
  if (unit.ci === 'none') yield 'its pull request has no checks at this commit';
  else if (unit.ci !== 'passing') yield `its pull request's checks have not all passed at this commit: they are ${unit.ci}`;
}

export const pullSurveyed = (item, unit) => pullSurveyHolds(item, unit).next().value ?? null;

const parsed = text => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// A check run says its conclusion once it completed, and a status its state. Only a success is a pass: a neutral end is not one until the user
// says otherwise.
function checkWord({ conclusion, state, status }) {
  const result = String(conclusion || state || status || '').toUpperCase();
  if (result === 'SUCCESS') return null;
  if (result === 'NEUTRAL') return 'neutral';
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

/** Where a pull request lives, from its address: its host, owner and repository, or null for an address of another shape. */
function repositoryOf(url) {
  const found = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+$/.exec(String(url));
  return found ? { host: found[1], owner: found[2], name: found[3] } : null;
}

/**
 * What the default branch asks of a merge, by its branch protection and by every page of its rulesets, read with the user's own access: the
 * names of the checks it requires, and whether it merges through a queue. Null when either cannot be read. gh pr checks --required leaves out a
 * required check that never reported, so these are read apart.
 */
async function branchRules(gh, url, base, repo) {
  const where = repositoryOf(url);
  if (!where) return null;
  const api = (path, pages = []) => gh(['api', '--hostname', where.host, ...pages, path], repo).then(parsed, () => null);
  const [branch, paged] = await Promise.all([
    api(`repos/${where.owner}/${where.name}/branches/${base}`),
    api(`repos/${where.owner}/${where.name}/rules/branches/${base}`, ['--paginate', '--slurp']),
  ]);
  if (!branch?.name || !Array.isArray(paged)) return null;
  const rules = paged.flat();
  const protection = branch.protection?.required_status_checks ?? {};
  const protectedNames = [...(protection.contexts ?? []), ...(protection.checks ?? []).map(({ context }) => context)];
  const ruleChecks = rules
    .filter(({ type }) => type === 'required_status_checks')
    .flatMap(({ parameters }) => parameters?.required_status_checks ?? []);
  const ruleNames = ruleChecks.map(({ context }) => context);
  // A check a rule pins to one app passes only on that app's own run, never on a status of the same name from elsewhere.
  const pinned = [
    ...(protection.checks ?? []).map(({ context, app_id: app }) => ({ name: context, app })),
    ...ruleChecks.map(({ context, integration_id: app }) => ({ name: context, app })),
  ].filter(({ name, app }) => name && Number.isInteger(app) && app > 0);
  return {
    names: [...new Set([...protectedNames, ...ruleNames].filter(Boolean))],
    pinned,
    queue: rules.some(({ type }) => type === 'merge_queue'),
    approvals: rules.some(({ type, parameters }) => type === 'pull_request' && parameters?.required_approving_review_count > 0),
  };
}

/**
 * Each check pinned to an app that its app has not reported a success for at the head, read on every page of the check runs, or null when they
 * cannot be read.
 */
async function pinnedNotPassed(gh, url, sha, pinned, repo) {
  const where = repositoryOf(url);
  if (!where) return null;
  const said = [];
  for (const { name, app } of pinned) {
    const path = `repos/${where.owner}/${where.name}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100`;
    const pages = await gh(['api', '--hostname', where.host, '--paginate', '--slurp', path], repo).then(parsed, () => null);
    if (!Array.isArray(pages)) return null;
    const runs = pages.flatMap(page => page?.check_runs ?? []).filter(run => run.app?.id === app);
    if (!runs.length) said.push(`${name} (not reported by app ${app})`);
    else if (runs.some(({ conclusion }) => conclusion !== 'success')) said.push(`${name} (${runs.find(({ conclusion }) => conclusion !== 'success').conclusion ?? 'pending'} from app ${app})`);
  }
  return said;
}

const MERGE_QUEUE_QUERY = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){isMergeQueueEnabled isInMergeQueue}}}';

/**
 * Whether the pull request's own base branch merges through a queue, as the pull request itself says, or null when that cannot be read. gh pr
 * merge on such a branch queues the pull request, or turns auto-merge on, and gh has no way to take it out of the queue again.
 */
async function mergeQueueOf(gh, url, repo) {
  const where = repositoryOf(url);
  if (!where) return null;
  const number = String(url).split('/').at(-1);
  const fields = ['-f', `query=${MERGE_QUEUE_QUERY}`, '-F', `owner=${where.owner}`, '-F', `name=${where.name}`, '-F', `number=${number}`];
  const answer = await gh(['api', '--hostname', where.host, 'graphql', ...fields], repo).then(parsed, () => null);
  const pull = answer?.data?.repository?.pullRequest;
  if (typeof pull?.isMergeQueueEnabled !== 'boolean') return null;
  return pull.isMergeQueueEnabled || pull.isInMergeQueue === true;
}

const QUEUE_WORDS = 'its branch merges through a queue, which YOLO mode does not use';

/**
 * Every check at the pull request's head that has not passed. A required check, by gh or by the branch's protection and rulesets, passes only
 * when each run of it reported a success: missing, pending, failed, skipped, cancelled or neutral is not one. Any other check that did not
 * succeed holds it too, but for a skipped one, and with no check required every check counts as one.
 */
function notPassed(rollup, required, listed) {
  const saidOf = check => `${checkName(check)} (${checkWord(check)})`;
  const requiredNames = new Set([...required.map(({ name }) => name), ...listed]);
  if (!requiredNames.size) return [...new Set(rollup.filter(check => checkWord(check)).map(saidOf))];

  const bucketsNotPassed = required
    .filter(({ bucket }) => bucket !== 'pass')
    .map(({ name, bucket }) => `${name} (${bucketWords[bucket] ?? bucket})`);
  const requiredNotPassed = [...requiredNames].flatMap(name => {
    const runs = rollup.filter(check => checkName(check) === name);
    return runs.length ? runs.filter(check => checkWord(check)).map(saidOf) : [`${name} (missing)`];
  });
  const othersHolding = rollup
    .filter(check => !requiredNames.has(checkName(check)) && !['skipped', null].includes(checkWord(check)))
    .map(saidOf);
  return [...new Set([...bucketsNotPassed, ...requiredNotPassed, ...othersHolding])];
}

const UNLISTED = 'hobkin could not list the checks its branch requires, so it relied on the host\'s own state';
// Said while the change waits, a pass before it merges on the host's state alone, so the page shows it.
const UNLISTED_WAIT = 'hobkin cannot list this branch\'s required checks, so it goes by GitHub\'s own state';
// Said for good while the user's setting does not let a merge stand on the host's state alone.
const UNLISTED_OFF = 'hobkin cannot list this branch\'s required checks, and merging on GitHub\'s own state alone is turned off';

/** The signed-in user on the code host, whose pull requests hobkin opens, or null when it cannot be read. */
export async function signedInUser(gh, repo) {
  try {
    return firstLine(await gh(['api', 'user', '--jq', '.login'], repo)) || null;
  } catch {
    return null;
  }
}

/**
 * Why the pull request, read again from the code host now, keeps the change asking, as a sentence, or null when it may merge, or `{ relied }`
 * when it may merge on the host's own clean state alone, since the checks its branch requires could not be listed. Checked in this order.
 */
export async function pullHolds({ gh, repo, item, unit, user }) {
  const view = await gh(['pr', 'view', unit.url, '--json', VIEW_FIELDS], repo).then(parsed, () => null);
  if (!view?.state) return 'its pull request could not be read, so nothing merges';
  if (view.state !== 'OPEN') return `its pull request is ${view.state.toLowerCase()}`;
  if (view.url !== unit.url || item.pr !== unit.url) return 'its pull request is not the one the survey found on its branch in this repository';
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
  // A merge there would only queue it, or turn auto-merge on, and gh cannot take it out again: never asked for.
  const [rules, queue] = await Promise.all([branchRules(gh, unit.url, base, repo), mergeQueueOf(gh, unit.url, repo)]);
  if (queue === null) return 'hobkin cannot tell whether its branch merges through a queue, so nothing merges';
  if (queue || rules?.queue) return QUEUE_WORDS;

  const rollup = Array.isArray(view.statusCheckRollup) ? view.statusCheckRollup : [];
  if (!rollup.length) return 'its pull request has no checks at this commit';
  const required = await requiredChecks(gh, unit.url, repo);
  if (!required) return 'its pull request\'s checks could not be read, so nothing merges';
  const listed = rules?.names ?? null;
  // Where the branch's own list cannot be read, the host's clean state is all that says a required check reported.
  const relied = said => (listed ? said : `${said}. ${UNLISTED}`);
  const fromApps = rules?.pinned.length ? await pinnedNotPassed(gh, unit.url, unit.sha, rules.pinned, repo) : [];
  if (!fromApps) return 'its pull request\'s checks could not be read, so nothing merges';
  const failing = [...new Set([...notPassed(rollup, required, listed ?? []), ...fromApps])];
  if (failing.length) return relied(`its pull request's checks have not all passed at this commit: ${failing.join(', ')}`);
  if (view.mergeStateStatus !== 'CLEAN') return relied(mergeStateWords[view.mergeStateStatus] ?? `the code host says its pull request is ${String(view.mergeStateStatus).toLowerCase()}, not clean to merge`);
  if (!listed) return { relied: UNLISTED };
  return null;
}

/**
 * The reason a pull request kept asking at the pass, kept on its item for its report, when it changed. `tried` says a merge was asked for at
 * that commit and did not happen, so the pass asks no more until the pull request moves. `again` lets it ask once more a day later, for a host
 * that refused, whose settings may have changed since; one that queued the pull request is not asked again at that commit.
 */
function noteWhy(root, slug, item, head, why, now, { tried = false, again = false } = {}) {
  const known = item.yoloPull;
  if (known?.head === head && known?.why === why && Boolean(known.tried) === tried && !again) return;
  const when = tried && again ? { triedAt: new Date(now).toISOString() } : {};
  updateItem(root, slug, item.id, { yoloPull: { head, why, ...(tried ? { tried } : {}), ...when } }, now);
}

const DAY_MS = 24 * 3600000;
const askedAlready = ({ yoloPull }, head, now) => yoloPull?.head === head && yoloPull.tried && (!yoloPull.triedAt || now - Date.parse(yoloPull.triedAt) < DAY_MS);

const QUEUED = 'its host queued its pull request or set it to merge by itself instead of merging it';

/**
 * A merge call that ended well and left the pull request open: on a branch that asks for a merge queue, gh queues it or turns auto-merge on,
 * which is the opposite of what the user allowed. hobkin turns auto-merge off where its host lets it, says so in Chat, and the change asks.
 */
async function turnBackQueued(root, { project, repo, row, item, unit, gh, now }) {
  const refused = await gh(['pr', 'merge', unit.url, '--disable-auto'], repo).then(() => null, error => firstLine(error.stderr || error.message));
  const named = `"${item.title}" on ${nameOf(project)}`;
  const asked = `YOLO mode asked to merge ${named}, and its host queued the pull request or set it to merge by itself instead.`;
  const why = refused ? `${QUEUED}, and hobkin could not turn that off (${refused}), so it may still merge there` : `${QUEUED}, so hobkin turned that off`;
  const line = refused ? `${asked} hobkin could not turn that off (${refused}), so it may still merge there. It asks you.` : `${asked} hobkin turned that off, and it asks you.`;
  noteWhy(root, row.slug, item, unit.sha, why, now, { tried: true });
  postClientNotice(root, { key: `yolo-queued:${row.slug}:${item.id}:${unit.sha}`, line, tone: refused ? 'critical' : 'useful' }, now);
  return null;
}

/**
 * A merge call gh was cut short in, which may have merged on its host before it ended. Read back at once, a pull request merged at the commit
 * this pass asked for is this pass's merge, and recorded as YOLO mode's. One that cannot be read back is not: Chat says it may have merged, and
 * the survey records it as a merge on the remote if it did.
 */
async function readBackCutShort(root, { project, repo, row, item, unit, gh, relied, now }) {
  const pull = await pullNow(unit.url, repo, gh);
  if (pull?.state === 'MERGED' && pull.mergeCommit?.oid && pull.headRefOid === unit.sha) {
    closeMergedPull(root, row.slug, { ...item, pr: unit.url }, pull, now);
    const merged = readItems(root, row.slug).find(({ id }) => id === item.id);
    updateItem(root, row.slug, item.id, { landed: { ...merged.landed, route: 'yolo' } }, now);
    return { target: pull.mergeCommit.oid, pr: unit.url, ...(relied ? { relied } : {}) };
  }
  const named = `"${item.title}" on ${nameOf(project)}`;
  const why = pull?.state === 'OPEN' ? 'gh was cut short asking its host to merge it, and it did not merge' : 'gh was cut short asking its host to merge it, and whether it merged is not known yet';
  noteWhy(root, row.slug, item, unit.sha, why, now, { tried: true, again: true });
  if (pull?.state !== 'OPEN') {
    const line = `YOLO mode asked to merge ${named}, and gh was cut short before it said whether it merged. If it did, the next survey records it as a merge on the host, and it asks you.`;
    postClientNotice(root, { key: `yolo-cut-short:${row.slug}:${item.id}:${unit.sha}`, line, tone: 'critical' }, now);
  }
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
  // A merge asked for at this commit that did not happen is not asked for again until the pull request moves, or a day after a refusal.
  if (askedAlready(item, unit.sha, now)) return null;
  const project = readProject(root, row.slug);
  const repo = project.path ?? paths(root, row.slug).clone;
  const held = await pullHolds({ gh, repo, item, unit, user: await user() });
  if (typeof held === 'string') {
    noteWhy(root, row.slug, item, unit.sha, held, now);
    return null;
  }
  const relied = held?.relied ?? null;
  if (relied && !rulesOf(root, row.slug).mergeWhenChecksUnlisted) {
    noteWhy(root, row.slug, item, unit.sha, UNLISTED_OFF, now);
    return null;
  }
  if (relied && !(item.yoloPull?.head === unit.sha && item.yoloPull.why === UNLISTED_WAIT)) {
    noteWhy(root, row.slug, item, unit.sha, UNLISTED_WAIT, now);
    return null;
  }

  try {
    // The address the fresh read checked, and only it, whatever the item says by now.
    await mergePullRequest(root, row.slug, item.id, { head: unit.sha, url: unit.url, gh, now });
  } catch (error) {
    if (error.notMerged && error.pull?.state === 'OPEN') return turnBackQueued(root, { project, repo, row, item, unit, gh, now });
    if (error.cutShort) return readBackCutShort(root, { project, repo, row, item, unit, gh, relied, now });
    const said = error.notMerged ? `its host has not said its pull request merged, so nothing is recorded: ${firstLine(error.message)}` : `its pull request did not merge: ${firstLine(error.message).replace(/^"[^"]*" did not merge: /, '')}`;
    noteWhy(root, row.slug, item, unit.sha, said, now, { tried: true, again: true });
    return null;
  }
  // The item closed only once its host said it merged, with its merge commit (`mergePullRequest`).
  const merged = readItems(root, row.slug).find(({ id }) => id === item.id);
  if (merged?.state !== 'merged' || !merged.landed?.sha) return null;
  // It merged on YOLO mode's word, not the user's.
  updateItem(root, row.slug, item.id, { landed: { ...merged.landed, route: 'yolo' } }, now);
  return { target: merged.landed.sha, pr: unit.url, ...(relied ? { relied } : {}) };
}

const REQUIREMENT_FIELDS = 'baseRefName,reviewDecision,statusCheckRollup';

/**
 * What GitHub must have for a pull request of this project to merge by itself safely, each as met, not met, or null when it could not be read:
 * the default branch requires status checks to pass, no merge queue is on, no approval is required, and checks exist at the commit. It reads
 * them from the project's first pull request of hobkin's own, with the user's own gh, and writes nothing to GitHub. `pull` is null when none waits.
 */
export async function pullRequirements(root, slug, { gh = defaultPullGh } = {}) {
  const found = pullCandidates(root).find(({ row, item, unit }) => row.slug === slug && item.pr && unit.url);
  if (!found) return { pull: null, requirements: [] };

  const { unit } = found;
  const project = readProject(root, slug);
  const repo = project.path ?? paths(root, slug).clone;
  const view = await gh(['pr', 'view', unit.url, '--json', REQUIREMENT_FIELDS], repo).then(parsed, () => null);
  const base = view?.baseRefName || (await defaultBranch(repo));
  const [rules, queue] = base ? await Promise.all([branchRules(gh, unit.url, base, repo), mergeQueueOf(gh, unit.url, repo)]) : [null, null];
  const known = value => (value === null || value === undefined ? null : value);
  const requirements = [
    { key: 'requiredChecks', words: 'The default branch requires status checks to pass', met: known(rules && rules.names.length > 0) },
    { key: 'noMergeQueue', words: 'No merge queue is on', met: queue === null ? null : !(queue || rules?.queue) },
    { key: 'noApproval', words: 'No approval is required', met: rules && view ? !rules.approvals && view.reviewDecision !== 'REVIEW_REQUIRED' : null },
    { key: 'checksAtCommit', words: 'Checks exist at the commit', met: Array.isArray(view?.statusCheckRollup) ? view.statusCheckRollup.length > 0 : null },
  ];
  return { pull: unit.url, requirements };
}
