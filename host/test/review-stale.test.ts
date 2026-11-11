import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { Reviews } from '../src/review/reviews.ts'
import type { ReviewSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]
const NEWER = 'f'.repeat(40)

function reviewsAt(t: TestContext, id: string, { current = null as string | null, remote = sample.change.head } = {}) {
  const store = reviewStore(temporaryDirectory(t))
  store.write(targetOfReviewId(id)!, sample, files)
  let asked = 0
  const source: ReviewSource = {
    head: async () => {
      asked += 1
      return remote
    },
    read: async () => {
      throw new Error('Nothing is rebuilt in this test.')
    },
  }
  const reviews = new Reviews({ store, sources: { change: source, pull: source }, agent: async () => null, work: () => ({ workAction: async () => null }), card: () => null, head: () => current })
  return { reviews, asked: () => asked }
}

test('a review built for an older commit than the change is at now says it is outdated, with both commits', (t) => {
  const id = 'change:hobkin:7d02c9'
  const fresh = reviewsAt(t, id, { current: sample.change.head }).reviews
  assert.equal(fresh.get(id).status.stale, false)

  const { reviews } = reviewsAt(t, id, { current: NEWER })
  assert.deepEqual([reviews.status(id).state, reviews.status(id).stale, reviews.status(id).head], ['ready', true, NEWER])
  const opened = reviews.get(id)
  assert.equal(opened.review.change.head, sample.change.head, 'the outdated review still opens')
  assert.equal(opened.status.stale, true)
})

test("a pull request's commit is looked up again when its review is opened, at most once a minute", async (t) => {
  const id = 'pr:acme/shop/482'
  let now = 0
  const { reviews, asked } = reviewsAt(t, id, { remote: NEWER })
  assert.equal(reviews.status(id).stale, false, 'nothing says it moved before it is looked up')

  await reviews.lookAgain(id, () => now)
  assert.deepEqual([reviews.status(id).stale, reviews.status(id).head], [true, NEWER])
  await reviews.lookAgain(id, () => (now += 30_000))
  assert.equal(asked(), 1, 'looked up once within the minute')
  await reviews.lookAgain(id, () => (now += 31_000))
  assert.equal(asked(), 2)
})
