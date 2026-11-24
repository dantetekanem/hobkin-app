import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toWire } from '../src/state-sync.ts'

const row = (id: string, body: string) => ({ id, title: id, body, outcome: 'completed' })

test('the reports the window is sent leave out the ones that found nothing new', () => {
  const sent = toWire({
    reports: [row('a', 'Nothing new.'), row('b', 'Useful: Rates dropped.'), row('c', '**nothing new**'), row('d', 'Nothing new. But the deploy is late.')],
    schedules: [{ id: 'check', lastRun: { at: '2026-11-24T08:00:00Z', outcome: 'completed' } }],
  }).values
  assert.deepEqual((sent.reports as { id: string }[]).map(({ id }) => id), ['b', 'd'])
  assert.deepEqual((sent.schedules as { lastRun: unknown }[])[0]?.lastRun, { at: '2026-11-24T08:00:00Z', outcome: 'completed' })
})
