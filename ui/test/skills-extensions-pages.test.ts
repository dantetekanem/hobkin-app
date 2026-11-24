import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveEscape, type KeyContext } from '../src/app/key-map.ts'
import { closeOver, depth, ground, togglePageOver, toggleSettingsOver, type Over } from '../src/app/overlays.ts'
import { walkScreens, type ScreenId } from '../src/app/screens.ts'
import { useView } from '../src/app/view-store.ts'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()

const on = (screen: ScreenId): Over => ({ screen, settingsReturn: null })
const MENU = ['home', 'reports', 'routines', 'actions', 'work', 'github'] as const

test('Skills and Pi extensions sit under Settings, as Integrations does', () => {
  for (const page of ['skills', 'extensions'] as const) {
    const opened = togglePageOver(toggleSettingsOver(on('routines')), page)
    assert.equal(opened.screen, page)
    assert.equal(depth(opened), 2)
    assert.equal(ground(opened), 'routines', 'the app comes back on the screen under Settings')

    const back = togglePageOver(opened, page)
    assert.equal(back.screen, 'settings', 'one step back, not two')
    assert.deepEqual(toggleSettingsOver(back), on('routines'))
    assert.equal(toggleSettingsOver(opened).screen, 'settings', 'asking for Settings steps back up to it')
    assert.deepEqual(closeOver(opened), on('routines'), 'closing leaves the page and Settings together')
    // From one page under Settings to another, the way back is still the screen under Settings.
    assert.equal(ground(togglePageOver(opened, 'integrations')), 'routines')
    // The numbered keys follow the trail the menu shows: Settings, then the page.
    assert.deepEqual(walkScreens({ screen: page, reviewOpen: false, outOfMenu: [] }), [...MENU, 'settings', page])
  }
})

test('the view opens a page under Settings and steps back up, and Escape leaves the page', () => {
  useView.setState(useView.getInitialState())
  const view = useView.getState()
  view.openScreen('reports')
  view.toggleSettings()
  view.togglePage('skills')
  assert.equal(useView.getState().screen, 'skills')
  view.togglePage('skills')
  assert.equal(useView.getState().screen, 'settings')
  view.togglePage('extensions')
  assert.equal(useView.getState().screen, 'extensions')
  view.closeSettings()
  assert.equal(useView.getState().screen, 'reports')

  const context = (screen: ScreenId): KeyContext => ({ zone: 'canvas', messageEmpty: true, screens: MENU, screen, inOverlay: false, veilOpen: false, asking: false, outOfMenu: [] })
  for (const page of ['skills', 'extensions'] as const) assert.deepEqual(resolveEscape(context(page), false), { do: 'leave-screen' }, page)
})
