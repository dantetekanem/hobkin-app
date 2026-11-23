import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProofRunSummary, ProofsState } from '#shared/protocol/proofs.ts'
import type { ReviewFile, ReviewNode } from '#shared/review/types.ts'
import { useView } from '../src/app/view-store.ts'
import { changedModels, modelLines, modelOf, modelsIn, reviewedChange, reviewModelRows } from '../src/features/review/story/node-models.ts'

const HEAD = 'bad8d2aea42f86679d00392da7d81b6507b5734b'
const SPEC = '_specs/tla/ReviewSentReceipts.tla'
const change = { project: 'hobkin-client', item: '7fcf07', head: HEAD }

/** A run like the one hobkin recorded for item 7fcf07: ReviewSentReceipts holds in 7 states at the reviewed head. */
const run = (more: Partial<ProofRunSummary> = {}): ProofRunSummary => ({
  id: '20261121-032648-reviewsentreceipts-adug',
  project: 'hobkin-client',
  item: '7fcf07',
  spec: SPEC,
  head: HEAD,
  tool: 'TLC 1.7.4',
  workers: 9,
  started: '2026-11-21T03:26:48.757Z',
  finished: '2026-11-21T03:26:51.827Z',
  outcome: 'holds',
  steps: [
    { id: 'parse', state: 'done', note: 'SANY · no errors · 0.1 s' },
    { id: 'check', state: 'done', note: 'TLC · 7 states · no errors' },
    { id: 'prove', state: 'skipped', note: 'The spec has no proof' },
  ],
  stats: { generated: 17, distinct: 7, queue: 0, depth: 4 },
  rules: [{ name: 'NoRepost', kind: 'invariant', status: 'holds' }],
  actions: [
    { name: 'Post', count: 3 },
    { name: 'Save', count: 3 },
  ],
  ...more,
})
const slice = (...runs: ProofRunSummary[]): ProofsState => ({ runs })
const file = (path: string, status: ReviewFile['status'] = 'added'): ReviewFile => ({ id: path, path, status, binary: false, additions: 1, deletions: 0, summarized: false })
const node = (path: string): Pick<ReviewNode, 'anchors' | 'subtitle'> => ({ subtitle: path, anchors: [{ fileId: path, side: 'added', startLine: 1, endLine: 2, hash: 'x' }] })

test("a review's change is a hobkin change at the head it was reviewed at, and a pull request has none", () => {
  assert.deepEqual(reviewedChange({ id: 'change:hobkin-client:7fcf07', change: { head: HEAD } }), change)
  assert.equal(reviewedChange({ id: 'pr:hobkin-sample/storefront/482', change: { head: HEAD } }), null)
  assert.equal(reviewedChange({ id: 'sample', change: { head: HEAD } }), null)
})

test('a model is a .tla spec, or the spec a tla folder’s .cfg configures, and no other file', () => {
  assert.equal(modelOf(SPEC), SPEC)
  assert.equal(modelOf('_specs/tla/ReviewSentReceipts.cfg'), SPEC)
  // A model in an area folder under _specs/tla (050-tla-proofs) is one too, with its cfg beside it.
  assert.equal(modelOf('_specs/tla/review/ReviewSentReceipts.cfg'), '_specs/tla/review/ReviewSentReceipts.tla')
  assert.equal(modelOf('setup.cfg'), null)
  assert.equal(modelOf('config/app.cfg'), null)
  assert.equal(modelOf('host/src/review/reviews.ts'), null)
  assert.equal(modelOf(undefined), null)
  // A step on the spec and its cfg is about one model.
  assert.deepEqual(modelsIn([node('_specs/tla/ReviewSentReceipts.cfg'), node(SPEC), node('host/src/review/reviews.ts')], [file(SPEC), file('_specs/tla/ReviewSentReceipts.cfg')]), [SPEC])
  // The change's own models: what it adds or edits, never a file it only shows or deletes.
  assert.deepEqual(changedModels([file(SPEC), file('_specs/tla/ReviewSentReceipts.cfg'), file('_specs/tla/Old.tla', 'deleted'), file('_specs/tla/Seen.tla', 'unchanged')]), [SPEC])
})

test('a model node says what TLC said at the reviewed head, and opens that run', () => {
  assert.deepEqual(modelLines(slice(run()), change, [SPEC]), [{ spec: SPEC, run: '20261121-032648-reviewsentreceipts-adug', text: 'TLC: holds in 7 states', tone: 'ok' }])

  const broke = run({ id: 'broke', outcome: 'broken', broken: 'NoRepost', traceLength: 6, rules: [{ name: 'NoRepost', kind: 'invariant', status: 'broken' }] })
  assert.deepEqual(modelLines(slice(broke), change, [SPEC])[0], { spec: SPEC, run: 'broke', text: 'TLC: NoRepost breaks in 5 steps', tone: 'bad' })

  const checking = run({ id: 'checking', outcome: 'checking', started: '2026-11-21T04:00:00Z', stats: { generated: 30_000, distinct: 12_408, queue: 900, depth: 9 } })
  assert.deepEqual(modelLines(slice(checking, run()), change, [SPEC])[0], { spec: SPEC, run: 'checking', text: 'TLC: checking… 12,408 states', tone: 'live' })

  const missed = run({ id: 'missed', actions: [{ name: 'Post', count: 3 }, { name: 'Save', count: 0 }] })
  assert.deepEqual(modelLines(slice(missed), change, [SPEC])[0]?.text, 'TLC: holds, but Save never ran')
})

test('a check of another commit or item never speaks for the reviewed head', () => {
  const older = run({ id: 'older', head: '0d3c53d99913e333731649d0904f54309cdd6b04' })
  const elsewhere = run({ id: 'elsewhere', item: 'ffff' })
  assert.deepEqual(modelLines(slice(older, elsewhere), change, [SPEC]), [{ spec: SPEC, run: null, text: 'TLC: not checked at this commit', tone: 'warn' }])
  assert.deepEqual(modelLines(null, change, [SPEC])[0]?.text, 'TLC: not checked at this commit')
  // A short head is the same commit.
  assert.equal(modelLines(slice(run({ head: 'bad8d2a' })), change, [SPEC])[0]?.text, 'TLC: holds in 7 states')
})

test('two models in one focus each name their file', () => {
  const queue = '_specs/tla/ReviewQueue.tla'
  assert.deepEqual(modelLines(slice(run()), change, [SPEC, queue]).map(({ text }) => text), ['TLC · ReviewSentReceipts.tla: holds in 7 states', 'TLC · ReviewQueue.tla: not checked at this commit'])
})

test("the panel lists each of the change's models by file, with what TLC said at the reviewed head and the run that says so, in a steady order", () => {
  const row = (said: string, tone: string, run: string | null, spec = SPEC) => ({ spec, file: spec.split('/').at(-1), said, tone, run })
  assert.deepEqual(reviewModelRows(slice(run()), change, [SPEC]), [row('holds · 7 states', 'ok', '20261121-032648-reviewsentreceipts-adug')])
  // A model the change edits that nothing checked still has its row, so a check that starts takes its place.
  assert.deepEqual(reviewModelRows(slice(), change, [SPEC]), [row('not checked at this commit', 'warn', null)])
  assert.deepEqual(reviewModelRows(slice(run({ id: 'live', outcome: 'checking', stats: { generated: 9, distinct: 1204, queue: 2, depth: 2 } })), change, [SPEC]), [row('checking · 1,204 states', 'live', 'live')])
  const broke = run({ id: 'broke', outcome: 'broken', broken: 'NoRepost', traceLength: 6 })
  assert.deepEqual(reviewModelRows(slice(broke), change, [SPEC]), [row('NoRepost breaks · 5 steps', 'bad', 'broke')])
  assert.deepEqual(reviewModelRows(slice(run({ id: 'missed', actions: [{ name: 'Post', count: 3 }, { name: 'Save', count: 0 }] })), change, [SPEC]), [row('holds · Save never ran', 'warn', 'missed')])
  const proved = run({ id: 'proved', steps: [...run().steps.slice(0, 2), { id: 'prove', state: 'done', note: 'TLAPS · 12 of 12' }] })
  assert.deepEqual(reviewModelRows(slice(proved), change, [SPEC]), [row('holds · 7 states · proved for every size', 'ok', 'proved')])
  // A check of an older commit of the item still opens, and never says it speaks for this one.
  assert.deepEqual(reviewModelRows(slice(run({ id: 'older', head: '0d3c53d99913e333731649d0904f54309cdd6b04' })), change, [SPEC]), [row('checked at an older commit', 'quiet', 'older')])
  // A check of a model the change does not edit is the change's too. Models keep their order as runs come and go.
  const queue = '_specs/tla/ReviewQueue.tla'
  const other = run({ id: 'other', spec: queue, started: '2026-11-21T02:00:00Z' })
  assert.deepEqual(reviewModelRows(slice(other, run()), change, [SPEC]).map(({ file, said }) => `${file} ${said}`), ['ReviewQueue.tla holds · 7 states', 'ReviewSentReceipts.tla holds · 7 states'])
  assert.deepEqual(reviewModelRows(slice(other), change, [SPEC]).map(({ file, said }) => `${file} ${said}`), ['ReviewQueue.tla holds · 7 states', 'ReviewSentReceipts.tla not checked at this commit'])
  assert.deepEqual(reviewModelRows(slice(), change, []), [])
})

test("a run opened from a review goes back to that review", () => {
  useView.setState({ screen: 'review', openReview: 'change:hobkin-client:7fcf07', trail: [{ screen: 'work' }], settingsReturn: null, githubReturn: null, openAgent: null, previewReturn: null, openProof: null })
  useView.getState().openProofRun('20261121-032648-reviewsentreceipts-adug')
  assert.equal(useView.getState().screen, 'proof')
  useView.getState().closeProof()
  const { screen, openReview, trail } = useView.getState()
  assert.deepEqual([screen, openReview, trail.at(-1)?.screen], ['review', 'change:hobkin-client:7fcf07', 'work'])
})
