import assert from 'node:assert/strict';
import { test } from 'node:test';
import { holdOf } from '../src/cli/work/yolo-pass.mjs';
import { RULE_DEFAULTS } from '../src/cli/work/yolo-rules.mjs';

const HEAD = 'a'.repeat(40);
const scored = (numbers = {}) => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback']
  .map(name => [name, { score: numbers[name] ?? 10, evidence: `What the review saw of ${name}.` }]));
const unitOf = change => ({ sha: HEAD, area: 'src/cli', conflict: false, size: { additions: 100, deletions: 20, files: 2 }, paths: ['src/cli/a.mjs', 'src/cli/b.mjs'], deletedTests: [], ...change });

// A change that merges at the usual rules. `rules` are the user's changes to them, and each case holds exactly one thing.
function asks({ numbers, kind = 'bug-fix', unit = {}, item = {}, row = {}, rules = {}, rate = 8, landable = true, leftOut = null }) {
  const review = { kind, scores: scored(numbers), head: HEAD, by: 'change-review' };
  return holdOf({
    yolo: { on: true, rate },
    on: true,
    project: {},
    readiness: { ready: true },
    landable,
    leftOut,
    row: { holds: 0, ...row },
    item: { state: 'branch', kind: 'fix', review, ...item },
    unit: unitOf(unit),
    rules: { ...RULE_DEFAULTS, lowestRate: rate, ...rules },
  });
}

test('the lowest rate takes one decimal between 1 and 10', () => {
  const numbers = { coverage: 8, proof: 8, safety: 9, visibility: 9, rollback: 8 };
  assert.equal(asks({ numbers, rate: 8.4 }), null, 'rated 8.4 merges at 8.4');
  assert.deepEqual(asks({ numbers, rate: 8.5 }), { why: 'its general rate is 8.4, under 8.5', setting: 'lowestRate' });
  assert.equal(asks({ numbers: { coverage: 5, proof: 5, safety: 8, visibility: 7, rollback: 7 }, rate: 1 }), null, 'a rate of 1 asks for nothing beyond the floors');
});

test('a lowest score lets a change with a lower score through only when it was lowered', () => {
  const cases = [['coverage', 4], ['proof', 4], ['safety', 7], ['visibility', 6], ['rollback', 6]];
  for (const [criterion, score] of cases) {
    const name = `floor${criterion[0].toUpperCase()}${criterion.slice(1)}`;
    const asked = asks({ numbers: { [criterion]: score }, rate: 1 });
    assert.equal(asked?.setting, name, criterion);
    assert.equal(asks({ numbers: { [criterion]: score }, rate: 1, rules: { [name]: score } }), null, `${criterion} lowered to ${score}`);
    const other = cases.find(([each]) => each !== criterion);
    assert.equal(asks({ numbers: { [criterion]: score }, rate: 1, rules: { [`floor${other[0][0].toUpperCase()}${other[0].slice(1)}`]: 1 } })?.setting, name, 'another question\'s lowest does not help');
  }
});

test('kinds, lines, areas, deleted tests, one-way undo, earlier branches and a run\'s note each hold or release only their own rule', () => {
  assert.deepEqual(asks({ kind: 'feature' }), { why: 'its review calls it feature', setting: 'kinds' });
  assert.equal(asks({ kind: 'feature', item: { kind: 'fix' }, rules: { kinds: ['feature'] } }), null);
  assert.equal(asks({ kind: 'bug-fix', rules: { kinds: ['feature'] } })?.setting, 'kinds');
  assert.equal(asks({ kind: 'feature', item: { kind: 'feature' }, rules: { kinds: ['feature'] } }), null, 'a feature item merges once features may');
  assert.equal(asks({ kind: 'feature', item: { kind: 'feature', key: 'yolo:ready' }, rules: { kinds: ['feature'] } })?.setting, 'kinds', 'readiness\'s own branches never do');

  const long = { size: { additions: 400, deletions: 0, files: 2 } };
  assert.deepEqual(asks({ unit: long }), { why: 'over 300 changed lines', setting: 'mostLines' });
  assert.equal(asks({ unit: long, rules: { mostLines: 400 } }), null);
  assert.equal(asks({ unit: long, rules: { mostLines: 399 } })?.why, 'over 399 changed lines');
  assert.equal(asks({ unit: long, rules: { mostLines: null } }), null);

  const wide = { paths: ['a/x/1.rb', 'b/y/2.rb', 'c/z/3.rb'], area: 'multi', size: { additions: 3, deletions: 0, files: 3 } };
  assert.deepEqual(asks({ unit: wide }), { why: 'touches too many areas', setting: 'mostAreas' });
  assert.equal(asks({ unit: wide, rules: { mostAreas: 3 } }), null);
  assert.equal(asks({ unit: wide, rules: { mostAreas: 2 } })?.setting, 'mostAreas');
  assert.equal(asks({ unit: wide, rules: { mostAreas: null } }), null);
  assert.equal(asks({ unit: { ...wide, paths: ['a/x/1.rb', 'b/y/2.rb', 'c/z/3.rb', 'd/w/4.rb'], size: { additions: 4, deletions: 0, files: 4 } }, rules: { mostAreas: 3 } })?.setting, 'mostAreas');

  const deletes = { deletedTests: ['test/a.test.mjs'] };
  assert.deepEqual(asks({ unit: deletes }), { why: 'deletes tests', setting: 'deletedTestsMayMerge' });
  assert.equal(asks({ unit: deletes, rules: { deletedTestsMayMerge: true } }), null);
  assert.equal(asks({ unit: deletes, rules: { oneWayUndoMayMerge: true, leftNoteMayMerge: true, earlierBranchesMayMerge: true } })?.setting, 'deletedTestsMayMerge');

  const oneWay = { launch: { undo: 'one-way' } };
  assert.deepEqual(asks({ item: oneWay }), { why: 'undo is one-way', setting: 'oneWayUndoMayMerge' });
  assert.equal(asks({ item: oneWay, rules: { oneWayUndoMayMerge: true } }), null);
  assert.equal(asks({ item: { launch: { undo: 'permanent' } }, rules: { deletedTestsMayMerge: true } })?.setting, 'oneWayUndoMayMerge');

  assert.deepEqual(asks({ row: { holds: 1 } }), { why: 'it brings earlier branches with it', setting: 'earlierBranchesMayMerge' });
  assert.equal(asks({ row: { holds: 1 }, rules: { earlierBranchesMayMerge: true } }), null);
  assert.equal(asks({ row: { holds: 1 }, rules: { leftNoteMayMerge: true } })?.setting, 'earlierBranchesMayMerge');

  const note = { landable: false, leftOut: 'it still has work left: the migration is not run' };
  const left = { left: 'the migration is not run', safety: null, head: HEAD, proved: true, holds: 0 };
  assert.deepEqual(asks({ ...note, row: left }), { why: note.leftOut, setting: 'leftNoteMayMerge' });
  assert.equal(asks({ ...note, row: left, rules: { leftNoteMayMerge: true } }), null);
  assert.equal(asks({ ...note, row: { ...left, proved: false }, rules: { leftNoteMayMerge: true } })?.why, 'it has no proof', 'a note let go lifts only the note');
  assert.equal(asks({ landable: false, leftOut: 'it is already on main', row: left, rules: { leftNoteMayMerge: true } })?.setting, null);
});

test('a path word removed no longer asks, and one added does', () => {
  const unit = { paths: ['app/auth/login.rb'], size: { additions: 3, deletions: 0, files: 1 } };
  assert.deepEqual(asks({ unit }), { why: 'touches app/auth/login.rb', setting: 'askPaths' });
  assert.equal(asks({ unit, rules: { askPaths: RULE_DEFAULTS.askPaths.filter(word => word !== 'auth') } }), null);
  const plain = { paths: ['app/reports/show.rb'], size: { additions: 3, deletions: 0, files: 1 } };
  assert.equal(asks({ unit: plain }), null);
  assert.equal(asks({ unit: plain, rules: { askPaths: [...RULE_DEFAULTS.askPaths, 'reports'] } })?.why, 'touches app/reports/show.rb');
  assert.equal(asks({ unit: plain, rules: { askPaths: ['REPORTS'.toLowerCase()] } })?.setting, 'askPaths');
  assert.equal(asks({ unit: { paths: ['src/ci/run.sh'], size: { additions: 1, deletions: 0, files: 1 } } })?.setting, 'askPaths', 'a folder named ci asks');
  assert.equal(asks({ unit: { paths: ['src/specific/run.sh'], size: { additions: 1, deletions: 0, files: 1 } } }), null);
});
