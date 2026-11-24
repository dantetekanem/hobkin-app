import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { reviewIdOf } from '#shared/review/ids.ts'
import { Reviews, type Watched } from '../src/review/reviews.ts'
import { reviewHandlers } from '../src/review/seat.ts'
import { capOf, pullsOf, triesOf } from '../src/review/rules.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

// Local times, so the day turns at the same moment in any time zone: 23 November 2026, 15:00.
const TODAY = new Date(2026, 10, 23, 15).getTime()
const TOMORROW = new Date(2026, 10, 24, 0, 5).getTime()
const sha = (index: number) => index.toString(16).padStart(40, '0')
const changes = (count: number): Watched[] => Array.from({ length: count }, (_, index) => ({ id: `change:shop:c${index + 1}`, head: sha(index + 1), project: 'Shop', at: new Date(TODAY).toISOString() }))

/** A host that builds by itself at most `perDay` reviews a day, with its day's count kept in `ledger`, which outlives it. */
function background(t: TestContext, { perDay, ledger, clock }: { perDay: number; ledger: { kept: { day: string; built: number } | null }; clock: { now: number } }) {
  const started: string[] = []
  const heads = new Map<string, string>()
  const reviews = new Reviews({
    store: reviewStore(temporaryDirectory(t)),
    sources: {
      change: {
        head: async (target) => heads.get(reviewIdOf(target)) ?? null,
        read: async (target) => {
          started.push(reviewIdOf(target))
          throw new Error('not read here')
        },
      },
      pull: { head: async () => null, read: async () => Promise.reject(new Error('no')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    keepCurrent: () => 5,
    reviewsADay: () => perDay,
    dayLedger: { read: () => ledger.kept, write: (kept) => void (ledger.kept = kept) },
    now: () => clock.now,
  })
  t.after(() => reviews.close())
  const watch = (wanted: Watched[]) => {
    for (const entry of wanted) heads.set(entry.id, entry.head!)
    reviews.watch(wanted)
  }
  return { reviews, watch, started }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

test("at the day's number of background reviews the rest wait for midnight and say so, and the user's own ask still runs", async (t) => {
  const clock = { now: TODAY }
  const ledger = { kept: null as { day: string; built: number } | null }
  const { reviews, watch, started } = background(t, { perDay: 2, ledger, clock })

  watch(changes(5))
  await settle()

  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c2'])
  assert.deepEqual(reviews.status('change:shop:c3').turn, { ahead: 0, why: "Today's 2 background reviews are spent, so the next is built after midnight. Not reviewed yet, so nothing checks it by itself." })
  reviews.prepare('change:shop:c4', { asked: true })
  await settle()
  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c2', 'change:shop:c4'], 'what the user asks for is still built')

  // A host started again the same day keeps the day's count.
  const again = background(t, { perDay: 2, ledger, clock })
  again.watch(changes(5))
  await settle()
  assert.deepEqual(again.started, [])

  // After midnight the next ones are built, in their order. c4's own ask failed at 15:00, so it is tried again only a day
  // after that, and c5 takes its turn.
  clock.now = TOMORROW
  watch(changes(5))
  await settle()
  assert.deepEqual(started.slice(3), ['change:shop:c3', 'change:shop:c5'])
})

test('the number of background reviews a day is twenty unless the workload says another whole number', async (t) => {
  const clock = { now: TODAY }
  const { watch, started } = background(t, { perDay: Number.NaN, ledger: { kept: { day: new Date(TODAY).toLocaleDateString('en-CA'), built: 19 } }, clock })

  watch(changes(3))
  await settle()

  assert.deepEqual(started, ['change:shop:c1'], 'the twentieth of the day, and no more')
})

test("an ask from hobkin's agent takes a place in the line and counts toward the day's number, and one from the window goes outside both", async (t) => {
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
    reviewsADay: () => 2,
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
  // In no line, it takes the day's last place; past it, it hears when.
  await agent({ id: 'pr:acme/api/1' })
  await settle()
  const spent = await agent({ id: 'pr:acme/api/2' })
  assert.match(spent.turn?.why ?? '', /^Today's 2 background reviews are spent, so the next is built after midnight\./)
  await settle()
  assert.deepEqual(started, ['change:shop:c1', 'pr:acme/api/1'])

  // The window's ask is the user's: it is built whatever the line and the day.
  await window({ id: 'change:shop:c3' })
  await settle()
  assert.deepEqual(started, ['change:shop:c1', 'pr:acme/api/1', 'change:shop:c3'])
})

test('none lifts the two caps: every change is current and the day never runs out', async (t) => {
  const clock = { now: TODAY }
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
    reviewsADay: () => null,
    dayLedger: { read: () => ({ day: new Date(TODAY).toLocaleDateString('en-CA'), built: 5000 }), write: () => {} },
    now: () => clock.now,
  })
  t.after(() => none.close())
  const wanted = changes(9)
  for (const entry of wanted) heads.set(entry.id, entry.head!)
  // The host looks again each time it publishes, three at a time at most, so the rest come as those finish.
  for (let look = 0; look < 4; look += 1) {
    none.watch(wanted)
    await settle()
  }
  assert.equal(started.length, 9, 'all nine are built, though three are current by default and the day is at 5000')
})

test("the caps, the tries and the pull requests rated by themselves are read from the YOLO rules, and a runtime with none leaves the defaults", () => {
  // A whole number holds, null lifts it, and anything else is no setting.
  assert.equal(capOf({ keptCurrent: 4 }, 'keptCurrent'), 4)
  assert.equal(capOf({ keptCurrent: null }, 'keptCurrent'), null)
  for (const odd of [0, 2.5, 'three', true, [3]]) assert.equal(capOf({ keptCurrent: odd as never }, 'keptCurrent'), undefined, JSON.stringify(odd))
  assert.equal(capOf(undefined, 'backgroundADay'), undefined)
  assert.equal(capOf({}, 'backgroundADay'), undefined)

  assert.equal(triesOf({ tries: 5 }), 5)
  for (const odd of [0, null, 11, 'x', undefined]) assert.equal(triesOf({ tries: odd as never }), undefined, String(odd))
  assert.equal(triesOf(undefined), undefined)

  for (const which of ['none', 'mine', 'waiting', 'both'] as const) assert.equal(pullsOf({ reviewPulls: which }, 'none'), which)
  assert.equal(pullsOf({ reviewPulls: 'sometimes' as never }, 'mine'), 'mine', 'a word the page does not know leaves the workload as it was')
  assert.equal(pullsOf(undefined, 'waiting'), 'waiting')
  assert.equal(pullsOf(undefined, undefined), 'none')
})
