import assert from 'node:assert/strict'
import { test } from 'node:test'
import { followAfter, SLACK, START, type Follow, type FollowEvent } from '../src/features/chat/follow.ts'

/** The conversation's box is 600 high. */
const CLIENT = 600

/** A scroll to `top` in content `height` high: whatever moved it, the user or the layout. */
const scrolled = (top: number, height: number): FollowEvent => ({ type: 'scroll', top, scrollHeight: height, clientHeight: CLIENT })

const run = (events: FollowEvent[], from: Follow = START) => events.reduce(followAfter, from)

/** Following, resting at the end of content 2000 high. */
const restingAtEnd = run([scrolled(2000 - CLIENT, 2000)])

test('the view starts following', () => {
  assert.equal(START.following, true)
  assert.equal(restingAtEnd.following, true)
})

test('content that shrinks, or a glide that settles, never stops the following', () => {
  // A reply replaced by its stored copy, a waiting line gone: the browser pulls the view up to the new end.
  assert.equal(run([scrolled(1340, 1940)], restingAtEnd).following, true)
  // While a glide draws the list below its place, the content looks longer than it is, far past the slack.
  assert.equal(run([scrolled(1399, 2000 + SLACK + 100)], restingAtEnd).following, true)
})

test('a wheel or trackpad moving up stops the following', () => {
  const read = run([{ type: 'wheel', deltaY: -4, top: 1400 }, scrolled(1396, 2000)], restingAtEnd)
  assert.equal(read.following, false)
  // Still close to the end, but moving up: the user is reading, not back at the end.
  assert.equal(run([scrolled(1390, 2000)], read).following, false)
})

test('a wheel moving down, or moving up with nothing above, leaves the view following', () => {
  assert.equal(run([{ type: 'wheel', deltaY: 12, top: 1400 }], restingAtEnd).following, true)
  assert.equal(run([{ type: 'wheel', deltaY: -12, top: 0 }]).following, true)
})

test('keys that read up stop the following, and other keys do not', () => {
  for (const key of ['ArrowUp', 'PageUp', 'Home']) assert.equal(run([{ type: 'key', key }], restingAtEnd).following, false, key)
  assert.equal(run([{ type: 'key', key: ' ', shiftKey: true }], restingAtEnd).following, false)
  for (const key of ['ArrowDown', 'PageDown', 'End', ' ', 'a']) assert.equal(run([{ type: 'key', key }], restingAtEnd).following, true, key)
})

test('a drag up on the conversation or its scroll bar stops the following, and only while pressed', () => {
  assert.equal(run([{ type: 'press' }, scrolled(1200, 2000)], restingAtEnd).following, false)
  assert.equal(run([{ type: 'press' }, { type: 'release' }, scrolled(1200, 2000)], restingAtEnd).following, true)
})

test('scrolling back down to the end follows again', () => {
  const read = run([{ type: 'wheel', deltaY: -100, top: 1400 }, scrolled(900, 2000)], restingAtEnd)
  assert.equal(run([scrolled(1200, 2000)], read).following, false)
  assert.equal(run([scrolled(1200, 2000), scrolled(2000 - CLIENT - SLACK, 2000)], read).following, true)
})

test('asking for the newest message follows again and ends any drag', () => {
  const read = run([{ type: 'press' }, scrolled(900, 2000)], restingAtEnd)
  const back = run([{ type: 'jump' }], read)
  assert.deepEqual([back.following, back.pressed], [true, false])
  // The jump's own scroll down to the end keeps it, and layout after it does not stop it.
  assert.equal(run([scrolled(1400, 2000), scrolled(1380, 1980)], back).following, true)
})
