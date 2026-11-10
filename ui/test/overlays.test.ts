import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closeOver, depth, ground, toggleIntegrationsOver, toggleSettingsOver, type Over } from '../src/app/overlays.ts'
import type { ScreenId } from '../src/app/screens.ts'

const on = (screen: ScreenId): Over => ({ screen, settingsReturn: null })

test('integrations opened from settings steps back to settings, and settings then to the screen under it', () => {
  const settings = toggleSettingsOver(on('routines'))
  assert.equal(settings.screen, 'settings')

  const integrations = toggleIntegrationsOver(settings)
  assert.equal(integrations.screen, 'integrations')
  assert.equal(depth(integrations), 2)

  const back = toggleIntegrationsOver(integrations)
  assert.equal(back.screen, 'settings', 'one step back, not two')
  assert.deepEqual(toggleSettingsOver(back), on('routines'))
})

test('integrations opened on its own still sits under settings', () => {
  const integrations = toggleIntegrationsOver(on('reports'))
  assert.equal(integrations.screen, 'integrations')
  assert.equal(depth(integrations), 2)

  const back = toggleIntegrationsOver(integrations)
  assert.equal(back.screen, 'settings')
  assert.deepEqual(toggleSettingsOver(back), on('reports'))
})

test('asking for settings from integrations steps back up to it', () => {
  const back = toggleSettingsOver(toggleIntegrationsOver(on('work')))
  assert.equal(back.screen, 'settings')
  assert.deepEqual(toggleSettingsOver(back), on('work'), 'settings still returns to the screen under it')
})

test('closing leaves settings and integrations together', () => {
  assert.deepEqual(closeOver(toggleIntegrationsOver(on('pages'))), on('pages'))
  assert.deepEqual(closeOver(toggleSettingsOver(on('actions'))), on('actions'))
  assert.deepEqual(closeOver(on('reports')), on('reports'), 'nothing open for now, nothing changes')
})

test('with nothing to return to, both close onto work', () => {
  assert.deepEqual(toggleSettingsOver(on('settings')), on('work'))
  assert.deepEqual(toggleSettingsOver(toggleIntegrationsOver(on('integrations'))), on('work'))
})

test('the screen under settings and integrations is where the app comes back', () => {
  assert.equal(ground(on('routines')), 'routines')
  assert.equal(ground(toggleSettingsOver(on('routines'))), 'routines')
  assert.equal(ground(toggleIntegrationsOver(on('pages'))), 'pages')
  assert.equal(ground(toggleIntegrationsOver(toggleSettingsOver(on('reports')))), 'reports')
})
