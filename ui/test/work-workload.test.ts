import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clockTime } from '../src/features/reports/time.ts'
import { commandFor } from '../src/features/work/actions.ts'
import { applySample } from '../src/features/work/sample-actions.ts'
import { sampleWork } from '../src/features/work/sample.ts'
import {
  capChoices,
  capOf,
  capValue,
  forecastWords,
  hoursFrom,
  millionsOf,
  opensWorkload,
  pullsOf,
  pullsShown,
  sentence,
  tokensFromWords,
  workloadAction,
  workloadOf,
  WORKLOAD_DEFAULTS,
} from '../src/features/work/workload.ts'

const NOW = new Date(2026, 10, 21, 13, 40).getTime()

test('each setting of the sheet goes to its command: agents and tokens to their own, the rest to work.workload', () => {
  assert.deepEqual(commandFor(workloadAction({ agents: 4 })), { name: 'work.agents', args: { agents: 4 } })
  assert.deepEqual(commandFor(workloadAction({ dailyTokens: 250_000_000 })), { name: 'work.tokens', args: { tokens: 250_000_000 } })
  assert.deepEqual(commandFor(workloadAction({ autoPick: true })), { name: 'work.workload', args: { autoPick: true } })
  assert.deepEqual(commandFor(workloadAction({ changesADay: null })), { name: 'work.workload', args: { changesADay: null } })
  assert.deepEqual(commandFor(workloadAction({ changesADay: 5 })), { name: 'work.workload', args: { changesADay: 5 } })
  assert.deepEqual(commandFor(workloadAction({ hours: { from: '22:00', to: '06:30' } })), { name: 'work.workload', args: { hours: { from: '22:00', to: '06:30' } } })
  assert.deepEqual(commandFor(workloadAction({ shipFirst: false })), { name: 'work.workload', args: { shipFirst: false } })
  assert.deepEqual(commandFor(workloadAction({ shipFirstAt: 12 })), { name: 'work.workload', args: { shipFirstAt: 12 } })
  assert.deepEqual(commandFor(workloadAction({ reviewOnFinish: true })), { name: 'work.workload', args: { reviewOnFinish: true } })
  assert.deepEqual(commandFor(workloadAction({ reviewPulls: 'both' })), { name: 'work.workload', args: { reviewPulls: 'both' } })
  assert.deepEqual(commandFor({ do: 'allowance', at: '2026-11-21T18:10:00.000Z' }), { name: 'work.allowance', args: { at: '2026-11-21T18:10:00.000Z' } })
})

test('what each control shows for a setting, and the setting it gives back', () => {
  // Tokens a day: any whole number of millions from 1 up, typed with or without its M.
  assert.equal(millionsOf(100_000_000), 100)
  assert.equal(millionsOf(750_000_000), 750)
  assert.equal(tokensFromWords('250'), 250_000_000)
  assert.equal(tokensFromWords(' 3M '), 3_000_000)
  for (const wrong of ['0', '1.5', '-2', '', 'lots']) assert.equal(tokensFromWords(wrong), null, wrong)

  // Pull requests reviewed by themselves: two toggles for one setting.
  for (const pulls of ['none', 'mine', 'waiting', 'both'] as const) assert.equal(pullsOf(pullsShown(pulls)), pulls)
  assert.deepEqual(pullsShown('both'), { mine: true, waiting: true })
  assert.equal(pullsOf({ mine: false, waiting: true }), 'waiting')

  // Changes a day: no cap, a few round numbers, and the one set now.
  assert.deepEqual(capChoices(null).map((choice) => choice.value), ['none', '3', '5', '10', '20'])
  assert.deepEqual(capChoices(7).map((choice) => choice.label), ['No cap', '3', '5', '7', '10', '20'])
  assert.equal(capValue(null), 'none')
  assert.equal(capOf(capValue(null)), null)
  assert.equal(capOf(capValue(10)), 10)

  // Hours: both ends as HH:MM, and different.
  assert.deepEqual(hoursFrom('22:00', '06:30'), { from: '22:00', to: '06:30' })
  assert.ok('refused' in hoursFrom('09:00', '09:00'))
  assert.ok('refused' in hoursFrom('9:00', '18:00'))
})

test("a host older than the workload: the sheet shows the work state's own settings and hobkin's defaults for the rest", () => {
  const { workload: _gone, ...older } = sampleWork(NOW)
  const { settings, known } = workloadOf({ ...older, agentsAllowed: 3, autoPick: true, dailyTokens: 50_000_000 })
  assert.equal(known, false)
  assert.deepEqual(settings, { ...WORKLOAD_DEFAULTS, agents: 3, autoPick: true, dailyTokens: 50_000_000 })
  assert.equal(workloadOf(sampleWork(NOW)).known, true)
})

test('the forecast under the settings says about how many changes start today and when the next does, and changes with them', () => {
  const work = sampleWork(NOW)
  const next = clockTime(NOW + 20 * 60_000)
  // The sample's auto-pick is off, so only what the user starts runs.
  assert.equal(forecastWords(work, NOW), 'With this, about 3 changes start today, 3 so far. No more start today.')

  const picking = applySample(work, workloadAction({ autoPick: true }))
  assert.ok(!('refused' in picking))
  const outlook = picking.state.outlook!
  const startsSoon = { ...picking.state, outlook: { ...outlook, nextAt: new Date(NOW + 20 * 60_000).toISOString() } }
  assert.equal(forecastWords(startsSoon, NOW), `With this, about ${3 + outlook.moreToday} changes start today, 3 so far. ${sentence(`Next start at ${next}`)}`)

  const capped = applySample(picking.state, workloadAction({ changesADay: 3 }))
  assert.ok(!('refused' in capped))
  assert.equal(capped.state.holding?.kind, 'cap')
  assert.equal(forecastWords(capped.state, NOW), 'With this, about 3 changes start today, 3 so far. No more start today.')

  assert.equal(forecastWords({ outlook: null, forecast: 'Next 8h: about 5 jobs.' }, NOW), 'Next 8h: about 5 jobs.')
  assert.deepEqual(applySample(work, workloadAction({ hours: { from: '09:00', to: '09:00' } })), { refused: 'Work hours must start and end at different times.' })
})

test('W opens the workload while Work has the keyboard, alone, once, and never while a field is being typed in', () => {
  const press = { key: 'w', metaKey: false, ctrlKey: false, altKey: false, repeat: false, handled: false, typing: false }
  assert.equal(opensWorkload(press), true)
  assert.equal(opensWorkload({ ...press, key: 'W' }), true)
  assert.equal(opensWorkload({ ...press, typing: true }), false)
  assert.equal(opensWorkload({ ...press, metaKey: true }), false, '⌘W is the window’s')
  assert.equal(opensWorkload({ ...press, ctrlKey: true }), false)
  assert.equal(opensWorkload({ ...press, altKey: true }), false)
  assert.equal(opensWorkload({ ...press, repeat: true }), false)
  assert.equal(opensWorkload({ ...press, handled: true }), false)
  assert.equal(opensWorkload({ ...press, key: 'q' }), false)
})
