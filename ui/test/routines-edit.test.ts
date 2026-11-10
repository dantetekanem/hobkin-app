import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkTimes, checkWindow, timesText } from '../src/features/routines/edit.ts'

const refused = (result: { ok: boolean; message?: string }): string => {
  assert.equal(result.ok, false)
  return result.message ?? ''
}

test('one time is accepted and written the way hobkin stores it', () => {
  assert.deepEqual(checkTimes('09:30'), { ok: true, value: { at: '09:30' } })
  assert.deepEqual(checkTimes('  23:59 '), { ok: true, value: { at: '23:59' } })
  assert.deepEqual(checkTimes('00:00'), { ok: true, value: { at: '00:00' } })
  assert.deepEqual(checkTimes('9:30'), { ok: true, value: { at: '09:30' } }, 'an hour typed with one digit gets its zero')
})

test('several times are accepted, put in order, as a list', () => {
  assert.deepEqual(checkTimes('18:00, 09:00,12:00'), { ok: true, value: { at: ['09:00', '12:00', '18:00'] } })
  assert.deepEqual(checkTimes('09:00 13:00'), { ok: true, value: { at: ['09:00', '13:00'] } })
})

test('a time that is not a time of day is refused, and the message names it', () => {
  assert.match(refused(checkTimes('25:00')), /25:00/)
  assert.match(refused(checkTimes('09:60')), /09:60/)
  assert.match(refused(checkTimes('nine')), /nine/)
  assert.match(refused(checkTimes('09:00, 9am')), /9am/, 'the one that is wrong, not the whole list')
  assert.match(refused(checkTimes('0930')), /0930/)
  assert.match(refused(checkTimes('')), /time/i)
  assert.match(refused(checkTimes('  ,  ')), /time/i)
})

test('a time listed twice is refused', () => {
  assert.match(refused(checkTimes('09:00, 13:00, 9:00')), /09:00/)
})

test('more than 48 times a day is refused, and the message says how many there were', () => {
  const minutes = (count: number) => Array.from({ length: count }, (_, index) => `10:${String(index).padStart(2, '0')}`).join(', ')

  assert.equal(checkTimes(minutes(48)).ok, true)
  assert.match(refused(checkTimes(minutes(49))), /49/)
})

test('a window is accepted with its start, its end and its gap', () => {
  assert.deepEqual(checkWindow({ start: '08:00', end: '17:00', everyMinutes: '60' }), { ok: true, value: { window: { start: '08:00', end: '17:00', everyMinutes: 60 } } })
  assert.deepEqual(checkWindow({ start: '8:00', end: ' 8:00 ', everyMinutes: ' 15 ' }), { ok: true, value: { window: { start: '08:00', end: '08:00', everyMinutes: 15 } } }, 'a window of one check')
})

test('a window whose start or end is not a time of day is refused', () => {
  assert.match(refused(checkWindow({ start: '8am', end: '17:00', everyMinutes: '60' })), /8am/)
  assert.match(refused(checkWindow({ start: '08:00', end: '24:00', everyMinutes: '60' })), /24:00/)
})

test('a window that ends before it starts is refused', () => {
  assert.match(refused(checkWindow({ start: '17:00', end: '08:00', everyMinutes: '60' })), /before|later|after/i)
})

test('a gap that is not a whole number of minutes from 1 to 1440 is refused', () => {
  for (const everyMinutes of ['0', '-5', '1.5', '1441', 'often', '']) {
    assert.match(refused(checkWindow({ start: '08:00', end: '17:00', everyMinutes })), /1440/, everyMinutes)
  }
  assert.equal(checkWindow({ start: '00:00', end: '23:59', everyMinutes: '1440' }).ok, true)
})

test('a window with more than 48 checks is refused, and the message says how many it makes', () => {
  assert.equal(checkWindow({ start: '08:00', end: '19:45', everyMinutes: '15' }).ok, true, '48 checks')
  assert.match(refused(checkWindow({ start: '08:00', end: '20:00', everyMinutes: '15' })), /49/)
  assert.match(refused(checkWindow({ start: '00:00', end: '23:59', everyMinutes: '10' })), /144/)
})

test('the time field shows what the routine has now', () => {
  assert.equal(timesText({ at: '09:00' }), '09:00')
  assert.equal(timesText({ at: ['09:00', '13:00'] }), '09:00, 13:00')
  assert.equal(timesText({}), '')
})
