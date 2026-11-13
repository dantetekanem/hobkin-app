import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ReviewList, ReviewListItem } from '#shared/review/status.ts'
import { followReviewList } from '../src/features/work/review-list-follow.ts'

const HEAD = 'f3a9c1e7'.padEnd(40, '0')
const RUNNING: ReviewListItem = { id: 'pr:acme/web/12', kind: 'pull', title: 'Tighten the login form', project: 'acme/web', head: HEAD, state: 'ready', phase: null, error: null, assessment: { state: 'running', head: HEAD, percent: 40 }, updatedAt: '2026-11-12T12:00:00.000Z' }
const READY: ReviewListItem = { ...RUNNING, assessment: { state: 'ready', head: HEAD, summary: { level: 'mid', critical: false, needsYou: 0, worthALook: 2, safe: 3, storyBy: 'model', at: '2026-11-12T12:05:00.000Z' } } }

/** A host whose list the test changes. It counts how often it was asked, and can fail once. */
function hostWith(reviews: ReviewListItem[]) {
  const host = {
    reviews,
    asked: 0,
    failNext: false,
    run: async (): Promise<ReviewList> => {
      host.asked += 1
      if (host.failNext) {
        host.failNext = false
        throw new Error('The host is not answering.')
      }
      return { reviews: host.reviews }
    },
  }
  return host
}

/** Lets the host's answers in. */
const answered = () => new Promise((resolve) => setImmediate(resolve))

test('the list is asked for at once, every second while a review runs, and every three once none does', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = hostWith([RUNNING])
  const shown: string[] = []
  const follow = followReviewList({ run: host.run, onList: (list) => shown.push(list.reviews[0]?.assessment?.state ?? 'none'), onError: () => {} })
  await answered()
  assert.equal(host.asked, 1, 'asked once, when the screen opens')

  t.mock.timers.tick(999)
  await answered()
  assert.equal(host.asked, 1, 'not before a second')
  host.reviews = [READY]
  t.mock.timers.tick(1)
  await answered()
  assert.equal(host.asked, 2)

  t.mock.timers.tick(1_000)
  await answered()
  assert.equal(host.asked, 2, 'nothing runs now, so it waits longer')
  t.mock.timers.tick(8_000)
  await answered()
  assert.equal(host.asked, 3)
  assert.deepEqual(shown, ['running', 'ready', 'ready'])

  follow.stop()
  t.mock.timers.tick(60_000)
  await answered()
  assert.equal(host.asked, 3, 'nothing is asked once stopped')
})

test('a failed ask says why, keeps asking, and an answer that comes back after stop is dropped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = hostWith([])
  host.failNext = true
  const errors: string[] = []
  const lists: number[] = []
  const follow = followReviewList({ run: host.run, onList: (list) => lists.push(list.reviews.length), onError: (message) => errors.push(message) })
  await answered()
  assert.deepEqual(errors, ['The host is not answering.'])
  assert.deepEqual(lists, [])

  t.mock.timers.tick(3_000)
  await answered()
  assert.deepEqual(lists, [0], 'the next ask answers')

  let release: (list: ReviewList) => void = () => {}
  const shownLate: ReviewList[] = []
  const late = followReviewList({ run: () => new Promise<ReviewList>((resolve) => (release = resolve)), onList: (list) => shownLate.push(list), onError: () => {} })
  late.stop()
  release({ reviews: [RUNNING] })
  await answered()
  assert.equal(shownLate.length, 0, 'a late answer is not shown')
  follow.stop()
})

test('asked to look now, the list is read at once and not ten seconds later, so a review started again shows as running', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = hostWith([READY])
  const shown: string[] = []
  const follow = followReviewList({ run: host.run, onList: (list) => shown.push(list.reviews[0]?.assessment?.state ?? 'none'), onError: () => {} })
  await answered()
  assert.deepEqual(shown, ['ready'])

  host.reviews = [RUNNING]
  follow.askNow()
  await answered()
  assert.deepEqual(shown, ['ready', 'running'])
  assert.equal(host.asked, 2)
  // The turn that was waiting is not asked a second time on top of it.
  t.mock.timers.tick(999)
  await answered()
  assert.equal(host.asked, 2)
  follow.stop()
})
