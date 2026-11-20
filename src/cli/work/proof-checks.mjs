import { spawn as spawnProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths, readProject } from './store.mjs';
import { gitOrNothing, gitWithin } from './tree.mjs';

/**
 * TLA+ checks hobkin starts itself (_specs/050-tla-proofs): a model at a change's new head when only the code it models changed. Each is
 * `hobkin proof check`, run as hobkin's own job, never an agent's, in a tree of hobkin's own at that commit. That process writes the run, and
 * `proofs.mjs` reads it.
 */

// A check stops itself after 20 minutes, so one older than this is over whatever its process id now names.
const CHECK_LASTS_MS = 25 * 60000;
// As often as the state machines look (`plan.mjs`): a check hobkin tried is not tried again for a week.
const CHECK_EVERY_MS = 7 * 24 * 3600000;
const GIT_TIMEOUT_MS = 120000;

const git = gitWithin(GIT_TIMEOUT_MS);
const mainScript = fileURLToPath(new URL('../main.mjs', import.meta.url));
const checksPath = root => join(root, 'work', 'proof-checks.jsonl');

function readChecks(root) {
  if (!existsSync(checksPath(root))) return [];
  return readFileSync(checksPath(root), 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const sameCheck = (first, second) => ['slug', 'item', 'spec', 'head'].every(key => (first[key] ?? null) === (second[key] ?? null));

/** hobkin's own tree for checks, detached at `head`. Nothing else works in it, so what a check left there goes. */
async function treeAt(root, slug, head) {
  const project = readProject(root, slug);
  const repo = project?.path ?? paths(root, slug).clone;
  const tree = join(paths(root, slug).trees, 'proof');
  await gitOrNothing(repo, 'worktree', 'prune');
  if (!existsSync(join(tree, '.git'))) {
    mkdirSync(paths(root, slug).trees, { recursive: true, mode: 0o700 });
    await git(repo, 'worktree', 'add', '--quiet', '--detach', tree, head);
    return tree;
  }
  await git(tree, 'reset', '--quiet', '--hard');
  await git(tree, 'clean', '-fdq');
  await git(tree, 'switch', '--quiet', '--detach', head);
  return tree;
}

/**
 * Starts `hobkin proof check` on one spec at one commit, as hobkin's own job, in a tree at that commit. One goes at a time, and a check tried in
 * the last week is not tried again, so a check that cannot run costs one try. It answers what it started, or null.
 */
export async function startCheck(root, check, { now = Date.now(), spawn = spawnProcess } = {}) {
  const tried = readChecks(root);
  if (tried.some(({ at, pid }) => now - Date.parse(at) < CHECK_LASTS_MS && alive(pid))) return null;
  if (tried.some(earlier => sameCheck(earlier, check) && now - Date.parse(earlier.at) < CHECK_EVERY_MS)) return null;

  const { slug, item = null, spec, head } = check;
  const started = { at: new Date(now).toISOString(), slug, item, spec, head, pid: null };
  try {
    const tree = await treeAt(root, slug, head);
    const args = [mainScript, 'proof', 'check', spec, '--project', slug, ...(item ? ['--item', item] : []), '--head', head, '--home', root];
    const child = spawn(process.execPath, args, { cwd: tree, detached: true, stdio: 'ignore' });
    child.on?.('error', () => {});
    child.unref?.();
    started.pid = child.pid ?? null;
  } catch (error) {
    // A tree git cannot make today would fail the same way on every pass, so this try counts too.
    started.error = String(error.message ?? error).split('\n', 1)[0];
  }
  mkdirSync(join(root, 'work'), { recursive: true, mode: 0o700 });
  appendFileSync(checksPath(root), `${JSON.stringify(started)}\n`, { mode: 0o600 });
  return started.error ? null : started;
}
