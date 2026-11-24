import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deployAnswer } from '../src/answer.ts'
import { reviewChange } from '../src/pipeline.ts'
import { changesOnlyModels, isModelFile } from '../src/tla.ts'
import type { ModelRunner } from '../src/types.ts'
import { CFG, check, modelsOnly, noTests, scanning, SPEC, violated } from './models-fixtures.ts'

test('a TLA+ model and the config beside it are model files; another .cfg is not', () => {
  const paths = [SPEC, CFG, 'setup.cfg', 'src/review.js']
  assert.deepEqual(paths.map((path) => isModelFile(path, paths)), [true, true, false, false])
  assert.equal(isModelFile('_specs/tla/review/Review.cfg', ['_specs/tla/review/Review.cfg']), true, 'a model config under a tla folder, its model unchanged')
  assert.equal(changesOnlyModels([SPEC, CFG]), true)
  assert.equal(changesOnlyModels([SPEC, 'src/review.js']), false)
  assert.equal(changesOnlyModels([]), false)
})

test('a change of only models is never risky to deploy: its answer says whether the checks hold, fail or were not run', () => {
  const high = [{ level: 'high' as const, title: '`Review.tla` changed', critical: true, nodes: ['d1'] }]
  const only = { models: [SPEC, CFG] }
  assert.deepEqual(deployAnswer(high, 'Risky to deploy: it breaks.', [violated()], only), {
    deploy: 'safe',
    why: 'It changes only TLA+ models, and nothing of it runs in production. The model check of Review.tla fails: SentOnlyWhenReady breaks in 3 steps. It must pass before merging.',
  })
  assert.deepEqual(deployAnswer([], undefined, [check()], only), { deploy: 'safe', why: 'It changes only TLA+ models, and nothing of it runs in production. The model check of Review.tla holds in 9 states at this commit.' })
  assert.deepEqual(deployAnswer([], undefined, [], only), {
    deploy: 'safe',
    why: 'It changes only TLA+ models, and nothing of it runs in production. The model check of Review.tla was not run at this commit, and it needs to pass.',
  })
  assert.deepEqual(deployAnswer([], undefined, [check({ result: 'error', states: 0 })], only).why, 'It changes only TLA+ models, and nothing of it runs in production. The model check of Review.tla could not finish at this commit, and it needs to pass.')
})

test('a Reviewer that marks a model high or critical is refused, with a line in the problems, and the model keeps its level', async (t) => {
  const { repo, base, head, out } = modelsOnly(t)
  const plain = await reviewChange({ cwd: repo, base, head, out: `${out}-plain`, scan: scanning, proof: noTests })
  const model: ModelRunner = async ({ pass, prompt }) => {
    if (pass !== 'review') return null
    const data = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)) as { nodes: { id: string; path: string }[] }
    const spec = data.nodes.find((node) => node.path === SPEC)!
    return JSON.stringify({ events: [{ node: spec.id, level: 'high', critical: true, direction: 'up', aspect: 'behaviour', evidence: 'The model now lets a review be sent before it is ready.' }], claims: [] })
  }
  const result = await reviewChange({ cwd: repo, base, head, out, scan: scanning, proof: noTests, model })
  const spec = result.graph.nodes.find((node) => node.path === SPEC)!
  assert.deepEqual([spec.level?.current, spec.critical], [plain.graph.nodes.find((node) => node.path === SPEC)!.level?.current, false])
  assert.ok(
    result.problems.includes(`From the Reviewer: events[0] on ${spec.id} was refused: ${SPEC} is a TLA+ model, which nothing runs in production, so it is never high or critical.`),
    result.problems.join('\n'),
  )
  assert.equal(result.answer.deploy, 'safe')
  assert.match(result.answer.why, /^It changes only TLA\+ models, and nothing of it runs in production\. The model check of Review\.tla was not run at this commit, and it needs to pass\.$/)
})

test('a model read from its diff says what it is: a specification TLC checks, which nothing calls', async (t) => {
  const { repo, base, head, out } = modelsOnly(t)
  const result = await reviewChange({ cwd: repo, base, head, out, scan: scanning, proof: noTests })
  for (const path of [SPEC, CFG]) {
    const part = result.graph.nodes.find((node) => node.path === path)!
    assert.deepEqual(part.facts.proof, { value: 'not-applicable', evidence: 'a TLA+ model: TLC checks it, not a test' }, path)
    assert.deepEqual(part.runs_from, { found: 'not-looked', why: 'A TLA+ model: nothing of it runs in production, so nothing calls it.' }, path)
    assert.equal(part.extras.runsInRequest, false, path)
  }
  assert.ok(!result.problems.some((problem) => problem.startsWith('Read from the diff alone')), result.problems.join('\n'))
})
