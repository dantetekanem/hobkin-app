import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reviewIdOf } from '#shared/review/ids.ts'
import { Reviews, type Watched } from '../src/review/reviews.ts'
import { reviewHandlers } from '../src/review/seat.ts'
import { capOf, pullsOf, triesOf } from '../src/review/rules.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

// 23 November 2026, 15:00, local time.
const TODAY = new Date(2026, 10, 23, 15).getTime()
const sha = (index: number) => index.toString(16).padStart(40, '0')
const changes = (count: number): Watched[] => Array.from({ length: count }, (_, index) => ({ id: `change:shop:c${index + 1}`, head: sha(index + 1), project: 'Shop', at: new Date(TODAY).toISOString() }))
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

test("an ask from hobkin's agent waits its turn in the line, one in no line is built, and one from the window goes outside the line", async (t) => {
  const started: string[] = []
  const heads = new Map<string, string>()
  const reviews = new Reviews({
    store: reviewStore(temporaryDirectory(t)),
    sources: {
      change: { head: async (target) => heads.get(reviewIdOf(target)) ?? null, read: async (target) => (started.push(reviewIdOf(target)), Promise.reject(new Error('not read here'))) },
      pull: { head: async () => sha(99), read: async (target) => (started.push(reviewIdOf(target)), Promise.reject(new Error('not read here'))) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    keepCurrent: () => 1,
    now: () => TODAY,
  })
  t.after(() => reviews.close())
  const agent = reviewHandlers(reviews, 'hobkin')['review.prepare']!
  const window = reviewHandlers(reviews)['review.prepare']!
  const wanted = changes(3)
  for (const entry of wanted) heads.set(entry.id, entry.head!)
  reviews.watch(wanted)
  await settle()
  assert.deepEqual(started, ['change:shop:c1'])

  // Out of the line: the agent hears why, and nothing is built.
  const waiting = await agent({ id: 'change:shop:c3' })
  assert.match(waiting.turn?.why ?? '', /^Waits its turn: 2 ahead in Shop\./)
  // In no line, it is built, however many were built today.
  for (const id of ['pr:acme/api/1', 'pr:acme/api/2', 'pr:acme/api/3']) {
    const built = await agent({ id })
    assert.equal(built.turn, undefined, id)
  }
  await settle()
  assert.deepEqual(started, ['change:shop:c1', 'pr:acme/api/1', 'pr:acme/api/2', 'pr:acme/api/3'])

  // The window's ask is the user's: it is built whatever the line.
  await window({ id: 'change:shop:c3' })
  await settle()
  assert.deepEqual(started, ['change:shop:c1', 'pr:acme/api/1', 'pr:acme/api/2', 'pr:acme/api/3', 'change:shop:c3'])
})

test('none lifts the cap on reviews kept current: every change is current', async (t) => {
  const started: string[] = []
  const heads = new Map<string, string>()
  const none = new Reviews({
    store: reviewStore(temporaryDirectory(t)),
    sources: {
      change: { head: async (target) => heads.get(reviewIdOf(target)) ?? null, read: async (target) => (started.push(reviewIdOf(target)), Promise.reject(new Error('not read here'))) },
      pull: { head: async () => null, read: async () => Promise.reject(new Error('no')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    keepCurrent: () => null,
    now: () => TODAY,
  })
  t.after(() => none.close())
  const wanted = changes(9)
  for (const entry of wanted) heads.set(entry.id, entry.head!)
  // The host looks again each time it publishes, three at a time at most, so the rest come as those finish.
  for (let look = 0; look < 4; look += 1) {
    none.watch(wanted)
    await settle()
  }
  assert.equal(started.length, 9, 'all nine are built, though three are current by default')
})

test("the caps, the tries and the pull requests rated by themselves are read from the YOLO rules, and a runtime with none leaves the defaults", () => {
  // A whole number holds, null lifts it, and anything else is no setting.
  assert.equal(capOf({ keptCurrent: 4 }, 'keptCurrent'), 4)
  assert.equal(capOf({ keptCurrent: null }, 'keptCurrent'), null)
  for (const odd of [0, 2.5, 'three', true, [3]]) assert.equal(capOf({ keptCurrent: odd as never }, 'keptCurrent'), undefined, JSON.stringify(odd))
  assert.equal(capOf(undefined, 'keptCurrent'), undefined)
  assert.equal(capOf({}, 'keptCurrent'), undefined)

  assert.equal(triesOf({ tries: 5 }), 5)
  for (const odd of [0, null, 11, 'x', undefined]) assert.equal(triesOf({ tries: odd as never }), undefined, String(odd))
  assert.equal(triesOf(undefined), undefined)

  for (const which of ['none', 'mine', 'waiting', 'both'] as const) assert.equal(pullsOf({ reviewPulls: which }, 'none'), which)
  assert.equal(pullsOf({ reviewPulls: 'sometimes' as never }, 'mine'), 'mine', 'a word the page does not know leaves the workload as it was')
  assert.equal(pullsOf(undefined, 'waiting'), 'waiting')
  assert.equal(pullsOf(undefined, undefined), 'none')
})
