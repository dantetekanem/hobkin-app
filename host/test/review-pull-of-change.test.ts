import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { Reviews, type ChangeCard } from '../src/review/reviews.ts'
import type { ReviewSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]

const CHANGE = 'change:hobkin:7d02c9'

/** A host that keeps the finished change's review, with its card saying which pull request it opened. */
function reviewsOf(t: TestContext, pr: string | null) {
  const store = reviewStore(temporaryDirectory(t))
  store.write(targetOfReviewId(CHANGE)!, sample, files)
  const source: ReviewSource = {
    head: async () => sample.change.head,
    read: async () => {
      throw new Error('Nothing is rebuilt in this test.')
    },
  }
  const card = (): ChangeCard => ({ landing: 'mergePr', yes: 'Merge it', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', pr })
  const reviews = new Reviews({ store, sources: { change: source, pull: source }, work: () => ({ workAction: async () => null }), card })
  t.after(() => reviews.close())
  return reviews
}

test('a finished change that opened a pull request says its address, in its status and in the list', (t) => {
  const reviews = reviewsOf(t, 'https://github.com/acme/shop/pull/482')

  assert.equal(reviews.status(CHANGE).pr, 'https://github.com/acme/shop/pull/482')
  assert.deepEqual(reviews.list().reviews.map((item) => [item.id, item.pr]), [[CHANGE, 'https://github.com/acme/shop/pull/482']])
})

test('a finished change with no pull request, or with an address that is no pull request page, says none', (t) => {
  for (const pr of [null, 'https://elsewhere.invalid/acme/shop/pull/482', 'not an address']) {
    const reviews = reviewsOf(t, pr)

    assert.equal('pr' in reviews.status(CHANGE), false, `with the card saying ${pr}`)
    assert.equal('pr' in reviews.list().reviews[0]!, false, `with the card saying ${pr}`)
  }
})

test('a listed review says how many lines its change has, from the stored review, and says nothing for one never built', (t) => {
  const reviews = reviewsOf(t, null)
  const { additions, deletions } = sample.change
  assert.equal(reviews.list().reviews[0]!.lines, additions + deletions)

  const store = reviewStore(temporaryDirectory(t))
  const source: ReviewSource = { head: async () => 'a'.repeat(40), read: () => new Promise(() => {}) }
  const card = (): ChangeCard => ({ landing: 'mergePr', yes: 'Merge it', branch: 'hobkin/x', pr: null })
  const waiting = new Reviews({ store, sources: { change: source, pull: source }, work: () => ({ workAction: async () => null }), card })
  t.after(() => waiting.close())
  waiting.prepare(CHANGE)
  const listed = waiting.list().reviews
  assert.equal(listed.length, 1)
  assert.equal('lines' in listed[0]!, false)
})
