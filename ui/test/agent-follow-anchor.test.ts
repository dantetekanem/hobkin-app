import assert from 'node:assert/strict'
import { test } from 'node:test'
import { followEnd, UNFOLD, type FollowControl, type FollowStart } from '../src/features/agent-activity/follow.ts'
import { tellUnfold } from '../src/features/agent-activity/unfold.ts'

/** A ResizeObserver that calls back only for what it watches, when the test says a box changed size. */
class Sizes {
  static all: Sizes[] = []
  watched = new Set<object>()
  callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
    Sizes.all.push(this)
  }
  observe(target: object) {
    this.watched.add(target)
  }
  disconnect() {
    this.watched.clear()
  }
}
const resized = (target: object) => Sizes.all.forEach((sizes) => sizes.watched.has(target) && sizes.callback())

/** A transcript: the element that scrolls, the list of steps inside it, and how far down it is. Its scrolls are recorded with how they were asked for. */
function transcript(height: number, client: number, start?: FollowStart) {
  const asked: string[] = []
  const box = Object.assign(new EventTarget(), {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: height,
    clientHeight: client,
    scrollTo({ top = 0, behavior = 'auto' }: ScrollToOptions) {
      asked.push(behavior)
      box.scrollTop = Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight))
    },
    scrollBy({ top = 0 }: ScrollToOptions) {
      box.scrollTo({ top: box.scrollTop + top })
    },
    getBoundingClientRect: () => ({ top: 0 }),
    closest: () => null,
  })
  const list = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ top: 0 }) })
  const pins: boolean[] = []
  const follow: FollowControl = followEnd(box as unknown as HTMLElement, list as unknown as HTMLElement, {
    page: new EventTarget(),
    Observer: Sizes,
    onPinned: (pinned) => pins.push(pinned),
    ...(start ? { start } : {}),
  })
  const end = () => box.scrollHeight - box.clientHeight
  return { box, list, follow, pins, end, asked }
}

test('it opens at the newest step and follows the steps as they arrive', () => {
  const { box, list, follow, end } = transcript(2000, 600)
  assert.equal(box.scrollTop, end(), 'opened at the newest step')
  box.scrollHeight = 2300
  resized(list)
  assert.equal(box.scrollTop, end())
  assert.equal(follow.following, true)
  follow.dispose()
})

test('when the transcript itself gets shorter, as the input below it grows, the newest step stays at the bottom', () => {
  const { box, follow, end } = transcript(2000, 600)
  box.clientHeight = 480
  resized(box)
  assert.equal(box.scrollTop, end(), 'still anchored at the newest step')
  follow.dispose()
})

test('reading up holds the view as steps arrive, and scrolling back down to the end follows again', () => {
  const { box, list, follow, pins, end } = transcript(2000, 600)
  box.scrollTop = end() - 300
  box.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: -120 }))
  follow.onScroll()
  assert.equal(follow.following, false)
  assert.equal(pins.at(-1), false, 'the way back down is offered')
  const reading = box.scrollTop
  box.scrollHeight = 2400
  resized(list)
  assert.equal(box.scrollTop, reading, 'what the user reads does not move')
  box.scrollTop = end()
  follow.onScroll()
  assert.equal(follow.following, true)
  assert.equal(pins.at(-1), true)
  follow.dispose()
})

test('the newest button goes back to the end and follows from there', () => {
  const { box, list, follow, pins, end } = transcript(2000, 600)
  box.dispatchEvent(Object.assign(new Event('keydown'), { key: 'PageUp' }))
  box.scrollTop = 200
  follow.onScroll()
  assert.equal(follow.following, false)
  follow.jumpToLatest()
  assert.equal(box.scrollTop, end())
  assert.equal(pins.at(-1), true)
  box.scrollHeight = 2600
  resized(list)
  assert.equal(box.scrollTop, end())
  follow.dispose()
})

test('a box the user opens holds the view, which follows again only if the end is still in view', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { box, list, follow, end } = transcript(2000, 600)
  list.dispatchEvent(new CustomEvent(UNFOLD, { detail: { closing: false } }))
  box.scrollHeight = 2400
  resized(list)
  assert.notEqual(box.scrollTop, end(), 'the box opens where it is read')
  t.mock.timers.tick(400)
  assert.equal(follow.following, false, 'the end went out of view')
  follow.jumpToLatest()
  list.dispatchEvent(new CustomEvent(UNFOLD, { detail: { closing: false } }))
  t.mock.timers.tick(400)
  assert.equal(follow.following, true, 'a box that did not push the end away leaves the view following')
  follow.dispose()
})

test('the newest button lands on the end at once, and holds it there while what it lands on takes its size', () => {
  const { box, list, follow, asked, end } = transcript(9000, 600)
  box.dispatchEvent(Object.assign(new Event('keydown'), { key: 'PageUp' }))
  box.scrollTop = 300
  follow.onScroll()
  asked.length = 0

  follow.jumpToLatest()
  assert.equal(box.scrollTop, end(), 'it is at the end when the click returns, not somewhere on the way')
  // The steps it lands on are drawn only now, and are taller than they were guessed to be.
  box.scrollHeight = 9800
  resized(list)
  assert.equal(box.scrollTop, end(), 'still at the end')
  assert.equal(follow.following, true)

  // A step that arrives after is followed the same way: at once.
  box.scrollHeight = 9900
  resized(list)
  assert.equal(box.scrollTop, end())
  assert.deepEqual(asked, ['auto', 'auto', 'auto'])
  follow.dispose()
})

test('a press that was never let go does not make the newest button give up following', () => {
  const { box, follow, end } = transcript(4000, 600)
  box.dispatchEvent(Object.assign(new Event('keydown'), { key: 'PageUp' }))
  box.scrollTop = 300
  follow.onScroll()
  // The press on the button is inside the transcript, and its release never reached the page.
  box.dispatchEvent(new Event('pointerdown'))
  follow.jumpToLatest()
  // The end comes up as a row below folds away: no hand moved it.
  box.scrollHeight = 3900
  box.scrollTop = end()
  follow.onScroll()
  assert.equal(follow.following, true)
  follow.dispose()
})

test('a row the user opens tells the transcript as a box does, so the view holds where the row is read', () => {
  const { box, list, follow, end } = transcript(2000, 600)
  tellUnfold(list as unknown as HTMLElement, false)
  box.scrollHeight = 2400
  resized(list)
  assert.notEqual(box.scrollTop, end(), 'the row opens below itself, and the view stays on it')
  assert.equal(follow.following, false)
  follow.dispose()
})

test('a transcript left read up opens where it was, not following, and what grows below it does not move it', () => {
  const { box, list, follow, pins, end } = transcript(3000, 600, { following: false, top: 700 })
  assert.equal(box.scrollTop, 700, 'it opens where it was read')
  assert.equal(follow.following, false)
  assert.deepEqual(pins, [false], 'the way back down is offered at once')
  box.scrollHeight = 3400
  resized(list)
  resized(box)
  assert.equal(box.scrollTop, 700, 'a step that arrives does not take it to the end')
  // Scrolling down to the end follows again, as from any place the user reads.
  box.scrollTop = end()
  follow.onScroll()
  assert.equal(follow.following, true)
  follow.dispose()
})

test('a start that follows opens at the newest step, as a transcript with no start does', () => {
  const { box, list, follow, end } = transcript(3000, 600, { following: true, top: 120 })
  assert.equal(box.scrollTop, end())
  assert.equal(follow.following, true)
  box.scrollHeight = 3200
  resized(list)
  assert.equal(box.scrollTop, end())
  follow.dispose()
})
