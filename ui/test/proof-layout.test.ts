import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutOf } from '../src/features/proofs/proof-layout.ts'

test('a proof shows its check and its proof side by side from 1,100 pixels wide, and as tabs below that', () => {
  assert.equal(layoutOf(520), 'tabs')
  assert.equal(layoutOf(1099), 'tabs')
  assert.equal(layoutOf(1100), 'side')
  assert.equal(layoutOf(1300), 'side')
})
