import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { inOverlay, installFrameKeys } from '../src/app/key-page.ts'
import { resolveKey, type KeyContext } from '../src/app/key-map.ts'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()

/** A window that counts its listeners and sends a key to each, in the order they were added. */
function page() {
  const listeners: Array<(event: Event) => void> = []
  return {
    listeners,
    addEventListener: (_type: string, listener: (event: Event) => void) => void listeners.push(listener),
    press: () => listeners.forEach((listener) => listener({} as Event)),
  }
}

test('a hot update swaps the handlers without adding or dropping a listener', () => {
  const window = page()
  const calls: string[] = []
  installFrameKeys(window as unknown as EventTarget, { capture: () => calls.push('old capture'), bubble: () => calls.push('old bubble') })
  installFrameKeys(window as unknown as EventTarget, { capture: () => calls.push('new capture'), bubble: () => calls.push('new bubble') })
  assert.equal(window.listeners.length, 2, 'one capture listener and one bubble listener, once per page')
  window.press()
  assert.deepEqual(calls, ['new capture', 'new bubble'])
})

test('a handler that throws is logged, and the next key still works', () => {
  const window = page()
  const logged = mock.method(console, 'error', () => {})
  let presses = 0
  installFrameKeys(window as unknown as EventTarget, {
    capture: () => {
      presses += 1
      if (presses === 1) throw new Error('broken once')
    },
    bubble: () => {},
  })
  window.press()
  window.press()
  assert.equal(presses, 2)
  assert.equal(logged.mock.calls[0]?.arguments[0], '[keys]')
  logged.mock.restore()
})

const element = (attributes: string[], drawn = true) => ({
  hasAttribute: (name: string) => attributes.includes(name),
  closest: () => null,
  getClientRects: () => (drawn ? [{}] : []),
})

test('a marker an overlay left behind never keeps command and a number from changing the screen', () => {
  const body = {}
  const inert = (dialogs: unknown[]) => ({ body, getElementById: () => element(['data-base-ui-inert']), querySelectorAll: () => dialogs }) as unknown as Document
  const context = (overlay: boolean): KeyContext => ({
    zone: 'other', messageEmpty: true, screens: ['reports', 'routines'], screen: 'reports', inOverlay: overlay, veilOpen: false, asking: false, outOfMenu: [],
  })
  const press = { key: '2', meta: true }

  for (const [name, dialogs] of [['nothing open', []], ['a dialog on its way out', [element(['data-ending-style'])]], ['one not drawn', [element([], false)]]] as const) {
    assert.deepEqual(resolveKey(press, context(inOverlay(body as EventTarget, inert([...dialogs])))), { do: 'open-screen', screen: 'routines', focusCanvas: true }, name)
  }
  assert.equal(inOverlay(body as EventTarget, inert([element([])])), true, 'an open lightbox still keeps its keys')
})
