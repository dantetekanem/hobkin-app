import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { atomicJson } from '../config.mjs';
import { BRANCH_PREFIX, defaultBranch, gitOrNothing, isMerged } from './tree.mjs';
import { chosenProjects, fileItem, paths, readItems, readJson, runnableStates, updateItem } from './store.mjs';

const SHIP_KIND = 'pr-fix';
const SHORT_SHA = 7;
const MOST_PRS = 200;
const DAY_MS = 24 * 3600000;
// One survey runs at a time, so a `gh` that never answers would stop every survey after it until Hobkin restarts.
const GH_TIMEOUT_MS = 2 * 60000;
const PR_FIELDS = 'number,title,url,state,isDraft,createdAt,mergedAt,additions,deletions,changedFiles,reviewDecision,statusCheckRollup,mergeable,headRefName';
// A branch proves a merge only for these: a new branch with no commits also counts as merged into the default branch.
const finishedOnBranch = ['pr', 'branch'];
const closableStates = [...finishedOnBranch, ...runnableStates];
const conflictOf = { CONFLICTING: true, MERGEABLE: false };

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

function ciState(checks = []) {
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
async function landingTip(repo, base) {
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

const branchUnit = async (repo, base, tip, { name, at, sha }) => ({
  kind: 'branch',
  branch: name,
  sha,
  openedAt: new Date(at).toISOString(),
  size: sizeOf(await gitOrNothing(repo, 'diff', '--shortstat', `${base}...${name}`)),
  behind: await commitsBehind(repo, tip, name),
  // Not knowing is an answer, so nothing here can cost a project its survey.
  conflict: await conflictsWith(repo, tip, name).catch(() => null),
});

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
async function surveyProject({ repo, trees, previous = {}, now, gh }) {
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
  const bare = branches.filter(branch => !branch.merged && !withPull.has(branch.name));
  const units = await Promise.all(bare.map(branch => branchUnit(repo, base, tip, branch)));
  const landed = await mergedHere({ repo, base, units, previous });
  // Git keeps no date for a local merge, so one seen now is dated now.
  const merges = [previous.lastMergeAt, landed.length ? new Date(now).toISOString() : null, ...ownPulls.map(pr => pr.mergedAt)];
  return {
    survey: {
      open: [...ownPulls.filter(pr => pr.state === 'OPEN').map(pullUnit), ...units],
      lastMergeAt: latest(merges),
      trees: await treesHeld(repo, trees),
    },
    pulls,
    held: new Set([...branches.filter(branch => branch.merged).map(branch => branch.name), ...landed]),
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

function outcomeOf(item, { pulls, held }, at) {
  const pull = pullOf(item, pulls);
  if (pull?.state === 'OPEN') return null;

  const landed = pull?.state === 'MERGED' || (branchProvesMerge(item) && held.has(item.branch));
  if (landed) return { state: 'merged', mergedAt: pull?.mergedAt ?? at };

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

/**
 * Only projects still being worked on count. Work that has landed closes its item here, and `settled` names them. Work that cannot merge gets an item, and `filed`
 * names those. This writes only Hobkin's own records, and it never writes to a repository.
 */
export async function surveyUnmerged(root, { now = Date.now(), gh = defaultGh } = {}) {
  const previous = readUnmerged(root).projects;
  const projects = {};
  const settled = [];
  const filed = [];
  for (const { slug, path } of chosenProjects(root)) {
    const { clone, lookTree, doTree } = paths(root, slug);
    try {
      const found = await surveyProject({ repo: path ?? clone, trees: { look: lookTree, do: doTree }, previous: previous[slug], now, gh });
      projects[slug] = found.survey;
      settled.push(...settleItems(root, slug, found, now));
      filed.push(...fileShipWork(root, slug, found, now));
    } catch {
      // A repository that cannot be read today keeps what it said last time, and closes nothing.
      if (previous[slug]) projects[slug] = previous[slug];
    }
  }
  const survey = { at: new Date(now).toISOString(), projects };
  atomicJson(surveyPath(root), survey);
  return { ...survey, settled, filed };
}
