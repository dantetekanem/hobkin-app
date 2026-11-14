import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declineItem, deleteItemBranch } from '../src/cli/work/controls.mjs';
import { chooseProject, fileItem, itemTree, readItems, updateItem, workName, writeOwnerView } from '../src/cli/work/store.mjs';
import { folderRefusal, leaveFolder, releaseTree, retireTree } from '../src/cli/work/tree.mjs';
import { commit, git, repository, withOrigin } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const brief = 'Evidence, who benefits, the first change, the proof.';

/** A real project on this Mac, `api`, with a local bare repository as its origin unless a test says otherwise. */
function workspace(t, { origin = true } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-delete-branch-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  mkdirSync(root);
  const checkout = repository(base, 'api');
  const remote = origin ? withOrigin(base, checkout) : null;
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout, remote };
}

/**
 * A finished item as work mode leaves one: its run worked in its own tree on its own `hobkin/` branch, made two commits, and the tree let go
 * of the branch once the run ended. `pushed` puts the branch on origin, as approving it does.
 */
function finished(h, { title = 'Fix the job spec', pushed = false } = {}) {
  const filed = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief }, NOW);
  const branch = `hobkin/${workName(filed)}`;
  const tree = itemTree(h.root, 'api', filed);
  git(h.checkout, 'worktree', 'add', '-q', '-b', branch, tree, 'main');
  commit(tree, 'job.txt', 'first fix\n');
  commit(tree, 'job.txt', 'second fix\n');
  if (pushed) git(tree, 'push', '-q', 'origin', branch);
  const item = updateItem(h.root, 'api', filed.id, { state: 'branch', branch }, NOW);
  return { item, branch, tree };
}

const branches = checkout => git(checkout, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean).sort();
const onOrigin = (remote, branch) => git(remote, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${branch}`);
const tip = (checkout, branch) => git(checkout, 'rev-parse', `refs/heads/${branch}`);

test('deleting a finished item\'s branch shows first what it takes, and then takes exactly that: its worktree, the branch here and on origin', async t => {
  const h = workspace(t);
  const { item, branch, tree } = finished(h, { pushed: true });
  await releaseTree(tree, { finished: true });
  // A copy of the branch's first commit that hobkin kept aside: another branch, never deleted, and what it holds is not lost.
  git(h.checkout, 'branch', `${branch}-kept-20260601-120000`, `${branch}~1`);
  const before = branches(h.checkout);

  const { plan } = await deleteItemBranch(h.root, 'api', item.id, { look: true });
  assert.deepEqual(plan, {
    branch,
    here: tip(h.checkout, branch),
    remote: { name: 'origin', url: h.remote, sha: tip(h.checkout, branch) },
    worktree: realpathSync(tree),
    ignored: [],
    lost: 1,
  });
  assert.deepEqual(branches(h.checkout), before, 'a look deletes nothing');
  assert.equal(existsSync(tree), true);

  // hobkin's no comes first, as the review does it: the branch of a declined item can still go.
  declineItem(h.root, 'api', item.id, NOW);
  const { message } = await deleteItemBranch(h.root, 'api', item.id, { expect: plan });
  assert.equal(message, `Deleted ${branch} on this Mac and on origin, and removed its worktree.`);
  assert.deepEqual(branches(h.checkout), before.filter(name => name !== branch), 'every other branch stays, the kept copy and main with them');
  assert.equal(onOrigin(h.remote, branch), '');
  assert.equal(git(h.remote, 'rev-parse', 'refs/heads/main'), git(h.checkout, 'rev-parse', 'main'), 'main on origin is untouched');
  assert.equal(existsSync(tree), false);
  assert.equal(git(h.checkout, 'worktree', 'list', '--porcelain').includes(tree), false, 'git keeps no entry for the tree');
});

test('a branch only on this Mac, held by its tree, is deleted with that tree and nothing is pushed', async t => {
  const h = workspace(t, { origin: false });
  const { item, branch, tree } = finished(h);

  const { plan } = await deleteItemBranch(h.root, 'api', item.id, { look: true });
  assert.deepEqual([plan.remote, plan.worktree, plan.lost], [null, realpathSync(tree), 2]);
  const { message } = await deleteItemBranch(h.root, 'api', item.id, { expect: plan });
  assert.equal(message, `Deleted ${branch} on this Mac, and removed its worktree.`);
  assert.deepEqual(branches(h.checkout), ['main']);
  assert.equal(existsSync(tree), false);
});

test('nothing is deleted without the look that named it, or once what it would take has changed since', async t => {
  const h = workspace(t);
  const { item, branch, tree } = finished(h, { pushed: true });
  const { plan } = await deleteItemBranch(h.root, 'api', item.id, { look: true });

  await assert.rejects(deleteItemBranch(h.root, 'api', item.id), /changed since it was shown, so nothing was deleted/);
  commit(tree, 'job.txt', 'a third fix\n');
  await assert.rejects(deleteItemBranch(h.root, 'api', item.id, { expect: plan }), new RegExp(`^Error: What deleting ${branch} takes has changed since it was shown, so nothing was deleted\\.$`));
  assert.equal(branches(h.checkout).includes(branch), true);
  assert.notEqual(onOrigin(h.remote, branch), '');
  assert.equal(existsSync(tree), true);
});

test('it refuses, before anything is deleted, a running item, one with no branch or another\'s, and a branch the user\'s own folder holds', async t => {
  const h = workspace(t);
  const refused = async (id, pattern) => {
    const before = branches(h.checkout);
    await assert.rejects(deleteItemBranch(h.root, 'api', id, { look: true }), pattern);
    assert.deepEqual(branches(h.checkout), before);
  };

  const running = finished(h, { title: 'Running now' });
  writeOwnerView(h.root, { running: [{ id: 'work:api:do:1', slug: 'api', item: running.item.id, lane: 'do', title: 'api: Running now' }] });
  writeFileSync(join(h.root, 'runtime.lock'), '');
  await refused(running.item.id, /^Error: "Running now" is running, so its branch cannot be deleted now\.$/);
  writeOwnerView(h.root, { running: [] });

  const none = fileItem(h.root, 'api', { key: 'No branch', kind: 'fix', title: 'No branch', brief }, NOW);
  await refused(none.id, /^Error: "No branch" has no branch of its own, so there is nothing to delete\.$/);

  // A fix on another item's branch works on that branch, and the base branch is nobody's to delete.
  const fix = fileItem(h.root, 'api', { key: 'Fix its PR', kind: 'fix', title: 'Fix its PR', brief }, NOW);
  updateItem(h.root, 'api', fix.id, { state: 'branch', branch: running.branch }, NOW);
  await refused(fix.id, new RegExp(`^Error: ${running.branch} is not the branch "Fix its PR" made for itself, so it is not deleted\\.$`));
  updateItem(h.root, 'api', fix.id, { branch: 'main' }, NOW);
  await refused(fix.id, /^Error: main is not the branch "Fix its PR" made for itself, so it is not deleted\.$/);

  // Its own branch, while a fix that is not finished works on it too.
  updateItem(h.root, 'api', fix.id, { state: 'open', branch: running.branch }, NOW);
  await refused(running.item.id, new RegExp(`^Error: "Fix its PR" works on ${running.branch} too, so it is not deleted\\.$`));
  updateItem(h.root, 'api', fix.id, { state: 'dropped' }, NOW);

  // Checked out in the project's own folder: the user's checkout is never touched.
  git(running.tree, 'switch', '-q', '--detach');
  git(h.checkout, 'switch', '-q', running.branch);
  await refused(running.item.id, new RegExp(`^Error: ${running.branch} is checked out in the project's own folder, ${h.checkout}, so it is not deleted\\. Switch that folder to another branch first\\.$`));
  git(h.checkout, 'switch', '-q', 'main');

  // Checked out in a worktree the user made: theirs too.
  const theirs = join(h.base, 'my-worktree');
  git(h.checkout, 'worktree', 'add', '-q', theirs, running.branch);
  await refused(running.item.id, new RegExp(`^Error: ${running.branch} is checked out in ${theirs}, a folder hobkin did not make, so it is not deleted\\.$`));
  assert.equal(existsSync(theirs), true);
});

test('a worktree holding uncommitted work, or a branch already gone, is refused with nothing deleted', async t => {
  const h = workspace(t);
  const { item, branch, tree } = finished(h);
  writeFileSync(join(tree, 'job.txt'), 'not committed\n');
  await assert.rejects(deleteItemBranch(h.root, 'api', item.id, { look: true }), new RegExp(`^Error: Its worktree at ${realpathSync(tree)} has changes that were never committed, so nothing is deleted\\.$`));
  assert.equal(existsSync(join(tree, 'job.txt')), true);

  git(tree, 'checkout', '-q', '--', 'job.txt');
  git(tree, 'switch', '-q', '--detach', 'main');
  git(h.checkout, 'branch', '-q', '-D', branch);
  await assert.rejects(deleteItemBranch(h.root, 'api', item.id, { look: true }), new RegExp(`^Error: ${branch} is gone already, on this Mac and on origin, so there is nothing to delete\\.$`));
});

test('a step that fails says what was already done and what was not, and stops there', async t => {
  const h = workspace(t);
  const { item, branch, tree } = finished(h, { pushed: true });
  await releaseTree(tree, { finished: true });
  // Origin refuses to delete any branch.
  git(h.remote, 'config', 'receive.denyDeletes', 'true');
  const { plan } = await deleteItemBranch(h.root, 'api', item.id, { look: true });

  await assert.rejects(
    deleteItemBranch(h.root, 'api', item.id, { expect: plan }),
    new RegExp(`^Error: Removed its worktree and deleted ${branch} on this Mac, but it was not deleted on origin: remote: error: denying ref deletion for refs/heads/${branch}$`),
  );
  assert.equal(branches(h.checkout).includes(branch), false);
  assert.equal(existsSync(tree), false);
  assert.notEqual(onOrigin(h.remote, branch), '', 'what origin refused stays there');
  assert.equal(readItems(h.root, 'api').find(entry => entry.id === item.id).branch, branch, 'the item keeps the name of its branch');
});

test('what git ignores in its tree is named in what deleting it takes, so the preview says it goes and the token covers it', async t => {
  const h = workspace(t);
  const { item, tree } = finished(h);
  commit(tree, '.gitignore', '.env*\nbuild/\n');
  writeFileSync(join(tree, '.env'), 'API_KEY=only-copy\n');
  mkdirSync(join(tree, 'build'));
  writeFileSync(join(tree, 'build', 'out.js'), 'built\n');
  await releaseTree(tree, { finished: true });

  const { plan } = await deleteItemBranch(h.root, 'api', item.id, { look: true });
  assert.deepEqual(plan.ignored, ['.env', 'build/']);
  // Another ignored file since the look is more than was shown, so nothing goes.
  writeFileSync(join(tree, '.env.local'), 'API_KEY=another\n');
  await assert.rejects(deleteItemBranch(h.root, 'api', item.id, { expect: plan }), /changed since it was shown, so nothing was deleted/);
  assert.equal(existsSync(join(tree, '.env')), true);
});

test('an untracked file the project hides from git status is still work never committed: its tree is refused and never removed', async t => {
  const h = workspace(t);
  const { item, tree } = finished(h);
  git(h.checkout, 'config', 'status.showUntrackedFiles', 'no');
  writeFileSync(join(tree, 'notes.txt'), 'never committed\n');

  await assert.rejects(deleteItemBranch(h.root, 'api', item.id, { look: true }), new RegExp(`^Error: Its worktree at ${realpathSync(tree)} has changes that were never committed, so nothing is deleted\\.$`));
  // Taking a tree away asks the same, whoever asks.
  git(tree, 'switch', '-q', '--detach');
  assert.equal(await retireTree({ repo: h.checkout, tree }), false);
  assert.equal(existsSync(join(tree, 'notes.txt')), true);
});

test('a commit only a stale remote-tracking branch still names counts as lost: only this Mac\'s branches and tags keep one', async t => {
  const h = workspace(t);
  const { item, branch } = finished(h);
  // Pushed once under another name, deleted on origin since, and never pruned here.
  git(h.checkout, 'update-ref', 'refs/remotes/origin/old-copy', branch);

  const { plan } = await deleteItemBranch(h.root, 'api', item.id, { look: true });
  assert.equal(plan.lost, 2);
});

test('a project that hides untracked files from git status still has them kept, held and seen by every step of its trees and folder', async t => {
  const h = workspace(t);
  git(h.checkout, 'config', 'status.showUntrackedFiles', 'no');

  // A finished run's tree keeps what it left on a side branch, an untracked file too.
  const done = finished(h, { title: 'Finished run' });
  writeFileSync(join(done.tree, 'left.txt'), 'left behind\n');
  await releaseTree(done.tree, { finished: true });
  const kept = git(h.checkout, 'branch', '--list', `${done.branch}-kept-*`, '--format=%(refname:short)');
  assert.notEqual(kept, '');
  assert.equal(git(h.checkout, 'show', `${kept}:left.txt`), 'left behind');

  // A run cut short keeps its tree on its branch, with the file in it for the next run.
  const cut = finished(h, { title: 'Cut short' });
  writeFileSync(join(cut.tree, 'half.txt'), 'half done\n');
  await releaseTree(cut.tree);
  assert.equal(git(cut.tree, 'branch', '--show-current'), cut.branch);

  // The project's own folder holding such a file is not taken for a run, and one a run leaves it in stays on the run's branch.
  writeFileSync(join(h.checkout, 'mine.txt'), 'the user\'s\n');
  assert.equal(await folderRefusal(h.checkout), 'it has uncommitted changes');
  rmSync(join(h.checkout, 'mine.txt'));
  git(h.checkout, 'switch', '-q', '-c', 'hobkin/run');
  writeFileSync(join(h.checkout, 'left.txt'), 'the run\'s\n');
  assert.deepEqual(await leaveFolder({ repo: h.checkout, branch: 'hobkin/run', base: 'main' }), { stays: 'it has uncommitted changes' });
});
