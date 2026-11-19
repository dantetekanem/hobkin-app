import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PET, PETS, PET_CHOICES, characterPet, drawingOf, petOr } from '../src/avatar/pets.ts'

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

    useSettings.getState().setPet('none')
    assert.equal(JSON.parse(values.get('hobkin-client-settings')!).state.pet, 'none', 'No Pet is kept too')
    values.set('hobkin-client-settings', JSON.stringify({ version: 4, state: { pet: 'none' } }))
    await useSettings.persist.rehydrate()
    assert.equal(useSettings.getState().pet, 'none', 'and a reload brings No Pet back')
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

test('No Pet is a fifth choice after the four, stored as none', () => {
  assert.deepEqual([...PET_CHOICES], ['round', 'ears', 'antenna', 'sprout', 'none'])
  assert.equal(petOr('none'), 'none')
  assert.equal(petOr('nothing'), 'ears', 'an unknown value still loads Ears')
  assert.equal(characterPet('none'), 'ears', 'the setup story keeps a character')
  assert.equal(characterPet('sprout'), 'sprout')
})

test('what a face draws: nothing as decoration, a dot in the agent color, the pet when one is asked for', () => {
  assert.equal(drawingOf({ choice: 'ears' }), 'pet')
  assert.equal(drawingOf({ choice: 'ears', tint: 'red' }), 'pet')
  assert.equal(drawingOf({ choice: 'none' }), 'nothing')
  assert.equal(drawingOf({ choice: 'none', tint: 'red' }), 'dot')
  assert.equal(drawingOf({ choice: 'none', pet: 'ears' }), 'pet', 'an explicit pet is drawn whatever the choice')
  assert.equal(drawingOf({ choice: 'ears', pet: 'none' }), 'outline', 'the Settings preview of No Pet')
})
