import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { ReviewNeeds } from '#shared/review/needs.ts'
import type { Review } from '#shared/review/types.ts'
import { assessmentFolder, Assessments } from '../src/review/assessment.ts'
import { engineNeeds, monitoringLines, withHobkinRate } from '../src/review/ratings.ts'
import { Reviews } from '../src/review/reviews.ts'
import { reviewStore } from '../src/review/store.ts'
import { hobkinNeedsOf } from '../src/work.ts'
import { temporaryDirectory } from './support.ts'

const HEAD = 'c'.repeat(40)
const answer = (score: number, evidence = 'A line the Reviewer wrote.') => ({ score, evidence })
const ENGINE_NEEDS = {
  kind: 'bug-fix',
  missing: 'A test of the empty cart.',
  scores: { coverage: answer(8), proof: answer(7, 'revert runs fail. Capped at 7: the change added no test.'), safety: answer(6), visibility: answer(7), rollback: answer(9) },
  head: HEAD,
  by: 'change-review',
  monitoring: 'given',
}

test("the change review's ratings take hobkin's general rate and floors by hobkin's own formula, and only what it needs is there", () => {
  const rated = engineNeeds({ needs: ENGINE_NEEDS })!

  assert.deepEqual(rated, { kind: 'bug-fix', scores: ENGINE_NEEDS.scores, missing: 'A test of the empty cart.', rate: 7.4, floors: [{ name: 'safety', score: 6, needs: 8 }], head: HEAD, by: 'change-review' })
  // No monitoring known: no visibility, so no general rate; the floors of the four there still hold.
  const { visibility: _visibility, ...four } = ENGINE_NEEDS.scores
  const unknown = engineNeeds({ needs: { ...ENGINE_NEEDS, scores: four, monitoring: 'unknown' } })!
  assert.deepEqual([unknown.rate, unknown.floors, Object.keys(unknown.scores)], [undefined, [{ name: 'safety', score: 6, needs: 8 }], ['coverage', 'proof', 'safety', 'rollback']])
  // Not rated: nothing is made up.
  for (const graph of [{}, { needs: null }, { needs: { ...ENGINE_NEEDS, head: 'abc' } }, null]) assert.equal(engineNeeds(graph), undefined, JSON.stringify(graph))
  assert.equal(withHobkinRate({ scores: {}, head: HEAD, by: 'change-review' }).rate, undefined)
})

test("hobkin's own scores are named as hobkin's, with what is still missing and the commit they were made at", () => {
  const review = { kind: 'feature', rate: 8.2, scores: { coverage: answer(9), proof: answer(8), safety: answer(9), visibility: answer(7), rollback: answer(8) }, floors: [], missing: 'A request test.', head: HEAD, stale: false }

  const needs = hobkinNeedsOf({ slug: 'shop', item: 'a1', title: 'A', review })

  assert.deepEqual(needs, { kind: 'feature', scores: review.scores, missing: 'A request test.', rate: 8.2, floors: [], head: HEAD, by: 'hobkin' } satisfies ReviewNeeds)
  assert.equal(hobkinNeedsOf({ slug: 'shop', item: 'a1', title: 'A', review: null }), undefined)
})

test("the project's monitoring and way back, from hobkin's readiness record, are the lines handed to the Reviewer", () => {
  const words = { errors: 'Error tracking', slowQueries: 'Slow queries', performance: 'Performance metrics', logs: 'Searchable logs', alerts: 'Alerts', rollback: 'Rollback', deploy: 'Deploy', tests: 'Tests' }
  const parts = {
    tests: { state: 'done', line: 'bin/rails test passes on main.' },
    errors: { state: 'done', line: 'Sentry gets every exception.' },
    alerts: { state: 'todo', line: 'No alert reaches the user.' },
    rollback: { state: 'done', line: 'Revert the merge and deploy: ten minutes.' },
  }

  assert.deepEqual(monitoringLines({ at: '2026-11-20T10:00:00.000Z', parts }, words), ['Error tracking: Sentry gets every exception.', 'Alerts: not in place: No alert reaches the user.', 'Rollback: Revert the merge and deploy: ten minutes.'])
  assert.equal(monitoringLines({ at: null, parts }, words), undefined, 'never recorded: nothing is known of it')
  assert.equal(monitoringLines(null, words), undefined)
})

/** A home with a review of the shop's change at HEAD, its change review finished with `graph`. */
function reviewed(t: TestContext, graph: object, card: () => { hobkinNeeds?: ReviewNeeds | null } | null = () => null) {
  const root = temporaryDirectory(t)
  const target = { kind: 'change' as const, slug: 'shop', item: 'a1' }
  reviewStore(root).write(target, ({ change: { title: 'Round the totals', project: 'shop', head: HEAD, base: 'b'.repeat(40) } }) as unknown as Review, [])
  const folder = assessmentFolder(root, target, HEAD)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'summary.json'), JSON.stringify({ level: 'safe', critical: false, needsYou: 0, worthALook: 0, safe: 1, storyBy: 'model', at: '2026-11-23T10:00:00.000Z' }))
  writeFileSync(join(folder, 'graph.json'), JSON.stringify(graph))
  const assessments = new Assessments({ root, run: async () => Promise.reject(new Error('not run here')), repoOf: () => null })
  const reviews = new Reviews({
    store: reviewStore(root),
    sources: { change: { head: async () => HEAD, read: async () => Promise.reject(new Error('no')) }, pull: { head: async () => null, read: async () => Promise.reject(new Error('no')) } },
    work: () => ({ workAction: async () => ({}) }),
    card: () => {
      const given = card()
      return given && { landing: 'merge', yes: '', branch: null, pr: null, scores: null, ...given }
    },
    head: () => HEAD,
    assessments,
  })
  t.after(() => reviews.close())
  return reviews
}

test("a review's status and row carry its ratings, the commit they were made at and hobkin's rate and floors", (t) => {
  const hobkins: ReviewNeeds = { kind: 'feature', scores: { coverage: answer(9) }, head: HEAD, by: 'hobkin' }
  const reviews = reviewed(t, { nodes: [], needs: ENGINE_NEEDS }, () => ({ hobkinNeeds: hobkins }))

  const status = reviews.status('change:shop:a1')
  const row = reviews.list().reviews.find((entry) => entry.id === 'change:shop:a1')

  const own = { ...engineNeeds({ needs: ENGINE_NEEDS })!, at: '2026-11-23T10:00:00.000Z' }
  assert.deepEqual(status.needs, [own, hobkins])
  assert.deepEqual(row?.needs, [own, hobkins])
})

test('a review whose change review gave no ratings is not rated, and says nothing made up', (t) => {
  const reviews = reviewed(t, { nodes: [] })

  assert.equal(reviews.status('change:shop:a1').needs, undefined)
})
