import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { atomicJson } from '../config.mjs';
import { readReviewGrades, reviewsFolder } from './grades.mjs';
import { areaOf, isTestPath } from './patterns.mjs';
import { BRANCH_PREFIX, changesOnlyDocs, defaultBranch, gitOrNothing, isMerged } from './tree.mjs';
import { chosenProjects, fileItem, paths, readItems, readJson, runnableStates, updateItem } from './store.mjs';

export const SHIP_KIND = 'pr-fix';
const SHORT_SHA = 7;
const MOST_PRS = 200;
const DAY_MS = 24 * 3600000;
// One survey runs at a time, so a `gh` that never answers would stop every survey after it until Hobkin restarts.
const GH_TIMEOUT_MS = 2 * 60000;
const PR_FIELDS = 'number,title,url,state,isDraft,createdAt,mergedAt,mergeCommit,additions,deletions,changedFiles,reviewDecision,statusCheckRollup,mergeable,headRefName,headRefOid';
// A branch proves a merge only for these: a new branch with no commits also counts as merged into the default branch.
export const finishedOnBranch = ['pr', 'branch'];
const closableStates = [...finishedOnBranch, ...runnableStates];
const conflictOf = { CONFLICTING: true, MERGEABLE: false };
// A local-review branch only keeps an old PR, so holding work says nothing about that work having shipped.
const notTheUsers = [BRANCH_PREFIX, 'local-review/'];
const MOST_BRANCHES_CHECKED = 8;
const MOST_COMMITS_BACK = 40;
// Past the 300 changed lines an offer allows, so a list this long gets no offer whatever it names.
const MOST_PATHS = 400;
// What a run left uncommitted, saved beside its own branch. It is that item's, for its next run to use, and no change of its own.
const KEPT_BRANCH = /-kept-\d{8}-\d{6}$/;
// A copy a run saved of a branch before it rewrote it, named for what came next: `-before-` and an item's id, or `-before-rebase-` and a commit or a date.
// Its work is on the branch it copies, or has landed from there, so a backup is no unit and gets no item or fix, and holding work says nothing about where that work went.
const BACKUP_BRANCH = /-before-(?:rebase-)?[0-9a-f]{6,40}$/;
// The survey's own items: one for a branch nothing named, and work to get a branch merged.
const SURVEY_KEY = /^(?:branch|ship):/;
const BACKUP_REASON = 'Its branch is only a backup of another branch, so there is no work of its own here.';

const run = promisify(execFile);
export const ghWithin = timeout => async (args, cwd) => (await run('gh', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 })).stdout;
const defaultGh = ghWithin(GH_TIMEOUT_MS);
const surveyPath = root => join(root, 'work', 'unmerged.json');

export const readUnmerged = root => readJson(surveyPath(root), { at: null, projects: {} });

const latest = times => times.filter(Boolean).toSorted().at(-1) ?? null;

// A fix on a branch says nothing about the work there, so only what made the branch counts.
const makersOf = ({ branch }, items) => items.filter(item => item.branch === branch && item.kind !== SHIP_KIND);

/** Only an item says its branch is finished. One still being worked on or given up on waits for no merge, and neither does a branch with no item, such as one a reset forgot. */
const waitsOnMerge = (unit, items) => makersOf(unit, items).some(item => finishedOnBranch.includes(item.state));

/** What is finished and waiting for the user's merge on one project, as of the last survey. This only ever reorders work: nothing waits on it. */
export function pendingMerges(root, slug) {
  const items = readItems(root, slug);
  return (readUnmerged(root).projects[slug]?.open ?? []).filter(unit => waitsOnMerge(unit, items));
}

/** How much is open, as of the last survey, and how much of that is `pending`, waiting on a merge. Only counts: nothing waits on them. */
export function unmergedNow(root) {
  const { at, projects } = readUnmerged(root);
  const perProject = Object.fromEntries(Object.entries(projects).map(([slug, project]) => [slug, project.open.length]));
  const pending = Object.fromEntries(Object.keys(projects).map(slug => [slug, pendingMerges(root, slug).length]));
  const open = Object.values(perProject).reduce((sum, count) => sum + count, 0);
  return { at, open, perProject, pending };
}

export function ciState(checks = []) {
  const results = checks.map(check => check.conclusion || check.state || check.status);
  if (!results.length) return 'none';
  if (results.some(result => /FAIL|ERROR|CANCEL|TIMED_OUT/i.test(result))) return 'failing';
  return results.every(result => /SUCCESS|NEUTRAL|SKIPPED/i.test(result)) ? 'passing' : 'pending';
}

const pullUnit = pr => ({
  kind: 'pr',
  branch: pr.headRefName,
  title: pr.title,
  url: pr.url,
  openedAt: pr.createdAt,
  draft: pr.isDraft,
  size: { additions: pr.additions, deletions: pr.deletions, files: pr.changedFiles },
  review: pr.reviewDecision || 'none',
  ci: ciState(pr.statusCheckRollup),
  mergeable: pr.mergeable ?? 'UNKNOWN',
  conflict: conflictOf[pr.mergeable] ?? null,
});

/**
 * A repository with no remote, or a `gh` that is missing or signed out, simply has no PRs to count: its branches still do.
 * Left to itself `gh` lists the PRs of a fork's `upstream`, so it is told which repository to ask.
 */
async function pullRequests(repo, gh) {
  const origin = await gitOrNothing(repo, 'remote', 'get-url', 'origin');
  try {
    const list = JSON.parse(await gh(['pr', 'list', ...(origin ? ['--repo', origin] : []), '--state', 'all', '--limit', String(MOST_PRS), '--json', PR_FIELDS], repo));
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

function sizeOf(shortstat) {
  const number = word => Number(new RegExp(`(\\d+) ${word}`).exec(shortstat)?.[1] ?? 0);
  return { additions: number('insertion'), deletions: number('deletion'), files: number('file') };
}

async function localBranches(repo, base) {
  const refs = await gitOrNothing(repo, 'for-each-ref', '--format=%(refname:short)%09%(committerdate:iso-strict)%09%(objectname)', `refs/heads/${BRANCH_PREFIX}`);
  const merged = new Set((await gitOrNothing(repo, 'branch', '--merged', base, '--format=%(refname:short)', '--list', `${BRANCH_PREFIX}*`)).split('\n'));
  return refs.split('\n').filter(Boolean).map(line => {
    const [name, at, sha] = line.split('\t');
    // With no default branch known, `base` is whatever is checked out, and a branch holding itself proves nothing.
    return { name, at, sha, merged: merged.has(name) && name !== base };
  });
}

/**
 * The commit a branch has to land on, as last fetched, because a survey fetches nothing. A run starts from the remote's default branch, and
 * a checkout or Hobkin's own clone can lag far behind it, so the remote speaks first. A checkout holding what the remote lacks has merges not pushed yet.
 */
export async function landingTip(repo, base) {
  // With no default branch known, `base` is whatever is checked out, and a run's own branch says nothing about another one.
  if (!base || base.startsWith(BRANCH_PREFIX)) return null;
  const tipOf = ref => gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', ref);
  const [local, remote] = await Promise.all([tipOf(`refs/heads/${base}`), tipOf(`refs/remotes/origin/${base}`)]);
  if (local && remote && !await isMerged(repo, local, remote)) return local;
  return remote || local || null;
}

async function commitsBehind(repo, tip, name) {
  const count = tip && await gitOrNothing(repo, 'rev-list', '--count', `${name}..${tip}`);
  return count ? Number(count) : null;
}

/**
 * `merge-tree` writes the merge it works out, so its objects go to a folder of our own and the repository is only read. `--quiet` is no answer:
 * it promises to skip only most objects, and git 2.50.1 crashes on it when two branches have two merge bases.
 */
async function conflictsWith(repo, tip, name) {
  if (!tip) return null;
  const objects = await gitOrNothing(repo, 'rev-parse', '--path-format=absolute', '--git-path', 'objects');
  const scratch = await mkdtemp(join(tmpdir(), 'hobkin-merge-'));
  const env = { ...process.env, GIT_OBJECT_DIRECTORY: scratch, GIT_ALTERNATE_OBJECT_DIRECTORIES: objects };
  try {
    await run('git', ['-C', repo, 'merge-tree', '--write-tree', tip, name], { env, maxBuffer: 16 * 1024 * 1024 });
    return false;
  } catch ({ code, stderr }) {
    // Status 1 alone is no conflict: a name git cannot read exits the same way, and only that one says why.
    return code === 1 && !stderr ? true : null;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const lines = text => text.split('\n').filter(Boolean);

/** What the branch changes, whatever it sits on, so a rebase that changed nothing has the same answer. */
async function changeOf(repo, base, name) {
  const diff = await gitOrNothing(repo, 'diff', '-U0', '--no-color', `${base}...${name}`);
  const changed = lines(diff).filter(line => !/^(@@|index )/.test(line)).join('\n');
  return createHash('sha256').update(changed).digest('hex').slice(0, 16);
}

async function nearestGrade(repo, name, grades) {
  const history = lines(await gitOrNothing(repo, 'rev-list', `--max-count=${MOST_COMMITS_BACK}`, name));
  return history.map(sha => grades.get(sha)).find(Boolean);
}

/** A grade belongs to one commit. One from further back says so, and a rebase that changed nothing keeps what it had. With no change to compare, nothing is kept. */
async function safetyOf({ repo, name, sha, change, grades, before }) {
  const { modified, ...exact } = grades.get(sha) ?? {};
  if (exact.grade) return exact;
  if (before?.safety && change && before.change === change) return before.safety;

  const older = await nearestGrade(repo, name, grades);
  if (!older) return null;
  const { modified: _older, ...grade } = older;
  return { ...grade, stale: true };
}

async function holdersOf(repo, sha) {
  return lines(await gitOrNothing(repo, 'for-each-ref', '--contains', sha, '--format=%(refname:short)%09%(objectname)', 'refs/heads'))
    .map(line => line.split('\t'));
}

async function usersBranches(repo, base) {
  const newestFirst = lines(await gitOrNothing(repo, 'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'));
  const theirs = newestFirst.filter(name => name !== base && !notTheUsers.some(prefix => name.startsWith(prefix)) && !BACKUP_BRANCH.test(name));
  return theirs.slice(0, MOST_BRANCHES_CHECKED);
}

async function holdsAllOf(repo, other, name) {
  const commits = lines(await gitOrNothing(repo, 'cherry', other, name));
  return commits.length > 0 && commits.every(line => line.startsWith('-'));
}

/** Where else this work sits. The newest branches of the user's are enough, because work lands on what is being worked on. */
async function placesOf({ repo, name, sha, finished, others }) {
  const holders = (await holdersOf(repo, sha)).filter(([holder]) => holder !== name);
  const stackedUnder = holders.find(([holder, tip]) => finished.has(holder) && tip !== sha)?.[0] ?? null;
  // `stackedUnder` folds a row into one branch. Landing either of two branches on top brings this along, and this list says so.
  const heldBy = holders.filter(([, tip]) => tip !== sha).map(([holder]) => holder);
  const merged = others.find(other => holders.some(([holder]) => holder === other));
  if (merged) return { stackedUnder, heldBy, landedOn: merged };

  // One at a time, because a survey already runs one of these for every branch of a project together.
  for (const other of others) {
    if (await holdsAllOf(repo, other, name)) return { stackedUnder, heldBy, landedOn: other };
  }
  return { stackedUnder, heldBy, landedOn: null };
}

const plainPaths = ['-c', 'core.quotePath=false', 'diff', '--no-renames'];

function fileLine(line) {
  const [added, removed, path] = line.split('\t');
  return { path, lines: (Number(added) || 0) + (Number(removed) || 0) };
}

/** What a change touches, reading only. A rename is a delete and an add here, because a test moved away is a test that no longer runs where it did. */
async function pathsOf(repo, base, name) {
  const range = `${base}...${name}`;
  const files = lines(await gitOrNothing(repo, ...plainPaths, '--numstat', range)).map(fileLine);
  const deleted = lines(await gitOrNothing(repo, ...plainPaths, '--name-only', '--diff-filter=D', range));
  return { area: areaOf(files), paths: files.map(({ path }) => path).slice(0, MOST_PATHS), deletedTests: deleted.filter(isTestPath) };
}

const sizeOfRange = async (repo, base, name) => sizeOf(await gitOrNothing(repo, 'diff', '--shortstat', `${base}...${name}`));

/** What a merge records about the branch it is about to land, because once it lands the two have nothing left to compare. */
export async function changeFacts(repo, base, name) {
  const { area } = await pathsOf(repo, base, name);
  return { area, size: await sizeOfRange(repo, base, name) };
}

async function branchUnit({ repo, base, tip, branch: { name, at, sha }, grades, finished, others, previous }) {
  const change = await changeOf(repo, base, name);
  const before = (previous.open ?? []).find(unit => unit.branch === name);
  return {
    kind: 'branch',
    branch: name,
    sha,
    title: await gitOrNothing(repo, 'log', '-1', '--format=%s', name),
    openedAt: new Date(at).toISOString(),
    size: await sizeOfRange(repo, base, name),
    ...await pathsOf(repo, base, name),
    behind: await commitsBehind(repo, tip, name),
    // Not knowing is an answer, so nothing here can cost a project its survey.
    conflict: await conflictsWith(repo, tip, name).catch(() => null),
    onlyDocs: await changesOnlyDocs(repo, base, name),
    change,
    safety: await safetyOf({ repo, name, sha, change, grades, before }),
    ...await placesOf({ repo, name, sha, finished, others }),
  };
}

/**
 * A PR merges on its host at the head the host reports, so that commit is the one graded, the way a branch is. A head this repository does not have
 * can still match a review of it, but there is nothing to compare with an older grade or to stack, so it gets no more than that. A PR ships on its
 * host, so a local branch of the user's that holds its head, such as one preparing a release on top of it, is not where it went.
 */
async function pullHead({ repo, base, pr, grades, finished, previous }) {
  const sha = pr.headRefOid ?? null;
  if (!sha) return { sha, safety: null };
  const here = Boolean(await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`));
  const change = here ? await changeOf(repo, base, sha) : null;
  const before = (previous.open ?? []).find(unit => unit.branch === pr.headRefName);
  return {
    sha,
    change,
    safety: await safetyOf({ repo, name: sha, sha, change, grades, before }),
    ...(here ? await placesOf({ repo, name: pr.headRefName, sha, finished, others: [] }) : {}),
  };
}

/** Branches open last time that the default branch holds now. Only the last survey knows them once a merged branch is deleted. */
async function mergedHere({ repo, base, units, previous }) {
  const stillOpen = new Set(units.map(unit => unit.branch));
  const gone = (previous.open ?? []).filter(unit => unit.kind === 'branch' && !stillOpen.has(unit.branch));
  const landed = await Promise.all(gone.map(unit => isMerged(repo, unit.sha, base)));
  return gone.filter((_unit, index) => landed[index]).map(unit => unit.branch);
}

async function treesHeld(repo, { look, do: doing }) {
  const listed = (await gitOrNothing(repo, 'worktree', 'list', '--porcelain')).split('\n');
  return listed.filter(line => line === `worktree ${look}` || line === `worktree ${doing}`).length;
}

/** Read-only `git` and `gh`, and no model. A PR and its branch are one piece of work, and so is a worktree holding that branch. */
async function surveyProject({ repo, trees, previous = {}, now, gh, grades, finished }) {
  // `gitOrNothing` hears a missing folder as an empty repository, which would pass for a project with nothing open.
  if (!await gitOrNothing(repo, 'rev-parse', '--git-dir')) throw Error(`Cannot read ${repo}.`);
  const base = await defaultBranch(repo);
  const tip = await landingTip(repo, base);
  const branches = await localBranches(repo, base);
  const pulls = await pullRequests(repo, gh) ?? [];
  // An item can name a PR on any head, but only a hobkin head is work to count.
  const ownPulls = pulls.filter(pr => pr.headRefName?.startsWith(BRANCH_PREFIX));
  // A closed PR leaves its branch as the record of the work, so only an open or merged one speaks for that branch.
  const withPull = new Set(ownPulls.filter(pr => pr.state !== 'CLOSED').map(pr => pr.headRefName));
  const bare = branches.filter(branch => !branch.merged && !withPull.has(branch.name) && !BACKUP_BRANCH.test(branch.name));
  const others = await usersBranches(repo, base);
  const units = await Promise.all(bare.map(branch => branchUnit({ repo, base, tip, branch, grades, finished, others, previous })));
  const landed = await mergedHere({ repo, base, units, previous });
  // Git keeps no date for a local merge, so one seen now is dated now.
  const merges = [previous.lastMergeAt, landed.length ? new Date(now).toISOString() : null, ...ownPulls.map(pr => pr.mergedAt)];
  // A PR's head is known locally when a run made it, and a merge from elsewhere leaves nothing else to tell what it touched.
  const surveyPull = async pr => ({
    ...pullUnit(pr),
    ...await pathsOf(repo, base, pr.headRefName),
    ...await pullHead({ repo, base, pr, grades, finished, previous }),
  });
  const openPulls = await Promise.all(ownPulls.filter(pr => pr.state === 'OPEN').map(surveyPull));
  return {
    survey: {
      open: [...openPulls, ...units],
      lastMergeAt: latest(merges),
      trees: await treesHeld(repo, trees),
    },
    pulls,
    held: new Set([...branches.filter(branch => branch.merged).map(branch => branch.name), ...landed]),
    tips: new Map(branches.map(branch => [branch.name, branch.sha])),
    before: previous.open ?? [],
    base,
    tip,
  };
}

/** The PR that speaks for an item. The one it names settles it by merging. Otherwise an open PR on its head outranks the rest there, and merged beats closed. */
function pullOf(item, pulls) {
  const own = pulls.find(pr => pr.url === item.pr);
  if (own?.state === 'MERGED') return own;
  const heads = [item.branch, own?.headRefName].filter(Boolean);
  const inState = state => pulls.find(pr => pr.state === state && heads.includes(pr.headRefName));
  return inState('OPEN') ?? inState('MERGED') ?? own ?? inState('CLOSED');
}

// A fix is filed for a branch with commits of its own, so that branch landing proves the merge, and no run should go on work that already landed.
const branchProvesMerge = item => finishedOnBranch.includes(item.state) || item.kind === SHIP_KIND;

const pullSize = ({ additions, deletions, changedFiles }) => ({ additions, deletions, files: changedFiles });

/** The record of a change `facts` says landed, one way or another. `size` is what git counted, and `area` is null when nothing read the branch before it went. */
export const landedRecord = (item, { safety = null, ...facts }) => ({
  ...facts,
  safety: safety && { grade: safety.grade, rating: safety.rating, stale: Boolean(safety.stale) },
  quality: item.quality ? { rating: item.quality.rating } : null,
});

/** A merge on the remote, so all hobkin can say of it is what its host and the last survey know. A fix on a branch is no change of its own. */
function landedElsewhere(item, pull, { tips, before }, at) {
  if (item.kind === SHIP_KIND) return {};
  const branch = pull?.headRefName ?? item.branch;
  const unit = before.find(known => known.branch === branch);
  const landed = landedRecord(item, {
    sha: pull?.mergeCommit?.oid ?? tips.get(branch) ?? unit?.sha ?? null,
    at: pull?.mergedAt ?? at,
    route: 'remote',
    read: 'none',
    readMs: 0,
    safety: unit?.safety,
    size: pull ? pullSize(pull) : unit?.size ?? null,
    area: unit?.area ?? null,
    spot: false,
  });
  return { landed };
}

const mergedOutcome = (item, pull, found, at) => ({
  state: 'merged',
  mergedAt: pull?.mergedAt ?? at,
  ...landedElsewhere(item, pull, found, at),
});

/** One PR as its host reports it now, with the fields the survey reads, or null when the host cannot say. */
export async function pullNow(url, repo, gh = defaultGh) {
  try {
    const text = await gh(['pr', 'view', url, '--json', PR_FIELDS], repo);
    const pull = JSON.parse(text);
    return pull?.state ? pull : null;
  } catch {
    return null;
  }
}

/** A PR the user merged from its card closes its item at once, the way the survey closes one its host reports merged. With no `pull`, the last survey's facts stand in. */
export function closeMergedPull(root, slug, item, pull, now = Date.now()) {
  const before = readUnmerged(root).projects[slug]?.open ?? [];
  // A PR merges at its host's head, which the last survey read, so no local branch tip is read for it.
  const found = { tips: new Map(), before };
  const outcome = mergedOutcome(item, pull, found, new Date(now).toISOString());
  return updateItem(root, slug, item.id, outcome, now);
}

function outcomeOf(item, found, at) {
  const { pulls, held } = found;
  const pull = pullOf(item, pulls);
  if (pull?.state === 'OPEN') return null;

  const landed = pull?.state === 'MERGED' || (branchProvesMerge(item) && held.has(item.branch));
  if (landed) return mergedOutcome(item, pull, found, at);

  // The user closes a PR to keep its work as a local branch for review, so this declines nothing: the branch stays the record.
  if (item.state !== 'pr' || !pull) return null;
  return { state: 'branch', pr: null, closedPr: pull.url, branch: item.branch ?? pull.headRefName };
}

// Read after the survey's waits, with none before the writes, so an item changed during a slow `gh` is judged as it stands now.
function settleItems(root, slug, found, now) {
  const at = new Date(now).toISOString();
  const closable = readItems(root, slug).filter(item => closableStates.includes(item.state));
  return closable.flatMap(item => {
    const outcome = outcomeOf(item, found, at);
    if (!outcome) return [];
    updateItem(root, slug, item.id, outcome, now);
    return [{ slug, id: item.id, title: item.title, state: outcome.state }];
  });
}

/** What stops a unit merging, and the work that would clear it. A rebase runs CI again, so a conflict comes first and one item covers both. */
function shipWork({ branch, conflict, ci, url }, base) {
  if (conflict) {
    return {
      need: 'rebase',
      title: `Rebase ${branch} onto ${base}`,
      brief: `${branch} conflicts with ${base}, so it cannot merge. Rebase it onto ${base} so both sides' intent survives, and add nothing else.`,
    };
  }
  if (ci !== 'failing') return null;
  return {
    need: 'ci',
    title: `Fix CI on ${branch}`,
    brief: `CI is failing on ${branch}: ${url}. Make it pass on that branch, and add nothing else.`,
  };
}

const beingWorkedOn = ({ branch }, items) => items.some(item => item.branch === branch && runnableStates.includes(item.state));

// One more commit on the default branch does not help a run that gave up on this branch, and each try is a whole run.
const fixedToday = ({ branch }, items, now) => items.some(item => item.kind === SHIP_KIND && item.branch === branch && now - Date.parse(item.at) < DAY_MS);

/**
 * Finished work that cannot merge goes in the queue, on its own branch. The key holds the default branch's commit, so a repeat survey files nothing,
 * and the same trouble after a newer default branch is new work, once a day at most. It reads as `settleItems` does, after the survey's waits and with none before the writes.
 */
function fileShipWork(root, slug, { survey, base, tip }, now) {
  if (!tip) return [];
  return survey.open.flatMap(unit => {
    const work = shipWork(unit, base);
    const items = readItems(root, slug);
    if (!work || !waitsOnMerge(unit, items) || beingWorkedOn(unit, items) || fixedToday(unit, items, now)) return [];
    const key = `ship:${work.need}:${unit.branch}:${tip.slice(0, SHORT_SHA)}`;
    if (items.some(item => item.key === key)) return [];

    const { id } = fileItem(root, slug, { ...work, key, kind: SHIP_KIND, impact: 'high', effort: 'small' }, now);
    const shipped = makersOf(unit, items).find(item => finishedOnBranch.includes(item.state));
    updateItem(root, slug, id, { branch: unit.branch, ships: shipped.id }, now);
    return [{ slug, id, title: work.title, branch: unit.branch }];
  });
}

const strayBrief = branch => `${branch} holds work no item names, so the survey filed this to keep it in sight.`;

/** Nothing waiting stays out of sight, so a hobkin branch no item names gets one, once. An item keeps its branch whatever becomes of it. */
function adoptStrayBranches(root, slug, { survey }, now) {
  const items = readItems(root, slug);
  const strays = survey.open.filter(({ kind, branch }) => kind === 'branch' && !KEPT_BRANCH.test(branch) && !items.some(item => item.branch === branch));
  return strays.map(({ branch, title }) => {
    const { id } = fileItem(root, slug, { key: `branch:${branch}`, kind: 'chore', title: title || branch, brief: strayBrief(branch) }, now);
    updateItem(root, slug, id, { state: 'branch', branch }, now);
    return { slug, id, title: title || branch, branch };
  });
}

const filedForABackup = ({ key, state, branch }) => SURVEY_KEY.test(key) && closableStates.includes(state) && BACKUP_BRANCH.test(branch ?? '');

/** What the survey filed for a backup before it knew one, closed with its branch kept. What the user or an agent filed stays theirs, whatever its branch. */
function retireBackupWork(root, slug, now) {
  const forBackups = readItems(root, slug).filter(filedForABackup);
  return forBackups.map(({ id, title, branch }) => {
    updateItem(root, slug, id, { state: 'dropped', reason: BACKUP_REASON }, now);
    return { slug, id, title, branch };
  });
}

/**
 * Only projects still being worked on count. Work that has landed closes its item here, and `settled` names them. Work that cannot merge gets an item, and `filed`
 * names those. A branch nothing named gets an item, and `adopted` names those. What was filed for a backup is dropped, and `retired` names those.
 * This writes only hobkin's own records, and it never writes to a repository.
 */
export async function surveyUnmerged(root, { now = Date.now(), gh = defaultGh, reviews = reviewsFolder() } = {}) {
  const previous = readUnmerged(root).projects;
  const grades = readReviewGrades({ folder: reviews, now });
  const projects = {};
  const settled = [];
  const filed = [];
  const adopted = [];
  const retired = [];
  for (const { slug, path } of chosenProjects(root)) {
    const { clone, lookTree, doTree } = paths(root, slug);
    // A name alone says a branch is a backup, so this reads nothing from the repository. It goes first, so no item for a backup counts as finished work below.
    retired.push(...retireBackupWork(root, slug, now));
    try {
      const finished = new Set(readItems(root, slug).filter(item => item.state === 'branch' && item.branch).map(item => item.branch));
      const found = await surveyProject({ repo: path ?? clone, trees: { look: lookTree, do: doTree }, previous: previous[slug], now, gh, grades, finished });
      projects[slug] = found.survey;
      settled.push(...settleItems(root, slug, found, now));
      filed.push(...fileShipWork(root, slug, found, now));
      adopted.push(...adoptStrayBranches(root, slug, found, now));
    } catch {
      // A repository that cannot be read today keeps what it said last time, and closes nothing.
      if (previous[slug]) projects[slug] = previous[slug];
    }
  }
  const survey = { at: new Date(now).toISOString(), projects };
  atomicJson(surveyPath(root), survey);
  return { ...survey, settled, filed, adopted, retired };
}
