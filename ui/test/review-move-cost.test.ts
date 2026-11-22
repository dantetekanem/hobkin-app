import assert from 'node:assert/strict'
import { test } from 'node:test'
import { levelsWork } from '../src/features/review/graph/levels.ts'
import { largeReview } from '../src/features/review/sample/large.ts'
import { createReviewMemory, throttledStorage } from '../src/features/review/state/memory.ts'
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

test('moving through 50 steps writes the review memory to storage at most once a second, and the last place on close', () => {
  const clock = handClock()
  const writes: { at: number; value: string }[] = []
  const storage = throttledStorage({ getItem: () => null, setItem: (_name, value) => void writes.push({ at: clock.now(), value }), removeItem: () => {} }, { every: 1000, clock })
  const session = createSession(large, createReviewMemory(storage))
  const steps = session.getState().view.story.length
  for (let move = 0; move < 50; move += 1) {
    const before = writes.length
    session.getState().goTo((move % (steps - 1)) + 1)
    assert.equal(writes.length, before, 'a move writes nothing by itself')
    clock.advance(100)
  }
  // Five seconds of moves: a write each second at most.
  assert.ok(writes.length >= 1 && writes.length <= 6, `${writes.length} writes`)
  for (let index = 1; index < writes.length; index += 1) assert.ok(writes[index]!.at - writes[index - 1]!.at >= 1000, 'a second apart')

  // Closing the review writes what is left at once.
  session.getState().goTo(3)
  storage.flush()
  const saved = JSON.parse(writes.at(-1)!.value) as { state: { reviews: Record<string, { progress: { step: string } }> } }
  assert.equal(Object.values(saved.state.reviews)[0]!.progress.step, session.getState().view.story[3]!.id)
  assert.equal(storage.getItem('anything'), null)
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
