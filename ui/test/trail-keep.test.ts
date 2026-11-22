import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { keepPart, pageKeep, restorePage, rowKeyOf, takeArrival } from '../src/app/kept-place.ts'
import { useView } from '../src/app/view-store.ts'
import { useWorkTab } from '../src/features/work/tab.ts'

const view = () => useView.getState()

/** A piece of a page without a browser: its attributes, its parent, and whether it holds another. */
interface Piece {
  attributes: Record<string, string>
  parentElement: Piece | null
  focused?: number
}
function piece(attributes: Record<string, string>, parent: Piece | null = null): Piece & HTMLElement {
  const made: Piece = { attributes, parentElement: parent, focused: 0 }
  return Object.assign(made, {
    getAttribute: (name: string) => made.attributes[name] ?? null,
    contains: (other: Piece | null) => {
      for (let at = other; at; at = at.parentElement) if (at === made) return true
      return false
    },
    focus: () => {
      made.focused = (made.focused ?? 0) + 1
      page.activeElement = made
    },
  }) as unknown as Piece & HTMLElement
}

const page = { activeElement: null as unknown, body: {}, listeners: new Map<string, Set<(event: Event) => void>>() }
let frames: (() => void)[] = []
function mount() {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get activeElement() {
        return page.activeElement
      },
      body: page.body,
      addEventListener: (name: string, run: (event: Event) => void) => {
        if (!page.listeners.has(name)) page.listeners.set(name, new Set())
        page.listeners.get(name)!.add(run)
      },
      removeEventListener: (name: string, run: (event: Event) => void) => page.listeners.get(name)?.delete(run),
    },
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (run: () => void) => frames.push(run) })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} })
}
const runFrame = () => {
  const now = frames
  frames = []
  now.forEach((run) => run())
}
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  frames = []
  page.activeElement = null
  page.listeners.clear()
})

test('Work comes back from a review opened on AI Reviews on that tab, with what it kept', () => {
  useView.setState({ screen: 'work', trail: [], openReview: null })
  useWorkTab.getState().choose('reviews')
  // What Work's page reads of itself as the user leaves it.
  const release = keepPart('work', 'page', { read: () => ({ focus: '[data-review-id="change:storefront:12"]', scroll: 420 }) })
  view().openReviewFor('change:storefront:12')
  release()
  assert.deepEqual(view().trail, [{ screen: 'work', keep: { tab: 'reviews', focus: '[data-review-id="change:storefront:12"]', scroll: 420 } }])

  // Something chose Work's other tab while the review showed.
  useWorkTab.getState().choose('work')
  view().leave()
  assert.equal(view().screen, 'work')
  assert.equal(useWorkTab.getState().tab, 'reviews', 'the tab is chosen again before Work draws')
  assert.deepEqual(takeArrival('work'), { tab: 'reviews', focus: '[data-review-id="change:storefront:12"]', scroll: 420 }, 'the page is given the rest as it arrives')
  assert.equal(takeArrival('work'), null, 'once')
})

test('only a way back gives a page what it kept; opening it again starts it as it always has', () => {
  useView.setState({ screen: 'work', trail: [] })
  useWorkTab.getState().choose('reviews')
  view().openScreen('yolo')
  useWorkTab.getState().choose('work')
  view().openScreen('work')
  assert.equal(useWorkTab.getState().tab, 'work', 'as "Open Work" from YOLO mode asks for it')
  assert.equal(takeArrival('work'), null)
  assert.deepEqual(view().trail, [], 'yet Work is no longer on the trail twice')
})

test('the row in focus is named by what it is, not by where it sits', () => {
  const root = piece({})
  const card = piece({ 'data-review-id': 'pr:o/r/12' }, root)
  const inside = piece({}, card)
  const tab = piece({ id: 'work-tab-reviews' }, root)
  const odd = piece({ 'data-change': 'a"b' }, root)
  assert.equal(rowKeyOf(inside, root), '[data-review-id="pr:o/r/12"]', 'from a part inside its row')
  assert.equal(rowKeyOf(tab, root), '[id="work-tab-reviews"]')
  assert.equal(rowKeyOf(odd, root), '[data-change="a\\"b"]')
  assert.equal(rowKeyOf(root, root), undefined, 'the page itself names no row')
  assert.equal(rowKeyOf(null, root), undefined)
})

test('a page keeps the row last pressed or focused in it, and how far it was scrolled', () => {
  mount()
  const root = Object.assign(piece({}), { scrollTop: 418.6 }) as Piece & Element & { scrollTop: number }
  const card = piece({ 'data-review-id': 'change:storefront:12' }, root)
  page.activeElement = piece({ 'data-change': 'elsewhere' })
  assert.deepEqual(pageKeep(root, card), { focus: '[data-review-id="change:storefront:12"]', scroll: 419 }, 'a click that gave the row no keyboard still names it')
  page.activeElement = card
  root.scrollTop = 0
  assert.deepEqual(pageKeep(root, null), { focus: '[data-review-id="change:storefront:12"]' })
})

/** A page to restore: its scroller, the section around it, its first stop and a row that may be drawn late. */
function scroller(rowDrawn: boolean) {
  const section = Object.assign(piece({ 'data-canvas-screen': 'work' }), { listeners: new Set<(event: Event) => void>() })
  const root = piece({}, section)
  const first = piece({ 'data-stop': '' }, root)
  const row = piece({ 'data-review-id': 'r1' }, root)
  const state = { rowDrawn, height: 900, top: 0 }
  Object.assign(section, {
    addEventListener: (_: string, run: (event: Event) => void) => section.listeners.add(run),
    removeEventListener: (_: string, run: (event: Event) => void) => section.listeners.delete(run),
  })
  Object.defineProperties(root, Object.getOwnPropertyDescriptors({
    closest: () => section,
    querySelector: (selector: string) => (selector === '[data-stop]' ? first : selector === '[data-review-id="r1"]' && state.rowDrawn ? row : null),
    get scrollHeight() {
      return state.height
    },
    clientHeight: 600,
    get scrollTop() {
      return state.top
    },
    set scrollTop(value: number) {
      state.top = value
    },
  }))
  const arrive = () => {
    let stopped = 0
    page.activeElement = section
    for (const run of [...section.listeners]) {
      run({ target: section, stopImmediatePropagation: () => stopped++ } as unknown as Event)
      if (stopped) break
    }
    // The page's own first stop takes the keyboard when nothing else did.
    if (!stopped) first.focus()
    return stopped
  }
  return { section, root: root as unknown as HTMLElement, first, row, state, arrive }
}

test('the row takes the keyboard as the page arrives, ahead of its first stop, and the scroll comes back', () => {
  mount()
  const page_ = scroller(true)
  page_.state.height = 600
  const stop = restorePage(page_.root, { focus: '[data-review-id="r1"]', scroll: 240 })
  assert.equal(page_.state.top, 0, 'not while the page is too short for it')
  assert.equal(page_.arrive(), 1, 'the first-stop handoff is taken over')
  assert.equal(page_.row.focused, 1)
  assert.equal(page_.first.focused, 0)
  page_.state.height = 1200
  runFrame()
  assert.equal(page_.state.top, 240)
  stop()
})

test('a row drawn late, as AI Reviews asked anew, still takes the keyboard from where the arrival put it', () => {
  mount()
  const page_ = scroller(false)
  const stop = restorePage(page_.root, { focus: '[data-review-id="r1"]', scroll: 120 })
  assert.equal(page_.state.top, 120, 'a page tall enough scrolls at once')
  assert.equal(page_.arrive(), 0, 'nothing to take over yet')
  assert.equal(page_.first.focused, 1)
  runFrame()
  assert.equal(page_.row.focused, 0)
  page_.state.rowDrawn = true
  runFrame()
  assert.equal(page_.row.focused, 1, 'it comes, and the keyboard moves onto it')
  stop()
})

test('what the user does first, or another control that took the keyboard, wins over the kept place', () => {
  mount()
  const typed = scroller(false)
  const stop = restorePage(typed.root, { focus: '[data-review-id="r1"]', scroll: 2000 })
  typed.arrive()
  for (const run of page.listeners.get('keydown') ?? []) run({} as Event)
  typed.state.rowDrawn = true
  typed.state.height = 4000
  runFrame()
  assert.deepEqual([typed.row.focused, typed.state.top], [0, 0], 'a key pressed ends it')
  stop()

  const taken = scroller(false)
  const release = restorePage(taken.root, { focus: '[data-review-id="r1"]' })
  taken.arrive()
  const other = piece({}, taken.root as unknown as Piece)
  other.focus()
  taken.state.rowDrawn = true
  runFrame()
  assert.equal(taken.row.focused, 0, 'a project row the World handed the keyboard to keeps it')
  release()
})
