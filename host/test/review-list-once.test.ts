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
const ITS_PULL = 'pr:acme/shop/482'
const ANOTHER_PULL = 'pr:acme/shop/7'

/** Reviews kept for each id, with the finished change's card saying which pull request it opened. */
function listed(t: TestContext, ids: string[], pr: string | null) {
  const store = reviewStore(temporaryDirectory(t))
  for (const id of ids) store.write(targetOfReviewId(id)!, sample, files)
  const source: ReviewSource = {
    head: async () => sample.change.head,
    read: async () => {
      throw new Error('Nothing is rebuilt in this test.')
    },
  }
  const card = (slug: string, item: string): ChangeCard | null => {
    if (`change:${slug}:${item}` !== CHANGE) return null
    return { landing: 'mergePr', yes: 'Merge it', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', pr }
  }
  const reviews = new Reviews({ store, sources: { change: source, pull: source }, work: () => ({ workAction: async () => null }), card })
  return reviews.list().reviews.map((item) => item.id).sort()
}

test('a finished change and the pull request it opened are listed once, as the change', (t) => {
  assert.deepEqual(listed(t, [CHANGE, ITS_PULL, ANOTHER_PULL], 'https://github.com/Acme/Shop/pull/482'), [CHANGE, ANOTHER_PULL], 'however the address spells the repository')
})

test('a pull request no listed change opened keeps its own row', (t) => {
  assert.deepEqual(listed(t, [CHANGE, ITS_PULL], null), [CHANGE, ITS_PULL], 'a change with no pull request hides none')
  assert.deepEqual(listed(t, [ITS_PULL], 'https://github.com/acme/shop/pull/482'), [ITS_PULL], 'with its change gone from the list, the pull request is the one row left')
})
