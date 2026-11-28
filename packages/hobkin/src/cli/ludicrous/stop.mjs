import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { queueOf } from './areas.mjs';

/**
 * What Stop leaves (076, Stop, compile, resume): every agent is killed at once, so the shared folder holds their unfinished edits. Each
 * killed packet's edits are saved as `unfinished/<packet>.patch` in the run's folder, checked to apply on the branch head, and taken out of
 * the folder, and so is anything else no commit holds, as `unfinished/rest.patch`. The branch then holds only verified commits, and Go
 * Ludicrous gives each patch back to its packet.
 */

const exec = promisify(execFile);
const git = async (folder, args, env = {}) => (await exec('git', ['-C', folder, ...args], {
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }, maxBuffer: 256 * 1024 * 1024,
})).stdout;
const literal = path => `:(literal)${path}`;

// `git add` refuses every path when one is neither in the folder nor at the head, such as a trail nobody wrote yet.
async function present(folder, head, paths) {
  const kept = [];
  for (const path of paths) {
    if (path === '.' || existsSync(join(folder, path)) || (await git(folder, ['ls-tree', '-r', '--name-only', head, '--', literal(path)])).trim()) kept.push(path);
  }
  return kept;
}

/** The paths' edits as a patch from `head`, new files included, or '' when they hold nothing the head does not. */
async function patchOf(folder, head, paths, scratch) {
  const specs = (await present(folder, head, paths)).map(path => (path === '.' ? path : literal(path)));
  if (!specs.length) return '';
  const index = { GIT_INDEX_FILE: join(scratch, `index-${Math.random().toString(16).slice(2)}`) };
  await git(folder, ['read-tree', head], index);
  await git(folder, ['add', '-A', '--', ...specs], index);
  return git(folder, ['diff', '--cached', '--binary', head], index);
}

/** Whether a saved patch applies on the head as it is, so the worker who takes it back can rely on it. */
async function applies(folder, head, file, scratch) {
  const index = { GIT_INDEX_FILE: join(scratch, `check-${Math.random().toString(16).slice(2)}`) };
  await git(folder, ['read-tree', head], index);
  return git(folder, ['apply', '--cached', '--check', file], index).then(() => true, () => false);
}

/** Puts the paths back as the head has them: tracked files restored, files the head does not have removed. */
async function takeOut(folder, head, specs) {
  await git(folder, ['restore', `--source=${head}`, '--staged', '--worktree', '--', ...specs]).catch(() => '');
  await git(folder, ['clean', '-fdq', '--', ...specs]).catch(() => '');
}

export async function saveUnfinished(run, { directory, packets }) {
  const head = (await git(run.folder, ['rev-parse', '--verify', `refs/heads/${run.branch}^{commit}`])).trim();
  const saved = [];
  const scratch = mkdtempSync(join(tmpdir(), 'ludicrous-stop-'));
  const unfinished = join(directory, 'unfinished');
  mkdirSync(unfinished, { recursive: true, mode: 0o700 });
  try {
    for (const { packet, area } of packets) {
      const own = queueOf(run.folder, area).find(each => each.id === packet);
      if (!own) continue;
      const paths = [...own.paths, `_specs/ludicrous/trails/${area}/${packet}.md`];
      const patch = await patchOf(run.folder, head, paths, scratch);
      if (!patch.trim()) continue;
      const file = join(unfinished, `${packet}.patch`);
      writeFileSync(file, patch, { mode: 0o600 });
      saved.push({ packet, area, patch: file, applies: await applies(run.folder, head, file, scratch) });
      await takeOut(run.folder, head, paths.map(literal));
    }
    // What no packet owns: a leader's queue it had not landed, a planner's half-written file. Kept, and out of the branch.
    const rest = await patchOf(run.folder, head, ['.'], scratch);
    if (rest.trim()) {
      const file = join(unfinished, 'rest.patch');
      writeFileSync(file, rest, { mode: 0o600 });
      saved.push({ packet: null, area: null, patch: file, applies: await applies(run.folder, head, file, scratch) });
      await takeOut(run.folder, head, ['.']);
    }
    // The shared index lagged behind every commit `land` made; now it matches the head.
    await git(run.folder, ['reset', '-q', head]);
    return { head, saved };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
