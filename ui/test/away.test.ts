import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
const { AWAY_AFTER_MS, holdLoops, startAway, watchAway } = await import('../src/app/away.ts')
const { canvasGrowth, covered, CONVERSATION_WIDTH } = await import('../src/app/view-store.ts')
after(() => mock.timers.reset())

test('the chat is covered once the canvas has grown over all of it, and not while any of it shows or has the keyboard', () => {
  const conversationWidth = CONVERSATION_WIDTH.initial
  const split = canvasGrowth({ screen: 'agent', canvasEngaged: false, conversationWidth, split: true })
  const review = canvasGrowth({ screen: 'review', canvasEngaged: true, conversationWidth })
  const settled = { conversationWidth, settled: true, chatFocused: false }

  assert.equal(covered({ ...settled, growth: split }), true, "a durable hobkin's split covers the whole chat")
  assert.equal(covered({ ...settled, growth: split, settled: false }), false, 'not while the canvas is still growing')
  assert.equal(covered({ ...settled, growth: split, chatFocused: true }), false, 'not while the keyboard is in the chat')
  assert.equal(covered({ ...settled, growth: review }), false, 'a review leaves a strip of the chat in view')
  assert.equal(covered({ ...settled, growth: 0 }), false)
})

/** A running animation, as `getAnimations()` gives it: a loop runs forever, a one-shot (an entrance, a fade) once. */
function fakeAnimation(iterations: number) {
  return { playbackRate: 1, playState: 'running', effect: { getTiming: () => ({ iterations }) } }
}
const loop = () => fakeAnimation(Infinity)
const oneShot = () => fakeAnimation(1)
type FakeAnimation = ReturnType<typeof fakeAnimation>

const moving = (animation: FakeAnimation) => animation.playbackRate !== 0

/** A page with a window that can go to the background and come back, and its running animations. */
function fakePage({ focused = true } = {}) {
  const window = new EventTarget()
  let hasFocus = focused
  const root = new Set<string>()
  let writes = 0
  const animations: FakeAnimation[] = []
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
    hasFocus: () => hasFocus,
    getAnimations: () => animations,
    documentElement: {
      toggleAttribute(name: string, force: boolean) {
        if (force && !root.has(name)) writes += 1
        if (force) root.add(name)
        else root.delete(name)
        return force
      },
    },
  })
  return {
    page: { document, window },
    get away() {
      return root.has('data-away')
    },
    get writes() {
      return writes
    },
    /** An animation that starts on the page now, as a new face, a log line or a tooltip starts one. */
    start(animation: FakeAnimation) {
      animations.push(animation)
      document.dispatchEvent(new Event('animationstart'))
      return animation
    },
    blur() {
      hasFocus = false
      window.dispatchEvent(new Event('blur'))
    },
    focus() {
      hasFocus = true
      window.dispatchEvent(new Event('focus'))
    },
    hide() {
      document.visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    },
    show() {
      document.visibilityState = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    },
    /** The user moves the pointer over the window, scrolls it or presses a key in it. */
    use(type: 'pointermove' | 'wheel' | 'keydown') {
      window.dispatchEvent(new Event(type))
    },
  }
}

test('the page is away when hidden or a minute in the background, and back at once', () => {
  assert.equal(AWAY_AFTER_MS, 60_000)
  const fake = fakePage()
  const stop = watchAway(fake.page)
  assert.equal(fake.away, false, 'a page in front is here')

  fake.blur()
  mock.timers.tick(59_999)
  assert.equal(fake.away, false, 'in the background for less than a minute')
  mock.timers.tick(1)
  assert.equal(fake.away, true, 'a minute in the background')
  fake.focus()
  assert.equal(fake.away, false, 'focus brings it back at once')

  fake.hide()
  assert.equal(fake.away, true, 'hidden is away at once')
  fake.show()
  assert.equal(fake.away, false, 'showing again brings it back at once')

  fake.blur()
  mock.timers.tick(60_000)
  fake.hide()
  assert.equal(fake.away, true)
  fake.show()
  assert.equal(fake.away, false, 'shown again while still in the background, it is back at once')
  mock.timers.tick(59_999)
  assert.equal(fake.away, false, 'and its minute starts over')
  mock.timers.tick(1)
  assert.equal(fake.away, true)

  for (const type of ['pointermove', 'wheel', 'keydown'] as const) {
    fake.use(type)
    assert.equal(fake.away, false, `a ${type} over the background window brings it back at once`)
    mock.timers.tick(60_000)
    assert.equal(fake.away, true, 'and a quiet minute sends it away again')
  }

  fake.use('pointermove')
  mock.timers.tick(30_000)
  fake.use('wheel')
  mock.timers.tick(59_999)
  assert.equal(fake.away, false, 'the minute counts from the last movement')
  mock.timers.tick(1)
  assert.equal(fake.away, true)

  stop()
  assert.equal(fake.away, false, 'a stopped watcher takes its mark away')
})

test('a page that starts in the background is away a minute later, unless the user moves over it', () => {
  const fake = fakePage({ focused: false })
  const stop = watchAway(fake.page)
  mock.timers.tick(59_999)
  fake.use('pointermove')
  mock.timers.tick(59_999)
  assert.equal(fake.away, false)
  mock.timers.tick(1)
  assert.equal(fake.away, true)
  stop()
})

test('while away only endless loops hold still, one-shot animations run, and the held loops play again on return', () => {
  const fake = fakePage()
  const spinner = fake.start(loop())
  const fadeIn = fake.start(oneShot())
  const stop = watchAway(fake.page)

  fake.blur()
  mock.timers.tick(60_000)
  assert.equal(moving(spinner), false, 'a loop holds still')
  assert.equal(moving(fadeIn), true, 'a one-shot runs to its end')

  const newLoop = fake.start(loop())
  const newEntrance = fake.start(oneShot())
  assert.equal(moving(newLoop), false, 'a loop that starts while away holds still too')
  assert.equal(moving(newEntrance), true, 'an entrance that starts while away runs, so nothing stays blank')

  fake.focus()
  assert.deepEqual([spinner, fadeIn, newLoop, newEntrance].map(moving), [true, true, true, true], 'back, every held loop plays again')
  const later = fake.start(loop())
  assert.equal(moving(later), true, 'and a loop that starts once back is left alone')
  stop()
})

test('starting again, as a hot update does, stops the watcher before it and leaves nothing held', () => {
  const fake = fakePage()
  const spinner = fake.start(loop())
  startAway(fake.page)
  startAway(fake.page)
  fake.blur()
  mock.timers.tick(60_000)
  fake.focus()
  fake.blur()
  mock.timers.tick(60_000)
  assert.equal(fake.writes, 2, 'one watcher marks the page each time it goes away')
  assert.equal(moving(spinner), false)

  startAway(fake.page)
  assert.equal(moving(spinner), true, 'the copy a hot update replaces plays what it held')
  fake.focus()
})

test('a loop held by both the away page and the covered chat plays again only when both let go', () => {
  const spinner = loop()
  const scope = new EventTarget()
  const releaseAway = holdLoops(scope, () => [spinner])
  const releaseCovered = holdLoops(scope, () => [spinner])
  assert.equal(moving(spinner), false)

  releaseAway()
  assert.equal(moving(spinner), false, 'the chat is still covered')
  releaseCovered()
  assert.equal(moving(spinner), true)
  assert.equal(spinner.playbackRate, 1, 'at the speed it had')
})
