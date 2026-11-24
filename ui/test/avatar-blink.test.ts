import assert from 'node:assert/strict'
import { after, mock, test, type TestContext } from 'node:test'

// The page the blinks follow: its visibility, the marks on its root (`data-away`, `data-motion`) and what is on screen.
let visibility: 'visible' | 'hidden' = 'visible'
const rootMarks = new Map<string, string>()
const visibilityListeners: (() => void)[] = []
const rootListeners: (() => void)[] = []
const offScreen = new Set<object>()
let reportScreen: (entries: { target: object; isIntersecting: boolean }[]) => void = () => {}

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    get visibilityState() {
      return visibility
    },
    documentElement: {
      hasAttribute: (name: string) => rootMarks.has(name),
      getAttribute: (name: string) => rootMarks.get(name) ?? null,
    },
    addEventListener: (type: string, listener: () => void) => type === 'visibilitychange' && visibilityListeners.push(listener),
  },
})
Object.defineProperty(globalThis, 'MutationObserver', {
  configurable: true,
  value: class {
    constructor(listener: () => void) {
      rootListeners.push(listener)
    }
    observe() {}
  },
})
Object.defineProperty(globalThis, 'IntersectionObserver', {
  configurable: true,
  value: class {
    constructor(report: typeof reportScreen) {
      reportScreen = report
    }
    observe(target: object) {
      reportScreen([{ target, isIntersecting: !offScreen.has(target) }])
    }
    unobserve() {}
  },
})

function showWindow(now: 'visible' | 'hidden') {
  visibility = now
  for (const listener of visibilityListeners) listener()
}
function markRoot(name: string, value: string | null) {
  if (value === null) rootMarks.delete(name)
  else rootMarks.set(name, value)
  for (const listener of rootListeners) listener()
}

// Every timer the page has set and not yet run or cleared.
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
const timersSet = new Set<unknown>()
const mockedSetTimeout = globalThis.setTimeout
const mockedClearTimeout = globalThis.clearTimeout
globalThis.setTimeout = ((run: () => void, ms?: number) => {
  const timer = mockedSetTimeout(() => {
    timersSet.delete(timer)
    run()
  }, ms)
  timersSet.add(timer)
  return timer
}) as typeof setTimeout
globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
  timersSet.delete(timer)
  mockedClearTimeout(timer)
}) as typeof clearTimeout

const { BLINK_EVERY_MS, watchBlinks } = await import('../src/avatar/blink.ts')
after(() => {
  mock.timers.reset()
  for (const name of ['document', 'MutationObserver', 'IntersectionObserver']) Reflect.deleteProperty(globalThis, name)
})

/** A face whose eyes write down each blink. */
function face(blinks: string[], name: string): Element {
  const eyes = {
    classList: { contains: (className: string) => className === 'hob-b-on' },
    closest: () => null,
    animate: () => void blinks.push(name),
  }
  return { querySelector: () => eyes } as unknown as Element
}

/** Lets time pass a tenth of a second at a time, so a timer set while it passes runs when it is due. */
const STEP_MS = 100
function wait(ms: number) {
  for (let waited = 0; waited < ms; waited += STEP_MS) {
    mock.timers.tick(Math.min(STEP_MS, ms - waited))
    assert.ok(timersSet.size <= 1, 'never a second timer')
  }
}

/** Watches each face for the length of the test, and stops watching it after, whatever the test found. */
function watchAll(t: TestContext, faces: Element[]) {
  const stops = faces.map(watchBlinks)
  const stopAll = () => stops.splice(0).forEach((stop) => stop())
  t.after(stopAll)
  return stopAll
}

function eightFaces(blinks: string[]) {
  return Array.from({ length: 8 }, (_, index) => face(blinks, `face ${index + 1}`))
}

test('eight faces wait on one timer, and each blinks once in its first ten seconds, none in the first six', (t) => {
  const blinks: string[] = []
  const stopAll = watchAll(t, eightFaces(blinks))
  assert.equal(timersSet.size, 1)

  wait(BLINK_EVERY_MS.least - 1)
  assert.deepEqual(blinks, [])
  wait(BLINK_EVERY_MS.most - BLINK_EVERY_MS.least + 1)

  assert.equal(blinks.length, 8)
  assert.equal(new Set(blinks).size, 8, 'each face once')
  stopAll()
  assert.equal(timersSet.size, 0, 'no face, no timer')
})

test('a hidden window, or one away, schedules no blink, and once back each face blinks in its own time again', (t) => {
  const blinks: string[] = []
  watchAll(t, eightFaces(blinks))

  showWindow('hidden')
  assert.equal(timersSet.size, 0)
  wait(60_000)
  assert.deepEqual(blinks, [])

  showWindow('visible')
  assert.equal(timersSet.size, 1)
  wait(BLINK_EVERY_MS.least - 1)
  assert.deepEqual(blinks, [], 'blinks missed while hidden are not made up at once')
  // One step more: the fake clock sets the missed blinks again at the end of the first step after the window shows.
  wait(BLINK_EVERY_MS.most - BLINK_EVERY_MS.least + 1 + STEP_MS)
  assert.equal(blinks.length, 8)

  markRoot('data-away', '')
  assert.equal(timersSet.size, 0)
  wait(60_000)
  assert.equal(blinks.length, 8)
  markRoot('data-away', null)
  assert.equal(timersSet.size, 1)
})

test('under Still no blink is scheduled', (t) => {
  const blinks: string[] = []
  markRoot('data-motion', 'still')
  t.after(() => markRoot('data-motion', null))
  watchAll(t, eightFaces(blinks))

  assert.equal(timersSet.size, 0)
  wait(60_000)
  assert.deepEqual(blinks, [])

  markRoot('data-motion', 'lively')
  assert.equal(timersSet.size, 1)
})

test('a face off screen schedules no blink until it comes into view', (t) => {
  const blinks: string[] = []
  const away = face(blinks, 'scrolled away')
  offScreen.add(away)
  watchAll(t, [away])

  assert.equal(timersSet.size, 0)
  wait(60_000)
  assert.deepEqual(blinks, [])

  reportScreen([{ target: away, isIntersecting: true }])
  assert.equal(timersSet.size, 1)
  wait(BLINK_EVERY_MS.most + 1 + STEP_MS)
  assert.deepEqual(blinks, ['scrolled away'])
})
