import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STAMP_SHAPES, stampOf } from '../src/features/agent-activity/stamp.ts'
import { clockTime } from '../src/features/reports/time.ts'

// Local times, so the rules hold in any time zone the tests run in.
const at = (month: number, day: number, hour: number, minute: number, second: number, year = 2026) => new Date(year, month - 1, day, hour, minute, second).getTime()

test('a step says when it happened to the second, in the conversation\'s own clock', () => {
  const when = at(11, 15, 19, 26, 5)
  const stamp = stampOf(when, at(11, 15, 21, 0, 0))!
  // The conversation's "07:26 PM" or "19:26", with its seconds.
  assert.match(stamp.time, /^(07|19):26:05/)
  assert.equal(stamp.time.replace(':05', ''), clockTime(when))
  assert.equal(stamp.iso, new Date(when).toISOString())
})

test('a step from another day says its date too, and one from another year its year', () => {
  const now = at(11, 15, 9, 0, 0)
  assert.equal(stampOf(at(11, 15, 0, 0, 1), now)!.date, null)
  assert.equal(stampOf(at(11, 14, 19, 26, 5), now)!.date, 'Nov 14')
  // A calendar day, not the last 24 hours: a minute before midnight is yesterday a minute after it.
  assert.equal(stampOf(at(11, 14, 23, 59, 0), at(11, 15, 0, 1, 0))!.date, 'Nov 14')
  assert.equal(stampOf(at(12, 31, 18, 0, 0, 2025), at(1, 2, 8, 0, 0))!.date, 'Dec 31, 2025')
})

test('hobkin\'s written times read as its numbers do, and a step with no time has no stamp', () => {
  const when = at(11, 15, 7, 3, 9)
  assert.deepEqual(stampOf(new Date(when).toISOString(), when), stampOf(when, when))
  for (const none of [undefined, null, '', 'not a time', Number.NaN]) assert.equal(stampOf(none, when), null)
})

test('the column is as wide as the widest time of day, whatever the hour', () => {
  const shape = (time: string) => time.replace(/\d/g, '0')
  const shapes = new Set(STAMP_SHAPES.map(shape))
  for (let hour = 0; hour < 24; hour++) assert.ok(shapes.has(shape(stampOf(at(11, 15, hour, 7, 9), at(11, 15, 23, 0, 0))!.time)), `hour ${hour}`)
})
