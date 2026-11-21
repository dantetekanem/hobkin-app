import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';
import { atomicJson } from '../config.mjs';
import { readReviewGrades, reviewsFolder } from './grades.mjs';
import { areaOf, isTestPath } from './patterns.mjs';
import { readOnce } from './one-read.mjs';
import { modelsAt, sameCodeAs, specsAt } from './proofs.mjs';
import { BRANCH_PREFIX, changesOnlyDocs, defaultBranch, gitOrNothing, gitWithin, isMerged, realPlace } from './tree.mjs';
import { chosenProjects, fileItem, paths, readItems, readKeptJson, runnableStates, updateItem } from './store.mjs';

export const SHIP_KIND = 'pr-fix';
const SHORT_SHA = 7;
const MOST_PRS = 200;
const DAY_MS = 24 * 3600000;
// One survey runs at a time, so a `gh` that never answers would stop every survey after it until Hobkin restarts.
const GH_TIMEOUT_MS = 2 * 60000;
// The line hobkin's own commits start with, which says who made them and is never what the change is.
const ATTRIBUTION = /^\W*\[?\s*made by hobkin\b/i;

/** A commit's summary as a title: its first line that says something, past the attribution line, blank lines and markup. */
export function commitTitle(message) {
  for (const raw of String(message ?? '').split('\n')) {
    const line = raw.trim().replace(/^#+\s*/, '').replace(/^(\*\*|__)(.*)\1$/, '$2').trim();
    if (!line || ATTRIBUTION.test(line) || line.startsWith('<')) continue;
    return line;
  }
  return '';
}

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
// A copy a run saved before rewriting a branch: `-before-`, `-before-rebase-` or `-before-refresh-`, then an id, commit or date.
// Its work is on the branch it copies, or has landed from there, so a backup is no unit and gets no item or fix, and holding work says nothing about where that work went.
const BACKUP_BRANCH = /-before-(?:(?:rebase|refresh)-)?[0-9a-f]{6,40}$/;
// The survey's own items: one for a branch nothing named, and work to get a branch merged.
const SURVEY_KEY = /^(?:branch|ship):/;
const BACKUP_REASON = 'Its branch is only a backup of another branch, so there is no work of its own here.';

const PATCH_CHECK_TIMEOUT_MS = 60000;

const run = promisify(execFile);
export const ghWithin = timeout => async (args, cwd) => (await run('gh', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 })).stdout;
// A patch check that fails must say so, because an empty answer would read as a branch with nothing left to land.
const gitOrFail = gitWithin(PATCH_CHECK_TIMEOUT_MS);
const defaultGh = ghWithin(GH_TIMEOUT_MS);
const surveyPath = root => join(root, 'work', 'unmerged.json');

export const readUnmerged = root => readOnce(`unmerged:${root}`, () => readKeptJson(surveyPath(root), { at: null, projects: {} }));

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

/**
 * Hobkin's own branches, and any other branch a finished item names, such as one a session made, so that work is read and pinned to a commit like the rest.
 * Only names a real local branch came back with reach `git branch`, so nothing an item says can pass for an option.
 */
async function localBranches(repo, base, named = new Set()) {
  const itemBranches = [...named].filter(name => name !== base && !name.startsWith(BRANCH_PREFIX));
  const refs = await gitOrNothing(repo, 'for-each-ref', '--format=%(refname:short)%09%(committerdate:iso-strict)%09%(objectname)', `refs/heads/${BRANCH_PREFIX}`,
    ...itemBranches.map(name => `refs/heads/${name}`));
  const found = refs.split('\n').filter(Boolean).map(line => line.split('\t'))
    .filter(([name]) => name.startsWith(BRANCH_PREFIX) || itemBranches.includes(name));
  const others = found.map(([name]) => name).filter(name => !name.startsWith(BRANCH_PREFIX));
  const merged = new Set((await gitOrNothing(repo, 'branch', '--merged', base, '--format=%(refname:short)', '--list', `${BRANCH_PREFIX}*`, ...others)).split('\n'));
  return found.map(([name, at, sha]) => {
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

/**
 * The commits on `tip` that carry a branch's own commits as patches, newest first, when the tip already holds every one of them: as work landed
 * through another branch with the same change, a cherry-pick or a group merge leaves it. Empty when the tip holds the branch itself. Null while
 * even one commit is still only the branch's. A merge commit is never matched, so a branch holding one stays its own.
 */
async function samePatchesOn(repo, tip, sha) {
  const own = lines(await gitOrFail(repo, 'rev-list', '--right-only', '--cherry-mark', `${tip}...${sha}`));
  if (own.some(line => !line.startsWith('='))) return null;
  if (!own.length) return [];
  const theirs = lines(await gitOrFail(repo, 'rev-list', '--left-only', '--cherry-mark', `${tip}...${sha}`));
  return theirs.filter(line => line.startsWith('=')).map(line => line.slice(1));
}

// Each answer of `samePatchesOn` by branch, with the two commits it was asked at. It holds until one of them moves, so a survey asks git again only then.
const patchChecks = new Map();

async function landedByPatch(repo, tip, { name, sha }) {
  const key = `${repo}\0${name}`;
  const known = patchChecks.get(key);
  if (known?.tip === tip && known.sha === sha) return known.commits;
  // A check git could not finish answers nothing, and is asked again next time.
  const commits = await samePatchesOn(repo, tip, sha).catch(() => undefined);
  if (commits !== undefined) patchChecks.set(key, { tip, sha, commits });
  return commits ?? null;
}

/**
 * The branches an item waits on whose every commit has landed on the tip by patch, though not by ancestry, each with the commits that carry it.
 * Only those can close work, so no other branch costs a check, and one at a time, so many waiting branches never ask git for many checks at once.
 */
async function patchLandings({ repo, tip, branches, settling }) {
  const found = new Map();
  if (!tip) return found;
  for (const branch of branches.filter(({ name, merged }) => !merged && settling.has(name) && !BACKUP_BRANCH.test(name))) {
    const commits = await landedByPatch(repo, tip, branch);
    if (commits) found.set(branch.name, commits);
  }
  return found;
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

/**
 * A grade belongs to one commit, or to one whose code the head still has (`sameCode`). One from further back says so, and a rebase that changed
 * nothing keeps what it had. With no change to compare, nothing is kept.
 */
async function safetyOf({ repo, name, sha, change, grades, before, sameCode = [] }) {
  const { modified, ...exact } = [sha, ...sameCode].map(commit => grades.get(commit)).find(grade => grade?.grade) ?? {};
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

// A branch a finished item names is that item's work, read like a hobkin branch, so it is no place for other work to have landed.
async function usersBranches(repo, base, named = new Set()) {
  const newestFirst = lines(await gitOrNothing(repo, 'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'));
  const theirs = newestFirst.filter(name => name !== base && !notTheUsers.some(prefix => name.startsWith(prefix)) && !BACKUP_BRANCH.test(name) && !named.has(name));
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
  const touched = await pathsOf(repo, base, name);
  // The TLA+ models at its head that cover what it touches, whose runs at that head speak for it (`proofs.mjs`).
  const models = await modelsAt(repo, sha, touched.paths);
  // The commits whose code this head still has, since only models changed after them, so a review of one still counts.
  const sameCode = await sameCodeAs(repo, base, name);
  return {
    kind: 'branch',
    branch: name,
    sha,
    title: commitTitle(await gitOrNothing(repo, 'log', '-1', '--format=%B', name)),
    openedAt: new Date(at).toISOString(),
    size: await sizeOfRange(repo, base, name),
    ...touched,
    ...(models.length ? { models } : {}),
    ...(sameCode.length ? { sameCode } : {}),
    behind: await commitsBehind(repo, tip, name),
    // Not knowing is an answer, so nothing here can cost a project its survey.
    conflict: await conflictsWith(repo, tip, name).catch(() => null),
    onlyDocs: await changesOnlyDocs(repo, base, name),
    change,
    safety: await safetyOf({ repo, name, sha, change, grades, before, sameCode }),
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

/** Every tree in the project's trees folder that git still counts as one, whoever made it. */
async function treesHeld(repo, trees) {
  const inside = `worktree ${realPlace(trees)}${sep}`;
  const listed = (await gitOrNothing(repo, 'worktree', 'list', '--porcelain')).split('\n');
  return listed.filter(line => line.startsWith(inside)).length;
}

/** Read-only `git` and `gh`, and no model. A PR and its branch are one piece of work, and so is a worktree holding that branch. */
async function surveyProject({ repo, trees, previous = {}, now, gh, grades, finished, settling }) {
  // `gitOrNothing` hears a missing folder as an empty repository, which would pass for a project with nothing open.
  if (!await gitOrNothing(repo, 'rev-parse', '--git-dir')) throw Error(`Cannot read ${repo}.`);
  const base = await defaultBranch(repo);
  const tip = await landingTip(repo, base);
  const listed = await localBranches(repo, base, finished);
  // A branch whose change landed by another commit has landed as surely as one merged, so it is no open work either.
  const samePatch = await patchLandings({ repo, tip, branches: listed, settling });
  const branches = listed.map(branch => (samePatch.has(branch.name) ? { ...branch, merged: true } : branch));
  const pulls = await pullRequests(repo, gh) ?? [];
  // An item can name a PR on any head, but only a hobkin head is work to count.
  const ownPulls = pulls.filter(pr => pr.headRefName?.startsWith(BRANCH_PREFIX));
  // A closed PR leaves its branch as the record of the work, so only an open or merged one speaks for that branch.
  const withPull = new Set(ownPulls.filter(pr => pr.state !== 'CLOSED').map(pr => pr.headRefName));
  const bare = branches.filter(branch => !branch.merged && !withPull.has(branch.name) && !BACKUP_BRANCH.test(branch.name));
  const others = await usersBranches(repo, base, finished);
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
  // The TLA+ models on the default branch with the files each models, which its readiness and the weekly recheck read.
  const specs = (await specsAt(repo, tip)).map(({ spec, sha256, models }) => ({ spec, sha256, models }));
  return {
    survey: {
      open: [...openPulls, ...units],
      lastMergeAt: latest(merges),
      trees: await treesHeld(repo, trees),
      ...(specs.length ? { models: { head: tip, specs } } : {}),
    },
    pulls,
    held: new Set([...branches.filter(branch => branch.merged).map(branch => branch.name), ...landed]),
    tips: new Map(branches.map(branch => [branch.name, branch.sha])),
    samePatch,
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

/**
 * What carried a change that landed by patch (`samePatch`), for the issue it closes to name. The first of those commits that heads other work's
 * branch names that work, and the merge that work landed as. With none, it is the newest of those commits.
 */
function sameChangeOf(item, { samePatch, tips, before }, items) {
  const commits = samePatch?.get(item.branch);
  if (!commits?.length) return null;
  const heads = [...tips, ...before.map(unit => [unit.branch, unit.sha])].filter(([branch]) => branch !== item.branch);
  for (const commit of commits) {
    const other = heads.filter(([, sha]) => sha === commit).flatMap(([branch]) => makersOf({ branch }, items)).find(maker => maker.id !== item.id);
    if (other) return { sha: other.landed?.sha ?? commit, sameChange: { commit, item: other.id } };
  }
  return { sha: commits[0], sameChange: { commit: commits[0], item: null } };
}

/** A merge on the remote, so all hobkin can say of it is what its host and the last survey know. A fix on a branch is no change of its own. */
function landedElsewhere(item, pull, found, at, items) {
  if (item.kind === SHIP_KIND) return {};
  const { tips, before } = found;
  const branch = pull?.headRefName ?? item.branch;
  const unit = before.find(known => known.branch === branch);
  const same = pull?.state === 'MERGED' ? null : sameChangeOf(item, found, items);
  const landed = landedRecord(item, {
    sha: pull?.mergeCommit?.oid ?? same?.sha ?? tips.get(branch) ?? unit?.sha ?? null,
    ...(same ? { sameChange: same.sameChange } : {}),
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

/**
 * What every merge writes on each item it closes, whatever way it merged. The item is done, and the pass after a merge (`after-merge.mjs`) finds
 * it by this to tell once what its run left for the user and to close the GitHub issue it came from.
 */
export const AFTER_MERGE = { afterMerge: 'due' };

const mergedOutcome = (item, pull, found, at, items = []) => ({
  state: 'merged',
  mergedAt: pull?.mergedAt ?? at,
  ...AFTER_MERGE,
  ...landedElsewhere(item, pull, found, at, items),
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

function outcomeOf(item, found, at, items) {
  const { pulls, held } = found;
  const pull = pullOf(item, pulls);
  if (pull?.state === 'OPEN') return null;

  const landed = pull?.state === 'MERGED' || (branchProvesMerge(item) && held.has(item.branch));
  if (landed) return mergedOutcome(item, pull, found, at, items);

  // The user closes a PR to keep its work as a local branch for review, so this declines nothing: the branch stays the record.
  if (item.state !== 'pr' || !pull) return null;
  return { state: 'branch', pr: null, closedPr: pull.url, branch: item.branch ?? pull.headRefName };
}

// Read after the survey's waits, with none before the writes, so an item changed during a slow `gh` is judged as it stands now.
function settleItems(root, slug, found, now) {
  const at = new Date(now).toISOString();
  const items = readItems(root, slug);
  const closable = items.filter(item => closableStates.includes(item.state));
  return closable.flatMap(item => {
    const outcome = outcomeOf(item, found, at, items);
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
    const { clone, trees } = paths(root, slug);
    // A name alone says a branch is a backup, so this reads nothing from the repository. It goes first, so no item for a backup counts as finished work below.
    retired.push(...retireBackupWork(root, slug, now));
    try {
      const items = readItems(root, slug);
      const finished = new Set(items.filter(item => item.state === 'branch' && item.branch).map(item => item.branch));
      // The branches whose landing would close an item, which are the only ones checked for a change landed by another commit.
      const settling = new Set(items.filter(item => closableStates.includes(item.state) && branchProvesMerge(item) && item.branch).map(item => item.branch));
      const found = await surveyProject({ repo: path ?? clone, trees, previous: previous[slug], now, gh, grades, finished, settling });
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
