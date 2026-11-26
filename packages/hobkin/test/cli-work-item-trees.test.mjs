import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { retireClosedTrees } from '../src/cli/work/closing.mjs';
import { markDone } from '../src/cli/work/controls.mjs';
import { fileItem, itemTree, paths, updateItem } from '../src/cli/work/store.mjs';
import { prepareTree, releaseTree } from '../src/cli/work/tree.mjs';
import { director, HOUR, studied } from './helpers/work-director.mjs';
import { git } from './helpers/work-fixture.mjs';

const brief = 'Evidence, who benefits, the first change, the proof.';
const item = title => ({ key: title, kind: 'fix', title, brief, impact: 'high', effort: 'small' });
// A file of the user's in the folder sends every run to a worktree.
const dirtyFolder = checkout => writeFileSync(join(checkout, 'notes.txt'), 'mine\n');
const keptFrom = (checkout, branch) => git(checkout, 'branch', '--list', `${branch}-kept-*`, '--format=%(refname:short)');
const oldDoTree = h => join(paths(h.root, 'api').trees, 'do');
const halfDone = tree => readFileSync(join(tree, 'half.txt'), 'utf8');

function worktrees(checkout) {
  const listed = git(checkout, 'worktree', 'list', '--porcelain').split('\n');
  return listed.filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length));
}

/** Two items on one project whose runs each leave work uncommitted and record nothing, so each tree keeps its own. */
async function twoCutShort(t) {
  const h = director(t);
  const checkout = studied(h, 'api');
  dirtyFolder(checkout);
  const login = fileItem(h.root, 'api', item('Fix the login'), h.clock);
  const csv = fileItem(h.root, 'api', item('Speed up the CSV export'), h.clock);
  h.seen = [];
  h.agent = request => {
    const { title } = h.work(request).item;
    h.seen.push({
      title,
      cwd: request.cwd,
      branch: git(request.cwd, 'branch', '--show-current'),
    });
    writeFileSync(join(request.cwd, 'half.txt'), `${title}, half done\n`);
  };

  await h.tick();
  await h.tick();

  return { h, checkout, login, csv };
}

test('each item works in a tree of its own, named like its branch, and one never touches another\'s', async t => {
  const { h, checkout, login, csv } = await twoCutShort(t);
  const { trees } = paths(h.root, 'api');
  const loginName = `${login.id}-fix-the-login`;
  const csvName = `${csv.id}-speed-up-the-csv-export`;

  assert.deepEqual(h.seen, [
    { title: 'Fix the login', cwd: join(trees, loginName), branch: `hobkin/${loginName}` },
    { title: 'Speed up the CSV export', cwd: join(trees, csvName), branch: `hobkin/${csvName}` },
  ]);
  const [first] = h.seen;
  assert.equal(git(first.cwd, 'branch', '--show-current'), first.branch, 'the second run left the first one\'s tree alone');
  assert.equal(halfDone(first.cwd), 'Fix the login, half done\n');
  assert.equal(keptFrom(checkout, first.branch), '', 'nothing had to be moved out of its way');
  assert.equal(existsSync(oldDoTree(h)), false);
});

test('an item cut short finds its own tree again, with its work in it, after another item ran', async t => {
  const { h, login } = await twoCutShort(t);
  let found;
  h.agent = request => {
    found = {
      title: h.work(request).item.title,
      cwd: request.cwd,
      half: halfDone(request.cwd),
    };
  };
  h.clock += HOUR;

  await h.tick();

  assert.deepEqual(found, {
    title: 'Fix the login',
    cwd: itemTree(h.root, 'api', login),
    half: 'Fix the login, half done\n',
  });
});

test('an item cut short in the one tree every item used to share carries on there, with its work', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  dirtyFolder(checkout);
  const filed = fileItem(h.root, 'api', item('Fix the login'), h.clock);
  const branch = `hobkin/${filed.id}-fix-the-login`;
  await prepareTree({ repo: checkout, tree: oldDoTree(h), branch });
  writeFileSync(join(oldDoTree(h), 'half.txt'), 'half done\n');
  updateItem(h.root, 'api', filed.id, { state: 'doing', branch }, h.clock);
  let found;
  h.agent = request => {
    found = { cwd: request.cwd, half: halfDone(request.cwd) };
  };

  await h.tick();

  assert.deepEqual(found, { cwd: oldDoTree(h), half: 'half done\n' });
});

/** A tree as a finished run leaves it: its commit on its own branch, and the tree let go of that branch. */
async function finishedTree(checkout, tree) {
  await prepareTree({ repo: checkout, tree, branch: `hobkin/${basename(tree)}` });
  writeFileSync(join(tree, `${basename(tree)}.txt`), 'the agent\n');
  git(tree, 'add', '.');
  git(tree, 'commit', '-qm', 'agent work');
  await releaseTree(tree, { finished: true });
  return tree;
}

test('a closed item\'s tree goes once nothing in it could be lost, and one still holding work stays', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  const merged = fileItem(h.root, 'api', item('Fix the login'), h.clock);
  const declined = fileItem(h.root, 'api', item('Rename the API'), h.clock);
  const open = fileItem(h.root, 'api', item('Speed up the CSV export'), h.clock);
  const gone = await finishedTree(checkout, itemTree(h.root, 'api', merged));
  const holding = await finishedTree(checkout, itemTree(h.root, 'api', declined));
  const waiting = await finishedTree(checkout, itemTree(h.root, 'api', open));
  writeFileSync(join(holding, 'app.txt'), 'changed and never committed\n');
  updateItem(h.root, 'api', merged.id, { state: 'merged' }, h.clock);
  updateItem(h.root, 'api', declined.id, { state: 'declined' }, h.clock);

  const retired = await retireClosedTrees(h.root);

  assert.deepEqual(retired, [{ slug: 'api', tree: gone }]);
  assert.deepEqual(worktrees(checkout).toSorted(), [checkout, holding, waiting].toSorted(), 'git keeps no record of the one that went');
  assert.equal(git(checkout, 'log', '-1', '--format=%s', `hobkin/${basename(gone)}`), 'agent work', 'its branch stays');
  assert.equal(readFileSync(join(holding, 'app.txt'), 'utf8'), 'changed and never committed\n');
});

test('a closed item that is still running keeps its tree until its run ends', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  const filed = fileItem(h.root, 'api', item('Fix the login'), h.clock);
  const tree = await finishedTree(checkout, itemTree(h.root, 'api', filed));
  updateItem(h.root, 'api', filed.id, { state: 'merged' }, h.clock);
  const itsRun = { slug: 'api', lane: 'do', item: filed.id, cwd: tree, tree };

  await retireClosedTrees(h.root, { running: [itsRun] });
  assert.equal(existsSync(tree), true);

  await retireClosedTrees(h.root);
  assert.equal(existsSync(tree), false);
});

test('the tree every item used to share goes once no run could use it, and only when nothing in it could be lost', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  await prepareTree({ repo: checkout, tree: oldDoTree(h) });
  const doRun = { slug: 'api', lane: 'do', item: 'abc123' };
  const lookRun = { slug: 'api', lane: 'look' };

  await retireClosedTrees(h.root, { running: [doRun] });
  assert.equal(existsSync(oldDoTree(h)), true, 'a do run going on the project may be about to carry on there');

  await retireClosedTrees(h.root, { running: [lookRun] });
  assert.deepEqual(worktrees(checkout), [checkout]);
});

test('the tree every item used to share stays while it holds work', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  await prepareTree({ repo: checkout, tree: oldDoTree(h), branch: 'hobkin/abc123-fix' });
  writeFileSync(join(oldDoTree(h), 'half.txt'), 'half done\n');

  await retireClosedTrees(h.root);

  assert.equal(git(oldDoTree(h), 'branch', '--show-current'), 'hobkin/abc123-fix');
  assert.equal(halfDone(oldDoTree(h)), 'half done\n');
});

test('work mode\'s survey takes away the tree of an item that closed since the last one', async t => {
  const h = director(t);
  const checkout = studied(h, 'api');
  dirtyFolder(checkout);
  const filed = fileItem(h.root, 'api', item('Fix the login'), h.clock);
  h.agent = request => {
    writeFileSync(join(request.cwd, 'login.txt'), 'fixed\n');
    git(request.cwd, 'add', 'login.txt');
    git(request.cwd, 'commit', '-qm', 'Fix the login');
    updateItem(h.root, 'api', filed.id, { state: 'branch' }, h.clock);
  };
  await h.tick();
  const tree = itemTree(h.root, 'api', filed);
  assert.equal(existsSync(tree), true, 'finished work waiting on the user keeps its tree');

  markDone(h.root, 'api', filed.id);
  h.clock += HOUR;
  await h.tick();

  assert.deepEqual(worktrees(checkout), [checkout]);
  assert.equal(git(checkout, 'log', '-1', '--format=%s', `hobkin/${basename(tree)}`), 'Fix the login');
});
