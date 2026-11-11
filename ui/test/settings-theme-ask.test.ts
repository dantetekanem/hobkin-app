import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DARK_PALETTE, askLine, migrateSettings, receiveAppearance, themeAsk, themeRequestText } from '../src/features/settings/rules.ts'

const MATRIX = { background: '#000000', surface: '#07140a', text: '#9dffb0', muted: '#4fbf6a', accent: '#00ff41' }
const at = new Date(2026, 10, 10, 20, 1).getTime()

test('the request goes to hobkin as a plain sentence, and an empty one goes nowhere', () => {
  assert.equal(themeRequestText('  a Matrix theme  '), 'Set a custom theme for me: a Matrix theme')
  assert.equal(themeAsk('   ', at), null)
  assert.deepEqual(themeAsk(' a Matrix theme ', at), { text: 'a Matrix theme', askedAt: at, appliedAt: null, name: null })
})

test('the ask reads as asked, then applied', () => {
  const ask = themeAsk('a Matrix theme', at)!
  assert.match(askLine(ask), /^Asked hobkin at 8:01\s?PM$/)
  assert.equal(askLine({ ...ask, appliedAt: at + 5000, name: 'Matrix' }), 'Applied: Matrix')
  assert.equal(askLine({ ...ask, appliedAt: at + 5000 }), 'Applied')
})

test('an arriving theme is applied once, marks the ask applied, and an unreadable one is refused', () => {
  const ask = themeAsk('a Matrix theme', at)!
  const state = { request: ask, appearanceId: 0 }
  const applied = receiveAppearance(state, { id: 7, name: 'Matrix', palette: MATRIX }, at + 9000)!
  assert.deepEqual([applied.palette, applied.customTheme, applied.appearanceId], [MATRIX, true, 7])
  assert.deepEqual(applied.request, { ...ask, appliedAt: at + 9000, name: 'Matrix' })
  assert.equal(receiveAppearance({ request: applied.request, appearanceId: 7 }, { id: 7, name: 'Matrix', palette: MATRIX }, at), null, 'the same request is not applied twice')
  assert.equal(receiveAppearance(state, { id: 8, name: null, palette: { ...MATRIX, text: '#0a1a0d' } }, at), null)
  assert.equal(receiveAppearance({ request: null, appearanceId: 0 }, { id: 1, name: null, palette: MATRIX }, at)!.request, null, 'a theme hobkin chose alone has no ask to close')
})

test('settings saved before the ask keep their values and gain no ask', () => {
  const saved = { movement: 'still', palette: DARK_PALETTE, customTheme: true, backgroundOpacity: 0.5 }
  assert.deepEqual(migrateSettings(saved), { ...saved, request: null, appearanceId: 0 })
})
