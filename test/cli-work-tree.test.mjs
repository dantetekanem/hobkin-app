import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareTree } from '../src/cli/work/tree.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

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
  return { base, checkout, tree: join(base, 'trees/do') };
}

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

test('an interrupted item resumes on its own branch with its work kept', async t => {
  const { checkout, tree } = repository(t);
  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one' });
  writeFileSync(join(tree, 'app.txt'), 'in progress\n');

  await prepareTree({ repo: checkout, tree, branch: 'hobkin/one', resume: true });

  assert.equal(readFileSync(join(tree, 'app.txt'), 'utf8'), 'in progress\n');
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
