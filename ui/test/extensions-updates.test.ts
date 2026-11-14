import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EXTENSIONS_UNKNOWN, type ExtensionsState } from '#shared/pi-resources/wire.ts'
import { needsUpdateCheck, UPDATES_FRESH_MS } from '../src/features/extensions/updates.ts'

const checked = (at: string | null, checking = false): ExtensionsState => ({ ...EXTENSIONS_UNKNOWN, readAt: '2026-11-13T22:00:00.000Z', updates: { checking, checkedAt: at } })

test('opening the page checks for updates once, and not again for ten minutes', () => {
  const now = Date.parse('2026-11-13T22:30:00.000Z')
  assert.equal(needsUpdateCheck(null, now), false, 'not before the host has answered')
  assert.equal(needsUpdateCheck(checked(null), now), true, 'never checked')
  assert.equal(needsUpdateCheck(checked(null, true), now), false, 'a check is under way')
  assert.equal(needsUpdateCheck(checked(new Date(now - UPDATES_FRESH_MS + 1000).toISOString()), now), false, 'checked within ten minutes')
  assert.equal(needsUpdateCheck(checked(new Date(now - UPDATES_FRESH_MS - 1000).toISOString()), now), true, 'checked longer ago')
})
