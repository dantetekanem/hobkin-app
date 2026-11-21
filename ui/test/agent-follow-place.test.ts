import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mock, test } from 'node:test'

registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })

const { createElement, useLayoutEffect, useState } = await import('react')

const ignore = () => {}
Object.assign(globalThis, { window: { addEventListener: ignore, removeEventListener: ignore } })

/** A ResizeObserver that calls back only for what it watches, when the test says a box changed size, as the page does. */
const watching: { callback: () => void; targets: Set<object> }[] = []
Object.assign(globalThis, {
  ResizeObserver: class {
    targets = new Set<object>()
    constructor(callback: () => void) {
      watching.push({ callback, targets: this.targets })
    }
    observe(target: object) {
      this.targets.add(target)
    }
    disconnect() {
      this.targets.clear()
    }
  },
})
const resized = (target: object) => watching.filter(({ targets }) => targets.has(target)).forEach(({ callback }) => callback())

let clock = 0
mock.method(performance, 'now', () => clock)

const { mountCounting } = await import('./render-count.ts')
const { useFollow } = await import('../src/features/agent-activity/use-follow.ts')

// The transcript's box and its list of steps. A transcript shorter than its box sits at the box's bottom (mt-auto).
const box = { height: 500, list: 200 }
const scroller = {
  getBoundingClientRect: () => ({ top: 0 }),
  get scrollHeight() {
    return Math.max(box.height, box.list)
  },
  get clientHeight() {
    return box.height
  },
  scrollTop: 0,
  scrollLeft: 0,
  scrollTo: ignore,
  scrollBy: ignore,
  addEventListener: ignore,
  removeEventListener: ignore,
}
const list = { getBoundingClientRect: () => ({ top: box.height - box.list }), addEventListener: ignore, removeEventListener: ignore }

let addStep: (step: number) => void = ignore
let offset = () => 0

/** An agent's exchange as the screens use the hook: the list settles after each new step. */
function Exchange() {
  const [step, setStep] = useState(0)
  addStep = setStep
  const scroll = useFollow(false)
  scroll.scroller.current = scroller as never
  scroll.content.current = list as never
  offset = () => scroll.y.get()
  useLayoutEffect(scroll.settle, [step, scroll.settle])
  return null
}

test('a step after the transcript box grew taller, with no scroll, does not set the list back and glide it', async () => {
  const page = await mountCounting(() => createElement(Exchange))
  // Well past the opening, so a change may glide.
  clock = 5_000

  // The window is made taller: the short transcript moves down with its box's bottom. Nothing scrolls, and the list
  // keeps its size, so only the box tells of the change.
  box.height = 700
  resized(scroller)

  // A new step: the list grows by 40 px, upward from the bottom.
  await page.change(() => {
    box.list = 240
    addStep(1)
  })

  assert.equal(offset(), 0, 'nothing below the newest step got shorter, so there is nothing to glide')
  await page.unmount()
})
