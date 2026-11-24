import assert from 'node:assert/strict'
import { test } from 'node:test'
import { walkScreens } from '../src/app/screens.ts'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()

const MAIN = ['home', 'reports', 'routines', 'actions', 'work'] as const

test('the saved GitHub menu preference controls screen traversal', async () => {
  const values = new Map<string, string>()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
          return values.size
        },
      },
    },
  })

  const { useSettings } = await import('../src/features/settings/store.ts')
  const original = !useSettings.getState().screensOutOfMenu.includes('github')
  const screens = () => walkScreens({ screen: 'work', reviewOpen: false, outOfMenu: useSettings.getState().screensOutOfMenu })

  try {
    useSettings.getState().setScreenInMenu('github', false)
    const saved = JSON.parse(values.get('hobkin-client-settings') ?? '{}') as { state?: { screensOutOfMenu?: string[] } }
    assert.deepEqual(saved.state?.screensOutOfMenu, ['github'], 'the existing settings store persists the choice')
    assert.deepEqual(screens(), MAIN, 'GitHub is left out of the menu walk')

    useSettings.getState().setScreenInMenu('github', true)
    assert.deepEqual(screens(), [...MAIN, 'github'], 'GitHub returns to the menu walk')
  } finally {
    useSettings.getState().setScreenInMenu('github', original)
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
