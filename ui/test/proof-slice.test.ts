import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyHostMessage, initialHostState } from '../src/lib/host/state.ts'
import { SAMPLE_PROOFS } from '../src/features/proofs/sample.ts'

test('the proofs slice stays between messages, and a reset without it means a host from before proofs', () => {
  let state = applyHostMessage(initialHostState, { type: 'state', rev: 0, reset: true, proofs: SAMPLE_PROOFS })
  assert.equal(state.proofs, SAMPLE_PROOFS)
  state = applyHostMessage(state, { type: 'state', rev: 1, set: { busy: true } })
  assert.equal(state.proofs, SAMPLE_PROOFS)
  state = applyHostMessage(state, { type: 'state', rev: 2, reset: true })
  assert.equal(state.proofs, null)
})
