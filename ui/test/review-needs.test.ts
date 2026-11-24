import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChangeScores } from '#shared/protocol/work.ts'
import type { ReviewNeeds } from '#shared/review/needs.ts'
import { needNumbers, rateWords, ratingsOf, scoresLine, NO_MONITORING, QUESTIONS } from '../src/features/review/panel/needs.ts'

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

test('the scores are one line: the general rate first, then each question as a short word and its number, with its question and evidence as the tooltip', () => {
  const line = scoresLine({ yours: rated(), head: HEAD, underWay: false })

  assert.equal(line.state, 'rated')
  assert.equal(line.rate, '7.4')
  assert.deepEqual(line.items.map(({ word, value }) => [word, value]), [['Coverage', '8'], ['Proof', '4'], ['Safety', '7'], ['Visibility', '6'], ['Rollback', '9']])
  // Nothing is lost: each question and its line of evidence, as the engine wrote it, are the tooltip.
  assert.equal(line.items[1]!.tip, `${QUESTIONS.proof} ${rated().scores.proof!.evidence}`)
  assert.equal(line.holds, 'Held whatever the rate: proof is 4, needs 6.')
  assert.equal(line.tip, 'Bug fix · general rate 7.4\nStill missing: A request test that renders a post with tags in its text and in code.\nRated by this review at abc1234')
  assert.equal(line.quiet, null)
})

test('a pull request with no monitoring known has four numbers and a dash, no rate, and says why in the tooltips', () => {
  const line = scoresLine({ yours: withoutMonitoring(), head: HEAD, underWay: false })

  assert.equal(line.state, 'unwatched')
  assert.equal(line.rate, null)
  assert.deepEqual(line.items.map(({ value }) => value), ['8', '4', '7', '–', '9'])
  assert.equal(line.items[3]!.tip, `${QUESTIONS.visibility} ${NO_MONITORING}`)
  assert.match(line.tip, /no general rate without monitoring/)
})

test('with no ratings, one short quiet line says whether they are coming or why there are none, and nothing else', () => {
  const coming = scoresLine({ yours: null, head: HEAD, underWay: true })
  assert.deepEqual([coming.state, coming.quiet, coming.items], ['pending', 'Not rated yet: the review is being built.', []])

  const none = scoresLine({ yours: null, head: HEAD, underWay: false })
  assert.deepEqual([none.state, none.quiet, none.items], ['unrated', 'Not rated. Review again rates it.', []])
})

test('ratings made at an older commit than the review shows say so, in the host\'s words when it gives them', () => {
  const line = scoresLine({ yours: rated({ head: OLDER }), head: HEAD, underWay: false })
  assert.deepEqual([line.state, line.older], ['older', true])
  assert.match(line.tip, /Rated at b1d0b1d, an older commit than this review shows$/)

  const carried = scoresLine({ yours: rated({ head: OLDER, atOtherCommit: 'Rated at b1d0b1d, where this review was built, before it was carried to abc1234.' }), head: OLDER, underWay: false })
  assert.equal(carried.state, 'older', 'the host says they are of another commit, whatever the panel was given')
  assert.match(carried.tip, /before it was carried to abc1234\.$/)
})

test("hobkin's own run is no second block: it marks the numbers it scores more than a point apart, and is the line only when the review has none", () => {
  const near = rated({ by: 'hobkin', scores: { ...rated().scores, proof: { score: 5, evidence: 'Three tests prove it.' } } })
  assert.deepEqual(scoresLine({ yours: rated(), hobkins: near, head: HEAD, underWay: false }).items.map((item) => item.hobkin), [null, null, null, null, null])

  const far = rated({ by: 'hobkin', scores: { ...rated().scores, proof: { score: 8, evidence: 'The suite passes.' } } })
  const marked = scoresLine({ yours: rated(), hobkins: far, head: HEAD, underWay: false })
  assert.deepEqual(marked.items.map((item) => item.hobkin), [null, '8', null, null, null])
  assert.match(marked.items[1]!.tip, /hobkin's own run scored it 8\.$/)
  assert.equal(marked.by, 'review')

  const alone = scoresLine({ yours: null, hobkins: far, head: HEAD, underWay: false })
  assert.equal(alone.by, 'hobkin')
  assert.equal(alone.quiet, null)
  assert.match(alone.tip, /Rated by hobkin at abc1234$/)
})

test('visibility with no monitoring known reads as not known on a row', () => {
  const unknown = { ...withoutMonitoring(), monitoring: 'unknown' as const }
  assert.equal(needNumbers([unknown])!.numbers[3]!.value, 'not known')

  const dropped = { ...withoutMonitoring(), monitoring: 'given' as const }
  assert.equal(scoresLine({ yours: dropped, head: HEAD, underWay: false }).state, 'rated')
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

  assert.equal(rateWords([rated()]), 'Rate 7.4, rated by the review at abc1234')
  assert.equal(rateWords([withoutMonitoring()]), 'No general rate: monitoring is not known. Rated by the review at abc1234')
  assert.equal(rateWords([]), null)
})
