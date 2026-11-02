import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillGaps } from '../src/cli/work/closing.mjs';
import { askAgent, declineItem, mergeItem } from '../src/cli/work/controls.mjs';
import { readReviewGrades } from '../src/cli/work/grades.mjs';
import { closingItems, readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, prFile, readItems, updateItem } from '../src/cli/work/store.mjs';
import { readUnmerged, surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, commit, git, repository, withOrigin } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-done-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
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

test('the next five rows without a description or proof get an agent, once, and the rest wait their turn', async t => {
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
  fillGaps(h.root, NOW);
  assert.equal(readItems(h.root, 'api').filter(item => item.kind === 'pr-fix').length, 6, 'the sixth moved up, and the five were not filed again');
});

test('a step only a person can take waits in the list and no agent runs it', async t => {
  const h = workspace(t);
  const { id } = fileItem(h.root, 'api', { key: 'setting:https', kind: 'yours', title: 'Turn on HTTPS enforcement', brief: 'Settings, Pages, Enforce HTTPS.' }, NOW);

  await survey(h);

  assert.equal(readyItems(h.root).find(({ item }) => item === id).gap, 'yours');
});
