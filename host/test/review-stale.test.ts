import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import type { GitReader } from '../src/review/git.ts'
import { Reviews } from '../src/review/reviews.ts'
import { changeSource, type ReviewSource } from '../src/review/sources.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const files = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]
const NEWER = 'f'.repeat(40)

function reviewsAt(t: TestContext, id: string, { current = null as string | null, remote = sample.change.head, startsAt = null as string | null } = {}) {
  const store = reviewStore(temporaryDirectory(t))
  store.write(targetOfReviewId(id)!, sample, files)
  let asked = 0
  const source: ReviewSource = {
    head: async () => {
      asked += 1
      return remote
    },
    // A source that can say where its change starts, as a finished change's does.
    ...(startsAt ? { start: async () => startsAt } : {}),
    read: async () => {
      throw new Error('Nothing is rebuilt in this test.')
    },
  }
  const reviews = new Reviews({ store, sources: { change: source, pull: source }, work: () => ({ workAction: async () => null }), card: () => null, head: () => current })
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

test("a finished change is read at the commit its branch is at, even while its card still names an older one", async () => {
  const CARD = 'a'.repeat(40)
  const BRANCH = 'hobkin/7d02c9-say-what-hobkin-is-doing'
  const sourceWith = (tips: Record<string, string>, branch: string | null = BRANCH) =>
    changeSource({
      find: () => ({ project: 'hobkin', title: 'Say what hobkin is doing', branch, head: CARD }),
      repoOf: () => '/repo',
      baseOf: async () => 'main',
      git: () => ({ resolve: async (ref: string) => tips[ref] ?? null }) as unknown as GitReader,
    })
  const target = targetOfReviewId('change:hobkin:7d02c9')!

  assert.equal(await sourceWith({ [`refs/heads/${BRANCH}`]: NEWER }).head(target), NEWER, 'an agent reworked it since hobkin last published its card')
  assert.equal(await sourceWith({}).head(target), CARD, 'a branch git no longer has leaves the card’s commit')
  assert.equal(await sourceWith({}, null).head(target), CARD, 'and so does a change with no branch')
})

test("once a change's branch was looked up, its review goes by that commit, whatever its card still says", async (t) => {
  const id = 'change:hobkin:7d02c9'
  // The card is a commit behind: it still names the one the review was built for.
  const { reviews, asked } = reviewsAt(t, id, { current: sample.change.head, remote: NEWER })
  assert.deepEqual([reviews.status(id).stale, reviews.status(id).head], [false, sample.change.head], 'before any look, the card is all there is')

  // Opening the review looks its branch up, as opening a pull request's asks GitHub.
  reviews.get(id)
  await new Promise((done) => setImmediate(done))
  assert.equal(asked(), 1)
  assert.deepEqual([reviews.status(id).stale, reviews.status(id).head], [true, NEWER], 'the branch moved, so the review says it is outdated')
  assert.equal(reviews.list().reviews.find((item) => item.id === id)?.head, NEWER)
})

test('an opened review says where its change starts now, so one built from another start can be told', async (t) => {
  const id = 'change:hobkin:7d02c9'
  const ELSEWHERE = 'b'.repeat(40)
  const { reviews } = reviewsAt(t, id, { startsAt: ELSEWHERE })

  assert.equal('startsAt' in reviews.status(id), false, 'nothing says so before it is looked up')

  await reviews.lookAgain(id, () => 0)

  assert.equal(reviews.status(id).startsAt, ELSEWHERE)
  assert.notEqual(reviews.get(id).review.change.base, ELSEWHERE, 'the review it holds was built from another start, and still opens')
})

test('a review whose source cannot say where its change starts says nothing of it', async (t) => {
  const id = 'pr:acme/shop/482'
  const { reviews } = reviewsAt(t, id)

  await reviews.lookAgain(id, () => 0)

  assert.equal('startsAt' in reviews.status(id), false)
})

test("a layer of a stack starts where the layer under it is, and the bottom layer and a change in no stack start as they did", async () => {
  const BELOW = 'c'.repeat(40)
  const FORKED = 'd'.repeat(40)
  const target = targetOfReviewId('change:hobkin:7d02c9')!
  const git = { resolve: async () => null, mergeBase: async () => FORKED, contains: async (head: string, base: string) => head === 'e'.repeat(40) && base === BELOW } as unknown as GitReader
  const startOf = (stack?: { base: string | null }) =>
    changeSource({
      find: () => ({ project: 'hobkin', title: 'Layer', branch: null, head: 'e'.repeat(40), ...(stack ? { stack } : {}) }),
      repoOf: () => '/repo',
      baseOf: async () => 'main',
      git: () => git,
    }).start!(target, 'e'.repeat(40))

  assert.equal(await startOf({ base: BELOW }), BELOW, 'a layer starts at the commit under it')
  assert.equal(await startOf({ base: null }), FORKED, 'the bottom layer starts from the default branch')
  assert.equal(await startOf(), FORKED, 'a change in no stack starts from the default branch')
  await assert.rejects(startOf({ base: 'a'.repeat(40) }), /stack base.*not an ancestor/i, 'a rewritten parent is not silently diffed against the old layer')
})

test("a review built from the default branch before its change was a layer says it starts elsewhere once its change is a layer, so the window calls it outdated", async (t) => {
  const id = 'change:hobkin:7d02c9'
  const BELOW = 'c'.repeat(40)
  const { reviews } = reviewsAt(t, id, { startsAt: BELOW })

  await reviews.lookAgain(id, () => 0)

  assert.equal(reviews.status(id).startsAt, BELOW)
  assert.notEqual(reviews.get(id).review.change.base, BELOW)
})
