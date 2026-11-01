import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { atomicJson } from '../config.mjs';
import { defaultBranch, gitOrNothing, isMerged } from './tree.mjs';
import { paths, readJson, readProjects } from './store.mjs';

const BRANCH_PREFIX = 'hobkin/';
const MOST_PRS = 200;
// One project may hold a fifth of the total, so it takes five full projects to reach the limit and none can fill it alone.
const PROJECT_SHARE = 5;
const FEWEST_PER_PROJECT = 2;
const PR_FIELDS = 'number,title,url,state,isDraft,createdAt,mergedAt,additions,deletions,changedFiles,reviewDecision,statusCheckRollup,headRefName';

const run = promisify(execFile);
const defaultGh = async (args, cwd) => (await run('gh', args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout;
const surveyPath = root => join(root, 'work', 'unmerged.json');

export const readUnmerged = root => readJson(surveyPath(root), { at: null, projects: {} });
export const projectLimit = limit => Math.max(FEWEST_PER_PROJECT, Math.ceil(limit / PROJECT_SHARE));

const latest = times => times.filter(Boolean).toSorted().at(-1) ?? null;
const openedSince = (units, since) => units.filter(unit => !since || unit.openedAt > since);

/** Where the work stands. A merge starts a new stretch, and so does the user saying keep going, so only what is newer counts. */
export function unmergedNow(root, mode) {
  const { at, projects } = readUnmerged(root);
  const entries = Object.entries(projects);
  const since = latest([...entries.map(([, project]) => project.lastMergeAt), mode.keptGoingAt]);
  const stretch = openedSince(entries.flatMap(([, project]) => project.open), since).length;
  const perProject = Object.fromEntries(entries.map(([slug, project]) => [slug, openedSince(project.open, latest([project.lastMergeAt, mode.keptGoingAt])).length]));
  const each = projectLimit(mode.unmergedLimit);
  return {
    at,
    since,
    stretch,
    open: entries.reduce((sum, [, project]) => sum + project.open.length, 0),
    limit: mode.unmergedLimit,
    each,
    perProject,
    full: entries.flatMap(([slug]) => (perProject[slug] >= each ? [slug] : [])),
    stalled: stretch >= mode.unmergedLimit,
  };
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
});

/** A repository with no remote, or a `gh` that is missing or signed out, simply has no PRs to count: its branches still do. */
async function pullRequests(repo, gh) {
  try {
    const list = JSON.parse(await gh(['pr', 'list', '--state', 'all', '--limit', String(MOST_PRS), '--json', PR_FIELDS], repo));
    return list.filter(pr => pr.headRefName?.startsWith(BRANCH_PREFIX));
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
    return { name, at, sha, merged: merged.has(name) };
  });
}

/** Read-only `git` and `gh`, and no model. A PR and its branch are one piece of work, and so is a worktree holding that branch. */
async function surveyProject({ repo, trees, previous = {}, now, gh }) {
  const base = await defaultBranch(repo);
  const branches = await localBranches(repo, base);
  const pulls = await pullRequests(repo, gh);
  const withPull = new Set((pulls ?? []).map(pr => pr.headRefName));
  const bare = branches.filter(branch => !branch.merged && !withPull.has(branch.name));
  const units = await Promise.all(bare.map(async ({ name, at, sha }) => ({
    kind: 'branch',
    branch: name,
    sha,
    openedAt: new Date(at).toISOString(),
    size: sizeOf(await gitOrNothing(repo, 'diff', '--shortstat', `${base}...${name}`)),
  })));
  const open = [...(pulls ?? []).filter(pr => pr.state === 'OPEN').map(pullUnit), ...units];

  // Git keeps no date for a local merge, so one seen happening here is dated now.
  const wasOpen = (previous.open ?? []).filter(unit => unit.kind === 'branch' && !units.some(({ branch }) => branch === unit.branch));
  const landed = await Promise.all(wasOpen.map(unit => isMerged(repo, unit.sha, base)));
  const mergedHere = landed.some(Boolean) ? new Date(now).toISOString() : null;
  const worktrees = (await gitOrNothing(repo, 'worktree', 'list', '--porcelain')).split('\n').filter(line => line === `worktree ${trees.look}` || line === `worktree ${trees.do}`);
  const pulledAt = (pulls ?? []).map(pr => pr.mergedAt);
  return { open, lastMergeAt: latest([previous.lastMergeAt, mergedHere, ...pulledAt]), trees: worktrees.length };
}

/** Only projects still being worked on count, so a dropped one's open PRs cannot stop the others. */
export async function surveyUnmerged(root, { now = Date.now(), gh = defaultGh } = {}) {
  const previous = readUnmerged(root).projects;
  const projects = {};
  for (const { slug, path } of readProjects(root).filter(project => project.state === 'chosen')) {
    const { clone, lookTree, doTree } = paths(root, slug);
    try {
      projects[slug] = await surveyProject({ repo: path ?? clone, trees: { look: lookTree, do: doTree }, previous: previous[slug], now, gh });
    } catch {
      // A repository that cannot be read today keeps what it said last time.
      if (previous[slug]) projects[slug] = previous[slug];
    }
  }
  const survey = { at: new Date(now).toISOString(), projects };
  atomicJson(surveyPath(root), survey);
  return survey;
}
