import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { PullRequest } from '#shared/protocol/pulls.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { reviewIdOf } from '#shared/review/ids.ts'
import type { Review } from '#shared/review/types.ts'
import { Assessments } from '../src/review/assessment.ts'
import { Reviews, type Watched } from '../src/review/reviews.ts'
import { finishTimes, toPrepare } from '../src/review/seat.ts'
import { reviewStore } from '../src/review/store.ts'
import { clockOf, lineOf, type LineChange } from '../src/review/turns.ts'
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

test('every change past two days is reviewed once in time, one at a time: the place passes on once its review is built', () => {
  // Twenty changes that all finished days ago, c20 the longest ago.
  const changes = finished(20, (index) => ({ at: new Date(NOW - (60 + index) * HOUR).toISOString() }))
  const reviewed = new Set<string>()
  const taken: string[] = []
  for (let day = 0; day < 20; day += 1) {
    const line = lineOf(changes.map((change) => ({ ...change, reviewed: reviewed.has(change.id) })), { now: NOW })
    const longest = [...line.current].find((id) => !['change:shop:c1', 'change:shop:c2'].includes(id))
    if (longest) {
      taken.push(longest)
      reviewed.add(longest)
    }
  }

  assert.equal(new Set(taken).size, 18, 'each of the other eighteen in turn')
  assert.equal(taken[0], 'change:shop:c20')
  assert.equal(taken[1], 'change:shop:c19')
})

test('the longest-wait place goes to a change the line would not take anyway', () => {
  // c2 waited longest, but Work's first three take it anyway: the place goes to c6, the next longest waiting.
  const changes = finished(6, (index) => ({ at: new Date(NOW - (index === 1 ? 100 : index === 5 ? 60 : 1) * HOUR).toISOString() }))

  const line = lineOf(changes, { now: NOW })

  assert.deepEqual([...line.current], ['change:shop:c6', 'change:shop:c1', 'change:shop:c2'])
})

test('a change whose build failed gives its place up for a day and says when it is tried again; then it waits in its turn', () => {
  const failedAt = new Date(NOW - 2 * HOUR).toISOString()
  // c20 waited longest and its build failed: the place for the longest wait passes to c19.
  const changes = finished(20, (index) => ({ at: new Date(NOW - (60 + index) * HOUR).toISOString(), ...(index === 0 || index === 19 ? { failedAt } : {}) }))

  const line = lineOf(changes, { now: NOW })

  assert.deepEqual([...line.current], ['change:shop:c19', 'change:shop:c2', 'change:shop:c3'])
  const why = `Its last build failed at ${clockOf(NOW - 2 * HOUR)}; it is tried again in its turn after ${clockOf(NOW + 22 * HOUR)}.`
  assert.deepEqual([line.waits.get('change:shop:c1'), line.waits.get('change:shop:c20')], [{ ahead: 0, why }, { ahead: 0, why }])
  // A day after it failed it is back: first in Work's order, and the longest waiting.
  assert.deepEqual([...lineOf(changes, { now: NOW + 22 * HOUR }).current], ['change:shop:c20', 'change:shop:c1', 'change:shop:c2'])
})

test('the number kept current is the workload’s when it is a whole number, else three', () => {
  assert.equal(lineOf(finished(6), { now: NOW, keep: 5 }).current.size, 5)
  for (const keep of [0, -1, 2.5, Number.NaN]) assert.equal(lineOf(finished(6), { now: NOW, keep }).current.size, 3, String(keep))
})

// ── The line in the host's background (spec 058, A1 to A4) ──

const sha = (index: number, round = 0) => `${String(round)}${index.toString(16).padStart(39, '0')}`
const watchedChanges = (count: number, round = 0): Watched[] => Array.from({ length: count }, (_, index) => ({ id: `change:shop:c${index + 1}`, head: sha(index + 1, round), project: 'Shop', grade: null, conflict: false, at: new Date().toISOString() }))

/** A host whose change source records each change whose review starts, and holds each start until it is let go. */
function background(t: TestContext, { held = false, backAtWork = () => false, finishedAt }: { held?: boolean; backAtWork?: (id: string) => boolean; finishedAt?: (id: string) => string | null } = {}) {
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
    ...(finishedAt ? { finishedAt: (target: { kind: 'change'; slug: string; item: string }) => finishedAt(reviewIdOf(target)) } : {}),
  })
  t.after(() => reviews.close())
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  /** The background is handed the finished changes, each at its commit. */
  const watch = (wanted: Watched[], limit?: number) => {
    for (const entry of wanted) heads.set(entry.id, entry.head!)
    reviews.watch(wanted, limit)
  }
  return { reviews, watch, started, root, settle, release: () => waiting.splice(0).forEach((go) => go()) }
}

test("of twenty finished changes of one project the background builds only the first three in Work's order, and every other row says how many are ahead", async (t) => {
  const { reviews, watch, started, settle } = background(t)

  watch(watchedChanges(20))
  await settle()

  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c2', 'change:shop:c3'])
  const rows = new Map(reviews.list().reviews.map((row) => [row.id, row]))
  assert.deepEqual(rows.get('change:shop:c4')?.turn, { ahead: 3, why: 'Waits its turn: 3 ahead in Shop. Not reviewed yet, so nothing checks it by itself.' })
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
  // Each build is held while the line moves, as one that failed would give its place up.
  const { watch, started, settle, release } = background(t, { held: true })
  watch(watchedChanges(5), 10)
  await settle()

  // c1 merged: hobkin no longer lists it, and the rest move up.
  watch(watchedChanges(5).slice(1), 10)
  await settle()
  for (let round = 0; round < 5; round += 1) {
    release()
    await settle()
  }

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

test("a pull request the background does not review says so on its row: it is built when the user starts its AI review", (t) => {
  const root = temporaryDirectory(t)
  const pull = { kind: 'pull' as const, owner: 'acme', repo: 'api', number: 7 }
  reviewStore(root).write(pull, ({ change: { title: '#7', project: 'acme/api', head: sha(7) } }) as unknown as Review, [])
  const reviews = new Reviews({
    store: reviewStore(root),
    sources: { change: { head: async () => null, read: async () => Promise.reject(new Error('no')) }, pull: { head: async () => null, read: async () => Promise.reject(new Error('no')) } },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    // GitHub says it moved on since its review.
    head: (target) => (target.kind === 'pull' ? sha(7, 1) : null),
  })
  t.after(() => reviews.close())

  const row = reviews.list().reviews.find((entry) => entry.id === reviewIdOf(pull))

  assert.deepEqual([row?.outdated, row?.turn], [{ builtFor: sha(7) }, { ahead: 0, why: 'A pull request is reviewed again when you start its review.' }])
})

test("pull requests the workload names wait in their repository's line like changes, and say so; the rest wait for Start AI review", async (t) => {
  const built: string[] = []
  const reviews = new Reviews({
    store: reviewStore(temporaryDirectory(t)),
    sources: {
      change: { head: async () => null, read: async () => Promise.reject(new Error('no')) },
      pull: {
        head: async (target) => (target.kind === 'pull' ? sha(target.number) : null),
        read: async (target) => (built.push(reviewIdOf(target)), Promise.reject(new Error('not read here'))),
      },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
  })
  t.after(() => reviews.close())
  const pulls = Array.from({ length: 20 }, (_, index) => ({ id: reviewIdOf({ kind: 'pull', owner: 'acme', repo: 'shop', number: index + 1 }), updatedAt: new Date().toISOString() }))

  reviews.watch(pulls)
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(built, ['pr:acme/shop/1', 'pr:acme/shop/2', 'pr:acme/shop/3'])
  // An older list names no commit: the row says so.
  assert.equal(
    reviews.status('pr:acme/shop/5').turn?.why,
    "Waits its turn: 4 ahead in acme/shop. Not reviewed yet, so nothing checks it by itself. GitHub's list did not say its commit, and hobkin has read none of it yet. Nor did it say when it was opened or pushed, so its wait counts from its last update there.",
  )
})

test('a pull request on a code host other than GitHub names that host when it waits, and when its preparation asks where it is', async (t) => {
  const root = temporaryDirectory(t)
  const reviews = new Reviews({
    store: reviewStore(root),
    assessments: new Assessments({ root, run: async () => Promise.reject(new Error('not run here')), repoOf: () => null }),
    sources: {
      change: { head: async () => null, read: async () => Promise.reject(new Error('no')) },
      pull: { head: async () => null, read: async () => Promise.reject(new Error('not read here')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
  })
  t.after(() => reviews.close())
  // A list from the host that names no commit and no times, as the GitHub test above has.
  const pulls = Array.from({ length: 5 }, (_, index) => ({
    id: reviewIdOf({ kind: 'pull', host: 'corp', owner: 'acme', repo: 'shop', number: index + 1 }),
    updatedAt: new Date().toISOString(),
  }))
  const last = 'pr:corp:acme/shop/5'

  reviews.watch(pulls)
  await new Promise((resolve) => setTimeout(resolve, 30))

  const why = reviews.status(last).turn?.why ?? ''
  assert.match(why, /corp's list did not say its commit, and hobkin has read none of it yet\. Nor did it say when/)
  assert.doesNotMatch(why, /GitHub/)

  reviews.prepare(last, { asked: true })
  await reviews.settled(last)

  const log = reviews.status(last).assessment?.log?.map((line) => line.text) ?? []
  assert.ok(log.includes('Asking corp where #5 is.'), log.join('\n'))
})

test('the line\'s clock is when a change finished, not when hobkin last wrote it', async (t) => {
  const { reviews, watch, started, settle } = background(t, { finishedAt: (id) => (id === 'change:shop:c5' ? new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString() : null) })

  // hobkin wrote every item just now, which is no finish.
  watch(watchedChanges(5))
  await settle()

  assert.deepEqual(started.sort(), ['change:shop:c1', 'change:shop:c2', 'change:shop:c5'])
  assert.equal(reviews.status('change:shop:c3').turn?.ahead, 3)
})

test("a change's clock is when hobkin finished it, as its items say; else when its head was committed, never later than now", async (t) => {
  const repo = temporaryDirectory(t)
  const commit = (message: string, committed: string) => {
    const env = { ...process.env, GIT_AUTHOR_DATE: '2026-11-02T08:00:00Z', GIT_COMMITTER_DATE: committed }
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', message], { env })
    return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  }
  execFileSync('git', ['-C', repo, 'init', '--quiet', '--initial-branch=main'])
  // Written three weeks ago and amended this morning, and one dated next year.
  const amended = commit('Amended', '2026-11-23T08:00:00Z')
  const ahead = commit('From the future', '2027-01-01T00:00:00Z')
  // hobkin's log of the shop's items: filed, finished, sent back, finished again, then a note written to it.
  const data = temporaryDirectory(t)
  mkdirSync(join(data, 'work', 'shop'), { recursive: true })
  const lines = [
    { id: 'a1', key: 'k1', title: 'A' },
    { id: 'a1', state: 'doing', updatedAt: '2026-11-22T09:00:00Z' },
    { id: 'a1', state: 'pr', updatedAt: '2026-11-22T10:00:00Z' },
    { id: 'a1', state: 'doing', updatedAt: '2026-11-22T11:00:00Z' },
    { id: 'a1', state: 'pr', updatedAt: '2026-11-22T11:30:00Z' },
    { id: 'a1', note: 'Looked at it.', updatedAt: '2026-11-23T09:00:00Z' },
  ]
  writeFileSync(join(data, 'work', 'shop', 'items.jsonl'), lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
  const finished = finishTimes((slug) => (slug === 'shop' || slug === 'blog' ? repo : null), { data: () => data, now: () => NOW })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 200))

  assert.equal(finished({ kind: 'change', slug: 'shop', item: 'a1' }, amended), '2026-11-22T11:30:00Z', 'its last arrival, not the note after it')
  // The blog's items say nothing of b1: its head's commit time, once git answered.
  assert.equal(finished({ kind: 'change', slug: 'blog', item: 'b1' }, amended), null)
  await settle()
  assert.equal(Date.parse(finished({ kind: 'change', slug: 'blog', item: 'b1' }, amended)!), Date.parse('2026-11-23T08:00:00Z'))
  finished({ kind: 'change', slug: 'blog', item: 'b1' }, ahead)
  await settle()
  assert.equal(finished({ kind: 'change', slug: 'blog', item: 'b1' }, ahead), null, 'a time after now is no clock')
})

test("a pull request's clock is when it was opened or its head was committed, whichever is later and not after now; a comment does not reset it", async (t) => {
  const built: string[] = []
  const reviews = new Reviews({
    store: reviewStore(temporaryDirectory(t)),
    sources: {
      change: { head: async () => null, read: async () => Promise.reject(new Error('no')) },
      pull: { head: async (target) => (target.kind === 'pull' ? sha(target.number) : null), read: async (target) => (built.push(reviewIdOf(target)), Promise.reject(new Error('not read here'))) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    now: () => NOW,
  })
  t.after(() => reviews.close())
  const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString()
  // Every one was commented on just now. #4 was opened 100 hours ago and its head is dated next year; #5 was opened
  // longer ago, but pushed an hour ago.
  const pulls: Watched[] = [1, 2, 3, 4, 5].map((number) => ({ id: `pr:acme/shop/${number}`, head: sha(number), updatedAt: ago(0), openedAt: ago(number === 4 ? 100 : number === 5 ? 120 : 1), pushedAt: number === 4 ? '2027-01-01T00:00:00Z' : ago(1) }))

  reviews.watch(pulls)
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(built, ['pr:acme/shop/1', 'pr:acme/shop/2', 'pr:acme/shop/4'])
})

test('a build that fails is tried again at most once a day in its turn, even after a restart, and its row says when', async (t) => {
  const root = temporaryDirectory(t)
  let now = NOW
  const started: string[] = []
  const host = () => {
    const reviews = new Reviews({
      store: reviewStore(root),
      sources: {
        change: { head: async () => sha(1), read: async (target) => (started.push(reviewIdOf(target)), Promise.reject(new Error('git could not read it'))) },
        pull: { head: async () => null, read: async () => Promise.reject(new Error('no pull requests here')) },
      },
      work: () => ({ workAction: async () => ({}) }),
      card: () => null,
      now: () => now,
    })
    t.after(() => reviews.close())
    return reviews
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  const wanted: Watched[] = [{ id: 'change:shop:c1', head: sha(1), project: 'Shop', grade: null, conflict: false }]
  let reviews = host()

  reviews.watch(wanted)
  await settle()
  reviews.watch(wanted)
  await settle()

  assert.deepEqual(started, ['change:shop:c1'])
  const why = `Its last build failed at ${clockOf(NOW)}; it is tried again in its turn after ${clockOf(NOW + 24 * HOUR)}. Not reviewed yet, so nothing checks it by itself.`
  assert.equal(reviews.status('change:shop:c1').turn?.why, why)
  // A restart the same day tries nothing, and its row still says why.
  reviews.close()
  reviews = host()
  reviews.watch(wanted)
  await settle()
  assert.deepEqual(started, ['change:shop:c1'])
  assert.equal(reviews.list().reviews.find((row) => row.id === 'change:shop:c1')?.turn?.why, why)
  // A day later it is tried once more.
  now = NOW + 24 * HOUR
  reviews.watch(wanted)
  await settle()
  reviews.watch(wanted)
  await settle()
  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c1'])
})

test("an old change keeps the longest-wait place until its review finished, one at a time, and then it passes to the next oldest", async (t) => {
  const root = temporaryDirectory(t)
  const store = reviewStore(root)
  const states = new Map<string, string>()
  const started: string[] = []
  const assessments = {
    status: (target: Parameters<typeof reviewIdOf>[0], head: string | null) => ({ state: states.get(reviewIdOf(target)) ?? 'idle', head }),
    cutShort: () => false,
    start: (job: { target: Parameters<typeof reviewIdOf>[0]; head: string }) => {
      started.push(reviewIdOf(job.target))
      states.set(reviewIdOf(job.target), 'running')
      return { state: 'running', head: job.head }
    },
    stop: () => false,
    pending: () => [],
    present: () => null,
    read: () => null,
    busy: () => false,
    forget: () => {},
    close: () => {},
  } as unknown as Assessments
  // Twenty changes that finished days ago, c20 the longest ago, each with its graph drawn: what starts is its change review.
  const wanted: Watched[] = Array.from({ length: 20 }, (_, index) => ({ id: `change:shop:c${index + 1}`, head: sha(index + 1), project: 'Shop', grade: null, conflict: false, at: new Date(NOW - (60 + index) * HOUR).toISOString() }))
  for (const [index, entry] of wanted.entries()) store.write({ kind: 'change', slug: 'shop', item: `c${index + 1}` }, ({ change: { title: `c${index + 1}`, project: 'Shop', head: entry.head, base: 'b'.repeat(40) } }) as unknown as Review, [])
  const reviews = new Reviews({
    store,
    sources: {
      change: { head: async (target) => (target.kind === 'change' ? sha(Number(target.item.slice(1))) : null), read: async () => Promise.reject(new Error('not read here')) },
      pull: { head: async () => null, read: async () => Promise.reject(new Error('no pull requests here')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    assessments,
    now: () => NOW,
  })
  t.after(() => reviews.close())
  const look = async () => {
    reviews.watch(wanted)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  await look()
  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c2', 'change:shop:c20'])
  // Its graph is drawn and its change review runs: the place is still c20's.
  await look()
  assert.equal(started.length, 3)
  for (const finished of ['change:shop:c20', 'change:shop:c19', 'change:shop:c18']) {
    states.set(finished, 'ready')
    await look()
  }

  // Each finished review passes the place to the next oldest; Work's order keeps its own two.
  assert.deepEqual(started, ['change:shop:c1', 'change:shop:c2', 'change:shop:c20', 'change:shop:c19', 'change:shop:c18', 'change:shop:c17'])
})

test("a pull request waits in the line at the commit GitHub says it is at, so the longest-wait place passes on once its review finished", async (t) => {
  const root = temporaryDirectory(t)
  const store = reviewStore(root)
  const pullOf = (number: number) => ({ kind: 'pull' as const, owner: 'acme', repo: 'shop', number })
  // Pull requests 5 and 6 waited longest, and their reviews at the commits GitHub names have finished.
  for (const number of [5, 6]) store.write(pullOf(number), ({ change: { title: `#${number}`, project: 'acme/shop', head: sha(number), base: 'b'.repeat(40) } }) as unknown as Review, [])
  const assessments = {
    status: (target: { kind: string; number?: number }, head: string | null) => ({ state: target.kind === 'pull' && [5, 6].includes(target.number!) ? 'ready' : 'idle', head }),
    cutShort: () => false,
    start: (job: { head: string }) => ({ state: 'running', head: job.head }),
    stop: () => false,
    pending: () => [],
    present: () => null,
    read: () => null,
    busy: () => false,
    forget: () => {},
    close: () => {},
  } as unknown as Assessments
  const built: string[] = []
  const reviews = new Reviews({
    store,
    sources: {
      change: { head: async () => null, read: async () => Promise.reject(new Error('no')) },
      pull: { head: async (target) => (target.kind === 'pull' ? sha(target.number) : null), read: async (target) => (built.push(reviewIdOf(target)), Promise.reject(new Error('not read here'))) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    assessments,
    now: () => NOW,
  })
  t.after(() => reviews.close())
  const listed = Array.from({ length: 6 }, (_, index) => ({
    repo: 'acme/shop', number: index + 1, title: `#${index + 1}`, labels: [], url: `https://github.com/acme/shop/pull/${index + 1}`, draft: false, author: 'someone', review: 'none', checks: 'none',
    updatedAt: new Date(NOW - (80 + index) * HOUR).toISOString(), head: sha(index + 1),
  })) as PullRequest[]

  const wanted = toPrepare({ finished: [] } as unknown as WorkState, { mine: listed, waiting: [], sample: false }, { pulls: 'mine' })
  reviews.watch(wanted)
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(wanted[0], { id: 'pr:acme/shop/1', updatedAt: listed[0]!.updatedAt, head: sha(1) })
  assert.deepEqual(built, ['pr:acme/shop/1', 'pr:acme/shop/2', 'pr:acme/shop/4'])
})
