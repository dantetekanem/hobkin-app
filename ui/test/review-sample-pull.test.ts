import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openReview } from '#shared/review/validate.ts'
import { pullAssessment, pullFiles, pullReview } from '../src/features/review/sample/pull.ts'
import { isSamplePull, SAMPLE_PULL } from '../src/features/review/sample/pull-id.ts'

/** Opened the way the sample source opens it: checked by the validator, and every anchor against its file's bytes. */
function open(id: string) {
  const files = new Map(pullFiles().map((file) => [file.fileId, file]))
  return openReview(pullReview(id), (fileId, side) => (side === 'added' ? files.get(fileId)?.head : files.get(fileId)?.base) ?? null)
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
  assert.deepEqual([...new Set(cases.map((node) => node.status))].sort(), ['failed', 'not-run', 'passed'])
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

  // Each unit is told by a step, and its node carries its level.
  for (const unit of units) {
    const step = review.story.find((entry) => entry.unit === unit.id)
    assert.ok(step, `a step tells ${unit.id}`)
    assert.ok(step.focus.some((id) => review.nodes.find((node) => node.id === id)?.unit === unit.id), `${unit.id}'s step focuses its node`)
    assert.equal(step.level, unit.level)
  }
})
