import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { ReviewNeeds } from '#shared/review/needs.ts'
import { reviewIdOf } from '#shared/review/ids.ts'
import { Reviews } from '../src/review/reviews.ts'
import { ratingOf, type RatingFacts } from '../src/review/ratings.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const HEAD = '4f2a9c1'.padEnd(40, '0')
const OLD = '3b1d7e2'.padEnd(40, '0')
const score = (value: number) => ({ score: value, evidence: 'Because.' })
const needs = (over: Partial<ReviewNeeds> = {}): ReviewNeeds => ({
  kind: 'bug-fix',
  scores: { coverage: score(8), proof: score(8), safety: score(9), visibility: score(8), rollback: score(9) },
  rate: 8.4,
  head: HEAD,
  by: 'change-review',
  ...over,
})
const facts = (over: Partial<RatingFacts> = {}): RatingFacts => ({ head: HEAD, needs: [], running: false, tries: 3, ...over })

test('a change says one of rated, rating now, waits its turn, rating again or not rated after N tries, and never a blank', () => {
  const rated = ratingOf(facts({ needs: [needs()] }))
  assert.deepEqual([rated.state, rated.text, rated.rate, rated.head], ['rated', 'Rated at 4f2a9c1: 8.4', 8.4, HEAD])

  assert.deepEqual(ratingOf(facts({ running: true })), { state: 'rating', text: 'Rating now' })
  assert.deepEqual(ratingOf(facts({ turn: { ahead: 3, why: 'Waits its turn: 3 ahead in Shop.' } })), { state: 'waits', text: 'Waits its turn: 3 ahead', ahead: 3 })
  assert.deepEqual(ratingOf(facts({ turn: { ahead: 0, why: "Today's 20 background reviews are spent, so the next is built after midnight. Not reviewed yet." } })), {
    state: 'waits',
    text: "Waits its turn: Today's 20 background reviews are spent, so the next is built after midnight.",
    ahead: 0,
  })

  const notRated = { tries: 3, why: 'after 3 tries the answer still lacked coverage: the Reviewer gave no answer' }
  assert.deepEqual(ratingOf(facts({ needs: [needs({ rate: undefined })], notRated })), {
    state: 'not-rated',
    text: 'Not rated after 3 tries: after 3 tries the answer still lacked coverage: the Reviewer gave no answer',
    tries: 3,
  })
  // Rated again by the user's button: it runs, so it is rating again, and the engine's try is said only when it said it.
  assert.deepEqual(ratingOf(facts({ notRated, running: true })), { state: 'again', text: 'Rating again', of: 3 })
  assert.deepEqual(ratingOf(facts({ notRated, running: true, tryNow: 2 })), { state: 'again', text: 'Rating again, try 2 of 3', tries: 2, of: 3 })

  // Nothing known at all still says something: it waits for the background.
  assert.equal(ratingOf(facts()).state, 'waits')
  for (const state of [facts({ needs: [needs()] }), facts({ running: true }), facts()]) assert.doesNotMatch(ratingOf(state).text, /no rate yet|^$|^-$/i)

  // A Markdown-only change has nothing to rate, and says so.
  assert.deepEqual(ratingOf(facts({ nothingToRate: true })), { state: 'nothing', text: 'Nothing to rate: it only edits Markdown.' })
})

test('a change at a newer commit shows the older rating marked older with both commits, and no rate of the change itself', () => {
  const older = ratingOf(facts({ needs: [needs({ head: OLD, rate: 7.2 })], running: true }))
  assert.equal(older.state, 'rating')
  assert.deepEqual(older.older, { head: OLD, rate: 7.2, text: 'Rated at 3b1d7e2: 7.2, older: the change is at 4f2a9c1 now.' })
  assert.equal(older.rate, undefined, 'the older rate is not the change\'s own')

  // Both at once: the rating at its commit leads, and the older is kept only when there is no rating at its commit.
  const both = ratingOf(facts({ needs: [needs({ head: OLD, rate: 7.2 }), needs()] }))
  assert.equal(both.state, 'rated')
  assert.equal(both.older, undefined)

  // hobkin's own scored run is no rating of the change review, and is not shown as one.
  assert.equal(ratingOf(facts({ needs: [needs({ by: 'hobkin' })] })).state, 'waits')
})

/** Reviews with a fake change review that says what it is told: its ratings at each commit, what it could not rate, what runs. */
function reviewsWith(t: TestContext, over: { needs?: ReviewNeeds | null; notRated?: { tries: number; why: string } | null; state?: string; tries?: number; graded?: (head: string, needs: ReviewNeeds) => void } = {}) {
  const heads = new Map<string, string>()
  const said = { needs: over.needs ?? null, notRated: over.notRated ?? null, state: over.state ?? 'idle' }
  const assessments = {
    status: (_target: unknown, head: string | null) => ({ state: said.state, head }),
    needsOf: () => said.needs,
    notRatedOf: () => said.notRated,
    pending: () => [],
    present: () => null,
    read: () => null,
    busy: () => false,
    forget: () => {},
    close: () => {},
    start: () => ({ state: 'queued', head: null }),
    stop: () => false,
  }
  const reviews = new Reviews({
    store: reviewStore(temporaryDirectory(t)),
    sources: {
      change: { head: async (target) => heads.get(reviewIdOf(target)) ?? null, read: async () => Promise.reject(new Error('not read here')) },
      pull: { head: async () => null, read: async () => Promise.reject(new Error('no')) },
    },
    work: () => ({ workAction: async () => ({}) }),
    card: () => null,
    head: () => HEAD,
    assessments: assessments as never,
    ...(over.tries ? { ratingTries: () => over.tries } : {}),
    ...(over.graded ? { graded: (_target, head, needs) => over.graded!(head, needs) } : {}),
  })
  t.after(() => reviews.close())
  return { reviews, said, heads }
}

const ID = 'change:shop:c1'

test('a change in the list says where its ratings stand in each case, from the review at its commit, its tries and its answer', (t) => {
  const { reviews, said } = reviewsWith(t, { tries: 3 })
  reviews.watch([{ id: ID, head: HEAD, project: 'Shop', at: '2026-11-24T10:00:00.000Z' }], 0)

  // Finished, rated at its commit.
  said.needs = needs()
  assert.equal(reviews.status(ID).rating?.text, 'Rated at 4f2a9c1: 8.4')
  assert.equal(reviews.list().reviews.find((row) => row.id === ID)?.rating?.state, 'rated')

  // Rated only at an older commit: the older is marked, and it is not the change's rate.
  said.needs = needs({ head: OLD, rate: 7.2 })
  const older = reviews.status(ID).rating!
  assert.equal(older.rate, undefined)
  assert.match(older.older!.text, /older: the change is at 4f2a9c1 now/)

  // Answered without all five after the tries: not rated, with why.
  said.needs = null
  said.notRated = { tries: 3, why: 'after 3 tries the answer still lacked proof' }
  assert.deepEqual(reviews.status(ID).rating, { state: 'not-rated', text: 'Not rated after 3 tries: after 3 tries the answer still lacked proof', tries: 3 })

  // The user's button runs it again, and it is rating again, of the 3 tries the rules allow.
  said.state = 'running'
  assert.deepEqual(reviews.status(ID).rating, { state: 'again', text: 'Rating again', of: 3 })

  // Never rated, running: rating now.
  said.notRated = null
  assert.equal(reviews.status(ID).rating?.text, 'Rating now')
})

test("a finished review's ratings go to the bridge once it is rated at the commit the change is at, and only then", async (t) => {
  const sent: string[] = []
  const { reviews, said } = reviewsWith(t, { graded: (head) => void sent.push(head) })
  const entry = { id: ID, head: HEAD, project: 'Shop', at: '2026-11-24T10:00:00.000Z' }

  reviews.watch([entry], 0)
  assert.deepEqual(sent, [], 'nothing rated yet')
  said.needs = needs({ head: OLD, rate: 7.2 })
  reviews.watch([entry], 0)
  assert.deepEqual(sent, [], 'a rating made at another commit does not go')
  said.needs = needs()
  reviews.watch([entry], 0)
  assert.deepEqual(sent, [HEAD])
})
