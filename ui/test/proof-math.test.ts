import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProofObligation, ProofRun } from '#shared/protocol/proofs.ts'
import { foldRows, proofNote, proofRows, proofSummary, relatedDefinition, scopeRows, theoremOf } from '../src/features/proofs/math/proof-tree.ts'
import { tokenize } from '../src/features/proofs/math/tokens.ts'
import { DEFINITIONS, brokenRun, holdingRun } from './proof-graph-fixture.ts'

const kinds = (line: string) => tokenize(line).map((token) => `${token.kind}:${token.text}`)

test('a line keeps every character, cut into keywords, operators, strings, numbers and the rest', () => {
  const line = 'YoloMerge(i) ≜ ∧ state[i] = "branch" ∧ UNCHANGED ⟨head, rate⟩'
  assert.equal(
    tokenize(line)
      .map((token) => token.text)
      .join(''),
    line,
  )
  assert.deepEqual(kinds(line), [
    'text:YoloMerge(i) ',
    'operator:≜',
    'text: ',
    'operator:∧',
    'text: state[i] = ',
    'string:"branch"',
    'text: ',
    'operator:∧',
    'text: ',
    'keyword:UNCHANGED',
    'text: ',
    'operator:⟨',
    'text:head, rate',
    'operator:⟩',
  ])
})

test('each symbol the app font lacks is one column, so aligned conjunctions stay aligned whatever font draws it', () => {
  const symbols = tokenize('∀ i ∈ Items : head′[i] ≥ 0‥3 ∧ ¬x').filter((token) => token.symbol)
  // JetBrains Mono draws ′ and ¬ itself, a column wide already.
  assert.deepEqual(
    symbols.map((token) => token.text),
    ['∀', '∈', '≥', '‥', '∧'],
  )
  assert.deepEqual(kinds('head′'), ['text:head', 'operator:′'])
  assert.ok(tokenize('state[i] = "merged"').every((token) => !token.symbol))
})

test('numbers, comments, WF_ and the module rule have their own colors', () => {
  assert.deepEqual(kinds('head[i] < 10 \\* at most ten'), ['text:head[i] ', 'operator:<', 'text: ', 'number:10', 'text: ', 'comment:\\* at most ten'])
  assert.deepEqual(kinds('Spec ≜ WF_vars(Next)').slice(-2), ['keyword:WF_', 'text:vars(Next)'])
  const rule = tokenize('──── MODULE WorkItem ────')
  assert.deepEqual(
    rule.map((token) => token.kind),
    ['rule', 'text', 'keyword', 'text', 'rule'],
  )
  assert.equal(rule[0]!.text, '────')
  // An identifier with a number in it is one name, not a number.
  assert.deepEqual(kinds('i1'), ['text:i1'])
})

const obligation = (id: string, depth: number, status: ProofObligation['status'], extra: Partial<ProofObligation> = {}): ProofObligation => ({ id, label: 'a step', status, depth, ...extra })
const proof = (strict: boolean, obligations: ProofObligation[]) => ({ strict, obligations })
const FAILING = [
  obligation('<1>1', 1, 'proved', { label: 'Init ⇒ Inv', backend: 'Zenon', seconds: 0.31 }),
  obligation('<1>2', 1, 'proved', { label: 'Inv ∧ [Next]_vars ⇒ Inv′' }),
  obligation('<2>1', 2, 'proved', { label: 'CASE Fix(i)', backend: 'SMT', seconds: 1.1 }),
  obligation('<2>2', 2, 'failed', { label: 'CASE YoloMerge(i)', goal: 'reviewed[i] = head[i]', known: ['state[i] = "branch"', 'rate[i] ≥ Rate'] }),
  obligation('<1>3', 1, 'pending', { label: 'QED' }),
]

test('the proof tree indents each step by its depth and says how each one went', () => {
  const rows = proofRows(proof(true, FAILING))
  assert.deepEqual(
    rows.map((row) => [row.indent, row.tone, row.mark, row.how]),
    [
      [0, 'ok', '✓', 'Zenon 0.3 s'],
      [0, 'bad', '!', '1 step fails'],
      [1, 'ok', '✓', 'SMT 1.1 s'],
      [1, 'bad', '!', 'failed'],
      [0, 'quiet', '·', 'waits'],
    ],
  )
  assert.ok(rows.every((row) => row.counted === (row.status === 'proved')))
  // The labels are typeset as TLA+ writes them, and a step is known by its place: labels repeat across branches.
  assert.equal(rows[3]!.text, '⟨2⟩2 CASE YoloMerge(i)')
  assert.deepEqual(
    rows.map((row) => row.index),
    [0, 1, 2, 3, 4],
  )
})

test('without --strict no step counts as proved, and the summary says why', () => {
  const rows = proofRows(proof(false, FAILING))
  assert.ok(rows.every((row) => !row.counted))
  assert.equal(rows[0]!.tone, 'unsure')
  assert.equal(proofSummary(proof(false, FAILING)), 'Ran without --strict · none counted')
  const note = proofNote(brokenRun(), proof(false, FAILING), null)
  assert.equal(note.tone, 'warn')
  assert.equal(note.title, 'Not counted: the proof ran without --strict')
})

test('the summary counts what was proved, failed and is still waiting', () => {
  assert.equal(proofSummary(proof(true, FAILING)), '3 proved · 1 failed · 1 waiting')
  const all = FAILING.map((entry) => ({ ...entry, status: 'proved' as const }))
  assert.equal(proofSummary(proof(true, all)), '5 of 5 proved')
  assert.equal(proofSummary(proof(true, [...all.slice(0, 4), obligation('<1>3', 1, 'omitted')])), '4 proved · 1 omitted')
})

test('a failed step shows its goal and what it knew, in the note under the tree', () => {
  const note = proofNote(brokenRun(), proof(true, FAILING), null)
  assert.equal(note.tone, 'bad')
  assert.equal(note.title, '⟨2⟩2 could not be proved')
  assert.equal(note.math, 'CASE YoloMerge(i)')
  assert.equal(note.goal, 'reviewed[i] = head[i]')
  assert.deepEqual(note.known, ['state[i] = "branch"', 'rate[i] ≥ Rate'])
  assert.match(note.words, /6-step example/)
  // A step the user picks is told instead, by its place in the tree.
  assert.equal(proofNote(brokenRun(), proof(true, FAILING), 0).title, '⟨1⟩1 is proved')
  assert.equal(proofNote(brokenRun(), proof(true, FAILING), 0).words, 'Zenon proved it in 0.3 s.')
})

test('a proof with every step proved under --strict covers every size', () => {
  const all = FAILING.map((entry) => ({ ...entry, status: 'proved' as const }))
  const note = proofNote(holdingRun(), proof(true, all), null)
  assert.equal(note.tone, 'ok')
  assert.equal(note.title, 'Proved for every size')
  assert.equal(note.math, 'Spec ⇒ □MergedAtReviewedHead')
})

test('the theorem comes from the spec, and a step names the definition it is about', () => {
  assert.equal(theoremOf(DEFINITIONS)?.name, 'Safety')
  const names = DEFINITIONS.map((definition) => definition.name)
  assert.equal(relatedDefinition('CASE YoloMerge(i)', names), 'YoloMerge')
  assert.equal(relatedDefinition('Init ⇒ Inv', names), 'Init')
  assert.equal(relatedDefinition('QED', names), null)
})

test('what each result shows, and what it does not, follows the run', () => {
  const broken = scopeRows(brokenRun())
  assert.deepEqual(
    broken.map((row) => row.what),
    ['Model check', 'Proof', 'The code'],
  )
  assert.match(broken[0]!.says, /2 items, up to 3 pushes each/)
  assert.match(broken[0]!.says, /6-step example that breaks MergedAtReviewedHead/)
  assert.equal(broken[0]!.tone, 'bad')
  assert.equal(broken[1]!.tone, 'muted')
  assert.match(broken[2]!.says, /about the model, not the code/)
  const proved: ProofRun = { ...holdingRun(), proof: proof(true, FAILING.map((entry) => ({ ...entry, status: 'proved' as const }))) }
  const rows = scopeRows(proved)
  assert.equal(rows[0]!.tone, 'ok')
  assert.equal(rows[1]!.tone, 'ok')
  assert.match(rows[1]!.says, /every size/)
})

test('folded, the tree keeps its top two levels and opens deeper only where a branch did not prove', () => {
  const steps = [
    obligation('<1>1', 1, 'proved'),
    obligation('<1>2', 1, 'pending'),
    obligation('<2>1', 2, 'proved'),
    obligation('<3>1', 3, 'proved'),
    obligation('<2>2', 2, 'failed'),
    obligation('<3>1', 3, 'proved'),
    obligation('<1>3', 1, 'pending'),
  ]
  const folded = foldRows(proofRows(proof(true, steps)))
  assert.deepEqual(
    folded.map((row) => row.index),
    [0, 1, 2, 4, 5, 6],
  )
})
