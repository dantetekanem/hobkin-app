import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { ProofRunSummary, ProofsState } from '#shared/protocol/proofs.ts'
import type { Review } from '#shared/review/types.ts'
import { layoutOf } from '../src/features/proofs/proof-layout.ts'
import { escapeReview } from '../src/features/review/entry.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { firstToLook, GRAPH_KEEPS, onProofKey, pressProof, PROOF_TABS, proofRoom, proofSiblings } from '../src/features/review/proof/beside.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'
import { reviewModelRows } from '../src/features/review/story/node-models.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const HEAD = 'bad8d2aea42f86679d00392da7d81b6507b5734b'
const change = { project: 'hobkin-client', item: '7fcf07', head: HEAD }

/** A run of one of the change's models at the reviewed head: it holds unless told otherwise. */
const run = (id: string, spec: string, more: Partial<ProofRunSummary> = {}): ProofRunSummary => ({
  id,
  project: 'hobkin-client',
  item: '7fcf07',
  spec: `_specs/tla/${spec}.tla`,
  head: HEAD,
  tool: 'TLC 1.7.4',
  workers: 9,
  started: '2026-11-21T03:26:48.757Z',
  finished: '2026-11-21T03:26:51.827Z',
  outcome: 'holds',
  steps: [
    { id: 'parse', state: 'done', note: 'SANY · no errors' },
    { id: 'check', state: 'done', note: 'TLC · 7 states' },
    { id: 'prove', state: 'skipped', note: 'The spec has no proof' },
  ],
  stats: { generated: 17, distinct: 7, queue: 0, depth: 4 },
  rules: [{ name: 'NoRepost', kind: 'invariant', status: 'holds' }],
  actions: [{ name: 'Post', count: 3 }],
  ...more,
})
const slice = (...runs: ProofRunSummary[]): ProofsState => ({ runs })
const broken = (id: string, spec: string) => run(id, spec, { outcome: 'broken', broken: 'NoRepost', traceLength: 4 })
const rowsOf = (...runs: ProofRunSummary[]) => reviewModelRows(slice(...runs), change, ['_specs/tla/Unchecked.tla'])

test("T opens the change's first model that needs a look: one that breaks before one that holds, each in the order the review lists them", () => {
  // The review lists models by file: Alpha holds, Beta breaks, Gamma checks, Unchecked has no run.
  const rows = rowsOf(run('alpha', 'Alpha'), broken('beta', 'Beta'), run('gamma', 'Gamma', { outcome: 'checking' }))
  assert.deepEqual(rows.map((row) => row.file), ['Alpha.tla', 'Beta.tla', 'Gamma.tla', 'Unchecked.tla'])
  assert.equal(firstToLook(rows), 'beta')
  // Two that break: the first the review lists.
  assert.equal(firstToLook(rowsOf(run('alpha', 'Alpha'), broken('beta', 'Beta'), broken('delta', 'Delta'))), 'beta')
  // One still checking comes before one that holds; one that holds with a part that never ran before one that holds whole.
  assert.equal(firstToLook(rowsOf(run('alpha', 'Alpha'), run('gamma', 'Gamma', { outcome: 'checking' }))), 'gamma')
  assert.equal(firstToLook(rowsOf(run('alpha', 'Alpha'), run('beta', 'Beta', { actions: [{ name: 'Post', count: 0 }] }))), 'beta')
  // All hold: the first. Nothing checked: nothing to open.
  assert.equal(firstToLook(rowsOf(run('alpha', 'Alpha'), run('beta', 'Beta'))), 'alpha')
  assert.equal(firstToLook(rowsOf()), null)
})

test("the proof's siblings are the change's model checks and proofs in the order the review lists them, and a model nothing checked has none", () => {
  const rows = rowsOf(broken('beta', 'Beta'), run('alpha', 'Alpha'), run('gamma', 'Gamma', { outcome: 'checking' }))
  assert.deepEqual(proofSiblings(rows), ['alpha', 'beta', 'gamma'])
  assert.deepEqual(proofSiblings(rowsOf()), [])
})

test('T opens the proof beside the review and T or Escape closes it, with the review at the same step, focus, mode and history underneath', () => {
  const session = createSession(sample, createReviewMemory())
  session.getState().step(1)
  session.getState().step(1)
  session.getState().historyBack()
  const before = session.getState()
  const rows = rowsOf(run('alpha', 'Alpha'), broken('beta', 'Beta'))
  const expanded: (string | null)[] = []
  const t = (shift = false) =>
    pressKey(session.getState(), { key: shift ? 'T' : 't', shift, alt: false }, {
      panelKey: () => false,
      toggleSteps: () => {},
      verdict: () => {},
      proofKey: (shifted) => pressProof(session.getState(), rows, shifted, 'row:beta', (id) => expanded.push(id)),
    })
  const same = () => {
    const now = session.getState()
    assert.equal(now.story, before.story, 'the same step')
    assert.equal(now.focus, before.focus, 'the same focus')
    assert.equal(now.mode, before.mode)
    assert.equal(now.history, before.history, 'the same history')
    assert.equal(now.move, before.move, 'nothing moved the camera')
  }

  assert.equal(t(), true)
  assert.deepEqual(session.getState().proof, { run: 'beta', from: 'row:beta' })
  same()
  assert.equal(t(), true)
  assert.equal(session.getState().proof, null, 'T again closes it')
  same()

  t()
  escapeReview(session.getState(), () => assert.fail('Escape closes the proof, not the review'))
  assert.equal(session.getState().proof, null, 'Escape closes it too')
  same()

  // Shift+T opens the full page: the first model that needs a look while it is closed, the one it shows while it is open.
  t(true)
  t()
  t(true)
  assert.deepEqual(expanded, ['beta', null])
})

test('T says so when the change has no model check to open, and opens nothing', () => {
  const session = createSession(sample, createReviewMemory())
  assert.deepEqual(onProofKey(null, [], false), { do: 'say', text: 'This change has no TLA+ models.' })
  pressProof(session.getState(), rowsOf(), false, null, () => assert.fail())
  assert.equal(session.getState().proof, null)
  assert.equal(session.getState().notice?.text, 'No model of this change was checked yet.')
})

test('a proof open beside a review is kept with its place, so coming back from its page opens it again on the same run', () => {
  const memory = createReviewMemory()
  const first = createSession(sample, memory)
  first.getState().step(1)
  first.getState().openProof('beta', 'row:beta')
  const back = createSession(sample, memory, first.getState().placeNow()).getState()
  assert.equal(back.proof?.run, 'beta')
  assert.equal(back.story.step, 1)
  // A place kept before the proof could sit beside the review has none.
  const { proof: _proof, ...older } = first.getState().placeNow()
  assert.equal(createSession(sample, memory, older).getState().proof, null)
})

test("the proof sits beside the graph at a width set by the room alone, check and proof side by side from a wide window, and covers the graph, never the review's panel, when there is no room for both", () => {
  // Room is what the review's panel and the outline leave at the right.
  const wide = proofRoom(2000)
  assert.equal(wide.covers, false)
  assert.equal(layoutOf(wide.width - 60), 'side', 'its box has room for the check and the proof together')
  assert.ok(2000 - wide.width >= GRAPH_KEEPS, 'and the graph keeps room beside it')
  assert.equal(proofRoom(3000).width, wide.width, 'and no wider than that')

  // Narrower, the proof takes all but what the graph keeps, as tabs.
  assert.deepEqual(proofRoom(1200), { width: 1200 - GRAPH_KEEPS, covers: false })
  assert.equal(layoutOf(1200 - GRAPH_KEEPS - 40), 'tabs')
  assert.deepEqual(proofRoom(PROOF_TABS + GRAPH_KEEPS), { width: PROOF_TABS, covers: false })
  // Too narrow for both: it takes all the room the review's panel leaves, and no more.
  assert.deepEqual(proofRoom(800), { width: 800, covers: true })
  // The same room always gives the same width, so nothing moves while its code loads.
  assert.deepEqual(proofRoom(1200), proofRoom(1200))
})
