import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
after(() => mock.timers.reset())

// A window saved before screens kept their own state: GitHub's tab and project were fields of the place, and its way back was `githubReturn`.
const KEY = 'hobkin-client-location-1'
sessionStorage.setItem(KEY, JSON.stringify({ screen: 'github', settingsReturn: null, githubReturn: 'routines', openAgent: null, openReview: null, githubTab: 'issues', githubProject: 'storefront', home: '/hobkin' }))

const { readSpot, remembered } = await import('../src/app/location.ts')
const { useView } = await import('../src/app/view-store.ts')

test('a window saved before this comes back on its screen with its tab and project chosen and its way back', () => {
  assert.equal(useView.getState().screen, 'github')
  assert.equal(useView.getState().screenReturn, 'routines')
  assert.deepEqual(remembered.getState().pages, { github: { tab: 'issues', project: 'storefront' } })
  assert.deepEqual(readSpot(sessionStorage.getItem(KEY))?.pages, { github: { tab: 'issues', project: 'storefront' } })
})

test('settings saved before keep GitHub out of the menu', async () => {
  const values = new Map<string, string>([['hobkin-client-settings', JSON.stringify({ version: 5, state: { movement: 'still', showGitHubInMenu: false } })]])
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } },
  })
  try {
    const { useSettings } = await import('../src/features/settings/store.ts')
    const state = useSettings.getState()
    assert.deepEqual(state.screensOutOfMenu, ['github'])
    const { walkScreens } = await import('../src/app/screens.ts')
    assert.deepEqual(walkScreens({ screen: 'home', reviewOpen: false, outOfMenu: state.screensOutOfMenu }), ['home', 'reports', 'routines', 'actions', 'work'])
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
})
