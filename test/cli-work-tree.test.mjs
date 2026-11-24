import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { currentBranch, gitOrNothing, gitWithin, headBranch, prepareTree, releaseTree, retireTree, withRepository } from '../src/cli/work/tree.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const WORK_KEPT = 'Work in progress kept by Hobkin';
// What an install and a local setting leave behind, as it lands in a real project.
const JUNK = ['node_modules/dep/index.js', 'packages/web/node_modules/dep/index.js', '.env', '.env.local', 'packages/web/.env.production', '.env.d/secret'];

function repository(t, { remote = true } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-tree-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const checkout = join(base, 'checkout');
  execFileSync('git', ['init', '-q', '-b', 'main', checkout]);
  git(checkout, 'config', 'user.email', 'test@example.com');
  git(checkout, 'config', 'user.name', 'Test');
  writeFileSync(join(checkout, 'app.txt'), 'one\n');
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-qm', 'first');
  if (remote) {
    const origin = join(base, 'origin.git');
    execFileSync('git', ['clone', '-q', '--bare', checkout, origin]);
    git(checkout, 'remote', 'add', 'origin', origin);
    git(checkout, 'fetch', '-q', 'origin');
    git(checkout, 'remote', 'set-head', 'origin', 'main');
  }
  return { base, checkout, tree: join(base, 'trees/work') };
}

const movedAside = tree => readdirSync(dirname(tree)).filter(name => name.startsWith(`${basename(tree)}-moved-`)).map(name => join(dirname(tree), name));
const worktrees = checkout => git(checkout, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length));
const keptFrom = (checkout, branch) => git(checkout, 'branch', '--list', `${branch}-kept-*`, '--format=%(refname:short)').split('\n').filter(Boolean);
const filesOn = (checkout, ref) => git(checkout, 'ls-tree', '-r', '--name-only', ref).split('\n');

function leave(tree, path, text = 'left behind\n') {
  mkdirSync(dirname(join(tree, path)), { recursive: true });
  writeFileSync(join(tree, path), text);
}

function leaveJunk(tree) {
  for (const path of JUNK) leave(tree, path);
  // A worktree often borrows the install of the checkout it came from.
  mkdirSync(join(tree, 'packages/api'), { recursive: true });
  symlinkSync('/nowhere', join(tree, 'packages/api/node_modules'));
}

// A stand-in for git, first on the PATH until the test ends.
function replaceGit(t, base, script) {
  const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const bin = join(base, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n${script(real)}\n`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  t.after(() => { process.env.PATH = saved; });
}

test('git can never ask anyone for anything', async t => {
  const { base, checkout, tree } = repository(t);
  const seen = join(base, 'seen.log');
  replaceGit(t, base, real => `printf '%s\\n' "$GIT_TERMINAL_PROMPT" >> '${seen}'\nexec '${real}' "$@"`);

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  await gitOrNothing(checkout, 'status');

  assert.deepEqual([...new Set(readFileSync(seen, 'utf8').trim().split('\n'))], ['0']);
});

test('a git that hangs is killed instead of holding the run', async t => {
  const { base, checkout } = repository(t);
  replaceGit(t, base, () => 'exec sleep 30');
  const started = Date.now();

  await assert.rejects(gitWithin(50)(checkout, 'fetch'), { killed: true });

  assert.ok(Date.now() - started < 5000);
});

test('a folder left where a tree belongs moves aside with what is in it, and the tree is made', async t => {
  const { checkout, tree } = repository(t);
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(tree, 'left.txt'), 'left behind\n');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });

  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/one');
  assert.equal(existsSync(join(tree, 'left.txt')), false);
  const [aside, ...others] = movedAside(tree);
  assert.deepEqual(others, []);
  assert.equal(readFileSync(join(aside, 'left.txt'), 'utf8'), 'left behind\n');
});

test('a stale index.lock from a killed run stops nothing, and the work under it is kept', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'uncommitted when the run was killed\n');
  writeFileSync(join(git(tree, 'rev-parse', '--absolute-git-dir'), 'index.lock'), '');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/two');
  const [aside] = movedAside(tree);
  assert.equal(readFileSync(join(aside, 'app.txt'), 'utf8'), 'uncommitted when the run was killed\n');
  assert.deepEqual(worktrees(checkout), [checkout, tree], 'git keeps no entry for the folder that moved');
});

test('a stale lock in a clean tree is got past too', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(git(tree, 'rev-parse', '--absolute-git-dir'), 'index.lock'), '');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/two');
});

test('a tree whose link to the repository is dead is moved aside and made again', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'notes.txt'), 'in the dead tree\n');
  rmSync(git(tree, 'rev-parse', '--absolute-git-dir'), { recursive: true, force: true });

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one', resume: true });

  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/one');
  assert.equal(readFileSync(join(movedAside(tree)[0], 'notes.txt'), 'utf8'), 'in the dead tree\n');
});

test('a healthy tree stays where it is', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.deepEqual(movedAside(tree), []);
});

test('a failure of the second attempt goes back to the queue, and coming round again moves nothing more', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });
  writeFileSync(join(tree, 'notes.txt'), 'in the dead tree\n');
  rmSync(git(tree, 'rev-parse', '--absolute-git-dir'), { recursive: true, force: true });
  git(checkout, 'switch', '-q', 'hobkin/one');

  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(prepareTree({ repo: checkout, tree, branch: 'hobkin/one', resume: true }), /already used by worktree|already checked out/);
  }

  const moved = movedAside(tree);
  assert.equal(moved.length, 1, 'each attempt would otherwise leave another whole checkout');
  assert.equal(readFileSync(join(moved[0], 'notes.txt'), 'utf8'), 'in the dead tree\n', 'the moved folder is never deleted');
  assert.deepEqual(worktrees(checkout), [checkout]);

  git(checkout, 'switch', '-q', 'main');
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one', resume: true });
  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/one');
});

test('a branch checked out somewhere else is no fault of the tree: it stays where it is, and the item goes back in the queue', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });
  writeFileSync(join(tree, 'app.txt'), 'the agent changed this\n');
  git(tree, 'commit', '-qam', 'agent work');
  const tip = git(tree, 'rev-parse', 'HEAD');
  git(checkout, 'switch', '-q', 'hobkin/one');

  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(prepareTree({ repo: checkout, tree, branch: 'hobkin/one', resume: true }), /already used by worktree|already checked out/);
  }

  assert.deepEqual(movedAside(tree), [], 'moving it cannot help');
  assert.deepEqual([git(tree, 'branch', '--show-current'), git(tree, 'rev-parse', 'HEAD')], ['hobkin/two', tip]);
  assert.deepEqual(worktrees(checkout), [checkout, tree]);

  git(checkout, 'switch', '-q', 'main');
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one', resume: true });
  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/one');
});

test('the wording older versions of git use for that refusal counts too', async t => {
  const { base, checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  replaceGit(t, base, real => `case "$*" in\n  *" switch "*) echo "fatal: 'hobkin/two' is already checked out at '/elsewhere'" >&2; exit 128 ;;\nesac\nexec '${real}' "$@"`);

  await assert.rejects(prepareTree({ repo: checkout, tree, branch: 'hobkin/two' }), /already checked out/);

  assert.deepEqual(movedAside(tree), []);
});

test('a worktree deleted by hand holds no branch, because git keeps its entry until it is told', async t => {
  const { base, checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  const review = join(base, 'review');
  git(checkout, 'worktree', 'add', '-q', '-b', 'hobkin/two', review, 'main');
  rmSync(review, { recursive: true, force: true });

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two', resume: true });

  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/two');
  assert.deepEqual(movedAside(tree), []);
});

test('taking a tree keeps what an earlier item left uncommitted on a side branch, and that item\'s own branch stays exactly as it was', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  const tip = git(tree, 'rev-parse', 'HEAD');
  writeFileSync(join(tree, 'app.txt'), 'edited but not committed\n');
  writeFileSync(join(tree, 'new.txt'), 'never added\n');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/two');
  assert.equal(git(tree, 'status', '--porcelain'), '');
  assert.equal(existsSync(join(tree, 'new.txt')), false);
  assert.equal(git(checkout, 'rev-parse', 'hobkin/one'), tip, 'a finished local PR is never added to');
  const [kept, ...others] = keptFrom(checkout, 'hobkin/one');
  assert.deepEqual(others, []);
  assert.match(kept, /^hobkin\/one-kept-\d{8}-\d{6}$/);
  assert.equal(git(checkout, 'log', '-1', '--format=%s|%an|%ae', kept), `${WORK_KEPT}|Hobkin|hobkin@localhost`);
  assert.equal(git(checkout, 'rev-parse', `${kept}~1`), tip, 'it starts from the commit the tree was on');
  assert.equal(git(checkout, 'show', `${kept}:app.txt`), 'edited but not committed');
  assert.equal(git(checkout, 'show', `${kept}:new.txt`), 'never added');
  assert.deepEqual(movedAside(tree), [], 'nothing was wrong with the tree');
});

test('what an install or a local setting left stays out of what is kept, at any depth', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  leaveJunk(tree);
  leave(tree, 'packages/web/work.txt', 'the real change\n');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  const [kept] = keptFrom(checkout, 'hobkin/one');
  assert.deepEqual(filesOn(checkout, kept), ['app.txt', 'packages/web/work.txt']);
  assert.equal(git(tree, 'status', '--porcelain'), '');
});

test('with nothing else left, no branch and no commit are made', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  const tip = git(tree, 'rev-parse', 'HEAD');
  leaveJunk(tree);

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.deepEqual(keptFrom(checkout, 'hobkin/one'), []);
  assert.equal(git(checkout, 'rev-parse', 'hobkin/one'), tip);
  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/two');
});

test('what a run staged before it stopped stays out too', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  leaveJunk(tree);
  leave(tree, 'work.txt', 'the real change\n');
  git(tree, 'add', '--all');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.deepEqual(filesOn(checkout, keptFrom(checkout, 'hobkin/one')[0]), ['app.txt', 'work.txt']);
});

test('a change to a file the project tracks is work, whatever its name', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  leave(tree, '.env.example', 'TOKEN=\n');
  git(tree, 'add', '.');
  git(tree, 'commit', '-qm', 'an example');
  leave(tree, '.env.example', 'TOKEN=\nREGION=\n');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.equal(git(checkout, 'show', `${keptFrom(checkout, 'hobkin/one')[0]}:.env.example`), 'TOKEN=\nREGION=');
});

const stoppedOn = {
  merge: tree => git(tree, 'merge', '-q', 'other'),
  'cherry-pick': tree => git(tree, 'cherry-pick', 'other'),
  revert: tree => {
    writeFileSync(join(tree, 'app.txt'), 'ours again\n');
    git(tree, 'commit', '-qam', 'ours again');
    git(tree, 'revert', '--no-edit', 'HEAD~1');
  },
};

for (const [operation, stop] of Object.entries(stoppedOn)) {
  test(`a tree stopped in the middle of a ${operation} commits no conflict markers, and keeps what was written meanwhile`, async t => {
    const { checkout, tree } = repository(t);
    git(checkout, 'switch', '-qc', 'other');
    writeFileSync(join(checkout, 'app.txt'), 'theirs\n');
    git(checkout, 'commit', '-qam', 'theirs');
    git(checkout, 'switch', '-q', 'main');
    await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
    writeFileSync(join(tree, 'app.txt'), 'ours\n');
    git(tree, 'commit', '-qam', 'ours');
    assert.throws(() => stop(tree));
    assert.match(readFileSync(join(tree, 'app.txt'), 'utf8'), /<<<<<<</);
    const tip = git(tree, 'rev-parse', 'HEAD');
    writeFileSync(join(tree, 'notes.txt'), 'written while it was stopped\n');

    await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

    const [kept] = keptFrom(checkout, 'hobkin/one');
    assert.doesNotMatch(git(checkout, 'show', `${kept}:app.txt`), /<<<<<<</);
    assert.equal(git(checkout, 'show', `${kept}:notes.txt`), 'written while it was stopped');
    assert.equal(git(checkout, 'rev-parse', 'hobkin/one'), tip);
    assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/two');
    assert.deepEqual(movedAside(tree), []);
  });
}

test('the project\'s hooks, signing and missing identity cannot stop that commit', async t => {
  const { base, checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'edited but not committed\n');
  git(checkout, 'config', '--unset', 'user.name');
  git(checkout, 'config', '--unset', 'user.email');
  git(checkout, 'config', 'user.useConfigOnly', 'true');
  git(checkout, 'config', 'commit.gpgsign', 'true');
  git(checkout, 'config', 'gpg.program', 'false');
  for (const hook of ['pre-commit', 'commit-msg']) writeFileSync(join(checkout, '.git/hooks', hook), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = join(base, 'no-global-config');
  t.after(() => {
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved;
  });

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.equal(git(checkout, 'log', '-1', '--format=%s', keptFrom(checkout, 'hobkin/one')[0]), WORK_KEPT);
  assert.deepEqual(movedAside(tree), []);
});

test('work left in a rebase that died is kept after the rebase is abandoned', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'the agent changed this\n');
  git(tree, 'commit', '-qam', 'agent work');
  const tip = git(tree, 'rev-parse', 'HEAD');
  writeFileSync(join(checkout, 'app.txt'), 'the default branch changed this\n');
  git(checkout, 'commit', '-qam', 'main moves');
  assert.throws(() => git(tree, 'rebase', 'main'));
  writeFileSync(join(tree, 'notes.txt'), 'written during the rebase\n');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  const [kept] = keptFrom(checkout, 'hobkin/one');
  assert.equal(git(checkout, 'log', '-1', '--format=%s', kept), WORK_KEPT);
  assert.equal(git(checkout, 'show', `${kept}:notes.txt`), 'written during the rebase');
  assert.equal(git(checkout, 'show', `${kept}:app.txt`), 'the agent changed this');
  assert.equal(git(checkout, 'rev-parse', 'hobkin/one'), tip);
});

test('a clean tree adds no commit and makes no side branch', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  const tip = git(tree, 'rev-parse', 'HEAD');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.equal(git(checkout, 'rev-parse', 'hobkin/one'), tip);
  assert.deepEqual(keptFrom(checkout, 'hobkin/one'), []);
});

test('only a branch of Hobkin\'s own takes a commit: anything else in a tree is cleared as before', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree });
  writeFileSync(join(tree, 'detached.txt'), 'a look left this\n');
  const start = git(tree, 'rev-parse', 'HEAD');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  assert.equal(existsSync(join(tree, 'detached.txt')), false);
  assert.equal(git(tree, 'rev-parse', 'HEAD'), start);

  git(tree, 'switch', '-qc', 'someone-else');
  writeFileSync(join(tree, 'other.txt'), 'not on a hobkin branch\n');
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });
  assert.equal(existsSync(join(tree, 'other.txt')), false);
  assert.equal(git(checkout, 'rev-parse', 'someone-else'), start);
});

test('a released tree lets the user switch to its branch, and delete it', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'the agent changed this\n');
  git(tree, 'commit', '-qam', 'agent work');
  assert.throws(() => git(checkout, 'switch', '-q', 'hobkin/one'), 'a tree holding the branch is what stops a review');

  await releaseTree(tree);

  assert.equal(git(tree, 'branch', '--show-current'), '');
  git(checkout, 'switch', '-q', 'hobkin/one');
  assert.equal(readFileSync(join(checkout, 'app.txt'), 'utf8'), 'the agent changed this\n');
  git(checkout, 'switch', '-q', 'main');
  git(checkout, 'branch', '-qD', 'hobkin/one');
  assert.equal(git(checkout, 'branch', '--list', 'hobkin/one'), '');
});

test('a released tree takes its branch back when the item resumes', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'the agent changed this\n');
  git(tree, 'commit', '-qam', 'agent work');
  const tip = git(tree, 'rev-parse', 'HEAD');
  await releaseTree(tree);

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one', resume: true });

  assert.deepEqual([git(tree, 'branch', '--show-current'), git(tree, 'rev-parse', 'HEAD')], ['hobkin/one', tip]);
});

test('a run with no outcome keeps its uncommitted work where it is, on its branch, for the next run to resume', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'notes.txt'), 'not committed\n');

  await releaseTree(tree);

  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/one');
  assert.equal(readFileSync(join(tree, 'notes.txt'), 'utf8'), 'not committed\n');
  assert.deepEqual(keptFrom(checkout, 'hobkin/one'), []);
});

test('a finished run puts what it left uncommitted on a side branch and lets go of its own, which stays exactly as it was', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'the agent changed this\n');
  git(tree, 'commit', '-qam', 'agent work');
  const tip = git(tree, 'rev-parse', 'HEAD');
  writeFileSync(join(tree, 'notes.txt'), 'not committed\n');

  await releaseTree(tree, { finished: true });

  assert.equal(git(tree, 'branch', '--show-current'), '');
  assert.equal(git(checkout, 'rev-parse', 'hobkin/one'), tip);
  const [kept] = keptFrom(checkout, 'hobkin/one');
  assert.equal(git(checkout, 'show', `${kept}:notes.txt`), 'not committed');
  for (const branch of [kept, 'hobkin/one']) {
    git(checkout, 'switch', '-q', branch);
    assert.equal(git(checkout, 'branch', '--show-current'), branch, 'the tree holds neither');
  }
});

test('a finished run that left nothing but junk still lets go of its branch, with no side branch', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  const tip = git(tree, 'rev-parse', 'HEAD');
  leaveJunk(tree);

  await releaseTree(tree, { finished: true });

  assert.equal(git(tree, 'branch', '--show-current'), '');
  assert.deepEqual(keptFrom(checkout, 'hobkin/one'), []);
  git(checkout, 'switch', '-q', 'hobkin/one');
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), tip);
});

test('a run that finished in the middle of a rebase lets go of its branch too, which a rebase holds without showing it', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'the agent changed this\n');
  git(tree, 'commit', '-qam', 'agent work');
  const tip = git(tree, 'rev-parse', 'HEAD');
  writeFileSync(join(checkout, 'app.txt'), 'the default branch changed this\n');
  git(checkout, 'commit', '-qam', 'main moves');
  assert.throws(() => git(tree, 'rebase', 'main'));
  assert.equal(git(tree, 'branch', '--show-current'), '');

  await releaseTree(tree, { finished: true });

  git(checkout, 'switch', '-q', 'hobkin/one');
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), tip);
  assert.deepEqual(keptFrom(checkout, 'hobkin/one'), [], 'abandoning the rebase left nothing to keep');
});

test('a run that finished in the middle of a merge keeps no conflict markers', async t => {
  const { checkout, tree } = repository(t);
  git(checkout, 'switch', '-qc', 'other');
  writeFileSync(join(checkout, 'app.txt'), 'theirs\n');
  git(checkout, 'commit', '-qam', 'theirs');
  git(checkout, 'switch', '-q', 'main');
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'ours\n');
  git(tree, 'commit', '-qam', 'ours');
  assert.throws(() => git(tree, 'merge', '-q', 'other'));

  await releaseTree(tree, { finished: true });

  assert.equal(git(tree, 'branch', '--show-current'), '');
  assert.deepEqual(keptFrom(checkout, 'hobkin/one'), []);
  assert.equal(git(checkout, 'show', 'hobkin/one:app.txt'), 'ours');
});

test('a tree that is gone, dead or already detached is nothing to release', async t => {
  const { base, checkout, tree } = repository(t);
  await releaseTree(join(base, 'never-made'), { finished: true });

  await prepareTree({ repo: checkout, tree });
  const detached = git(tree, 'rev-parse', 'HEAD');
  for (const finished of [false, true]) {
    await releaseTree(tree, { finished });
    assert.deepEqual([git(tree, 'branch', '--show-current'), git(tree, 'rev-parse', 'HEAD')], ['', detached]);
  }

  rmSync(git(tree, 'rev-parse', '--absolute-git-dir'), { recursive: true, force: true });
  await releaseTree(tree);
  await releaseTree(tree, { finished: true });
});

test('a run that died in the middle of a rebase stops nothing after it', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/abc-fix' });
  writeFileSync(join(tree, 'app.txt'), 'the agent changed this\n');
  git(tree, 'commit', '-qam', 'agent work');
  const work = git(tree, 'rev-parse', 'HEAD');
  writeFileSync(join(checkout, 'app.txt'), 'the default branch changed this\n');
  git(checkout, 'commit', '-qam', 'main moves');
  assert.throws(() => git(tree, 'rebase', 'main'), 'the run stops here, on a conflict');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/abc-fix', resume: true });
  assert.deepEqual([git(tree, 'branch', '--show-current'), git(tree, 'rev-parse', 'HEAD')], ['hobkin/abc-fix', work], 'the item resumes with its commit');

  assert.throws(() => git(tree, 'rebase', 'main'));
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/def-other' });
  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/def-other', 'and another item can start here');
});

test('a tree leaves the user\'s checkout exactly as it was', async t => {
  const { checkout, tree } = repository(t);
  git(checkout, 'switch', '-qc', 'my-branch');
  writeFileSync(join(checkout, 'app.txt'), 'half-finished edit\n');
  writeFileSync(join(checkout, 'notes.txt'), 'untracked\n');
  const before = git(checkout, 'status', '--porcelain=v1', '--branch');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/abc-fix' });
  writeFileSync(join(tree, 'app.txt'), 'the agent changed this\n');
  git(tree, 'commit', '-qam', 'agent work');

  assert.equal(git(checkout, 'status', '--porcelain=v1', '--branch'), before);
  assert.equal(readFileSync(join(checkout, 'app.txt'), 'utf8'), 'half-finished edit\n');
  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/abc-fix');
});

test('a new item starts from the latest default branch and leaves nothing behind', async t => {
  const { checkout, tree, base } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'stray.txt'), 'left over\n');

  const pusher = join(base, 'pusher');
  execFileSync('git', ['clone', '-q', join(base, 'origin.git'), pusher]);
  git(pusher, 'config', 'user.email', 'test@example.com');
  git(pusher, 'config', 'user.name', 'Test');
  writeFileSync(join(pusher, 'new.txt'), 'upstream\n');
  git(pusher, 'add', '.');
  git(pusher, 'commit', '-qm', 'upstream change');
  git(pusher, 'push', '-q', 'origin', 'main');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/two');
  assert.equal(existsSync(join(tree, 'stray.txt')), false);
  assert.equal(existsSync(join(tree, 'new.txt')), true);
});

test('a fetch that fails does not stop a tree: it starts from what is already here', async t => {
  const { checkout, tree, base } = repository(t);
  rmSync(join(base, 'origin.git'), { recursive: true, force: true });

  const prepared = await prepareTree({ repo: checkout, tree, branch: 'hobkin/offline' });

  assert.equal(prepared.base, 'origin/main');
  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/offline');
  assert.equal(git(tree, 'rev-parse', 'HEAD'), git(checkout, 'rev-parse', 'origin/main'));
});

test('an interrupted item resumes on its own branch with its work kept', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'in progress\n');
  const tip = git(tree, 'rev-parse', 'HEAD');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one', resume: true });

  assert.equal(readFileSync(join(tree, 'app.txt'), 'utf8'), 'in progress\n');
  assert.equal(git(tree, 'rev-parse', 'HEAD'), tip, 'the work stays uncommitted, as the item left it');
});

test('a read-only tree sits detached at the default branch', async t => {
  const { checkout, base } = repository(t);
  const tree = join(base, 'trees/look');

  await prepareTree({ repo: checkout, tree });

  assert.equal(git(tree, 'branch', '--show-current'), '');
  assert.equal(git(tree, 'rev-parse', 'HEAD'), git(checkout, 'rev-parse', 'origin/main'));
});

test('a repository with no remote works from its local default branch', async t => {
  const { checkout, tree } = repository(t, { remote: false });

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/local' });

  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/local');
  assert.equal(git(tree, 'rev-parse', 'HEAD'), git(checkout, 'rev-parse', 'main'));
});

test('a tree removed by hand is rebuilt', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  rmSync(tree, { recursive: true, force: true });

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/two' });

  assert.equal(git(tree, 'branch', '--show-current'), 'hobkin/two');
});

test('a tree with nothing in it git could not bring back goes, ignored files and all, and its branch stays', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  leave(tree, '.gitignore', 'node_modules\n');
  git(tree, 'add', '.gitignore');
  git(tree, 'commit', '-qm', 'agent work');
  const tip = git(tree, 'rev-parse', 'HEAD');
  leave(tree, 'node_modules/dep/index.js');
  await releaseTree(tree, { finished: true });

  assert.equal(await retireTree({ repo: checkout, tree }), true);

  assert.equal(existsSync(tree), false);
  assert.deepEqual(worktrees(checkout), [checkout]);
  assert.equal(git(checkout, 'rev-parse', 'hobkin/one'), tip);
});

test('a tree on its branch goes too, and lets go of that branch', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });

  assert.equal(await retireTree({ repo: checkout, tree }), true);

  git(checkout, 'switch', '-q', 'hobkin/one');
  assert.equal(git(checkout, 'branch', '--show-current'), 'hobkin/one');
});

for (const [left, leaveIt] of Object.entries({
  'a change never committed': tree => leave(tree, 'app.txt', 'changed\n'),
  'a file never added': tree => leave(tree, 'notes.txt'),
  'a commit on no branch': tree => {
    leave(tree, 'app.txt', 'committed while detached\n');
    git(tree, 'commit', '-qam', 'on no branch');
  },
})) {
  test(`a tree holding ${left} stays exactly as it is`, async t => {
    const { checkout, tree } = repository(t);
    await prepareTree({ repo: checkout, tree });
    leaveIt(tree);
    const statusAndHead = () => ({ status: git(tree, 'status', '--porcelain'), head: git(tree, 'rev-parse', 'HEAD') });
    const before = statusAndHead();

    assert.equal(await retireTree({ repo: checkout, tree }), false);

    assert.deepEqual(statusAndHead(), before);
    assert.deepEqual(worktrees(checkout), [checkout, tree]);
  });
}

test('a tree in the middle of a rebase stays, because the rebase still holds its branch', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'the agent changed this\n');
  git(tree, 'commit', '-qam', 'agent work');
  writeFileSync(join(checkout, 'app.txt'), 'the default branch changed this\n');
  git(checkout, 'commit', '-qam', 'main moves');
  assert.throws(() => git(tree, 'rebase', 'main'));
  git(tree, 'checkout', '--ours', 'app.txt');
  git(tree, 'add', 'app.txt');
  assert.equal(git(tree, 'status', '--porcelain'), '', 'nothing shows but the rebase itself');

  assert.equal(await retireTree({ repo: checkout, tree }), false);

  assert.deepEqual(worktrees(checkout), [checkout, tree]);
});

test('a folder that is gone, or is no tree at all, is nothing to take away', async t => {
  const { base, checkout, tree } = repository(t);
  mkdirSync(tree, { recursive: true });

  const gone = await retireTree({ repo: checkout, tree: join(base, 'never-made') });
  const plain = await retireTree({ repo: checkout, tree });

  assert.deepEqual([gone, plain], [false, false]);
  assert.equal(existsSync(tree), true);
});

test('the branch a checkout or a worktree is on is read from its HEAD, as git would say it, without starting git', async t => {
  const { checkout } = repository(t, { remote: false });
  const tree = join(dirname(checkout), 'tree');
  git(checkout, 'worktree', 'add', '-q', '-b', 'hobkin/one', tree);
  git(checkout, 'switch', '-qc', 'my-work');
  const said = [git(checkout, 'branch', '--show-current'), git(tree, 'branch', '--show-current')];
  git(checkout, 'switch', '-q', '--detach');
  said.push(git(checkout, 'branch', '--show-current'));
  git(checkout, 'switch', '-q', 'my-work');

  // With no git on the path, only the HEAD files can answer.
  const path = process.env.PATH;
  process.env.PATH = '';
  t.after(() => { process.env.PATH = path; });
  const read = [await headBranch(checkout), await headBranch(tree)];
  process.env.PATH = path;
  git(checkout, 'switch', '-q', '--detach');
  process.env.PATH = '';
  read.push(await headBranch(checkout));
  process.env.PATH = path;
  assert.deepEqual(read, said);
  assert.deepEqual(said, ['my-work', 'hobkin/one', '']);
});

test('a repository that keeps its refs in reftable says its branch as git does, not the placeholder in its HEAD file', async t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-reftable-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', '--ref-format=reftable', '-b', 'hobkin/fix-door', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-q', '--allow-empty', '-m', 'start']);
  const tree = join(base, 'tree');
  git(repo, 'worktree', 'add', '-q', '-b', 'hobkin/two', tree);
  assert.equal(readFileSync(join(repo, '.git', 'HEAD'), 'utf8').trim(), 'ref: refs/heads/.invalid', 'git keeps a placeholder there');
  assert.equal(await headBranch(repo), 'hobkin/fix-door');
  assert.equal(await headBranch(tree), 'hobkin/two');
  assert.equal(await headBranch(repo), await currentBranch(repo));
});

test('git steps on one repository take turns, and another repository goes on meanwhile', async t => {
  const { checkout } = repository(t);
  const order = [];
  const gate = Promise.withResolvers();
  const first = withRepository(checkout, async () => { order.push('first in'); await gate.promise; order.push('first out'); });
  const second = withRepository(`${checkout}/../checkout`, async () => { order.push('second in'); });
  const other = await withRepository('/nowhere/else', async () => 'other done');
  assert.equal(other, 'other done');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(order, ['first in'], 'the second waits for the first, whatever it names the folder');
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first in', 'first out', 'second in']);
  await assert.rejects(withRepository(checkout, async () => { throw Error('boom'); }), /boom/);
  assert.equal(await withRepository(checkout, async () => 'after a failure'), 'after a failure', 'a failure does not hold the line');
});

test('two trees of one repository made together are both ready', async t => {
  const { checkout, base } = repository(t);
  const trees = ['one', 'two', 'three'].map(name => join(base, 'trees', name));
  await Promise.all(trees.map((tree, index) => prepareTree({ repo: checkout, tree, branch: `hobkin/item-${index}` })));
  assert.deepEqual(trees.map(tree => git(tree, 'branch', '--show-current')), ['hobkin/item-0', 'hobkin/item-1', 'hobkin/item-2']);
});
