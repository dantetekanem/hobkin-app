import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { runWorkCommand } from '../src/cli/work/commands.mjs';
import { fileItem, readItems, updateItem } from '../src/cli/work/store.mjs';
import { recordGrades } from '../src/cli/work/review-grades.mjs';
import { branched, git } from './helpers/work-fixture.mjs';
import { NOW, scored, survey, workspace } from './helpers/yolo-fixture.mjs';

/** Finished work with no grades yet, on a branch of its own. */
function ungraded(h, title, state = 'branch') {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkouts.api, branch);
  const head = git(h.checkouts.api, 'rev-parse', branch);
  const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  updateItem(h.root, 'api', id, { state, branch, proof: 'The spec passes.' }, NOW);
  return { id, head };
}
const grades = (head, change = {}) => ({ kind: 'bug-fix', scores: scored({ safety: 9 }), head, ...change });
const itemOf = (h, id) => readItems(h.root, 'api').find(item => item.id === id);

test('recordGrades refuses fewer than five scores, an unknown or unfinished item and a head that is not the current one, and accepts a complete record', async t => {
  const h = workspace(t);
  const change = ungraded(h, 'Fix login');
  const { coverage, ...four } = scored();

  assert.throws(() => recordGrades(h.root, 'api', change.id, grades(change.head, { scores: four })), /coverage needs a whole score from 1 to 10/);
  assert.throws(() => recordGrades(h.root, 'api', change.id, grades(change.head, { kind: 'refactor' })), /kind must be one of/);
  assert.throws(() => recordGrades(h.root, 'api', change.id, grades('abc')), /head/);
  assert.throws(() => recordGrades(h.root, 'api', change.id, grades(change.head, { rate: 10 })), /sends no rate/);
  assert.throws(() => recordGrades(h.root, 'api', 'nope', grades(change.head)), /no item nope/);
  const open = ungraded(h, 'Fix logout', 'open');
  assert.throws(() => recordGrades(h.root, 'api', open.id, grades(open.head)), /is open, not finished work/);
  assert.equal(itemOf(h, change.id).review, undefined, 'nothing was written');

  // The survey read the branch at its head: ratings for another commit are refused.
  await survey(h);
  assert.throws(() => recordGrades(h.root, 'api', change.id, grades('b'.repeat(40))), /are for bbbbbbb, and "Fix login" is at/);

  const kept = recordGrades(h.root, 'api', change.id, grades(change.head, { missing: 'A request test.' }), NOW);
  assert.deepEqual(Object.keys(kept).toSorted(), ['at', 'by', 'head', 'kind', 'missing', 'scores']);
  assert.deepEqual([kept.by, kept.at, kept.kind, kept.head, kept.scores.safety.score], ['change-review', new Date(NOW).toISOString(), 'bug-fix', change.head, 9]);
  assert.deepEqual(itemOf(h, change.id).review, kept);
});

test('the item command takes no review from a run', async t => {
  const h = workspace(t);
  const change = ungraded(h, 'Fix login');
  updateItem(h.root, 'api', change.id, { reviewAsked: true }, NOW);

  await runWorkCommand(h.root, ['item', 'api'], Readable.from([JSON.stringify({ id: change.id, state: 'branch', review: grades(change.head) })]));

  assert.equal(itemOf(h, change.id).review, undefined);
  assert.equal(itemOf(h, change.id).state, 'branch', 'the rest of what the run said is kept');
});
