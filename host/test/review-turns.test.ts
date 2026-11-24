import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { reviewIdOf } from '#shared/review/ids.ts'
import type { Review } from '#shared/review/types.ts'
import { Reviews, type Watched } from '../src/review/reviews.ts'
import { reviewStore } from '../src/review/store.ts'
import { lineOf, type LineChange } from '../src/review/turns.ts'
import { temporaryDirectory } from './support.ts'

const NOW = Date.parse('2026-11-23T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const finished = (count: number, more: (index: number) => Partial<LineChange> = () => ({})): LineChange[] =>
  Array.from({ length: count }, (_, index) => ({ id: `change:shop:c${index + 1}`, repo: 'shop', name: 'Shop', at: new Date(NOW - HOUR).toISOString(), ...more(index) }))

test("of twenty finished changes of one project only the first three in Work's order are built; the rest wait, each with how many are ahead", () => {
  const line = lineOf(finished(20), { now: NOW })

  assert.deepEqual([...line.current], ['change:shop:c1', 'change:shop:c2', 'change:shop:c3'])
  assert.deepEqual(line.waits.get('change:shop:c4'), { ahead: 3, why: 'Waits its turn: 3 ahead in Shop.' })
  assert.deepEqual(line.waits.get('change:shop:c20'), { ahead: 19, why: 'Waits its turn: 19 ahead in Shop.' })
  assert.equal(line.waits.size, 17)
})

test('P0 work is always taken, and each repository has its own line', () => {
  const changes = [...finished(5, (index) => (index === 4 ? { grade: 'P0' } : {})), { id: 'change:blog:b1', repo: 'blog', name: 'Blog' }]

  const line = lineOf(changes, { now: NOW, keep: 2 })

  assert.deepEqual([...line.current].sort(), ['change:blog:b1', 'change:shop:c1', 'change:shop:c5'])
  assert.equal(line.waits.get('change:shop:c2')?.ahead, 2)
})

test('a change that conflicts, is being brought up to date or is back at work is not built, and says why', () => {
  const line = lineOf(finished(5, (index) => [{ conflict: true }, { refreshing: true }, { atWork: true }][index] ?? {}), { now: NOW })

  assert.deepEqual([...line.current], ['change:shop:c4', 'change:shop:c5'])
  assert.deepEqual(line.waits.get('change:shop:c1'), { ahead: 0, why: 'It conflicts with its base, so its review waits for the rebase.' })
  assert.deepEqual(line.waits.get('change:shop:c2'), { ahead: 0, why: 'It is being brought up to date to merge, so it is not reviewed again now.' })
  assert.deepEqual(line.waits.get('change:shop:c3'), { ahead: 0, why: 'An agent is working on it again, so its review waits until it finishes.' })
})

test('a change that waited two days is taken next', () => {
  const changes = finished(6, (index) => (index === 5 ? { at: new Date(NOW - 49 * HOUR).toISOString() } : {}))

  const line = lineOf(changes, { now: NOW })

  assert.deepEqual([...line.current], ['change:shop:c6', 'change:shop:c1', 'change:shop:c2'])
  assert.equal(line.waits.get('change:shop:c3')?.ahead, 3)
})

test("on a first look at twenty old changes three are built: the one that waited longest and the first two in Work's order", () => {
  // Every change finished days ago; c10 longest ago.
  const changes = finished(20, (index) => ({ at: new Date(NOW - (index === 9 ? 200 : 60 + index) * HOUR).toISOString() }))

  const line = lineOf(changes, { now: NOW })

  assert.deepEqual([...line.current], ['change:shop:c10', 'change:shop:c1', 'change:shop:c2'])
  assert.deepEqual(line.waits.get('change:shop:c3'), { ahead: 3, why: 'Waits its turn: 3 ahead in Shop.' })
})

test('four P0 changes: three are built and the fourth waits its turn first in line', () => {
  const changes = finished(6, (index) => (index < 4 ? { grade: 'P0' } : {}))

  const line = lineOf(changes, { now: NOW })

  assert.deepEqual([...line.current], ['change:shop:c1', 'change:shop:c2', 'change:shop:c3'])
  assert.deepEqual(line.waits.get('change:shop:c4'), { ahead: 3, why: 'Waits its turn: 3 ahead in Shop.' })
  assert.equal(line.waits.get('change:shop:c5')?.ahead, 4)
})

test('the number kept current is the workload’s when it is a whole number, else three', () => {
  assert.equal(lineOf(finished(6), { now: NOW, keep: 5 }).current.size, 5)
  for (const keep of [0, -1, 2.5, Number.NaN]) assert.equal(lineOf(finished(6), { now: NOW, keep }).current.size, 3, String(keep))
})

// ── The line in the host's background (spec 058, A1 to A4) ──

const sha = (index: number, round = 0) => `${String(round)}${index.toString(16).padStart(39, '0')}`
const watchedChanges = (count: number, round = 0): Watched[] => Array.from({ length: count }, (_, index) => ({ id: `change:shop:c${index + 1}`, head: sha(index + 1, round), project: 'Shop', grade: null, conflict: false, at: new Date().toISOString() }))

/** A host whose change source records each change whose review starts, and holds each start until it is let go. */
function background(t: TestContext, { held = false, backAtWork = () => false }: { held?: boolean; backAtWork?: (id: string) => boolean } = {}) {
  const root = temporaryDirectory(t)
  const started: string[] = []
  const waiting: (() => void)[] = []
  const heads = new Map<string, string>()
  const reviews = new Reviews({
    store: reviewStore(root),
    sources: {
      change: {
        // Where each branch is: the commit its card names, as the test hands them.
        head: async (target) => heads.get(reviewIdOf(target)) ?? null,
        // A review starts by reading its change: that is what is counted.
        read: async (target) => {
          started.push(reviewIdOf(target))
          if (held) await new Promise<void>((resolve) => waiting.push(resolve))
          throw new Error('not read here')
        },
      },
      pull: { head: async () => null, read: async () => Promise.reject(new Error('no pull requests here')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    // As the Work screen names them.
    describe: (target) => (target.kind === 'change' ? { title: target.item, project: 'Shop' } : null),
    backAtWork: (target) => backAtWork(reviewIdOf(target)),
  })
  t.after(() => reviews.close())
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  /** The background is handed the finished changes, each at its commit. */
  const watch = (wanted: Watched[]) => {
    for (const entry of wanted) heads.set(entry.id, entry.head!)
    reviews.watch(wanted)
  }
  return { reviews, watch, started, root, settle, release: () => waiting.splice(0).forEach((go) => go()) }
}

test("of twenty finished changes of one project the background builds only the first three in Work's order, and every other row says how many are ahead", async (t) => {
  const { reviews, watch, started, settle } = background(t)

  watch(watchedChanges(20))
  await settle()

  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c2', 'change:shop:c3'])
  const rows = new Map(reviews.list().reviews.map((row) => [row.id, row]))
  assert.deepEqual(rows.get('change:shop:c4')?.turn, { ahead: 3, why: 'Waits its turn: 3 ahead in Shop.' })
  assert.equal(rows.get('change:shop:c4')?.waiting, true)
  assert.equal(reviews.status('change:shop:c20').turn?.ahead, 19)
})

test('Review now builds one outside the line and stops none of those current', async (t) => {
  const { reviews, watch, started, settle } = background(t)
  watch(watchedChanges(5))
  await settle()

  reviews.prepare('change:shop:c5', { asked: true })
  await settle()

  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c2', 'change:shop:c3', 'change:shop:c5'])
})

test('after a merge only the next change in line is built', async (t) => {
  const { watch, started, settle } = background(t)
  watch(watchedChanges(5))
  await settle()

  // c1 merged: hobkin no longer lists it, and the rest move up.
  watch(watchedChanges(5).slice(1))
  await settle()

  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c2', 'change:shop:c3', 'change:shop:c4'])
})

test('a queued review of a change sent back to work is dropped, and its row says why', async (t) => {
  const atWork = new Set<string>()
  const { reviews, watch, started, settle, release } = background(t, { held: true, backAtWork: (id) => atWork.has(id) })
  watch(watchedChanges(3))
  await settle()
  assert.deepEqual(started, ['change:shop:c1'], 'c2 and c3 wait in the queue while c1 starts')

  // An agent takes c3 back: hobkin no longer lists it as finished.
  atWork.add('change:shop:c3')
  watch(watchedChanges(3).filter((entry) => entry.id !== 'change:shop:c3'))
  release()
  await settle()
  release()
  await settle()

  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c2'])
  assert.equal(reviews.status('change:shop:c3').phase, null)
})

test('a review whose change moved is built again by itself only in the line; out of it, its row is outdated, with the commit it was built for', async (t) => {
  const { reviews, watch, started, root, settle } = background(t)
  const store = reviewStore(root)
  const built = (index: number) => ({ change: { title: `c${index}`, project: 'Shop', head: sha(index) } }) as unknown as Review
  store.write({ kind: 'change', slug: 'shop', item: 'c1' }, built(1), [])
  store.write({ kind: 'change', slug: 'shop', item: 'c5' }, built(5), [])

  // Every change moved on since its review.
  watch(watchedChanges(5, 1))
  await settle()

  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c2', 'change:shop:c3'], 'c1 is in the line, so it is built again')
  const c5 = reviews.list().reviews.find((row) => row.id === 'change:shop:c5')
  assert.deepEqual([c5?.outdated, c5?.turn?.ahead], [{ builtFor: sha(5) }, 4])
})

test("the list has a line for each repository: its reviews current, waiting and outdated", async (t) => {
  const { reviews, watch, root, settle } = background(t)
  reviewStore(root).write({ kind: 'change', slug: 'shop', item: 'c5' }, ({ change: { title: 'c5', project: 'Shop', head: sha(5) } }) as unknown as Review, [])

  watch(watchedChanges(6, 1))
  await settle()

  assert.deepEqual(reviews.list().repos, [{ project: 'Shop', current: 3, waiting: 2, outdated: 1, builtThisWeek: 0 }])
})
