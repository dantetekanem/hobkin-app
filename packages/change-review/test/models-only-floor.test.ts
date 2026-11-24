import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { floor } from '../src/floor.ts'
import { reviewChange } from '../src/pipeline.ts'
import type { FloorInput, ModelCheck } from '../src/types.ts'
import { CFG, check, modelsOnly, noTests, scanning, SPEC, violated } from './models-fixtures.ts'

const facts = (more: Partial<FloorInput>): FloorInput => ({ effect: 'behaviour', proof: 'not-applicable', exposure: 'everyone', undo: 'rollback', runsInRequest: false, ...more })

test('a TLA+ model is never high or critical: its check holds, fails and must pass, or was not run and needs to pass', () => {
  const holds = floor(facts({ model: { result: 'holds', said: 'TLC checked Review.tla at this commit: it holds in 9 states' } }))
  assert.deepEqual([holds.level, holds.rule, holds.critical], ['safe', 2, false])

  const broke = floor(facts({ model: { result: 'violated', said: 'TLC checked Review.tla at this commit: SentOnlyWhenReady breaks in 3 steps' } }))
  assert.deepEqual([broke.level, broke.critical], ['mid', false])
  assert.deepEqual(broke.finding, {
    rule: 'model-check-fails',
    text: 'its model check fails (TLC checked Review.tla at this commit: SentOnlyWhenReady breaks in 3 steps): fix the model or the code it models before merging',
    by: 'floor',
  })

  const unchecked = floor(facts({ model: { result: 'unchecked', said: 'Its model check was not run at this commit, and it needs to pass' } }))
  assert.deepEqual([unchecked.level, unchecked.critical, unchecked.why], ['mid', false, 'Its model check was not run at this commit, and it needs to pass.'])
  assert.equal(unchecked.finding?.rule, 'model-check-not-run')

  // What would be high for code is not for a model: nothing undoes it, yet nothing of it runs.
  const undone = floor(facts({ undo: 'none', model: { result: 'error', said: 'TLC could not check Review.tla at this commit' } }))
  assert.deepEqual([undone.level, undone.critical, undone.finding?.rule], ['mid', false, 'model-check-not-run'])
})

const levels = async (t: TestContext, checks: ModelCheck[] | undefined) => {
  const { repo, base, head, out } = modelsOnly(t)
  const result = await reviewChange({ cwd: repo, base, head, out, scan: scanning, proof: noTests, ...(checks ? { modelChecks: checks } : {}) })
  const parts = [SPEC, CFG].map((path) => result.graph.nodes.find((node) => node.path === path)!)
  return { result, parts }
}

test('a change of only a model and its config, reviewed four ways, is never high, critical or risky', async (t) => {
  const none = await levels(t, undefined)
  assert.deepEqual(none.parts.map((part) => [part.level?.current, part.critical, part.extras.model?.result]), [['mid', false, 'unchecked'], ['mid', false, 'unchecked']])
  assert.ok(none.parts.every((part) => part.findings.some((finding) => finding.rule === 'model-check-not-run')))
  assert.match(none.result.units.units[0]!.title, /its model check was not run at this commit/)

  const held = await levels(t, [check()])
  assert.deepEqual(held.parts.map((part) => part.level?.current), ['safe', 'safe'])

  const broke = await levels(t, [violated()])
  assert.deepEqual(broke.parts.map((part) => [part.level?.current, part.critical]), [['mid', false], ['mid', false]])
  assert.ok(broke.parts.every((part) => part.findings.some((finding) => finding.rule === 'model-check-fails' && /SentOnlyWhenReady breaks in 3 steps/.test(finding.text))))

  const unrun = await levels(t, [check({ result: 'error', states: 0, message: 'TLC did not start' })])
  assert.deepEqual(unrun.parts.map((part) => [part.level?.current, part.critical]), [['mid', false], ['mid', false]])

  for (const { result } of [none, held, broke, unrun]) {
    assert.equal(result.answer.deploy, 'safe')
    assert.ok(result.units.units.every((unit) => unit.level !== 'high' && !unit.critical))
  }
})
