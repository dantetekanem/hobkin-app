import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import { mountCounting } from './render-count.ts'

mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 10_000_000 })
const { nextMoodChange, shownMood } = await import('../src/features/chat/mood.ts')
const { useWakeAt } = await import('../src/features/chat/use-now.ts')
after(() => mock.timers.reset())

const MINUTE = 60_000
const quiet = { busy: false, running: false, typing: false, asked: false, waiting: false, searching: false, tooling: false, busyMs: 0 }

test('the face waits for the moment its mood would change by the clock, and for nothing else', () => {
  const now = 1_000_000
  const reaction = { mood: 'happy', until: now + 4000 }
  assert.equal(nextMoodChange({ reaction, busy: false, startedAt: null }, now), now + 4000, 'a reaction ends')
  assert.equal(nextMoodChange({ reaction: null, busy: true, startedAt: now - MINUTE }, now), now + 4 * MINUTE, 'a turn becomes long at five minutes')
  assert.equal(nextMoodChange({ reaction, busy: true, startedAt: now - MINUTE }, now), now + 4000, 'whichever comes first')
  assert.equal(nextMoodChange({ reaction: { ...reaction, until: now - 1 }, busy: false, startedAt: null }, now), null, 'a reaction that ended changes nothing more')
  assert.equal(nextMoodChange({ reaction: { mood: 'sleepy', until: now + 4000, lasting: true }, busy: false, startedAt: null }, now), null, 'sleep holds until the user wakes it')
  assert.equal(nextMoodChange({ reaction: null, busy: false, startedAt: null }, now), null)

  // The moments are the ones at which shownMood changes.
  const turn = { ...quiet, busy: true }
  assert.equal(shownMood({ ...turn, reaction: null, busyMs: 5 * MINUTE - 1, now }).mood, 'thinking')
  assert.equal(shownMood({ ...turn, reaction: null, busyMs: 5 * MINUTE, now }).mood, 'focused')
  assert.equal(shownMood({ ...quiet, reaction, now: now + 3999 }).mood, 'happy')
  assert.equal(shownMood({ ...quiet, reaction, now: now + 4000 }).mood, 'idle')
})

test('a part that waits for a moment draws once at it, not each second before', async () => {
  let draws = 0
  const at = Date.now() + 5000
  const Face = () => {
    draws += 1
    useWakeAt(Date.now() < at ? at : null)
    return null
  }
  const mounted = await mountCounting(() => createElement(Face))
  for (let second = 0; second < 4; second++) await mounted.change(() => mock.timers.tick(1000))
  assert.equal(draws, 1)
  await mounted.change(() => mock.timers.tick(1001))
  assert.equal(draws, 2)
  for (let second = 0; second < 4; second++) await mounted.change(() => mock.timers.tick(1000))
  assert.equal(draws, 2)
  await mounted.unmount()
})
