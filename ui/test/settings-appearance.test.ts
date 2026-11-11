import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  OPACITY,
  contrast,
  isDarkPalette,
  migrateSettings,
  onAccent,
  paletteProblems,
  stepOpacity,
} from '../src/features/settings/rules.ts'

test('background opacity moves in steps between a tenth and solid', () => {
  assert.equal(stepOpacity(1, -1), 0.95)
  assert.equal(stepOpacity(0.5, 1), 0.55)
  assert.equal(stepOpacity(OPACITY.max, 1), 1, 'stops at solid')
  assert.equal(stepOpacity(OPACITY.min, -1), 0.1, 'stops at a tenth')
  assert.equal(stepOpacity(0.02, 0), 0.1, 'a value from outside is brought into range')
  assert.equal(stepOpacity(0.537, 0), 0.55, 'a value between steps snaps to the nearest one')
  assert.equal(stepOpacity(Number.NaN, 0), 1, 'a value that is not a number goes back to solid')
})

test('contrast is measured the way WCAG measures it', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21)
  assert.equal(contrast('#777777', '#777777'), 1)
  assert.equal(contrast('#ffffff', '#000000'), contrast('#000000', '#ffffff'), 'the order does not matter')
})

test('the built-in colors read, so a custom theme can start from them', () => {
  assert.deepEqual(paletteProblems(LIGHT_PALETTE), [])
  assert.deepEqual(paletteProblems(DARK_PALETTE), [])
})

test('a palette whose text would not read says why', () => {
  const faint = paletteProblems({ ...DARK_PALETTE, text: '#2a2c33' })
  assert.equal(faint.length, 2, 'text fails on both the background and the cards')
  assert.match(faint[0]!, /^Text on the background is \d+(\.\d)? to 1/)
  const muted = paletteProblems({ ...LIGHT_PALETTE, muted: '#c8c0a8' })
  assert.ok(muted.length > 0 && muted.every((problem) => problem.startsWith('Muted text')))
  assert.match(paletteProblems({ ...LIGHT_PALETTE, accent: 'yellow' })[0]!, /hex color/)
  assert.match(paletteProblems(null)[0]!, /hex color/)
})

test('a ratio just short of 4.5 is not written as 4.5', () => {
  // #777777 on white is 4.48 to 1.
  const [problem] = paletteProblems({ ...LIGHT_PALETTE, background: '#ffffff', surface: '#ffffff', muted: '#777777' })
  assert.ok(problem?.includes(' 4.4 to 1'), problem)
})

test('the accent gets whichever of black or white reads better, and that always reads', () => {
  assert.equal(onAccent('#ffc940'), '#000000')
  assert.equal(onAccent('#1e3a8a'), '#ffffff')
  for (let gray = 0; gray <= 255; gray += 5) {
    const accent = `#${gray.toString(16).padStart(2, '0').repeat(3)}`
    assert.ok(contrast(onAccent(accent), accent) >= 4.5, accent)
  }
})

test('a custom theme sits on dark when its text is lighter than its background', () => {
  assert.equal(isDarkPalette(DARK_PALETTE), true)
  assert.equal(isDarkPalette(LIGHT_PALETTE), false)
})

test('settings saved before opacity and custom themes keep their values and gain the defaults', () => {
  const saved = { movement: 'still', typeFace: 'inter', agents: 5, dailyTokens: 50_000_000, usageEvents: false, feedback: true, showGitHubInMenu: false }
  assert.deepEqual(migrateSettings(saved), { ...saved, backgroundOpacity: 1, palette: null, customTheme: false, request: null, appearanceId: 0 })
})

test('saved appearance that cannot be used is dropped, and custom with it', () => {
  const dropped = migrateSettings({ backgroundOpacity: 7, palette: { ...DARK_PALETTE, text: '#111111' }, customTheme: true, request: null, appearanceId: 0 })
  assert.deepEqual(dropped, { backgroundOpacity: 1, palette: null, customTheme: false, request: null, appearanceId: 0 })
  const kept = migrateSettings({ backgroundOpacity: 0.4, palette: { ...LIGHT_PALETTE, accent: '#FF0000', extra: '#000000' }, customTheme: true, request: null, appearanceId: 0 })
  assert.deepEqual(kept, { backgroundOpacity: 0.4, palette: { ...LIGHT_PALETTE, accent: '#ff0000' }, customTheme: true, request: null, appearanceId: 0 })
  assert.deepEqual(migrateSettings(undefined), { backgroundOpacity: 1, palette: null, customTheme: false, request: null, appearanceId: 0 })
})

test('the store loads settings saved at version 1 without losing them', async () => {
  const values = new Map<string, string>([
    ['hobkin-client-settings', JSON.stringify({ version: 1, state: { movement: 'still', typeFace: 'geist', agents: 6, showGitHubInMenu: false } })],
  ])
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
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
    const state = useSettings.getState()
    assert.deepEqual([state.movement, state.typeFace, state.agents, state.showGitHubInMenu], ['still', 'geist', 6, false])
    assert.deepEqual([state.backgroundOpacity, state.palette, state.customTheme], [1, null, false])
    assert.equal(JSON.parse(values.get('hobkin-client-settings')!).version, 2, 'saved again at the new version')

    state.setPalette({ ...LIGHT_PALETTE, text: '#eeeeee' })
    assert.equal(useSettings.getState().palette, null, 'an unreadable palette is refused')
    state.setPalette(DARK_PALETTE)
    state.setCustomTheme(true)
    state.changeBackgroundOpacity(-1)
    const saved = JSON.parse(values.get('hobkin-client-settings')!).state
    assert.deepEqual([saved.palette, saved.customTheme, saved.backgroundOpacity], [DARK_PALETTE, true, 0.95])
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
