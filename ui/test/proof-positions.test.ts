import assert from 'node:assert/strict'
import { test } from 'node:test'
import { statePosition } from '../src/features/proofs/graph/step.ts'

test('by the step bar, where the picked state is: which state of the counterexample, off it, or nothing without one', () => {
  assert.equal(statePosition(12, 3), 'State 4 of 12')
  assert.equal(statePosition(6, 5), 'State 6 of 6')
  assert.equal(statePosition(6, null), 'Off the path')
  assert.equal(statePosition(0, null), '')
})
