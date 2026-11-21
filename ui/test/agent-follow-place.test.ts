import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mock, test } from 'node:test'

registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })

const { createElement, useInsertionEffect, useLayoutEffect, useState } = await import('react')

const ignore = () => {}
Object.assign(globalThis, { window: { addEventListener: ignore, removeEventListener: ignore } })
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
})

let clock = 0
mock.method(performance, 'now', () => clock)

const { mountCounting } = await import('./render-count.ts')
const { useFollow } = await import('../src/features/agent-activity/use-follow.ts')

/**
 * The transcript's box and its list of steps. A transcript shorter than its box sits at the box's bottom (mt-auto).
 * `transform` is the list's offset as the page last drew it: Motion writes a new offset on its next frame, so right
 * after the follow sets one, the page still shows the old.
 */
const page = { box: 500, list: 200, transform: 0 }
const scroller = {
  getBoundingClientRect: () => ({ top: 0 }),
  get scrollHeight() {
    return Math.max(page.box, page.list)
  },
  get clientHeight() {
    return page.box
  },
  scrollTop: 0,
  scrollLeft: 0,
  scrollTo: ignore,
  scrollBy: ignore,
  addEventListener: ignore,
  removeEventListener: ignore,
}
const list = { getBoundingClientRect: () => ({ top: page.box - page.list + page.transform }), addEventListener: ignore, removeEventListener: ignore }

let setStep: (step: number) => void = ignore
let offset = () => 0
/** The list's height once a step is drawn: the page lays it out as the step is put in place, before any layout effect. */
const heightAt = new Map<number, number>()

/** An agent's exchange as the screens use the hook: the place is noted while drawing, and settled after each new step. */
function Exchange() {
  const [step, showStep] = useState(0)
  setStep = showStep
  const scroll = useFollow(false)
  scroll.scroller.current = scroller as never
  scroll.content.current = list as never
  offset = () => scroll.y.get()
  scroll.note()
  useInsertionEffect(() => {
    page.list = heightAt.get(step) ?? page.list
  }, [step])
  useLayoutEffect(scroll.settle, [step, scroll.settle])
  return null
}

/** A new step whose list is `height` tall once drawn. */
const step = (number: number, height?: number) => {
  if (height !== undefined) heightAt.set(number, height)
  setStep(number)
}

async function open() {
  Object.assign(page, { box: 500, list: 200, transform: 0 })
  heightAt.clear()
  const exchange = await mountCounting(() => createElement(Exchange))
  // Well past the opening, so a change may glide.
  clock += 5_000
  return exchange
}

test('a step after the transcript box grew taller, with no scroll, does not set the list back and glide it', async () => {
  const exchange = await open()

  // The window is made taller: the short transcript moves down with its box's bottom. Nothing scrolls.
  page.box = 700
  // A new step: the list grows by 40 px, upward from the bottom.
  await exchange.change(() => step(1, 240))

  assert.equal(offset(), 0, 'nothing below the newest step got shorter, so there is nothing to glide')
  await exchange.unmount()
})

test('a step during a glide, before the page has drawn its new offset, does not make the next step glide for nothing', async () => {
  const exchange = await open()

  // A command folds: the bottom shrinks by 30 px, the list moves down, and it is set back to glide down into place.
  await exchange.change(() => step(1, 170))
  assert.equal(offset(), -30)
  page.transform = offset()

  // The next step comes within the glide. The follow stops the glide, but the page still shows the list 30 px up.
  await exchange.change(() => step(2, 210))
  assert.equal(offset(), 0)

  // The page draws the offset of 0, and one more step changes nothing below the newest step.
  page.transform = 0
  await exchange.change(() => step(3))

  assert.equal(offset(), 0, 'the list did not move, so it must not hop up and glide')
  await exchange.unmount()
})
