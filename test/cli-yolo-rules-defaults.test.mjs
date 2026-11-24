import assert from 'node:assert/strict';
import { test } from 'node:test';
import { whyItAsks } from '../src/cli/work/yolo-pass.mjs';

const HEAD = 'a'.repeat(40);
const scored = (numbers = {}) => Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback']
  .map(name => [name, { score: numbers[name] ?? 10, evidence: `What the review saw of ${name}.` }]));
const review = (numbers, kind = 'bug-fix') => ({ kind, scores: scored(numbers), head: HEAD, by: 'change-review' });

// One change that merges today, and each case below breaks exactly one rule of it.
const base = (change = {}) => ({
  yolo: { on: true, rate: 8 },
  on: true,
  project: { paused: false },
  readiness: { ready: true },
  landable: true,
  leftOut: null,
  row: { holds: false },
  item: { state: 'branch', kind: 'fix', review: review() },
  unit: { sha: HEAD, area: 'src/cli', conflict: false, size: { additions: 100, deletions: 20, files: 2 }, paths: ['src/cli/a.mjs', 'src/cli/b.mjs'], deletedTests: [] },
  models: [],
  unmodeled: [],
  ...change,
});
const withUnit = unit => {
  const size = unit.size ?? { additions: 10, deletions: 1, files: (unit.paths ?? base().unit.paths).length };
  return base({ unit: { ...base().unit, ...unit, size } });
};
const withScores = (numbers, kind) => base({ item: { ...base().item, review: review(numbers, kind) } });

test('with no rule set, each case of whyItAsks gives the answer it gave before, one case for each rule in the audit\'s table', () => {
  const cases = [
    ['nothing in the way', base(), null],
    ['YOLO mode off', base({ yolo: { on: false, rate: 8 } }), 'YOLO mode is off'],
    ['off on its project', base({ on: false }), 'YOLO mode is off on its project'],
    ['project paused', base({ project: { paused: true } }), 'its project is paused'],
    ['project not ready', base({ readiness: { ready: false } }), 'its project is not ready for YOLO mode'],
    ['not on the landing list', base({ landable: false }), 'the last survey did not list it to land, and hobkin work sync reads it again'],
    ['left out of the landing list', base({ landable: false, leftOut: 'something is left for the user' }), 'something is left for the user'],
    ['not finished work', base({ item: { ...base().item, state: 'open' } }), 'its item is open, not finished work waiting to merge'],
    ['a pull request while pull requests do not merge', base({ item: { ...base().item, state: 'pr' } }), 'its pull request merges by itself once that is turned on'],
    ['brings earlier branches', base({ row: { holds: true } }), 'it brings earlier branches with it'],
    ['no review', base({ item: { state: 'branch', kind: 'fix' } }), 'no review has scored it'],
    ['scores for an older commit', base({ unit: { ...base().unit, sha: 'b'.repeat(40) } }), 'its scores are for an older commit'],
    ['a feature by its review', withScores({}, 'feature'), 'its review calls it feature'],
    ['unclear by its review', withScores({}, 'unclear'), 'its review calls it unclear'],
    ['a feature by its item', base({ item: { ...base().item, kind: 'feature' } }), 'its item is a feature'],
    ['a broken model', base({ models: [{ spec: '_specs/tla/Cart.tla', state: 'broken' }] }), 'its model Cart.tla breaks at this commit'],
    ['a model not checked', base({ models: [{ spec: '_specs/tla/Cart.tla', state: 'unchecked' }] }), 'its model Cart.tla has not been checked at this commit yet'],
    ['a machine with no model', base({ unmodeled: [{ name: 'Checkout' }] }), 'it changes Checkout, a state machine no model covers yet'],
    ['coverage under 5', withScores({ coverage: 4 }), 'coverage scored 4, under 5'],
    ['proof under 5', withScores({ proof: 4 }), 'proof scored 4, under 5'],
    ['safety under 8', withScores({ safety: 7 }), 'safety scored 7, under 8'],
    ['visibility under 7', withScores({ visibility: 6 }), 'visibility scored 6, under 7'],
    ['rollback under 7', withScores({ rollback: 6 }), 'rollback scored 6, under 7'],
    ['a rate under the user\'s', withScores({ coverage: 8, proof: 8, safety: 8, visibility: 7, rollback: 7 }), 'its general rate is 7.6, under 8'],
    ['a rate at the user\'s merges', withScores({ coverage: 8, proof: 8, safety: 8, visibility: 8, rollback: 8 }), null],
    ['a rate over the user\'s rate by a tenth merges', base({ yolo: { on: true, rate: 9.9 }, item: { ...base().item, review: review({}) } }), null],
    ['too many areas', withUnit({ area: 'multi' }), 'touches too many areas'],
    ['over 300 lines', withUnit({ size: { additions: 300, deletions: 1, files: 2 } }), 'over 300 changed lines'],
    ['exactly 300 lines merges', withUnit({ size: { additions: 290, deletions: 10, files: 2 } }), null],
    ['too many files for the survey', withUnit({ size: { additions: 1, deletions: 1, files: 5 } }), 'too many files to read'],
    ['the survey has not read it', withUnit({ area: null }), 'the survey has not read this branch yet'],
    ['a conflict', withUnit({ conflict: true }), 'a conflict, or no way to tell'],
    ['no way to tell', withUnit({ conflict: undefined }), 'a conflict, or no way to tell'],
    ['deletes tests', withUnit({ deletedTests: ['test/a.test.mjs'] }), 'deletes tests'],
    ['one-way undo', base({ item: { ...base().item, launch: { undo: 'one-way' } } }), 'undo is one-way'],
    ['permanent undo', base({ item: { ...base().item, launch: { undo: 'permanent' } } }), 'undo is permanent'],
    ...['db/migrate/1.rb', 'app/Schema.rb', 'lib/Auth/x.rb', 'a/session.js', 'a/token.js', 'a/secrets.yml', 'a/credentials.yml', 'a/password.rb', 'a/payments.rb', 'a/billing.rb',
      'a/deploy.sh', 'config/kamal.yml', 'Dockerfile', 'docker-compose.yml', 'fly.toml', 'Procfile', 'vercel.json', 'netlify.toml', 'render.yml', 'render.yaml',
      '.github/workflows/ci.yml', '.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile', 'ci/build.sh', 'src/ci/run.sh']
      .map(path => [`a sensitive path ${path}`, withUnit({ paths: [path] }), `touches ${path}`]),
    ['a path that only looks like ci/ does not ask', withUnit({ paths: ['src/magic/run.sh', 'src/specific/x.js'] }), null],
    ['a clean path merges', withUnit({ paths: ['src/cli/a.mjs'] }), null],
  ];
  for (const [name, args, expected] of cases) {
    const said = whyItAsks(args);
    if (expected === null) assert.equal(said, null, name);
    else assert.ok(said?.startsWith(expected), `${name}: ${said}`);
  }
});
