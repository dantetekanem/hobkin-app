import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HostState } from '../src/lib/host/state.ts'
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  OPACITY,
  contrast,
  isDarkPalette,
  migrateSettings,
  onAccent,
  paletteProblems,
  receiveAppearance,
  stepOpacity,
} from '../src/features/settings/rules.ts'

test('canonical receipts validate optional borders', () => {
  const state = { appearanceId: 0 }
  const receipt = { id: 2, name: null, palette: DARK_PALETTE, border: '#ABCDEF', borderStrong: '#123456' }
  const applied = receiveAppearance(state, receipt)!
  assert.deepEqual([applied.border, applied.borderStrong], ['#abcdef', '#123456'])
  assert.equal(receiveAppearance(state, { ...receipt, border: 'url(https://invalid.test)' }), null)
  assert.equal(receiveAppearance(state, { ...receipt, borderStrong: 'red' }), null)
  const migrated = migrateSettings({ palette: DARK_PALETTE, border: '#ABCDEF', borderStrong: 'red' })
  assert.deepEqual([migrated.border, migrated.borderStrong], ['#abcdef', undefined])
})

test('a built-in theme request from hobkin turns the custom theme off and keeps the saved colors', () => {
  const request = { id: 5, name: null, palette: DARK_PALETTE, use: 'light' as const }
  const applied = receiveAppearance({ appearanceId: 4 }, request)!
  assert.deepEqual(applied, { customTheme: false, appearanceId: 5, requestedTheme: 'light' })
  assert.equal(receiveAppearance({ appearanceId: 5 }, request), null, 'applied once')
})

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
  assert.deepEqual(migrateSettings(saved), { ...saved, backgroundOpacity: 1, palette: null, background: null, themeName: null, customTheme: false, appearanceId: 0 })
})

test('a saved palette whose text would not read is nudged until it reads, keeping its vibe', () => {
  const nudged = migrateSettings({ backgroundOpacity: 7, palette: { ...DARK_PALETTE, text: '#111111' }, customTheme: true, appearanceId: 0 })
  const palette = nudged.palette as Record<string, string>
  assert.equal(palette.background, DARK_PALETTE.background, 'the background is kept exactly')
  assert.equal(palette.accent, DARK_PALETTE.accent, 'the accent is kept exactly')
  assert.notEqual(palette.text, '#111111', 'the unreadable text is moved')
  assert.deepEqual(paletteProblems(palette), [], 'and now it reads')
  assert.deepEqual([nudged.customTheme, nudged.background, nudged.backgroundOpacity], [true, null, 1])
  const kept = migrateSettings({ backgroundOpacity: 0.4, palette: { ...LIGHT_PALETTE, accent: '#FF0000', extra: '#000000' }, themeName: 'Sunrise', customTheme: true, appearanceId: 0 })
  assert.deepEqual(kept, { backgroundOpacity: 0.4, palette: { ...LIGHT_PALETTE, accent: '#ff0000' }, background: null, themeName: 'Sunrise', customTheme: true, appearanceId: 0 })
  const notAPalette = migrateSettings({ palette: { foo: 'bar' }, themeName: 'Sunrise', customTheme: true })
  assert.deepEqual(notAPalette, { backgroundOpacity: 1, palette: null, background: null, themeName: null, customTheme: false, appearanceId: 0 })
  assert.deepEqual(migrateSettings(undefined), { backgroundOpacity: 1, palette: null, background: null, themeName: null, customTheme: false, appearanceId: 0 })
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
    const { useSettings, watchAppearance } = await import('../src/features/settings/store.ts')
    const state = useSettings.getState()
    assert.deepEqual([state.movement, state.typeFace, state.agents, state.showGitHubInMenu], ['still', 'geist', 6, false])
    assert.deepEqual([state.backgroundOpacity, state.palette, state.customTheme], [1, null, false])
    assert.deepEqual(state.openByDefault, { change: true, shell: false, looks: false, other: false }, 'code changes open by default, every other kind of block closed')
    assert.equal(JSON.parse(values.get('hobkin-client-settings')!).version, 4, 'saved again at the new version')
    state.setOpenByDefault('shell', true)
    assert.deepEqual(JSON.parse(values.get('hobkin-client-settings')!).state.openByDefault, { change: true, shell: true, looks: false, other: false }, 'kept with the window\'s other settings')
    state.setOpenByDefault('shell', false)

    assert.equal(state.appearanceId, 0)
    state.receive({ id: 10, name: 'Night', palette: DARK_PALETTE })
    assert.equal(useSettings.getState().appearanceId, 10)
    state.setCustomTheme(false)
    state.receive({ id: 10, name: 'Night', palette: DARK_PALETTE })
    assert.equal(useSettings.getState().customTheme, false, 'reconnecting cannot override a built-in choice')
    state.receive({ id: 11, name: 'Vivid', palette: { ...DARK_PALETTE, text: '#111111' } })
    assert.equal(useSettings.getState().appearanceId, 11, 'a vivid palette applies, its text nudged to read')
    assert.equal(useSettings.getState().palette!.background, DARK_PALETTE.background, 'its background is kept exactly')
    assert.notEqual(useSettings.getState().palette!.text, '#111111', 'its text is nudged until it reads')
    state.setPalette({ ...LIGHT_PALETTE, text: '#eeeeee' })
    assert.deepEqual(paletteProblems(useSettings.getState().palette), [], 'a hand-set palette is nudged until it reads too')
    state.setPalette(DARK_PALETTE)
    state.setCustomTheme(true)
    state.changeBackgroundOpacity(-1)
    const saved = JSON.parse(values.get('hobkin-client-settings')!).state
    assert.deepEqual([saved.palette, saved.customTheme, saved.backgroundOpacity], [DARK_PALETTE, true, 0.95])
    assert.equal(saved.appearanceId, 11)
    values.set('hobkin-client-settings', JSON.stringify({ version: 2, state: { ...saved, appearanceId: undefined } }))
    await useSettings.persist.rehydrate()
    assert.deepEqual([useSettings.getState().palette, useSettings.getState().backgroundOpacity], [DARK_PALETTE, 0.95])
    assert.equal(useSettings.getState().appearanceId, 0, 'version 2 colors survive and tracking gets defaults')
    const { createStore } = await import('zustand/vanilla')
    const { initialHostState } = await import('../src/lib/host/state.ts')
    useSettings.setState({ appearanceId: 999999, border: '#111111', customTheme: false })
    const host = createStore<HostState>(() => ({ ...initialHostState, home: '/fake/first', epoch: 1, appearance: { id: 4, name: null, palette: DARK_PALETTE, border: '#ABCDEF' } }))
    const stop = watchAppearance(host)
    try {
      assert.deepEqual([useSettings.getState().appearanceId, useSettings.getState().border], [4, '#abcdef'], 'canonical root beats an unrelated cache id')
      assert.equal(JSON.parse(values.get('hobkin-client-settings')!).state.border, '#abcdef')
      useSettings.getState().setCustomTheme(false)
      host.setState({ epoch: 2 })
      assert.equal(useSettings.getState().customTheme, false, 'same canonical receipt preserves built-in choice')
      host.setState({ epoch: 3, appearance: { id: 2, name: null, palette: LIGHT_PALETTE, border: undefined } })
      assert.deepEqual([useSettings.getState().appearanceId, useSettings.getState().border, useSettings.getState().customTheme], [2, undefined, true], 'restarted canonical source replaces cached colors and clears absent borders')
      useSettings.getState().setCustomTheme(false)
      host.setState({ home: '/fake/other', epoch: 4 })
      assert.equal(useSettings.getState().customTheme, true, 'equal ids from different homes do not make cache authoritative')
    } finally { stop() }

    const { registerHooks } = await import('node:module')
    const hooks = registerHooks({ resolve(specifier, context, next) {
      if (specifier === '@/lib/host/client.ts') return { url: 'data:text/javascript,export const hostStore = {getState:()=>({home:null,epoch:0,appearance:null}),subscribe:()=>()=>{}};export const runCommand = async () => ({ok:true})', shortCircuit: true }
      if (specifier.startsWith('@/')) return next(new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, context)
      return next(specifier, context)
    } })
    const globals = ['document', 'matchMedia', 'localStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
    const properties = new Map<string, string>()
    const classes = new Set(['dark'])
    Object.assign(globalThis, {
      document: { documentElement: { dataset: { motion: 'still' }, classList: { contains: (key: string) => classes.has(key), toggle: (key: string, on: boolean) => on ? classes.add(key) : classes.delete(key) }, style: { setProperty: (key: string, value: string) => properties.set(key, value), removeProperty: (key: string) => properties.delete(key) } } },
      matchMedia: () => ({ matches: true, addEventListener() {} }),
      localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) },
    })
    const themeSubscriptions: (() => void)[] = []
    const subscribe = useSettings.subscribe
    try {
      const appliedAppearance = () => [
        properties.get('--hb-custom-bg'),
        properties.get('--hb-border'),
        properties.get('--hb-border-strong'),
      ]
      const appearanceA = { id: 5, name: null, palette: DARK_PALETTE, border: '#abcdef', borderStrong: '#123456' }
      const appearanceB = { id: 1, name: null, palette: LIGHT_PALETTE, border: '#fedcba', borderStrong: '#654321' }
      useSettings.setState({ appearanceHome: null, border: '#abcdef', borderStrong: '#123456' })
      useSettings.subscribe = (listener) => {
        const stop = subscribe(listener)
        themeSubscriptions.push(stop)
        return stop
      }
      const { setThemeChoice } = await import('../src/app/theme.ts').finally(() => {
        useSettings.subscribe = subscribe
      })
      assert.deepEqual(appliedAppearance(), [LIGHT_PALETTE.background, '#abcdef', '#123456'], 'unowned cache stays first paint while home is unknown')
      host.setState({ home: '/fake/other', epoch: 5, appearance: null })
      const stopThemeAppearance = watchAppearance(host)
      try {
        assert.deepEqual(appliedAppearance(), [undefined, undefined, undefined], 'unowned cache clears once a home is known')
        host.setState({ home: '/fake/first', epoch: 6, appearance: appearanceA })
        assert.deepEqual(appliedAppearance(), [DARK_PALETTE.background, '#abcdef', '#123456'], 'A applies')
        host.setState({ link: 'lost', epoch: 7, appearance: null })
        assert.deepEqual(appliedAppearance(), [DARK_PALETTE.background, '#abcdef', '#123456'], 'same-owner disconnect retains A')
        host.setState({ home: '/fake/other', epoch: 8, appearance: null })
        assert.deepEqual(appliedAppearance(), [undefined, undefined, undefined], 'B with no receipt clears A')
        assert.equal(useSettings.getState().appearanceId, 0, 'owner reset clears the old receipt id')
        assert.equal(document.documentElement.dataset.palette, undefined)
        host.setState({ link: 'open', appearance: appearanceB })
        assert.deepEqual(appliedAppearance(), [LIGHT_PALETTE.background, '#fedcba', '#654321'], 'B low-id receipt applies')
        setThemeChoice('light')
        assert.deepEqual([properties.get('--hb-border'), properties.get('--hb-border-strong')], [undefined, undefined])
        assert.deepEqual([useSettings.getState().palette, useSettings.getState().customTheme], [null, false], 'choosing a base theme drops the custom theme')
        setThemeChoice('custom')
        // The dropped theme does not come back: Custom now starts from a fresh default palette with no borders.
        assert.deepEqual([properties.get('--hb-border'), properties.get('--hb-border-strong')], [undefined, undefined])
      } finally {
        stopThemeAppearance()
      }
    } finally {
      useSettings.subscribe = subscribe
      for (const stop of themeSubscriptions) stop()
      hooks.deregister()
      for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
