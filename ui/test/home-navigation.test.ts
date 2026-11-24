import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { screens, inMenu, walkScreens } from '../src/app/screens.ts'
import { resolveKey, type KeyContext } from '../src/app/key-map.ts'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()
const values = new Map<string, string>()
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
} } })
const { useView } = await import('../src/app/view-store.ts')

mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
after(() => { mock.timers.reset(); Reflect.deleteProperty(globalThis, 'window') })

const context = (outOfMenu: readonly string[] = []): KeyContext => ({
  zone: 'canvas',
  messageEmpty: true,
  screens: walkScreens({ screen: 'home', reviewOpen: false, outOfMenu }),
  screen: 'home',
  inOverlay: false,
  veilOpen: false,
  asking: false,
  outOfMenu,
})

test('a new unsaved view opens Home first, without replacing a persisted screen', async () => {
  assert.equal(useView.getInitialState().screen, 'home')
  assert.equal(screens().filter(({ id }) => inMenu(id))[0]?.id, 'home')
  useView.persist.setOptions({ storage: { getItem: () => ({ state: { screen: 'routines' }, version: 5 }), setItem() {}, removeItem() {} } })
  await useView.persist.rehydrate()
  assert.equal(useView.getState().screen, 'routines')
  useView.setState(useView.getInitialState())
})

test('numbered shortcuts follow top-menu positions and leave native focus shortcuts alone', () => {
  const destinations = ['home', 'reports', 'routines', 'actions', 'work', 'github']
  for (const [index, screen] of destinations.entries()) {
    const press = { key: String(index + 1), meta: true }
    assert.deepEqual(resolveKey(press, context()), { do: 'open-screen', screen, focusCanvas: true })
  }
  const withoutGitHub = ['home', 'reports', 'routines', 'actions', 'work']
  for (const [index, screen] of withoutGitHub.entries()) {
    assert.deepEqual(resolveKey({ key: String(index + 1), meta: true }, context(['github'])), { do: 'open-screen', screen, focusCanvas: true })
  }
  assert.equal(resolveKey({ key: '6', meta: true }, context(['github'])), null, 'hidden GitHub is not taught as a sixth position')
  for (const shift of [false, true]) assert.equal(resolveKey({ key: 'Tab', shift }, context()), null)
  assert.deepEqual(resolveKey({ key: 'j', code: 'KeyJ', meta: true }, context()), { do: 'toggle-mind' })
  for (const key of ['Enter', 'l']) assert.deepEqual(resolveKey({ key, meta: true }, context()), { do: 'focus-input' })
})

test('Home entry and return paths issue no host commands', async (t) => {
  const { HostConnection } = await import('../src/lib/host/connection.ts')
  const calls: unknown[] = []
  t.mock.method(HostConnection.prototype, 'command', async (...args: unknown[]) => { calls.push(args); return { ok: true } })
  const { useReports } = await import('../src/features/reports/store.ts')
  const report = useReports.getState().inbox.reports[0]!
  useReports.getState().open(report.id)
  useView.getState().openScreen('work')
  useView.getState().openScreen('home')
  assert.equal(useReports.getState().openId, report.id, 'Home does not reset explicit report selection')
  assert.deepEqual(calls, [])
})

test('Home survives agent preview, canvas and Settings return paths', () => {
  useView.setState(useView.getInitialState())
  const view = useView.getState()
  view.previewAgent('one', 1)
  view.endAgentPreview()
  assert.equal(useView.getState().screen, 'home')
  view.openAgentCanvas('three')
  assert.equal(useView.getState().trail.at(-1)?.screen, 'home')
  view.closeAgentCanvas()
  view.toggleSettings()
  view.closeSettings()
  assert.equal(useView.getState().screen, 'home')
})
