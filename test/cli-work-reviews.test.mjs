import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { surveyAndClose } from '../src/cli/work/closing.mjs';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { readReviewGrades } from '../src/cli/work/grades.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, prFile, readItems, readMode, updateItem, writeMode, writeOwnerView } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, commit, git, repository } from './helpers/work-fixture.mjs';

const HOUR = 3600000;
const NOW = Date.parse('2026-06-01T12:00:00Z');
const reviewsOn = { reviewOnFinish: true };

function workspace(t, mode = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-reviews-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  writeMode(root, { enabled: true, ...mode });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  return { base, root, checkout, reviews: join(base, 'auto-review') };
}

/** Work finished on its own branch, described and proved, so a grade is all it can lack. */
function finished(h, name, { file = `${name}.txt`, text = `${name}\n`, ...change } = {}) {
  const branch = `hobkin/${name}`;
  branched(h.checkout, branch, file, text);
  const { id } = fileItem(h.root, 'api', { key: name, kind: 'fix', title: `Fix ${name}`, brief: 'Evidence and first change.' }, NOW);
  mkdirSync(dirname(prFile(h.root, 'api', id)), { recursive: true });
  writeFileSync(prFile(h.root, 'api', id), `Fix ${name}\n`);
  return updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'It failed, then it passed.', ...change }, NOW);
}

/** A finished review as pi-auto-review leaves it. `read` holds the fields that say which commits it read. */
function reviewed(h, name, read, grade = 'safe', rating = 'A') {
  const folder = join(h.reviews, 'session');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${name}.review.json`);
  writeFileSync(file, JSON.stringify({ status: 'complete', ...read, grades: { merge: { grade, rating, reason: 'It reads well.' }, deploy: null } }));
  return file;
}

function onBranch(h, branch, file, text) {
  git(h.checkout, 'switch', '-q', branch);
  commit(h.checkout, file, text);
  git(h.checkout, 'switch', '-q', 'main');
}

const tipOf = (h, name) => git(h.checkout, 'rev-parse', name);
const read = (h, { id }) => readItems(h.root, 'api').find(item => item.id === id);
const safetyOf = (h, { id }) => readyItems(h.root).find(({ item }) => item === id).safety;
const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: h.reviews });
const pass = h => surveyAndClose(h.root, { now: NOW, gh: async () => '[]', reviews: h.reviews });
const askedFor = (h, item) => {
  const { state, reviewAsked, reviewAskedFor } = read(h, item);
  return [state, reviewAsked, reviewAskedFor];
};
const reviewsSetting = async h => (await runWorkCommand(h.root, ['reviews'])).reviewOnFinish;

// Which commit a grade belongs to.

test('a grade goes to the commit a review read up to, not the one it started from', async t => {
  const h = workspace(t);
  const item = finished(h, 'abc', { file: 'first.txt' });
  const started = tipOf(h, 'hobkin/abc');
  onBranch(h, 'hobkin/abc', 'second.txt', 'second\n');
  reviewed(h, 'abc', { preflight: { head: started }, reviewedRange: `main..${tipOf(h, 'hobkin/abc')}` });

  await survey(h);

  const { grade, rating, stale } = safetyOf(h, item);
  assert.deepEqual([grade, rating, stale], ['safe', 'A', undefined]);
});

test('a newer review of another commit leaves a branch its own grade, whatever commit that review started from', async t => {
  const h = workspace(t);
  const item = finished(h, 'abc');
  const tip = tipOf(h, 'hobkin/abc');
  const own = reviewed(h, 'own', { preflight: { head: tip } });
  utimesSync(own, new Date(NOW - HOUR), new Date(NOW - HOUR));
  reviewed(h, 'release-prep', { preflight: { head: tip }, reviewedRange: { base: tip, head: 'c90e6b02' } }, 'risky', 'D');

  await survey(h);

  const { grade, rating, stale } = safetyOf(h, item);
  assert.deepEqual([grade, rating, stale], ['safe', 'A', undefined]);
  assert.equal(readReviewGrades({ folder: h.reviews, now: NOW }).get('c90e6b02').grade, 'risky');
});

test('with no range a review goes to the revision it names, and only then to the commit it started from', t => {
  const h = workspace(t);
  reviewed(h, 'revision', { revision: 'bbb222', preflight: { head: 'aaa111' } });
  reviewed(h, 'started', { preflight: { head: 'ccc333' } });

  const grades = readReviewGrades({ folder: h.reviews, now: NOW });

  assert.deepEqual([...grades.keys()].toSorted(), ['bbb222', 'ccc333']);
});

// With reviews on, asking for the reviews that never came.

test('finished work with no grade for its commit gets its review, two a pass and the top of the list first', async t => {
  const h = workspace(t, reviewsOn);
  const ungraded = finished(h, 'ungraded', { text: 'x\n' });
  const stale = finished(h, 'stale', { text: 'x\n' });
  reviewed(h, 'stale', { preflight: { head: tipOf(h, 'hobkin/stale') } });
  onBranch(h, 'hobkin/stale', 'more.txt', 'more\n');
  const done = finished(h, 'done', { text: 'x\ny\nz\n', state: 'done' });

  const first = await pass(h);

  assert.deepEqual(first.reviewing.map(({ id }) => id), [ungraded.id, stale.id]);
  assert.deepEqual(askedFor(h, ungraded), ['open', true, tipOf(h, 'hobkin/ungraded')]);
  assert.deepEqual(askedFor(h, stale), ['open', true, tipOf(h, 'hobkin/stale')]);
  assert.deepEqual(readMode(h.root).queueNext, [`item:api:${ungraded.id}`, `item:api:${stale.id}`]);
  assert.deepEqual(askedFor(h, done), ['branch', undefined, undefined], 'the third waits for the next pass, as the finished work it is');

  await pass(h);

  assert.deepEqual(askedFor(h, done), ['open', true, tipOf(h, 'hobkin/done')], 'work an item says is done still needs its grade');
});

test('a review that ends with no grade is not asked again for the same commit, but a new commit is', async t => {
  const h = workspace(t, reviewsOn);
  const item = finished(h, 'abc');
  await pass(h);
  // The review ended with no grade, and left no quality to say it ran.
  updateItem(h.root, 'api', item.id, { state: 'branch', reviewAsked: false }, NOW);

  await pass(h);
  assert.deepEqual(askedFor(h, item), ['branch', false, tipOf(h, 'hobkin/abc')]);

  onBranch(h, 'hobkin/abc', 'more.txt', 'more\n');
  await pass(h);

  assert.deepEqual(askedFor(h, item), ['open', true, tipOf(h, 'hobkin/abc')]);
});

test('a review that ran on a commit and left its quality but no grade is not asked again for it', async t => {
  const h = workspace(t, reviewsOn);
  const item = finished(h, 'abc');
  // What a review asked as the run ended leaves when no review tooling graded it.
  updateItem(h.root, 'api', item.id, { reviewAsked: false, quality: { rating: 'B', reason: 'Tests cover it.', head: tipOf(h, 'hobkin/abc') } }, NOW);

  await pass(h);
  assert.deepEqual(askedFor(h, item), ['branch', false, undefined]);

  onBranch(h, 'hobkin/abc', 'more.txt', 'more\n');
  await pass(h);

  assert.deepEqual(askedFor(h, item), ['open', true, tipOf(h, 'hobkin/abc')]);
});

test('reviews are off in a home with no setting, so the survey asks one only once the user turns them on, with work mode on', async t => {
  const h = workspace(t);
  const item = finished(h, 'abc');
  assert.equal(await reviewsSetting(h), false);

  await pass(h);
  writeMode(h.root, { reviewOnFinish: false });
  await pass(h);
  writeMode(h.root, { enabled: false, reviewOnFinish: true });
  await pass(h);

  assert.deepEqual(askedFor(h, item), ['branch', undefined, undefined]);
  assert.deepEqual(readMode(h.root).queueNext, []);

  writeMode(h.root, { enabled: true });
  await pass(h);

  assert.equal(await reviewsSetting(h), true);
  assert.deepEqual(askedFor(h, item), ['open', true, tipOf(h, 'hobkin/abc')]);
});

test('a branch with its grade, of docs alone, only a person can land, or that a run or another agent holds is left alone', async t => {
  const h = workspace(t, reviewsOn);
  finished(h, 'graded');
  reviewed(h, 'graded', { preflight: { head: tipOf(h, 'hobkin/graded') } });
  finished(h, 'docs', { file: 'GUIDE.md', text: '# Guide\n' });
  finished(h, 'prep', { title: 'Prepare HTTPS enforcement for the blog' });
  // Its review recorded the outcome, and its run has not ended yet.
  finished(h, 'settling', { reviewAsked: true });
  const running = finished(h, 'running');
  mkdirSync(join(h.root, 'runtime.lock'));
  writeOwnerView(h.root, { running: [{ slug: 'api', lane: 'do', item: running.id }] });
  const rebasing = finished(h, 'rebasing');
  const { id: fix } = fileItem(h.root, 'api', { key: 'ship:rebase:hobkin/rebasing', kind: 'pr-fix', title: 'Rebase hobkin/rebasing', brief: 'Rebase it.' }, NOW);
  updateItem(h.root, 'api', fix, { branch: 'hobkin/rebasing', ships: rebasing.id }, NOW);
  const wanted = finished(h, 'wanted');
  // A second item on the same branch: one review covers them both.
  const { id: twin } = fileItem(h.root, 'api', { key: 'twin', kind: 'fix', title: 'Fix twin', brief: 'The same work, filed twice.' }, NOW);
  writeFileSync(prFile(h.root, 'api', twin), 'Fix twin\n');
  updateItem(h.root, 'api', twin, { state: 'branch', branch: 'hobkin/wanted', proof: 'It passed.' }, NOW);

  const { reviewing } = await pass(h);

  assert.deepEqual(reviewing.map(({ id }) => id), [wanted.id]);
  assert.deepEqual(readItems(h.root, 'api').filter(({ reviewAskedFor }) => reviewAskedFor).map(({ id }) => id), [wanted.id]);
});
