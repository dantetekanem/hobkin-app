import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decide, everyWhileVisible, FALLBACK_MS, followArea, movingNow, type FollowPage } from '../src/features/canvas-panel/placement.ts'

test('a change looks on the next frame, once however many come in one frame, and the slow look runs only while visible', () => {
  assert.equal(decide({ cue: 'change', asked: false, visible: true }), 'next frame')
  assert.equal(decide({ cue: 'change', asked: true, visible: true }), 'rest')
  assert.equal(decide({ cue: 'tick', asked: false, visible: true }), 'now')
  assert.equal(decide({ cue: 'tick', asked: true, visible: true }), 'rest', 'a frame is already coming')
  assert.equal(decide({ cue: 'tick', asked: false, visible: false }), 'rest')
})

test('after a look it looks every frame while its place or cover changed or something that ends is moving, and rests after', () => {
  assert.equal(decide({ cue: 'looked', changed: true, moving: false }), 'next frame')
  assert.equal(decide({ cue: 'looked', changed: false, moving: true }), 'next frame')
  assert.equal(decide({ cue: 'looked', changed: false, moving: false }), 'rest')
})

const animation = (playState: string, endTime: number) => ({ playState, effect: { getComputedTiming: () => ({ endTime }) } })

test('only a running transition or animation that will end is moving; an endless or paused one is not', () => {
  assert.equal(movingNow([]), false)
  assert.equal(movingNow([animation('running', Infinity), animation('paused', 400), animation('finished', 400)]), false)
  assert.equal(movingNow([animation('running', Infinity), animation('running', 420)]), true)
  assert.equal(movingNow([{ playState: 'running', effect: null }]), false)
})

/** A page that records what the canvas listens to, and lets the test fire it. */
function fakePage() {
  const listeners = new Map<string, Set<() => void>>()
  const on = (type: string, listener: () => void) => {
    const ofType = listeners.get(type) ?? new Set()
    ofType.add(listener)
    listeners.set(type, ofType)
  }
  const off = (type: string, listener: () => void) => void listeners.get(type)?.delete(listener)
  const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach((listener) => listener())
  let frames: (() => void)[] = []
  const intervals = new Map<number, () => void>()
  let ids = 0
  const resized: (() => void)[] = []
  const mutated: (() => void)[] = []
  const observed: { target: unknown; options: unknown }[] = []
  let disconnected = 0
  const page = {
    visibilityState: 'visible' as DocumentVisibilityState,
    animations: [] as ReturnType<typeof animation>[],
  }
  const follow: FollowPage = {
    window: {
      addEventListener: on,
      removeEventListener: off,
      requestAnimationFrame: (run: () => void) => (frames.push(run), frames.length),
      cancelAnimationFrame: () => void (frames = []),
      setInterval: (run: () => void) => (intervals.set(++ids, run), ids),
      clearInterval: (id: number) => void intervals.delete(id),
    },
    document: {
      addEventListener: on,
      removeEventListener: off,
      body: 'body',
      get visibilityState() {
        return page.visibilityState
      },
      getAnimations: () => page.animations,
    },
    ResizeObserver: class {
      constructor(callback: () => void) {
        resized.push(callback)
      }
      observe(target: unknown) {
        observed.push({ target, options: 'size' })
      }
      disconnect() {
        disconnected += 1
      }
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        mutated.push(callback)
      }
      observe(target: unknown, options: unknown) {
        observed.push({ target, options })
      }
      disconnect() {
        disconnected += 1
      }
    },
  } as never
  return {
    page,
    follow,
    fire,
    observed,
    get disconnected() {
      return disconnected
    },
    listening: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
    /** Runs the frame that was asked for, if one was. Returns whether one was. */
    frame: () => {
      const due = frames
      frames = []
      due.forEach((run) => run())
      return due.length > 0
    },
    asked: () => frames.length,
    tick: () => [...intervals.values()].forEach((run) => run()),
    intervals: () => intervals.size,
    resize: () => resized.forEach((callback) => callback()),
    mutate: () => mutated.forEach((callback) => callback()),
  }
}

test('an idle page canvas looks once as it opens and then asks for no frame, while a resize, a transition or a dialog added asks for one', () => {
  const fake = fakePage()
  let looks = 0
  const lookFindingNothingNew = () => {
    looks += 1
    return false
  }
  const follow = followArea('area' as never, lookFindingNothingNew, fake.follow)
  assert.deepEqual(fake.observed, [{ target: 'area', options: 'size' }, { target: 'body', options: { childList: true, subtree: true } }])

  assert.equal(fake.frame(), true)
  assert.equal(looks, 1)
  assert.equal(fake.frame(), false, 'nothing changed and nothing moves: no frame is asked for')

  for (const cause of [() => fake.resize(), () => fake.fire('resize'), () => fake.fire('transitionrun'), () => fake.fire('animationend'), () => fake.mutate(), () => follow.cue()]) {
    cause()
    cause()
    assert.equal(fake.asked(), 1, 'two in one frame ask for one look')
    fake.frame()
  }
  assert.equal(looks, 7)
  assert.equal(fake.frame(), false)

  follow.stop()
  assert.equal(fake.disconnected, 2)
  assert.equal(fake.listening(), 0)
  assert.equal(fake.intervals(), 0)
})

test('it follows every frame while the area moves or a transition runs, and the slow look catches a cover no event told', () => {
  const fake = fakePage()
  let changes = 0
  let looks = 0
  // Each look finds a change while `changes` lasts.
  const look = () => {
    looks += 1
    const changed = changes > 0
    changes -= 1
    return changed
  }
  followArea('area' as never, look, fake.follow)

  // The canvas slides in: the look finds a new place on three frames in a row, then the same.
  changes = 3
  let frames = 0
  while (fake.frame()) frames += 1
  assert.equal(frames, 4)

  // A sheet fades in over it: the place stays, but a transition runs, so it keeps looking until the transition ends.
  fake.page.animations = [animation('running', 300), animation('running', Infinity)]
  fake.fire('transitionrun')
  assert.equal(fake.frame(), true)
  assert.equal(fake.frame(), true)
  fake.page.animations = [animation('running', Infinity)]
  assert.equal(fake.frame(), true)
  assert.equal(fake.frame(), false, 'the endless one does not keep it looking')

  // A cover no event announced: the slow look finds it and follows from the next frame.
  looks = 0
  changes = 1
  fake.tick()
  assert.equal(looks, 1)
  assert.equal(fake.asked(), 1)
  fake.frame()

  // A hidden window does not look.
  fake.page.visibilityState = 'hidden'
  fake.tick()
  assert.equal(looks, 2)
  fake.page.visibilityState = 'visible'
  fake.fire('visibilitychange')
  assert.equal(fake.asked(), 1, 'it looks again as soon as it shows')
})

test('a reading runs every so often only while the page is visible, and once at once when it shows again', () => {
  const fake = fakePage()
  let reads = 0
  const stop = everyWhileVisible(1000, () => void (reads += 1), fake.follow)
  assert.equal(fake.intervals(), 1)
  fake.tick()
  assert.equal(reads, 1)

  fake.page.visibilityState = 'hidden'
  fake.fire('visibilitychange')
  assert.equal(fake.intervals(), 0)

  fake.page.visibilityState = 'visible'
  fake.fire('visibilitychange')
  assert.equal(reads, 2)
  assert.equal(fake.intervals(), 1)

  stop()
  assert.equal(fake.intervals(), 0)
  assert.equal(fake.listening(), 0)
  assert.equal(FALLBACK_MS, 250)
})
