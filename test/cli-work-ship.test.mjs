import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setGrade, syncWork } from '../src/cli/work/controls.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, readItems, updateItem } from '../src/cli/work/store.mjs';
import { pendingMerges, surveyUnmerged, unmergedNow } from '../src/cli/work/unmerged.mjs';
import { branched, commit, git, pull, repository, withOrigin } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-06-01T12:00:00Z');
const FAILING = { statusCheckRollup: [{ conclusion: 'FAILURE' }] };
// Far enough apart that a change at each end merges cleanly.
const LINES = Array.from({ length: 40 }, (_line, index) => `line ${index}\n`);

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-ship-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout };
}

const moveMain = (checkout, text = 'main moved\n') => commit(checkout, 'app.txt', text);

/** The branch and `main` each change the one line of the same file. */
function conflicted(h, name = 'hobkin/abc') {
  branched(h.checkout, name, 'app.txt');
  moveMain(h.checkout);
}

/** `main` took an early version of the branch, and the branch took `main` from before that, so they have two merge bases. */
function crissCrossed({ checkout }) {
  branched(checkout, 'hobkin/crossed', 'crossed.txt', 'crossed\n');
  commit(checkout, 'other.txt', 'other\n');
  git(checkout, 'switch', '-q', 'hobkin/crossed');
  git(checkout, 'merge', '-q', '--no-ff', '--no-edit', 'main');
  git(checkout, 'switch', '-q', 'main');
  git(checkout, 'merge', '-q', '--no-ff', '--no-edit', 'hobkin/crossed~1');
}

const survey = (h, pulls = [], now = NOW) => surveyUnmerged(h.root, { now, gh: async () => JSON.stringify(pulls) });
const unit = ({ projects }, name) => projects.api.open.find(({ branch }) => branch === name);
const fixes = h => readItems(h.root, 'api').filter(item => item.kind === 'pr-fix');
const finish = (h, { id }) => updateItem(h.root, 'api', id, { state: 'done' }, NOW);

function itemOn(h, branch, state = 'branch', at = NOW) {
  const key = `work ${readItems(h.root, 'api').length}`;
  const { id } = fileItem(h.root, 'api', { key, kind: 'fix', title: key, brief: 'Evidence and first change.' }, NOW);
  return updateItem(h.root, 'api', id, { state, branch }, at);
}

test('hobkin work sync says what it filed to get work ready to merge', async t => {
  const h = workspace(t);
  conflicted(h);
  itemOn(h, 'hobkin/abc');

  const { message, filed } = await syncWork(h.root);

  assert.deepEqual(filed.map(({ branch }) => branch), ['hobkin/abc']);
  assert.match(message, /1 branch to get ready to merge/);
});

test('clearing a grade reports the grade the queue really gives it on a project with plenty to merge', async t => {
  const h = workspace(t);
  for (const index of [1, 2, 3, 4, 5]) {
    branched(h.checkout, `hobkin/${index}`);
    itemOn(h, `hobkin/${index}`);
  }
  await survey(h);
  const { id } = fileItem(h.root, 'api', { key: 'idea:csv', kind: 'feature', title: 'CSV import', brief: 'Wanted.', impact: 'high' });

  assert.match(setGrade(h.root, 'api', id, 'auto').message, /is now P2/);
});

test('a branch says how many commits of the default branch it lacks, and that it still merges', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc');
  commit(h.checkout, 'other.txt', 'one\n');
  commit(h.checkout, 'other.txt', 'two\n');

  const { behind, conflict } = unit(await survey(h), 'hobkin/abc');

  assert.deepEqual({ behind, conflict }, { behind: 2, conflict: false });
});

test('a branch that changed what the default branch changed is a conflict, and an up to date one lacks nothing', async t => {
  const h = workspace(t);
  conflicted(h);
  branched(h.checkout, 'hobkin/current');

  const found = await survey(h);

  assert.deepEqual([unit(found, 'hobkin/abc').behind, unit(found, 'hobkin/abc').conflict], [1, true]);
  assert.deepEqual([unit(found, 'hobkin/current').behind, unit(found, 'hobkin/current').conflict], [0, false]);
});

test('a branch is judged against what it will land on: the remote when the checkout lags, the checkout when it has merges not pushed', async t => {
  const h = workspace(t);
  withOrigin(h.base, h.checkout);
  branched(h.checkout, 'hobkin/abc', 'app.txt');
  moveMain(h.checkout);
  git(h.checkout, 'push', '-q', 'origin', 'main');
  git(h.checkout, 'reset', '-q', '--hard', 'HEAD~1');

  const lagging = unit(await survey(h), 'hobkin/abc');
  assert.deepEqual([lagging.behind, lagging.conflict], [1, true]);

  git(h.checkout, 'merge', '-q', '--ff-only', 'origin/main');
  commit(h.checkout, 'other.txt', 'not pushed\n');

  assert.equal(unit(await survey(h), 'hobkin/abc').behind, 2);
});

test('what git cannot judge stays unknown, and the survey carries on', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc');
  git(h.checkout, 'switch', '-q', '--orphan', 'hobkin/island');
  commit(h.checkout, 'island.txt', 'no shared history\n');
  git(h.checkout, 'switch', '-q', 'main');

  const found = await survey(h);

  assert.equal(unit(found, 'hobkin/island').conflict, null);
  assert.equal(unit(found, 'hobkin/abc').conflict, false);
  assert.deepEqual(found.filed, []);
});

test('with no default branch known a checked-out hobkin branch judges nothing, so nothing is said and nothing is filed', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/two', 'app.txt');
  git(h.checkout, 'branch', '-qm', 'main', 'trunk');
  git(h.checkout, 'switch', '-qc', 'hobkin/one');
  commit(h.checkout, 'app.txt', 'hobkin/one\n');

  const found = await survey(h);

  assert.deepEqual([unit(found, 'hobkin/two').behind, unit(found, 'hobkin/two').conflict], [null, null]);
  assert.deepEqual(found.filed, []);
});

test('a branch with two merge bases still gets a real answer', async t => {
  const h = workspace(t);
  crissCrossed(h);
  assert.equal(git(h.checkout, 'merge-base', '--all', 'main', 'hobkin/crossed').split('\n').length, 2);

  const { behind, conflict } = unit(await survey(h), 'hobkin/crossed');

  assert.deepEqual({ behind, conflict }, { behind: 1, conflict: false });
});

test('working all of this out writes nothing to the repository, not even an object, whatever shape the merge takes', async t => {
  const h = workspace(t);
  commit(h.checkout, 'long.txt', LINES.join(''));
  crissCrossed(h);
  conflicted(h);
  branched(h.checkout, 'hobkin/clean');
  branched(h.checkout, 'hobkin/same-file', 'long.txt', ['changed\n', ...LINES.slice(1)].join(''));
  commit(h.checkout, 'long.txt', [...LINES.slice(0, -1), 'main changed\n'].join(''));
  const seen = () => [
    git(h.checkout, 'for-each-ref'),
    git(h.checkout, 'status', '--porcelain'),
    git(h.checkout, 'rev-parse', 'HEAD'),
    readdirSync(join(h.checkout, '.git', 'objects'), { recursive: true }).toSorted(),
  ];
  const before = seen();

  await survey(h);

  assert.deepEqual(seen(), before);
});

test('a PR says whether it can merge, as gh gives it, and gh is asked for that', async t => {
  const h = workspace(t);
  let asked;
  const gh = async args => {
    asked = args.at(-1).split(',');
    return JSON.stringify([pull(1, { mergeable: 'CONFLICTING' }), pull(2), pull(3, { mergeable: 'UNKNOWN' }), pull(4, { mergeable: undefined })]);
  };

  const { projects } = await surveyUnmerged(h.root, { now: NOW, gh });

  assert.ok(asked.includes('mergeable'));
  assert.deepEqual(projects.api.open.map(({ mergeable, conflict }) => [mergeable, conflict]), [
    ['CONFLICTING', true], ['MERGEABLE', false], ['UNKNOWN', null], ['UNKNOWN', null],
  ]);
});

test('a branch with no item files nothing, because no item says it was ever finished', async t => {
  const h = workspace(t);
  conflicted(h, 'hobkin/forgotten');

  const { filed } = await survey(h, [pull(1, FAILING), pull(2, { mergeable: 'CONFLICTING' })]);

  assert.deepEqual(filed, []);
  assert.deepEqual(fixes(h), []);
});

test('a conflict files one pr-fix item that works on that same branch', async t => {
  const h = workspace(t);
  conflicted(h);
  itemOn(h, 'hobkin/abc');

  const { filed } = await survey(h);

  assert.equal(fixes(h).length, 1);
  const [{ id, kind, title, brief, impact, effort, branch, state }] = fixes(h);
  assert.deepEqual({ kind, title, impact, effort, branch, state }, {
    kind: 'pr-fix', title: 'Rebase hobkin/abc onto main', impact: 'high', effort: 'small', branch: 'hobkin/abc', state: 'open',
  });
  assert.match(brief, /hobkin\/abc conflicts with main/);
  assert.deepEqual(filed, [{ slug: 'api', id, title, branch }]);
});

test('a repeat survey files nothing, while the fix is open and after it has finished', async t => {
  const h = workspace(t);
  conflicted(h);
  itemOn(h, 'hobkin/abc');
  await survey(h);

  assert.deepEqual((await survey(h, [], NOW + HOUR)).filed, []);

  finish(h, fixes(h)[0]);
  assert.deepEqual((await survey(h, [], NOW + 2 * HOUR)).filed, []);
  assert.deepEqual((await survey(h, [], NOW + 2 * DAY)).filed, [], 'the same trouble on the same default branch is not new, however long it has been');
  assert.equal(fixes(h).length, 1);
});

test('a conflict after a newer default branch files a fresh fix a day on, once the last one is no longer open', async t => {
  const h = workspace(t);
  conflicted(h);
  itemOn(h, 'hobkin/abc');
  await survey(h);
  const [first] = fixes(h);

  moveMain(h.checkout, 'main moved again\n');
  assert.deepEqual((await survey(h, [], NOW + DAY)).filed, [], 'one is already open for this branch');

  finish(h, first);
  const { filed } = await survey(h, [], NOW + DAY + HOUR);

  assert.equal(filed.length, 1);
  assert.notEqual(filed[0].id, first.id);
  assert.equal(readItems(h.root, 'api').find(item => item.id === filed[0].id).branch, 'hobkin/abc');
});

test('a branch gets one fix a day however often the default branch moves, so one given up on cannot take a run for every commit', async t => {
  const h = workspace(t);
  conflicted(h);
  itemOn(h, 'hobkin/abc');
  await survey(h);
  const [first] = fixes(h);

  for (const hour of [1, 2, 3, 4, 5, 23]) {
    finish(h, fixes(h).at(-1));
    moveMain(h.checkout, `main at hour ${hour}\n`);
    assert.deepEqual((await survey(h, [], NOW + hour * HOUR)).filed, [], `hour ${hour}`);
  }
  assert.deepEqual(fixes(h), [{ ...first, state: 'done', updatedAt: fixes(h)[0].updatedAt }]);

  moveMain(h.checkout, 'main a day on\n');
  assert.equal((await survey(h, [], NOW + DAY)).filed.length, 1, 'a day later it gets another go');
  assert.equal(fixes(h).length, 2);
});

test('one branch\'s fix today does not hold back another branch', async t => {
  const h = workspace(t);
  conflicted(h);
  itemOn(h, 'hobkin/abc');
  await survey(h);

  branched(h.checkout, 'hobkin/other', 'app.txt', 'other\n');
  itemOn(h, 'hobkin/other');
  moveMain(h.checkout, 'main moved again\n');
  const { filed } = await survey(h, [], NOW + HOUR);

  assert.deepEqual(filed.map(({ branch }) => branch), ['hobkin/other']);
});

test('a PR with failing CI files one fix on its branch', async t => {
  const h = workspace(t);
  const pulls = [pull(1, FAILING)];
  itemOn(h, 'hobkin/1-fix', 'pr');

  const { filed } = await survey(h, pulls);
  const [{ title, brief, branch, kind, impact, effort }] = fixes(h);

  assert.deepEqual({ title, branch, kind, impact, effort }, { title: 'Fix CI on hobkin/1-fix', branch: 'hobkin/1-fix', kind: 'pr-fix', impact: 'high', effort: 'small' });
  assert.match(brief, /CI is failing on hobkin\/1-fix/);
  assert.equal(filed.length, 1);
  assert.deepEqual((await survey(h, pulls, NOW + HOUR)).filed, []);
});

test('a PR that gh says conflicts files a rebase, and one that also fails CI files only that, because a rebase runs CI again', async t => {
  const h = workspace(t);
  itemOn(h, 'hobkin/1-fix', 'pr');
  itemOn(h, 'hobkin/2-fix', 'pr');

  await survey(h, [pull(1, { mergeable: 'CONFLICTING' }), pull(2, { mergeable: 'CONFLICTING', ...FAILING })]);

  assert.deepEqual(fixes(h).map(({ title }) => title), ['Rebase hobkin/1-fix onto main', 'Rebase hobkin/2-fix onto main']);
});

test('work with nothing wrong files nothing: passing or pending CI, an unknown answer, or a branch that merely lags', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/behind');
  moveMain(h.checkout);

  const { filed } = await survey(h, [pull(1), pull(2, { statusCheckRollup: [{ status: 'IN_PROGRESS' }] }), pull(3, { mergeable: 'UNKNOWN', statusCheckRollup: [] })]);

  assert.deepEqual(filed, []);
  assert.deepEqual(fixes(h), []);
});

test('the user\'s own branches file nothing, whatever is wrong with them', async t => {
  const h = workspace(t);
  conflicted(h, 'feature/mine');

  const { filed } = await survey(h, [pull(1, { headRefName: 'feature/theirs', mergeable: 'CONFLICTING', ...FAILING })]);

  assert.deepEqual(filed, []);
  assert.deepEqual(readItems(h.root, 'api'), []);
});

test('a branch still being worked on files nothing, because its own run gets there', async t => {
  const h = workspace(t);
  conflicted(h);
  const unfinished = itemOn(h, 'hobkin/abc', 'doing');

  assert.deepEqual((await survey(h)).filed, []);

  updateItem(h.root, 'api', unfinished.id, { state: 'open' }, NOW);
  assert.deepEqual((await survey(h, [], NOW + HOUR)).filed, []);
});

test('a branch given up on files nothing, so no tokens go on work nobody wants', async t => {
  const h = workspace(t);
  conflicted(h);
  const work = itemOn(h, 'hobkin/abc');

  for (const state of ['dropped', 'declined']) {
    updateItem(h.root, 'api', work.id, { state }, NOW);
    assert.deepEqual((await survey(h)).filed, [], state);
  }
});

test('a fix that was dropped does not count as the branch being given up, so a newer default branch can file again a day on', async t => {
  const h = workspace(t);
  conflicted(h);
  itemOn(h, 'hobkin/abc');
  await survey(h);

  updateItem(h.root, 'api', fixes(h)[0].id, { state: 'dropped' }, NOW);
  moveMain(h.checkout, 'main moved again\n');

  assert.equal((await survey(h, [], NOW + DAY)).filed.length, 1);
});

test('a fix names the item it ships, so its run can update that item\'s description', async t => {
  const h = workspace(t);
  conflicted(h);
  const work = itemOn(h, 'hobkin/abc');

  await survey(h);

  assert.equal(fixes(h)[0].ships, work.id);
});

test('a fix closes with its branch when the user merges it first, so no run is spent on work that landed', async t => {
  const h = workspace(t);
  conflicted(h);
  const work = itemOn(h, 'hobkin/abc');
  await survey(h);
  const [fix] = fixes(h);

  git(h.checkout, 'merge', '-q', '-X', 'ours', '--no-edit', 'hobkin/abc');
  const { settled, filed } = await survey(h, [], NOW + HOUR);

  const state = ({ id }) => readItems(h.root, 'api').find(item => item.id === id).state;
  assert.deepEqual([state(work), state(fix)], ['merged', 'merged']);
  assert.deepEqual(settled.map(({ state: closed }) => closed), ['merged', 'merged']);
  assert.deepEqual(filed, []);
});

test('finished work waits on a merge, but a branch with no item does not, nor one still being worked on or given up on', async t => {
  const h = workspace(t);
  const states = { finished: 'branch', sent: 'pr', running: 'doing', queued: 'open', dropped: 'dropped', declined: 'declined' };
  for (const [name, state] of Object.entries(states)) {
    branched(h.checkout, `hobkin/${name}`);
    itemOn(h, `hobkin/${name}`, state);
  }
  branched(h.checkout, 'hobkin/no-item');
  await survey(h);

  assert.deepEqual(pendingMerges(h.root, 'api').map(({ branch }) => branch).toSorted(), ['hobkin/finished', 'hobkin/sent']);
  assert.equal(unmergedNow(h.root).pending.api, 2);
  assert.equal(unmergedNow(h.root).perProject.api, 7, 'what is open still counts every branch');
});

test('a branch with only a fix on it has no maker, so nothing says it is finished', async t => {
  const h = workspace(t);
  conflicted(h);
  const { id } = fileItem(h.root, 'api', { key: 'ship:old', kind: 'pr-fix', title: 'Rebase hobkin/abc', brief: 'It conflicts.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'done', branch: 'hobkin/abc' }, NOW);

  assert.deepEqual((await survey(h, [], NOW + 2 * DAY)).filed, []);
  assert.deepEqual(pendingMerges(h.root, 'api'), []);
});

test('a branch with a fix running on it still waits on a merge', async t => {
  const h = workspace(t);
  conflicted(h);
  itemOn(h, 'hobkin/abc');
  await survey(h);

  updateItem(h.root, 'api', fixes(h)[0].id, { state: 'doing' }, NOW);

  assert.equal(pendingMerges(h.root, 'api').length, 1);
});

test('a project never surveyed has nothing pending', t => {
  const h = workspace(t);

  assert.deepEqual(pendingMerges(h.root, 'api'), []);
});

test('READY rows say how far behind they are and whether they conflict, and what can merge comes first, oldest first', async t => {
  const h = workspace(t);
  const finishedAt = (name, hoursAgo) => itemOn(h, `hobkin/${name}`, 'branch', NOW - hoursAgo * HOUR);
  branched(h.checkout, 'hobkin/conflict', 'app.txt');
  branched(h.checkout, 'hobkin/newer');
  branched(h.checkout, 'hobkin/older');
  moveMain(h.checkout);
  finishedAt('conflict', 90);
  finishedAt('newer', 1);
  finishedAt('older', 30);
  finishedAt('not-surveyed', 2);
  await survey(h);

  assert.deepEqual(readyItems(h.root).map(({ branch, behind, conflict }) => [branch, behind, conflict]), [
    ['hobkin/older', 1, false],
    ['hobkin/not-surveyed', null, null],
    ['hobkin/newer', 1, false],
    ['hobkin/conflict', 1, true],
  ]);
});

test('with no survey yet, READY keeps its rows and knows nothing about them', t => {
  const h = workspace(t);
  itemOn(h, 'hobkin/abc');

  const [{ behind, conflict }] = readyItems(h.root);

  assert.deepEqual({ behind, conflict }, { behind: null, conflict: null });
});
