import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tellHostTheme } from '../src/app/theme-host.ts'

test("the user's own choice of a built-in theme reaches the host, so a restart does not bring the custom theme back", async () => {
  const told: unknown[] = []
  const run = async (name: 'appearance.use', args: { theme: 'system' | 'light' | 'dark' }) => {
    told.push([name, args])
    return { ok: true as const }
  }

  // The host keeps the last custom theme and shows it again each time it starts, until it is told to forget it.
  for (const theme of ['system', 'light', 'dark'] as const) tellHostTheme(theme, { connected: true, run })
  assert.deepEqual(told, [
    ['appearance.use', { theme: 'system' }],
    ['appearance.use', { theme: 'light' }],
    ['appearance.use', { theme: 'dark' }],
  ])

  // Choosing Custom keeps what the host has, and with no host there is nobody to tell.
  tellHostTheme('custom', { connected: true, run })
  tellHostTheme('system', { connected: false, run })
  assert.equal(told.length, 3)

  // A host that refuses, or went away, never breaks the choice the window already shows.
  const refused: string[] = []
  process.once('unhandledRejection', () => refused.push('unhandled'))
  tellHostTheme('system', { connected: true, run: async () => Promise.reject(Error('hobkin is not open')) })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(refused, [])
})
