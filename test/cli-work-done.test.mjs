import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { initialize } from '../src/cli/config.mjs';
import { fillGaps } from '../src/cli/work/closing.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { askAgent, declineItem, markDone, mergeItem } from '../src/cli/work/controls.mjs';
import { readReviewGrades } from '../src/cli/work/grades.mjs';
import { closingItems, landingList, readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, prFile, readItems, updateItem } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, commit, git, pull, repository, withOrigin } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-done-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout, reviews: join(base, 'auto-review') };
}

function finished(h, branch, change = {}) {
  const key = `work ${readItems(h.root, 'api').length}`;
  const { id } = fileItem(h.root, 'api', { key, kind: 'fix', title: key, brief: 'Evidence and first change.' }, NOW);
  return updateItem(h.root, 'api', id, { state: 'branch', branch, ...change }, NOW);
}

function reviewed(h, head, grade = 'safe', rating = 'A', status = 'complete') {
  const folder = join(h.reviews, 'session');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${head.slice(0, 8)}.review.json`);
  writeFileSync(file, JSON.stringify({ status, preflight: { head }, grades: { merge: { grade, rating, reason: 'It reads well.' }, deploy: null } }));
  return file;
}

const tipOf = (h, name) => git(h.checkout, 'rev-parse', name);
const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: h.reviews });
const unit = (h, name) => readUnmerged(h.root).projects.api.open.find(({ branch }) => branch === name);
const row = (h, { id }) => readyItems(h.root).find(({ item }) => item === id);
const read = (h, { id }) => readItems(h.root, 'api').find(item => item.id === id);
const agentSays = (h, change) => runWorkCommand(h.root, ['item', 'api'], Readable.from([JSON.stringify(change)]));

test('only a finished review with a merge grade counts, and the newest for a commit wins', t => {
  const h = workspace(t);
  const older = reviewed(h, 'aaa111', 'risky', 'D');
  utimesSync(older, new Date(NOW - 3600000), new Date(NOW - 3600000));
  writeFileSync(join(h.reviews, 'session', 'newer.review.json'), JSON.stringify({ status: 'complete', preflight: { head: 'aaa111' }, grades: { merge: { grade: 'safe', rating: 'B', reason: 'Fixed.' } } }));
  reviewed(h, 'bbb222', 'safe', 'A', 'prepared');
  writeFileSync(join(h.reviews, 'session', 'broken.review.json'), '{ not json');

  const grades = readReviewGrades({ folder: h.reviews, now: NOW + 3600000 * 24 });

  assert.equal(grades.get('aaa111').grade, 'safe');
  assert.equal(grades.has('bbb222'), false);
});

test('a folder with no reviews has no grades', t => {
  const h = workspace(t);

  assert.equal(readReviewGrades({ folder: h.reviews }).size, 0);
});

test('a grade belongs to the exact commit it read, and a newer commit marks it out of date', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'app.txt');
  const item = finished(h, 'hobkin/abc');
  reviewed(h, tipOf(h, 'hobkin/abc'));

  await survey(h);
  assert.deepEqual({ ...row(h, item).safety, modified: undefined }, { grade: 'safe', rating: 'A', reason: 'It reads well.', modified: undefined });

  git(h.checkout, 'switch', '-q', 'hobkin/abc');
  commit(h.checkout, 'more.txt', 'more\n');
  git(h.checkout, 'switch', '-q', 'main');
  await survey(h);

  assert.equal(row(h, item).safety.stale, true);
});

test('a rebase that changes nothing keeps the grade', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc');
  reviewed(h, tipOf(h, 'hobkin/abc'));
  await survey(h);

  commit(h.checkout, 'other.txt', 'other\n');
  git(h.checkout, 'switch', '-q', 'hobkin/abc');
  git(h.checkout, 'rebase', '-q', 'main');
  git(h.checkout, 'switch', '-q', 'main');
  await survey(h);

  const { safety } = row(h, item);
  assert.equal(safety.grade, 'safe');
  assert.equal(safety.stale, undefined);
});

test('a branch of markdown alone says so, and one touching code does not', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/docs', 'GUIDE.md', '# Guide\n');
  branched(h.checkout, 'hobkin/code', 'app.txt');
  finished(h, 'hobkin/docs');
  finished(h, 'hobkin/code');

  await survey(h);

  assert.equal(unit(h, 'hobkin/docs').onlyDocs, true);
  assert.equal(unit(h, 'hobkin/code').onlyDocs, false);
});

test('a branch underneath another finished branch folds into it', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/first', 'first.txt', 'first\n');
  git(h.checkout, 'switch', '-q', 'hobkin/first');
  git(h.checkout, 'switch', '-q', '-c', 'hobkin/second');
  commit(h.checkout, 'second.txt', 'second\n');
  git(h.checkout, 'switch', '-q', 'main');
  const first = finished(h, 'hobkin/first');
  const second = finished(h, 'hobkin/second');

  await survey(h);

  assert.equal(row(h, first).gap, 'stacked');
  assert.equal(row(h, second).gap, 'land');
  assert.equal(row(h, second).holds, 1);
});

test('work already on another branch of the user says where, whether copied or merged', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/copied', 'copied.txt', 'copied\n');
  branched(h.checkout, 'hobkin/merged', 'merged.txt', 'merged\n');
  git(h.checkout, 'switch', '-q', '-c', 'release/now');
  git(h.checkout, 'cherry-pick', 'hobkin/copied');
  git(h.checkout, 'merge', '-q', '--no-ff', '--no-edit', 'hobkin/merged');
  git(h.checkout, 'switch', '-q', 'main');
  const copied = finished(h, 'hobkin/copied');
  const merged = finished(h, 'hobkin/merged');

  await survey(h);

  assert.equal(row(h, copied).gap, 'elsewhere');
  assert.equal(row(h, copied).landedOn, 'release/now');
  assert.equal(row(h, merged).landedOn, 'release/now');
});

test('a bulk landing holds only what a review rated safe A at its current commit, and says why the rest stays out', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/good', 'good.txt', 'good\n');
  branched(h.checkout, 'hobkin/medium', 'medium.txt', 'medium\n');
  branched(h.checkout, 'hobkin/changed', 'changed.txt', 'changed\n');
  branched(h.checkout, 'hobkin/never', 'never.txt', 'never\n');
  branched(h.checkout, 'hobkin/prep', 'prep.txt', 'prep\n');
  const good = finished(h, 'hobkin/good');
  finished(h, 'hobkin/medium');
  finished(h, 'hobkin/changed');
  finished(h, 'hobkin/never', { summary: 'Rated safe A by the author.' });
  finished(h, 'hobkin/prep', { title: 'Prepare HTTPS enforcement for the blog' });
  reviewed(h, tipOf(h, 'hobkin/good'));
  reviewed(h, tipOf(h, 'hobkin/medium'), 'medium', 'B');
  reviewed(h, tipOf(h, 'hobkin/changed'));
  reviewed(h, tipOf(h, 'hobkin/prep'));
  git(h.checkout, 'switch', '-q', 'hobkin/changed');
  commit(h.checkout, 'more.txt', 'more\n');
  git(h.checkout, 'switch', '-q', 'main');

  await survey(h);
  const { landable, leftOut } = landingList(h.root);

  assert.deepEqual(landable.map(({ item, head }) => [item, head]), [[good.id, tipOf(h, 'hobkin/good')]]);
  const why = Object.fromEntries(leftOut.map(({ title, why: reason }) => [title, reason]));
  assert.match(why['work 1'], /rated medium B/);
  assert.match(why['work 2'], /older commit/);
  assert.match(why['work 3'], /no grade/);
  assert.match(why['Prepare HTTPS enforcement for the blog'], /only a person/);
});

test('a branch rated A stays out when it brings along earlier work that is not', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/under', 'under.txt', 'under\n');
  git(h.checkout, 'switch', '-q', 'hobkin/under');
  git(h.checkout, 'switch', '-q', '-c', 'hobkin/over');
  commit(h.checkout, 'over.txt', 'over\n');
  git(h.checkout, 'switch', '-q', 'main');
  finished(h, 'hobkin/under');
  const over = finished(h, 'hobkin/over');
  reviewed(h, tipOf(h, 'hobkin/under'), 'medium', 'C');
  reviewed(h, tipOf(h, 'hobkin/over'));

  await survey(h);
  const { landable, leftOut } = landingList(h.root);

  assert.deepEqual(landable, []);
  assert.match(leftOut.find(({ item }) => item === over.id).why, /brings .*medium C/);
});

test('every branch on top of unrated work stays out, however many share it', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/under', 'under.txt', 'under\n');
  git(h.checkout, 'switch', '-q', 'hobkin/under');
  git(h.checkout, 'switch', '-q', '-c', 'hobkin/left');
  commit(h.checkout, 'left.txt', 'left\n');
  git(h.checkout, 'switch', '-q', 'hobkin/under');
  git(h.checkout, 'switch', '-q', '-c', 'hobkin/right');
  commit(h.checkout, 'right.txt', 'right\n');
  git(h.checkout, 'switch', '-q', 'main');
  finished(h, 'hobkin/under');
  finished(h, 'hobkin/left');
  finished(h, 'hobkin/right');
  reviewed(h, tipOf(h, 'hobkin/left'));
  reviewed(h, tipOf(h, 'hobkin/right'));

  await survey(h);

  assert.deepEqual(landingList(h.root).landable, []);
});

test('what only a person can do sits apart from what can merge', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/prep', 'NOTES.md', '# Steps\n');
  const item = finished(h, 'hobkin/prep', { title: 'Prepare HTTPS enforcement for the blog' });

  await survey(h);

  assert.equal(row(h, item).gap, 'yours');
});

test('the list starts with what is safest and smallest, and what cannot merge goes last', async t => {
  const h = workspace(t);
  const big = 'one\ntwo\nthree\nfour\nfive\nsix\n';
  branched(h.checkout, 'hobkin/risky', 'risky.txt', 'x\n');
  branched(h.checkout, 'hobkin/plain', 'plain.txt', 'x\n');
  branched(h.checkout, 'hobkin/large', 'large.txt', big);
  branched(h.checkout, 'hobkin/small', 'small.txt', 'x\n');
  branched(h.checkout, 'hobkin/stuck', 'app.txt');
  commit(h.checkout, 'app.txt', 'main moved\n');
  const names = ['risky', 'plain', 'large', 'small', 'stuck'];
  for (const name of names) finished(h, `hobkin/${name}`);
  reviewed(h, tipOf(h, 'hobkin/risky'), 'risky', 'D');
  reviewed(h, tipOf(h, 'hobkin/large'));
  reviewed(h, tipOf(h, 'hobkin/small'));

  await survey(h);

  assert.deepEqual(readyItems(h.root).map(({ branch }) => branch.slice(7)), ['small', 'large', 'plain', 'risky', 'stuck']);
});

test('a branch an agent is already fixing moves from the list to what agents are closing', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'app.txt');
  commit(h.checkout, 'app.txt', 'main moved\n');
  const item = finished(h, 'hobkin/abc');

  await survey(h);

  assert.equal(row(h, item).gap, 'closing');
  assert.deepEqual(closingItems(h.root).map(({ branch, doing }) => [branch, doing]), [['hobkin/abc', 'getting it ready to merge']]);
});

test('merging fast-forwards when it can, moves the checked-out folder, and pushes nothing', async t => {
  const h = workspace(t);
  const origin = withOrigin(h.base, h.checkout);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc');
  const pushed = git(origin, 'rev-parse', 'main');

  const { message } = await mergeItem(h.root, 'api', item.id);

  assert.equal(tipOf(h, 'main'), tipOf(h, 'hobkin/abc'));
  assert.equal(git(origin, 'rev-parse', 'main'), pushed);
  assert.equal(read(h, item).state, 'merged');
  assert.match(message, /into main/);
  assert.match(message, /Nothing was pushed/);
});

test('merging makes a merge commit when main has moved, even with the folder on another branch', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  commit(h.checkout, 'other.txt', 'other\n');
  git(h.checkout, 'switch', '-q', '-c', 'mine');
  const item = finished(h, 'hobkin/abc');

  await mergeItem(h.root, 'api', item.id);

  assert.equal(git(h.checkout, 'branch', '--show-current'), 'mine');
  assert.equal(git(h.checkout, 'rev-parse', 'main^2'), tipOf(h, 'hobkin/abc'));
  assert.match(git(h.checkout, 'show', 'main:feature.txt'), /feature/);
  assert.match(git(h.checkout, 'log', '-1', '--format=%s', 'main'), /work 0/);
});

test('uncommitted work in the way of a merge stops it, and nothing moves', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  writeFileSync(join(h.checkout, 'feature.txt'), 'mine, not committed\n');
  const before = tipOf(h, 'main');
  const item = finished(h, 'hobkin/abc');

  await assert.rejects(mergeItem(h.root, 'api', item.id), /uncommitted/);

  assert.equal(tipOf(h, 'main'), before);
  assert.equal(read(h, item).state, 'branch');
});

test('uncommitted work elsewhere in the folder does not get in the way', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  writeFileSync(join(h.checkout, 'app.txt'), 'mine, not committed\n');
  const item = finished(h, 'hobkin/abc');

  await mergeItem(h.root, 'api', item.id);

  assert.equal(read(h, item).state, 'merged');
});

test('a conflict stops a merge and says what to do', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'app.txt');
  commit(h.checkout, 'app.txt', 'main moved\n');
  const before = tipOf(h, 'main');
  const item = finished(h, 'hobkin/abc');

  await assert.rejects(mergeItem(h.root, 'api', item.id), /conflicts with main/);

  assert.equal(tipOf(h, 'main'), before);
});

test('merging a branch also closes the finished branches it holds', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/first', 'first.txt', 'first\n');
  git(h.checkout, 'switch', '-q', 'hobkin/first');
  git(h.checkout, 'switch', '-q', '-c', 'hobkin/second');
  commit(h.checkout, 'second.txt', 'second\n');
  git(h.checkout, 'switch', '-q', 'main');
  const first = finished(h, 'hobkin/first');
  const second = finished(h, 'hobkin/second');

  await mergeItem(h.root, 'api', second.id);

  assert.equal(read(h, first).state, 'merged');
});

test('declining keeps the branch and takes the item off the list', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc');
  await survey(h);

  declineItem(h.root, 'api', item.id);

  assert.equal(read(h, item).state, 'declined');
  assert.ok(tipOf(h, 'hobkin/abc'));
  assert.equal(row(h, item), undefined);
});

test('sending an agent back keeps the branch and carries the user\'s words', t => {
  const h = workspace(t);
  const item = finished(h, 'hobkin/abc');

  askAgent(h.root, 'api', item.id, 'Keep the old flag working.');

  assert.equal(read(h, item).state, 'open');
  assert.equal(read(h, item).branch, 'hobkin/abc');
  assert.equal(read(h, item).workNote, 'Keep the old flag working.');
  assert.equal(closingItems(h.root)[0].doing, 'working on your note');
});

test('a row knows whether it has a description and recorded proof', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const bare = finished(h, 'hobkin/abc');
  const told = finished(h, 'hobkin/abc', { proof: 'It failed, then it passed.' });
  mkdirSync(join(h.root, 'work', 'api', 'prs'), { recursive: true });
  writeFileSync(prFile(h.root, 'api', told.id), 'Title\n');

  await survey(h);

  assert.deepEqual([row(h, bare).described, row(h, bare).proved], [false, false]);
  assert.deepEqual([row(h, told).described, row(h, told).proved], [true, true]);
});

test('the next five rows without a description or proof get an agent, once, and the sixth waits for one of them to finish', async t => {
  const h = workspace(t);
  const names = ['one', 'two', 'three', 'four', 'five', 'six'];
  for (const name of names) {
    branched(h.checkout, `hobkin/${name}`, `${name}.txt`, 'x\n');
    finished(h, `hobkin/${name}`);
  }
  await survey(h);

  const filled = fillGaps(h.root, NOW);
  const fixes = readItems(h.root, 'api').filter(item => item.kind === 'pr-fix');

  assert.equal(filled.length, 5);
  assert.equal(fixes.length, 5);
  assert.ok(fixes.every(({ branch, ships }) => branch && ships));

  await survey(h);
  assert.deepEqual(fillGaps(h.root, NOW), [], 'a row being closed keeps its place, so nothing new is filed');

  const [{ id }] = readItems(h.root, 'api').filter(item => item.kind === 'pr-fix');
  updateItem(h.root, 'api', id, { state: 'done' }, NOW);
  for (const { id: maker } of readItems(h.root, 'api').filter(item => item.kind === 'fix').slice(0, 1)) updateItem(h.root, 'api', maker, { proof: 'It passed.' }, NOW);
  fillGaps(h.root, NOW);
});

test('a quality grade belongs to its commit too, and sorts within a safety grade', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/weak', 'weak.txt', 'x\n');
  branched(h.checkout, 'hobkin/good', 'good.txt', 'x\n');
  branched(h.checkout, 'hobkin/moved', 'moved.txt', 'x\n');
  const weak = finished(h, 'hobkin/weak', { quality: { rating: 'D', reason: 'No test covers it.', head: tipOf(h, 'hobkin/weak') } });
  const good = finished(h, 'hobkin/good', { quality: { rating: 'A', reason: 'Well covered.', head: tipOf(h, 'hobkin/good') }, notices: 'Authors see a failed save.' });
  const moved = finished(h, 'hobkin/moved', { quality: { rating: 'A', reason: 'Well covered.', head: 'older' } });

  await survey(h);

  assert.deepEqual(readyItems(h.root).map(({ item }) => item), [good.id, moved.id, weak.id]);
  assert.equal(row(h, good).notices, 'Authors see a failed save.');
  assert.equal(row(h, good).quality.stale, false);
  assert.equal(row(h, moved).quality.stale, true);
});

test('a row with no branch holds nothing, even beside an open PR', async t => {
  const h = workspace(t);
  const { id } = fileItem(h.root, 'api', { key: 'setting:dns', kind: 'yours', title: 'Point the domain', brief: 'At the registrar.' }, NOW);
  await surveyUnmerged(h.root, { now: NOW, reviews: h.reviews, gh: async () => JSON.stringify([{ number: 1, title: 'x', url: 'u', state: 'OPEN', headRefName: 'hobkin/pr', statusCheckRollup: [] }]) });

  assert.equal(readyItems(h.root).find(({ item }) => item === id).holds, 0);
});

test('a step only a person can take waits in the list and no agent runs it', async t => {
  const h = workspace(t);
  const { id } = fileItem(h.root, 'api', { key: 'setting:https', kind: 'yours', title: 'Turn on HTTPS enforcement', brief: 'Settings, Pages, Enforce HTTPS.' }, NOW);

  await survey(h);

  assert.equal(readyItems(h.root).find(({ item }) => item === id).gap, 'yours');
});

test('an agent saying done on a branch with commits of its own is recorded as finished on that branch', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc', { state: 'doing' });

  await agentSays(h, { id: item.id, state: 'done', summary: 'All done.' });

  assert.equal(read(h, item).state, 'branch');
  assert.equal(read(h, item).summary, 'All done.');
});

test('done stays done when the branch holds nothing new, or is a fix on another item\'s branch', async t => {
  const h = workspace(t);
  git(h.checkout, 'branch', 'hobkin/empty');
  branched(h.checkout, 'hobkin/made', 'feature.txt', 'feature\n');
  const nothing = finished(h, 'hobkin/empty', { state: 'doing' });
  const fix = finished(h, 'hobkin/made', { state: 'doing', kind: 'pr-fix' });
  const noBranch = fileItem(h.root, 'api', { key: 'look', kind: 'chore', title: 'Look', brief: 'Check it.' }, NOW);

  for (const { id } of [nothing, fix, noBranch]) await agentSays(h, { id, state: 'done' });

  assert.deepEqual([read(h, nothing).state, read(h, fix).state, read(h, noBranch).state], ['done', 'done', 'done']);
});

test('only code writes what landed, what the user closed and what an offer holds', async t => {
  const h = workspace(t);
  const item = finished(h, 'hobkin/abc');

  await agentSays(h, { id: item.id, landed: { route: 'key' }, closedByUser: true, offerHeldUntil: 'x', pushbacks: [] });

  const { landed, closedByUser, offerHeldUntil, pushbacks } = read(h, item);
  assert.deepEqual([landed, closedByUser, offerHeldUntil, pushbacks], [undefined, undefined, undefined, undefined]);
});

test('a finished branch whose item says done shows as not landed, and merges', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc', { state: 'done' });
  await survey(h);

  assert.equal(row(h, item).gap, 'unlanded');

  await mergeItem(h.root, 'api', item.id);

  assert.equal(read(h, item).state, 'merged');
  assert.equal(tipOf(h, 'main'), tipOf(h, 'hobkin/abc'));
});

test('a user closing it keeps it closed, and the branch stays', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc', { state: 'done' });
  await survey(h);

  markDone(h.root, 'api', item.id);
  await survey(h);

  assert.equal(read(h, item).closedByUser, true);
  assert.equal(row(h, item), undefined);
  assert.ok(tipOf(h, 'hobkin/abc'));
});

test('a done item with nothing to land stays out of the list', async t => {
  const h = workspace(t);
  git(h.checkout, 'branch', 'hobkin/empty');
  branched(h.checkout, 'hobkin/shared', 'feature.txt', 'feature\n');
  const nothing = finished(h, 'hobkin/empty', { state: 'done' });
  finished(h, 'hobkin/shared');
  const fix = finished(h, 'hobkin/shared', { state: 'done', kind: 'pr-fix' });
  const alongside = finished(h, 'hobkin/shared', { state: 'done' });

  await survey(h);

  assert.deepEqual([row(h, nothing), row(h, fix), row(h, alongside)], [undefined, undefined, undefined]);
});

test('merging a branch with nothing the default branch lacks is refused', async t => {
  const h = workspace(t);
  git(h.checkout, 'branch', 'hobkin/empty');
  const item = finished(h, 'hobkin/empty', { state: 'done' });
  const before = tipOf(h, 'main');

  await assert.rejects(mergeItem(h.root, 'api', item.id), /nothing main lacks/);

  assert.equal(tipOf(h, 'main'), before);
});

test('a hobkin branch with no item gets one, once, titled from its last commit', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/stray', 'stray.txt', 'Add the stray thing\n');
  branched(h.checkout, 'hobkin/abc-kept-20260601-120000', 'kept.txt', 'Work in progress kept by Hobkin\n');

  await survey(h);
  await survey(h);

  const filed = readItems(h.root, 'api');
  assert.deepEqual(filed.map(({ title, state, branch }) => [title, state, branch]), [['Add the stray thing', 'branch', 'hobkin/stray']]);
  assert.equal(row(h, filed[0]).gap, 'land');
});

test('a branch the user dropped keeps its item, and no second one is filed', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/stray', 'stray.txt', 'Add the stray thing\n');
  await survey(h);
  const [item] = readItems(h.root, 'api');
  updateItem(h.root, 'api', item.id, { state: 'dropped' }, NOW);

  await survey(h);

  assert.deepEqual(readItems(h.root, 'api').map(({ state }) => state), ['dropped']);
});

test('the survey says what each branch touches, reading only', async t => {
  const h = workspace(t);
  mkdirSync(join(h.checkout, 'app', 'models'), { recursive: true });
  mkdirSync(join(h.checkout, 'test'));
  commit(h.checkout, 'test/old.test.js', 'old\n');
  commit(h.checkout, 'app/models/fee.rb', 'one\n');
  git(h.checkout, 'switch', '-qc', 'hobkin/abc');
  commit(h.checkout, 'app/models/fee.rb', 'one\ntwo\nthree\n');
  unlinkSync(join(h.checkout, 'test', 'old.test.js'));
  commit(h.checkout, 'README.md', 'Readme\n');
  git(h.checkout, 'switch', '-q', 'main');
  finished(h, 'hobkin/abc');

  await survey(h);

  const { area, paths: changed, deletedTests, title } = unit(h, 'hobkin/abc');
  assert.equal(area, 'app/models');
  assert.deepEqual(changed.toSorted(), ['README.md', 'app/models/fee.rb', 'test/old.test.js']);
  assert.deepEqual(deletedTests, ['test/old.test.js']);
  assert.equal(title, 'Readme');
});

test('a merge writes what landed, and a stacked branch it brought along lands too', async t => {
  const h = workspace(t);
  mkdirSync(join(h.checkout, 'lib', 'money'), { recursive: true });
  git(h.checkout, 'switch', '-qc', 'hobkin/first');
  commit(h.checkout, 'lib/money/first.rb', 'first\n');
  git(h.checkout, 'switch', '-qc', 'hobkin/second');
  commit(h.checkout, 'lib/money/second.rb', 'second\ntwo\n');
  git(h.checkout, 'switch', '-q', 'main');
  const first = finished(h, 'hobkin/first');
  const second = finished(h, 'hobkin/second', { quality: { rating: 'A', reason: 'Fine.', head: tipOf(h, 'hobkin/second') } });
  reviewed(h, tipOf(h, 'hobkin/second'));
  await survey(h);

  await mergeItem(h.root, 'api', second.id, { route: 'key', read: 'diff', readMs: 4200, now: NOW });

  const { sha, at, route, read: seen, readMs, safety, quality, size, area, spot } = read(h, second).landed;
  assert.equal(sha, tipOf(h, 'main'));
  assert.deepEqual([at, route, seen, readMs, spot], [new Date(NOW).toISOString(), 'key', 'diff', 4200, false]);
  assert.deepEqual([safety.grade, safety.rating, quality.rating, area], ['safe', 'A', 'A', 'lib/money']);
  assert.deepEqual(size, { additions: 3, deletions: 0, files: 2 });
  assert.equal(read(h, first).landed.area, 'lib/money');
  assert.equal(read(h, first).landed.sha, tipOf(h, 'main'));
});

test('a merge from the command line is the chat route, with nothing read', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc');

  await runWorkCommand(h.root, ['merge', 'api', item.id]);

  const { route, read: seen, readMs } = read(h, item).landed;
  assert.deepEqual([route, seen, readMs], ['chat', 'none', 0]);
});

test('a merge compares the commit it was asked about with the branch, and refuses if it moved', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc');
  const offered = tipOf(h, 'hobkin/abc');
  git(h.checkout, 'switch', '-q', 'hobkin/abc');
  commit(h.checkout, 'more.txt', 'more\n');
  git(h.checkout, 'switch', '-q', 'main');
  const before = tipOf(h, 'main');

  await assert.rejects(mergeItem(h.root, 'api', item.id, { head: offered }), /moved/);

  assert.equal(tipOf(h, 'main'), before);
  assert.equal(read(h, item).state, 'branch');
  assert.equal(read(h, item).landed, undefined);
});

test('a merge made elsewhere is found by the survey and recorded as remote', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/abc', { quality: { rating: 'B', reason: 'Fine.', head: tipOf(h, 'hobkin/abc') } });
  reviewed(h, tipOf(h, 'hobkin/abc'));
  await survey(h);

  git(h.checkout, 'merge', '-q', '--no-ff', '--no-edit', 'hobkin/abc');
  await surveyUnmerged(h.root, { now: NOW + 1000, gh: async () => '[]', reviews: h.reviews });

  const { state, landed } = read(h, item);
  assert.equal(state, 'merged');
  assert.deepEqual([landed.route, landed.read, landed.readMs], ['remote', 'none', 0]);
  assert.equal(landed.sha, tipOf(h, 'hobkin/abc'));
  assert.deepEqual([landed.safety.grade, landed.quality.rating, landed.area], ['safe', 'B', 'root']);
  assert.deepEqual(landed.size, { additions: 1, deletions: 0, files: 1 });
});

test('a PR merged on the remote keeps its merge commit and what the survey knew of it', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/7-fix', 'feature.txt', 'feature\n');
  const item = finished(h, 'hobkin/7-fix', { state: 'pr', pr: 'https://example.com/pull/7' });
  const opened = pull(7, { additions: 12, deletions: 3, changedFiles: 2 });
  await surveyUnmerged(h.root, { now: NOW, gh: async () => JSON.stringify([opened]), reviews: h.reviews });

  const merged = { ...opened, state: 'MERGED', mergedAt: '2026-06-02T00:00:00Z', mergeCommit: { oid: 'abc123' } };
  await surveyUnmerged(h.root, { now: NOW + 1000, gh: async () => JSON.stringify([merged]), reviews: h.reviews });

  const { landed } = read(h, item);
  assert.deepEqual([landed.sha, landed.at, landed.route, landed.area], ['abc123', '2026-06-02T00:00:00Z', 'remote', 'root']);
  assert.deepEqual(landed.size, { additions: 12, deletions: 3, files: 2 });
});

test('a fix on a branch is not a change of its own, so only the item that made it lands', async t => {
  const h = workspace(t);
  branched(h.checkout, 'hobkin/abc', 'feature.txt', 'feature\n');
  const maker = finished(h, 'hobkin/abc');
  const { id } = fileItem(h.root, 'api', { key: 'ship:rebase', kind: 'pr-fix', title: 'Rebase it', brief: 'Rebase it.' }, NOW);
  updateItem(h.root, 'api', id, { branch: 'hobkin/abc' }, NOW);
  await survey(h);

  git(h.checkout, 'merge', '-q', '--no-ff', '--no-edit', 'hobkin/abc');
  await surveyUnmerged(h.root, { now: NOW + 1000, gh: async () => '[]', reviews: h.reviews });

  assert.equal(read(h, { id }).state, 'merged');
  assert.equal(read(h, { id }).landed, undefined);
  assert.equal(read(h, maker).landed.route, 'remote');
});
