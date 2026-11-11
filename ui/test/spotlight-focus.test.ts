import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { registerHooks } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SpotlightTarget } from '../src/app/spotlight-entries.ts'
import { useView } from '../src/app/view-store.ts'

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier.startsWith('@/') ? nextResolve(new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, context) : nextResolve(specifier, context)
} })
const timers = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)!] as const)
for (const [key] of timers) Object.defineProperty(globalThis, key, { configurable: true, value: () => 0 })
const { useSpotlightTargets } = await import('../src/app/spotlight-entries.ts')
for (const [key, descriptor] of timers) Object.defineProperty(globalThis, key, descriptor)

function setting(name = 'Day and night'): SpotlightTarget {
  let targets: SpotlightTarget[] = []
  function Capture() {
    targets = useSpotlightTargets()
    return null
  }
  renderToStaticMarkup(createElement(Capture))
  const target = targets.find(({ id }) => id === `setting:${name}`)
  assert.ok(target)
  return target
}

let restoreSubscribe = () => {}
afterEach(() => {
  restoreSubscribe()
  for (const key of ['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSS']) Reflect.deleteProperty(globalThis, key)
})

function setup(missing = false) {
  useView.setState(useView.getInitialState())
  let next = 0
  let ended = 0
  let lookups = 0
  const frames = new Map<number, FrameRequestCallback>()
  const listeners = new Map<string, Set<(event: Event) => void>>()
  const dispatch = (type: string, target: unknown) => {
    listeners.get(type)?.forEach((run) => run({ type, target, isTrusted: true } as Event))
  }
  const makeScreen = (key: string) => {
    const target = { focuses: 0, scrolls: 0, focus() { this.focuses++; page.activeElement = target; dispatch('focusin', target) }, scrollIntoView() { this.scrolls++ } }
    const tile = { contains: (stop: unknown) => stop === target }
    const section = { dataset: { canvasScreen: key }, focuses: 0, focus() { this.focuses++; page.activeElement = section; dispatch('focusin', section) }, querySelector() { lookups++; return missing ? null : tile }, querySelectorAll() { return [target] } }
    return { target, section }
  }
  const screens = ['settings', 'actions', 'reports'].map(makeScreen)
  let activeElement: unknown = { typing: true }
  const page = {
    get activeElement() { return activeElement },
    set activeElement(element: unknown) { activeElement = element },
    querySelector: () => ({ dataset: { activeCanvasScreen: useView.getState().screen } }),
    querySelectorAll: () => screens.map(({ section }) => section),
    addEventListener: (type: string, run: (event: Event) => void) => { const group = listeners.get(type) ?? new Set(); group.add(run); listeners.set(type, group) },
    removeEventListener: (type: string, run: (event: Event) => void) => listeners.get(type)?.delete(run),
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: page })
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (value: string) => value } })
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (run: FrameRequestCallback) => { frames.set(++next, run); return next } })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id: number) => frames.delete(id) })
  const original = useView.subscribe
  useView.subscribe = ((listener) => { const unsubscribe = original(listener); return () => { ended++; unsubscribe() } }) as typeof useView.subscribe
  restoreSubscribe = () => { useView.subscribe = original }
  return { frames, screens, page, dispatch, ended: () => ended, lookups: () => lookups, listenerCount: () => [...listeners.values()].reduce((count, group) => count + group.size, 0),
    flush() { for (let i = 0; frames.size && i < 70; i++) { const [id, run] = frames.entries().next().value ?? assert.fail('animation frame was not queued'); frames.delete(id); run(0) } } }
}

test('Spotlight lands on the active screen and cleans up after the initial canvas handoff', () => {
  const ui = setup()
  setting().go()
  ui.flush()
  assert.equal(ui.screens[0]!.target.focuses, 1)
  assert.equal(ui.screens[2]!.target.focuses, 0, 'the exiting screen is last in DOM order')
  assert.equal(ui.screens[0]!.section.focuses, 1, 'initial canvas focus must not cancel landing')
  assert.equal(ui.listenerCount(), 0)
  assert.equal(ui.ended(), 1)
})

test('a newer landing, navigation away-and-back, and user intent cancel pending focus', () => {
  for (const cancel of ['supersede', 'navigate', 'focusin', 'input', 'pointerdown']) {
    const ui = setup()
    const typing = ui.page.activeElement
    setting().go()
    const stale = [...ui.frames.keys()].at(-1) ?? assert.fail('landing frame was not queued')
    if (cancel === 'supersede') setting('Models').go()
    else if (cancel === 'navigate') {
      useView.getState().openScreen('actions')
      useView.getState().openScreen('settings')
    }
    else ui.dispatch(cancel, { user: true })
    assert.equal(ui.frames.has(stale), false, `${cancel} cancels the landing frame`)
    ui.flush()
    assert.equal(ui.screens[0]!.target.focuses, cancel === 'supersede' ? 1 : 0, `${cancel} replaces or preserves the pending landing`)
    if (['focusin', 'input', 'pointerdown'].includes(cancel)) assert.equal(ui.page.activeElement === typing, true)
    assert.equal(ui.listenerCount(), 0)
    assert.equal(ui.ended(), cancel === 'supersede' ? 2 : 1)
  }
})

test('a missing target retries no more than sixty frames', () => {
  const ui = setup(true)
  setting().go()
  ui.flush()
  assert.equal(ui.lookups(), 60)
  assert.equal(ui.frames.size, 0)
  assert.equal(ui.listenerCount(), 0)
  assert.equal(ui.ended(), 1)
})
