import assert from 'node:assert/strict'
import { test } from 'node:test'
import { walkScreens } from '../src/app/screens.ts'

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
  const original = useSettings.getState().showGitHubInMenu
  const screens = () =>
    walkScreens({ screen: 'work', reviewOpen: false, githubInMenu: useSettings.getState().showGitHubInMenu })

  try {
    useSettings.getState().setShowGitHubInMenu(false)
    const saved = JSON.parse(values.get('hobkin-client-settings') ?? '{}') as { state?: { showGitHubInMenu?: boolean } }
    assert.equal(saved.state?.showGitHubInMenu, false, 'the existing settings store persists the choice')
    assert.deepEqual(screens(), MAIN, 'GitHub is left out of the menu walk')

    useSettings.getState().setShowGitHubInMenu(true)
    assert.deepEqual(screens(), [...MAIN, 'github'], 'GitHub returns to the menu walk')
  } finally {
    useSettings.getState().setShowGitHubInMenu(original)
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
