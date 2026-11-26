import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { enterFolder, folderRefusal, leaveFolder, prepareTree, releaseTree, retireTree } from '../src/cli/work/tree.mjs';
import { git, repository, withOrigin } from './helpers/work-fixture.mjs';

function folder(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-folder-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, repo: repository(base, 'project') };
}

function originAhead(base, origin) {
  const pusher = join(base, 'pusher');
  execFileSync('git', ['clone', '-q', origin, pusher]);
  git(pusher, 'config', 'user.email', 'other@example.com');
  git(pusher, 'config', 'user.name', 'Other');
  writeFileSync(join(pusher, 'upstream.txt'), 'upstream\n');
  git(pusher, 'add', '.');
  git(pusher, 'commit', '-qm', 'upstream change');
  git(pusher, 'push', '-q', 'origin', 'main');
}

const everything = repo => [git(repo, 'status', '--porcelain=v1', '--branch', '--ignored'), git(repo, 'rev-parse', 'HEAD'), git(repo, 'branch', '--list')].join('\n');

test('a clean folder on its default branch may be worked in', async t => {
  const { repo } = folder(t);

  assert.equal(await folderRefusal(repo), null);
});

test('uncommitted changes, staged or not, keep a run out of the folder', async t => {
  const { repo } = folder(t);
  writeFileSync(join(repo, 'app.txt'), 'half-finished\n');
  assert.equal(await folderRefusal(repo), 'it has uncommitted changes');

  git(repo, 'add', '.');
  assert.equal(await folderRefusal(repo), 'it has uncommitted changes');
});

test('an untracked file keeps a run out, and an ignored one does not', async t => {
  const { repo } = folder(t);
  writeFileSync(join(repo, '.gitignore'), '*.log\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'ignore logs');
  writeFileSync(join(repo, 'debug.log'), 'ignored\n');
  assert.equal(await folderRefusal(repo), null);

  writeFileSync(join(repo, 'notes.txt'), 'mine\n');
  assert.equal(await folderRefusal(repo), 'it has uncommitted changes');
});

test('a folder on another branch keeps a run out, and says which', async t => {
  const { repo } = folder(t);
  git(repo, 'switch', '-qc', 'my-work');

  assert.equal(await folderRefusal(repo), 'it is on my-work');
});

test('a detached folder keeps a run out', async t => {
  const { repo } = folder(t);
  git(repo, 'switch', '-q', '--detach');

  assert.equal(await folderRefusal(repo), 'it is not on a branch');
});

test('a merge in progress keeps a run out', async t => {
  const { repo } = folder(t);
  git(repo, 'switch', '-qc', 'other');
  writeFileSync(join(repo, 'app.txt'), 'theirs\n');
  git(repo, 'commit', '-qam', 'theirs');
  git(repo, 'switch', '-q', 'main');
  writeFileSync(join(repo, 'app.txt'), 'ours\n');
  git(repo, 'commit', '-qam', 'ours');
  assert.throws(() => git(repo, 'merge', 'other'));
  git(repo, 'checkout', '--ours', 'app.txt');
  git(repo, 'add', '.');

  assert.equal(await folderRefusal(repo), 'a merge or rebase is in progress');
});

test('a folder left on the run\'s own branch is carried on from, whatever is in it', async t => {
  const { repo } = folder(t);
  git(repo, 'switch', '-qc', 'hobkin/one');
  writeFileSync(join(repo, 'app.txt'), 'work from before\n');

  assert.equal(await folderRefusal(repo, { branch: 'hobkin/one' }), null);
  const entered = await enterFolder({ repo, branch: 'hobkin/one' });

  assert.equal(entered.base, 'main');
  assert.equal(readFileSync(join(repo, 'app.txt'), 'utf8'), 'work from before\n');
});

test('entering moves the folder to the run\'s branch, cut from the default branch', async t => {
  const { repo } = folder(t);

  const entered = await enterFolder({ repo, branch: 'hobkin/one' });

  assert.equal(entered.base, 'main');
  assert.equal(git(repo, 'branch', '--show-current'), 'hobkin/one');
  assert.equal(git(repo, 'rev-parse', 'hobkin/one'), git(repo, 'rev-parse', 'main'));
});

test('a look stays on the default branch with no branch at all', async t => {
  const { repo } = folder(t);

  await enterFolder({ repo });

  assert.equal(git(repo, 'branch', '--show-current'), 'main');
  assert.equal(git(repo, 'branch', '--list'), '* main');
});

test('a default branch behind origin is fast-forwarded first, and the run starts from there', async t => {
  const { base, repo } = folder(t);
  const origin = withOrigin(base, repo);
  originAhead(base, origin);
  const upstream = git(join(base, 'pusher'), 'rev-parse', 'HEAD');

  await enterFolder({ repo, branch: 'hobkin/one' });

  assert.equal(git(repo, 'rev-parse', 'main'), upstream);
  assert.equal(git(repo, 'rev-parse', 'hobkin/one'), upstream);
});

test('a diverged default branch sends the run to a worktree from origin, and the folder keeps its commit', async t => {
  const { base, repo } = folder(t);
  const origin = withOrigin(base, repo);
  originAhead(base, origin);
  const upstream = git(join(base, 'pusher'), 'rev-parse', 'HEAD');
  writeFileSync(join(repo, 'mine.txt'), 'local commit\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'local commit');
  const before = git(repo, 'rev-parse', 'HEAD');

  const entered = await enterFolder({ repo, branch: 'hobkin/one' });

  assert.equal(entered.refused, 'main has diverged from origin');
  assert.equal(git(repo, 'rev-parse', 'main'), before);
  assert.equal(git(repo, 'branch', '--show-current'), 'main');
  assert.equal(git(repo, 'branch', '--list', 'hobkin/*'), '');

  const tree = join(base, 'tree');
  await prepareTree({ repo, tree, branch: 'hobkin/one' });

  assert.equal(git(tree, 'rev-parse', 'HEAD'), upstream);
  assert.equal(git(repo, 'rev-parse', 'main'), before);
});

test('a fetch that fails sends the run to a worktree and changes nothing', async t => {
  const { base, repo } = folder(t);
  const origin = withOrigin(base, repo);
  rmSync(origin, { recursive: true, force: true });
  const before = everything(repo);

  const entered = await enterFolder({ repo, branch: 'hobkin/one' });

  assert.equal(entered.refused, 'could not fetch main');
  assert.equal(everything(repo), before);
});

test('a fast-forward that fails sends the run to a worktree, and the ignored file in its way stays', async t => {
  const { base, repo } = folder(t);
  writeFileSync(join(repo, '.gitignore'), 'upstream.txt\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'ignore it');
  const origin = withOrigin(base, repo);
  const pusher = join(base, 'pusher');
  execFileSync('git', ['clone', '-q', origin, pusher]);
  git(pusher, 'config', 'user.email', 'other@example.com');
  git(pusher, 'config', 'user.name', 'Other');
  writeFileSync(join(pusher, 'upstream.txt'), 'upstream\n');
  git(pusher, 'add', '-f', '.');
  git(pusher, 'commit', '-qm', 'upstream change');
  git(pusher, 'push', '-q', 'origin', 'main');
  writeFileSync(join(repo, 'upstream.txt'), 'mine\n');
  const before = git(repo, 'rev-parse', 'HEAD');

  const entered = await enterFolder({ repo, branch: 'hobkin/one' });

  assert.equal(entered.refused, 'could not fast-forward main');
  assert.equal(git(repo, 'rev-parse', 'main'), before);
  assert.equal(readFileSync(join(repo, 'upstream.txt'), 'utf8'), 'mine\n');
});

test('a folder git cannot answer for comes back as a reason, never a throw', async t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-folder-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const pushed = repository(base, 'pushed');
  const origin = withOrigin(base, pushed);
  // A default branch with no commit yet, while origin has one, cannot be compared with origin at all.
  const repo = join(base, 'unborn');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'remote', 'add', 'origin', origin);

  const entered = await enterFolder({ repo, branch: 'hobkin/one' });

  assert.equal(typeof entered.refused, 'string');
  assert.equal(git(repo, 'branch', '--list', 'hobkin/*'), '');
});

test('commits not yet pushed stay out of the run\'s PR, so that run takes a worktree', async t => {
  const { base, repo } = folder(t);
  withOrigin(base, repo);
  writeFileSync(join(repo, 'mine.txt'), 'not pushed\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'not pushed');

  const entered = await enterFolder({ repo, branch: 'hobkin/one' });

  assert.equal(entered.refused, 'main has commits not pushed');
  assert.equal(git(repo, 'branch', '--show-current'), 'main');
});

test('a refused folder says so and is left exactly as it was', async t => {
  const { repo } = folder(t);
  writeFileSync(join(repo, 'notes.txt'), 'mine\n');
  const before = everything(repo);

  const entered = await enterFolder({ repo, branch: 'hobkin/one' });

  assert.equal(entered.refused, 'it has uncommitted changes');
  assert.equal(everything(repo), before);
});

test('leaving puts the folder back on the branch it was on, and the work stays on its own branch', async t => {
  const { repo } = folder(t);
  const { base } = await enterFolder({ repo, branch: 'hobkin/one' });
  writeFileSync(join(repo, 'new.txt'), 'the agent\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'agent work');

  assert.equal(await leaveFolder({ repo, branch: 'hobkin/one', base }), null);

  assert.equal(git(repo, 'branch', '--show-current'), 'main');
  assert.equal(existsSync(join(repo, 'new.txt')), false);
  assert.match(git(repo, 'log', '-1', '--format=%s', 'hobkin/one'), /agent work/);
});

test('changes made meanwhile keep the folder where it is, and it says so', async t => {
  const { repo } = folder(t);
  const { base } = await enterFolder({ repo, branch: 'hobkin/one' });
  writeFileSync(join(repo, 'app.txt'), 'the user typed here\n');

  const left = await leaveFolder({ repo, branch: 'hobkin/one', base });

  assert.deepEqual(left, { stays: 'it has uncommitted changes' });
  assert.equal(git(repo, 'branch', '--show-current'), 'hobkin/one');
  assert.equal(readFileSync(join(repo, 'app.txt'), 'utf8'), 'the user typed here\n');
});

test('a user who moved the folder elsewhere is left where they went', async t => {
  const { repo } = folder(t);
  const { base } = await enterFolder({ repo, branch: 'hobkin/one' });
  git(repo, 'switch', '-qc', 'my-work');

  const left = await leaveFolder({ repo, branch: 'hobkin/one', base });

  assert.deepEqual(left, { moved: 'my-work' });
  assert.equal(git(repo, 'branch', '--show-current'), 'my-work');
});

/** A run that stops tracking a file the default branch tracks, such as a secret, leaves the file in the folder, ignored. */
async function stopsTracking(repo, path, content) {
  mkdirSync(join(repo, dirname(path)), { recursive: true });
  writeFileSync(join(repo, path), content);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', `track ${path}`);
  const { base } = await enterFolder({ repo, branch: 'hobkin/one' });
  git(repo, 'rm', '-q', '--cached', path);
  writeFileSync(join(repo, '.gitignore'), `${path}\n`);
  git(repo, 'add', '.gitignore');
  git(repo, 'commit', '-qm', `stop tracking ${path}`);
  return base;
}

test('a file the run stopped tracking does not keep the folder from going back when the default branch has the same copy', async t => {
  const { repo } = folder(t);
  const base = await stopsTracking(repo, 'config/master.key', 'the key\n');

  assert.equal(await leaveFolder({ repo, branch: 'hobkin/one', base }), null);

  assert.equal(git(repo, 'branch', '--show-current'), 'main');
  assert.equal(readFileSync(join(repo, 'config', 'master.key'), 'utf8'), 'the key\n');
});

test('a default branch checked out in another copy keeps the folder on its branch, and says where that copy is', async t => {
  const { base: scratch, repo } = folder(t);
  const { base } = await enterFolder({ repo, branch: 'hobkin/one' });
  const other = join(scratch, 'other');
  git(repo, 'worktree', 'add', '-q', other, 'main');

  const left = await leaveFolder({ repo, branch: 'hobkin/one', base });

  assert.deepEqual(left, { stays: `main is checked out in another copy of it, at ${other}` });
  assert.equal(git(repo, 'branch', '--show-current'), 'hobkin/one');
});

test('a file the run stopped tracking that changed since keeps the folder on its branch, and says which file', async t => {
  const { repo } = folder(t);
  const base = await stopsTracking(repo, 'config/master.key', 'the key\n');
  writeFileSync(join(repo, 'config', 'master.key'), 'a rotated key\n');

  const left = await leaveFolder({ repo, branch: 'hobkin/one', base });

  assert.deepEqual(left, { stays: "going back to main would replace config/master.key, which is not the same as main's copy" });
  assert.equal(git(repo, 'branch', '--show-current'), 'hobkin/one');
  assert.equal(readFileSync(join(repo, 'config', 'master.key'), 'utf8'), 'a rotated key\n');
});

test('a tree can never be the project\'s own folder', async t => {
  const { repo } = folder(t);
  writeFileSync(join(repo, 'notes.txt'), 'mine\n');

  await assert.rejects(prepareTree({ repo, tree: repo, branch: 'hobkin/one' }), /never the project/);

  assert.equal(readFileSync(join(repo, 'notes.txt'), 'utf8'), 'mine\n');
});

test('the project\'s own folder on a Hobkin branch takes no commit and never moves', async t => {
  const { base, repo } = folder(t);
  git(repo, 'switch', '-qc', 'hobkin/one');
  writeFileSync(join(repo, 'notes.txt'), 'mine\n');
  const before = everything(repo);

  await assert.rejects(prepareTree({ repo, tree: repo, branch: 'hobkin/two' }), /never the project/);

  assert.equal(everything(repo), before);
  assert.deepEqual(readdirSync(base), ['project']);
});

test('the project\'s own folder is never released, whatever branch it is on and however the run ended', async t => {
  const { repo } = folder(t);
  git(repo, 'switch', '-qc', 'hobkin/one');
  writeFileSync(join(repo, 'notes.txt'), 'mine\n');
  const before = everything(repo);

  await releaseTree(repo);
  await releaseTree(repo, { finished: true });

  assert.equal(everything(repo), before);
});

test('the project\'s own folder is never taken away, however clean it is', async t => {
  const { repo } = folder(t);
  const before = everything(repo);

  assert.equal(await retireTree({ repo, tree: repo }), false);

  assert.equal(everything(repo), before);
});

test('nothing in the in-place path runs reset or clean in the user\'s folder', async t => {
  const { base, repo } = folder(t);
  const tree = join(base, 'tree');
  const log = join(base, 'git.log');
  const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const bin = join(base, 'bin');
  execFileSync('mkdir', [bin]);
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  t.after(() => { process.env.PATH = saved; });

  const { base: branch } = await enterFolder({ repo, branch: 'hobkin/one' });
  await leaveFolder({ repo, branch: 'hobkin/one', base: branch });
  writeFileSync(join(repo, 'notes.txt'), 'mine\n');
  await folderRefusal(repo);
  await prepareTree({ repo, tree, branch: 'hobkin/two' });

  const calls = readFileSync(log, 'utf8').trim().split('\n');
  assert.ok(calls.some(call => call.includes(`-C ${tree} reset`)), 'the worktree path is the one that resets');
  const destructive = calls.filter(call => /\b(reset|clean)\b/.test(call));
  assert.ok(destructive.length);
  for (const call of destructive) assert.ok(call.startsWith(`-C ${tree} `), call);
  assert.equal(calls.filter(call => /--force|-f\b/.test(call) && call.includes(`-C ${repo} `)).length, 0);
  assert.equal(readFileSync(join(repo, 'notes.txt'), 'utf8'), 'mine\n');
});
