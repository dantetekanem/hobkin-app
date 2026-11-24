import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mock, test } from 'node:test'

registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })

const { createElement, useState } = await import('react')

const ignore = () => {}
Object.assign(globalThis, { window: { addEventListener: ignore, removeEventListener: ignore } })
/** The page's ResizeObserver: once a frame, after the page has laid it out, it tells what changed size. */
const observers: (() => void)[] = []
Object.assign(globalThis, {
  ResizeObserver: class {
    constructor(callback: () => void) {
      observers.push(callback)
    }
    observe() {}
    disconnect() {}
  },
})
const frame = () => observers.forEach((callback) => callback())

let clock = 0
mock.method(performance, 'now', () => clock)

const { mountCounting } = await import('./render-count.ts')
const { useFollow } = await import('../src/features/agent-activity/use-follow.ts')

/** The transcript's box, which counts every scroll asked of it and how. Its list of steps is `page.list` tall. */
const page = { list: 2000, box: 600 }
const scrolls = { writes: 0, smooth: 0, layoutReads: 0 }
const scroller = {
  scrollTop: 0,
  scrollLeft: 0,
  get scrollHeight() {
    return page.list
  },
  get clientHeight() {
    return page.box
  },
  scrollTo({ top = 0, behavior = 'auto' }: ScrollToOptions) {
    scrolls.writes += 1
    // A smooth scroll has only begun when the call returns.
    if (behavior === 'smooth') scrolls.smooth += 1
    else scroller.scrollTop = Math.max(0, Math.min(top, page.list - page.box))
  },
  scrollBy: ignore,
  getBoundingClientRect: () => ({ top: 0 }),
  addEventListener: ignore,
  removeEventListener: ignore,
}
const list = {
  getBoundingClientRect: () => {
    scrolls.layoutReads += 1
    return { top: 0 }
  },
  addEventListener: ignore,
  removeEventListener: ignore,
}

let addStep = () => {}
/** An agent's exchange as the screens draw it: a list of steps that grows, followed by the hook. */
function Exchange() {
  const [, setSteps] = useState(0)
  addStep = () => setSteps((count) => count + 1)
  const scroll = useFollow()
  scroll.scroller.current = scroller as never
  scroll.content.current = list as never
  return null
}

test('ten updates inside one frame scroll the view to the end once, at once, and read no layout while drawing', async () => {
  const exchange = await mountCounting(() => createElement(Exchange))
  assert.equal(scroller.scrollTop, page.list - page.box, 'it opens at the newest step')
  // Well past the opening, when a step used to be followed with a glide.
  clock += 5_000
  Object.assign(scrolls, { writes: 0, smooth: 0, layoutReads: 0 })

  for (let index = 0; index < 10; index++) {
    page.list += 50
    await exchange.change(() => addStep())
  }
  frame()

  assert.deepEqual(scrolls, { writes: 1, smooth: 0, layoutReads: 0 })
  assert.equal(scroller.scrollTop, page.list - page.box, 'at the end')
  await exchange.unmount()
})
