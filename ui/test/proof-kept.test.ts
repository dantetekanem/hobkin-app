import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FRESH, keep, keepGraph, keepMath, keptOf, useProofMemory } from '../src/features/proofs/kept.ts'

test('each run keeps its tab, picked state, graph view, lens and search, and math mode and step while the app is open', () => {
  useProofMemory.setState({ runs: {}, siblings: [] })
  assert.deepEqual(keptOf('broken'), FRESH, 'a run never opened starts on Run')

  keep('broken', { tab: 'graph' })
  keepGraph('broken', { view: 'around', lens: 'state[i1]', query: 'state = "merged"', picked: { id: 's4', step: 3 } })
  keep('proved', { tab: 'math' })
  keepMath('proved', { mode: 'both', step: 11, block: 'YoloMerge', all: true })

  // Another run's changes leave this one as it was left.
  assert.deepEqual(keptOf('broken'), {
    ...FRESH,
    tab: 'graph',
    graph: { view: 'around', lens: 'state[i1]', query: 'state = "merged"', picked: { id: 's4', step: 3 } },
  })
  assert.deepEqual(keptOf('proved'), { ...FRESH, tab: 'math', math: { mode: 'both', step: 11, block: 'YoloMerge', all: true } })

  // A change to one part keeps the other part's object, so what draws it does not draw again.
  const graph = keptOf('broken').graph
  keepMath('broken', { step: 2 })
  assert.equal(keptOf('broken').graph, graph)
})

test('the kept runs are bounded, the oldest leaving first', () => {
  useProofMemory.setState({ runs: {}, siblings: [] })
  for (let index = 0; index < 80; index++) keep(`run-${index}`, { tab: 'math' })
  const kept = Object.keys(useProofMemory.getState().runs)
  assert.equal(kept.length, 60)
  assert.equal(kept[0], 'run-20')
  assert.equal(keptOf('run-0').tab, 'run', 'one that left starts fresh')
})
