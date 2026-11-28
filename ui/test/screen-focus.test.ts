import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { focusCanvas, handOffCanvasFocus, hearStrayKeys, requestCanvasFocus, takeKeyboardIfNowhere } from '../src/app/focus.ts'
import { useView } from '../src/app/view-store.ts'
import { bindStops } from '../src/app/stops.ts'

// Exercise focus ownership without a browser; React mounting and native focus events need a rendered check.
const interactions = new EventTarget()
const page = {
  body: {},
  activeElement: null as unknown,
  activeKey: 'screen',
  querySelector: () => ({ dataset: { activeCanvasScreen: page.activeKey } }),
  querySelectorAll: () => [] as Element[],
  addEventListener: interactions.addEventListener.bind(interactions),
  removeEventListener: interactions.removeEventListener.bind(interactions),
}
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
})

test('screen entry and lazy handoff preserve scroll; arrows still reveal their control', () => {
  type StopEvent = { target?: unknown; key?: string; preventDefault?: () => void }
  const listeners = new Map<string, (event: StopEvent) => void>()
  const calls: unknown[] = []
  const stop = {
    hasAttribute: () => false,
    focus: (options?: FocusOptions) => calls.push(options),
    scrollIntoView: (options: ScrollIntoViewOptions) => calls.push(options),
  }
  const section = {
    addEventListener: (name: string, run: (event: StopEvent) => void) => listeners.set(name, run),
    removeEventListener: (name: string) => listeners.delete(name),
  }
  const root = {
    closest: () => section,
    querySelectorAll: () => [stop],
    addEventListener: section.addEventListener,
    removeEventListener: section.removeEventListener,
  } as unknown as HTMLElement
  mount()
  Object.assign(section, { dataset: { canvasScreen: 'screen' } })
  page.querySelectorAll = () => [section as unknown as Element]
  page.activeElement = section
  const release = bindStops(root)
  assert.deepEqual(calls, [{ preventScroll: true }], 'lazy mounted first control')
  calls.length = 0
  listeners.get('focus')!({ target: section })
  assert.deepEqual(calls, [{ preventScroll: true }], 'arriving screen focus handoff')
  calls.length = 0
  listeners.get('keydown')!({ key: 'ArrowDown', preventDefault() {} })
  assert.deepEqual(calls, [undefined, { block: 'nearest', behavior: 'smooth' }])
  release?.()
  assert.equal(listeners.size, 0)
})

function screen(key = 'screen') {
  const listeners = new Set<(event: { target: unknown }) => void>()
  const section = {
    dataset: { canvasScreen: key },
    focus() { page.activeElement = section; listeners.forEach((take) => take({ target: section })) },
    addEventListener(_name: string, take: (event: { target: unknown }) => void) { listeners.add(take) },
    removeEventListener(_name: string, take: (event: { target: unknown }) => void) { listeners.delete(take) },
  }
  const root = {
    closest: () => section,
    focus() { Object.assign(document, { activeElement: root }); page.activeElement = root },
  }
  return { section, root: root as unknown as HTMLElement }
}

function mount(...screens: ReturnType<typeof screen>[]) {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: page })
  page.querySelectorAll = () => screens.map(({ section }) => section as unknown as Element)
  page.activeKey = screens.at(-1)?.section.dataset.canvasScreen ?? 'screen'
  page.activeElement = { typing: true }
}

test('explicit entry takes focus from typing and hands it to the arriving screen, not the departing one', () => {
  const leaving = screen('reports')
  const arriving = screen('routines')
  mount(leaving, arriving)
  const release = handOffCanvasFocus(arriving.root)
  focusCanvas()
  assert.equal(page.activeElement, arriving.root)
  release()
})

test('interrupted return focuses the active key even when an exiting section is last in the DOM', () => {
  const routines = screen('routines')
  const reports = screen('reports')
  mount(routines, reports)
  page.activeKey = 'routines'
  const release = handOffCanvasFocus(routines.root)
  focusCanvas()
  assert.equal(page.activeElement, routines.root)
  release()
})

test('connect and individual agents keep their exact identity while other sections exit', () => {
  for (const key of ['connect', 'agent:first', 'agent:second']) {
    const active = screen(key)
    mount(active, screen('agent:leaving'))
    page.activeKey = key
    focusCanvas()
    assert.equal(page.activeElement, active.section)
  }
})

test('a lazy departing screen cannot accept focus after another section becomes active', () => {
  const leaving = screen('review')
  mount(leaving, screen('routines'))
  page.activeElement = leaving.section
  const release = handOffCanvasFocus(leaving.root)
  assert.equal(page.activeElement, leaving.section)
  leaving.section.focus()
  assert.equal(page.activeElement, leaving.section)
  release()
})

test('typing resumed in the same input supersedes a pending entry frame', () => {
  const frames: FrameRequestCallback[] = []
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (run: FrameRequestCallback) => frames.push(run) })
  mount(screen('review'))
  const typing = page.activeElement
  requestCanvasFocus()
  interactions.dispatchEvent(new Event('input'))
  frames.shift()!(0)
  assert.equal(page.activeElement, typing)
  requestCanvasFocus()
  frames.shift()!(0)
  assert.notEqual(page.activeElement, typing, 'a fresh explicit entry still takes focus')
})

test('a targeted Settings return selects its opener only inside the active screen and preserves scroll', () => {
  const frames: FrameRequestCallback[] = []
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (run: FrameRequestCallback) => frames.push(run) })
  const settings = screen('settings')
  mount(settings, screen('integrations'))
  page.activeKey = 'settings'
  const calls: FocusOptions[] = []
  const opener = { focus(options: FocusOptions) { calls.push(options); page.activeElement = opener } }
  Object.assign(settings.section, { querySelector(selector: string) {
    assert.equal(selector, '[data-opens="integrations"]')
    return opener
  } })
  requestCanvasFocus('[data-opens="integrations"]')
  frames.shift()!(0)
  assert.equal(page.activeElement, opener)
  assert.deepEqual(calls, [{ preventScroll: true }])
  Object.assign(settings.section, { querySelector: () => null })
  requestCanvasFocus('[data-opens="integrations"]')
  frames.shift()!(0)
  assert.equal(page.activeElement, settings.section, 'missing opener falls back to the active section')
})

test('agent switch focuses the arriving composer after the old composer unmounts', () => {
  const frames: FrameRequestCallback[] = []
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (run: FrameRequestCallback) => frames.push(run) })
  const next = screen('agent:next')
  mount(next)
  const previous = { isConnected: true }
  page.activeElement = previous
  const composer = { focus() { page.activeElement = composer } }
  Object.assign(next.section, { querySelector: () => composer })
  requestCanvasFocus('[data-agent-input]')
  previous.isConnected = false
  page.activeElement = document.body
  frames.shift()!(0)
  assert.equal(page.activeElement, composer)
})

test('targeted returns cancel on interactions or a newer navigation and remove their listeners', () => {
  const frames: FrameRequestCallback[] = []
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (run: FrameRequestCallback) => frames.push(run) })
  const settings = screen('settings')
  mount(settings)
  let selections = 0
  const listeners = new Map<unknown, Set<string>>()
  const add = page.addEventListener
  const remove = page.removeEventListener
  page.addEventListener = (...args: Parameters<typeof add>) => {
    const names = listeners.get(args[1]) ?? new Set<string>()
    names.add(args[0]); listeners.set(args[1], names); add(...args)
  }
  page.removeEventListener = (...args: Parameters<typeof remove>) => {
    const names = listeners.get(args[1])
    names?.delete(args[0])
    if (!names?.size) listeners.delete(args[1])
    remove(...args)
  }
  Object.assign(settings.section, { querySelector() { selections++; return null } })
  for (const event of ['input', 'pointerdown', 'focusin']) {
    const typing = page.activeElement
    requestCanvasFocus('[data-opens="integrations"]')
    interactions.dispatchEvent(new Event(event))
    frames.shift()!(0)
    assert.equal(page.activeElement, typing)
    assert.equal(listeners.size, 0, 'interaction cancellation releases its listeners')
  }
  requestCanvasFocus('[data-opens="integrations"]')
  requestCanvasFocus()
  frames.shift()!(0)
  assert.equal(selections, 0, 'superseded selectors never run')
  frames.shift()!(0)
  assert.equal(page.activeElement, settings.section)
  requestCanvasFocus('[data-opens="integrations"]')
  frames.shift()!(0)
  assert.equal(selections, 1, 'fresh return still runs after cancellation cleanup')
  assert.equal(listeners.size, 0, 'completed and superseded returns release their listeners')
  page.addEventListener = add
  page.removeEventListener = remove
})

test('a review that loads after entry accepts the keyboard waiting on its section', () => {
  const review = screen()
  mount(review)
  focusCanvas()
  assert.equal(page.activeElement, review.section)
  const release = handOffCanvasFocus(review.root)
  assert.equal(page.activeElement, review.root)
  release()
})

test('loading or refreshing a review does not steal typing focus; explicit reentry still works', () => {
  const review = screen()
  mount(review)
  const typing = page.activeElement
  const release = handOffCanvasFocus(review.root)
  assert.equal(page.activeElement, typing)
  focusCanvas()
  assert.equal(page.activeElement, review.root)
  release()
  focusCanvas()
  assert.equal(page.activeElement, review.section, 'the removed screen no longer receives focus events')
})

test('Settings and Integrations entries request focus even when opened without a keyboard shortcut', () => {
  const frames: FrameRequestCallback[] = []
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (run: FrameRequestCallback) => frames.push(run) })
  useView.setState(useView.getInitialState())
  const view = useView.getState()
  mount(screen())
  view.toggleSettings()
  assert.equal(frames.length, 1)
  view.toggleIntegrations()
  assert.equal(frames.length, 2)
})

test('explicit review routes take focus and closing restores the opener screen, but state refreshes do not', () => {
  const frames: FrameRequestCallback[] = []
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (run: FrameRequestCallback) => frames.push(run) })
  useView.setState(useView.getInitialState())
  const view = useView.getState()
  view.openScreen('actions')
  const review = screen()
  mount(review)
  view.openReviewFor('sample')
  assert.equal(frames.length, 1)
  frames.shift()!(0)
  assert.equal(page.activeElement, review.section)
  const typing = { typing: true }
  page.activeElement = typing
  useView.setState({ openReview: 'refreshed' })
  assert.equal(frames.length, 0)
  assert.equal(page.activeElement, typing)
  const opener = screen()
  mount(opener)
  view.closeReview()
  frames.shift()!(0)
  assert.equal(useView.getState().screen, 'actions')
  assert.equal(page.activeElement, opener.section)
})

test('a screen takes the keyboard when it is nowhere, never from where the user types', () => {
  const body = { tagName: 'BODY' }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { ...page, body, documentElement: { tagName: 'HTML' }, activeElement: body } })
  const review = screen('review')
  assert.equal(takeKeyboardIfNowhere(review.root), true)
  assert.equal(document.activeElement, review.root)
  // Typing in the chat box, or a button that is still in the page, keeps the keyboard.
  const chat = { tagName: 'TEXTAREA', isConnected: true }
  Object.assign(document, { activeElement: chat })
  assert.equal(takeKeyboardIfNowhere(review.root), false)
  assert.equal(document.activeElement, chat)
  // Whatever held it left the page with its screen.
  Object.assign(document, { activeElement: { tagName: 'BUTTON', isConnected: false } })
  assert.equal(takeKeyboardIfNowhere(review.root), true)
})

test('a key pressed with the keyboard on the page itself goes to the open screen, which takes the keyboard', () => {
  const body = { tagName: 'BODY' }
  const review = screen('review')
  const leaving = screen('work')
  Object.assign(review.root, { isConnected: true })
  let listener: ((event: unknown) => void) | null = null
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      ...page,
      body,
      documentElement: { tagName: 'HTML' },
      activeElement: body,
      // The two screens, and no dialog, menu or list over the window.
      querySelectorAll: (selector: string) => (selector.includes('data-canvas-screen') ? [review.section, leaving.section] : []),
      addEventListener: (_name: string, take: (event: unknown) => void) => void (listener = take),
      removeEventListener: () => void (listener = null),
    },
  })
  page.activeKey = 'review'
  const heard: string[] = []
  const release = hearStrayKeys(review.root, (event) => heard.push(event.key))
  const press = (key: string, target: unknown, defaultPrevented = false) => listener?.({ key, target, defaultPrevented })

  press('ArrowDown', body)
  assert.deepEqual(heard, ['ArrowDown'], 'a key on the page itself')
  assert.equal(document.activeElement, review.root, 'the screen took the keyboard')
  press('j', { tagName: 'DIV', isConnected: false })
  assert.deepEqual(heard, ['ArrowDown', 'j'], 'a key on something that has left the page, as the code view drawn for the last file')

  press('k', { tagName: 'BUTTON', isConnected: true })
  press('k', body, true)
  assert.deepEqual(heard, ['ArrowDown', 'j'], 'a control still on the page keeps its keys, and a key already used goes no further')
  page.activeKey = 'work'
  press('k', body)
  assert.deepEqual(heard, ['ArrowDown', 'j'], 'a screen on its way out hears nothing')

  release()
  assert.equal(listener, null)
})
