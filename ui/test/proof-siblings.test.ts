import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { ProofRunSummary } from '#shared/protocol/proofs.ts'
import { useView } from '../src/app/view-store.ts'
import { keptOf, useProofMemory } from '../src/features/proofs/kept.ts'
import { chipsOf } from '../src/features/proofs/proof-match.ts'
import { sampleRun, sampleSummary, type SamplePhase } from '../src/features/proofs/sample.ts'
import { chipRuns, positionWords, siblingAt, siblingsOf } from '../src/features/proofs/siblings.ts'

// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
const { openRunAmong } = await import('../src/features/proofs/open-run.ts')

const STARTED = Date.parse('2026-11-20T14:05:00Z')
const summary = (phase: SamplePhase, change: Partial<ProofRunSummary> = {}, minutes = 0): ProofRunSummary => ({ ...sampleSummary(sampleRun(phase, STARTED + minutes * 60_000)), ...change })

test('a run knows its siblings: the ones its opener named, in its order, or else the newest run of each model of its change', () => {
  const named = ['queue', 'item', 'review']
  assert.deepEqual(siblingsOf('item', named, []), named)

  // Opened by something that named no siblings: the newest run of each spec of the same item at the same head, by spec.
  const head = '9b04e1d'
  const runs = [
    summary('holds', { id: 'review-new', spec: '_specs/tla/Review.tla', head }, 9),
    summary('broken', { id: 'item', spec: '_specs/tla/WorkItem.tla', head }, 5),
    summary('holds', { id: 'review-old', spec: '_specs/tla/Review.tla', head }, 1),
    summary('holds', { id: 'queue', spec: '_specs/tla/Queue.tla', head }, 2),
    summary('holds', { id: 'elsewhere', item: 'ffff', head }, 3),
    summary('holds', { id: 'older-head', spec: '_specs/tla/Lease.tla', head: '1111111' }, 4),
  ]
  assert.deepEqual(siblingsOf('item', [], runs), ['queue', 'review-new', 'item'])
  // An older run of a spec stands in its spec's place when it is the one open.
  assert.deepEqual(siblingsOf('review-old', ['other'], runs), ['queue', 'review-old', 'item'])
  assert.deepEqual(siblingsOf('alone', [], runs), ['alone'], 'a run the slice does not have is on its own')
  assert.deepEqual(siblingsOf(null, named, runs), [])
})

test('J and K go to the next and previous sibling and stop at the ends, and the heading says which of how many', () => {
  const siblings = ['a', 'b', 'c', 'd', 'e']
  assert.equal(siblingAt(siblings, 'b', 1), 'c')
  assert.equal(siblingAt(siblings, 'b', -1), 'a')
  assert.equal(siblingAt(siblings, 'e', 1), null)
  assert.equal(siblingAt(siblings, 'a', -1), null)
  assert.equal(positionWords(siblings, 'b'), 'Model 2 of 5')
  assert.equal(positionWords(['a'], 'a'), 'Model 1 of 1')
})

test("a change's chips name each run once, in the order they show", () => {
  const chips = [...chipsOf([summary('proofFails', { id: 'one' }), summary('holds', { id: 'two', spec: '_specs/tla/Queue.tla' })]), { id: null, label: 'Model not checked at this head', tone: 'quiet' as const }]
  assert.deepEqual(chipRuns(chips), ['one', 'two'])
})

test('an opener opens a run on its page among the siblings it names, and siblings that leave the run out are not kept', () => {
  useProofMemory.setState({ runs: {}, siblings: [] })
  useView.setState({ screen: 'work', openProof: null })
  openRunAmong('two', ['one', 'two', 'three'])
  assert.deepEqual([useView.getState().screen, useView.getState().openProof], ['proof', 'two'])
  assert.deepEqual(useProofMemory.getState().siblings, ['one', 'two', 'three'])
  assert.deepEqual(keptOf('two'), keptOf(null), 'opened with no place to land, it shows what it was left at')

  openRunAmong('four', ['one', 'two'])
  assert.deepEqual(useProofMemory.getState().siblings, [], 'the page finds the change of a run its opener left out')
})
