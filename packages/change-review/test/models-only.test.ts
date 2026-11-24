import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { deployAnswer } from '../src/answer.ts'
import { reviewChange } from '../src/pipeline.ts'
import type { ProofResult } from '../src/proof.ts'
import type { ScanOutcome } from '../src/scan.ts'
import { changesOnlyModels, isModelFile } from '../src/tla.ts'
import type { ModelCheck, ModelRunner, Scan } from '../src/types.ts'

export const SPEC = '_specs/tla/review/Review.tla'
export const CFG = '_specs/tla/review/Review.cfg'

test('a TLA+ model and the config beside it are model files; another .cfg is not', () => {
  const paths = [SPEC, CFG, 'setup.cfg', 'src/review.js']
  assert.deepEqual(paths.map((path) => isModelFile(path, paths)), [true, true, false, false])
  assert.equal(isModelFile('_specs/tla/review/Review.cfg', ['_specs/tla/review/Review.cfg']), true, 'a model config under a tla folder, its model unchanged')
  assert.equal(changesOnlyModels([SPEC, CFG]), true)
  assert.equal(changesOnlyModels([SPEC, 'src/review.js']), false)
  assert.equal(changesOnlyModels([]), false)
})

export const check = (more: Partial<ModelCheck> = {}): ModelCheck => ({
  spec: SPEC,
  run: '20261123-120000-review-ab12',
  result: 'holds',
  states: 9,
  rules: [{ name: 'SentOnlyWhenReady', kind: 'invariant', held: true }],
  unfired: [],
  models: ['src/review.js'],
  ...more,
})
export const violated = () => check({ result: 'violated', broken: 'SentOnlyWhenReady', steps: 3, rules: [{ name: 'SentOnlyWhenReady', kind: 'invariant', held: false }] })

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

/** A git repository whose base commit holds `before` and whose head commit holds `after` on top of it. */
export function repoOf(t: TestContext, before: Record<string, string>, after: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'change-review-models-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'shop')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
  const commit = (files: Record<string, string>, message: string) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(repo, path, '..'), { recursive: true })
      writeFileSync(join(repo, path), text)
    }
    git('add', '.')
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '--quiet', '--initial-branch=main')
  const base = commit(before, 'Start')
  return { repo, base, head: commit(after, 'Change'), out: join(root, 'out') }
}

/** A change whose whole diff is a TLA+ model of the review and its config. */
export function modelsOnly(t: TestContext) {
  const model = (body: string) => `---- MODULE Review ----\n\\* models: src/review.js\n${body}\n====\n`
  return repoOf(
    t,
    {
      'src/review.js': 'export function prepare(review) {\n  return { ...review, ready: true }\n}\n',
      [SPEC]: model("VARIABLE ready\nInit == ready = FALSE\nNext == ready' = TRUE"),
      [CFG]: 'INIT Init\nNEXT Next\n',
    },
    {
      [SPEC]: model("VARIABLES ready, sent\nInit == ready = FALSE /\\ sent = FALSE\nNext == ready' = TRUE /\\ sent' = ready\nSentOnlyWhenReady == sent => ready"),
      [CFG]: 'INIT Init\nNEXT Next\nINVARIANT SentOnlyWhenReady\n',
    },
  )
}

/** The scan as agentic-search gives it for these files: listed, with no parser for either. */
export const scanning = async (): Promise<ScanOutcome> => ({
  ok: true,
  scan: {
    anchors: [],
    nodes: {},
    edges: [],
    dangling: [],
    tests: [],
    files: [{ path: SPEC, kind: 'code', status: 'modified' }, { path: CFG, kind: 'code', status: 'modified' }],
    coverage: { truncated: false, truncatedBy: 'none', skippedAnchors: 0, unresolved: 0, notes: [] },
  } satisfies Scan,
})
export const noTests = async (): Promise<ProofResult> => ({ nodes: {}, runs: [], findings: [], clean: true })

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
