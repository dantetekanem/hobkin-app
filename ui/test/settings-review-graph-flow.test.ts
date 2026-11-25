import assert from 'node:assert/strict'
import { test } from 'node:test'

test('a review graph reads left to right until the user chooses top to bottom, and the choice is kept with the window settings', async () => {
  // A window saved before the choice existed, at the store's version.
  const values = new Map<string, string>([['hobkin-client-settings', JSON.stringify({ version: 6, state: { movement: 'still', reviewView: 'code' } })]])
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
  const { movement, reviewView, reviewGraphFlow } = useSettings.getState()
  assert.deepEqual([movement, reviewView, reviewGraphFlow], ['still', 'code', 'left-to-right'], 'what it saved stays, and the graph reads left to right')

  useSettings.getState().setReviewGraphFlow('top-to-bottom')
  assert.equal(useSettings.getState().reviewGraphFlow, 'top-to-bottom')
  assert.equal(JSON.parse(values.get('hobkin-client-settings')!).state.reviewGraphFlow, 'top-to-bottom', 'kept with the other settings')

  values.set('hobkin-client-settings', JSON.stringify({ version: 6, state: { reviewGraphFlow: 'diagonal' } }))
  await useSettings.persist.rehydrate()
  assert.equal(useSettings.getState().reviewGraphFlow, 'left-to-right', 'anything but top to bottom is left to right')
})
