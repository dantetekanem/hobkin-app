import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workFrom } from '../src/work.ts'

const HEAD = `3f1a9c2${'0'.repeat(33)}`
const holds = { spec: 'specs/tla/WorkItem.tla', state: 'holds', run: 'run-main', line: 'TLC: 4 of 4 hold in 48,211 states · at 3f1a9c2' }
const broken = { spec: 'specs/tla/ReviewQueue.tla', state: 'broken', run: 'run-queue', why: 'NoLostReview', line: 'TLC: NoLostReview breaks in 4 steps · at 3f1a9c2' }
const score = (value: number, more: Record<string, unknown> = {}) => ({ score: value, evidence: 'What the review saw.', ...more })

/** A finished change as hobkin lists it (`readyRow` in its `src/cli/work/reads.mjs`), with what its review scored. */
const ready = (more: Record<string, unknown>) => ({
  slug: 'hobkin', project: 'hobkin', item: '4f2c', title: 'YOLO merges wait for a review at the final head', grade: 'P1', branch: 'hobkin/4f2c', head: HEAD,
  proof: 'pnpm test passes', behind: 0, conflict: false, size: { additions: 10, deletions: 2, files: 2 }, safety: null, gap: 'land', holds: 0, proved: true, ...more,
})
const reviewWith = (proof: ReturnType<typeof score>) => ({ kind: 'state-machine', rate: 9, scores: { coverage: score(9), proof, safety: score(9), visibility: score(8), rollback: score(9) }, floors: [] })

const workOf = (rows: Record<string, unknown>[], projects: Record<string, unknown>[] = []) =>
  workFrom({ work: { enabled: true, plan: [], projects }, waiting: { branches: rows } })!

test("a project's models on main and a change's models at its head reach the window as hobkin says them", () => {
  const work = workOf([ready({ models: [{ ...holds, changed: true }] })], [{ slug: 'hobkin', name: 'hobkin', state: 'chosen', models: [holds, broken] }])

  assert.deepEqual(work.projects[0]!.models, [holds, broken])
  assert.deepEqual(work.finished[0]!.changes[0]!.models, [{ ...holds, changed: true }])
})

test("a proof score hobkin's own model check wrote names its run, and one the review wrote names none", () => {
  const checked = ready({ review: reviewWith(score(10, { evidence: holds.line, by: 'hobkin', run: 'run-head' })) })
  const reviewed = ready({ item: '5e7c', review: reviewWith(score(8)) })

  const [mine, theirs] = workOf([checked, reviewed]).finished.flatMap(({ changes }) => changes)

  assert.deepEqual(mine!.proofCheck, { line: holds.line, run: 'run-head' })
  assert.equal(theirs!.proofCheck, null)
})

test('a hobkin from before models sends none, and the window gets none', () => {
  const work = workOf([ready({})], [{ slug: 'hobkin', state: 'chosen' }])

  assert.equal(work.projects[0]!.models, undefined)
  assert.equal(work.finished[0]!.changes[0]!.models, undefined)
  assert.equal(work.finished[0]!.changes[0]!.proofCheck, null)
})
