import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmsRestore, formatBytes, parseLimit, restoreWaitsFor, scheduleLine } from '../src/features/settings/backup.ts'

test('sizes read in the unit that fits', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(5 * 1024 ** 3), '5.0 GB')
  assert.equal(formatBytes(150 * 1024 ** 2), '150 MB')
})

test('the limit is a whole number from 1 to 100', () => {
  assert.equal(parseLimit('10'), 10)
  assert.equal(parseLimit(' 100 '), 100)
  for (const bad of ['', '0', '101', '2.5', '-1', 'ten', '1e2']) assert.equal(parseLimit(bad), null, bad)
})

test('the schedule line says what is happening or due', () => {
  const on = { enabled: true, cadence: 'hourly' as const, limit: 10 }
  const now = 1_000_000_000
  assert.equal(scheduleLine({ config: { ...on, enabled: false }, busy: null, nextAt: null }, now), 'Automatic backup is off. Back up now still works.')
  assert.equal(scheduleLine({ config: on, busy: 'backup', nextAt: now }, now), 'Backing up now…')
  assert.equal(scheduleLine({ config: on, busy: null, nextAt: now + 5 * 60_000 }, now), 'The next backup runs in 5 minutes.')
  assert.equal(scheduleLine({ config: on, busy: null, nextAt: now + 3 * 3_600_000 }, now), 'The next backup runs in about 3 hours.')
  assert.equal(scheduleLine({ config: on, busy: null, nextAt: now - 1 }, now), 'The next backup starts any moment.')
})

test('a restore needs the word typed', () => {
  assert.equal(confirmsRestore('restore'), true)
  assert.equal(confirmsRestore(' Restore '), true)
  assert.equal(confirmsRestore('rest'), false)
  assert.equal(confirmsRestore(''), false)
})

test('a restore waits while hobkin answers or anything runs, and says what', () => {
  assert.equal(restoreWaitsFor({ busy: false, runs: [] }), null)
  assert.equal(restoreWaitsFor({}), null)
  assert.equal(restoreWaitsFor({ runs: [{ title: 'Old check', state: 'completed' }] }), null)
  assert.match(restoreWaitsFor({ busy: true }) ?? '', /hobkin is answering/)
  assert.match(restoreWaitsFor({ runs: [{ title: 'Fix the login', state: 'running' }] }) ?? '', /Fix the login/)
  for (const state of ['queued', 'cancelling']) assert.ok(restoreWaitsFor({ runs: [{ title: 'A routine', state }] }), state)
})
