import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HoldingKind, WorkHolding } from '#shared/protocol/work.ts'
import { clockTime } from '../src/features/reports/time.ts'
import { statusLine, type StatusInput } from '../src/features/work/work-status.ts'
import { sentence } from '../src/features/work/workload.ts'

const NOW = new Date(2026, 10, 21, 13, 40).getTime()
const at = (hour: number, minute = 0, day = 21) => new Date(2026, 10, day, hour, minute).toISOString()

const base: StatusInput = {
  enabled: true,
  autoPick: true,
  held: null,
  forecast: 'Next 8h: about 5 jobs · 2 agents at a time.',
  holding: null,
  outlook: { startedToday: 3, moreToday: 6, nextAt: at(14, 20) },
  allowance: null,
}

const held = (kind: HoldingKind, line: string, until: string | null = null): StatusInput => ({ ...base, holding: { kind, line, until } satisfies WorkHolding, outlook: { startedToday: 3, moreToday: 0, nextAt: null } })

test('while nothing holds work mode, the line says when the next change starts and how many more start today', () => {
  const line = statusLine(base, NOW)
  assert.equal(line.tone, 'go')
  assert.equal(line.text, `${sentence(`Next change starts at ${clockTime(Date.parse(at(14, 20)))}`)} About 6 more start today, 3 so far.`)
  assert.equal(line.control, null)

  assert.equal(statusLine({ ...base, outlook: { startedToday: 1, moreToday: 0, nextAt: null } }, NOW).text, 'Nothing more starts today. 1 started so far.')
  assert.equal(statusLine({ ...base, outlook: { startedToday: 0, moreToday: 2, nextAt: at(13, 40) } }, NOW).text, 'The next change starts now. About 2 more start today.')
  // A next start tomorrow says nothing of more today.
  assert.equal(statusLine({ ...base, outlook: { startedToday: 0, moreToday: 1, nextAt: at(9, 5, 22) } }, NOW).text, sentence(`Next change starts tomorrow at ${clockTime(Date.parse(at(9, 5, 22)))}`))
})

test("the line names the one thing that holds work mode in hobkin's words, with the control that changes it", () => {
  const off = statusLine({ ...held('off', 'Work mode is off, so nothing starts by itself.'), enabled: false }, NOW)
  assert.deepEqual([off.tone, off.text, off.control], ['off', 'Work mode is off, so nothing starts by itself.', { label: 'Turn on', act: { do: 'mode-on' } }])

  const tokens = statusLine(held('tokens', "100M of today's 100M tokens are used, so nothing new starts until midnight.", at(24)), NOW)
  assert.equal(tokens.tone, 'held')
  assert.equal(tokens.text, "100M of today's 100M tokens are used, so nothing new starts until midnight.")
  assert.deepEqual(tokens.control, { label: 'Raise tokens a day', act: { do: 'sheet', at: 'dailyTokens' } })

  // hobkin asked to add today's amount again: the line answers that request.
  const asked = statusLine({ ...held('tokens', "100M of today's 100M tokens are used, so nothing new starts until midnight.", at(24)), allowance: { at: '2026-11-21T18:10:00.000Z', limit: 100_000_000, proposed: 200_000_000, used: 100_000_000 } }, NOW)
  assert.deepEqual(asked.control, { label: "Add today's amount again", act: { do: 'allowance', at: '2026-11-21T18:10:00.000Z' } })

  const controls: [HoldingKind, string, unknown][] = [
    ['hourly-share', "This hour's share of 8.3M tokens is used, so nothing new starts until about 14:00.", { label: 'Raise tokens a day', act: { do: 'sheet', at: 'dailyTokens' } }],
    ['hours', 'Work hours are 09:00 to 18:00, so nothing new starts until 09:00.', { label: 'Change hours', act: { do: 'sheet', at: 'hours' } }],
    ['cap', "5 of today's 5 changes have started, so the next starts after midnight.", { label: 'Raise the cap', act: { do: 'sheet', at: 'changesADay' } }],
    ['ship-first', '8 finished changes wait for you, so new work holds until fewer than 8 wait.', { label: 'Turn ship first off', act: { do: 'workload', change: { shipFirst: false } } }],
    ['auto-pick-off', 'Auto-pick is off, so only what you start runs.', { label: 'Turn on', act: { do: 'workload', change: { autoPick: true } } }],
    ['agents-busy', 'All 2 agents are busy, so the next start waits for one to finish.', { label: 'More agents', act: { do: 'sheet', at: 'agents' } }],
    ['usage-limit', 'A usage limit holds new work until 15:30.', null],
    // Turning work mode on ends a pause by hand (hobkin's startWork), so the line offers it; nothing the window sends ends the rest.
    ['paused', 'Paused by hand, so nothing new starts until work mode resumes.', { label: 'Resume', act: { do: 'mode-on' } }],
    ['paused', 'Every project with work queued is paused.', null],
    ['nothing-queued', 'Nothing is queued, so nothing starts.', null],
  ]
  const subscription = statusLine(held('paused', 'Paused until 16:00 to protect the subscription, as you chose.', at(16)), NOW)
  assert.deepEqual([subscription.tone, subscription.control], ['held', null], 'a pause that ends by itself at a time')
  for (const [kind, words, control] of controls) {
    const line = statusLine(held(kind, words), NOW)
    assert.equal(line.text, words, kind)
    assert.equal(line.tone, kind === 'nothing-queued' ? 'go' : 'held', kind)
    assert.deepEqual(line.control, control, kind)
  }
})

test("a host that sends neither what holds work mode nor the outlook keeps today's held and forecast words", () => {
  const older: StatusInput = { enabled: true, autoPick: false, held: null, forecast: 'Next 8h: about 5 jobs · 2 agents at a time. Auto-pick is off, so only picks and work on finished branches start.' }
  assert.deepEqual(statusLine(older, NOW), { tone: 'go', text: older.forecast, control: null })

  const paused = statusLine({ ...older, held: 'Paused for today: 100M of the 100M daily limit used. Resumes tomorrow.' }, NOW)
  assert.deepEqual([paused.tone, paused.text], ['held', 'Paused for today: 100M of the 100M daily limit used. Resumes tomorrow.'])

  assert.equal(statusLine({ ...older, forecast: null }, NOW).text, 'Auto-pick is off, so only what you start runs.')
  assert.equal(statusLine({ ...older, forecast: null, autoPick: true }, NOW).text, 'The top of the queue starts by itself.')
  const off = statusLine({ ...older, enabled: false }, NOW)
  assert.deepEqual([off.tone, off.control], ['off', { label: 'Turn on', act: { do: 'mode-on' } }])
  assert.equal(off.text, 'Nothing new starts. Agents that are running finish what they started, and projects, items and branches stay.')
})
