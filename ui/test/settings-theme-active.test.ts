import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASE_THEME_SETTINGS, DARK_PALETTE, activeThemeLabel, migrateSettings } from '../src/features/settings/rules.ts'

test('Settings names the active theme: the custom title, or the base theme in use', () => {
  assert.equal(activeThemeLabel({ kind: 'custom', name: 'Grand Line Sunshine' }, 'light'), 'Grand Line Sunshine')
  assert.equal(activeThemeLabel({ kind: 'custom', name: null }, 'dark'), 'Custom', 'an unnamed custom theme still shows a title')
  assert.equal(activeThemeLabel({ kind: 'light' }, 'dark'), 'Light')
  assert.equal(activeThemeLabel({ kind: 'dark' }, 'light'), 'Dark')
  assert.equal(activeThemeLabel({ kind: 'system' }, 'dark'), 'Following the Mac, dark now')
  assert.equal(activeThemeLabel({ kind: 'system' }, 'light'), 'Following the Mac, light now')
})

test('choosing a base theme drops the custom theme, so a restart keeps the base', () => {
  // What the store holds while a named custom theme is showing.
  const custom = {
    palette: DARK_PALETTE,
    background: { kind: 'gradient', value: 'linear-gradient(#000, #111)' },
    themeName: 'Grand Line Sunshine',
    border: '#abcdef',
    borderStrong: '#123456',
    customTheme: true,
    appearanceId: 7,
  }

  // Picking Light, Dark or Follow the Mac replaces those fields with the base-theme settings.
  const afterBase = { ...custom, ...BASE_THEME_SETTINGS }

  // On the next launch the saved settings are migrated: the custom theme must be gone.
  const restarted = migrateSettings(afterBase)
  assert.deepEqual(
    [restarted.palette, restarted.background, restarted.themeName, restarted.customTheme],
    [null, null, null, false],
    'the restart keeps the base theme, not the custom one',
  )
  assert.equal(restarted.appearanceId, 7, 'the receipt id is kept so a stale host theme is not re-applied')
})
