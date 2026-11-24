import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChangeScores } from '#shared/protocol/work.ts'
import type { ReviewNeeds } from '#shared/review/needs.ts'
import { hobkinView, needNumbers, questionsView, rateWords, ratingsOf, NO_MONITORING, QUESTIONS } from '../src/features/review/panel/needs.ts'

const HEAD = 'abc1234'.padEnd(40, 'f')
const OLDER = 'b1d0b1d'.padEnd(40, 'e')

/** A review's own ratings, as a host sends them on a status or a row. */
const rated = (over: Partial<ReviewNeeds> = {}): ReviewNeeds => ({
  kind: 'bug-fix',
  scores: {
    coverage: { score: 8, evidence: 'Five helper tests call link_user_tags, and three fail with it undone.' },
    proof: { score: 4, evidence: 'No request test renders a post. Capped at 4: no test of the change was added or changed for the controller.' },
    safety: { score: 7, evidence: 'Every post page renders through it; no data is written.' },
    visibility: { score: 6, evidence: 'Template errors reach the error tracker.' },
    rollback: { score: 9, evidence: 'One revert, no migration.' },
  },
  missing: 'A request test that renders a post with tags in its text and in code.',
  rate: 7.4,
  floors: [{ name: 'proof', score: 4, needs: 6 }],
  head: HEAD,
  by: 'change-review',
  ...over,
})

const withoutMonitoring = (): ReviewNeeds => {
  const { visibility: _visibility, ...scores } = rated().scores
  const { rate: _rate, ...rest } = rated({ scores })
  return rest
}

test('every review opens with the five ratings in the user\'s order, their evidence, the kind, the rate and what is missing', () => {
  const view = questionsView({ yours: rated(), head: HEAD, underWay: false })

  assert.equal(view.state, 'rated')
  assert.deepEqual(view.rows.map((row) => row.question), Object.values(QUESTIONS))
  assert.deepEqual(view.rows.map((row) => row.number), ['8', '4', '7', '6', '9'])
  // A rating the facts capped says so in its evidence, as the engine wrote it.
  assert.equal(view.rows[1]!.evidence, rated().scores.proof!.evidence)
  assert.equal(view.lead, 'Bug fix · general rate 7.4')
  assert.equal(view.floors, 'Held whatever the rate: proof is 4, needs 6.')
  assert.equal(view.note, 'Still missing: A request test that renders a post with tags in its text and in code.')
  assert.equal(view.by, 'Rated by this review at abc1234')
})

test('a pull request with no monitoring known shows four numbers, says monitoring is not known, and has no general rate', () => {
  const view = questionsView({ yours: withoutMonitoring(), head: HEAD, underWay: false })

  assert.equal(view.state, 'unwatched')
  assert.deepEqual(view.rows.map((row) => row.number), ['8', '4', '7', '–', '9'])
  assert.equal(view.rows[3]!.evidence, NO_MONITORING)
  assert.equal(view.lead, 'Bug fix · no general rate without monitoring')
})

test('with no ratings, the part says whether they are coming or why there are none, in the same rows', () => {
  const coming = questionsView({ yours: null, head: HEAD, underWay: true })
  assert.equal(coming.state, 'pending')
  assert.equal(coming.lead, 'Not rated yet: the review is being built.')
  assert.equal(coming.note, 'Its ratings come with its answer.')

  const none = questionsView({ yours: null, head: HEAD, underWay: false })
  assert.equal(none.state, 'unrated')
  assert.equal(none.lead, 'Not rated. Review again rates it.')
  assert.equal(none.note, 'This review is older than the ratings, or its answer gave none.')

  for (const view of [coming, none]) {
    assert.equal(view.rows.length, 5, 'every row keeps its place')
    assert.ok(view.rows.every((row) => row.number === '–' && row.evidence === ''))
    assert.equal(view.by, null)
  }
})

test('ratings made at an older commit than the review shows say so', () => {
  const view = questionsView({ yours: rated({ head: OLDER }), head: HEAD, underWay: false })
  assert.equal(view.state, 'older')
  assert.deepEqual(view.rows.map((row) => row.number), ['8', '4', '7', '6', '9'])
  assert.equal(view.by, 'Rated at b1d0b1d, an older commit than this review shows')
  // The host's own words win when it says where they were made, as for a carried review.
  const carried = questionsView({ yours: rated({ head: OLDER, atOtherCommit: 'Rated at b1d0b1d, where this review was built, before it was carried to abc1234.' }), head: OLDER, underWay: false })
  assert.equal(carried.state, 'older', 'the host says they are of another commit, whatever the panel was given')
  assert.equal(carried.by, 'Rated at b1d0b1d, where this review was built, before it was carried to abc1234.')
})

test('visibility with no monitoring known reads as not known, and one the review dropped with monitoring known as no answer', () => {
  const unknown = { ...withoutMonitoring(), monitoring: 'unknown' as const }
  assert.equal(questionsView({ yours: unknown, head: HEAD, underWay: false }).rows[3]!.evidence, NO_MONITORING)
  assert.equal(needNumbers([unknown])!.numbers[3]!.value, 'not known')

  const dropped = { ...withoutMonitoring(), monitoring: 'given' as const }
  const view = questionsView({ yours: dropped, head: HEAD, underWay: false })
  assert.equal(view.state, 'rated')
  assert.deepEqual([view.rows[3]!.number, view.rows[3]!.evidence], ['–', ''])
  assert.equal(needNumbers([dropped])!.numbers[3]!.value, '–')
})

test("a status's ratings are read without trust: the review's own at its commit, and hobkin's own, from its scores when it sends no ratings", () => {
  const hobkin: ChangeScores = {
    kind: 'Bug fix',
    rate: 8.1,
    scores: [
      { name: 'coverage', score: 8, evidence: 'Tests reach it.' },
      { name: 'proof', score: 5, evidence: 'Three tests prove it.' },
      { name: 'deploy and data', score: 7, evidence: 'Nothing is written.' },
      { name: 'visibility', score: null, evidence: '' },
      { name: 'rollback', score: 9, evidence: 'One revert.' },
    ],
    floors: [],
    stale: false,
  }
  const status = { needs: [rated({ head: OLDER, rate: 5 }), rated(), { by: 'nobody' }, 'nonsense'], scores: hobkin }

  const { yours, hobkins } = ratingsOf(status, HEAD)
  assert.equal(yours?.head, HEAD, 'the ratings made at the commit shown')
  assert.equal(hobkins?.rate, 8.1)
  assert.deepEqual(Object.keys(hobkins!.scores), ['coverage', 'proof', 'safety', 'rollback'])

  assert.deepEqual(ratingsOf(null, HEAD), { yours: null, hobkins: null })
  assert.deepEqual(ratingsOf({ needs: 'not a list' }, HEAD), { yours: null, hobkins: null })
})

test("hobkin's own scores fold when they agree with the review's within a point, and open with each difference marked when they do not", () => {
  const near = rated({ by: 'hobkin', rate: 7.9, scores: { ...rated().scores, proof: { score: 5, evidence: 'Three tests prove it.' } } })
  const agrees = hobkinView(rated(), near)
  assert.equal(agrees.state, 'agrees')
  assert.equal(agrees.lead, 'Bug fix, general rate 7.9')

  const far = rated({ by: 'hobkin', scores: { ...rated().scores, proof: { score: 8, evidence: 'The suite passes.' } } })
  const differs = hobkinView(rated(), far)
  assert.equal(differs.state, 'differs')
  assert.deepEqual(differs.rows.map((row) => row.differs), [null, '4 in this review', null, null, null])

  assert.equal(hobkinView(null, far).state, 'alone')
  assert.equal(hobkinView(rated(), null).state, 'none')
  assert.doesNotMatch(hobkinView(rated(), null).lead, /Work card/, 'no button that no longer scores is named')
})

test('a row and the YOLO mode page read the ratings in a few words', () => {
  assert.deepEqual(
    needNumbers([rated()]),
    {
      numbers: [
        { name: 'coverage', word: 'Cover', value: '8' },
        { name: 'proof', word: 'Proof', value: '4' },
        { name: 'safety', word: 'Deploy', value: '7' },
        { name: 'visibility', word: 'Watch', value: '6' },
        { name: 'rollback', word: 'Undo', value: '9' },
      ],
      rate: '7.4',
      at: 'abc1234',
      other: null,
    },
  )
  // Numbers made at another commit than the row's never read as current.
  assert.equal(needNumbers([rated({ head: OLDER })], HEAD)!.other, 'Rated at b1d0b1d, an older commit than the change is at now')
  assert.equal(needNumbers([rated({ atOtherCommit: 'Rated at abc1234; the change is at b1d0b1d now.' })], HEAD)!.other, 'Rated at abc1234; the change is at b1d0b1d now.')
  assert.equal(needNumbers([withoutMonitoring()])!.numbers[3]!.value, 'not known')
  assert.equal(needNumbers([withoutMonitoring()])!.rate, null)
  assert.equal(needNumbers([rated({ by: 'hobkin' })]), null, "hobkin's own scores are not the review's")
  assert.equal(needNumbers(undefined), null)

  assert.equal(rateWords([rated()]), 'Rate 7.4, rated by the AI review at abc1234')
  assert.equal(rateWords([withoutMonitoring()]), 'No general rate: monitoring is not known. Rated by the AI review at abc1234')
  assert.equal(rateWords([]), null)
})
