import assert from 'node:assert/strict'
import { test } from 'node:test'
import { levelsWork } from '../src/features/review/graph/levels.ts'
import { largeReview } from '../src/features/review/sample/large.ts'
import type { Review } from '#shared/review/types.ts'
import { createReviewMemory, memoryKey } from '../src/features/review/state/memory.ts'
import { leaveReview } from '../src/features/review/state/leave.ts'
import { createSession } from '../src/features/review/state/session.ts'

const large = largeReview().review

/** A clock the test moves by hand, with the timers it runs when their time comes. */
function handClock() {
  let now = 0
  let next = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  return {
    now: () => now,
    later: (run: () => void, ms: number) => {
      timers.set(next, { at: now + ms, run })
      return next++
    },
    cancel: (id: number) => void timers.delete(id),
    advance(ms: number) {
      now += ms
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue
        timers.delete(id)
        timer.run()
      }
    },
  }
}

test('moving through 50 steps turns no memory into text on a move: it is written at most once a second, and the review\'s close writes the last place', () => {
  const clock = handClock()
  const writes: { at: number; value: string }[] = []
  const memory = createReviewMemory({ getItem: () => null, setItem: (_name, value) => void writes.push({ at: clock.now(), value }), removeItem: () => {} }, { every: 1000, clock })
  const session = createSession(large, memory)
  const steps = session.getState().view.story.length
  // Every time the memory is turned into text is counted: that is what grows with every review kept.
  const stringify = JSON.stringify
  let serialized = 0
  JSON.stringify = ((...args: Parameters<typeof stringify>) => {
    serialized += 1
    return stringify(...args)
  }) as typeof JSON.stringify
  try {
    for (let move = 0; move < 50; move += 1) {
      const [before, wrote] = [serialized, writes.length]
      session.getState().goTo((move % (steps - 1)) + 1)
      assert.deepEqual([serialized, writes.length], [before, wrote], 'a move turns nothing into text and writes nothing')
      clock.advance(100)
    }
    // Five seconds of moves: a write each second at most, and the memory turned into text once for each.
    assert.ok(writes.length >= 1 && writes.length <= 6, `${writes.length} writes`)
    assert.equal(serialized, writes.length)
    for (let index = 1; index < writes.length; index += 1) assert.ok(writes[index]!.at - writes[index - 1]!.at >= 1000, 'a second apart')

    // The review closes as the screen closes it: what is left is written at once.
    session.getState().goTo(3)
    leaveReview({ session, memory, key: 'sample:large@abc', closed: true, camera: null })
    assert.equal(serialized, writes.length)
  } finally {
    JSON.stringify = stringify
  }
  const saved = JSON.parse(writes.at(-1)!.value) as { state: { reviews: Record<string, { progress: { step: string } }> } }
  assert.equal(Object.values(saved.state.reviews)[0]!.progress.step, session.getState().view.story[3]!.id)
})

test('the memory keeps the 30 reviews changed last, and never lets go of one that holds a note or a draft', () => {
  const memory = createReviewMemory()
  const reviewOf = (index: number) => ({ id: `change:p:r${index}`, snapshot: `${index}`.padStart(12, '0') }) as Review
  const progress = { step: 'outcome', seen: [], revealed: [] }
  memory.getState().addNote(reviewOf(0), { step: 'outcome', target: { kind: 'step' }, intent: 'comment', text: 'Keep me.' })
  for (let index = 0; index < 40; index += 1) memory.getState().saveProgress(reviewOf(index), progress)
  // The one changed again goes to the end, so it is the last to go.
  memory.getState().saveProgress(reviewOf(12), progress)
  memory.getState().saveProgress(reviewOf(40), progress)
  const kept = Object.keys(memory.getState().reviews)
  assert.equal(kept.length, 31, 'thirty, and the one with a note')
  assert.ok(kept.includes(memoryKey(reviewOf(0))), 'a note is never let go of')
  assert.ok(kept.includes(memoryKey(reviewOf(12))))
  for (let gone = 1; gone <= 10; gone += 1) assert.equal(kept.includes(memoryKey(reviewOf(gone))), false, `r${gone} is let go of`)
  assert.ok(kept.includes(memoryKey(reviewOf(11))))
  assert.equal(kept.at(-1), memoryKey(reviewOf(40)))
})

test('a move works out the levels of its focus once', () => {
  const session = createSession(large, createReviewMemory())
  for (const index of [1, 2, 3, 2]) {
    const before = levelsWork.runs
    session.getState().goTo(index)
    assert.equal(levelsWork.runs - before, 1, `the move to step ${index + 1}`)
  }
  const before = levelsWork.runs
  session.getState().focusOn(session.getState().view.nodes.at(-1)!.id)
  assert.equal(levelsWork.runs - before, 1, 'a detour')
})
