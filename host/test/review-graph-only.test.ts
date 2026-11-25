import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { checkArguments } from '#shared/commands/registry.ts'
import { reviewIdOf } from '#shared/review/ids.ts'
import type { AssessJob, Assessments } from '../src/review/assessment.ts'
import { Reviews } from '../src/review/reviews.ts'
import { sampleReviewSource } from '../src/review/sample-source.ts'
import { reviewHandlers } from '../src/review/seat.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

/**
 * The code look asks for a review's graph and files alone (spec 071): no change review starts for it, and an ask for
 * the change review later, or while that graph is built, still starts one.
 */

const ID = 'change:shop:4c9e21'
const OTHER = 'change:shop:7d02c9'

/** A host on the sample change, with a change review that only writes down what it is asked to start. */
function reviewsFor(t: TestContext, more: Partial<ConstructorParameters<typeof Reviews>[0]> = {}) {
  const started: AssessJob[] = []
  const assessments = {
    status: (_target: unknown, head: string | null) => ({ state: 'idle', head }),
    cutShort: () => false,
    start: (job: AssessJob) => {
      started.push(job)
      return { state: 'queued', head: job.head }
    },
    stop: () => false,
    pending: () => [],
    present: () => null,
    read: () => null,
    busy: () => false,
    forget: () => {},
    close: () => {},
  } as unknown as Assessments
  const sample = sampleReviewSource()
  const reviews = new Reviews({ store: reviewStore(temporaryDirectory(t)), sources: { change: sample, pull: sample }, work: () => ({ workAction: async () => ({}) }), card: () => null, assessments, ...more })
  t.after(() => reviews.close())
  return { reviews, started: () => started.map((job) => reviewIdOf(job.target)) }
}

test('a review asked for without its change review gets its graph and files, and no change review starts or reads as queued', async (t) => {
  const { reviews, started } = reviewsFor(t)

  const asked = reviews.prepare(ID, { asked: true, changeReview: false })
  assert.equal(asked.state, 'preparing', 'it answers at once')
  assert.equal(asked.assessment?.state, 'idle', 'no change review waits behind this graph')
  await reviews.settled(ID)

  assert.equal(reviews.status(ID).state, 'ready')
  assert.ok(reviews.get(ID).review.nodes.length > 0, 'its graph is there')
  assert.ok(reviews.file(ID, 'src/cli/doing.mjs').head, 'and its files')
  assert.deepEqual(started(), [])
  assert.equal(reviews.status(ID).assessment?.state, 'idle')
})

test('an ask with the change review starts it after a graph built alone: one waiting its turn, one under way, or one done', async (t) => {
  // Waiting behind another review's graph: the ask joins it, and its change review now waits behind it too.
  const waiting = reviewsFor(t)
  waiting.reviews.prepare(OTHER, { asked: true, changeReview: false })
  waiting.reviews.prepare(ID, { asked: true, changeReview: false })
  assert.equal(waiting.reviews.prepare(ID, { asked: true }).assessment?.state, 'queued')
  await waiting.reviews.settled()
  assert.deepEqual(waiting.started(), [ID], 'the other review built its graph alone, as asked')

  // Under way: the change review starts once the graph is drawn.
  const drawing = reviewsFor(t)
  drawing.reviews.prepare(ID, { asked: true, changeReview: false })
  assert.equal(drawing.reviews.prepare(ID, { asked: true }).assessment?.state, 'queued')
  await drawing.reviews.settled(ID)
  assert.deepEqual(drawing.started(), [ID])

  // Done: the graph kept is used, and its change review starts from it.
  const done = reviewsFor(t)
  done.reviews.prepare(ID, { asked: true, changeReview: false })
  await done.reviews.settled(ID)
  done.reviews.prepare(ID, { asked: true })
  await done.reviews.settled(ID)
  assert.deepEqual(done.started(), [ID])
})

test('a graph built alone for the window is the user’s own ask: the line never drops it, and the chat is told nothing of it', async (t) => {
  // Every change is back at work and none is finished: what only waits its turn is dropped, but not what the user waits for.
  const { reviews } = reviewsFor(t, { backAtWork: () => true })
  reviews.prepare(OTHER, { asked: true, changeReview: false })
  reviews.prepare(ID, { asked: true, changeReview: false })
  reviews.prepare('change:shop:b2b2b2')
  reviews.watch([])
  assert.equal(reviews.status(ID).phase, 'queued')
  assert.equal(reviews.status('change:shop:b2b2b2').phase, null)
  await reviews.settled()

  // On a host with no change reviews a pull request's graph is its whole review, and only an ask for it is told when it is ready.
  const told: string[] = []
  const plain = reviewsFor(t, { assessments: undefined, onReady: ({ target }) => void told.push(reviewIdOf(target)) })
  plain.reviews.prepare('pr:acme/shop/1', { asked: true, changeReview: false })
  await plain.reviews.settled()
  plain.reviews.prepare('pr:acme/shop/2', { asked: true })
  await plain.reviews.settled()
  assert.deepEqual(told, ['pr:acme/shop/2'])
})

test('review.prepare takes changeReview: false from the window', async (t) => {
  assert.deepEqual(checkArguments('review.prepare', { id: ID, changeReview: false }), { ok: true })
  assert.equal(checkArguments('review.prepare', { id: ID, changeReview: 'no' }).ok, false)

  const { reviews, started } = reviewsFor(t)
  const handlers = reviewHandlers(reviews)
  await handlers['review.prepare']!({ id: ID, changeReview: false })
  await reviews.settled(ID)
  assert.deepEqual(started(), [])
  await handlers['review.prepare']!({ id: ID })
  await reviews.settled(ID)
  assert.deepEqual(started(), [ID])
})

test('a ready review built again is listed ready, so the older one still opens, with the phase and start the window reads as reviewing', async (t) => {
  const { reviews } = reviewsFor(t)
  reviews.prepare(ID, { asked: true })
  await reviews.settled(ID)

  reviews.prepare(ID, { asked: true, refresh: true })
  const listed = reviews.list().reviews.find((item) => item.id === ID)
  assert.deepEqual([listed?.state, listed?.phase, typeof listed?.startedAt, listed?.assessment?.state], ['ready', 'reading', 'string', 'queued'])
  await reviews.settled(ID)
  const done = reviews.list().reviews.find((item) => item.id === ID)
  assert.deepEqual([done?.state, done?.phase, done?.startedAt], ['ready', null, undefined])
})
