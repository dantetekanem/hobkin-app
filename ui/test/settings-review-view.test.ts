import assert from 'node:assert/strict'
import { test } from 'node:test'

test('reviews open in Graph until the user chooses Code, and the choice is kept with the window settings', async () => {
  // A window saved before the choice existed, at the store's version.
  const values = new Map<string, string>([['hobkin-client-settings', JSON.stringify({ version: 6, state: { movement: 'still' } })]])
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    },
  })
  const { useSettings } = await import('../src/features/settings/store.ts')
  assert.deepEqual([useSettings.getState().movement, useSettings.getState().reviewView], ['still', 'graph'], 'what it saved stays, and reviews open in Graph')

  useSettings.getState().setReviewView('code')
  assert.equal(useSettings.getState().reviewView, 'code')
  assert.equal(JSON.parse(values.get('hobkin-client-settings')!).state.reviewView, 'code', 'kept with the other settings')

  values.set('hobkin-client-settings', JSON.stringify({ version: 6, state: { reviewView: 'tree' } }))
  await useSettings.persist.rehydrate()
  assert.equal(useSettings.getState().reviewView, 'graph', 'anything but Code is Graph')
})
