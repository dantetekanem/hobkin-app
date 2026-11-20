import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HostConnection } from '../src/lib/host/connection.ts'
import { shortReportsValue, useShortReports } from '../src/features/settings/short-reports.ts'

test('the switch reads hobkin\'s value, saves a click and puts it back when the save fails', async (t) => {
  const calls: unknown[] = []
  let refuse = false
  t.mock.method(HostConnection.prototype, 'command', async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args])
    if (name === 'short-reports.read') return { on: false }
    if (refuse) throw new Error('config.json could not be written.')
    return { on: args.on }
  })
  useShortReports.setState({ on: null, saving: false, problem: null })

  assert.equal(shortReportsValue(null), 'Off', 'until hobkin answers it reads as off, which is how a home starts')
  await useShortReports.getState().load()
  assert.equal(useShortReports.getState().on, false)
  assert.equal(shortReportsValue(false), 'Off')

  await useShortReports.getState().turn(true)
  assert.deepEqual(calls, [['short-reports.read', {}], ['short-reports.set', { on: true }]])
  assert.equal(useShortReports.getState().on, true)
  assert.equal(shortReportsValue(true), 'On')
  assert.equal(useShortReports.getState().problem, null)

  refuse = true
  const turning = useShortReports.getState().turn(false)
  assert.equal(useShortReports.getState().on, false, 'the switch moves at once')
  assert.equal(useShortReports.getState().saving, true)
  await turning
  assert.equal(useShortReports.getState().on, true, 'and goes back when hobkin did not save it')
  assert.equal(useShortReports.getState().saving, false)
  assert.match(useShortReports.getState().problem ?? '', /Not saved: config\.json could not be written\./)
})
