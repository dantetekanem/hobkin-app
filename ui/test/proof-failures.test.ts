import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProofObligation, ProofRun } from '#shared/protocol/proofs.ts'
import { failingLine, failureAt, failureLine, failuresOf, stepFailure } from '../src/features/proofs/failures.ts'
import { FRESH, type KeptRun } from '../src/features/proofs/kept.ts'
import { sampleRun } from '../src/features/proofs/sample.ts'

const STARTED = Date.parse('2026-11-20T14:05:00Z')
const step = (id: string, status: ProofObligation['status'], depth = 2): ProofObligation => ({ id, label: `CASE Step${id}`, status, depth })

test('what failed in a run: the step of the trace where a rule breaks, then each proof step that failed, is missing or was omitted', () => {
  const both = sampleRun('proofFails', STARTED)
  assert.deepEqual(failuresOf(both), [
    { part: 'graph', step: 5 },
    { part: 'math', index: 11, about: 'YoloMerge' },
  ])
  assert.deepEqual(failuresOf(sampleRun('broken', STARTED)), [{ part: 'graph', step: 5 }])
  assert.deepEqual(failuresOf(sampleRun('proved', STARTED)), [])

  const unproved: ProofRun = { ...sampleRun('holds', STARTED), proof: { strict: true, obligations: [step('<1>1', 'proved', 1), step('<2>1', 'missing'), step('<2>2', 'omitted'), step('<2>3', 'pending'), step('<2>4', 'failed')] } }
  assert.deepEqual(failuresOf(unproved).map((failure) => (failure.part === 'math' ? failure.index : -1)), [1, 2, 4], 'a step still waiting has not failed')
})

test('the heading counts what failed, and says nothing failed when so', () => {
  assert.equal(failureLine(sampleRun('proofFails', STARTED)), 'Breaks at step 6 · 1 of 17 steps fails')
  assert.equal(failureLine(sampleRun('broken', STARTED)), 'Breaks at step 6')
  assert.equal(failureLine(sampleRun('proved', STARTED)), 'Nothing failed')
  assert.equal(failureLine(sampleRun('checking', STARTED)), 'Nothing failed so far')

  const proof = { strict: true, obligations: [step('<1>1', 'proved', 1), step('<2>1', 'failed'), step('<2>2', 'missing'), step('<2>3', 'omitted'), ...['4', '5', '6', '7', '8'].map((id) => step(`<2>${id}`, 'proved'))] }
  assert.equal(failingLine(proof), '3 of 9 steps fail')
  assert.equal(failingLine({ strict: true, obligations: [step('<1>1', 'proved', 1)] }), '1 step')
  assert.equal(failingLine({ strict: true, obligations: [step('<1>1', 'proved', 1), step('<2>1', 'proved')] }), '2 steps')
})

test('F and Shift+F go to the next and previous failure, across the trace and the tree, round again at the ends', () => {
  assert.equal(stepFailure(2, null, 1), 0)
  assert.equal(stepFailure(2, 0, 1), 1)
  assert.equal(stepFailure(2, 1, 1), 0)
  assert.equal(stepFailure(2, null, -1), 1)
  assert.equal(stepFailure(2, 0, -1), 1)
  assert.equal(stepFailure(0, null, 1), null, 'nothing to go to')

  const run = sampleRun('proofFails', STARTED)
  const kept: KeptRun = { ...FRESH, graph: { ...FRESH.graph, view: 'grouped', picked: { id: 's9' } } }
  const [trace, tree] = failuresOf(run)

  // The trace's failure shows the graph at the state where the rule breaks, in the view the user chose.
  const atTrace = failureAt(kept, trace!, 0)
  assert.deepEqual([atTrace.tab, atTrace.graph, atTrace.failure], ['graph', { ...kept.graph, picked: null }, 0])
  // The tree's failure shows the math with that step picked and its definition lit.
  const atTree = failureAt(atTrace, tree!, 1)
  assert.deepEqual([atTree.tab, atTree.math.step, atTree.math.block, atTree.failure], ['math', 11, 'YoloMerge', 1])
  assert.equal(atTree.graph, atTrace.graph, 'the graph is left as it was')
})
