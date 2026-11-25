import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HostConnection } from '../src/lib/host/connection.ts'
import { catchUpOffered, sinceLastLook } from '../src/features/reports/briefing.ts'
import { askCatchUp, CATCH_UP_SAMPLE_LINE } from '../src/features/reports/catch-up.ts'
import { countsAsRead, kindOf, sourceOf, type Report } from '../src/features/reports/report.ts'
import { reportLinkOf } from '../src/features/reports/report-link.ts'

const report = (id: string, over: Partial<Report> = {}): Report => ({
  id,
  title: `Report ${id}`,
  scheduleId: 'morning-recap',
  at: '2026-11-24T08:00:00.000Z',
  body: 'Useful: Something was found.',
  outcome: 'completed',
  ...over,
})

test('a report read in the reader or counted by a catch-up reads as read; one with neither is unread', () => {
  assert.equal(countsAsRead(report('a', { readState: 'read' })), true)
  assert.equal(countsAsRead(report('a', { readState: 'caught-up' })), true)
  assert.equal(countsAsRead(report('a')), false)
  assert.equal(countsAsRead({ ...report('a'), readState: 'skimmed' } as unknown as Report), false, 'a state this window has no name for is not read')
})

test("a catch-up is a kind of its own, from hobkin's catch-up", () => {
  assert.equal(kindOf(report('a', { scheduleId: 'catch-up' })), 'catch-up')
  assert.equal(sourceOf(report('a', { scheduleId: 'catch-up' })), 'Catch-up')
  assert.equal(kindOf(report('a', { scheduleId: 'catch-up-notes' })), 'scheduled', 'only the exact source is a catch-up')
})

test("a hobkin-report link names the report it opens, and any other address names none", () => {
  assert.equal(reportLinkOf('hobkin-report:run-backup-check'), 'run-backup-check')
  assert.equal(reportLinkOf('hobkin-report:local:recap:1'), 'local:recap:1', 'an id may hold colons')
  assert.equal(reportLinkOf('hobkin-report:run%3A12'), 'run:12', 'an escaped id is read back')
  assert.equal(reportLinkOf('hobkin-report:%E0%A4%A'), '%E0%A4%A', 'a broken escape is kept as written')
  assert.equal(reportLinkOf('hobkin-report:'), null)
  assert.equal(reportLinkOf('https://example.com/hobkin-report:a'), null)
  assert.equal(reportLinkOf(undefined), null)
})

test('Catch me up is offered while a report a catch-up could cover is unread', () => {
  const list = [report('catch', { scheduleId: 'catch-up' }), report('recap'), report('deps')]
  assert.equal(catchUpOffered(list, new Set(['catch'])), true)
  assert.equal(catchUpOffered(list, new Set(['recap', 'deps'])), false, 'an unread catch-up is not covered by the next one')
  assert.equal(catchUpOffered(list, new Set(['catch', 'recap', 'deps'])), false)
  assert.equal(catchUpOffered([], new Set()), false)
})

test('a caught-up report counts as read for what is new, but is not a time the user looked', () => {
  const list = [
    report('fresh', { at: '2026-11-24T10:00:00.000Z' }),
    report('covered', { at: '2026-11-24T09:00:00.000Z', readState: 'caught-up' }),
    report('opened', { at: '2026-11-24T07:00:00.000Z', readState: 'read' }),
  ]
  const fresh = sinceLastLook(list, new Set(['covered', 'opened']), [])
  assert.equal(fresh?.since, Date.parse('2026-11-24T07:00:00.000Z'))
  assert.equal(fresh?.count, 1)
  assert.equal(fresh?.openId, 'fresh')
})

test("Catch me up says hobkin's answer, or hobkin's refusal, and asks nothing of a sample", async (t) => {
  const calls: unknown[] = []
  let refuse = false
  t.mock.method(HostConnection.prototype, 'command', async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args])
    if (refuse) throw new Error('There is nothing to catch up on.')
    return { message: 'Catching up on 9 reports. It shows in Reports in about a minute.' }
  })

  assert.deepEqual(await askCatchUp(false), { line: 'Catching up on 9 reports. It shows in Reports in about a minute.', refused: false })
  assert.deepEqual(calls, [['reports.catchup.run', {}]])
  refuse = true
  assert.deepEqual(await askCatchUp(false), { line: 'There is nothing to catch up on.', refused: true })
  assert.deepEqual(await askCatchUp(true), { line: CATCH_UP_SAMPLE_LINE, refused: false })
  assert.equal(calls.length, 2)
})
