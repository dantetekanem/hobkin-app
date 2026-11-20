import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/cli/config.mjs';
import { modeledFiles } from '../src/cli/work/proofs.mjs';
import { readyItems } from '../src/cli/work/reads.mjs';
import { chooseProject, fileItem, updateItem, writeMode } from '../src/cli/work/store.mjs';
import { surveyUnmerged } from '../src/cli/work/unmerged.mjs';
import { branched, commit, git, repository, writeJson } from './helpers/work-fixture.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const SPEC = 'specs/tla/WorkItem.tla';

const specText = (models = 'app.txt', name = 'WorkItem') => [
  `---- MODULE ${name} ----`,
  `\\* models: ${models}`,
  'VARIABLE state',
  '\\* words: An item starts queued.',
  'Init == state = "queued"',
  '\\* code: app.txt:1',
  'Merge == state\' = "merged"',
  'Next == Merge',
  '====',
  '',
].join('\n');
const sha256 = text => createHash('sha256').update(text).digest('hex');

function workspace(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-proofs-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'home');
  initialize(root, { cwd: base });
  const checkout = repository(base, 'api');
  chooseProject(root, checkout, 'important', NOW);
  writeMode(root, { enabled: true });
  return { base, root, checkout };
}

function withSpec(h, spec = SPEC, text = specText()) {
  mkdirSync(join(h.checkout, 'specs', 'tla'), { recursive: true });
  commit(h.checkout, spec, text);
}

/** Finished work on a branch of its own that changes `file`, reviewed at its head with every score at 10. */
function finished(h, title, { file = 'app.txt', text = `${title}\n` } = {}) {
  const branch = `hobkin/${title.toLowerCase().replaceAll(' ', '-')}`;
  branched(h.checkout, branch, file, text);
  const head = git(h.checkout, 'rev-parse', branch);
  const { id } = fileItem(h.root, 'api', { key: title, kind: 'fix', title, brief: 'Evidence and first change.' }, NOW);
  const scores = Object.fromEntries(['coverage', 'proof', 'safety', 'visibility', 'rollback'].map(name => [name, { score: 10, evidence: `What the review saw of ${name}.` }]));
  updateItem(h.root, 'api', id, { state: 'branch', branch, proof: 'The spec passes.', review: { kind: 'bug-fix', scores, head } }, NOW);
  return { id, branch, head };
}

/** A run as `hobkin proof check` leaves it in `<home>/proofs/<id>/result.json`. */
function writeRun(h, change) {
  const run = {
    project: 'api',
    spec: SPEC,
    specSha256: sha256(specText()),
    tool: 'TLC 1.7.4',
    workers: 4,
    started: new Date(NOW - 120000).toISOString(),
    finished: new Date(NOW - 60000).toISOString(),
    outcome: 'holds',
    steps: [],
    stats: { generated: 120000, distinct: 48211, queue: 0, depth: 9 },
    rules: [{ name: 'TypeOK', kind: 'invariant', status: 'holds' }, { name: 'MergedAtReviewedHead', kind: 'invariant', status: 'holds' }],
    actions: [{ name: 'Merge', count: 3 }, { name: 'Decline', count: 2 }],
    ...change,
  };
  writeJson(join(h.root, 'proofs', run.id, 'result.json'), run);
  return run;
}

const broke = { outcome: 'broken', broken: 'MergedAtReviewedHead', traceLength: 5, rules: [{ name: 'TypeOK', kind: 'invariant', status: 'holds' }, { name: 'MergedAtReviewedHead', kind: 'invariant', status: 'broken' }] };
const survey = h => surveyUnmerged(h.root, { now: NOW, gh: async () => '[]', reviews: join(h.base, 'no-reviews') });
const rowOf = (h, { id }) => readyItems(h.root).find(row => row.item === id);

test('a spec names the files it models in its models comments', () => {
  assert.deepEqual(modeledFiles(specText('src/items.mjs, src/yolo-pass.mjs')), ['src/items.mjs', 'src/yolo-pass.mjs']);
  assert.deepEqual(modeledFiles('\\* models: a.mjs\n\\*models:  ./b.mjs ,\nX == 1\n\\* code: c.mjs:3'), ['a.mjs', 'b.mjs']);
  assert.deepEqual(modeledFiles('---- MODULE Plain ----\n===='), []);
});

test('a run covers a change whose files its spec models, and counts only when it held with every action fired at the change\'s head and spec', async t => {
  const h = workspace(t);
  withSpec(h);
  const modeled = finished(h, 'Fix merge');
  const elsewhere = finished(h, 'Fix docs', { file: 'docs.txt' });
  const remodeled = finished(h, 'Model the queue', { file: SPEC, text: specText('app.txt, queue.txt') });
  await survey(h);

  assert.deepEqual(rowOf(h, modeled).models, [{ spec: SPEC, state: 'unchecked', changed: false }]);
  assert.equal(rowOf(h, elsewhere).models, undefined, 'a change to a file no spec models has no model');
  assert.deepEqual(rowOf(h, remodeled).models, [{ spec: SPEC, state: 'unchecked', changed: true }], 'a change to the spec itself is covered by it');

  // A run of another commit, or of a spec that is not the one at the change's head, is not evidence for it.
  writeRun(h, { id: 'older-head', head: 'b'.repeat(40) });
  writeRun(h, { id: 'edited-spec', head: modeled.head, specSha256: sha256('an edit never committed') });
  writeRun(h, { id: 'other-project', head: modeled.head, project: 'web' });
  assert.equal(rowOf(h, modeled).models[0].state, 'unchecked');

  // A model that never reached an action checks nothing that action guards.
  writeRun(h, { id: 'unfired', head: modeled.head, actions: [{ name: 'Merge', count: 3 }, { name: 'Decline', count: 0 }] });
  assert.deepEqual(rowOf(h, modeled).models, [{
    spec: SPEC, state: 'unproven', changed: false, run: 'unfired', why: 'Decline never fired',
    line: `TLC: 2 of 2 hold in 48,211 states, but Decline never fired · at ${modeled.head.slice(0, 7)}`,
  }]);

  writeRun(h, { id: 'held', head: modeled.head, proof: { strict: true, obligations: [{ id: '<1>1', label: 'Init', status: 'proved', depth: 1 }, { id: '<1>2', label: 'Next', status: 'proved', depth: 1 }] } });
  assert.deepEqual(rowOf(h, modeled).models, [{
    spec: SPEC, state: 'holds', changed: false, run: 'held',
    line: `TLC: 2 of 2 hold in 48,211 states · TLAPS: 2 of 2, strict · at ${modeled.head.slice(0, 7)}`,
  }]);

  // A model that broke at that head outweighs one that held there.
  writeRun(h, { id: 'broke', head: modeled.head, ...broke });
  assert.deepEqual(rowOf(h, modeled).models, [{
    spec: SPEC, state: 'broken', changed: false, run: 'broke', why: 'MergedAtReviewedHead',
    line: `TLC: MergedAtReviewedHead breaks in 5 steps · at ${modeled.head.slice(0, 7)}`,
  }]);
});
