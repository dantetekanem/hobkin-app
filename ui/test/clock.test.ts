import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import { mountCounting } from './render-count.ts'

// The page's visibility, which the clocks follow.
let visibility: 'visible' | 'hidden' = 'visible'
const changed: (() => void)[] = []
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  get visibilityState() { return visibility },
  addEventListener: (type: string, listener: () => void) => type === 'visibilitychange' && changed.push(listener),
} })
const show = (now: 'visible' | 'hidden') => {
  visibility = now
  for (const listener of changed) listener()
}
mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 })
const { readClock, subscribeClock } = await import('../src/lib/clock.ts')
const { useNow, useToday } = await import('../src/features/chat/use-now.ts')
after(() => {
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'document')
})

test('everything shown at one pace reads one time and moves on one tick', () => {
  const heard: number[] = []
  const stops = [subscribeClock(1000, () => heard.push(readClock(1000))), subscribeClock(1000, () => heard.push(readClock(1000)))]
  mock.timers.tick(1000)
  assert.deepEqual(heard, [Date.now(), Date.now()])
  mock.timers.tick(1000)
  assert.equal(heard.length, 4)
  stops.forEach((stop) => stop())
  mock.timers.tick(5000)
  assert.equal(heard.length, 4, 'a pace nobody shows does not tick')
})

test('nothing ticks while the window is hidden, and the time is read again as it comes back', () => {
  const heard: number[] = []
  const stop = subscribeClock(30_000, () => heard.push(readClock(30_000)))
  show('hidden')
  mock.timers.tick(90_000)
  assert.deepEqual(heard, [])
  show('visible')
  assert.deepEqual(heard, [Date.now()], 'back in sight, it reads the time at once')
  mock.timers.tick(30_000)
  assert.equal(heard.length, 2)
  stop()
})

test('a screen whose clock is in the leaf that shows the time does not draw for its ticks', async () => {
  const draws = { screen: 0, time: 0, resting: 0 }
  const Time = () => {
    draws.time += 1
    useNow(true, 1000)
    return null
  }
  const Resting = () => {
    draws.resting += 1
    useNow(false, 1000)
    return null
  }
  const Screen = () => {
    draws.screen += 1
    return [createElement(Time, { key: 'time' }), createElement(Resting, { key: 'resting' })]
  }
  const mounted = await mountCounting(() => createElement(Screen))
  for (let second = 0; second < 3; second++) await mounted.change(() => mock.timers.tick(1000))
  assert.deepEqual(draws, { screen: 1, time: 4, resting: 1 })
  await mounted.unmount()
})

test('day labels draw again when the day turns, not each minute', async () => {
  mock.timers.setTime(new Date(2026, 10, 21, 23, 57, 30).getTime())
  let draws = 0
  let today = 0
  const Column = () => {
    draws += 1
    today = useToday()
    return null
  }
  const mounted = await mountCounting(() => createElement(Column))
  assert.equal(today, new Date(2026, 10, 21).getTime())
  for (let minute = 0; minute < 2; minute++) await mounted.change(() => mock.timers.tick(60_000))
  assert.equal(draws, 1, 'the minutes before midnight draw nothing')
  await mounted.change(() => mock.timers.tick(60_000))
  assert.equal(draws, 2)
  assert.equal(today, new Date(2026, 10, 22).getTime())
  await mounted.unmount()
})
