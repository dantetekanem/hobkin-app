import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openReview } from '#shared/review/validate.ts'
import { pullAssessment, pullFiles, pullReview } from '../src/features/review/sample/pull.ts'
import { isSamplePull, SAMPLE_PULL } from '../src/features/review/sample/pull-id.ts'

/** Opened the way the sample source opens it: held to every rule of the validator, and every anchor to its file's bytes. */
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

test('the sample is shaped like the pull request the user reviewed: one helper, twenty tests, a script, the life cycle', () => {
  const review = open(SAMPLE_PULL)
  const nodeOf = new Map(review.nodes.map((node) => [node.id, node]))
  const titled = (title: string) => review.nodes.find((node) => node.title === title)!
  const exercising = (id: string) => review.edges.filter((edge) => edge.kind === 'exercises' && edge.to === id).map((edge) => edge.from)

  const helper = titled('link_user_tags')
  assert.deepEqual([helper.kind, helper.subtitle, helper.change], ['code', 'app/helpers/posts_helper.rb', 'modified'])
  const cases = review.nodes.filter((node) => node.kind === 'test' && !node.supports)
  assert.equal(cases.length, 20)
  assert.equal(exercising(helper.id).length, 6)
  // One test of the helper was there before the change and still runs, wired to it; one the change removed, which only
  // says what it covered.
  const kept = titled('links a tag at the start of a paragraph')
  const gone = titled('looks each tag up by its handle')
  assert.deepEqual([kept.change, kept.status, kept.covers, exercising(helper.id).includes(kept.id)], ['unchanged', 'passed', [helper.id], true])
  assert.deepEqual([gone.change, gone.covers, exercising(helper.id).includes(gone.id)], ['deleted', [helper.id], false])
  assert.ok(gone.anchors.every((anchor) => anchor.side === 'deleted'))
  // The helper's way in, as the host names it, and why the script has none.
  assert.deepEqual(helper.lifecycle?.origin?.chain.map((id) => nodeOf.get(id)!.title), ['GET /posts/:id', 'PostsController#show', 'render_body'])
  assert.equal(titled('fetch_errors').lifecycle?.none, 'no-callers')
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

  // Three to five callers and callees the change did not touch, for the life cycle, and where requests enter: two
  // routes, and the app's answer to a failing request.
  const around = review.nodes.filter((node) => node.kind === 'context')
  const entries = around.filter((node) => node.entry && node.entry.kind !== 'controller')
  assert.deepEqual(entries.map((node) => [node.entry!.kind, node.title]), [['route', 'GET /posts/:id'], ['route', 'GET /feed'], ['exceptions-app', 'config.exceptions_app']])
  const code = around.filter((node) => !entries.includes(node))
  assert.ok(code.length >= 3 && code.length <= 5)
  assert.ok(around.every((node) => node.kind === 'context' && node.lifecycle))
  assert.ok(code.some((node) => node.lifecycle!.role === 'caller') && code.some((node) => node.lifecycle!.role === 'callee'))
  // Each leads to the controller it hands requests to.
  for (const entry of entries) assert.ok(review.edges.some((edge) => edge.kind === 'called-by' && edge.to === entry.id && review.nodes.find((node) => node.id === edge.from)?.entry?.kind === 'controller'), entry.title)
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
