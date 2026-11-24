import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const BRANCH_PREFIX = 'hobkin/';
const GIT_TIMEOUT_MS = 300000;
// An install is not work and a secret must never reach a commit. A name alone would miss a link to an install, and `name/**` the files inside a folder.
const NEVER_KEPT = ['node_modules', '.env*'].flatMap(name => [`:(exclude,glob)**/${name}`, `:(exclude,glob)**/${name}/**`]);

const run = promisify(execFile);
// A remote that wants a password, or never answers, must not hold a run. Nobody is here to type one, so git fails instead of asking.
const runGit = async (timeout, cwd, args) => (await run('git', ['-C', cwd, ...args], {
  maxBuffer: 16 * 1024 * 1024,
  timeout,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
})).stdout;
export const gitWithin = timeout => async (cwd, ...args) => (await runGit(timeout, cwd, args)).trim();
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

const HOBKIN_IDENTITY = ['-c', 'user.name=Hobkin', '-c', 'user.email=hobkin@localhost'];
const OWN_COMMIT = [...HOBKIN_IDENTITY, 'commit', '--quiet', '--no-verify', '--no-gpg-sign'];

/**
 * A project's folder always has a repository of its own, whatever sits above it. A folder with a `.git` is left as it is. Otherwise git starts
 * one there with no remote, and one commit holds what the folder has, as Hobkin. If git fails, the `.git` made here goes too, so nothing stays.
 */
export async function startRepository(folder, name) {
  if (existsSync(join(folder, '.git'))) return false;
  try {
    await git(folder, 'init', '--quiet');
    await git(folder, 'add', '--all', '--', '.', ...NEVER_KEPT);
    await git(folder, ...OWN_COMMIT, '--allow-empty', '-m', `Start tracking ${name} with hobkin`);
  } catch (error) {
    rmSync(join(folder, '.git'), { recursive: true, force: true });
    throw Error(`hobkin could not start a git repository in ${folder}: ${firstLine(error)}`);
  }
  return true;
}

/** Every path that is changed or untracked in a project's own repository, one by one, with a rename's old path too. */
export async function changedPaths(folder) {
  const entries = (await runGit(GIT_TIMEOUT_MS, folder, ['status', '--porcelain', '-z', '--untracked-files=all'])).split('\0').filter(Boolean);
  const changed = [];
  while (entries.length) {
    const entry = entries.shift();
    changed.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) changed.push(entries.shift());
  }
  return changed;
}

/** One commit of exactly these paths, whatever else is staged, as Hobkin. It returns the commit, or nothing when the paths hold no change. */
export async function commitPaths(folder, paths, title, body) {
  if (!paths.length) return null;
  await git(folder, '--literal-pathspecs', 'add', '--all', '--', ...paths);
  const message = ['-m', title, ...(body ? ['-m', body] : [])];
  await git(folder, '--literal-pathspecs', ...OWN_COMMIT, ...message, '--only', '--', ...paths);
  return git(folder, 'rev-parse', 'HEAD');
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
  if (!current.startsWith(BRANCH_PREFIX) || !await git(tree, 'status', '--porcelain', '--untracked-files=all')) return;
  // The index starts empty because a run may have staged what is never kept. Files the project tracks are its own, whatever they are called.
  await git(tree, 'reset', '--quiet');
  await git(tree, 'add', '--update');
  await git(tree, 'add', '--all', '--', '.', ...NEVER_KEPT);
  if (await nothingStaged(tree)) return;
  await git(tree, 'switch', '--quiet', '-c', `${current}-kept-${keptStamp()}`);
  await git(tree, ...OWN_COMMIT, '-m', 'Work in progress kept by Hobkin');
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
export async function prepareTree(request) {
  if (resolve(request.tree) === resolve(request.repo)) throw Error('A tree is never the project\'s own folder.');
  return withRepository(request.repo, () => readiedTree(request));
}

async function readiedTree({ repo, tree, branch, resume = false }) {
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
  else if (await gitOrNothing(tree, 'status', '--porcelain', '--untracked-files=all')) return;
  if (await currentBranch(tree)) await gitOrNothing(tree, 'switch', '--quiet', '--detach');
}

/** Whether git already holds everything in a tree: nothing uncommitted or untracked, nothing stopped half way, and its commit on a branch, here or on a remote. */
async function nothingToLose(tree) {
  // Every untracked file counts, also where the project's own git config hides them from a plain status.
  if (await git(tree, 'status', '--porcelain', '--untracked-files=all')) return false;
  if (await inProgress(tree)) return false;
  const holder = await git(tree, 'for-each-ref', '--count=1', '--contains', 'HEAD', '--format=%(refname)', 'refs/heads', 'refs/remotes');
  return holder !== '';
}

/**
 * Takes a tree away for good once nothing in it could be lost. Ignored files, such as an install, go with it. Something to lose, a question git
 * cannot answer or a refusal from git, such as for a locked tree, leaves it exactly as it is. Only a linked worktree has a `.git` file, so the
 * project's own folder is never taken. Returns whether it went.
 */
export async function retireTree({ repo, tree }) {
  if (!statSync(join(tree, '.git'), { throwIfNoEntry: false })?.isFile()) return false;
  return withRepository(repo, () => retiredTree({ repo, tree }));
}

async function retiredTree({ repo, tree }) {
  try {
    if (!await nothingToLose(tree)) return false;
    await git(repo, 'worktree', 'remove', tree);
    return true;
  } catch {
    return false;
  }
}

export const currentBranch = repo => gitOrNothing(repo, 'branch', '--show-current');

/** Where a checkout keeps its git data: its `.git` folder, or for a worktree, the folder its `.git` file names. */
function gitFolder(repo) {
  const dotGit = join(repo, '.git');
  if (statSync(dotGit).isDirectory()) return dotGit;
  const named = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'));
  return resolve(repo, named[1].trim());
}

// A repository that keeps its refs in reftable leaves this placeholder in its HEAD file, and the real HEAD in the reftable.
const REFTABLE_PLACEHOLDER = '.invalid';

/**
 * The branch a checkout is on, read from the HEAD file git keeps, so a look every second starts no git. Empty on a detached HEAD, as during
 * a rebase, as `git branch --show-current` says. Only a HEAD file kept the way the files backend keeps it is read: a repository with a
 * reftable folder, the reftable placeholder, or anything else asks git.
 */
export async function headBranch(repo) {
  try {
    const folder = gitFolder(repo);
    if (existsSync(join(folder, 'reftable'))) return currentBranch(repo);
    const head = readFileSync(join(folder, 'HEAD'), 'utf8').trim();
    const branch = /^ref: refs\/heads\/(.+)$/.exec(head)?.[1];
    if (branch && branch !== REFTABLE_PLACEHOLDER) return branch;
    if (!branch && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head)) return '';
  } catch {
    // Not the top of a checkout, or not one git keeps this way: git itself answers.
  }
  return currentBranch(repo);
}

/** A folder by its real path, the way git names it, so two names for one folder compare as one. A folder that is gone keeps the name it was given. */
export function realPlace(folder) {
  try {
    return realpathSync(folder);
  } catch {
    return folder;
  }
}

const lines = new Map();

/**
 * Git steps on one repository take turns, so two runs of one project never fight over its locks. A line is held only for the git steps, never for a run.
 * Two names for one folder are one line, and a step that throws lets the next go on.
 */
export function withRepository(repo, step) {
  const key = realPlace(repo);
  const turn = (lines.get(key) ?? Promise.resolve()).then(step);
  const tail = turn.catch(() => {}).finally(() => { if (lines.get(key) === tail) lines.delete(key); });
  lines.set(key, tail);
  return turn;
}

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
  return await git(repo, 'status', '--porcelain', '--untracked-files=all') ? 'it has uncommitted changes' : null;
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

/** A branch of markdown alone changes no behaviour, so no review could grade it. */
export async function changesOnlyDocs(repo, base, branch) {
  const files = (await gitOrNothing(repo, 'diff', '--name-only', `${base}...${branch}`)).split('\n').filter(Boolean);
  return files.length > 0 && files.every(file => /\.md$/i.test(file));
}

/** Whether the default branch already holds `sha`, for a branch that is gone. */
export const isMerged = (repo, sha, base) => git(repo, 'merge-base', '--is-ancestor', sha, base).then(() => true, () => false);

/** The folder that has a branch checked out, the project's own or a linked worktree, as git names it, or null when none has. */
export async function worktreeOn(repo, base) {
  const records = (await git(repo, 'worktree', 'list', '--porcelain')).split('\n\n');
  const holder = records.find(record => record.split('\n').includes(`branch refs/heads/${base}`));
  return holder?.split('\n')[0].replace(/^worktree /, '') ?? null;
}

async function mergeCommit({ repo, tip, head, message }) {
  const tree = await git(repo, 'merge-tree', '--write-tree', tip, head).catch(error => {
    if (error.code === 1) throw Error('conflict');
    throw error;
  });
  return git(repo, 'commit-tree', tree.split('\n')[0], '-p', tip, '-p', head, '-m', message);
}

/**
 * Lands a branch on the default branch, on the user's word. It works the merge out away from any folder, because the folder may be busy, then
 * moves the default branch forward only. A folder holding that branch moves with it by fast-forward, so git refuses rather than touch uncommitted work.
 * `tip` is where the default branch really stands, and nothing here pushes.
 */
export async function landBranch({ repo, base, branch, tip, message }) {
  const head = await git(repo, 'rev-parse', '--verify', `refs/heads/${branch}`);
  const target = await isMerged(repo, tip, head) ? head : await mergeCommit({ repo, tip, head, message });
  const holder = await worktreeOn(repo, base);
  if (holder) await git(holder, 'merge', '--quiet', '--ff-only', '--no-overwrite-ignore', target);
  else await git(repo, 'update-ref', `refs/heads/${base}`, target);
  return target;
}

/** Files the default branch tracks and this branch does not, sitting in the folder. Only ignored ones get past a clean status. */
async function inTheWayOf(repo, base) {
  const added = await git(repo, 'diff', '--name-only', '-z', '--diff-filter=A', 'HEAD', base);
  return added.split('\0').filter(path => path && existsSync(join(repo, path)));
}

const sameAs = async (repo, base, path) => await git(repo, 'hash-object', '--', path) === await gitOrNothing(repo, 'rev-parse', `${base}:${path}`);

/**
 * Puts the folder back on its default branch, unless someone has changed it since. A file the run stopped tracking, such as a secret,
 * stays in the folder ignored, and git will not write the default branch's copy over it. One that is the same as that copy loses
 * nothing, so it does not hold the folder back. Returns where the user `moved` it, why it `stays` on the run's branch, or nothing.
 */
export async function leaveFolder({ repo, branch, base }) {
  const current = await currentBranch(repo);
  if (current !== branch) return { moved: current || 'no branch' };
  if (await git(repo, 'status', '--porcelain', '--untracked-files=all')) return { stays: 'it has uncommitted changes' };

  const inTheWay = await inTheWayOf(repo, base);
  const changed = [];
  for (const path of inTheWay) {
    if (!await sameAs(repo, base, path)) changed.push(path);
  }
  if (changed.length) {
    const which = changed.length === 1 ? `${changed[0]}, which is not the same as ${base}'s copy` : `${changed.join(', ')}, which are not the same as ${base}'s copies`;
    return { stays: `going back to ${base} would replace ${which}` };
  }
  try {
    await git(repo, 'switch', '--quiet', ...(inTheWay.length ? ['--overwrite-ignore'] : ['--no-overwrite-ignore']), base);
    return null;
  } catch (error) {
    // Git checks a branch out in one place at a time, so another copy holding the default branch keeps this folder where it is.
    const elsewhere = /already used by worktree at '(.+)'/.exec(error.stderr ?? '')?.[1];
    return { stays: elsewhere ? `${base} is checked out in another copy of it, at ${elsewhere}` : `git would not switch it back to ${base}` };
  }
}
