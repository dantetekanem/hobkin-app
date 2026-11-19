import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dragLeft } from '../src/app/drag-edge.ts'

test('the drag strip starts at the canvas shift, or at the edge a screen claimed when that is further right', () => {
  assert.equal(dragLeft(0, 0), 0)
  assert.equal(dragLeft(120, 0), 120)
  assert.equal(dragLeft(0, 52), 52)
  assert.equal(dragLeft(300, 52), 300)
})
