import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FaceReactions, type AppReaction } from '../src/avatar/reactions.ts'

function clock(start = 1_000_000) {
  let at = start
  return { now: () => at, advance: (ms: number) => (at += ms) }
}

test('a click on a sleeping face wakes it through focused, happy and hello, and tells the app once', () => {
  const time = clock()
  const sleep: AppReaction = { mood: 'sleepy', lasting: true }
  let woke = 0
  const face = new FaceReactions({ now: time.now, reaction: () => sleep, onWake: () => woke++ })

  assert.equal(face.asleep(), true)
  face.click()

  assert.equal(woke, 1)
  assert.equal(face.asleep(), false, 'the sleep it woke from is over at once')
  assert.equal(face.shown()?.mood, 'focused')
  time.advance(1000)
  assert.equal(face.shown()?.mood, 'happy')
  time.advance(900)
  assert.equal(face.shown()?.mood, 'hello')
  time.advance(1100)
  assert.equal(face.shown(), null)
})

test('a click while waking does not poke', () => {
  const time = clock()
  const sleep: AppReaction = { mood: 'sleepy', lasting: true }
  const face = new FaceReactions({ now: time.now, reaction: () => sleep })

  face.click()
  time.advance(200)
  face.click()

  assert.equal(face.shown()?.mood, 'focused')
})

test('pokes escalate while each comes soon after the last, and start over after a pause', () => {
  const time = clock()
  const face = new FaceReactions({ now: time.now })

  const moods = []
  for (let poke = 0; poke < 5; poke += 1) {
    face.click()
    moods.push(face.shown()?.mood)
    time.advance(1500)
  }
  assert.deepEqual(moods, ['surprised', 'wink', 'happy', 'grumpy', 'grumpy'])

  time.advance(2500)
  face.click()
  assert.equal(face.shown()?.mood, 'surprised')
})

test('a poke ends by the clock', () => {
  const time = clock()
  const face = new FaceReactions({ now: time.now })

  face.click()
  assert.equal(face.shown()?.endsIn, 1400)
  time.advance(1400)
  assert.equal(face.shown(), null)
})

test('five passes of the pointer within four seconds make it dizzy, then it takes no notice for thirty seconds', () => {
  const time = clock()
  const face = new FaceReactions({ now: time.now })
  const pass = () => {
    const started = face.hover(true)
    face.hover(false)
    return started
  }

  for (let passes = 0; passes < 4; passes += 1) {
    assert.equal(pass(), false)
    time.advance(500)
  }
  assert.equal(pass(), true)
  assert.equal(face.shown()?.mood, 'dizzy')

  time.advance(2400)
  assert.equal(face.shown(), null)
  for (let passes = 0; passes < 6; passes += 1) {
    assert.equal(pass(), false, 'rubbed lately')
    time.advance(500)
  }

  time.advance(30000)
  for (let passes = 0; passes < 4; passes += 1) pass()
  assert.equal(pass(), true)
})

test('slow passes never add up', () => {
  const time = clock()
  const face = new FaceReactions({ now: time.now })

  for (let passes = 0; passes < 10; passes += 1) {
    assert.equal(face.hover(true), false)
    face.hover(false)
    time.advance(1100)
  }
})

test('a sleeping face ignores the pointer passing over it', () => {
  const time = clock()
  const sleep: AppReaction = { mood: 'sleepy', lasting: true }
  const face = new FaceReactions({ now: time.now, reaction: () => sleep })

  for (let passes = 0; passes < 6; passes += 1) {
    assert.equal(face.hover(true), false)
    face.hover(false)
  }
})
