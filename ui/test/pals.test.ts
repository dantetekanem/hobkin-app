import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SLEEP_AFTER_MS, crabMoodOf, palsState, restedLong } from '../src/avatar/pals.ts'

test("the crab takes each of hobkin's moods as one of its own", () => {
  assert.equal(crabMoodOf('working'), 'working')
  assert.equal(crabMoodOf('focused'), 'working', 'it taps its claws whenever hobkin works')
  assert.equal(crabMoodOf('celebrating'), 'happy')
  assert.equal(crabMoodOf('confused'), 'listening', 'it leans in when hobkin is puzzled')
  assert.equal(crabMoodOf('error'), 'sad')
  assert.equal(crabMoodOf('sleepy'), 'sleepy')
})

test("while a run works the crab moves in the face's mood, and while it waits the crab leans in and holds", () => {
  assert.deepEqual(palsState({ mood: 'working' }), { face: 'working', crab: 'working', moving: true })
  assert.deepEqual(palsState({ mood: 'searching' }), { face: 'searching', crab: 'searching', moving: true })
  assert.deepEqual(palsState({ mood: 'working', asking: true }), { face: 'working', crab: 'listening', moving: true }, 'asking the user')
  assert.deepEqual(palsState({ mood: 'idle', working: false }), { face: 'idle', crab: 'listening', moving: false }, 'between turns')
})

test('both are happy when a run ends well, and both sleep once they have rested long', () => {
  assert.deepEqual(palsState({ mood: 'idle', working: false, endedWell: true }), { face: 'happy', crab: 'happy', moving: false })
  assert.deepEqual(palsState({ mood: 'idle', working: false, restedLong: true }), { face: 'sleepy', crab: 'sleepy', moving: false })
  assert.deepEqual(palsState({ mood: 'working', restedLong: true }), { face: 'working', crab: 'working', moving: true }, 'a working run never sleeps')
})

test('the pair has rested long ten minutes after it began to rest', () => {
  const since = Date.parse('2026-11-23T10:00:00.000Z')
  assert.equal(SLEEP_AFTER_MS, 10 * 60_000)
  assert.equal(restedLong(since, since + SLEEP_AFTER_MS - 1), false)
  assert.equal(restedLong(since, since + SLEEP_AFTER_MS), true)
  assert.equal(restedLong(undefined, since), false, 'a run not resting')
  assert.equal(restedLong(Number.NaN, since), false, 'an unreadable time')
})
