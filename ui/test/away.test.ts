import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
const { AWAY_AFTER_MS, startAway, watchAway } = await import('../src/app/away.ts')
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

/** A page with a window that can go to the background and come back, and the root `data-away` is set on. */
function fakePage({ focused = true } = {}) {
  const window = new EventTarget()
  let hasFocus = focused
  const root = new Set<string>()
  let writes = 0
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
    hasFocus: () => hasFocus,
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

  stop()
  fake.focus()
  assert.equal(fake.away, true, 'a stopped watcher leaves the page alone')
})

test('a page that starts in the background is away a minute later', () => {
  const fake = fakePage({ focused: false })
  const stop = watchAway(fake.page)
  mock.timers.tick(59_999)
  assert.equal(fake.away, false)
  mock.timers.tick(1)
  assert.equal(fake.away, true)
  stop()
})

test('starting again, as a hot update does, stops the watcher before it', () => {
  const fake = fakePage()
  startAway(fake.page)
  startAway(fake.page)
  fake.blur()
  mock.timers.tick(60_000)
  fake.focus()
  fake.blur()
  mock.timers.tick(60_000)
  assert.equal(fake.writes, 2, 'one watcher marks the page each time it goes away')
  fake.focus()
})
