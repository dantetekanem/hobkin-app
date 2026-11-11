import assert from 'node:assert/strict'
import { test } from 'node:test'

test('unavailable daily usage stays distinct from zero', async () => {
  const { useSettings } = await import('../src/features/settings/store.ts')

  assert.equal(useSettings.getState().usedToday, null)
  useSettings.setState({ usedToday: 0 })
  assert.equal(useSettings.getState().usedToday, 0)
})
