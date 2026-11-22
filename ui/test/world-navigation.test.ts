import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { registerHooks } from 'node:module'
import { useView } from '../src/app/view-store.ts'
import { inMenu, walkScreens } from '../src/app/screens.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { sampleWork } from '../src/features/work/sample.ts'

const aliases = registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context)
} })
const workUi = await import('../src/features/work/store.ts')
aliases.deregister()

mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
after(() => mock.timers.reset())
const { readSpot, travel } = await import('../src/app/location.ts')
const settle = () => new Promise<void>(resolve => queueMicrotask(resolve))
const source = () => JSON.stringify([hostStore.getState().home, hostStore.getState().epoch])
const work = { ...sampleWork(), projects: sampleWork().projects.slice(0, 3).map((p, i) => ({ ...p, slug: `exact-${i}`, state: 'chosen' as const })) }

function fixture() {
  hostStore.setState({ home: '/fixture', epoch: 1, link: 'open', work })
  useView.setState({ screen: 'work', openAgent: null, previewReturn: null, trail: [] })
}

test('World is contextual; visible positional shortcuts still start at Home', () => {
  assert.equal(inMenu('world', true), false)
  assert.deepEqual(walkScreens({ screen: 'world', githubInMenu: true, reviewOpen: false }), ['home', 'reports', 'routines', 'actions', 'work', 'github'])
  assert.equal(readSpot(JSON.stringify({ screen: 'world' }))?.screen, 'world')
})

test('Work to World to agent returns to World, with Back and Forward retaining it', async () => {
  fixture()
  await settle()
  useView.getState().openScreen('world')
  await settle()
  useView.getState().openAgentCanvas('exact-run')
  await settle()
  useView.getState().closeAgentCanvas()
  assert.equal(useView.getState().screen, 'world')
  await settle()
  assert.equal(travel(-1), true)
  assert.equal(useView.getState().screen, 'agent')
  travel(-1)
  assert.equal(useView.getState().screen, 'world')
  travel(-1)
  assert.equal(useView.getState().screen, 'work')
  travel(1)
  assert.equal(useView.getState().screen, 'world')
})

test('project return consumes the exact chosen slug once without executing a command', () => {
  fixture()
  useView.getState().openScreen('world')
  assert.equal(workUi.returnToWorldProject('exact-1', source()), true)
  assert.equal(useView.getState().screen, 'work')
  assert.equal(workUi.takeWorldProject(), 'exact-1')
  assert.equal(workUi.takeWorldProject(), null)
  assert.deepEqual(workUi.useWorkUi.getState().busy, {})
})

test('stale source, removed or unchosen projects cannot navigate or leave a target', () => {
  for (const change of [{ home: '/other' }, { epoch: 2 }, { work: { ...work, projects: [] } }, { work: { ...work, projects: work.projects.map(p => ({ ...p, state: 'proposed' as const })) } }]) {
    fixture()
    const before = source()
    useView.getState().openScreen('world')
    hostStore.setState(change)
    assert.equal(workUi.returnToWorldProject('exact-1', before), false)
    assert.equal(useView.getState().screen, 'world')
    assert.equal(workUi.takeWorldProject(), null)
  }
})

test('exact project handoff wins over first-control focus but not typing or a new source', () => {
  fixture()
  const listeners = new Set<(event: { target: unknown; stopImmediatePropagation: () => void }) => void>()
  let focused = '', scrolled = 0, intercepted = 0
  const section = { dataset: { canvasScreen: 'work' }, addEventListener: (_: string, fn: (event: { target: unknown; stopImmediatePropagation: () => void }) => void) => listeners.add(fn), removeEventListener: (_: string, fn: (event: { target: unknown; stopImmediatePropagation: () => void }) => void) => listeners.delete(fn) }
  const row = (slug: string) => ({ dataset: { worldProject: slug }, focus: () => { focused = slug }, scrollIntoView: () => { scrolled++ } })
  const page = { activeElement: {} as unknown, querySelector: () => ({ dataset: { activeCanvasScreen: 'work' } }), querySelectorAll: () => [section] }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: page })
  const root = { closest: () => section, querySelectorAll: () => [row('exact-0'), row('exact-1')] } as unknown as HTMLElement
  try {
    useView.getState().openScreen('world')
    workUi.returnToWorldProject('exact-1', source())
    workUi.bindWorldProject(root)?.() // Strict Mode tears down and rebinds before arrival.
    const release = workUi.bindWorldProject(root)
    const arrive = () => { page.activeElement = section; for (const fn of listeners) fn({ target: section, stopImmediatePropagation() { intercepted++ } }) }
    assert.equal(focused, '', 'mount while typing takes nothing')
    arrive()
    assert.equal(focused, 'exact-1')
    assert.equal(scrolled, 1)
    assert.equal(intercepted, 1, 'ordinary first-control handoff is intercepted')
    assert.equal(workUi.takeWorldProject(), null, 'focus consumes the target')
    release?.()
    assert.equal(listeners.size, 0)
    focused = ''
    useView.getState().openScreen('world')
    workUi.returnToWorldProject('exact-1', source())
    page.activeElement = {}
    const stale = workUi.bindWorldProject(root)
    hostStore.setState({ epoch: 2 })
    arrive()
    assert.equal(focused, '', 'source changes before arrival invalidate the handoff')
    stale?.()
    useView.getState().openScreen('world')
    assert.equal(workUi.returnToWorldProject('exact-1', source()), true)
    page.activeElement = {}
    const removed = workUi.bindWorldProject(root)
    hostStore.setState({ work: { ...work, projects: [] } })
    hostStore.setState({ work })
    arrive()
    assert.equal(focused, '', 'removed project cannot regain a pending focus target')
    removed?.()
  } finally { Reflect.deleteProperty(globalThis, 'document') }
})

test('pending target is invalidated by source replacement, departure or project removal', () => {
  for (const invalidate of [() => hostStore.setState({ epoch: 2 }), () => useView.getState().openScreen('reports'), () => hostStore.setState({ work: { ...work, projects: [] } })]) {
    fixture()
    useView.getState().openScreen('world')
    workUi.returnToWorldProject('exact-1', source())
    invalidate()
    assert.equal(workUi.takeWorldProject(), null)
  }
})

test('project removal invalidates a target even if the project returns before Work arrives', () => {
  fixture()
  useView.getState().openScreen('world')
  assert.equal(workUi.returnToWorldProject('exact-1', source()), true)
  hostStore.setState({ work: { ...work, projects: [] } })
  hostStore.setState({ work })
  assert.equal(workUi.takeWorldProject(), null)
})
