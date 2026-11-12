import assert from 'node:assert/strict'
import { test } from 'node:test'
import { staleAnchors, validateReview } from '#shared/review/validate.ts'
import { pullAssessment, pullFiles, pullReview } from '../src/features/review/sample/pull.ts'
import { isSamplePull, SAMPLE_PULL } from '../src/features/review/sample/pull-id.ts'

/**
 * Every anchor checked against its file's bytes, as the sample source opens it, and every rule of the validator. The
 * validator still asks every node to be the focus of a step and knows no `proves-change`: the host's story of units
 * (spec 032) teaches it both. Until it has, those are the only rules the sample may break.
 */
const PENDING = /is not the focus of any step\.$|: proves-change is not a status of a test\.$/
function open(id: string) {
  const review = pullReview(id)
  const files = new Map(pullFiles().map((file) => [file.fileId, file]))
  assert.deepEqual(staleAnchors(review, (fileId, side) => (side === 'added' ? files.get(fileId)?.head : files.get(fileId)?.base) ?? null), [])
  assert.deepEqual(validateReview(review).filter((problem) => !PENDING.test(problem)), [])
  return review
}

test('every sample pull request opens the sample pull request, under its own id', () => {
  assert.equal(open(SAMPLE_PULL).id, SAMPLE_PULL)
  assert.equal(open('pr:hobkin-sample/api/198').id, 'pr:hobkin-sample/api/198')
  for (const id of [SAMPLE_PULL, 'pr:hobkin-sample/api/1190', 'pr:hobkin-sample/docs/77']) assert.equal(isSamplePull(id), true, id)
  for (const id of ['sample', 'stress', 'pr:octo/storefront/482', 'pr:hobkin-sample/storefront/x', 'change:hobkin/7d02c9']) assert.equal(isSamplePull(id), false, id)
})

test('the sample is shaped like the pull request the user reviewed: one helper, eighteen tests, a script, the life cycle', () => {
  const review = open(SAMPLE_PULL)
  const nodeOf = new Map(review.nodes.map((node) => [node.id, node]))
  const titled = (title: string) => review.nodes.find((node) => node.title === title)!
  const exercising = (id: string) => review.edges.filter((edge) => edge.kind === 'exercises' && edge.to === id).map((edge) => edge.from)

  const helper = titled('link_user_tags')
  assert.deepEqual([helper.kind, helper.subtitle, helper.change], ['code', 'app/helpers/posts_helper.rb', 'modified'])
  const cases = review.nodes.filter((node) => node.kind === 'test' && !node.supports)
  assert.equal(cases.length, 18)
  assert.equal(exercising(helper.id).length, 5)
  const script = review.nodes.filter((node) => node.subtitle === 'script/production_errors.rb')
  assert.equal(script.flatMap((node) => exercising(node.id)).length, 13)
  // Real results, every kind of them, and each test says what it covers.
  assert.deepEqual([...new Set(cases.map((node) => node.status))].sort(), ['failed', 'not-run', 'passed', 'proves-change'])
  assert.equal(cases.filter((node) => node.status === 'proves-change' && exercising(helper.id).includes(node.id)).length, 3)
  for (const node of cases) assert.ok(node.summary.length > 20 && !/lines? (added|removed)/.test(node.summary), node.title)

  // The test helper names the tests it serves, which are tests of this review.
  const support = titled('stub_monitor')
  assert.ok(support.supports!.length > 0 && support.supports!.every((id) => nodeOf.get(id)?.kind === 'test'))

  // The README and the new script, and two nodes nothing wires, each with its reason.
  assert.equal(titled('README.md').kind, 'file')
  assert.ok(review.files.some((file) => file.path === 'script/production_errors.rb' && file.status === 'added'))
  const wired = new Set(review.edges.flatMap((edge) => [edge.from, edge.to]))
  const alone = review.nodes.filter((node) => node.unwired)
  assert.equal(alone.length, 2)
  for (const node of alone) assert.equal(wired.has(node.id), false, node.title)

  // Three to five callers and callees the change did not touch, for the life cycle.
  const around = review.nodes.filter((node) => node.change === 'unchanged')
  assert.ok(around.length >= 3 && around.length <= 5)
  assert.ok(around.every((node) => node.kind === 'context' && node.lifecycle))
  assert.ok(around.some((node) => node.lifecycle!.role === 'caller') && around.some((node) => node.lifecycle!.role === 'callee'))
})

test('its change review has four units: a high one with a question and a watch, a mid one and two safe ones', () => {
  const review = open(SAMPLE_PULL)
  const assessment = pullAssessment()
  const units = assessment.units!.units
  assert.deepEqual(units.map((unit) => unit.level).sort(), ['high', 'mid', 'safe', 'safe'])
  const high = units.find((unit) => unit.level === 'high')!
  assert.ok(high.questions.length > 0)
  assert.ok(typeof high.watch === 'object' && high.watch.gaps.length + high.watch.signals.length > 0)
  assert.ok(units.some((unit) => unit.members && unit.members.length > 1), 'one unit is grouped, with its members')
  assert.deepEqual([assessment.summary.level, assessment.summary.needsYou, assessment.summary.worthALook, assessment.summary.safe], ['high', 1, 1, 2])
  assert.equal(assessment.head, review.change.head)

  // The story the host tells: an opening, then a step for each unit in its story's order, with the unit's words and
  // level, focused on the nodes that hold its code. A test or the code around the change is never a step.
  const [opening, ...walks] = review.story
  assert.equal(opening!.kind, 'outcome')
  assert.deepEqual(walks.map((step) => step.unit), [...units].sort((a, b) => a.story_order - b.story_order).map((unit) => unit.id))
  for (const step of walks) {
    const unit = units.find((entry) => entry.id === step.unit)!
    assert.deepEqual([step.kind, step.title, step.text, step.level], ['walk', unit.title, unit.what, unit.level])
    assert.ok(step.focus.length >= 1 && step.focus.length <= 3)
    for (const id of step.focus) assert.equal(review.nodes.find((node) => node.id === id)?.unit, unit.id, `${step.id} focuses its unit's node`)
  }
})
