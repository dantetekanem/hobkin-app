import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })

const { Activity, createElement, useState } = await import('react')

const ignore = () => {}
Object.assign(globalThis, { window: { addEventListener: ignore, removeEventListener: ignore } })
/** The page's ResizeObserver: it tells what changed size when the test says the page laid out, until it is let go. */
const observers = new Set<() => void>()
Object.assign(globalThis, {
  ResizeObserver: class {
    callback: () => void
    constructor(callback: () => void) {
      this.callback = callback
    }
    observe() {
      observers.add(this.callback)
    }
    disconnect() {
      observers.delete(this.callback)
    }
  },
})
const laidOut = () => observers.forEach((callback) => callback())

const { mountCounting } = await import('./render-count.ts')
const { useFollow } = await import('../src/features/agent-activity/use-follow.ts')
type FollowStart = import('../src/features/agent-activity/follow.ts').FollowStart

/** The transcript's box, 3000 px of steps in a 600 px view. */
const page = { list: 3000, box: 600 }
const scroller = {
  scrollTop: 0,
  scrollLeft: 0,
  get scrollHeight() {
    return page.list
  },
  get clientHeight() {
    return page.box
  },
  scrollTo({ top = 0 }: ScrollToOptions) {
    scroller.scrollTop = Math.max(0, Math.min(top, page.list - page.box))
  },
  scrollBy: ignore,
  getBoundingClientRect: () => ({ top: 0 }),
  addEventListener: ignore,
  removeEventListener: ignore,
}
const list = { getBoundingClientRect: () => ({ top: 0 }), addEventListener: ignore, removeEventListener: ignore }
const end = () => page.list - page.box

/** Where the page was left, as whoever keeps it would say when it is shown again. */
let left: FollowStart | undefined
let pinned: boolean | undefined
let show = (_shown: boolean) => {}

function Exchange() {
  const scroll = useFollow({ start: () => left })
  scroll.scroller.current = scroller as never
  scroll.content.current = list as never
  pinned = scroll.pinned
  return null
}
function Kept() {
  const [shown, setShown] = useState(true)
  show = setShown
  return createElement(Activity, { mode: shown ? 'visible' : 'hidden', children: createElement(Exchange) })
}

test('with no place to start from, the exchange opens at its newest step and follows it', async () => {
  left = undefined
  scroller.scrollTop = 0
  const mounted = await mountCounting(() => createElement(Exchange))
  assert.equal(scroller.scrollTop, end())
  assert.equal(pinned, true)
  await mounted.unmount()
})

test('an exchange left read up opens where it was, not following, and the page laying out does not take it to the end', async () => {
  left = { following: false, top: 900 }
  scroller.scrollTop = 0
  const mounted = await mountCounting(() => createElement(Exchange))
  assert.equal(scroller.scrollTop, 900)
  assert.equal(pinned, false, 'the way back down is offered')
  page.list = 3300
  laidOut()
  assert.equal(scroller.scrollTop, 900)
  await mounted.unmount()
  page.list = 3000
})

test('a kept page shown again opens where it was left while hidden, read up or following', async () => {
  left = undefined
  scroller.scrollTop = 0
  const mounted = await mountCounting(() => createElement(Kept))
  assert.equal(scroller.scrollTop, end())

  // Hidden, and left read up: shown again, it is where it was.
  await mounted.change(() => show(false))
  left = { following: false, top: 400 }
  scroller.scrollTop = 0
  await mounted.change(() => show(true))
  assert.equal(scroller.scrollTop, 400)
  assert.equal(pinned, false)
  laidOut()
  assert.equal(scroller.scrollTop, 400, 'the page laying out after it is shown does not take it to the end')

  // Left following: shown again, it is at the newest.
  await mounted.change(() => show(false))
  left = { following: true, top: 0 }
  await mounted.change(() => show(true))
  assert.equal(scroller.scrollTop, end())
  assert.equal(pinned, true)
  await mounted.unmount()
})
