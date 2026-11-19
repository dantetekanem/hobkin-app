import assert from 'node:assert/strict'
import { test } from 'node:test'
import { drawMore, NEWEST_STEPS, newestOf } from '../src/features/agent-activity/newest.ts'

const steps = (count: number) => Array.from({ length: count }, (_, index) => `step ${index}`)

test('a short conversation draws every step, with none before them', () => {
  assert.deepEqual(newestOf(steps(12), NEWEST_STEPS), { shown: steps(12), earlier: 0 })
  assert.deepEqual(newestOf(steps(40), NEWEST_STEPS), { shown: steps(40), earlier: 0 })
})

test('a long conversation starts at its newest forty and says how many came before', () => {
  const { shown, earlier } = newestOf(steps(130), NEWEST_STEPS)
  assert.equal(NEWEST_STEPS, 40)
  assert.equal(shown.length, 40)
  assert.equal(shown[0], 'step 90')
  assert.equal(shown.at(-1), 'step 129')
  assert.equal(earlier, 90)
})

test('each press draws forty more, and never past the first step', () => {
  let drawn = NEWEST_STEPS
  drawn = drawMore(drawn, 130)
  assert.deepEqual(newestOf(steps(130), drawn).earlier, 50)
  drawn = drawMore(drawn, 130)
  assert.deepEqual(newestOf(steps(130), drawn).earlier, 10)
  drawn = drawMore(drawn, 130)
  assert.equal(drawn, 130)
  assert.deepEqual(newestOf(steps(130), drawn), { shown: steps(130), earlier: 0 })
  assert.equal(drawMore(drawn, 130), 130)
})

test('a new step keeps the newest forty drawn: the oldest drawn one moves above them', () => {
  const before = newestOf(steps(60), NEWEST_STEPS)
  const after = newestOf(steps(61), NEWEST_STEPS)
  assert.equal(after.shown.length, 40)
  assert.equal(after.shown.at(-1), 'step 60')
  assert.equal(after.shown[0], 'step 21')
  assert.equal(after.earlier, before.earlier + 1)
})

test('the same steps drawn whole come back as the same list, so nothing draws again for them', () => {
  const short = steps(10)
  assert.equal(newestOf(short, NEWEST_STEPS).shown, short)
})
