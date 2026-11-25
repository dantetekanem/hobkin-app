import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CatchUpState } from '#shared/protocol/reports.ts'
import { HostConnection } from '../src/lib/host/connection.ts'
import { SAMPLE_CATCH_UP, catchUpValue, parseDaily, parsePile, useCatchUp } from '../src/features/settings/catch-up.ts'

const hobkin: CatchUpState = { daily: '08:00', pileUp: 8, running: false, lastAt: null, uncovered: 2 }

test('the heading says which triggers are on', () => {
  assert.equal(catchUpValue({ ...hobkin }), 'Daily at 08:00 and at 8 unread')
  assert.equal(catchUpValue({ ...hobkin, pileUp: null }), 'Daily at 08:00')
  assert.equal(catchUpValue({ ...hobkin, daily: null }), 'At 8 unread')
  assert.equal(catchUpValue({ ...hobkin, daily: null, pileUp: null }), 'Off')
  assert.equal(catchUpValue(SAMPLE_CATCH_UP), 'Daily at 08:00 and at 8 unread', "with no host the tile shows hobkin's defaults")
})

test('a typed time and pile size are read as hobkin takes them, or not at all', () => {
  assert.equal(parseDaily('07:30'), '07:30')
  assert.equal(parseDaily('07:30:00'), '07:30', 'a time field that sends seconds')
  assert.equal(parseDaily('24:00'), null)
  assert.equal(parseDaily(''), null)
  assert.equal(parsePile(' 12 '), 12)
  assert.equal(parsePile('1000'), 1000)
  assert.equal(parsePile('0'), null)
  assert.equal(parsePile('2.5'), null)
  assert.equal(parsePile('1001'), null)
})

test("the triggers read hobkin's settings, save each change, come back with the value they had and go back when hobkin refuses", async (t) => {
  const calls: unknown[] = []
  let saved = { ...hobkin }
  let refuse = false
  t.mock.method(HostConnection.prototype, 'command', async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args])
    if (name === 'reports.catchup.read') return saved
    if (refuse) throw new Error('The daily time is HH:MM, such as 08:00.')
    saved = { ...saved, ...args }
    return saved
  })
  useCatchUp.setState({ state: null, kept: { daily: '08:00', pileUp: 8 }, problem: null })

  await useCatchUp.getState().load()
  assert.deepEqual(useCatchUp.getState().state, hobkin)

  await useCatchUp.getState().change({ daily: '07:15' })
  await useCatchUp.getState().turnDaily(false)
  assert.equal(useCatchUp.getState().state?.daily, null)
  await useCatchUp.getState().turnDaily(true)
  assert.equal(useCatchUp.getState().state?.daily, '07:15', 'turned on again, the daily catch-up keeps its time')
  await useCatchUp.getState().turnPile(false)
  assert.deepEqual(calls, [
    ['reports.catchup.read', {}],
    ['reports.catchup.set', { daily: '07:15' }],
    ['reports.catchup.set', { daily: null }],
    ['reports.catchup.set', { daily: '07:15' }],
    ['reports.catchup.set', { pileUp: null }],
  ])

  refuse = true
  const changing = useCatchUp.getState().change({ daily: '09:00' })
  assert.equal(useCatchUp.getState().state?.daily, '09:00', 'the row moves at once')
  await changing
  assert.equal(useCatchUp.getState().state?.daily, '07:15', 'and goes back when hobkin did not save it')
  assert.equal(useCatchUp.getState().problem, 'Not saved: The daily time is HH:MM, such as 08:00.')
})
