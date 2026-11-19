import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PET, PETS, petOr } from '../src/avatar/pets.ts'

test('hobkin wears Ears until the user picks another pet', () => {
  assert.equal(DEFAULT_PET, 'ears')
  assert.deepEqual([...PETS], ['round', 'ears', 'antenna', 'sprout'], 'the sheet order, so Ears is the second')
})

test('a stored pet the app does not know falls back to Ears', () => {
  assert.equal(petOr('sprout'), 'sprout')
  assert.equal(petOr('hood'), 'ears')
  assert.equal(petOr(undefined), 'ears')
  assert.equal(petOr(3), 'ears')
})

test('the pet is kept with the window settings, and settings saved before it load with Ears', async () => {
  const values = new Map<string, string>()
  const savedBeforePets = { version: 4, state: { movement: 'still', typeFace: 'geist' } }
  values.set('hobkin-client-settings', JSON.stringify(savedBeforePets))
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

  try {
    const { useSettings } = await import('../src/features/settings/store.ts')
    assert.equal(useSettings.getState().movement, 'still', 'the saved settings loaded')
    assert.equal(useSettings.getState().pet, 'ears', 'a save from before the pets has none, so Ears')

    useSettings.getState().setPet('antenna')
    assert.equal(useSettings.getState().pet, 'antenna')
    assert.equal(JSON.parse(values.get('hobkin-client-settings')!).state.pet, 'antenna', 'kept across reloads')

    values.set('hobkin-client-settings', JSON.stringify({ version: 4, state: { pet: 'sprout' } }))
    await useSettings.persist.rehydrate()
    assert.equal(useSettings.getState().pet, 'sprout', 'a reload brings the chosen pet back')
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
})
