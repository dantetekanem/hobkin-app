import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arrange } from '../src/features/review/graph/arrange.ts'
import { pullAssessment, pullReview } from '../src/features/review/sample/pull.ts'
import { proofWords, testsOf, testsWords, watchWords } from '../src/features/review/story/words.ts'

const pull = pullReview('pr:hobkin-sample/storefront/482')
const shape = arrange(pull)
const nodeOf = new Map([...shape.hidden, ...shape.nodes].map((node) => [node.id, node]))
const units = pullAssessment().units!.units
const idOf = (title: string) => pull.nodes.find((node) => node.title === title)!.id

test("a unit's card says how its tests went, however they are folded", () => {
  const helper = testsOf([idOf('link_user_tags')], shape.covers, nodeOf)!
  assert.deepEqual([helper.total, helper.ran, helper.failed, helper.notRun, helper.proves], [5, 5, 0, 0, 3])
  assert.equal(testsWords(helper), '5 of 5 tests ran; 3 prove the change.')

  const fetch = testsOf([idOf('fetch_errors')], shape.covers, nodeOf)!
  assert.deepEqual(fetch.failing, ['tries once more when the monitor times out'])
  assert.equal(testsWords(fetch), '6 of 6 tests ran, 1 failed.')
  assert.equal(testsWords(testsOf([idOf('report')], shape.covers, nodeOf)!), '6 of 7 tests ran, 1 not run.')
  // Nothing covers the README.
  assert.equal(testsOf([idOf('README.md')], shape.covers, nodeOf), null)
})

test('what to watch is said for a unit that needs a look, and only for one', () => {
  const high = units.find((unit) => unit.level === 'high')!
  const watch = high.watch === 'not assessed' ? null : high.watch
  const lines = watchWords(high)
  // Each signal, each gap nothing watches, and the way back.
  assert.equal(lines.length, watch!.signals.length + watch!.gaps.length + 1)
  assert.ok(lines[0]!.includes(watch!.signals[0]!.name) && lines[0]!.includes(watch!.signals[0]!.at))
  for (const unit of units.filter((entry) => entry.level === 'safe')) assert.deepEqual(watchWords(unit), [])
  // A fact says what it means and the evidence for it.
  assert.ok(proofWords(high.facts).includes(high.facts.proof.evidence))
})
