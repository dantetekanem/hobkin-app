import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const git = async (cwd, ...args) => (await run('git', ['-C', cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
export const gitOrNothing = (cwd, ...args) => git(cwd, ...args).catch(() => '');
const firstLine = error => String(error.stderr || error.message || error).trim().split('\n', 1)[0];
const inProgressMarks = ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG'];

async function baseRef(repo) {
  const hasOrigin = (await git(repo, 'remote')).split('\n').includes('origin');
  if (hasOrigin) {
    await git(repo, '-c', 'gc.auto=0', 'fetch', '--quiet', 'origin');
    const head = await gitOrNothing(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
    if (head) return head;
  }
  const candidates = hasOrigin ? ['origin/main', 'origin/master'] : ['main', 'master'];
  for (const candidate of candidates) {
    if (await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', candidate)) return candidate;
  }
  return git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
}

/**
 * Readies a linked worktree of the user's repository without touching their checkout.
 * With `branch`, the tree moves to it from the latest default branch; without one it sits detached there.
 * `resume` keeps a branch and its uncommitted work, for an item that was interrupted.
 * The resets here throw away whatever is in `tree`, so it is never the project's own folder. That has its own path below.
 */
export async function prepareTree({ repo, tree, branch, resume = false }) {
  if (resolve(tree) === resolve(repo)) throw Error('A tree is never the project\'s own folder.');
  const base = await baseRef(repo);
  if (!existsSync(join(tree, '.git'))) {
    mkdirSync(dirname(tree), { recursive: true, mode: 0o700 });
    await git(repo, 'worktree', 'prune');
    await git(repo, 'worktree', 'add', '--quiet', '--detach', tree, base);
  }
  if (resume && branch && await gitOrNothing(tree, 'branch', '--show-current') === branch) return { base };

  await git(tree, 'reset', '--quiet', '--hard');
  await git(tree, 'clean', '-fdq');
  const kept = resume && branch && await gitOrNothing(tree, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (kept) await git(tree, 'switch', '--quiet', branch);
  else if (branch) await git(tree, 'switch', '--quiet', '-C', branch, base);
  else await git(tree, 'switch', '--quiet', '--detach', base);
  return { base };
}

/** Takes a tree back out of the user's repository, so it keeps no entry for a folder that is gone. */
export async function removeTree({ repo, tree }) {
  await gitOrNothing(repo, 'worktree', 'remove', '--force', tree);
  await gitOrNothing(repo, 'worktree', 'prune');
}

/** A run cannot start here, and a worktree would not help: the reason goes to the user, and nothing has changed. */
export class FolderRefused extends Error {}

export const currentBranch = repo => gitOrNothing(repo, 'branch', '--show-current');

/** The branch everything starts from, read from what is already here, with no network. */
export async function defaultBranch(repo) {
  const head = await gitOrNothing(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  if (head) return head.replace(/^origin\//, '');
  for (const candidate of ['main', 'master']) {
    if (await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`)) return candidate;
  }
  return currentBranch(repo);
}

async function inProgress(repo) {
  const found = await Promise.all(inProgressMarks.map(async mark => existsSync(resolve(repo, await git(repo, 'rev-parse', '--git-path', mark)))));
  return found.some(Boolean);
}

/**
 * Why a run may not work in the project's own folder, or nothing when it may. It is asked as the run starts, because the
 * user may be in that folder at any moment. A folder already on the run's branch is one an earlier run was stopped in.
 */
export async function folderRefusal(repo, { branch } = {}) {
  const current = await currentBranch(repo);
  if (branch && current === branch) return null;
  if (!current) return 'it is not on a branch';
  const base = await defaultBranch(repo);
  if (current !== base) return `it is on ${current}`;
  if (await inProgress(repo)) return 'a merge or rebase is in progress';
  return await git(repo, 'status', '--porcelain') ? 'it has uncommitted changes' : null;
}

/** Fast-forward only, so the default branch stays the source of truth. Returns whether it holds commits origin has not seen. */
async function fastForward(repo, base) {
  if (!(await git(repo, 'remote')).split('\n').includes('origin')) return false;
  try {
    await git(repo, '-c', 'gc.auto=0', 'fetch', '--quiet', 'origin');
  } catch (error) {
    throw new FolderRefused(`Could not fetch ${base}: ${firstLine(error)}`);
  }
  const upstream = `origin/${base}`;
  if (!await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', upstream)) return false;

  const [ahead, behind] = (await git(repo, 'rev-list', '--left-right', '--count', `${base}...${upstream}`)).split(/\s+/).map(Number);
  if (ahead && behind) throw new FolderRefused(`${base} has diverged from origin, so nothing started. Only the user can settle that.`);
  if (behind) {
    try {
      await git(repo, 'merge', '--quiet', '--ff-only', '--no-overwrite-ignore', upstream);
    } catch (error) {
      throw new FolderRefused(`Could not fast-forward ${base}: ${firstLine(error)}`);
    }
  }
  return ahead > 0;
}

/**
 * Takes the project's own folder for a run: up to date by fast-forward, then on the run's branch, or on the default branch for
 * a look. It holds no reset, clean or force, so nothing here can lose a change. `refused` says why a worktree is needed instead.
 */
export async function enterFolder({ repo, branch }) {
  const refused = await folderRefusal(repo, { branch });
  if (refused) return { refused };
  const base = await defaultBranch(repo);
  if (branch && await currentBranch(repo) === branch) return { base };

  if (await fastForward(repo, base)) return { refused: `${base} has commits not pushed` };
  if (!branch) return { base };
  const exists = await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  try {
    await git(repo, 'switch', '--quiet', '--no-overwrite-ignore', ...(exists ? [branch] : ['-c', branch]));
  } catch (error) {
    return { refused: firstLine(error) };
  }
  return { base };
}

/** Whether the default branch already holds `sha`, for a branch that is gone. */
export const isMerged = (repo, sha, base) => git(repo, 'merge-base', '--is-ancestor', sha, base).then(() => true, () => false);

/** Puts the folder back on its default branch, unless someone has changed it since. Returns what the user should know, or nothing. */
export async function leaveFolder({ repo, branch, base }) {
  const current = await currentBranch(repo);
  if (current !== branch) return `It is on ${current || 'no branch'} now, so Hobkin left it there.`;
  if (await git(repo, 'status', '--porcelain')) return `It stays on ${branch}, because it has uncommitted changes.`;
  try {
    await git(repo, 'switch', '--quiet', '--no-overwrite-ignore', base);
    return null;
  } catch (error) {
    return `It stays on ${branch}: ${firstLine(error)}`;
  }
}
