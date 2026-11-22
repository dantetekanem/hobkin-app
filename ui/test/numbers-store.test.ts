import assert from 'node:assert/strict'
import { test } from 'node:test'
import { METRICS_OLDER_RUNTIME, type WorkMetrics } from '#shared/protocol/metrics.ts'
import { createMetricsStore, METRICS_EVERY_MS, type MetricsSource } from '../src/features/numbers/metrics-store.ts'
import { sampleMetrics } from '../src/features/numbers/sample-metrics.ts'

const MINUTE = 60_000
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

/** A host and a clock the test moves by hand. Each read answers with `answer`, or waits while `hold` is set. */
function fakeHost() {
  let now = 0
  const timers = new Set<{ at: number; run: () => void }>()
  const reads: number[] = []
  const held: (() => void)[] = []
  const host = {
    answer: (days: number): Promise<WorkMetrics> => Promise.resolve({ ...sampleMetrics(days, new Date(2026, 10, 21)), at: new Date(now).toISOString() }),
    hold: false,
  }
  const source: MetricsSource = {
    read: (days) => {
      reads.push(now)
      if (!host.hold) return host.answer(days)
      return new Promise((resolve) => held.push(() => resolve(host.answer(days))))
    },
    now: () => now,
    after: (ms, run) => {
      const timer = { at: now + ms, run }
      timers.add(timer)
      return () => timers.delete(timer)
    },
  }
  async function advance(ms: number) {
    const end = now + ms
    for (;;) {
      const next = [...timers].filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!next) break
      timers.delete(next)
      now = next.at
      next.run()
      await settle()
    }
    now = end
    await settle()
  }
  const answerHeld = async () => {
    for (const answer of held.splice(0)) answer()
    await settle()
  }
  return { host, source, reads, advance, answerHeld }
}

test('the numbers are read once when first used, and everyone who uses them shares that read', async () => {
  const { source, reads } = fakeHost()
  const store = createMetricsStore(source)
  assert.equal(store.get(30).state, 'loading')
  let heard = 0
  const stopOne = store.subscribe(30, () => (heard += 1))
  const stopTwo = store.subscribe(30, () => (heard += 1))
  await settle()
  assert.equal(reads.length, 1)
  assert.equal(store.get(30).state, 'ready')
  assert.equal(store.get(30).metrics?.all.days.length, 30)
  assert.ok(heard >= 2)
  stopOne()
  stopTwo()
})

test('they are read again once a minute while something uses them, never sooner', async () => {
  const { source, reads, advance } = fakeHost()
  const store = createMetricsStore(source)
  const stop = store.subscribe(30, () => {})
  await settle()
  await advance(METRICS_EVERY_MS - 1)
  assert.equal(reads.length, 1)
  await advance(1)
  assert.equal(reads.length, 2)
  await advance(2 * MINUTE)
  assert.deepEqual(reads, [0, MINUTE, 2 * MINUTE, 3 * MINUTE])
  stop()
})

test('nothing is read while the window is hidden, and on its return only once a minute has passed', async () => {
  const { source, reads, advance } = fakeHost()
  const store = createMetricsStore(source)
  const stop = store.subscribe(30, () => {})
  await settle()
  store.setReady(false)
  await advance(5 * MINUTE)
  assert.equal(reads.length, 1)
  store.setReady(true)
  await settle()
  assert.deepEqual(reads, [0, 5 * MINUTE])
  store.setReady(false)
  await advance(10_000)
  store.setReady(true)
  await settle()
  assert.equal(reads.length, 2, 'back after ten seconds, the read of five minutes is still fresh')
  await advance(MINUTE - 10_000)
  assert.deepEqual(reads, [0, 5 * MINUTE, 6 * MINUTE])
  stop()
})

test('nothing is read once nothing uses the numbers, and a return within the minute keeps the last read', async () => {
  const { source, reads, advance } = fakeHost()
  const store = createMetricsStore(source)
  const stop = store.subscribe(30, () => {})
  await settle()
  stop()
  await advance(30_000)
  const again = store.subscribe(30, () => {})
  await settle()
  assert.equal(reads.length, 1)
  assert.equal(store.get(30).state, 'ready')
  again()
  await advance(10 * MINUTE)
  assert.equal(reads.length, 1)
})

test('a read the host has not answered is not asked again until it answers', async () => {
  const { host, source, reads, advance, answerHeld } = fakeHost()
  host.hold = true
  const store = createMetricsStore(source)
  const stop = store.subscribe(30, () => {})
  await advance(3 * MINUTE)
  assert.equal(reads.length, 1)
  assert.equal(store.get(30).state, 'loading')
  await answerHeld()
  assert.equal(store.get(30).state, 'ready')
  assert.equal(reads.length, 2, 'answered after its minute, the next read goes at once')
  stop()
})

test('a host whose hobkin is older than work numbers reads as sending no numbers yet, as a host that does not know the command does', async () => {
  const { host, source } = fakeHost()
  host.answer = () => Promise.reject(Object.assign(new Error(METRICS_OLDER_RUNTIME), { code: 'unavailable' }))
  const store = createMetricsStore(source)
  const stop = store.subscribe(30, () => {})
  await settle()
  assert.deepEqual(store.get(30), { metrics: null, state: 'older-host' })
  stop()
})

test('a host that does not know the command says it sends no numbers yet, not an error and not the sample', async () => {
  const { host, source } = fakeHost()
  host.answer = () => Promise.reject(Object.assign(new Error('This needs hobkin to restart once: the running host is older than this window.'), { code: 'unknown-command' }))
  const store = createMetricsStore(source)
  const stop = store.subscribe(30, () => {})
  await settle()
  assert.deepEqual(store.get(30), { metrics: null, state: 'older-host' })
  stop()
})

test('a read that fails keeps the numbers read before', async () => {
  const { host, source, advance } = fakeHost()
  const store = createMetricsStore(source)
  const stop = store.subscribe(30, () => {})
  await settle()
  const before = store.get(30).metrics
  host.answer = () => Promise.reject(Object.assign(new Error('hobkin could not read its records.'), { code: 'failed' }))
  await advance(MINUTE)
  assert.equal(store.get(30).state, 'failed')
  assert.equal(store.get(30).metrics, before)
  stop()
})

test('a read that says the same as the last keeps the same numbers, so nothing is drawn again', async () => {
  const { source, advance } = fakeHost()
  const store = createMetricsStore(source)
  let heard = 0
  const stop = store.subscribe(30, () => (heard += 1))
  await settle()
  const first = store.get(30)
  heard = 0
  await advance(MINUTE)
  assert.equal(store.get(30), first, 'only `at` moved')
  assert.equal(heard, 0)
  stop()
})

test('each period is its own read', async () => {
  const { source, reads } = fakeHost()
  const store = createMetricsStore(source)
  const stops = [store.subscribe(30, () => {}), store.subscribe(90, () => {}), store.subscribe(30, () => {})]
  await settle()
  assert.equal(reads.length, 2)
  assert.equal(store.get(90).metrics?.all.days.length, 90)
  for (const stop of stops) stop()
})
