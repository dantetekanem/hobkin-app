import assert from 'node:assert/strict'
import { test } from 'node:test'
import { holdOf, isStalled, logLine, parseLog, parseLogLine } from '../src/features/routines/holds.ts'
import type { RunLine, RunStatus } from '../src/features/routines/types.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const START = Date.parse('2026-11-01T14:00:00.000Z')

/** Runs a day apart, oldest first, as a log file has them. */
function runs(...outcomes: (RunStatus | [RunStatus, string])[]): RunLine[] {
  return outcomes.map((outcome, index) => {
    const [status, summary] = typeof outcome === 'string' ? [outcome, `${outcome} run ${index + 1}`] : outcome
    return { finishedAt: new Date(START + index * DAY).toISOString(), trigger: 'scheduled', status, seconds: 40, usd: 0.1, summary }
  })
}

const lastOf = (lines: RunLine[]) => Date.parse(lines.at(-1)!.finishedAt)

test('a log line reads back as a run', () => {
  assert.deepEqual(parseLogLine('- 2026-11-09T14:01:12.000Z | scheduled | completed | 72s | $0.18 | Useful: 3 things worth a look.'), {
    finishedAt: '2026-11-09T14:01:12.000Z',
    trigger: 'scheduled',
    status: 'completed',
    seconds: 72,
    usd: 0.18,
    summary: 'Useful: 3 things worth a look.',
  })
})

test('a log line without a cost, and one whose report has bars in it', () => {
  const failed = parseLogLine('- 2026-11-09T14:00:05.000Z | manual | failed | 5s | Pi exited with code 1')
  assert.equal(failed?.usd, null)
  assert.equal(failed?.trigger, 'manual')
  assert.equal(failed?.summary, 'Pi exited with code 1')

  const barred = parseLogLine('- 2026-11-09T14:00:05.000Z | scheduled | no_change | 31s | $0.04 | Nothing new | 2 feeds read | 0 kept')
  assert.equal(barred?.summary, 'Nothing new | 2 feeds read | 0 kept')
  assert.equal(barred?.usd, 0.04)
})

test('a line that is not a run is left out', () => {
  assert.equal(parseLogLine(''), null)
  assert.equal(parseLogLine('# Log'), null)
  assert.equal(parseLogLine('- not a time | scheduled | completed | 3s | fine'), null)
  assert.equal(parseLogLine('- 2026-11-09T14:00:05.000Z | scheduled | completed | soon | fine'), null)
  assert.equal(parseLog('- 2026-11-09T14:00:05.000Z | scheduled | completed | 3s | fine\n\nnoise\n').length, 1)
})

test('an outcome this app does not know is kept as written', () => {
  assert.equal(parseLogLine('- 2026-11-09T14:00:05.000Z | scheduled | exploded | 3s | fine')?.status, 'exploded')
})

test('a run writes the same line hobkin does', () => {
  const line = '- 2026-11-09T14:01:12.000Z | scheduled | completed | 72s | $0.18 | Useful: 3 things worth a look.'
  assert.equal(logLine(parseLogLine(line)!), line)
  assert.equal(logLine({ finishedAt: '2026-11-09T14:00:05.000Z', trigger: 'manual', status: 'failed', seconds: 5, usd: null, summary: 'Pi exited with code 1' }), '- 2026-11-09T14:00:05.000Z | manual | failed | 5s | Pi exited with code 1')
})

test('a run stalls when it fails, stops short, or reports that it is blocked', () => {
  const [failed, incomplete, blocked, fine, quiet, interrupted, failedBlocked] = runs(
    'failed',
    'incomplete',
    ['completed', 'Blocked: The calendar sign-in expired.'],
    ['completed', 'Useful: 2 meetings today.'],
    'no_change',
    'interrupted',
    ['failed', 'Blocked: this is an error text, not a report'],
  )

  assert.equal(isStalled(failed!), true)
  assert.equal(isStalled(incomplete!), true)
  assert.equal(isStalled(blocked!), true)
  assert.equal(isStalled(fine!), false)
  assert.equal(isStalled(quiet!), false)
  assert.equal(isStalled(interrupted!), false)
  assert.equal(isStalled(failedBlocked!), true)
})

test('two stalled runs in a row hold the routine for a day after the latest one', () => {
  const log = runs('completed', 'failed', ['failed', 'Pi exited with code 1'])
  const hold = holdOf(log, lastOf(log) + HOUR)

  assert.deepEqual(hold, { until: new Date(lastOf(log) + DAY).toISOString(), reason: 'Pi exited with code 1' })
  assert.equal(holdOf(runs('completed', 'failed'), START + DAY + HOUR), null, 'one stalled run is not a hold')
})

test('each further stalled run doubles the wait, up to a week', () => {
  const days = (stalled: number) => {
    const log = runs('completed', ...Array.from({ length: stalled }, () => 'failed' as const))
    const hold = holdOf(log, lastOf(log) + 1)
    return hold ? (Date.parse(hold.until) - lastOf(log)) / DAY : 0
  }

  assert.deepEqual([2, 3, 4, 5, 6, 9].map(days), [1, 2, 4, 7, 7, 7])
})

test('a hold gives the reason of the latest stalled run', () => {
  const blocked = runs('failed', ['completed', 'Blocked: The calendar sign-in expired.'])
  assert.equal(holdOf(blocked, lastOf(blocked) + 1)?.reason, 'The calendar sign-in expired.', 'a blocked report gives what it said after the word')

  const bold = runs('failed', ['completed', '**Blocked:** The notes folder is missing.'])
  assert.equal(holdOf(bold, lastOf(bold) + 1)?.reason, 'The notes folder is missing.')

  const cut = runs('incomplete', ['incomplete', 'Stopped after 40 turns without a report.'])
  assert.equal(holdOf(cut, lastOf(cut) + 1)?.reason, 'Stopped after 40 turns without a report.')
})

test('a run that worked ends the streak, and a run that was interrupted says nothing', () => {
  const recovered = runs('failed', 'failed', 'completed')
  assert.equal(holdOf(recovered, lastOf(recovered) + 1), null)

  const quiet = runs('failed', 'failed', 'no_change')
  assert.equal(holdOf(quiet, lastOf(quiet) + 1), null)

  const interrupted = runs('failed', 'interrupted', 'failed')
  assert.equal(holdOf(interrupted, lastOf(interrupted) + 1)?.until, new Date(lastOf(interrupted) + DAY).toISOString(), 'the two failures still stand side by side')

  const lastInterrupted = runs('failed', 'failed', 'interrupted')
  assert.equal(holdOf(lastInterrupted, START + DAY + HOUR)?.until, new Date(START + 2 * DAY).toISOString(), 'the wait counts from the latest run that says something')
})

test('a hold is over once its wait has passed', () => {
  const log = runs('failed', 'failed')

  assert.notEqual(holdOf(log, lastOf(log) + DAY - 1), null)
  assert.equal(holdOf(log, lastOf(log) + DAY), null)
})

test('runs from before the schedule was changed no longer count', () => {
  const log = runs('failed', 'failed', 'failed')

  assert.notEqual(holdOf(log, lastOf(log) + 1), null)
  assert.equal(holdOf(log, lastOf(log) + 1, lastOf(log) + 1), null, 'changed after all three')
  assert.equal(holdOf(log, lastOf(log) + 1, lastOf(log) - HOUR), null, 'only one stalled run since the change')
  assert.equal(holdOf(log, lastOf(log) + 1, START - HOUR)?.until, new Date(lastOf(log) + 2 * DAY).toISOString(), 'changed before all three')
})
