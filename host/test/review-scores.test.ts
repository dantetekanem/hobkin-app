import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import type { ChangeScores } from '#shared/protocol/work.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { Reviews, type ChangeCard } from '../src/review/reviews.ts'
import type { ReviewSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]

const CHANGE = 'change:hobkin:7d02c9'
const PULL = 'pr:acme/shop/482'

const scored: ChangeScores = {
  kind: 'Bug fix',
  rate: 8.4,
  scores: [
    { name: 'coverage', score: 8, evidence: 'Tests reach it.' },
    { name: 'proof', score: 8, evidence: 'The suite passes.' },
    { name: 'deploy and data', score: 7, evidence: 'A migration runs.' },
    { name: 'visibility', score: 8, evidence: 'It logs.' },
    { name: 'rollback', score: 9, evidence: 'One revert.' },
  ],
  floors: [{ name: 'deploy and data', score: 7, needs: 8 }],
  stale: false,
}

function reviews(t: TestContext, card: Partial<ChangeCard>) {
  const store = reviewStore(temporaryDirectory(t))
  for (const id of [CHANGE, PULL]) store.write(targetOfReviewId(id)!, sample, files)
  const source: ReviewSource = {
    head: async () => sample.change.head,
    read: async () => {
      throw new Error('Nothing is rebuilt in this test.')
    },
  }
  const of = (slug: string, item: string): ChangeCard | null =>
    `change:${slug}:${item}` === CHANGE ? { landing: 'merge', yes: 'Merge it', branch: 'hobkin/7d02c9-change', pr: null, ...card } : null
  return new Reviews({ store, sources: { change: source, pull: source }, work: () => ({ workAction: async () => null }), card: of })
}

test("a finished change's status carries its scores, and its list row its general rate", (t) => {
  const all = reviews(t, { scores: scored })
  assert.deepEqual(all.status(CHANGE).scores, scored)
  assert.equal(all.list().reviews.find((item) => item.id === CHANGE)?.rate, 8.4)
})

test('a finished change with no scores, and a pull request, carry none', (t) => {
  const none = reviews(t, {})
  assert.equal(none.status(CHANGE).scores, undefined)
  assert.equal(none.list().reviews.find((item) => item.id === CHANGE)?.rate, undefined)

  const all = reviews(t, { scores: scored })
  assert.equal(all.status(PULL).scores, undefined)
  assert.equal(all.list().reviews.find((item) => item.id === PULL)?.rate, undefined)
})
