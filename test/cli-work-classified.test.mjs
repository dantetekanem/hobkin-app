import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { recordGrades } from '../src/cli/work/review-grades.mjs';
import { assertReview, brokenFloors, generalRate, scoresOf } from '../src/cli/work/classified.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, readItems, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, commit, git, repository, writeJson } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const HEAD = 'a'.repeat(40);

const scored = (numbers = {}) => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback']
  .map(name => [name, { score: numbers[name] ?? 9, evidence: `What the review saw of ${name}.` }]));

const review = (change = {}, numbers = {}) => ({ kind: 'bug-fix', scores: scored(numbers), head: HEAD, ...change });

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-classified-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  writeMode(root, { enabled: true });
  return { base, root, checkout };
}

function finished(h, title, change = {}) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkout, branch);
  const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'The spec passes.', ...change }, NOW);
  return { id, branch, head: git(h.checkout, 'rev-parse', branch) };
}

const itemOf = (h, id) => readItems(h.root, 'api').find(item => item.id === id);

test('a review\'s scores are kept only when they are whole, evidenced and pinned to a commit', () => {
  assert.doesNotThrow(() => assertReview(review()));
  assert.doesNotThrow(() => assertReview(review({ missing: 'A request test through the job.' })));

  assert.throws(() => assertReview(review({ kind: 'refactor' })), /kind must be one of: performance, bug-fix, state-machine, package-update, small-change, feature, unclear/);
  assert.throws(() => assertReview(review({ head: 'abc' })), /head/);
  assert.throws(() => assertReview(review({}, { safety: 11 })), /safety needs a whole score from 1 to 10/);
  assert.throws(() => assertReview(review({}, { proof: 7.5 })), /proof needs a whole score from 1 to 10/);
  assert.throws(() => assertReview(review({}, { coverage: 0 })), /coverage needs a whole score from 1 to 10/);
  const { rollback, ...four } = scored();
  assert.throws(() => assertReview(review({ scores: four })), /rollback needs a whole score from 1 to 10/);
  assert.throws(() => assertReview(review({ scores: { ...four, rollback: { score: 9, evidence: ' ' } } })), /rollback needs one line of evidence/);
  assert.throws(() => assertReview(review({ scores: { ...four, rollback: { score: 9, evidence: 'One.\nTwo.' } } })), /rollback needs one line of evidence/);
  assert.throws(() => assertReview(review({ rate: 10 })), /rate/);
});

test('the general rate is the average cut to one decimal, and a floor holds a change whatever its average', () => {
  assert.equal(generalRate(scored()), 9);
  assert.equal(generalRate(scored({ coverage: 8, proof: 8, safety: 8, visibility: 8, rollback: 7 })), 7.8);
  // 7.96 would round up to 8, and a rate never claims more than the scores gave.
  assert.equal(generalRate(scored({ coverage: 8, proof: 8, safety: 8, visibility: 8, rollback: 7.8 })), 7.9);

  assert.deepEqual(brokenFloors(scored()), []);
  assert.deepEqual(brokenFloors(scored({ safety: 7 })), [{ criterion: 'safety', score: 7, needs: 8 }]);
  assert.deepEqual(brokenFloors(scored({ rollback: 6 })), [{ criterion: 'rollback', score: 6, needs: 7 }]);
  // A regression the monitoring would not show holds a change as a risk to data does.
  assert.deepEqual(brokenFloors(scored({ visibility: 6 })), [{ criterion: 'visibility', score: 6, needs: 7 }]);
  assert.deepEqual(brokenFloors(scored({ visibility: 7 })), []);
  assert.deepEqual(brokenFloors(scored({ proof: 4 })), [{ criterion: 'proof', score: 4, needs: 5 }]);

  // The average alone would pass a rate of 8, and the floor still holds it.
  const dangerous = scoresOf(review({}, { coverage: 10, proof: 10, safety: 5, visibility: 10, rollback: 10 }));
  assert.equal(dangerous.rate, 9);
  assert.deepEqual(dangerous.floors, [{ criterion: 'safety', score: 5, needs: 8 }]);
});

test('a model hobkin checked at the change\'s head writes the proof score\'s evidence, and one that broke caps it at 3', () => {
  const holds = { spec: '_specs/tla/WorkItem.tla', state: 'holds', run: 'held', line: 'TLC: 4 of 4 hold in 48,211 states · at 3f1a9c2' };
  const broken = { spec: '_specs/tla/ReviewQueue.tla', state: 'broken', run: 'broke', line: 'TLC: MergedAtReviewedHead breaks in 5 steps · at 3f1a9c2' };

  const held = scoresOf(review({}, { proof: 9 }), [holds]);
  assert.deepEqual(held.scores.proof, { score: 9, evidence: `WorkItem.tla: ${holds.line}`, by: 'hobkin', run: 'held' }, 'the review\'s score stands, on hobkin\'s own evidence, named by its model');
  assert.deepEqual([held.rate, held.floors], [9, []]);
  assert.equal(held.scores.safety.evidence, 'What the review saw of safety.', 'only the proof score is hobkin\'s');

  const broke = scoresOf(review({}, { proof: 9 }), [holds, broken]);
  assert.deepEqual(broke.scores.proof, { score: 3, evidence: `WorkItem.tla: ${holds.line}; ReviewQueue.tla: ${broken.line}`, by: 'hobkin', run: 'broke' });
  assert.deepEqual([broke.rate, broke.floors], [7.8, [{ criterion: 'proof', score: 3, needs: 5 }]]);
  assert.equal(scoresOf(review({}, { proof: 2 }), [broken]).scores.proof.score, 2, 'a cap never raises a score');

  // A model nobody has run at this commit yet is no evidence either way, so the review's own line stands.
  const unchecked = scoresOf(review(), [{ spec: '_specs/tla/WorkItem.tla', state: 'unchecked' }]);
  assert.deepEqual(unchecked.scores, scored());
  assert.deepEqual(scoresOf(review()).scores, scored());
});

test('a finished row carries its scores and says when they are for an older commit', async t => {
  const h = workspace(t);
  const { id, branch, head } = finished(h, 'Fix login');
  recordGrades(h.root, 'api', id, review({ head, missing: 'A test through the request.' }, { rollback: 6 }));
  await surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });

  const [row] = readyItems(h.root);
  assert.deepEqual(
    [row.review.kind, row.review.rate, row.review.stale, row.review.missing],
    ['bug-fix', 8.4, false, 'A test through the request.'],
  );
  assert.deepEqual(row.review.floors, [{ criterion: 'rollback', score: 6, needs: 7 }]);
  assert.equal(row.review.scores.coverage.evidence, 'What the review saw of coverage.');

  git(h.checkout, 'switch', '-q', branch);
  commit(h.checkout, 'more.txt', 'more\n');
  git(h.checkout, 'switch', '-q', 'main');
  await surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });

  assert.equal(readyItems(h.root)[0].review.stale, true);
});

test('a finished row\'s proof score is hobkin\'s own once a model covering its files ran at its head', async t => {
  const h = workspace(t);
  const spec = '---- MODULE WorkItem ----\n\\* models: app.txt\n====\n';
  mkdirSync(join(h.checkout, '_specs', 'tla'), { recursive: true });
  commit(h.checkout, '_specs/tla/WorkItem.tla', spec);
  const branch = 'hobkin/fix-merge';
  branched(h.checkout, branch, 'app.txt', 'two\n');
  const head = git(h.checkout, 'rev-parse', branch);
  const { id } = fileItem(h.root, 'api', { key: 'Fix merge', kind: 'fix', title: 'Fix merge', brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'The spec passes.' }, NOW);
  // The review says TLC held, and only hobkin's own run can say that.
  recordGrades(h.root, 'api', id, review({ head }, { proof: 10 }));
  writeJson(join(h.root, 'proofs', 'broke', 'result.json'), {
    id: 'broke',
    project: 'api',
    item: id,
    spec: '_specs/tla/WorkItem.tla',
    head,
    specHash: createHash('sha256').update(spec).digest('hex'),
    outcome: 'broken',
    broken: 'MergedAtReviewedHead',
    traceLength: 5,
    stats: { generated: 9, distinct: 7, queue: 0, depth: 5 },
    actions: [{ name: 'Merge', count: 2 }],
  });
  await surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });

  const [row] = readyItems(h.root);
  assert.deepEqual(row.review.scores.proof, { score: 3, evidence: `WorkItem.tla: TLC: MergedAtReviewedHead breaks in 5 steps · at ${head.slice(0, 7)}`, by: 'hobkin', run: 'broke' });
  assert.deepEqual(row.review.floors, [{ criterion: 'proof', score: 3, needs: 5 }]);
  assert.equal(itemOf(h, id).review.scores.proof.score, 10, 'what the review sent is kept as it was');
});
