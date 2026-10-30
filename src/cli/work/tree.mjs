import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const git = async (cwd, ...args) => (await run('git', ['-C', cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
const gitOrNothing = (cwd, ...args) => git(cwd, ...args).catch(() => '');

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
 */
export async function prepareTree({ repo, tree, branch, resume = false }) {
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
