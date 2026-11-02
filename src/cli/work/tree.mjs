import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const BRANCH_PREFIX = 'hobkin/';
const GIT_TIMEOUT_MS = 300000;
// An install is not work and a secret must never reach a commit. A name alone would miss a link to an install, and `name/**` the files inside a folder.
const NEVER_KEPT = ['node_modules', '.env*'].flatMap(name => [`:(exclude,glob)**/${name}`, `:(exclude,glob)**/${name}/**`]);

const run = promisify(execFile);
// A remote that wants a password, or never answers, must not hold a run. Nobody is here to type one, so git fails instead of asking.
export const gitWithin = timeout => async (cwd, ...args) => (await run('git', ['-C', cwd, ...args], {
  maxBuffer: 16 * 1024 * 1024,
  timeout,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
})).stdout.trim();
const git = gitWithin(GIT_TIMEOUT_MS);
export const gitOrNothing = (cwd, ...args) => git(cwd, ...args).catch(() => '');
const firstLine = error => String(error.stderr || error.message || error).trim().split('\n', 1)[0];
const heldElsewhere = error => /already (used by worktree|checked out)/.test(error.stderr || error.message);
const inProgressMarks = ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG'];

async function baseRef(repo) {
  const hasOrigin = (await git(repo, 'remote')).split('\n').includes('origin');
  if (hasOrigin) {
    // Losing the network is no reason to stop a run: what was last fetched is already here.
    await gitOrNothing(repo, '-c', 'gc.auto=0', 'fetch', '--quiet', 'origin');
    const head = await gitOrNothing(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
    if (head) return head;
  }
  const candidates = hasOrigin ? ['origin/main', 'origin/master'] : ['main', 'master'];
  for (const candidate of candidates) {
    if (await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', candidate)) return candidate;
  }
  return git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
}

const nothingStaged = tree => git(tree, 'diff', '--cached', '--quiet').then(() => true, () => false);
const keptStamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

/**
 * What an earlier run left uncommitted goes on a side branch of its own, because the reset that follows would take it, and the run's
 * own branch may be a finished local PR. The side branch is Hobkin's, so no hook, signing key or missing identity of the project's
 * gets a say. Any other branch is not ours to branch from. With nothing worth keeping there is no branch and no commit.
 */
async function keepWork(tree) {
  // A tree stopped in one of these refuses to switch, and nothing could ever start here again. Any conflict markers go with it, so none is committed.
  for (const stopped of ['rebase', 'merge', 'cherry-pick', 'revert']) await gitOrNothing(tree, stopped, '--abort');
  const current = await currentBranch(tree);
  if (!current.startsWith(BRANCH_PREFIX) || !await git(tree, 'status', '--porcelain')) return;
  // The index starts empty because a run may have staged what is never kept. Files the project tracks are its own, whatever they are called.
  await git(tree, 'reset', '--quiet');
  await git(tree, 'add', '--update');
  await git(tree, 'add', '--all', '--', '.', ...NEVER_KEPT);
  if (await nothingStaged(tree)) return;
  await git(tree, 'switch', '--quiet', '-c', `${current}-kept-${keptStamp()}`);
  await git(tree, '-c', 'user.name=Hobkin', '-c', 'user.email=hobkin@localhost', 'commit', '--quiet', '--no-verify', '--no-gpg-sign', '-m', 'Work in progress kept by Hobkin');
}

async function readyTree({ repo, tree, branch, resume, base }) {
  // A worktree deleted by hand holds its branch until git is told, and nothing else here would tell it now that a healthy tree stays where it is.
  await gitOrNothing(repo, 'worktree', 'prune');
  if (!existsSync(join(tree, '.git'))) {
    mkdirSync(dirname(tree), { recursive: true, mode: 0o700 });
    await git(repo, 'worktree', 'add', '--quiet', '--detach', tree, base);
  }
  if (resume && branch && await currentBranch(tree) === branch) return;

  await keepWork(tree);
  await git(tree, 'reset', '--quiet', '--hard');
  await git(tree, 'clean', '-fdq');
  const kept = resume && branch && await gitOrNothing(tree, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (kept) await git(tree, 'switch', '--quiet', branch);
  else if (branch) await git(tree, 'switch', '--quiet', '-C', branch, base);
  else await git(tree, 'switch', '--quiet', '--detach', base);
}

/**
 * Readies a linked worktree of the user's repository without touching their checkout.
 * With `branch`, the tree moves to it from the latest default branch it can reach; without one it sits detached there.
 * `resume` keeps a branch and its uncommitted work, for an item that was interrupted.
 * The resets here throw away whatever is in `tree`, so it is never the project's own folder. That has its own path below.
 * A tree that cannot be readied would fail the same way every time, so it moves aside for a new one. A failure of that new one is
 * not caught: the run fails and its item goes back in the queue. So does a branch checked out somewhere else, because no new tree could take it either.
 */
export async function prepareTree({ repo, tree, branch, resume = false }) {
  if (resolve(tree) === resolve(repo)) throw Error('A tree is never the project\'s own folder.');
  const base = await baseRef(repo);
  const ready = () => readyTree({ repo, tree, branch, resume, base });
  if (existsSync(tree)) {
    try {
      await ready();
      return { base };
    } catch (error) {
      if (heldElsewhere(error)) throw error;
      // It may hold work, so it is never deleted. Git drops its entry as the new tree is made, and any lock left in there goes with it.
      renameSync(tree, `${tree}-moved-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    }
  }
  // A tree made here holds nothing yet. Left behind by a failure, it would be moved aside by every attempt that comes round after this one.
  await ready().catch(async error => {
    await removeTree({ repo, tree });
    throw error;
  });
  return { base };
}

/** Takes a tree back out of the user's repository, so it keeps no entry for a folder that is gone. */
async function removeTree({ repo, tree }) {
  await gitOrNothing(repo, 'worktree', 'remove', '--force', tree);
  await gitOrNothing(repo, 'worktree', 'prune');
}

/**
 * Lets go of the branch a run leaves here, because git refuses to switch to or delete a branch another worktree holds, and that stops
 * the user reviewing a local PR. A `finished` run recorded its outcome, so what it left uncommitted goes on a side branch. Any other run
 * keeps uncommitted work where it is, on its branch, for the next run to resume. Only a linked worktree has a `.git` file, so the
 * project's own folder is never touched.
 */
export async function releaseTree(tree, { finished = false } = {}) {
  if (!statSync(join(tree, '.git'), { throwIfNoEntry: false })?.isFile()) return;
  if (finished) await keepWork(tree);
  else if (await gitOrNothing(tree, 'status', '--porcelain')) return;
  if (await currentBranch(tree)) await gitOrNothing(tree, 'switch', '--quiet', '--detach');
}

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

/** Fast-forward only, so the default branch stays the source of truth. Returns why the folder cannot be used, or nothing. */
async function fastForward(repo, base) {
  if (!(await git(repo, 'remote')).split('\n').includes('origin')) return null;
  const fetched = await git(repo, '-c', 'gc.auto=0', 'fetch', '--quiet', 'origin').then(() => true, () => false);
  if (!fetched) return `could not fetch ${base}`;
  const upstream = `origin/${base}`;
  if (!await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', upstream)) return null;

  const [ahead, behind] = (await git(repo, 'rev-list', '--left-right', '--count', `${base}...${upstream}`)).split(/\s+/).map(Number);
  if (ahead && behind) return `${base} has diverged from origin`;
  if (ahead) return `${base} has commits not pushed`;
  if (!behind) return null;
  const moved = await git(repo, 'merge', '--quiet', '--ff-only', '--no-overwrite-ignore', upstream).then(() => true, () => false);
  return moved ? null : `could not fast-forward ${base}`;
}

/**
 * Takes the project's own folder for a run: up to date by fast-forward, then on the run's branch, or on the default branch for
 * a look. It holds no reset, clean or force, so nothing here can lose a change. `refused` says why a worktree is needed instead,
 * and anything git cannot do here is such a reason: a folder that cannot be used never stops a run.
 */
export async function enterFolder({ repo, branch }) {
  try {
    const refused = await folderRefusal(repo, { branch });
    if (refused) return { refused };
    const base = await defaultBranch(repo);
    if (branch && await currentBranch(repo) === branch) return { base };

    const outOfStep = await fastForward(repo, base);
    if (outOfStep) return { refused: outOfStep };
    if (!branch) return { base };
    const exists = await gitOrNothing(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
    await git(repo, 'switch', '--quiet', '--no-overwrite-ignore', ...(exists ? [branch] : ['-c', branch]));
    return { base };
  } catch (error) {
    return { refused: firstLine(error) };
  }
}

/** Whether the default branch already holds `sha`, for a branch that is gone. */
export const isMerged = (repo, sha, base) => git(repo, 'merge-base', '--is-ancestor', sha, base).then(() => true, () => false);

/** Puts the folder back on its default branch, unless someone has changed it since. Returns what the user should know, or nothing. */
export async function leaveFolder({ repo, branch, base }) {
  const current = await currentBranch(repo);
  if (current !== branch) return `It is on ${current || 'no branch'} now, so hobkin left it there.`;
  if (await git(repo, 'status', '--porcelain')) return `It stays on ${branch}, because it has uncommitted changes.`;
  try {
    await git(repo, 'switch', '--quiet', '--no-overwrite-ignore', base);
    return null;
  } catch (error) {
    return `It stays on ${branch}: ${firstLine(error)}`;
  }
}
