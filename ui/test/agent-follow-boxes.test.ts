import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scrollsInside } from '../src/features/agent-activity/boxes.ts'

/** A box of the transcript with a fixed height, scrolled to `top` of what it can, and the line the wheel is over inside it. */
function box(top: number, most: number) {
  const element = { scrollTop: top, scrollHeight: 400 + most, clientHeight: 400 }
  const line = { closest: (selector: string) => (selector === '[data-aa-box]' ? element : null) }
  return { element, line }
}
const outside = { closest: () => null }

test('a wheel inside a box that can still scroll that way is the box, and the transcript keeps following', () => {
  const middle = box(100, 300)
  assert.equal(scrollsInside(middle.line, -40), true, 'up, with lines above it')
  assert.equal(scrollsInside(middle.line, 40), true, 'down, with lines below it')

  const top = box(0, 300)
  assert.equal(scrollsInside(top.line, -40), false, 'at its top, up goes on to the transcript')

  const end = box(300, 300)
  assert.equal(scrollsInside(end.line, 40), false, 'at its end, down goes on to the transcript')

  assert.equal(scrollsInside(outside, -40), false, 'outside any box the wheel is the transcript')
  assert.equal(scrollsInside(null, -40), false)
})
