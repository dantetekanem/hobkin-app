// Proof run records and the spec's own words (_specs/050-tla-proofs): who may write a run, when it counts for an item, and
// what the math view reads from the spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRuns, openRecord, readRun, runCounts } from '../src/cli/proof/record.mjs';
import { modelLine, readCfg, readSpec, toUnicode } from '../src/cli/proof/spec.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/tlc/${name}`, import.meta.url));

function home(t) {
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-proof-record-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

const held = {
  outcome: 'holds',
  head: 'abc1234',
  specHash: 'f00d',
  actions: [{ name: 'Fix', count: 2 }, { name: 'Review', count: 1 }],
};

test('a run counts for an item only when it holds, every action fired, and its head and spec hash match the item\'s', () => {
  const item = { head: 'abc1234', specHash: 'f00d' };
  assert.equal(runCounts(held, item), true);
  assert.equal(runCounts({ ...held, head: 'def5678' }, item), false);
  assert.equal(runCounts({ ...held, specHash: 'beef' }, item), false);
  assert.equal(runCounts({ ...held, outcome: 'broken' }, item), false);
  assert.equal(runCounts({ ...held, actions: [{ name: 'Fix', count: 2 }, { name: 'Review', count: 0 }] }, item), false);
  assert.equal(runCounts({ ...held, actions: [] }, item), false, 'a model with no actions checks nothing');
  assert.equal(runCounts({ ...held, head: undefined }, { head: undefined, specHash: 'f00d' }), false, 'a run with no head counts for no item');
  assert.equal(runCounts(null, item), false);
});

test('a run is written once by the proof process, and read back whole', t => {
  const root = home(t);
  const record = openRecord(root, '20261120-103000-workitem-ab12', { spec: 'specs/tla/WorkItem.tla', tool: 'TLC 1.7.4', workers: 2 });
  record.emit({ type: 'progress', generated: 10, distinct: 4, queue: 1, depth: 2 });
  record.emit({ type: 'end', outcome: 'holds' });
  record.finish({ cfg: 'specs/tla/WorkItem.cfg', specHash: 'f00d' });

  const run = readRun(root, '20261120-103000-workitem-ab12');
  assert.equal(run.outcome, 'holds');
  assert.equal(run.cfg, 'specs/tla/WorkItem.cfg');
  assert.deepEqual(run.stats, { generated: 10, distinct: 4, queue: 1, depth: 2 });
  assert.throws(() => openRecord(root, '20261120-103000-workitem-ab12', { spec: 'x.tla' }), /already/);

  assert.equal(readRun(root, '../../etc'), null, 'an id is never a path');
  assert.equal(readRun(root, '20261120-103000-nothing-zz99'), null);
});

test('the runs list the finished ones, newest first', t => {
  const root = home(t);
  const write = (id, started, outcome) => {
    mkdirSync(join(root, 'proofs', id), { recursive: true });
    writeFileSync(join(root, 'proofs', id, 'result.json'), JSON.stringify({ id, started, outcome }));
  };
  write('20261120-090000-a-aaaa', '2026-11-20T09:00:00.000Z', 'holds');
  write('20261120-100000-b-bbbb', '2026-11-20T10:00:00.000Z', 'broken');
  mkdirSync(join(root, 'proofs', '20261120-110000-c-cccc'), { recursive: true });
  writeFileSync(join(root, 'proofs', 'tlc.lock'), '{}');

  assert.deepEqual(listRuns(root).map(run => run.id), ['20261120-100000-b-bbbb', '20261120-090000-a-aaaa']);
  assert.deepEqual(listRuns(join(root, 'missing')), []);
});

test('ASCII TLA+ becomes Unicode with tlauc\'s symbols, leaving strings and comments as written', () => {
  assert.equal(toUnicode('Init == /\\ x \\in Nat'), 'Init ≜ ∧ x ∈ ℕ');
  assert.equal(toUnicode('  /\\ y\' = [y EXCEPT ![i] = "a /\\ b"]'), '  ∧ y′ = [y EXCEPT ![i] = "a /\\ b"]');
  assert.equal(toUnicode('Spec == Init /\\ [][Next]_vars /\\ WF_vars(Next)'), 'Spec ≜ Init ∧ □[Next]_vars ∧ WF_vars(Next)');
  assert.equal(toUnicode('S == [a |-> 1] \\union {<<1, 2>>}'), 'S ≜ [a ↦ 1] ∪ {⟨1, 2⟩}');
  assert.equal(toUnicode('P == \\A i \\in 1..N : x[i] # 0 => ~ (y <=> z) \\/ x[i] >= 2'), 'P ≜ ∀ i ∈ 1‥N : x[i] ≠ 0 ⇒ ¬ (y ⇔ z) ∨ x[i] ≥ 2');
  assert.equal(toUnicode('EXTENDS Naturals, Integers'), 'EXTENDS Naturals, Integers');
  assert.equal(toUnicode('x == 1 \\* keep /\\ as typed'), 'x ≜ 1 \\* keep /\\ as typed');
  assert.equal(toUnicode('L == <>[]P ~> Q'), 'L ≜ ◇□P ↝ Q');
});

test('the spec gives its modeled files, its definitions in Unicode and each one\'s words and code', () => {
  const spec = readSpec(readFileSync(fixture('WorkItem.tla'), 'utf8'));

  assert.equal(spec.module, 'WorkItem');
  assert.deepEqual(spec.models, ['src/cli/work/items.mjs', 'src/cli/work/yolo-pass.mjs']);
  assert.equal(spec.hasProof, false);
  const names = spec.definitions.map(definition => definition.name);
  assert.deepEqual(names, ['WorkItem', 'vars', 'TypeOK', 'Init', 'Finish', 'Review', 'Fix', 'YoloMerge', 'Next', 'Spec', 'MergedAtReviewedHead']);

  const module = spec.definitions[0];
  assert.equal(module.line, 1);
  assert.equal(module.words, 'How one work item moves from queued to merged.');
  assert.ok(module.lines.includes('CONSTANTS MaxPush'));
  assert.ok(!module.lines.some(line => line.startsWith('\\*')), 'leaves the comments out of the math');

  const merge = spec.definitions.find(definition => definition.name === 'YoloMerge');
  assert.deepEqual(merge, {
    name: 'YoloMerge',
    line: 44,
    // The conjunctions stay under the first one, though ≜ and ∧ are shorter than == and /\.
    lines: ['YoloMerge ≜ ∧ state = "branch"', '            ∧ reviewed > 0', '            ∧ state′ = "merged"', '            ∧ UNCHANGED ⟨head, reviewed⟩'],
    words: 'YOLO mode merges a reviewed branch.',
    code: 'src/cli/work/yolo-pass.mjs:165',
  });
  assert.equal(spec.definitions.find(definition => definition.name === 'Next').words, undefined);
  assert.equal(readSpec(readFileSync(fixture('Proved.tla'), 'utf8')).hasProof, true);
});

test('the cfg gives what must stay true and the model\'s size', () => {
  const cfg = readCfg(readFileSync(fixture('WorkItem.cfg'), 'utf8'));
  assert.deepEqual(cfg, { invariants: ['TypeOK', 'MergedAtReviewedHead'], properties: [], constants: [{ name: 'MaxPush', value: '2' }], checkDeadlock: false });
  assert.equal(modelLine(cfg), 'MaxPush = 2');

  const wide = readCfg('(* a model *)\nCONSTANTS\n  Items = {i1, i2}\n  None = None\n  Max <- SmallMax\nINVARIANT Safe\nPROPERTIES Live Fair\n');
  assert.deepEqual(wide, {
    invariants: ['Safe'],
    properties: ['Live', 'Fair'],
    constants: [{ name: 'Items', value: '{i1, i2}' }, { name: 'None', value: 'None' }, { name: 'Max', value: 'SmallMax' }],
    checkDeadlock: true,
  });
  assert.equal(modelLine(wide), 'Items = {i1, i2}, None = None, Max = SmallMax');
});
